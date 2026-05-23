/**
 * Local POS-only "sold out" flags (not synced to Salespulse).
 * Electron: MySQL table pos_product_sold_out. Browser: localStorage.
 */

export type PosSoldOutRow = {
  product_id: number;
  permanent: boolean;
  until_epoch_ms: number | null;
};

const storageKey = (businessId: number) => `marviano_pos_sold_out_v1_${businessId}`;

/** End of local calendar day (23:59:59.999) for the given instant. */
export function endOfLocalCalendarDayMs(from = new Date()): number {
  const d = new Date(from);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function isSoldOutRowActive(r: PosSoldOutRow, now = Date.now()): boolean {
  if (r.permanent) return true;
  if (r.until_epoch_ms == null) return false;
  return now < r.until_epoch_ms;
}

function normalizeApiRow(raw: { product_id: unknown; permanent?: unknown; until_epoch_ms?: unknown }): PosSoldOutRow {
  return {
    product_id: Number(raw.product_id),
    permanent: raw.permanent === true || raw.permanent === 1 || raw.permanent === '1',
    until_epoch_ms:
      raw.until_epoch_ms == null || raw.until_epoch_ms === ''
        ? null
        : Number(raw.until_epoch_ms),
  };
}

function readLocalStorageRows(businessId: number): PosSoldOutRow[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(businessId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is Record<string, unknown> => x && typeof x === 'object')
      .map((x) =>
        normalizeApiRow({
          product_id: x.product_id,
          permanent: x.permanent,
          until_epoch_ms: x.until_epoch_ms,
        })
      );
  } catch {
    return [];
  }
}

function writeLocalStorageRows(businessId: number, rows: PosSoldOutRow[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(businessId), JSON.stringify(rows));
}

function pruneAndIndex(rows: PosSoldOutRow[], now = Date.now()): { pruned: PosSoldOutRow[]; map: Record<number, PosSoldOutRow> } {
  const kept: PosSoldOutRow[] = [];
  const map: Record<number, PosSoldOutRow> = {};
  for (const r of rows) {
    if (!isSoldOutRowActive(r, now)) continue;
    kept.push(r);
    map[r.product_id] = r;
  }
  return { pruned: kept, map };
}

/** Active sold-out rows as a map product_id -> row (prunes expired day-flags). */
export async function fetchSoldOutMap(businessId: number): Promise<Record<number, PosSoldOutRow>> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (api?.localDbGetProductSoldOut) {
    const rows = (await api.localDbGetProductSoldOut(businessId)) as unknown[];
    if (!Array.isArray(rows)) return {};
    const normalized = rows.map((x) => normalizeApiRow(x as { product_id: unknown; permanent?: unknown; until_epoch_ms?: unknown }));
    const out: Record<number, PosSoldOutRow> = {};
    const now = Date.now();
    for (const r of normalized) {
      if (isSoldOutRowActive(r, now)) out[r.product_id] = r;
    }
    return out;
  }

  const raw = readLocalStorageRows(businessId);
  const { pruned, map } = pruneAndIndex(raw, Date.now());
  if (pruned.length !== raw.length) {
    writeLocalStorageRows(businessId, pruned);
  }
  return map;
}

export async function setProductSoldOutDay(businessId: number, productId: number, untilEpochMs: number): Promise<void> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (api?.localDbSetProductSoldOut) {
    const res = (await api.localDbSetProductSoldOut(businessId, productId, { mode: 'day', untilEpochMs })) as {
      success?: boolean;
      error?: string;
    };
    if (!res?.success) throw new Error(res?.error || 'Gagal menyimpan status habis');
    return;
  }
  const rows = readLocalStorageRows(businessId).filter((r) => r.product_id !== productId);
  rows.push({ product_id: productId, permanent: false, until_epoch_ms: untilEpochMs });
  writeLocalStorageRows(businessId, rows);
}

export async function setProductSoldOutPermanent(businessId: number, productId: number): Promise<void> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (api?.localDbSetProductSoldOut) {
    const res = (await api.localDbSetProductSoldOut(businessId, productId, { mode: 'permanent' })) as {
      success?: boolean;
      error?: string;
    };
    if (!res?.success) throw new Error(res?.error || 'Gagal menyimpan status habis');
    return;
  }
  const rows = readLocalStorageRows(businessId).filter((r) => r.product_id !== productId);
  rows.push({ product_id: productId, permanent: true, until_epoch_ms: null });
  writeLocalStorageRows(businessId, rows);
}

export async function clearProductSoldOut(businessId: number, productId: number): Promise<void> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (api?.localDbClearProductSoldOut) {
    const res = (await api.localDbClearProductSoldOut(businessId, productId)) as { success?: boolean; error?: string };
    if (!res?.success) throw new Error(res?.error || 'Gagal menghapus status habis');
    return;
  }
  const rows = readLocalStorageRows(businessId).filter((r) => r.product_id !== productId);
  writeLocalStorageRows(businessId, rows);
}
