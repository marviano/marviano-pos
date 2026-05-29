/**
 * Room rental (Sewa Ruangan) transaction line metadata.
 *
 * ## Where data lives
 * - `transaction_items.rental_duration_value` + `transaction_items.rental_duration_unit`
 *   for every paid rental line (Category I = Sewa Ruangan).
 * - Room identity: `transaction_items.product_id` → `products` (e.g. VIP room product).
 * - Price: `transaction_items.unit_price` / `total_price` (harga bebas OR customization tiers).
 * - Optional notes: `transaction_items.custom_note` (not used for analytics).
 *
 * ## Identifying rental lines in SQL
 * Join `products` → `category1` where LOWER(TRIM(category1.name)) IN ('sewa ruangan')
 * OR use `isRentalCategory1()` in app code (see posCategory1Filters).
 *
 * ## Example: total rental hours in a date range (Salespulse / local MySQL)
 * ```sql
 * SELECT
 *   SUM(CASE ti.rental_duration_unit
 *     WHEN 'hour'  THEN ti.rental_duration_value
 *     WHEN 'day'   THEN ti.rental_duration_value * 24
 *     WHEN 'month' THEN ti.rental_duration_value * 720
 *     ELSE 0
 *   END) AS total_hours,
 *   SUM(ti.total_price) AS total_revenue,
 *   COUNT(*) AS rental_line_count
 * FROM transaction_items ti
 * INNER JOIN transactions t ON t.uuid_id = ti.uuid_transaction_id
 * INNER JOIN products p ON p.id = ti.product_id
 * INNER JOIN category1 c1 ON c1.id = p.category1_id
 * WHERE t.business_id = ?
 *   AND t.status = 'completed'
 *   AND (ti.production_status IS NULL OR ti.production_status != 'cancelled')
 *   AND ti.rental_duration_value IS NOT NULL
 *   AND ti.rental_duration_unit IS NOT NULL
 *   AND LOWER(TRIM(c1.name)) = 'sewa ruangan'
 *   AND COALESCE(t.paid_at, t.created_at) >= ?
 *   AND COALESCE(t.paid_at, t.created_at) < ?;
 * ```
 *
 * ## Example: per-room breakdown
 * ```sql
 * SELECT p.id AS product_id, p.nama AS room_name,
 *        SUM(...) AS total_hours, SUM(ti.total_price) AS revenue
 * FROM ... GROUP BY p.id, p.nama;
 * ```
 */

import { isRentalCategory1 } from '@/lib/posCategory1Filters';

/** Stored in `transaction_items.rental_duration_unit`. */
export type RentalDurationUnit = 'hour' | 'day' | 'month';

export const RENTAL_DURATION_UNITS: readonly RentalDurationUnit[] = ['hour', 'day', 'month'] as const;

export const RENTAL_DURATION_UNIT_LABELS: Record<RentalDurationUnit, string> = {
  hour: 'Jam',
  day: 'Hari',
  month: 'Bulan',
};

/** Hours per month for reporting normalization (30-day month). */
export const RENTAL_HOURS_PER_DAY = 24;
export const RENTAL_HOURS_PER_MONTH = 720;

export interface RentalDuration {
  value: number;
  unit: RentalDurationUnit;
}

export interface RentalLineProductLike {
  category1_name?: string | null;
  category1_id?: number | null;
}

export interface RentalCartLineLike {
  product: RentalLineProductLike;
  rentalDuration?: RentalDuration | null;
  unitPriceOverride?: number;
}

export function isRentalTransactionLine(product: RentalLineProductLike): boolean {
  return isRentalCategory1(product.category1_name, product.category1_id ?? null);
}

export function isValidRentalDurationUnit(unit: unknown): unit is RentalDurationUnit {
  return typeof unit === 'string' && (RENTAL_DURATION_UNITS as readonly string[]).includes(unit);
}

export function isValidRentalDuration(d: RentalDuration | null | undefined): d is RentalDuration {
  if (!d) return false;
  const v = Number(d.value);
  return Number.isFinite(v) && v > 0 && isValidRentalDurationUnit(d.unit);
}

/** Normalize duration to hours for aggregation. Returns null if invalid. */
export function rentalDurationToHours(d: RentalDuration | null | undefined): number | null {
  if (!isValidRentalDuration(d)) return null;
  switch (d.unit) {
    case 'hour':
      return d.value;
    case 'day':
      return d.value * RENTAL_HOURS_PER_DAY;
    case 'month':
      return d.value * RENTAL_HOURS_PER_MONTH;
    default:
      return null;
  }
}

export function parseRentalDurationValueInput(raw: string): number | null {
  const normalized = raw.replace(',', '.').trim();
  if (!normalized) return null;
  const n = parseFloat(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function rentalDurationFromRow(row: {
  rental_duration_value?: unknown;
  rental_duration_unit?: unknown;
}): RentalDuration | null {
  const value = row.rental_duration_value != null ? Number(row.rental_duration_value) : NaN;
  const unit = row.rental_duration_unit;
  if (!Number.isFinite(value) || value <= 0 || !isValidRentalDurationUnit(unit)) return null;
  return { value, unit };
}

export function formatRentalDuration(d: RentalDuration | null | undefined): string {
  if (!isValidRentalDuration(d)) return '';
  const v = d.value % 1 === 0 ? String(d.value) : d.value.toFixed(2);
  return `${v} ${RENTAL_DURATION_UNIT_LABELS[d.unit]}`;
}

/** Build duration from modal inputs; returns null if invalid. */
export function rentalDurationFromInputs(
  valueInput: string,
  unit: RentalDurationUnit
): RentalDuration | null {
  const value = parseRentalDurationValueInput(valueInput);
  if (value == null) return null;
  return { value, unit };
}

export interface RentalDurationOptionLike {
  name?: string | null;
  rental_duration_value?: unknown;
  rental_duration_unit?: unknown;
}

/** Parse duration from option label e.g. "1 Jam", "2 jam", "1 hari". */
export function parseRentalDurationFromOptionName(name: string | null | undefined): RentalDuration | null {
  if (!name?.trim()) return null;
  const m = name.trim().match(/^(\d+(?:[.,]\d+)?)\s*(jam|j|hari|h|bulan|bln|hour|hours|day|days|month|months)$/i);
  if (!m) return null;
  const value = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  const token = m[2].toLowerCase();
  if (token === 'jam' || token === 'j' || token.startsWith('hour')) return { value, unit: 'hour' };
  if (token === 'hari' || token === 'h' || token.startsWith('day')) return { value, unit: 'day' };
  return { value, unit: 'month' };
}

export function rentalDurationFromOption(option: RentalDurationOptionLike): RentalDuration | null {
  const value = option.rental_duration_value != null ? Number(option.rental_duration_value) : NaN;
  const unit = option.rental_duration_unit;
  if (Number.isFinite(value) && value > 0 && isValidRentalDurationUnit(unit)) {
    return { value, unit };
  }
  return parseRentalDurationFromOptionName(option.name ?? '');
}

/** Whether POS may show harga bebas for this rental product (default true when unset). */
export function isRentalAllowOpenPrice(product: { rental_allow_open_price?: unknown }): boolean {
  const v = product.rental_allow_open_price;
  if (v === 0 || v === false || v === '0') return false;
  return true;
}

export interface RentalSelectedOptionLike {
  option_id: number;
  option_name?: string;
}

export interface RentalCustomizationCatalogLike {
  options: Array<RentalDurationOptionLike & { id: number }>;
  /** From product_customizations.is_billing — false = add-on only, not package/billing */
  is_billing?: boolean | unknown;
}

export function isCustomizationBillingGroup(group: { is_billing?: unknown }): boolean {
  const v = group.is_billing;
  if (v === 0 || v === false || v === '0') return false;
  return true;
}

export function catalogHasBillingGroups(catalog: RentalCustomizationCatalogLike[]): boolean {
  return catalog.some(isCustomizationBillingGroup);
}

export interface CartItemQuantityLockInput {
  lockQuantity?: boolean;
  rentalDuration?: RentalDuration | null;
  unitPriceOverride?: number;
  product?: { category1_name?: string | null; category1_id?: number | null };
}

/** Billing packages and rental lines are always qty 1 — pick another package or add another line instead. */
export function isCartItemQuantityLocked(item: CartItemQuantityLockInput): boolean {
  if (item.lockQuantity) return true;
  if (isValidRentalDuration(item.rentalDuration)) return true;
  if (
    item.unitPriceOverride != null &&
    Number.isFinite(item.unitPriceOverride) &&
    isRentalCategory1(item.product?.category1_name, item.product?.category1_id ?? null)
  ) {
    return true;
  }
  return false;
}

/** Derive structured rental duration from selected customization options (package mode). */
export function resolveRentalDurationFromSelectedOptions(
  selectedOptions: RentalSelectedOptionLike[],
  catalog: RentalCustomizationCatalogLike[]
): RentalDuration | null {
  const billingCatalog = catalog.filter(isCustomizationBillingGroup);
  const byId = new Map<number, RentalDurationOptionLike & { id: number }>();
  for (const group of billingCatalog) {
    for (const opt of group.options) byId.set(opt.id, opt);
  }

  const durations: RentalDuration[] = [];
  for (const sel of selectedOptions) {
    const meta = byId.get(sel.option_id);
    const fromMeta = meta ? rentalDurationFromOption(meta) : null;
    if (fromMeta) {
      durations.push(fromMeta);
      continue;
    }
    if (billingCatalog.some((g) => g.options.some((o) => o.id === sel.option_id))) {
      const fromName = parseRentalDurationFromOptionName(sel.option_name);
      if (fromName) durations.push(fromName);
    }
  }

  if (durations.length === 0) return null;
  if (durations.length === 1) return durations[0];

  let totalHours = 0;
  for (const d of durations) {
    totalHours += rentalDurationToHours(d) ?? 0;
  }
  return totalHours > 0 ? { value: totalHours, unit: 'hour' } : null;
}

/** True when any billing catalog option carries explicit or parseable rental duration. */
export function catalogHasRentalPackageDurations(catalog: RentalCustomizationCatalogLike[]): boolean {
  for (const group of catalog) {
    if (!isCustomizationBillingGroup(group)) continue;
    for (const opt of group.options) {
      if (rentalDurationFromOption(opt)) return true;
    }
  }
  return false;
}
