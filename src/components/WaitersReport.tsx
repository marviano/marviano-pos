'use client';

/**
 * Waiters Performance Report
 *
 * Displays aggregated performance metrics per waiter: items sold, revenue (net of refunds),
 * transaction count, average transaction value, and top-selling products.
 * Optional multi-product ("insentif") mode ranks by combined quantity sold for the ticked SKUs.
 * Uses GMT+7 (Asia/Jakarta) for date handling. Excludes cancelled items and deducts refunds.
 */

import { useState, useEffect, useCallback, Fragment, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  RefreshCw,
  Filter,
  Trophy,
  Package,
  Target,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

type TopProduct = {
  product_id: number;
  product_name: string;
  total_quantity: number;
  total_revenue: number;
};

type WaiterRow = {
  waiter_id: number;
  waiter_name: string;
  color: string | null;
  total_items_sold: number;
  total_revenue: number;
  transaction_count: number;
  avg_transaction_value: number;
  rank: number;
  top_products: TopProduct[];
};

type ReportData = {
  waiters: WaiterRow[];
  topProductsLimit: number;
  rankByQuantity?: boolean;
};

type ProductOption = { id: number; nama: string };

const formatRupiah = (amount: number): string => {
  if (isNaN(amount) || amount === null || amount === undefined) {
    return 'Rp 0';
  }
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDateInput = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function WaitersReport() {
  const { user } = useAuth();
  const businessId = user?.selectedBusinessId;

  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [report, setReport] = useState<ReportData>({ waiters: [], topProductsLimit: 5, rankByQuantity: false });
  const [isLoading, setIsLoading] = useState(false);
  const [expandedWaiterId, setExpandedWaiterId] = useState<number | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'product'>('all');
  /** Product IDs selected for incentive mode (order not significant). */
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState<ProductOption[]>([]);

  useEffect(() => {
    const gmt7Offset = 7 * 60 * 60 * 1000;
    const now = new Date();
    const nowGmt7 = new Date(now.getTime() + gmt7Offset);
    const end = new Date(nowGmt7);
    const start = new Date(nowGmt7);
    start.setUTCDate(start.getUTCDate() - 30);
    setEndDate(formatDateInput(end));
    setStartDate(formatDateInput(start));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = getElectronAPI();
      if (!businessId || !api?.localDbGetAllProducts) {
        if (!cancelled) setProducts([]);
        return;
      }
      try {
        const raw = await api.localDbGetAllProducts(businessId);
        const arr = Array.isArray(raw) ? raw : [];
        const normalized: ProductOption[] = [];
        for (const row of arr) {
          const r = row as { id?: unknown; nama?: unknown };
          const id = typeof r.id === 'number' ? r.id : typeof r.id === 'string' ? parseInt(r.id, 10) : NaN;
          const nama = typeof r.nama === 'string' ? r.nama : '';
          if (Number.isFinite(id) && id > 0 && nama) normalized.push({ id, nama });
        }
        normalized.sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
        if (!cancelled) setProducts(normalized);
      } catch {
        if (!cancelled) setProducts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.nama.toLowerCase().includes(q));
  }, [products, productSearch]);

  const effectiveProductIds = useMemo(() => {
    if (filterMode !== 'product' || selectedProductIds.length === 0) return [] as number[];
    return [...new Set(selectedProductIds)].sort((a, b) => a - b);
  }, [filterMode, selectedProductIds]);

  const selectedProductsSummary = useMemo(() => {
    if (effectiveProductIds.length === 0) return { names: [] as string[], label: '' };
    const names = effectiveProductIds
      .map((id) => products.find((p) => p.id === id)?.nama)
      .filter((n): n is string => Boolean(n));
    const label =
      names.length <= 2
        ? names.join(', ')
        : `${names.slice(0, 2).join(', ')} +${names.length - 2} lainnya`;
    return { names, label };
  }, [effectiveProductIds, products]);

  const toggleProductChecked = useCallback((id: number, checked: boolean) => {
    setSelectedProductIds((prev) => {
      if (checked) {
        if (prev.includes(id)) return prev;
        return [...prev, id].sort((a, b) => a - b);
      }
      return prev.filter((x) => x !== id);
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedProductIds((prev) => {
      const merged = new Set(prev);
      for (const p of filteredProducts) merged.add(p.id);
      return [...merged].sort((a, b) => a - b);
    });
  }, [filteredProducts]);

  const clearProductSelection = useCallback(() => {
    setSelectedProductIds([]);
  }, []);

  useEffect(() => {
    if (filterMode === 'product' && selectedProductIds.length === 0) {
      setReport({ waiters: [], topProductsLimit: 5, rankByQuantity: false });
    }
  }, [filterMode, selectedProductIds.length]);

  const fetchReport = useCallback(async () => {
    if (!businessId || !startDate || !endDate) return;
    if (filterMode === 'product' && effectiveProductIds.length === 0) return;
    setIsLoading(true);
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetWaiterPerformanceReport) {
        setReport({ waiters: [], topProductsLimit: 5, rankByQuantity: false });
        return;
      }
      const result = (await electronAPI.localDbGetWaiterPerformanceReport({
        businessId,
        startDate,
        endDate,
        productIds: filterMode === 'product' ? effectiveProductIds : undefined,
      })) as ReportData | null;
      setReport(
        result || {
          waiters: [],
          topProductsLimit: 5,
          rankByQuantity: filterMode === 'product' && effectiveProductIds.length > 0,
        }
      );
    } catch (error) {
      console.error('Error fetching waiter performance report:', error);
      setReport({
        waiters: [],
        topProductsLimit: 5,
        rankByQuantity: filterMode === 'product' && effectiveProductIds.length > 0,
      });
    } finally {
      setIsLoading(false);
    }
  }, [businessId, startDate, endDate, filterMode, effectiveProductIds]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const applyPreset = (preset: 'today' | 'week' | 'month') => {
    const gmt7Offset = 7 * 60 * 60 * 1000;
    const now = new Date();
    const nowGmt7 = new Date(now.getTime() + gmt7Offset);
    const end = new Date(nowGmt7);
    const start = new Date(nowGmt7);

    if (preset === 'today') {
      start.setUTCDate(start.getUTCDate());
    } else if (preset === 'week') {
      start.setUTCDate(start.getUTCDate() - 6);
    } else {
      start.setUTCMonth(start.getUTCMonth() - 1);
    }
    setStartDate(formatDateInput(start));
    setEndDate(formatDateInput(end));
  };

  const rankByQty = !!(report.rankByQuantity ?? effectiveProductIds.length > 0);
  const colCount = rankByQty ? 6 : 8;

  const exportToCSV = () => {
    const qtyHeader =
      rankByQty && selectedProductsSummary.names.length > 0
        ? `Qty (${selectedProductsSummary.names.length === 1 ? selectedProductsSummary.names[0] : `${selectedProductsSummary.names.length} produk`})`
        : rankByQty
          ? 'Qty (produk terpilih)'
          : 'Items Sold';
    const headers = [
      'Rank',
      'Waiter',
      qtyHeader,
      'Revenue',
      'Transactions',
      'Avg Transaction',
      ...(rankByQty ? [] : ['Top Products']),
    ];
    const rows = report.waiters.map((w) => [
      w.rank,
      w.waiter_name,
      w.total_items_sold,
      w.total_revenue,
      w.transaction_count,
      w.avg_transaction_value.toFixed(0),
      ...(rankByQty
        ? []
        : [w.top_products.map((p) => `${p.product_name} (${p.total_quantity})`).join('; ')]),
    ]);
    const meta =
      rankByQty && selectedProductsSummary.names.length > 0
        ? `# Incentive mode — products (${selectedProductsSummary.names.length}): ${selectedProductsSummary.names.join('; ')}\n`
        : '';
    const csvContent = [
      meta + headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const slug =
      rankByQty && selectedProductsSummary.names.length > 0
        ? `_produk_${selectedProductsSummary.names[0].slice(0, 16).replace(/[^\w]+/g, '_')}_n${selectedProductsSummary.names.length}`
        : '';
    link.download = `waiters_report${slug}_${startDate}_${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (!businessId) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700">No business selected. Please log in and select a business.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
      {/* Filters */}
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="bg-gray-50 rounded-lg p-3 space-y-3">
          {/* Line 1: Mode | Date picker & filter | Searchbox + buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600">Mode</span>
              <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden bg-white">
                <button
                  type="button"
                  onClick={() => {
                    setFilterMode('all');
                    setExpandedWaiterId(null);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    filterMode === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Semua pendapatan
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilterMode('product');
                    setExpandedWaiterId(null);
                  }}
                  className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-200 ${
                    filterMode === 'product'
                      ? 'bg-amber-600 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Target className="w-3.5 h-3.5" />
                  Produk pilihan (insentif)
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
              <div className="min-w-0 max-w-[130px]">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                />
              </div>
              <div className="min-w-0 max-w-[130px]">
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                />
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => applyPreset('today')}
                  className="px-2.5 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition-colors"
                >
                  Hari Ini
                </button>
                <button
                  onClick={() => applyPreset('week')}
                  className="px-2.5 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition-colors"
                >
                  Minggu Ini
                </button>
                <button
                  onClick={() => applyPreset('month')}
                  className="px-2.5 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition-colors"
                >
                  Bulan Ini
                </button>
              </div>
              <button
                onClick={fetchReport}
                disabled={isLoading || (filterMode === 'product' && effectiveProductIds.length === 0)}
                className="flex items-center justify-center min-w-8 px-2 py-1.5 text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={exportToCSV}
                disabled={report.waiters.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            </div>

          </div>

          {/* Line 2: 3-column tickbox produk */}
          {filterMode === 'product' && (
            <div className="border border-gray-200 rounded-lg bg-white shadow-inner overflow-hidden">
              <div className="p-2 border-b border-gray-100 bg-white">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    placeholder="Cari produk…"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="min-w-[180px] flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs text-gray-900"
                  />
                  <span className="text-xs text-gray-600 whitespace-nowrap">
                    {selectedProductIds.length} dipilih
                  </span>
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    disabled={filteredProducts.length === 0}
                    className="px-2 py-1 text-[10px] font-medium rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Centang hasil filter
                  </button>
                  <button
                    type="button"
                    onClick={clearProductSelection}
                    disabled={selectedProductIds.length === 0}
                    className="px-2 py-1 text-[10px] font-medium rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Kosongkan
                  </button>
                </div>
              </div>

              <div className="p-2 max-h-[168px] overflow-y-auto">
                {filteredProducts.length === 0 ? (
                  <p className="px-3 py-6 text-xs text-gray-500 text-center">Tidak ada produk cocok.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4">
                    {filteredProducts.map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-amber-50/50 cursor-pointer text-xs text-gray-900"
                      >
                        <input
                          type="checkbox"
                          checked={selectedProductIds.includes(p.id)}
                          onChange={(e) => toggleProductChecked(p.id, e.target.checked)}
                          className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                        />
                        <span className="flex-1 min-w-0 truncate" title={p.nama}>
                          {p.nama}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-900 font-semibold border-b border-gray-200">
              <tr>
                {!rankByQty && <th className="w-10 px-2 py-3"></th>}
                <th className="px-3 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                  #
                </th>
                <th className="px-3 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                  Waiter
                </th>
                <th className="px-3 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider text-right">
                  {rankByQty
                    ? effectiveProductIds.length > 1
                      ? 'Qty gabungan'
                      : 'Qty produk'
                    : 'Items'}
                </th>
                <th className="px-3 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider text-right">
                  Revenue
                </th>
                <th className="px-3 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider text-right">
                  Transaksi
                </th>
                <th className="px-3 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider text-right">
                  Rata-rata
                </th>
                {!rankByQty && (
                  <th className="px-3 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                    Top Products
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filterMode === 'product' && effectiveProductIds.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center justify-center text-gray-500">
                      <Target className="w-12 h-12 mb-3 text-amber-300" />
                      <p className="font-medium">Centang satu atau lebih produk</p>
                      <p className="text-sm mt-1 max-w-md">
                        Peringkat waiter mengikuti <strong>jumlah gabungan</strong> semua produk yang Anda centang
                        (bisa beberapa sekaligus, misalnya beberapa menu utama promo).
                      </p>
                    </div>
                  </td>
                </tr>
              ) : isLoading ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-12 text-center">
                    <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-2" />
                    <p className="text-gray-600">Loading...</p>
                  </td>
                </tr>
              ) : report.waiters.length > 0 ? (
                report.waiters.map((waiter) => (
                  <Fragment key={waiter.waiter_id}>
                    <tr
                      className={`hover:bg-blue-50 transition-colors ${!rankByQty ? 'cursor-pointer' : ''}`}
                      onClick={() => {
                        if (rankByQty) return;
                        setExpandedWaiterId(expandedWaiterId === waiter.waiter_id ? null : waiter.waiter_id);
                      }}
                    >
                      {!rankByQty && (
                        <td className="px-2 py-3">
                          {waiter.top_products.length > 0 ? (
                            expandedWaiterId === waiter.waiter_id ? (
                              <ChevronDown className="w-4 h-4 text-gray-500" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-500" />
                            )
                          ) : null}
                        </td>
                      )}
                      <td className="px-3 py-3 whitespace-nowrap">
                        {waiter.rank === 1 ? (
                          <span
                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium ${
                              rankByQty
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            <Trophy className="w-3 h-3" />
                            {waiter.rank}
                          </span>
                        ) : waiter.rank <= 3 ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                            {waiter.rank}
                          </span>
                        ) : (
                          <span className="text-gray-500 text-xs">{waiter.rank}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium text-white shrink-0"
                            style={{
                              backgroundColor: waiter.color || '#6b7280',
                            }}
                          >
                            {waiter.waiter_name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-gray-900">{waiter.waiter_name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-medium text-gray-900">
                        {waiter.total_items_sold}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-green-700">
                        {formatRupiah(waiter.total_revenue)}
                      </td>
                      <td className="px-3 py-3 text-right text-gray-900">
                        {waiter.transaction_count}
                      </td>
                      <td className="px-3 py-3 text-right text-gray-700">
                        {formatRupiah(waiter.avg_transaction_value)}
                      </td>
                      {!rankByQty && (
                        <td className="px-3 py-3 text-gray-600 text-xs max-w-[200px] truncate">
                          {waiter.top_products.length > 0
                            ? waiter.top_products.map((p) => p.product_name).join(', ')
                            : '-'}
                        </td>
                      )}
                    </tr>
                    {!rankByQty &&
                      expandedWaiterId === waiter.waiter_id &&
                      waiter.top_products.length > 0 && (
                        <tr className="bg-gray-50">
                          <td colSpan={8} className="px-6 py-4">
                            <div className="flex items-start gap-6">
                              <div className="flex-1 min-w-0">
                                <h4 className="text-xs font-semibold text-gray-700 uppercase mb-2 flex items-center gap-1">
                                  <Package className="w-3.5 h-3.5" />
                                  Top Products
                                </h4>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-gray-500">
                                      <th className="text-left py-1">Product</th>
                                      <th className="text-right py-1">Qty</th>
                                      <th className="text-right py-1">Revenue</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {waiter.top_products.map((p) => (
                                      <tr key={p.product_id} className="border-t border-gray-100">
                                        <td className="py-1.5 text-gray-900">{p.product_name}</td>
                                        <td className="py-1.5 text-right text-gray-700">
                                          {p.total_quantity}
                                        </td>
                                        <td className="py-1.5 text-right font-medium text-green-700">
                                          {formatRupiah(p.total_revenue)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                  </Fragment>
                ))
              ) : (
                <tr>
                  <td colSpan={colCount} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center justify-center text-gray-500">
                      <Filter className="w-12 h-12 mb-3 text-gray-300" />
                      <p className="font-medium">Tidak ada data waiter</p>
                      <p className="text-sm mt-1 max-w-md text-center">
                        {rankByQty && selectedProductsSummary.names.length > 0
                          ? `Belum ada penjualan untuk produk terpilih (${selectedProductsSummary.names.join(', ')}) dengan waiter pada baris item, atau tidak ada transaksi selesai di periode ini.`
                          : 'Pilih rentang tanggal dan pastikan ada transaksi selesai dengan item yang memiliki waiter.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
