'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Search, RefreshCw, Filter, Clock3, CheckCircle2, CircleOff } from 'lucide-react';

type AuditRow = {
  id: number;
  event_at: string;
  event_type: string;
  display_type: 'kitchen' | 'barista';
  uuid_transaction_id: string;
  uuid_transaction_item_id: string;
  product_name: string | null;
  customer_name: string | null;
  table_number: string | null;
  detail_json: string | null;
  receipt_number: number | null;
  tx_status: string | null;
  production_status: string | null;
  cancelled_at: string | null;
};

const EVENT_STYLE: Record<string, string> = {
  active_shown: 'bg-green-100 text-green-700',
  finished_shown: 'bg-emerald-100 text-emerald-700',
  marked_finished: 'bg-blue-100 text-blue-700',
  excluded_cancelled: 'bg-red-100 text-red-700',
  excluded_category: 'bg-amber-100 text-amber-700',
  excluded_no_product: 'bg-gray-200 text-gray-700',
};

const EVENT_LABEL: Record<string, string> = {
  active_shown: 'Active Shown',
  finished_shown: 'Finished Shown',
  marked_finished: 'Marked Finished',
  excluded_cancelled: 'Excluded Cancelled',
  excluded_category: 'Excluded Category',
  excluded_no_product: 'Excluded No Product',
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('id-ID', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

const todayLocal = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export default function KdsAuditLogPage() {
  const { user } = useAuth();
  const businessId = user?.selectedBusinessId;
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateFilter, setDateFilter] = useState<string>(todayLocal());
  const [eventType, setEventType] = useState<string>('all');
  const [keyword, setKeyword] = useState<string>('');

  const loadData = useCallback(async () => {
    if (!businessId) return;
    const api = window.electronAPI;
    if (!api?.localDbGetKdsAuditLogs) return;

    setLoading(true);
    try {
      const result = await api.localDbGetKdsAuditLogs({
        businessId,
        date: dateFilter || undefined,
        eventType: eventType === 'all' ? undefined : eventType,
        keyword: keyword.trim() || undefined,
        limit: 500,
      });
      setRows(Array.isArray(result) ? (result as AuditRow[]) : []);
    } catch (error) {
      console.error('Failed to load KDS audit logs:', error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [businessId, dateFilter, eventType, keyword]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const summary = useMemo(() => {
    const itemState = new Map<string, { shown: boolean; excluded: boolean }>();
    for (const r of rows) {
      const key = r.uuid_transaction_item_id;
      const prev = itemState.get(key) ?? { shown: false, excluded: false };
      if (r.event_type === 'active_shown' || r.event_type === 'finished_shown') prev.shown = true;
      if (r.event_type.startsWith('excluded_')) prev.excluded = true;
      itemState.set(key, prev);
    }
    let shown = 0;
    let excludedOnly = 0;
    itemState.forEach((v) => {
      if (v.shown) shown += 1;
      else if (v.excluded) excludedOnly += 1;
    });
    return {
      totalEvents: rows.length,
      totalItems: itemState.size,
      shownItems: shown,
      excludedOnlyItems: excludedOnly,
    };
  }, [rows]);

  return (
    <div className="flex-1 p-4 md:p-6 overflow-y-auto bg-slate-50">
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-slate-800">Log Daftar Transaksi</h2>
        <p className="text-sm text-slate-600">Audit alur item Kitchen Display: shown / excluded / finished.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-lg border p-3">
          <div className="text-xs text-slate-500">Total Event</div>
          <div className="text-xl font-bold text-slate-800">{summary.totalEvents}</div>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <div className="text-xs text-slate-500">Total Item</div>
          <div className="text-xl font-bold text-slate-800">{summary.totalItems}</div>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <div className="text-xs text-slate-500">Shown on Kitchen</div>
          <div className="text-xl font-bold text-green-700">{summary.shownItems}</div>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <div className="text-xs text-slate-500">Excluded Only</div>
          <div className="text-xl font-bold text-amber-700">{summary.excludedOnlyItems}</div>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-3 mb-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="border rounded-md px-2 py-1.5 text-sm"
          >
            <option value="all">Semua Event</option>
            <option value="active_shown">active_shown</option>
            <option value="finished_shown">finished_shown</option>
            <option value="marked_finished">marked_finished</option>
            <option value="excluded_cancelled">excluded_cancelled</option>
            <option value="excluded_category">excluded_category</option>
            <option value="excluded_no_product">excluded_no_product</option>
          </select>
          <div className="flex items-center gap-2 flex-1">
            <Search className="w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Cari receipt/product/customer/table"
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={() => void loadData()}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">Waktu</th>
                <th className="text-left px-3 py-2">Receipt</th>
                <th className="text-left px-3 py-2">Product</th>
                <th className="text-left px-3 py-2">Event</th>
                <th className="text-left px-3 py-2">Visibility</th>
                <th className="text-left px-3 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                    Tidak ada data log untuk filter ini.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const shown =
                  r.event_type === 'active_shown' ||
                  r.event_type === 'finished_shown' ||
                  r.event_type === 'marked_finished';
                return (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.event_at)}</td>
                    <td className="px-3 py-2">{r.receipt_number ?? '-'}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{r.product_name || '-'}</div>
                      <div className="text-xs text-slate-500">{r.customer_name || '-'} {r.table_number ? `• ${r.table_number}` : ''}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${EVENT_STYLE[r.event_type] || 'bg-slate-100 text-slate-700'}`}>
                        {EVENT_LABEL[r.event_type] || r.event_type}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {shown ? (
                        <span className="inline-flex items-center gap-1 text-green-700 font-medium">
                          <CheckCircle2 className="w-4 h-4" />
                          Shown / Completed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                          <CircleOff className="w-4 h-4" />
                          Excluded
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-[420px] truncate text-xs text-slate-600" title={r.detail_json || ''}>
                        {r.detail_json || '-'}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 text-xs text-slate-500 flex items-center gap-1">
        <Clock3 className="w-3.5 h-3.5" />
        Data diambil dari local `kds_item_audit_log` (localhost).
      </div>
    </div>
  );
}

