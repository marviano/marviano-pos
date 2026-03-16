/**
 * Shared verification (match-check) logic: compare local transactions vs SalesPulse API.
 * Used by SyncManagement (Verifikasi data / Verifikasi hari ini) and Smart Sync (auto verifikasi hari ini).
 */

type UnknownRecord = Record<string, unknown>;

export type MatchCheckResult = {
  onlyInLocal: string[];
  onlyOnServer: string[];
  matching: number;
  mismatches: Array<{
    uuid: string;
    fields: string[];
    details?: Array<{ field: string; pictosValue: string | number; serverValue: string | number }>;
    itemDiffs?: { countPictos: number; countServer: number; details: string[] };
    refundDiffs?: { countPictos: number; countServer: number; details: string[] };
    discountDiffs?: Array<{ field: string; pictosValue: string | number; serverValue: string | number }>;
  }>;
};

function convertUtc7ToUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  isEnd: boolean
): Date {
  const seconds = isEnd ? 59 : 0;
  const milliseconds = isEnd ? 999 : 0;
  const utcMillis = Date.UTC(year, month - 1, day, hour - 7, minute, seconds, milliseconds);
  return new Date(utcMillis);
}

export function normalizeDateInput(value: string | null | undefined, isEnd: boolean): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch.map(Number);
    const date = convertUtc7ToUtcDate(y, m, d, isEnd ? 23 : 0, isEnd ? 59 : 0, isEnd);
    return date.toISOString();
  }

  const dateTimeMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (dateTimeMatch) {
    const [, y, m, d, h, min] = dateTimeMatch.map(Number);
    const date = convertUtc7ToUtcDate(y, m, d, h, min, isEnd);
    return date.toISOString();
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  if (isEnd) {
    parsed.setUTCMilliseconds(999);
    parsed.setUTCSeconds(59);
  }
  return parsed.toISOString();
}

/** Today's date as YYYY-MM-DD in WIB (UTC+7). */
export function getTodayWibDateString(): string {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** WIB date as YYYY-MM-DD for N days ago (0 = today, 1 = yesterday, 2 = day before, ...). */
export function getWibDateStringForDaysAgo(daysAgo: number): string {
  const utc = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  const wib = new Date(utc + 7 * 60 * 60 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface RunMatchCheckDeps {
  getTransactionsMatchData: (businessId: number, from: string, to: string) => Promise<UnknownRecord[]>;
  getApiUrl: (path: string) => string;
  fetch: typeof fetch;
}

/**
 * Compare local vs server transactions for the given date range.
 * Returns onlyInLocal, onlyOnServer, matching count, and mismatches (same UUID, different fields).
 */
export async function runMatchCheck(
  businessId: number,
  fromDate: string,
  toDate: string,
  fromIso: string,
  toIso: string,
  deps: RunMatchCheckDeps
): Promise<MatchCheckResult> {
  const apiUrl = deps.getApiUrl(
    `/api/transactions/match-check?business_id=${businessId}&from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}&from_iso=${encodeURIComponent(fromIso)}&to_iso=${encodeURIComponent(toIso)}&limit=50000`
  );
  // Bind fetch to global so it's not "Illegal invocation" when passed as deps.fetch (native fetch requires correct this).
  const globalObj = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : undefined);
  const fetchFn = typeof deps.fetch === 'function' && globalObj ? deps.fetch.bind(globalObj) : deps.fetch;
  const [localData, serverRes] = await Promise.all([
    deps.getTransactionsMatchData(businessId, fromIso, toIso),
    fetchFn(apiUrl)
  ]);
  if (!serverRes.ok) {
    const errText = await serverRes.text();
    throw new Error(`Gagal mengambil data dari salespulse.cc: ${serverRes.status} ${errText}`);
  }
  const serverJson = await serverRes.json();
  const serverData: UnknownRecord[] = Array.isArray(serverJson?.transactions) ? serverJson.transactions : [];
  const localIds = new Set((localData || []).map((t: UnknownRecord) => String(t.uuid_id ?? t.id)));
  const serverIds = new Set(serverData.map((t: UnknownRecord) => String(t.uuid_id ?? t.id)));
  const onlyInLocal = [...localIds].filter(id => !serverIds.has(id));
  const onlyOnServer = [...serverIds].filter(id => !localIds.has(id));
  const commonIds = [...localIds].filter(id => serverIds.has(id));
  const localByUuid = new Map<string, UnknownRecord>();
  (localData || []).forEach((t: UnknownRecord) => {
    const u = String(t.uuid_id ?? t.id);
    localByUuid.set(u, t);
  });
  const serverByUuid = new Map<string, UnknownRecord>();
  serverData.forEach((t: UnknownRecord) => {
    const u = String(t.uuid_id ?? t.id);
    serverByUuid.set(u, t);
  });
  const txFields = [
    'total_amount', 'active_total', 'final_amount', 'voucher_discount', 'voucher_type', 'voucher_value', 'voucher_label',
    'status', 'payment_method', 'payment_method_id', 'pickup_method', 'customer_name', 'customer_unit', 'waiter_id', 'user_id',
    'paid_at', 'note', 'receipt_number'
  ];
  const normalizeVal = (v: unknown): string | number => {
    if (v == null) return '';
    if (typeof v === 'number') return Math.round(v * 100) / 100;
    return String(v).trim();
  };
  const num = (v: unknown): number => (typeof v === 'number' && !Number.isNaN(v) ? v : typeof v === 'string' ? parseFloat(v) || 0 : 0);
  const eqNum = (a: unknown, b: unknown, tol = 0.01) => Math.abs(num(a) - num(b)) <= tol;
  const datetimeFields = ['created_at', 'updated_at', 'paid_at'];
  const toTimestamp = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && !Number.isNaN(v)) return v < 1e12 ? v * 1000 : v;
    const d = new Date(v as string | number | Date);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  };
  const eqDateTime = (a: unknown, b: unknown, tolMs = 2000) => {
    const ta = toTimestamp(a);
    const tb = toTimestamp(b);
    if (ta == null && tb == null) return true;
    if (ta == null || tb == null) return false;
    return Math.abs(ta - tb) <= tolMs;
  };
  const mismatches: MatchCheckResult['mismatches'] = [];
  for (const uuid of commonIds) {
    const localTx = localByUuid.get(uuid) as Record<string, unknown> | undefined;
    const serverTx = serverByUuid.get(uuid) as Record<string, unknown> | undefined;
    if (!localTx || !serverTx) continue;
    const diffFields: string[] = [];
    const details: Array<{ field: string; pictosValue: string | number; serverValue: string | number }> = [];
    for (const key of txFields) {
      const l = localTx[key];
      const s = serverTx[key];
      const isDateTime = datetimeFields.includes(key);
      const looksNumeric = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(parseFloat(v as string)));
      const isNum = !isDateTime && (looksNumeric(l) || looksNumeric(s) || (l === '' || s === ''));
      const same = isDateTime ? eqDateTime(l, s) : isNum ? eqNum(l, s) : (normalizeVal(l) === normalizeVal(s));
      if (!same) {
        diffFields.push(key);
        details.push({ field: key, pictosValue: normalizeVal(l), serverValue: normalizeVal(s) });
      }
    }
    const localRefund = num(localTx.refund_total_from_refunds ?? localTx.refund_total ?? 0);
    const serverRefund = num(serverTx.refund_total_from_refunds ?? serverTx.refund_total ?? 0);
    if (!eqNum(localRefund, serverRefund)) {
      if (!diffFields.includes('refund_total')) diffFields.push('refund_total');
      if (!details.some(d => d.field === 'refund_total')) {
        details.push({ field: 'refund_total', pictosValue: localRefund, serverValue: serverRefund });
      }
    }
    const localItems = Array.isArray(localTx.items) ? localTx.items : [];
    const serverItems = Array.isArray(serverTx.items) ? serverTx.items : [];
    const localCancelled = num(localTx.cancelled_items_count);
    const serverCancelled = num(serverTx.cancelled_items_count);
    let itemDiffs: { countPictos: number; countServer: number; details: string[] } | undefined;
    if (localItems.length !== serverItems.length || localCancelled !== serverCancelled) {
      diffFields.push('items_count');
      const lines = [`Item count: Pictos ${localItems.length}, salespulse ${serverItems.length}`];
      if (localCancelled !== serverCancelled) {
        lines.push(`Cancelled items: Pictos ${localCancelled}, salespulse ${serverCancelled}`);
      }
      for (let i = 0; i < Math.max(localItems.length, serverItems.length); i++) {
        const li = localItems[i] as Record<string, unknown> | undefined;
        const si = serverItems[i] as Record<string, unknown> | undefined;
        if (!li && si) lines.push(`Item ${i + 1}: missing on Pictos (only on salespulse)`);
        else if (li && !si) lines.push(`Item ${i + 1}: missing on salespulse (only on Pictos)`);
        else if (li && si) {
          const pq = num(li.quantity); const sq = num(si.quantity);
          const pp = num(li.unit_price); const sp = num(si.unit_price);
          const pt = num(li.total_price); const st = num(si.total_price);
          const pStatus = String(li.production_status ?? '');
          const sStatus = String(si.production_status ?? '');
          if (!eqNum(pq, sq) || !eqNum(pp, sp) || !eqNum(pt, st) || pStatus !== sStatus) {
            lines.push(`Item ${i + 1}: qty ${pq} vs ${sq}, price ${pp} vs ${sp}, total ${pt} vs ${st}, status "${pStatus}" vs "${sStatus}"`);
          }
        }
      }
      itemDiffs = { countPictos: localItems.length, countServer: serverItems.length, details: lines };
    }
    const localRefunds = Array.isArray(localTx.refunds) ? localTx.refunds : [];
    const serverRefunds = Array.isArray(serverTx.refunds) ? serverTx.refunds : [];
    let refundDiffs: { countPictos: number; countServer: number; details: string[] } | undefined;
    if (localRefunds.length !== serverRefunds.length || !eqNum(localRefund, serverRefund)) {
      const lines = [`Refund count: Pictos ${localRefunds.length}, salespulse ${serverRefunds.length}`, `Refund total: Pictos ${localRefund}, salespulse ${serverRefund}`];
      for (let i = 0; i < Math.max(localRefunds.length, serverRefunds.length); i++) {
        const lr = localRefunds[i] as Record<string, unknown> | undefined;
        const sr = serverRefunds[i] as Record<string, unknown> | undefined;
        if (!lr && sr) lines.push(`Refund ${i + 1}: missing on Pictos (only on salespulse) — ${num(sr.refund_amount)} ${sr.refund_type ?? ''}`);
        else if (lr && !sr) lines.push(`Refund ${i + 1}: missing on salespulse (only on Pictos) — ${num(lr.refund_amount)} ${lr.refund_type ?? ''}`);
        else if (lr && sr && (!eqNum(lr.refund_amount, sr.refund_amount) || String(lr.refund_type ?? '') !== String(sr.refund_type ?? '') || String(lr.status ?? '') !== String(sr.status ?? ''))) {
          lines.push(`Refund ${i + 1}: amount ${num(lr.refund_amount)} vs ${num(sr.refund_amount)}, type ${lr.refund_type} vs ${sr.refund_type}, status ${lr.status} vs ${sr.status}`);
        }
      }
      refundDiffs = { countPictos: localRefunds.length, countServer: serverRefunds.length, details: lines };
    }
    const discountFields = ['voucher_discount', 'voucher_type', 'voucher_value', 'voucher_label'];
    const discountDiffs = discountFields
      .filter(k => diffFields.includes(k))
      .map(k => ({ field: k, pictosValue: normalizeVal(localTx[k]), serverValue: normalizeVal(serverTx[k]) }));
    if (diffFields.length > 0) {
      mismatches.push({
        uuid,
        fields: diffFields,
        details,
        itemDiffs,
        refundDiffs,
        discountDiffs: discountDiffs.length > 0 ? discountDiffs : undefined
      });
    }
  }
  const matching = commonIds.length - mismatches.length;
  return { onlyInLocal, onlyOnServer, matching, mismatches };
}
