'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Package, Check, Minus, Plus } from 'lucide-react';

export interface PackageItemForPos {
  id: number;
  package_product_id: number;
  selection_type: 'default' | 'flexible';
  product_id: number | null;
  required_quantity: number;
  display_order: number;
  product_name: string | null;
  choice_products: { id: number; nama: string }[];
}

/** One card: either default (always included) or flexible (cashier picks). Per-sub-item note for Kitchen/Barista. */
export type PackageSelection =
  | {
    package_item_id: number;
    selection_type: 'default';
    product_id: number;
    product_name: string;
    quantity: number;
    note?: string;
  }
  | {
    package_item_id: number;
    selection_type: 'flexible';
    required_quantity: number;
    chosen: { product_id: number; product_name: string; quantity: number; note?: string }[];
  };

/** Common size codes (first word = size). If first word is not a size, we use "QTY Name" to avoid corrupting names like "Ayam Goreng" or "Es Teh". */
const SIZE_PREFIX = /^(L|M|S|R|XL|XXL|XS|XXS)$/i;

/** Format package sub-item: "L 4 Ayam Goreng" when first word is size, else "4 Ayam Goreng Nona Laras" (quantity once, no minus). */
export function formatPackageLineDisplay(productName: string, quantity: number): string {
  const t = (productName || '').trim();
  const m = t.match(/^(\S+)(?:\s+(.*))?$/);
  if (!m) return `${quantity} ${t}`;
  const [, first, rest] = m;
  if (rest !== undefined && SIZE_PREFIX.test(first)) return `${first} ${quantity} ${rest}`;
  return `${quantity} ${t}`;
}

/** Flatten package selections to list of { product_name, quantity, note? } for display/print.
 * Default items: quantity is per-package, so we multiply by packageQuantity.
 * Flexible items: chosen[].quantity is already the total picked (user picks "X items" total), so we do NOT multiply. */
export function getPackageBreakdownLines(selections: PackageSelection[], packageQuantity: number = 1): { product_name: string; quantity: number; note?: string }[] {
  const lines: { product_name: string; quantity: number; note?: string }[] = [];
  (selections || []).forEach(sel => {
    if (sel.selection_type === 'default') {
      lines.push({ product_name: sel.product_name, quantity: sel.quantity * packageQuantity, note: sel.note?.trim() || undefined });
    } else {
      (sel.chosen || []).forEach(c => {
        if (c.quantity > 0) lines.push({ product_name: c.product_name, quantity: c.quantity, note: c.note?.trim() || undefined });
      });
    }
  });
  return lines;
}

/** Breakdown lines with product_id and optional note for display filtering by category (Kitchen/Barista).
 * Default items: quantity is per-package, so we multiply by packageQuantity.
 * Flexible items: chosen[].quantity is already the total picked, so we do NOT multiply. */
export function getPackageBreakdownLinesWithProductId(
  selections: PackageSelection[],
  packageQuantity: number
): { product_id: number; product_name: string; quantity: number; note?: string }[] {
  const lines: { product_id: number; product_name: string; quantity: number; note?: string }[] = [];
  (selections || []).forEach(sel => {
    if (sel.selection_type === 'default') {
      lines.push({
        product_id: sel.product_id,
        product_name: sel.product_name,
        quantity: sel.quantity * packageQuantity,
        note: sel.note?.trim() || undefined,
      });
    } else {
      (sel.chosen || []).forEach(c => {
        if (c.quantity > 0) {
          lines.push({
            product_id: c.product_id,
            product_name: c.product_name,
            quantity: c.quantity,
            note: c.note?.trim() || undefined,
          });
        }
      });
    }
  });
  return lines;
}

interface PackageSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selections: PackageSelection[], quantity: number) => void;
  packageProduct: {
    id: number;
    nama: string;
    harga_jual: number;
  };
  packageItems: PackageItemForPos[];
}

/** Deduplicate package items: same selection_type + same content (default: same product_id; flexible: same choice set) */
function dedupePackageItems(items: PackageItemForPos[]): PackageItemForPos[] {
  const seen = new Set<string>();
  const result: PackageItemForPos[] = [];
  const sorted = [...items].sort((a, b) => a.display_order - b.display_order);
  for (const item of sorted) {
    const key =
      item.selection_type === 'default'
        ? `default-${item.product_id ?? 0}-${item.required_quantity}`
        : `flexible-${item.required_quantity}-${(item.choice_products || []).map(p => p.id).sort((a, b) => a - b).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export default function PackageSelectionModal({
  isOpen,
  onClose,
  onConfirm,
  packageProduct,
  packageItems
}: PackageSelectionModalProps) {
  const sortedItems = useMemo(
    () => dedupePackageItems(packageItems),
    [packageItems]
  );

  // For package overall quantity
  const [packageQuantity, setPackageQuantity] = useState(1);

  // Per-item customization notes: default item -> note; flexible item -> productId -> note
  const [defaultNotes, setDefaultNotes] = useState<Record<number, string>>({});
  const [flexibleNotes, setFlexibleNotes] = useState<Record<number, Record<number, string>>>({});

  // For flexible items: itemId -> productId -> quantity
  const [flexibleQtys, setFlexibleQtys] = useState<Record<number, Record<number, number>>>({});

  const itemsKey = sortedItems.map(i => `${i.id}-${i.selection_type}`).join(',');
  useEffect(() => {
    if (!isOpen || sortedItems.length === 0) return;
    setPackageQuantity(1);
    setDefaultNotes({});
    setFlexibleNotes({});
    const initial: Record<number, Record<number, number>> = {};
    sortedItems.forEach(item => {
      if (item.selection_type === 'flexible') {
        initial[item.id] = {};
        (item.choice_products || []).forEach(p => {
          initial[item.id][p.id] = 0;
        });
      }
    });
    setFlexibleQtys(initial);
  }, [isOpen, itemsKey]);

  // #region agent log
  useEffect(() => {
    if (!isOpen || packageItems.length === 0) return;
    const payload = {
      location: 'PackageSelectionModal.tsx',
      message: 'package items raw and deduped',
      data: {
        rawCount: packageItems.length,
        rawItems: packageItems.map(i => ({ id: i.id, selection_type: i.selection_type, display_order: i.display_order, product_id: i.product_id, required_quantity: i.required_quantity, product_name: i.product_name, choice_count: (i.choice_products || []).length })),
        dedupedCount: sortedItems.length,
        dedupedItems: sortedItems.map(i => ({ id: i.id, selection_type: i.selection_type, display_order: i.display_order, product_id: i.product_id, required_quantity: i.required_quantity, product_name: i.product_name, choice_count: (i.choice_products || []).length }))
      },
      timestamp: Date.now(),
      sessionId: 'debug-session',
      hypothesisId: 'duplication'
    };
    fetch('http://127.0.0.1:7244/ingest/c0917f49-320f-4b63-aac0-b89a407233e0', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => { });
  }, [isOpen, itemsKey]);
  // #endregion

  const getFlexibleTotal = (itemId: number) => {
    const q = flexibleQtys[itemId] || {};
    return Object.values(q).reduce((sum, n) => sum + n, 0);
  };

  const setFlexibleQty = (itemId: number, productId: number, value: number) => {
    const v = Math.max(0, Math.floor(value));
    setFlexibleQtys(prev => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {}),
        [productId]: v
      }
    }));
  };

  const isFlexibleComplete = (item: PackageItemForPos) => {
    return getFlexibleTotal(item.id) >= item.required_quantity * packageQuantity;
  };

  const isAllComplete = () => {
    return sortedItems.every(item =>
      item.selection_type === 'default' ? true : isFlexibleComplete(item)
    );
  };

  const handleConfirm = () => {
    if (!isAllComplete()) return;
    const selections: PackageSelection[] = sortedItems.map(item => {
      if (item.selection_type === 'default') {
        return {
          package_item_id: item.id,
          selection_type: 'default' as const,
          product_id: item.product_id!,
          product_name: item.product_name || '',
          quantity: item.required_quantity,
          note: defaultNotes[item.id]?.trim() || undefined,
        };
      }
      const q = flexibleQtys[item.id] || {};
      const notes = flexibleNotes[item.id] || {};
      const chosen = (item.choice_products || [])
        .filter(p => (q[p.id] || 0) > 0)
        .map(p => ({
          product_id: p.id,
          product_name: p.nama,
          quantity: q[p.id] || 0,
          note: notes[p.id]?.trim() || undefined,
        }));
      return {
        package_item_id: item.id,
        selection_type: 'flexible' as const,
        required_quantity: item.required_quantity,
        chosen,
      };
    });
    onConfirm(selections, packageQuantity);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-md flex items-center justify-center z-[70] p-4 sm:p-6 transition-all duration-300 animate-in fade-in">
      <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-xl rounded-[2rem] max-w-4xl w-full h-[85vh] flex flex-col shadow-[0_32px_64px_-16px_rgba(0,0,0,0.3)] overflow-hidden border border-white/20 dark:border-gray-700/30">
        <div className="flex items-center justify-between p-6 sm:p-8 border-b border-gray-100 dark:border-gray-700/50 bg-white/50 dark:bg-gray-800/50 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-500/10 dark:bg-blue-400/10 flex items-center justify-center border border-blue-500/20 shadow-inner">
              <Package className="w-7 h-7 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">{packageProduct.nama}</h2>
              <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                Rp {packageProduct.harga_jual.toLocaleString('id-ID')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex flex-col items-end gap-1.5">
              <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest leading-none">Jumlah Paket</span>
              <div className="flex items-center gap-1 bg-gray-100/50 dark:bg-gray-700/50 rounded-2xl p-1.5 border border-gray-200/50 dark:border-gray-600/50">
                <button
                  type="button"
                  onClick={() => setPackageQuantity(Math.max(1, packageQuantity - 1))}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-white dark:bg-gray-600 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all shadow-sm active:scale-90"
                >
                  <Minus className="w-5 h-5 stroke-[2.5]" />
                </button>
                <span className="min-w-[3rem] text-center font-mono font-black text-2xl text-blue-600 dark:text-blue-400">
                  {packageQuantity}
                </span>
                <button
                  type="button"
                  onClick={() => setPackageQuantity(packageQuantity + 1)}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-white dark:bg-gray-600 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all shadow-sm active:scale-90"
                >
                  <Plus className="w-5 h-5 stroke-[2.5]" />
                </button>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-12 h-12 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-2xl flex items-center justify-center transition-all duration-200 hover:rotate-90 active:scale-95 border border-gray-100 dark:border-gray-600"
            >
              <X className="w-6 h-6 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 scrollbar-hide">
          {sortedItems.map((item, index) => (
            <div
              key={item.id}
              className={`rounded-[2rem] border-2 p-6 transition-all duration-300 ${item.selection_type === 'default'
                ? 'bg-slate-50/50 dark:bg-slate-900/20 border-slate-100 dark:border-slate-800'
                : isFlexibleComplete(item)
                  ? 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-500/30'
                  : 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-500/30 shadow-[0_8px_30px_rgb(59,130,246,0.05)]'
                }`}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-baseline gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shadow-sm ${item.selection_type === 'default'
                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                    : 'bg-blue-500 text-white'
                    }`}>
                    {index + 1}
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
                    <span className="text-lg font-bold text-gray-800 dark:text-gray-200 whitespace-nowrap">
                      {item.selection_type === 'default' ? 'Item Tetap' : 'Pilihan Wajib'}
                    </span>
                    {item.selection_type !== 'default' && (
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                        <span className="text-gray-400 dark:text-gray-500">
                          Pilih {item.required_quantity * packageQuantity} item
                        </span>
                        {!isFlexibleComplete(item) && (
                          <span className="text-blue-500 animate-pulse">
                            (Kurang {(item.required_quantity * packageQuantity) - getFlexibleTotal(item.id)} lagi)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {item.selection_type === 'default' ? (
                  <span className="px-4 py-1.5 rounded-full bg-slate-200/50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400 text-xs font-bold tracking-wide uppercase">
                    Pasti Termasuk
                  </span>
                ) : (
                  <div
                    className={`px-5 py-2 rounded-full text-sm font-bold transition-all duration-300 flex items-center gap-2 shadow-sm ${isFlexibleComplete(item)
                      ? 'bg-emerald-500 text-white'
                      : 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                      }`}
                  >
                    {isFlexibleComplete(item) && <Check className="w-4 h-4" />}
                    {getFlexibleTotal(item.id)} / {item.required_quantity * packageQuantity}
                  </div>
                )}
              </div>

              {item.selection_type === 'default' ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-4 bg-white dark:bg-gray-800/50 rounded-2xl p-4 border border-gray-100 dark:border-gray-700 shadow-sm">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">Quantity</span>
                      <span className="font-mono text-xl font-black text-gray-900 dark:text-white">
                        {item.required_quantity * packageQuantity}×
                      </span>
                    </div>
                    <div className="w-px h-10 bg-gray-100 dark:bg-gray-700 mx-2" />
                    <span className="text-lg text-gray-800 dark:text-gray-200 font-semibold">
                      {item.product_name || '—'}
                    </span>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Catatan untuk item ini (opsional)</label>
                    <input
                      type="text"
                      value={defaultNotes[item.id] ?? ''}
                      onChange={(e) => setDefaultNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                      placeholder="misal: kurang pedas, no ice..."
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-700/50 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
                      maxLength={120}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(item.choice_products || []).map(product => {
                      const qty = flexibleQtys[item.id]?.[product.id] ?? 0;
                      const totalPicked = getFlexibleTotal(item.id);
                      const canIncrease = totalPicked < item.required_quantity * packageQuantity;
                      return (
                        <div
                          key={product.id}
                          className={`flex flex-col gap-2 bg-white dark:bg-gray-800 rounded-2xl border-2 transition-all duration-200 p-3 ${qty > 0
                            ? 'border-blue-500 shadow-md scale-[1.02]'
                            : 'border-gray-100 dark:border-gray-700 opacity-80'
                            }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1 bg-gray-50 dark:bg-gray-700 rounded-xl p-1">
                              <button
                                type="button"
                                onClick={() => setFlexibleQty(item.id, product.id, qty - 1)}
                                disabled={qty <= 0}
                                className="w-10 h-10 flex items-center justify-center rounded-lg bg-white dark:bg-gray-600 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow-sm active:scale-90"
                                aria-label="Decrease"
                              >
                                <Minus className="w-5 h-5 stroke-[2.5]" />
                              </button>
                              <span className="min-w-[2.5rem] text-center font-mono font-black text-lg text-gray-900 dark:text-white" aria-live="polite">
                                {qty}
                              </span>
                              <button
                                type="button"
                                onClick={() => setFlexibleQty(item.id, product.id, qty + 1)}
                                disabled={!canIncrease}
                                className="w-10 h-10 flex items-center justify-center rounded-lg bg-white dark:bg-gray-600 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow-sm active:scale-90"
                                aria-label="Increase"
                              >
                                <Plus className="w-5 h-5 stroke-[2.5]" />
                              </button>
                            </div>
                            <span className={`flex-1 font-bold text-sm leading-tight transition-colors ${qty > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'
                              }`}>
                              {product.nama}
                            </span>
                          </div>
                          {qty > 0 && (
                            <div>
                              <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">Catatan (opsional)</label>
                              <input
                                type="text"
                                value={flexibleNotes[item.id]?.[product.id] ?? ''}
                                onChange={(e) => setFlexibleNotes(prev => ({
                                  ...prev,
                                  [item.id]: { ...(prev[item.id] || {}), [product.id]: e.target.value },
                                }))}
                                placeholder="misal: less sugar, no cream..."
                                className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-700/50 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
                                maxLength={120}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="p-6 sm:p-8 bg-gray-50/50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700/50 flex-shrink-0">
          <button
            onClick={handleConfirm}
            disabled={!isAllComplete()}
            className={`w-full py-5 rounded-[1.5rem] font-bold text-lg flex items-center justify-center gap-3 transition-all duration-300 shadow-lg ${isAllComplete()
              ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/25 active:scale-[0.98]'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed grayscale'
              }`}
          >
            {isAllComplete() && <Check className="w-6 h-6 stroke-[3]" />}
            {isAllComplete() ? 'Konfirmasi Pilihan Paket' : `Lengkapi ${sortedItems.filter(i => i.selection_type === 'flexible' && !isFlexibleComplete(i)).length} pilihan lagi`}
          </button>
        </div>
      </div>
    </div>
  );
}
