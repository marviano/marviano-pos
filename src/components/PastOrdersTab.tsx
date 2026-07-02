'use client';

import { useState, useEffect, useCallback } from 'react';
import { Edit, History } from 'lucide-react';
import { appAlert } from '@/components/AppDialog';
import { wibNowSql } from '@/lib/wibDateTime';
import { getTodayUTC7 } from '@/lib/dateUtils';
import { isActiveTransactionItem } from '@/lib/activeTransactionItem';

interface PastOrderRow {
  id: string;
  uuid_id: string;
  customer_name: string | null;
  total_amount: number;
  final_amount: number;
  created_at: string;
  table_number?: string;
  waiter_name?: string | null;
  waiter_color?: string | null;
  waiter_names_all?: string[];
  waiter_id?: number | null;
  status: string;
  pickup_method: 'dine-in' | 'take-away';
}

interface PastOrdersTabProps {
  businessId: number;
  isOpen: boolean;
  onLoadTransaction?: (transactionId: string) => void;
}

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  completed: 'Selesai',
  paid: 'Dibayar',
  cancelled: 'Batal',
};

export default function PastOrdersTab({ businessId, isOpen, onLoadTransaction }: PastOrdersTabProps) {
  const today = getTodayUTC7();
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [orders, setOrders] = useState<PastOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetTransactions) {
        setError('localDbGetTransactions not available');
        return;
      }

      const allTransactions = await electronAPI.localDbGetTransactions(businessId, 2000, {
        from: dateFrom,
        to: dateTo,
      });
      const transactionsArray = Array.isArray(allTransactions) ? allTransactions : [];

      const tablesMap = new Map<number, { table_number: string; room_id: number }>();
      const roomsMap = new Map<number, string>();
      const employeesMap = new Map<number, string>();
      const employeesColorMap = new Map<number, string | null>();

      if (electronAPI.localDbGetEmployees) {
        try {
          const allEmployees = await electronAPI.localDbGetEmployees();
          const employeesArray = Array.isArray(allEmployees) ? allEmployees : [];
          employeesArray.forEach((emp: { id?: number | string; nama_karyawan?: string; color?: string | null }) => {
            const empId = typeof emp.id === 'number' ? emp.id : (typeof emp.id === 'string' ? parseInt(emp.id, 10) : null);
            if (empId) {
              if (typeof emp.nama_karyawan === 'string') employeesMap.set(empId, emp.nama_karyawan);
              employeesColorMap.set(empId, typeof emp.color === 'string' && emp.color ? emp.color : null);
            }
          });
        } catch (e) {
          console.warn('PastOrdersTab: failed to fetch employees', e);
        }
      }

      if (electronAPI.getRestaurantTables && electronAPI.getRestaurantRooms) {
        const rooms = await electronAPI.getRestaurantRooms(businessId);
        const roomsArray = Array.isArray(rooms) ? rooms : [];
        roomsArray.forEach((room: { id: number; name: string }) => {
          if (room.id) roomsMap.set(room.id, room.name);
        });
        for (const room of roomsArray) {
          if (!room.id) continue;
          const tables = await electronAPI.getRestaurantTables(room.id);
          const tablesArray = Array.isArray(tables) ? tables : [];
          tablesArray.forEach((table: { id: number; table_number: string; room_id: number }) => {
            tablesMap.set(table.id, { table_number: table.table_number, room_id: table.room_id });
          });
        }
      }

      const rows: PastOrderRow[] = [];

      for (const tx of transactionsArray) {
        if (!tx || typeof tx !== 'object' || !('status' in tx)) continue;
        const transaction = tx as Record<string, unknown> & {
          status: string;
          uuid_id?: string;
          id?: string;
          table_id?: number | null;
          table_ids?: number[];
          customer_name?: string | null;
          waiter_id?: number | null;
          total_amount?: number;
          final_amount?: number;
          created_at?: string;
          pickup_method?: string;
          payment_method?: string;
        };

        const txId = String(transaction.uuid_id || transaction.id || '');
        if (!txId) continue;

        if (electronAPI.localDbGetTransactionItems) {
          try {
            const items = await electronAPI.localDbGetTransactionItems(txId);
            const itemsArray = Array.isArray(items) ? items : [];
            const activeItems = itemsArray.filter((item) =>
              isActiveTransactionItem(item as { production_status?: string | null; cancelled_at?: string | null })
            );
            if (activeItems.length === 0) continue;
          } catch {
            // include if items check fails
          }
        }

        const rawTableIds = transaction.table_ids;
        const idsToUse = Array.isArray(rawTableIds) && rawTableIds.length > 0
          ? rawTableIds.map((id: unknown) => typeof id === 'number' ? id : parseInt(String(id), 10)).filter((n: number) => !Number.isNaN(n))
          : (transaction.table_id != null ? [typeof transaction.table_id === 'number' ? transaction.table_id : parseInt(String(transaction.table_id), 10)] : []);
        const tableNumbers: string[] = [];
        let roomName: string | null = null;
        for (const tid of idsToUse) {
          const tableInfo = tablesMap.get(tid);
          if (tableInfo) {
            tableNumbers.push(tableInfo.table_number);
            if (roomName == null && roomsMap.has(tableInfo.room_id)) roomName = roomsMap.get(tableInfo.room_id)!;
          }
        }
        const tableRoomDisplay = tableNumbers.length > 0 && roomName
          ? `${tableNumbers.join(', ')}/${roomName}`
          : tableNumbers.length > 0
            ? tableNumbers.join(', ')
            : 'Take-away';

        const waiterId = typeof transaction.waiter_id === 'number'
          ? transaction.waiter_id
          : (typeof transaction.waiter_id === 'string' ? parseInt(transaction.waiter_id, 10) : null);
        const waiterName = waiterId && employeesMap.has(waiterId) ? employeesMap.get(waiterId)! : null;
        const waiterColor = waiterId ? (employeesColorMap.get(waiterId) ?? null) : null;

        const platformPaymentMethods = ['gofood', 'grabfood', 'shopeefood', 'qpon', 'tiktok'];
        const pm = typeof transaction.pickup_method === 'string' ? transaction.pickup_method : null;
        const paymentMethod = typeof transaction.payment_method === 'string' ? transaction.payment_method.toLowerCase() : '';
        const pickupMethod: 'dine-in' | 'take-away' =
          pm === 'take-away' || pm === 'dine-in' ? pm
            : platformPaymentMethods.includes(paymentMethod) ? 'take-away'
              : 'dine-in';

        rows.push({
          id: txId,
          uuid_id: txId,
          customer_name: (transaction.customer_name as string | null) || null,
          total_amount: Number(transaction.total_amount) || 0,
          final_amount: Number(transaction.final_amount) || Number(transaction.total_amount) || 0,
          created_at: (transaction.created_at as string) || wibNowSql(),
          table_number: tableRoomDisplay,
          waiter_name: waiterName,
          waiter_color: waiterColor,
          waiter_id: waiterId ?? null,
          status: transaction.status || 'unknown',
          pickup_method: pickupMethod,
        });
      }

      if (rows.length > 0 && electronAPI.localDbGetDistinctItemWaiterIdsByTransaction) {
        try {
          const txIds = rows.map((t) => t.uuid_id);
          const itemWaiterIdsByTx = await electronAPI.localDbGetDistinctItemWaiterIdsByTransaction(txIds);
          for (const t of rows) {
            const itemWaiterIds = itemWaiterIdsByTx[t.uuid_id] || [];
            const txWaiterId = t.waiter_id;
            const allWaiterIds = [...new Set([txWaiterId, ...itemWaiterIds].filter((id): id is number => id != null))];
            const primaryId = txWaiterId ?? allWaiterIds[0];
            if (allWaiterIds.length > 0) {
              t.waiter_name = primaryId && employeesMap.has(primaryId) ? employeesMap.get(primaryId)! : (t.waiter_name ?? null);
              t.waiter_color = primaryId ? (employeesColorMap.get(primaryId) ?? t.waiter_color) : t.waiter_color;
            }
            t.waiter_names_all = allWaiterIds.map((id) => employeesMap.get(id)).filter((n): n is string => Boolean(n));
          }
        } catch (e) {
          console.warn('PastOrdersTab: item waiter IDs fetch failed', e);
        }
      }

      rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setOrders(rows);
    } catch (e) {
      console.error('PastOrdersTab fetch error:', e);
      setError('Gagal memuat pesanan');
    } finally {
      setLoading(false);
    }
  }, [businessId, dateFrom, dateTo]);

  useEffect(() => {
    if (isOpen) fetchOrders();
  }, [isOpen, fetchOrders]);

  const formatPrice = (price: number) =>
    `Rp ${Math.round(price).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const formatCreatedAt = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const statusBadgeClass = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-amber-100 text-amber-800';
      case 'completed':
      case 'paid':
        return 'bg-green-100 text-green-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 bg-white z-50 flex flex-col">
      <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <History className="w-5 h-5 text-violet-600" />
              Past Order
            </h2>
            <p className="text-xs text-gray-500 mt-1">Super Admin — buka order untuk edit waiter per item</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Dari</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Sampai</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => fetchOrders()}
              disabled={loading}
              className="px-4 py-1.5 bg-violet-600 text-white text-sm font-medium rounded-md hover:bg-violet-700 disabled:opacity-50"
            >
              {loading ? 'Memuat...' : 'Cari'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto pt-0 pb-6 px-0">
        {error && (
          <div className="m-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">{error}</div>
        )}

        {!loading && orders.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-500">
            <p>Tidak ada pesanan pada rentang tanggal ini</p>
          </div>
        )}

        {orders.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-900 font-semibold border-b border-gray-200 sticky top-0 z-10">
                <tr>
                  <th className="pl-3 pr-2 py-3 text-[10px] font-medium text-gray-500 uppercase">Waktu</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase">Table/Room</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase">Pelanggan</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase">Waiter</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase">Total</th>
                  <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    className="hover:bg-violet-50 transition-colors"
                    style={order.waiter_color ? { boxShadow: `inset 8px 0 0 0 ${order.waiter_color}` } : undefined}
                  >
                    <td className="pl-3 pr-2 py-3 whitespace-nowrap text-xs text-gray-700">{formatCreatedAt(order.created_at)}</td>
                    <td className="px-2 py-3 whitespace-nowrap">
                      <span className={`inline-flex px-1.5 py-0.5 text-xs font-semibold rounded-full ${statusBadgeClass(order.status)}`}>
                        {STATUS_LABELS[order.status] ?? order.status}
                      </span>
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap text-xs font-medium text-gray-900">{order.table_number}</td>
                    <td className="px-2 py-3 whitespace-nowrap text-xs text-gray-900 truncate max-w-[120px]" title={order.customer_name || '-'}>
                      {order.customer_name || '-'}
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap text-xs text-gray-900">
                      {order.waiter_name || '-'}
                      {order.waiter_names_all && order.waiter_names_all.length > 1 && (
                        <span className="text-gray-500 ml-0.5">(+{order.waiter_names_all.length - 1})</span>
                      )}
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap text-xs font-semibold text-gray-900">{formatPrice(order.final_amount)}</td>
                    <td className="px-2 py-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onLoadTransaction?.(order.uuid_id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-violet-700 bg-violet-100 hover:bg-violet-200 rounded-md border border-violet-300"
                      >
                        <Edit className="w-3.5 h-3.5" />
                        Lihat
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
