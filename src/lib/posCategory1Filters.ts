/** POS menu buckets by Category I (category1_name). */

export type PosTransactionType = 'drinks' | 'bakery' | 'foods' | 'packages' | 'rental';

/** Category I names that appear under the rental / room-charge bucket (case-insensitive). */
export const RENTAL_CATEGORY1_NAMES = ['sewa ruangan'];

function normalizeCategory1Name(name: string | null | undefined): string {
  return (name || '').trim().toLowerCase();
}

/** Category I rental / room charge — excluded from kitchen & barista KDS (any business). */
export function isRentalCategory1(
  category1Name: string | null | undefined,
  _category1Id?: number | null
): boolean {
  return RENTAL_CATEGORY1_NAMES.includes(normalizeCategory1Name(category1Name));
}

/** Offline kasir menu: drinks/bakery/etc need harga_jual > 0; rental allows 0 (negotiated / room charge). */
export function isOfflineKasirPriceVisible(
  hargaJual: number | null | undefined,
  transactionType?: PosTransactionType
): boolean {
  if (hargaJual === null || hargaJual === undefined) return false;
  if (transactionType === 'rental') return hargaJual >= 0;
  return hargaJual > 0;
}

export function matchesPosTransactionType(
  category1Name: string | null | undefined,
  category1Id: number | null | undefined,
  transactionType: PosTransactionType
): boolean {
  const name = typeof category1Name === 'string' ? category1Name.trim() : '';
  const lower = normalizeCategory1Name(name);

  switch (transactionType) {
    case 'drinks':
      return name === 'Minuman' || name === 'Dessert';
    case 'bakery':
      return name === 'Bakery';
    case 'foods':
      return name === 'Makanan';
    case 'packages':
      return lower === 'paket' || category1Id === 14;
    case 'rental':
      return isRentalCategory1(category1Name, category1Id);
    default:
      return false;
  }
}
