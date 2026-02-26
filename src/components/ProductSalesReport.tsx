'use client';

/**
 * Product Sales Report (Laporan Penjualan)
 * Shows product-level quantity and revenue for a date range, broken down by sales platform.
 * Export to .xlsx via SheetJS. Only completed/paid transactions; cancelled items excluded.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Calendar, FileText, Download, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { appAlert } from '@/components/AppDialog';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Raw product sale row from localDbGetProductSales (per product per platform)
interface ProductSaleRow {
  product_id: number;
  product_name: string;
  product_code: string;
  category1_id?: number | null;
  category1_name?: string;
  platform: string;
  transaction_type: string;
  total_quantity: number;
  total_subtotal: number;
  total_subtotal_after_refund?: number;
  customization_subtotal?: number;
  base_subtotal?: number;
  base_unit_price?: number;
  is_bundle_item?: boolean;
}

// Aggregated row: one per product with totals, per-platform quantity and per-platform revenue (omset)
export interface ProductSalesAggregate {
  product_id: number;
  product_name: string;
  product_code: string;
  category1_id: number | null;
  category1_name: string;
  total_quantity: number;
  total_revenue: number;
  platform_qty: Record<string, number>;
  platform_revenue: Record<string, number>;
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

/** Load image from data URI and return natural dimensions (pixels). */
function getImageDimensions(dataUri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUri;
  });
}

function getTodayUTC7(): string {
  const now = new Date();
  const utc7Offset = 7 * 60 * 60 * 1000;
  const utc7Time = new Date(now.getTime() + utc7Offset);
  const year = utc7Time.getUTCFullYear();
  const month = String(utc7Time.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc7Time.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getYesterdayUTC7(): string {
  const now = new Date();
  const utc7Offset = 7 * 60 * 60 * 1000;
  const utc7Time = new Date(now.getTime() + utc7Offset);
  const yesterday = new Date(Date.UTC(utc7Time.getUTCFullYear(), utc7Time.getUTCMonth(), utc7Time.getUTCDate() - 1));
  const y = yesterday.getUTCFullYear();
  const m = String(yesterday.getUTCMonth() + 1).padStart(2, '0');
  const d = String(yesterday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getFirstDayOfMonthUTC7(): string {
  const now = new Date();
  const utc7Offset = 7 * 60 * 60 * 1000;
  const utc7Time = new Date(now.getTime() + utc7Offset);
  const year = utc7Time.getUTCFullYear();
  const month = String(utc7Time.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

const UNCATEGORIZED_LABEL = 'Tanpa Kategori';

function aggregateProductSales(products: ProductSaleRow[]): ProductSalesAggregate[] {
  const byProduct = new Map<
    number,
    {
      product_name: string;
      product_code: string;
      category1_id: number | null;
      category1_name: string;
      total_quantity: number;
      total_revenue: number;
      platform_qty: Record<string, number>;
      platform_revenue: Record<string, number>;
    }
  >();

  for (const p of products) {
    const id = p.product_id;
    const platform = (p.platform || 'offline').toLowerCase();
    const qty = Number(p.total_quantity) || 0;
    const revenue = Number(p.total_subtotal) || 0;
    const cat1Id = p.category1_id != null ? p.category1_id : null;
    const cat1Name =
      p.category1_name != null && String(p.category1_name).trim() !== '' ? String(p.category1_name) : UNCATEGORIZED_LABEL;

    const existing = byProduct.get(id);
    if (existing) {
      existing.total_quantity += qty;
      existing.total_revenue += revenue;
      existing.platform_qty[platform] = (existing.platform_qty[platform] ?? 0) + qty;
      existing.platform_revenue[platform] = (existing.platform_revenue[platform] ?? 0) + revenue;
    } else {
      byProduct.set(id, {
        product_name: p.product_name ?? '',
        product_code: p.product_code ?? '',
        category1_id: cat1Id,
        category1_name: cat1Name,
        total_quantity: qty,
        total_revenue: revenue,
        platform_qty: { [platform]: qty },
        platform_revenue: { [platform]: revenue },
      });
    }
  }

  return Array.from(byProduct.entries())
    .map(([product_id, data]) => ({
      product_id,
      product_name: data.product_name,
      product_code: data.product_code,
      category1_id: data.category1_id,
      category1_name: data.category1_name,
      total_quantity: data.total_quantity,
      total_revenue: data.total_revenue,
      platform_qty: data.platform_qty,
      platform_revenue: data.platform_revenue,
    }))
    .sort((a, b) => b.total_quantity - a.total_quantity);
}

/** Collect all platform keys that appear in aggregates (by qty or revenue), in PLATFORM_ORDER then rest. */
function getOrderedPlatforms(aggregates: ProductSalesAggregate[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of PLATFORM_ORDER) {
    const hasQty = aggregates.some((a) => (a.platform_qty[key] ?? 0) > 0);
    const hasRevenue = aggregates.some((a) => (a.platform_revenue[key] ?? 0) > 0);
    if ((hasQty || hasRevenue) && !seen.has(key)) {
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
    Object.keys(a.platform_revenue).forEach((k) => {
      if (!seen.has(k)) {
        result.push(k);
        seen.add(k);
      }
    });
  });
  return result;
}

/** Group aggregates by Category 1; "Tanpa Kategori" pinned first, then rest by name. */
function groupAggregatesByCategory1(aggregates: ProductSalesAggregate[]): Array<{ category1_name: string; category1_id: number | null; rows: ProductSalesAggregate[] }> {
  const byCat = new Map<string, ProductSalesAggregate[]>();
  for (const row of aggregates) {
    const name = row.category1_name || UNCATEGORIZED_LABEL;
    const list = byCat.get(name) ?? [];
    list.push(row);
    byCat.set(name, list);
  }
  const uncategorized = byCat.get(UNCATEGORIZED_LABEL) ?? [];
  const rest = Array.from(byCat.entries())
    .filter(([name]) => name !== UNCATEGORIZED_LABEL)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category1_name, rows]) => ({
      category1_name,
      category1_id: rows[0]?.category1_id ?? null,
      rows,
    }));
  const result: Array<{ category1_name: string; category1_id: number | null; rows: ProductSalesAggregate[] }> = [];
  if (uncategorized.length > 0) {
    result.push({ category1_name: UNCATEGORIZED_LABEL, category1_id: null, rows: uncategorized });
  }
  result.push(...rest);
  return result;
}

export default function ProductSalesReport() {
  const { user } = useAuth();
  const businessId = user?.selectedBusinessId;

  const [startDate, setStartDate] = useState(getTodayUTC7);
  const [endDate, setEndDate] = useState(getTodayUTC7);
  const [rawProducts, setRawProducts] = useState<ProductSaleRow[]>([]);
  const [totalRefundOmset, setTotalRefundOmset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [groupByCategory1, setGroupByCategory1] = useState(true);

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
      const [result, refundTotal] = await Promise.all([
        api.localDbGetProductSales(null, startDateTime, endDateTime, businessId),
        api.localDbGetRefundTotal?.(businessId, startDateTime, endDateTime) ?? Promise.resolve(0),
      ]);
      const list = (result?.products ?? []) as ProductSaleRow[];
      setRawProducts(list);
      const refundValue = typeof refundTotal === 'number' ? refundTotal : 0;
      setTotalRefundOmset(refundValue);
    } catch (e) {
      console.error('Product sales fetch error:', e);
      appAlert('Gagal memuat laporan penjualan.');
      setRawProducts([]);
      setTotalRefundOmset(0);
    } finally {
      setLoading(false);
    }
  }, [businessId, startDate, endDate]);

  useEffect(() => {
    if (businessId && startDate && endDate) fetchReport();
  }, [businessId, startDate, endDate, fetchReport]);

  const aggregates = useMemo(() => aggregateProductSales(rawProducts), [rawProducts]);
  const orderedPlatforms = useMemo(() => getOrderedPlatforms(aggregates), [aggregates]);

  /** Per-platform total revenue (main report header breakdown only). */
  const mainPlatformRevenue = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of aggregates) {
      for (const [platform, rev] of Object.entries(a.platform_revenue)) {
        out[platform] = (out[platform] ?? 0) + rev;
      }
    }
    return out;
  }, [aggregates]);

  const totalOmsetAll = useMemo(() => aggregates.reduce((sum, r) => sum + r.total_revenue, 0), [aggregates]);
  const totalOmsetAfterRefund = useMemo(
    () => rawProducts.reduce((sum, r) => sum + (Number(r.total_subtotal_after_refund) || 0), 0),
    [rawProducts]
  );
  const totalDiscountOmset = useMemo(
    () => Math.max(0, totalOmsetAll - totalOmsetAfterRefund),
    [totalOmsetAll, totalOmsetAfterRefund]
  );

  const handleExportExcel = useCallback(() => {
    if (aggregates.length === 0) {
      appAlert('Tidak ada data untuk diekspor.');
      return;
    }
    try {
      const headers = ['No', 'Produk', 'Qty', 'Revenue'];
      orderedPlatforms.forEach((p) => headers.push(formatPlatformLabel(p)));

      const wb = XLSX.utils.book_new();

      // Always export by Kategori 1: one sheet per category (same as on-screen grouped view)
      // Numbers exported as rounded integers (no decimals), e.g. 1000000
      const groups = groupAggregatesByCategory1(aggregates);
      for (const group of groups) {
        const rows = group.rows.map((row, idx) => {
          const r: (string | number)[] = [
            idx + 1,
            row.product_name,
            Math.round(Number(row.total_quantity) || 0),
            Math.round(Number(row.total_revenue) || 0),
          ];
          orderedPlatforms.forEach((platform) => {
            r.push(Math.round(Number(row.platform_revenue[platform]) || 0));
          });
          return r;
        });
        const wsData = [headers, ...rows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const colWidths = [
          { wch: 5 },
          { wch: 30 },
          { wch: 10 },
          { wch: 16 },
          ...orderedPlatforms.map(() => ({ wch: 10 })),
        ];
        ws['!cols'] = colWidths;
        const sheetName = group.category1_name.slice(0, 31);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }

      const fileName = `Laporan_Penjualan_${startDate}_${endDate}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (e) {
      console.error('Export error:', e);
      appAlert('Gagal mengekspor ke Excel.');
    }
  }, [aggregates, orderedPlatforms, startDate, endDate]);

  const handleExportPdf = useCallback(async () => {
    if (aggregates.length === 0) {
      appAlert('Tidak ada data untuk diekspor.');
      return;
    }
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const margin = 14;
      const pageWidth = 210; // A4 width in mm
      let y = margin;

      // Title
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('Laporan Penjualan Produk', pageWidth / 2, y, { align: 'center' });
      y += 4;

      // Business logo (same source as receipt): scale by height only, preserve aspect ratio and resolution
      const api = getElectronAPI();
      if (businessId && api?.getReceiptSettings) {
        try {
          const result = await api.getReceiptSettings(businessId);
          const logoBase64 = result?.settings?.logo_base64?.trim();
          if (logoBase64) {
            const dims = await getImageDimensions(logoBase64);
            const targetHeightMm = 14;
            const targetWidthMm = targetHeightMm * (dims.width / dims.height);
            const logoX = (pageWidth - targetWidthMm) / 2;
            const format = /data:image\/jpe?g/i.test(logoBase64) ? 'JPEG' : 'PNG';
            doc.addImage(logoBase64, format, logoX, y, targetWidthMm, targetHeightMm);
            y += targetHeightMm + 4;
          }
        } catch {
          // ignore logo fetch error
        }
      }

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      doc.text(`Periode: ${startDate} s/d ${endDate}`, pageWidth / 2, y, { align: 'center' });
      doc.setTextColor(0, 0, 0);
      y += 14;

      const tableTheme = {
        headStyles: { fillColor: [41, 128, 185] as [number, number, number], textColor: 255, fontStyle: 'bold' as const, fontSize: 9 },
        bodyStyles: { fontSize: 8, textColor: [40, 40, 40] as [number, number, number] },
        alternateRowStyles: { fillColor: [245, 245, 245] as [number, number, number] },
        margin: { left: margin, right: margin },
        tableLineColor: [220, 220, 220] as [number, number, number],
        tableLineWidth: 0.2,
      };

      // Summary: two tables side by side
      const summaryStartY = y;
      const colWidth = (pageWidth - margin * 2) / 2;
      autoTable(doc, {
        startY: summaryStartY,
        head: [['Platform', 'Omset']],
        body: orderedPlatforms.map((p) => [formatPlatformLabel(p), formatRupiah(mainPlatformRevenue[p] ?? 0)]),
        theme: 'striped',
        ...tableTheme,
        tableWidth: colWidth - 8,
        columnStyles: { 0: { cellWidth: (colWidth - 8) * 0.4 }, 1: { cellWidth: (colWidth - 8) * 0.6, halign: 'right' } },
      });
      const afterPlatform = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? summaryStartY;

      const netOmset = Math.max(0, totalOmsetAfterRefund - totalRefundOmset);
      autoTable(doc, {
        startY: summaryStartY,
        head: [['Ringkasan', 'Jumlah']],
        body: [
          ['Gross', formatRupiah(totalOmsetAll)],
          ['Discount', totalDiscountOmset > 0 ? `-${formatRupiah(totalDiscountOmset)}` : formatRupiah(0)],
          ['Refund', totalRefundOmset > 0 ? `-${formatRupiah(totalRefundOmset)}` : formatRupiah(0)],
        ],
        foot: [['Net', formatRupiah(netOmset)]],
        theme: 'striped',
        ...tableTheme,
        margin: { left: margin + colWidth + 4, right: margin },
        footStyles: { fontStyle: 'bold' },
        tableWidth: colWidth - 8,
        columnStyles: { 0: { cellWidth: (colWidth - 8) * 0.45 }, 1: { cellWidth: (colWidth - 8) * 0.55, halign: 'left' } },
      });
      const afterRingkasan = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? summaryStartY;
      y = Math.max(afterPlatform, afterRingkasan) + 12;

      // Detail by category
      const groups = groupAggregatesByCategory1(aggregates);
      const detailHead = ['No', 'Produk', 'Qty', 'Revenue', ...orderedPlatforms.map((p) => formatPlatformLabel(p))];

      for (const group of groups) {
        const groupRevenue = group.rows.reduce((sum, r) => sum + r.total_revenue, 0);
        if (y > 260) {
          doc.addPage();
          y = margin;
        }
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(50, 50, 50);
        doc.text(group.category1_name, margin, y);
        doc.setFontSize(9);
        doc.text(`Total Omset: ${formatRupiah(groupRevenue)}`, pageWidth - margin, y, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        y += 6;

        const body = group.rows.map((row, idx) => [
          String(idx + 1),
          row.product_name,
          String(row.total_quantity),
          formatRupiah(row.total_revenue),
          ...orderedPlatforms.map((platform) =>
            (row.platform_revenue[platform] ?? 0) > 0 ? formatRupiah(row.platform_revenue[platform]) : '-'
          ),
        ]);
        const contentWidth = pageWidth - margin * 2;
        const numPlatformCols = orderedPlatforms.length;
        const fixedWidth = 8 + 42 + 14 + 24;
        const platformColWidth = (contentWidth - fixedWidth) / Math.max(1, numPlatformCols);
        autoTable(doc, {
          startY: y,
          head: [detailHead],
          body,
          theme: 'striped',
          ...tableTheme,
          tableWidth: contentWidth,
          columnStyles: {
            0: { cellWidth: 8, halign: 'center' },
            1: { cellWidth: 42, overflow: 'ellipsize' },
            2: { cellWidth: 14, halign: 'left' },
            3: { cellWidth: 24, halign: 'left' },
            ...Object.fromEntries(orderedPlatforms.map((_, i) => [String(4 + i), { cellWidth: platformColWidth, halign: 'left' }])),
          },
          showHead: 'everyPage',
        });
        y = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
        y += 10;
      }

      doc.save(`Laporan_Penjualan_${startDate}_${endDate}.pdf`);
    } catch (e) {
      console.error('PDF export error:', e);
      appAlert('Gagal mengekspor ke PDF.');
    }
  }, [
    businessId,
    aggregates,
    orderedPlatforms,
    startDate,
    endDate,
    mainPlatformRevenue,
    totalOmsetAll,
    totalOmsetAfterRefund,
    totalRefundOmset,
    totalDiscountOmset,
  ]);

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
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const today = getTodayUTC7();
              setStartDate(today);
              setEndDate(today);
            }}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            Hari ini
          </button>
          <button
            type="button"
            onClick={() => {
              const yesterday = getYesterdayUTC7();
              setStartDate(yesterday);
              setEndDate(yesterday);
            }}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            Kemarin
          </button>
          <button
            type="button"
            onClick={() => {
              setStartDate(getFirstDayOfMonthUTC7());
              setEndDate(getTodayUTC7());
            }}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            Bulan ini
          </button>
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
        <button
          onClick={handleExportPdf}
          disabled={loading || aggregates.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FileText className="w-4 h-4" />
          <span>Export PDF</span>
        </button>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-sm text-gray-600">Kelompokkan per Kategori 1</span>
          <button
            type="button"
            role="switch"
            aria-checked={groupByCategory1}
            onClick={() => setGroupByCategory1((v) => !v)}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
              groupByCategory1 ? 'border-blue-600 bg-blue-600' : 'border-gray-300 bg-gray-200'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                groupByCategory1 ? 'translate-x-5' : 'translate-x-0.5'
              }`}
              style={{ top: '2px' }}
            />
          </button>
        </label>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {/* Two summary cards: platform attribution + net revenue */}
        {aggregates.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 max-h-[13rem] md:max-h-[14rem]">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col min-h-0">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/80 shrink-0">
                <h3 className="text-sm font-semibold text-gray-700">Omset per Platform</h3>
              </div>
              <div className="px-4 py-3 flex-1 min-h-0 overflow-y-auto">
                <table className="text-sm border-collapse w-full">
                  <tbody>
                    {orderedPlatforms.map((p) => (
                      <tr key={p}>
                        <td className="text-gray-600 py-1 pr-3">{formatPlatformLabel(p)}</td>
                        <td className="text-gray-900 tabular-nums text-right whitespace-nowrap font-medium">{formatRupiah(mainPlatformRevenue[p] ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col min-h-0">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/80 shrink-0">
                <h3 className="text-sm font-semibold text-gray-700">Ringkasan Pendapatan</h3>
              </div>
              <div className="px-4 py-3 flex-1 min-h-0">
                <table className="text-sm border-collapse w-full">
                  <tbody>
                    <tr>
                      <td className="text-gray-600 py-1 pr-3">Gross</td>
                      <td className="font-medium text-gray-900 tabular-nums text-right whitespace-nowrap">{formatRupiah(totalOmsetAll)}</td>
                    </tr>
                    <tr>
                      <td className="text-gray-600 py-1 pr-3">Discount</td>
                      <td className="font-medium text-gray-900 tabular-nums text-right whitespace-nowrap">{totalDiscountOmset > 0 ? `-${formatRupiah(totalDiscountOmset)}` : formatRupiah(0)}</td>
                    </tr>
                    <tr>
                      <td className="text-gray-600 py-1 pr-3">Refund</td>
                      <td className="font-medium text-red-600 tabular-nums text-right whitespace-nowrap">{totalRefundOmset > 0 ? `-${formatRupiah(totalRefundOmset)}` : formatRupiah(0)}</td>
                    </tr>
                    <tr className="border-t border-gray-200">
                      <td className="font-semibold text-gray-700 py-1.5 pr-3">Net</td>
                      <td className="font-bold text-gray-900 py-1.5 tabular-nums text-right whitespace-nowrap">{formatRupiah(Math.max(0, totalOmsetAfterRefund - totalRefundOmset))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            {loading && !hasFetched ? (
              <div className="p-8 text-center text-gray-500">Memuat data...</div>
            ) : aggregates.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                {hasFetched ? 'Tidak ada penjualan untuk rentang tanggal ini.' : 'Pilih tanggal dan klik Muat Laporan.'}
              </div>
            ) : groupByCategory1 ? (
              <div className="divide-y divide-gray-200">
                {groupAggregatesByCategory1(aggregates).map((group) => {
                  const groupRevenue = group.rows.reduce((sum, r) => sum + r.total_revenue, 0);
                  return (
                    <div key={group.category1_name} className="py-4 first:pt-0">
                      <div className="px-6 pb-2 grid grid-cols-[1fr_auto] gap-4 items-center">
                        <h4 className="text-base font-semibold text-gray-800 min-w-0">{group.category1_name}</h4>
                        <span className="text-sm font-medium text-gray-600 text-right">
                          Total Omset: {formatRupiah(groupRevenue)}
                        </span>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="text-left py-3 px-4 font-semibold text-gray-700 w-12">No</th>
                            <th className="text-left py-3 px-4 font-semibold text-gray-700">Produk</th>
                            <th className="text-left py-3 px-4 font-semibold text-gray-700">Qty</th>
                            <th className="text-left py-3 px-4 font-semibold text-gray-700">Revenue</th>
                            {orderedPlatforms.map((p) => (
                              <th key={p} className="text-left py-3 px-4 font-semibold text-gray-700">
                                {formatPlatformLabel(p)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row, idx) => (
                            <tr key={row.product_id} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-2 px-4 text-gray-600">{idx + 1}</td>
                              <td className="py-2 px-4 font-medium text-gray-900">{row.product_name}</td>
                              <td className="py-2 px-4 text-left font-medium text-gray-900">{row.total_quantity}</td>
                              <td className="py-2 px-4 text-left text-gray-900">{formatRupiah(row.total_revenue)}</td>
                              {orderedPlatforms.map((platform) => (
                                <td key={platform} className="py-2 px-4 text-left text-gray-600">
                                  {(row.platform_revenue[platform] ?? 0) > 0
                                    ? formatRupiah(row.platform_revenue[platform])
                                    : '-'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700 w-12">No</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Produk</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Qty</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Revenue</th>
                    {orderedPlatforms.map((p) => (
                      <th key={p} className="text-left py-3 px-4 font-semibold text-gray-700">
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
                      <td className="py-2 px-4 text-left font-medium text-gray-900">{row.total_quantity}</td>
                      <td className="py-2 px-4 text-left text-gray-900">{formatRupiah(row.total_revenue)}</td>
                      {orderedPlatforms.map((platform) => (
                        <td key={platform} className="py-2 px-4 text-left text-gray-600">
                          {(row.platform_revenue[platform] ?? 0) > 0
                            ? formatRupiah(row.platform_revenue[platform])
                            : '-'}
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
