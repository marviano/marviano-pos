export type VerifikasiGrandTotalSummary = {
  gross: number;
  discount: number;
  refund: number;
  net: number;
  txs: number;
  cu: number;
};

export type VerifikasiMismatch = {
  uuid: string;
  fields: string[];
  details?: Array<{ field: string; salespulseValue: string | number; systemPosValue: string | number }>;
  itemDiffs?: { countSalespulse: number; countSystemPos: number; details: string[] };
  refundDiffs?: { countSalespulse: number; countSystemPos: number; details: string[] };
};

export type SystemPosVerifikasiResult = {
  fromDate: string;
  toDate: string;
  auditScopeLabel: string;
  daftarScopeLabel: string;
  auditTransactionCount: number;
  commonInBothDbs: number;
  onlyInSalespulse: string[];
  onlyInSystemPos: string[];
  matching: number;
  mismatches: VerifikasiMismatch[];
  summaryAudit: { salespulse: VerifikasiGrandTotalSummary; system_pos: VerifikasiGrandTotalSummary };
  summaryDaftar: { p2: VerifikasiGrandTotalSummary; system_pos: VerifikasiGrandTotalSummary };
  onlyInSalespulseDaftarP2: string[];
  onlyInSystemPosDaftar: string[];
  /** In system_pos (created_at) but excluded from P2-aligned daftar view — e.g. moved P1→P2 on another day */
  onlyInSystemPosCreatedAtNotInDaftar: string[];
};

const num = (v: unknown): number =>
  typeof v === 'number' && !Number.isNaN(v)
    ? v
    : typeof v === 'string'
      ? parseFloat(v) || 0
      : 0;

const eqNum = (a: unknown, b: unknown, tol = 0.01) => Math.abs(num(a) - num(b)) <= tol;

const normalizeVal = (v: unknown): string | number =>
  v == null ? '' : typeof v === 'number' ? Math.round(v * 100) / 100 : String(v).trim();

const isCompletedForGrandTotal = (status: unknown): boolean => {
  const s = String(status ?? '').toLowerCase();
  return s !== 'cancelled' && s !== 'pending';
};

export function computeVerifikasiGrandTotal(rows: Array<Record<string, unknown>>): VerifikasiGrandTotalSummary {
  const completed = rows.filter((t) => isCompletedForGrandTotal(t.status));
  const gross = completed.reduce((sum, t) => sum + num(t.total_amount), 0);
  const final = completed.reduce((sum, t) => sum + num(t.final_amount), 0);
  const discount = Math.max(0, gross - final);
  const refund = completed.reduce((sum, t) => sum + num(t.refund_total), 0);
  const net = Math.max(0, final - refund);
  const txs = completed.length;
  const cu = completed.reduce((sum, t) => sum + num(t.customer_unit), 0);
  return { gross, discount, refund, net, txs, cu };
};

export function isCreatedAtInWibRange(createdAt: unknown, fromDate: string, toDate: string): boolean {
  const raw = String(createdAt ?? '').trim();
  if (!raw) return false;
  let day = '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    day = raw.slice(0, 10);
  } else {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return false;
    const utc7 = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    day = `${utc7.getUTCFullYear()}-${String(utc7.getUTCMonth() + 1).padStart(2, '0')}-${String(utc7.getUTCDate()).padStart(2, '0')}`;
  }
  return day >= fromDate && day <= toDate;
}

const txFields = [
  'total_amount',
  'final_amount',
  'voucher_discount',
  'voucher_type',
  'voucher_value',
  'voucher_label',
  'status',
  'payment_method',
  'refund_total',
] as const;

export function compareVerifikasiTransactionSets(
  salespulseData: Array<Record<string, unknown>>,
  systemPosData: Array<Record<string, unknown>>
): {
  onlyInSalespulse: string[];
  onlyInSystemPos: string[];
  commonInBothDbs: number;
  matching: number;
  mismatches: VerifikasiMismatch[];
} {
  const salespulseIds = new Set(salespulseData.map((t) => String(t.uuid_id ?? t.id)));
  const systemPosIds = new Set(systemPosData.map((t) => String(t.uuid_id ?? t.id)));
  const onlyInSalespulse = [...salespulseIds].filter((id) => !systemPosIds.has(id));
  const onlyInSystemPos = [...systemPosIds].filter((id) => !salespulseIds.has(id));
  const commonIds = [...salespulseIds].filter((id) => systemPosIds.has(id));

  const salespulseByUuid = new Map<string, Record<string, unknown>>();
  salespulseData.forEach((t) => {
    salespulseByUuid.set(String(t.uuid_id ?? t.id), t);
  });
  const systemPosByUuid = new Map<string, Record<string, unknown>>();
  systemPosData.forEach((t) => {
    systemPosByUuid.set(String(t.uuid_id ?? t.id), t);
  });

  const mismatches: VerifikasiMismatch[] = [];

  for (const uuid of commonIds) {
    const sp = salespulseByUuid.get(uuid);
    const sys = systemPosByUuid.get(uuid);
    if (!sp || !sys) continue;

    const diffFields: string[] = [];
    const details: Array<{ field: string; salespulseValue: string | number; systemPosValue: string | number }> = [];

    for (const key of txFields) {
      const a = sp[key];
      const b = sys[key];
      const isNumField =
        typeof a === 'number' ||
        (typeof a === 'string' && a !== '' && !Number.isNaN(parseFloat(a))) ||
        typeof b === 'number' ||
        (typeof b === 'string' && b !== '' && !Number.isNaN(parseFloat(b)));
      const same = isNumField ? eqNum(a, b) : normalizeVal(a) === normalizeVal(b);
      if (!same) {
        diffFields.push(key);
        details.push({ field: key, salespulseValue: normalizeVal(a), systemPosValue: normalizeVal(b) });
      }
    }

    const spItems = Array.isArray(sp.items) ? sp.items : [];
    const sysItems = Array.isArray(sys.items) ? sys.items : [];
    const spCancelled = num(sp.cancelled_items_count);
    const sysCancelled = num(sys.cancelled_items_count);
    let itemDiffs: VerifikasiMismatch['itemDiffs'];

    if (spItems.length !== sysItems.length || spCancelled !== sysCancelled) {
      diffFields.push('items_count');
      const lines = [`Item count: salespulse ${spItems.length}, system_pos ${sysItems.length}`];
      if (spCancelled !== sysCancelled) {
        lines.push(`Cancelled: salespulse ${spCancelled}, system_pos ${sysCancelled}`);
      }
      itemDiffs = { countSalespulse: spItems.length, countSystemPos: sysItems.length, details: lines };
    }

    const spRefunds = Array.isArray(sp.refunds) ? sp.refunds : [];
    const sysRefunds = Array.isArray(sys.refunds) ? sys.refunds : [];
    const spRefundTotal = num(sp.refund_total_from_refunds ?? sp.refund_total ?? 0);
    const sysRefundTotal = num(sys.refund_total_from_refunds ?? sys.refund_total ?? 0);
    let refundDiffs: VerifikasiMismatch['refundDiffs'];

    if (spRefunds.length !== sysRefunds.length || !eqNum(spRefundTotal, sysRefundTotal)) {
      if (!diffFields.includes('refund_total') && !eqNum(spRefundTotal, sysRefundTotal)) {
        diffFields.push('refund_total');
      }
      refundDiffs = {
        countSalespulse: spRefunds.length,
        countSystemPos: sysRefunds.length,
        details: [
          `Refund count: salespulse ${spRefunds.length}, system_pos ${sysRefunds.length}`,
          `Refund total: salespulse ${spRefundTotal}, system_pos ${sysRefundTotal}`,
        ],
      };
    }

    if (diffFields.length > 0) {
      mismatches.push({ uuid, fields: diffFields, details, itemDiffs, refundDiffs });
    }
  }

  return {
    onlyInSalespulse,
    onlyInSystemPos,
    commonInBothDbs: commonIds.length,
    matching: commonIds.length - mismatches.length,
    mismatches,
  };
}

export function buildSystemPosVerifikasiResult(
  fromDate: string,
  toDate: string,
  meta: {
    auditTransactionCount: number;
    auditScopeLabel: string;
    daftarScopeLabel: string;
  },
  salespulseData: Array<Record<string, unknown>>,
  systemPosData: Array<Record<string, unknown>>,
  systemPosByCreatedAt: Array<Record<string, unknown>>
): SystemPosVerifikasiResult {
  const auditCompare = compareVerifikasiTransactionSets(salespulseData, systemPosData);

  const salespulseDaftarP2 = salespulseData.filter((t) =>
    isCreatedAtInWibRange(t.created_at, fromDate, toDate)
  );
  const p2Ids = new Set(salespulseDaftarP2.map((t) => String(t.uuid_id ?? t.id)));
  const systemPosDaftarP2 = systemPosData.filter((t) => p2Ids.has(String(t.uuid_id ?? t.id)));
  const systemPosDaftarP2Ids = new Set(systemPosDaftarP2.map((t) => String(t.uuid_id ?? t.id)));

  const onlyInSalespulseDaftarP2 = [...p2Ids].filter((id) => !systemPosDaftarP2Ids.has(id));
  const onlyInSystemPosDaftar = [...systemPosDaftarP2Ids].filter((id) => !p2Ids.has(id));
  const onlyInSystemPosCreatedAtNotInDaftar = systemPosByCreatedAt
    .map((t) => String(t.uuid_id ?? t.id))
    .filter((id) => id && !p2Ids.has(id));

  return {
    fromDate,
    toDate,
    auditScopeLabel: meta.auditScopeLabel,
    daftarScopeLabel: meta.daftarScopeLabel,
    auditTransactionCount: meta.auditTransactionCount,
    commonInBothDbs: auditCompare.commonInBothDbs,
    onlyInSalespulse: auditCompare.onlyInSalespulse,
    onlyInSystemPos: auditCompare.onlyInSystemPos,
    matching: auditCompare.matching,
    mismatches: auditCompare.mismatches,
    summaryAudit: {
      salespulse: computeVerifikasiGrandTotal(salespulseData),
      system_pos: computeVerifikasiGrandTotal(systemPosData),
    },
    summaryDaftar: {
      p2: computeVerifikasiGrandTotal(salespulseDaftarP2),
      system_pos: computeVerifikasiGrandTotal(systemPosDaftarP2),
    },
    onlyInSalespulseDaftarP2,
    onlyInSystemPosDaftar,
    onlyInSystemPosCreatedAtNotInDaftar,
  };
}

export function formatIdr(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatVerifikasiSummaryLine(label: string, summary: VerifikasiGrandTotalSummary): string {
  return `${label}: Gross ${formatIdr(summary.gross)} · Discount ${formatIdr(summary.discount)} · Refund ${formatIdr(summary.refund)} · Net ${formatIdr(summary.net)} · Txs/CU ${summary.txs}/${summary.cu}`;
}
