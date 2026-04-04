import { formatPackageLineDisplay } from '@/components/PackageSelectionModal';

type ReceiptLine = { name: string; quantity: number; price: number; total_price: number };

type Customization = {
  customization_name?: string;
  selected_options?: Array<{ option_name?: string; price_adjustment?: number }>;
};

function sumCustomizationPrice(customizations?: Customization[]) {
  if (!customizations || customizations.length === 0) return 0;
  return customizations.reduce((sum, customization) => {
    const optionTotal = (customization.selected_options || []).reduce(
      (optionSum, option) => optionSum + (Number(option.price_adjustment) || 0),
      0
    );
    return sum + optionTotal;
  }, 0);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/**
 * Maps local DB transaction items (from localDbGetTransactionItems) to thermal print lines.
 * Aligns with TransactionDetailModal reprint shaping (main line, package, bundle).
 */
export function buildReceiptLineItemsForPrint(items: unknown[]): ReceiptLine[] {
  const receiptItems: ReceiptLine[] = [];

  for (const raw of items) {
    const item = asRecord(raw);
    if (!item) continue;

    if (item.production_status === 'cancelled') continue;

    const quantity = Number(item.quantity) || 0;
    const itemPrice = Number(item.unit_price) || 0;
    const totalPrice =
      item.total_price != null && item.total_price !== ''
        ? Number(item.total_price)
        : itemPrice * quantity;

    let itemName = String(item.product_name || 'Unknown Product');

    const customizations = item.customizations;
    if (Array.isArray(customizations) && customizations.length > 0) {
      const customizationText = (customizations as Customization[])
        .map((c) => {
          const opts = (c.selected_options || []).map((o) => o.option_name).filter(Boolean).join(', ');
          return c.customization_name ? `${c.customization_name}: ${opts}` : opts;
        })
        .filter(Boolean)
        .join(', ');
      if (customizationText) itemName = `${itemName} (${customizationText})`;
    }

    const customNote = item.custom_note != null ? String(item.custom_note).trim() : '';
    if (customNote) {
      if (itemName.includes('(')) {
        itemName = `${itemName}, ${customNote})`;
      } else {
        itemName = `${itemName} (${customNote})`;
      }
    }

    receiptItems.push({
      name: itemName,
      quantity,
      price: itemPrice,
      total_price: totalPrice,
    });

    const packageSelections = item.packageSelections;
    if (Array.isArray(packageSelections) && packageSelections.length > 0) {
      for (const pkg of packageSelections) {
        const p = asRecord(pkg);
        if (!p) continue;
        const pkgQty = Number(p.quantity) || 0;
        const totalQty = quantity * pkgQty;
        const pname = String(p.product_name || 'Item');
        receiptItems.push({
          name: `    ${formatPackageLineDisplay(pname, totalQty)}`,
          quantity: totalQty,
          price: 0,
          total_price: 0,
        });
      }
    } else {
      const breakdown = item.packageBreakdownLines;
      if (Array.isArray(breakdown) && breakdown.length > 0) {
        for (const line of breakdown) {
          const l = asRecord(line);
          if (!l) continue;
          const lineQty = Number(l.quantity) || 1;
          const totalQty = quantity * lineQty;
          const pname = String(l.product_name || 'Item');
          receiptItems.push({
            name: `    ${formatPackageLineDisplay(pname, totalQty)}`,
            quantity: totalQty,
            price: 0,
            total_price: 0,
          });
        }
      }
    }

    const bundleSelections = item.bundleSelections;
    if (Array.isArray(bundleSelections) && bundleSelections.length > 0) {
      for (const bundleSel of bundleSelections) {
        const bs = asRecord(bundleSel);
        if (!bs) continue;
        const selectedProducts = bs.selectedProducts;
        if (!Array.isArray(selectedProducts)) continue;
        for (const spRaw of selectedProducts) {
          const sp = asRecord(spRaw);
          if (!sp) continue;
          const product = asRecord(sp.product);
          const selectionQty = typeof sp.quantity === 'number' && !Number.isNaN(sp.quantity) ? sp.quantity : 1;
          const totalQty = quantity * selectionQty;
          const customizationDetails: string[] = [];
          const spCustomizations = sp.customizations;
          if (Array.isArray(spCustomizations)) {
            for (const customization of spCustomizations as Customization[]) {
              const optionNames = (customization.selected_options || []).map((o) => o.option_name).join(', ');
              if (optionNames) {
                customizationDetails.push(
                  customization.customization_name
                    ? `${customization.customization_name}: ${optionNames}`
                    : optionNames
                );
              }
            }
          }
          const cn = sp.customNote != null ? String(sp.customNote).trim() : '';
          if (cn) customizationDetails.push(cn);

          const bundleProductName = (product?.nama as string) || 'Unknown Product';
          let subItemName = `  └ ${bundleProductName}${selectionQty > 1 ? ` (×${selectionQty})` : ''}`;
          if (customizationDetails.length > 0) {
            subItemName = `${subItemName} (${customizationDetails.join(', ')})`;
          }

          const perUnitTotal = sumCustomizationPrice(spCustomizations as Customization[]);
          receiptItems.push({
            name: subItemName,
            quantity: totalQty,
            price: perUnitTotal,
            total_price: perUnitTotal * totalQty,
          });
        }
      }
    }
  }

  return receiptItems;
}
