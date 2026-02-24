'use client';

/**
 * Product Sales Report (Laporan Penjualan)
 * Shows product-level quantity and revenue for a date range, broken down by sales platform.
 * Export to .xlsx via SheetJS. Only completed/paid transactions; cancelled items excluded.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Calendar, Download, RefreshCw, FileText } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { appAlert } from '@/components/AppDialog';
import * as XLSX from 'xlsx';

// Raw product sale row from localDbGetProductSales (per product per platform)
interface ProductSaleRow {
  product_id: number;
  product_name: string;
  product_code: string;
  platform: string;
  transaction_type: string;
  total_quantity: number;
  total_subtotal: number;
  customization_subtotal?: number;
  base_subtotal?: number;
  base_unit_price?: number;
  is_bundle_item?: boolean;
}

// Aggregated row: one per product with totals and per-platform quantities
export interface ProductSalesAggregate {
  product_id: number;
  product_name: string;
  product_code: string;
  total_quantity: number;
  total_revenue: number;
  platform_qty: Record<string, number>;
}

const PLATFORM_LABELS: Record<string, string> = {
  offline: 'Offline',
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopeefood: 'ShopeeFood',
  qpon: 'Qpon',
  tiktok: 'TikTok',
};

const PLATFORM_ORDER = ['offline', 'gofood', 'grabfood', 'shopeefood', 'qpon', 'tiktok'];

function formatPlatformLabel(platform: string): string {
  const key = (platform || 'offline').toLowerCase();
  return PLATFORM_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

const formatRupiah = (amount: number): string => {
  if (isNaN(amount) || amount == null) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

function getTodayUTC7(): string {
  const now = new Date();
  const utc7Offset = 7 * 60 * 60 * 1000;
  const utc7Time = new Date(now.getTime() + utc7Offset);
  const year = utc7Time.getUTCFullYear();
  const month = String(utc7Time.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc7Time.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function aggregateProductSales(products: ProductSaleRow[]): ProductSalesAggregate[] {
  const byProduct = new Map<
    number,
    { product_name: string; product_code: string; total_quantity: number; total_revenue: number; platform_qty: Record<string, number> }
  >();

  for (const p of products) {
    const id = p.product_id;
    const platform = (p.platform || 'offline').toLowerCase();
    const qty = Number(p.total_quantity) || 0;
    const revenue = Number(p.total_subtotal) || 0;

    const existing = byProduct.get(id);
    if (existing) {
      existing.total_quantity += qty;
      existing.total_revenue += revenue;
      existing.platform_qty[platform] = (existing.platform_qty[platform] ?? 0) + qty;
    } else {
      byProduct.set(id, {
        product_name: p.product_name ?? '',
        product_code: p.product_code ?? '',
        total_quantity: qty,
        total_revenue: revenue,
        platform_qty: { [platform]: qty },
      });
    }
  }

  return Array.from(byProduct.entries())
    .map(([product_id, data]) => ({
      product_id,
      product_name: data.product_name,
      product_code: data.product_code,
      total_quantity: data.total_quantity,
      total_revenue: data.total_revenue,
      platform_qty: data.platform_qty,
    }))
    .sort((a, b) => b.total_quantity - a.total_quantity);
}

/** Collect all platform keys that appear in aggregates, in PLATFORM_ORDER then rest. */
function getOrderedPlatforms(aggregates: ProductSalesAggregate[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of PLATFORM_ORDER) {
    const has = aggregates.some((a) => (a.platform_qty[key] ?? 0) > 0);
    if (has && !seen.has(key)) {
      result.push(key);
      seen.add(key);
    }
  }
  aggregates.forEach((a) => {
    Object.keys(a.platform_qty).forEach((k) => {
      if (!seen.has(k)) {
        result.push(k);
        seen.add(k);
      }
    });
  });
  return result;
}

export default function ProductSalesReport() {
  const { user } = useAuth();
  const businessId = user?.selectedBusinessId;

  const [startDate, setStartDate] = useState(getTodayUTC7);
  const [endDate, setEndDate] = useState(getTodayUTC7);
  const [rawProducts, setRawProducts] = useState<ProductSaleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  const fetchReport = useCallback(async () => {
    if (!businessId || !startDate || !endDate) return;
    setLoading(true);
    setHasFetched(true);
    try {
      const api = getElectronAPI();
      if (!api?.localDbGetProductSales) {
        appAlert('Export/API tidak tersedia. Jalankan di aplikasi Electron.');
        return;
      }
      const startDateTime = `${startDate}T00:00:00`;
      const endDateTime = `${endDate}T23:59:59`;
      const result = await api.localDbGetProductSales(null, startDateTime, endDateTime, businessId);
      const list = (result?.products ?? []) as ProductSaleRow[];
      setRawProducts(list);
    } catch (e) {
      console.error('Product sales fetch error:', e);
      appAlert('Gagal memuat laporan penjualan.');
      setRawProducts([]);
    } finally {
      setLoading(false);
    }
  }, [businessId, startDate, endDate]);

  useEffect(() => {
    if (businessId && startDate && endDate) fetchReport();
  }, [businessId, startDate, endDate, fetchReport]);

  const aggregates = useMemo(() => aggregateProductSales(rawProducts), [rawProducts]);
  const orderedPlatforms = useMemo(() => getOrderedPlatforms(aggregates), [aggregates]);

  const handleExportExcel = useCallback(() => {
    if (aggregates.length === 0) {
      appAlert('Tidak ada data untuk diekspor.');
      return;
    }
    try {
      const headers = ['No', 'Produk', 'Kode', 'Total Qty', 'Total Revenue'];
      orderedPlatforms.forEach((p) => headers.push(formatPlatformLabel(p)));

      const rows = aggregates.map((row, idx) => {
        const r: (string | number)[] = [
          idx + 1,
          row.product_name,
          row.product_code,
          row.total_quantity,
          row.total_revenue,
        ];
        orderedPlatforms.forEach((platform) => {
          r.push(row.platform_qty[platform] ?? 0);
        });
        return r;
      });

      const wsData = [headers, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      const colWidths = [
        { wch: 5 },
        { wch: 30 },
        { wch: 12 },
        { wch: 10 },
        { wch: 16 },
        ...orderedPlatforms.map(() => ({ wch: 10 })),
      ];
      ws['!cols'] = colWidths;

      const wb = XLSX.utils.book_new();
      const sheetName = 'Laporan Penjualan';
      XLSX.utils.book_append_sheet(wb, ws, sheetName);

      const fileName = `Laporan_Penjualan_${startDate}_${endDate}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (e) {
      console.error('Export error:', e);
      appAlert('Gagal mengekspor ke Excel.');
    }
  }, [aggregates, orderedPlatforms, startDate, endDate]);

  if (!businessId) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700">Tidak ada bisnis dipilih. Silakan masuk dan pilih bisnis.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden min-h-0">
      {/* Filters */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center border border-gray-300 rounded-lg bg-gray-50/50 overflow-hidden">
          <span className="flex items-center gap-1.5 pl-3 pr-2 py-2 text-sm text-gray-600">
            <Calendar className="w-4 h-4 text-gray-400" />
            <span>Dari</span>
          </span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-transparent border-0 py-2 pr-3 pl-1 text-sm text-black focus:ring-0 focus:outline-none min-w-0 [color-scheme:light]"
          />
          <span className="text-gray-300 select-none">|</span>
          <span className="pl-2 pr-1 py-2 text-sm text-gray-600">Sampai</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-transparent border-0 py-2 pl-1 pr-3 text-sm text-black focus:ring-0 focus:outline-none min-w-0 [color-scheme:light]"
          />
        </div>
        <button
          onClick={fetchReport}
          disabled={loading || !startDate || !endDate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Memuat...' : 'Muat Laporan'}</span>
        </button>
        <button
          onClick={handleExportExcel}
          disabled={loading || aggregates.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          <span>Export Sheet</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap items-center gap-3">
            <FileText className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-900">Laporan Penjualan Produk</h3>
            {aggregates.length > 0 && (
              <span className="text-base font-semibold text-gray-700">
                Total Omset: {formatRupiah(aggregates.reduce((sum, r) => sum + r.total_revenue, 0))}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            {loading && !hasFetched ? (
              <div className="p-8 text-center text-gray-500">Memuat data...</div>
            ) : aggregates.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                {hasFetched ? 'Tidak ada penjualan untuk rentang tanggal ini.' : 'Pilih tanggal dan klik Muat Laporan.'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700 w-12">No</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Produk</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Kode</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">Total Qty</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">Total Revenue</th>
                    {orderedPlatforms.map((p) => (
                      <th key={p} className="text-right py-3 px-4 font-semibold text-gray-700">
                        {formatPlatformLabel(p)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {aggregates.map((row, idx) => (
                    <tr key={row.product_id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-4 text-gray-600">{idx + 1}</td>
                      <td className="py-2 px-4 font-medium text-gray-900">{row.product_name}</td>
                      <td className="py-2 px-4 text-gray-600">{row.product_code}</td>
                      <td className="py-2 px-4 text-right font-medium text-gray-900">{row.total_quantity}</td>
                      <td className="py-2 px-4 text-right text-gray-900">{formatRupiah(row.total_revenue)}</td>
                      {orderedPlatforms.map((platform) => (
                        <td key={platform} className="py-2 px-4 text-right text-gray-600">
                          {row.platform_qty[platform] ?? '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
