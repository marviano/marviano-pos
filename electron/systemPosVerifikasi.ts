import {
  executeQueryOnLocalSalespulse,
  executeSystemPosQuery,
} from './mysqlDb';
import { getCalendarDateYMDInWib, wibDateRangeEpochBounds } from './wibDateTime';

export type VerifikasiTxRow = Record<string, unknown>;

function buildVerifikasiTxRow(
  t: Record<string, unknown>,
  txId: string,
  items: Record<string, unknown>[],
  refunds: Record<string, unknown>[]
): VerifikasiTxRow {
  const refundTotalFromRefunds = refunds.reduce(
    (sum: number, r: Record<string, unknown>) => sum + (Number(r.refund_amount) || 0),
    0
  );
  let cancelled_items_count = 0;
  for (const it of items) {
    if (String(it.production_status ?? '') === 'cancelled') cancelled_items_count++;
  }
  return {
    id: txId,
    uuid_id: txId,
    business_id: t.business_id,
    user_id: t.user_id,
    customer_unit: t.customer_unit != null ? Number(t.customer_unit) : null,
    payment_method: t.payment_method ?? null,
    total_amount: t.total_amount != null ? Number(t.total_amount) : null,
    final_amount: t.final_amount != null ? Number(t.final_amount) : null,
    voucher_discount: t.voucher_discount != null ? Number(t.voucher_discount) : 0,
    voucher_type: t.voucher_type ?? null,
    voucher_value: t.voucher_value != null ? Number(t.voucher_value) : null,
    voucher_label: t.voucher_label ?? null,
    status: t.status ?? null,
    created_at: t.created_at,
    refund_total:
      refundTotalFromRefunds > 0
        ? refundTotalFromRefunds
        : t.refund_total != null
          ? Number(t.refund_total)
          : 0,
    items,
    refunds,
    refund_total_from_refunds: refundTotalFromRefunds,
    cancelled_items_count,
  };
}

function groupItemsByTxUuid(
  items: Record<string, unknown>[],
  getTxUuid: (row: Record<string, unknown>) => string
): Map<string, Record<string, unknown>[]> {
  const map = new Map<string, Record<string, unknown>[]>();
  for (const row of items || []) {
    const txUuid = getTxUuid(row).trim();
    if (!txUuid) continue;
    if (!map.has(txUuid)) map.set(txUuid, []);
    map.get(txUuid)!.push(row);
  }
  return map;
}

function groupRefundsByTxUuid(refunds: Record<string, unknown>[]): Map<string, Record<string, unknown>[]> {
  const map = new Map<string, Record<string, unknown>[]>();
  for (const row of refunds || []) {
    const txUuid = String(row.transaction_uuid ?? '').trim();
    if (!txUuid) continue;
    if (!map.has(txUuid)) map.set(txUuid, []);
    map.get(txUuid)!.push({
      ...row,
      refund_amount: row.refund_amount != null ? Number(row.refund_amount) : 0,
    });
  }
  return map;
}

export function isCreatedAtInWibDateRange(
  createdAt: unknown,
  fromDate: string,
  toDate: string
): boolean {
  const day = getCalendarDateYMDInWib(String(createdAt ?? ''));
  if (!day) return false;
  return day >= fromDate && day <= toDate;
}

async function enrichSalespulseTransactions(
  uuidIds: string[],
  businessId?: number
): Promise<VerifikasiTxRow[]> {
  if (uuidIds.length === 0) return [];
  const placeholders = uuidIds.map(() => '?').join(',');
  const mainParams: (string | number)[] = [...uuidIds];
  let mainTxQuery = `SELECT t.* FROM transactions t WHERE t.uuid_id IN (${placeholders}) AND t.status IN ('completed', 'refunded')`;
  if (businessId != null) {
    mainTxQuery += ' AND t.business_id = ?';
    mainParams.push(businessId);
  }
  mainTxQuery += ' ORDER BY t.created_at ASC';
  const mainTxRows = (await executeQueryOnLocalSalespulse(mainTxQuery, mainParams)) as Record<
    string,
    unknown
  >[];
  const mainItems = (await executeQueryOnLocalSalespulse(
    `SELECT id, uuid_id, transaction_id, uuid_transaction_id, product_id, quantity, unit_price, total_price,
     custom_note, production_status, cancelled_at, created_at
     FROM transaction_items WHERE uuid_transaction_id IN (${placeholders}) ORDER BY uuid_transaction_id, id ASC`,
    uuidIds
  )) as Record<string, unknown>[];
  const mainRefunds = (await executeQueryOnLocalSalespulse(
    `SELECT id, transaction_uuid, refund_amount, refund_type, status, refunded_at
     FROM transaction_refunds WHERE transaction_uuid IN (${placeholders}) AND status IN ('pending', 'completed')
     ORDER BY transaction_uuid, refunded_at ASC`,
    uuidIds
  )) as Record<string, unknown>[];

  const itemsByTx = groupItemsByTxUuid(mainItems, (row) => String(row.uuid_transaction_id ?? ''));
  const refundsByTx = groupRefundsByTxUuid(mainRefunds);

  return (mainTxRows || []).map((t) => {
    const txId = String(t.uuid_id ?? t.id);
    return buildVerifikasiTxRow(t, txId, itemsByTx.get(txId) || [], refundsByTx.get(txId) || []);
  });
}

async function enrichSystemPosTransactions(
  sysPosTxRows: Record<string, unknown>[],
  refundUuidIds: string[]
): Promise<VerifikasiTxRow[]> {
  if (sysPosTxRows.length === 0) return [];

  const sysPosUuidByNumericId = new Map<number, string>();
  for (const row of sysPosTxRows) {
    const numId = row.sys_pos_id;
    const uuid = String(row.uuid_id ?? '').trim();
    if (typeof numId === 'number' && uuid) sysPosUuidByNumericId.set(numId, uuid);
  }

  const sysPosIds = sysPosTxRows
    .map((r) => r.sys_pos_id)
    .filter((id): id is number => typeof id === 'number');
  const txUuidIds = sysPosTxRows
    .map((r) => String(r.uuid_id ?? '').trim())
    .filter(Boolean);
  const sysPosIdPlaceholders = sysPosIds.map(() => '?').join(',');
  const txUuidPlaceholders = txUuidIds.map(() => '?').join(',');
  const refundPlaceholders = refundUuidIds.map(() => '?').join(',');

  const sysPosItems =
    sysPosIds.length > 0 || txUuidIds.length > 0
      ? ((await executeSystemPosQuery<Record<string, unknown>>(
          sysPosIds.length > 0 && txUuidIds.length > 0
            ? `SELECT id, uuid_id, transaction_id, uuid_transaction_id, product_id, quantity, unit_price, total_price, custom_note, production_status, cancelled_at, created_at
               FROM transaction_items
               WHERE transaction_id IN (${sysPosIdPlaceholders}) OR uuid_transaction_id IN (${txUuidPlaceholders})
               ORDER BY id ASC`
            : sysPosIds.length > 0
              ? `SELECT id, uuid_id, transaction_id, uuid_transaction_id, product_id, quantity, unit_price, total_price, custom_note, production_status, cancelled_at, created_at
                 FROM transaction_items WHERE transaction_id IN (${sysPosIdPlaceholders}) ORDER BY id ASC`
              : `SELECT id, uuid_id, transaction_id, uuid_transaction_id, product_id, quantity, unit_price, total_price, custom_note, production_status, cancelled_at, created_at
                 FROM transaction_items WHERE uuid_transaction_id IN (${txUuidPlaceholders}) ORDER BY id ASC`,
          sysPosIds.length > 0 && txUuidIds.length > 0
            ? [...sysPosIds, ...txUuidIds]
            : sysPosIds.length > 0
              ? sysPosIds
              : txUuidIds
        )) as Record<string, unknown>[])
      : [];

  const sysPosRefunds =
    refundUuidIds.length > 0
      ? ((await executeSystemPosQuery<Record<string, unknown>>(
          `SELECT id, transaction_uuid, refund_amount, refund_type, status, refunded_at
           FROM transaction_refunds WHERE transaction_uuid IN (${refundPlaceholders}) AND status IN ('pending', 'completed')
           ORDER BY transaction_uuid, refunded_at ASC`,
          refundUuidIds
        )) as Record<string, unknown>[])
      : [];

  const sysItemsByTx = groupItemsByTxUuid(sysPosItems, (row) => {
    const direct = String(row.uuid_transaction_id ?? '').trim();
    if (direct) return direct;
    const numId = row.transaction_id != null ? Number(row.transaction_id) : NaN;
    if (!Number.isNaN(numId)) return sysPosUuidByNumericId.get(numId) ?? '';
    return '';
  });
  const sysRefundsByTx = groupRefundsByTxUuid(sysPosRefunds);

  return sysPosTxRows.map((t) => {
    const txId = String(t.uuid_id ?? '');
    return buildVerifikasiTxRow(t, txId, sysItemsByTx.get(txId) || [], sysRefundsByTx.get(txId) || []);
  });
}

async function fetchSystemPosRowsByUuids(
  uuidIds: string[],
  businessId?: number
): Promise<Record<string, unknown>[]> {
  if (uuidIds.length === 0) return [];
  const placeholders = uuidIds.map(() => '?').join(',');
  const sysPosTxParams: (string | number)[] = [...uuidIds];
  let sysPosTxQuery = `SELECT t.id as sys_pos_id, t.uuid_id, t.business_id, t.user_id, t.customer_unit, t.payment_method, t.total_amount, t.final_amount, t.voucher_discount, t.voucher_type, t.voucher_value, t.voucher_label, t.status, t.created_at, t.refund_total FROM transactions t WHERE t.uuid_id IN (${placeholders}) AND t.status != 'archived'`;
  if (businessId != null) {
    sysPosTxQuery += ' AND t.business_id = ?';
    sysPosTxParams.push(businessId);
  }
  sysPosTxQuery += ' ORDER BY t.created_at ASC';
  return (await executeSystemPosQuery<Record<string, unknown>>(sysPosTxQuery, sysPosTxParams)) as Record<
    string,
    unknown
  >[];
}

export async function loadSystemPosVerifikasiData(
  businessId: number | undefined,
  fromDate: string,
  toDate: string
): Promise<{
  success: boolean;
  error?: string;
  meta?: {
    fromDate: string;
    toDate: string;
    auditTransactionCount: number;
    auditScopeLabel: string;
    daftarScopeLabel: string;
  };
  salespulse: VerifikasiTxRow[];
  system_pos: VerifikasiTxRow[];
  system_pos_by_created_at: VerifikasiTxRow[];
}> {
  const { fromEpoch, toEpoch } = wibDateRangeEpochBounds(fromDate, toDate);
  if (fromEpoch == null || toEpoch == null || fromEpoch > toEpoch) {
    return {
      success: false,
      error: 'fromDate must be before or equal to toDate (YYYY-MM-DD)',
      salespulse: [],
      system_pos: [],
      system_pos_by_created_at: [],
    };
  }

  const auditRows = await executeQueryOnLocalSalespulse<{ transaction_id: string }>(
    `SELECT DISTINCT transaction_id FROM printer2_audit_log
     WHERE printed_at_epoch >= ? AND printed_at_epoch <= ?
     ORDER BY transaction_id`,
    [fromEpoch, toEpoch]
  );
  const auditUuidIds = auditRows.map((r) => r.transaction_id);

  const salespulse = await enrichSalespulseTransactions(auditUuidIds, businessId);
  const sysPosTxRows = await fetchSystemPosRowsByUuids(auditUuidIds, businessId);
  const system_pos = await enrichSystemPosTransactions(sysPosTxRows, auditUuidIds);

  let daftarQuery = `SELECT t.id as sys_pos_id, t.uuid_id, t.business_id, t.user_id, t.customer_unit, t.payment_method, t.total_amount, t.final_amount, t.voucher_discount, t.voucher_type, t.voucher_value, t.voucher_label, t.status, t.created_at, t.refund_total FROM transactions t WHERE t.status != 'archived'`;
  const daftarParams: (string | number)[] = [];
  if (businessId != null) {
    daftarQuery += ' AND t.business_id = ?';
    daftarParams.push(businessId);
  }
  daftarQuery += ' ORDER BY t.created_at DESC LIMIT 50000';
  const allSysPosRows = (await executeSystemPosQuery<Record<string, unknown>>(
    daftarQuery,
    daftarParams
  )) as Record<string, unknown>[];
  const daftarSysPosRows = allSysPosRows.filter((row) =>
    isCreatedAtInWibDateRange(row.created_at, fromDate, toDate)
  );
  const daftarUuidIds = daftarSysPosRows
    .map((r) => String(r.uuid_id ?? '').trim())
    .filter(Boolean);
  const system_pos_by_created_at = await enrichSystemPosTransactions(daftarSysPosRows, daftarUuidIds);

  return {
    success: true,
    meta: {
      fromDate,
      toDate,
      auditTransactionCount: auditUuidIds.length,
      auditScopeLabel: 'Audit Printer 2 (printer2_audit_log.printed_at, WIB) — sama dengan Upsert System POS',
      daftarScopeLabel: 'Daftar Transaksi (filter P2: created_at WIB + audit P2 printed_at WIB; nominal dari system_pos)',
    },
    salespulse,
    system_pos,
    system_pos_by_created_at,
  };
}
