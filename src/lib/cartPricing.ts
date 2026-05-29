import { isRentalCategory1 } from '@/lib/posCategory1Filters';

export type CartPriceProduct = {
  harga_jual?: number | null;
  category1_name?: string | null;
  category1_id?: number | null;
};

export type CartPricedItem = {
  product: CartPriceProduct;
  unitPriceOverride?: number;
};

export function isRentalCartProduct(product: CartPriceProduct): boolean {
  return isRentalCategory1(product.category1_name, product.category1_id ?? null);
}

/** Base unit price before customization/bundle adjustments. */
export function getCartLineBaseUnitPrice(
  item: CartPricedItem,
  catalogUnitPrice: number | null
): number | null {
  if (item.unitPriceOverride != null && Number.isFinite(item.unitPriceOverride)) {
    return item.unitPriceOverride;
  }
  if (isRentalCartProduct(item.product)) {
    if (catalogUnitPrice != null && catalogUnitPrice > 0) return catalogUnitPrice;
    return 0;
  }
  return catalogUnitPrice;
}

export function parseRupiahInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}
