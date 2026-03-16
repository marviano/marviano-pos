/**
 * Convert reservation items_json to/from CartItem[] for pre-order and Send to Kasir.
 * items_json shape: [{ product_id, product_name, quantity, unit_price, customizations?, customNote?, bundleSelections?, packageSelections? }]
 */

export type ReservationItemJson = {
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  customizations?: Array<{
    customization_id: number;
    customization_name: string;
    selected_options: Array<{
      option_id: number;
      option_name: string;
      price_adjustment: number;
    }>;
  }>;
  customNote?: string;
  bundleSelections?: unknown[];
  packageSelections?: unknown[];
};

type ProductLike = { id: number; nama: string; harga_jual: number | null };
type CartItemLike = {
  id: number;
  product: ProductLike;
  quantity: number;
  customizations?: ReservationItemJson['customizations'];
  customNote?: string;
  bundleSelections?: unknown[];
  packageSelections?: unknown[];
};

/** Parse items_json string or array to ReservationItemJson[]. */
export function parseReservationItemsJson(
  raw: string | unknown[] | null | undefined
): ReservationItemJson[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw as ReservationItemJson[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as ReservationItemJson[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Convert reservation items_json to cart items. Uses productMap to resolve product_id to full product; falls back to minimal product from snapshot. */
export function reservationItemsToCartItems(
  itemsJson: ReservationItemJson[],
  productMap: Map<number, ProductLike>
): CartItemLike[] {
  return itemsJson.map((item, index) => {
    const product = productMap.get(item.product_id) ?? {
      id: item.product_id,
      nama: item.product_name,
      harga_jual: item.unit_price
    } as ProductLike;
    return {
      id: product.id,
      product,
      quantity: item.quantity,
      customizations: item.customizations,
      customNote: item.customNote,
      bundleSelections: item.bundleSelections,
      packageSelections: item.packageSelections
    };
  });
}

/** Compute total price from reservation items_json (unit_price + customization adjustments, per line, then sum). */
export function computeTotalFromReservationItems(
  items: ReservationItemJson[]
): number {
  return items.reduce((sum, item) => {
    let unitPrice = Number(item.unit_price) || 0;
    if (item.customizations?.length) {
      item.customizations.forEach((c) =>
        (c.selected_options || []).forEach((o) => {
          unitPrice += Number((o as { price_adjustment?: number }).price_adjustment) || 0;
        })
      );
    }
    const qty = Number(item.quantity) || 0;
    return sum + unitPrice * qty;
  }, 0);
}

/** Serialize cart items to reservation items_json shape. */
export function cartItemsToReservationItemsJson(
  cartItems: CartItemLike[]
): ReservationItemJson[] {
  return cartItems.map((item) => {
    let unitPrice = item.product?.harga_jual ?? 0;
    if (item.customizations?.length) {
      item.customizations.forEach((c) =>
        c.selected_options.forEach((o) => {
          unitPrice += o.price_adjustment ?? 0;
        })
      );
    }
    return {
      product_id: item.product?.id ?? item.id,
      product_name: (item.product?.nama as string) ?? '',
      quantity: item.quantity,
      unit_price: unitPrice,
      customizations: item.customizations,
      customNote: item.customNote,
      bundleSelections: item.bundleSelections,
      packageSelections: item.packageSelections
    };
  });
}
