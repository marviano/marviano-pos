'use client';

import { useState, useEffect, useMemo } from 'react';
import { XCircle, Calendar, User, Package, Receipt, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

function getTodayUTC7(): string {
  const now = new Date();
  const utc7Offset = 7 * 60 * 60 * 1000;
  const utc7Time = new Date(now.getTime() + utc7Offset);
  const year = utc7Time.getUTCFullYear();
  const month = String(utc7Time.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc7Time.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface CancelledItem {
  id: number;
  uuid_id: string;
  transaction_id: number;
  uuid_transaction_id: string;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  custom_note: string | null;
  cancelled_at: string;
  transaction_receipt_number: string | null;
  customer_name: string | null;
  cancelled_by_user_id: number | null;
  cancelled_by_user_name: string | null;
  cancelled_by_waiter_name: string | null;
  printer_type: 'R' | 'RR' | null; // R = Printer 1, RR = Printer 2
}

interface ElectronAPI {
  localDbGetTransactions?: (businessId?: number, limit?: number, options?: { todayOnly?: boolean }) => Promise<unknown[]>;
  localDbGetTransactionItems?: (transactionId: string) => Promise<unknown[]>;
  localDbGetAllProducts?: () => Promise<unknown[]>;
  localDbGetUsers?: () => Promise<unknown[]>;
  localDbGetEmployees?: () => Promise<unknown[]>;
  getPrinter1AuditLog?: (fromDate?: string, toDate?: string, limit?: number) => Promise<{ success: boolean; entries: unknown[] }>;
  getPrinter2AuditLog?: (fromDate?: string, toDate?: string, limit?: number) => Promise<{ success: boolean; entries: unknown[] }>;
}

const getElectronAPI = (): ElectronAPI | undefined => {
  if (typeof window === 'undefined') return undefined;
  return window.electronAPI as ElectronAPI | undefined;
};

// Format date to "Rabu, 14.40 14 Jan 2025"
const formatCancelledDate = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    const dayName = days[date.getDay()];
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();

    return `${dayName}, ${hours}.${minutes} ${day} ${month} ${year}`;
  } catch (error) {
    return dateString;
  }
};

const formatRupiah = (amount: number): string => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(amount);
};

export default function CancelledItemsReport() {
  const { user } = useAuth();
  const businessId = user?.selectedBusinessId ?? undefined;
  const [cancelledItems, setCancelledItems] = useState<CancelledItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>(getTodayUTC7);
  const [endDate, setEndDate] = useState<string>(getTodayUTC7);

  const filteredByDate = useMemo(() => {
    if (!startDate && !endDate) return cancelledItems;
    return cancelledItems.filter((item) => {
      const itemDate = item.cancelled_at.slice(0, 10);
      if (startDate && itemDate < startDate) return false;
      if (endDate && itemDate > endDate) return false;
      return true;
    });
  }, [cancelledItems, startDate, endDate]);

  useEffect(() => {
    fetchCancelledItems();
  }, []);

  const fetchCancelledItems = async () => {
    try {
      setLoading(true);
      setError(null);

      const electronAPI = getElectronAPI();
      if (!electronAPI) {
        setError('Electron API tidak tersedia');
        setLoading(false);
        return;
      }

      // Fetch printer audit logs to determine R/RR
      const receiptizePrintedIds = new Set<string>();
      const receiptizeCounters: Record<string, number> = {};
      const receiptCounters: Record<string, number> = {};

      // Fetch Printer 2 (Receiptize) audit log
      if (electronAPI.getPrinter2AuditLog) {
        try {
          const printer2Result = await electronAPI.getPrinter2AuditLog(undefined, undefined, 5000);
          if (printer2Result?.entries && Array.isArray(printer2Result.entries)) {
            printer2Result.entries.forEach((entry: unknown) => {
              const e = entry as { transaction_id?: string; printer2_receipt_number?: number; is_reprint?: number };
              if (e.transaction_id && e.is_reprint === 0) {
                // Only count original prints, not reprints
                receiptizePrintedIds.add(e.transaction_id);
                if (e.printer2_receipt_number) {
                  receiptizeCounters[e.transaction_id] = e.printer2_receipt_number;
                }
              }
            });
          }
        } catch (err) {
          console.warn('Failed to fetch Printer 2 audit log:', err);
        }
      }

      // Fetch Printer 1 (Receipt) audit log
      if (electronAPI.getPrinter1AuditLog) {
        try {
          const printer1Result = await electronAPI.getPrinter1AuditLog(undefined, undefined, 5000);
          if (printer1Result?.entries && Array.isArray(printer1Result.entries)) {
            printer1Result.entries.forEach((entry: unknown) => {
              const e = entry as { transaction_id?: string; printer1_receipt_number?: number; is_reprint?: number };
              if (e.transaction_id && e.is_reprint === 0) {
                // Only count original prints, not reprints
                if (e.printer1_receipt_number) {
                  receiptCounters[e.transaction_id] = e.printer1_receipt_number;
                }
              }
            });
          }
        } catch (err) {
          console.warn('Failed to fetch Printer 1 audit log:', err);
        }
      }

      // Get all transactions to map transaction info
      const todayOnly = Boolean(businessId && startDate === getTodayUTC7() && endDate === getTodayUTC7());
      const allTransactions = await electronAPI.localDbGetTransactions?.(businessId ?? 0, 100000, todayOnly ? { todayOnly: true } : undefined);
      const transactionsArray = Array.isArray(allTransactions) ? allTransactions as Record<string, unknown>[] : [];
      const transactionsMap = new Map<string, Record<string, unknown>>();
      transactionsArray.forEach((tx) => {
        const txUuid = typeof tx.uuid_id === 'string' ? tx.uuid_id : String(tx.uuid_id || '');
        if (txUuid) {
          transactionsMap.set(txUuid, tx);
        }
      });

      // Get all products to map product names
      const allProducts = await electronAPI.localDbGetAllProducts?.();
      const productsArray = Array.isArray(allProducts) ? allProducts as Record<string, unknown>[] : [];
      const productsMap = new Map<number, Record<string, unknown>>();
      productsArray.forEach((p) => {
        const id = typeof p.id === 'number' ? p.id : (typeof p.id === 'string' ? parseInt(p.id, 10) : null);
        if (id) {
          productsMap.set(id, p);
        }
      });

      // Get all users to map user names
      const allUsers = electronAPI.localDbGetUsers ? await electronAPI.localDbGetUsers() : [];
      const usersArray = Array.isArray(allUsers) ? allUsers as Record<string, unknown>[] : [];
      const usersMap = new Map<number, Record<string, unknown>>();
      usersArray.forEach((u) => {
        const id = typeof u.id === 'number' ? u.id : (typeof u.id === 'string' ? parseInt(u.id, 10) : null);
        if (id) {
          usersMap.set(id, u);
        }
      });

      // Get all employees to map waiter names
      const allEmployees = electronAPI.localDbGetEmployees ? await electronAPI.localDbGetEmployees() : [];
      const employeesArray = Array.isArray(allEmployees) ? allEmployees as Record<string, unknown>[] : [];
      const employeesMap = new Map<number, Record<string, unknown>>();
      employeesArray.forEach((e) => {
        const id = typeof e.id === 'number' ? e.id : (typeof e.id === 'string' ? parseInt(e.id, 10) : null);
        if (id) {
          employeesMap.set(id, e);
        }
      });

      // Get all pending transactions to find cancelled items
      // We need to query all transactions and get their items
      const cancelledItemsList: CancelledItem[] = [];

      for (const tx of transactionsArray) {
        const txUuid = typeof tx.uuid_id === 'string' ? tx.uuid_id : String(tx.uuid_id || '');
        if (!txUuid) continue;

        const items = await electronAPI.localDbGetTransactionItems?.(txUuid);
        const itemsArray = Array.isArray(items) ? items as Record<string, unknown>[] : [];

        // Filter for cancelled items
        const cancelledItemsInTx = itemsArray.filter((item) => {
          const productionStatus = typeof item.production_status === 'string' ? item.production_status : null;
          return productionStatus === 'cancelled';
        });

        for (const item of cancelledItemsInTx) {
          const productId = typeof item.product_id === 'number' ? item.product_id : (typeof item.product_id === 'string' ? parseInt(item.product_id, 10) : null);
          if (!productId) continue;

          const product = productsMap.get(productId);
          const productName = product && typeof product.nama === 'string' ? product.nama : 'Unknown Product';

          const transaction = transactionsMap.get(txUuid);
          // Receipt number can be number or string, handle both
          const receiptNumber = transaction
            ? (typeof transaction.receipt_number === 'number'
              ? transaction.receipt_number.toString()
              : (typeof transaction.receipt_number === 'string' ? transaction.receipt_number : null))
            : null;
          const customerName = transaction && typeof transaction.customer_name === 'string' ? transaction.customer_name : null;

          // Determine who cancelled the item
          // Resolve both waiter name and user name independently so we can show both
          const cancelledByWaiterId = typeof item.cancelled_by_waiter_id === 'number' ? item.cancelled_by_waiter_id : (typeof item.cancelled_by_waiter_id === 'string' ? parseInt(item.cancelled_by_waiter_id, 10) : null);
          const cancelledByUserIdFromItem = typeof item.cancelled_by_user_id === 'number' ? item.cancelled_by_user_id : (typeof item.cancelled_by_user_id === 'string' ? parseInt(item.cancelled_by_user_id, 10) : null);

          const transactionUserId = transaction && typeof transaction.user_id === 'number'
            ? transaction.user_id
            : (transaction && typeof transaction.user_id === 'string' ? parseInt(transaction.user_id, 10) : null);

          const finalCancelledByUserId = cancelledByUserIdFromItem || transactionUserId;

          // Resolve waiter name (employee who performed the cancellation via PIN)
          let waiterName: string | null = null;
          if (cancelledByWaiterId) {
            const waiter = employeesMap.get(cancelledByWaiterId);
            if (waiter && typeof waiter.nama_karyawan === 'string') {
              waiterName = waiter.nama_karyawan;
            } else {
              const altUser = usersMap.get(cancelledByWaiterId);
              waiterName = altUser && typeof altUser.name === 'string' ? altUser.name : 'Waiter (PIN)';
            }
          }

          // Resolve user/cashier name (user who authorized the cancellation)
          let userName: string | null = null;
          if (finalCancelledByUserId) {
            const user = usersMap.get(finalCancelledByUserId);
            userName = user && typeof user.name === 'string'
              ? user.name
              : (user && typeof user.email === 'string' ? user.email : null);
          }

          const itemId = typeof item.id === 'number' ? item.id : (typeof item.id === 'string' ? parseInt(item.id, 10) : 0);
          const itemUuidId = typeof item.uuid_id === 'string' ? item.uuid_id : String(item.uuid_id || '');
          const transactionIntId = typeof item.transaction_id === 'number' ? item.transaction_id : (typeof item.transaction_id === 'string' ? parseInt(item.transaction_id, 10) : 0);
          const transactionUuidId = typeof item.uuid_transaction_id === 'string' ? item.uuid_transaction_id : String(item.uuid_transaction_id || '');
          const quantity = typeof item.quantity === 'number' ? item.quantity : (typeof item.quantity === 'string' ? parseInt(item.quantity, 10) : 1);
          const unitPrice = typeof item.unit_price === 'number' ? item.unit_price : (typeof item.unit_price === 'string' ? parseFloat(String(item.unit_price)) : 0);
          const totalPrice = typeof item.total_price === 'number' ? item.total_price : (typeof item.total_price === 'string' ? parseFloat(String(item.total_price)) : 0);
          const customNote = typeof item.custom_note === 'string' ? item.custom_note : null;
          const toISOString = (val: unknown): string | null => {
            if (!val) return null;
            if (val instanceof Date) return val.toISOString();
            if (typeof val === 'string' && val.length > 0) return val;
            if (typeof val === 'number') return new Date(val).toISOString();
            // mysql2 may return an object with toISOString on the prototype
            if (typeof val === 'object' && val !== null && 'toISOString' in val && typeof (val as any).toISOString === 'function') return (val as any).toISOString();
            return String(val);
          };
          const cancelledAt = toISOString(item.cancelled_at) || toISOString(item.created_at) || new Date().toISOString();

          // Determine printer type (R/RR)
          // RR = Printer 2 (Receiptize) if in receiptizePrintedIds or has receiptizeCounter
          // R = Printer 1 (Receipt) if has receiptCounter but NOT receiptize
          // null = Transaction was never printed (all items cancelled before printing)
          // Try both UUID and numeric ID for matching (audit logs might use either)
          const txUuidId = transactionUuidId;
          const txNumericId = transactionIntId.toString();

          // Check both UUID and numeric ID formats
          const hasReceiptizeCounter = (typeof receiptizeCounters[txUuidId] === 'number' && receiptizeCounters[txUuidId] > 0) ||
            (typeof receiptizeCounters[txNumericId] === 'number' && receiptizeCounters[txNumericId] > 0);
          const hasReceiptCounter = (typeof receiptCounters[txUuidId] === 'number' && receiptCounters[txUuidId] > 0) ||
            (typeof receiptCounters[txNumericId] === 'number' && receiptCounters[txNumericId] > 0);
          const isInReceiptizeIds = receiptizePrintedIds.has(txUuidId) || receiptizePrintedIds.has(txNumericId);
          const isReceiptize = isInReceiptizeIds || hasReceiptizeCounter;

          let printerType: 'R' | 'RR' | null = null;
          if (isReceiptize) {
            printerType = 'RR'; // Printer 2 (Receiptize)
          } else if (hasReceiptCounter && !isReceiptize) {
            printerType = 'R'; // Printer 1 (Receipt)
          }
          // If printerType is still null, it means transaction was never printed
          // This is normal for transactions where all items were cancelled before payment/printing

          cancelledItemsList.push({
            id: itemId,
            uuid_id: itemUuidId,
            transaction_id: transactionIntId,
            uuid_transaction_id: transactionUuidId,
            product_id: productId,
            product_name: productName,
            quantity: quantity,
            unit_price: unitPrice,
            total_price: totalPrice,
            custom_note: customNote,
            cancelled_at: cancelledAt,
            transaction_receipt_number: receiptNumber,
            customer_name: customerName,
            cancelled_by_user_id: finalCancelledByUserId,
            cancelled_by_user_name: userName || waiterName || 'Tidak diketahui',
            cancelled_by_waiter_name: waiterName,
            printer_type: printerType,
          });
        }
      }

      // Sort by cancelled_at descending (newest first)
      cancelledItemsList.sort((a, b) =>
        new Date(b.cancelled_at).getTime() - new Date(a.cancelled_at).getTime()
      );

      setCancelledItems(cancelledItemsList);
    } catch (err) {
      console.error('Error fetching cancelled items:', err);
      setError('Gagal memuat data item yang dibatalkan');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Memuat data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-600">{error}</p>
          <button
            onClick={fetchCancelledItems}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap items-center gap-4">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <XCircle className="w-5 h-5 text-red-500" />
            Pembatalan
          </h2>
          <div className="flex items-center gap-2 border border-gray-300 rounded-lg bg-gray-50/50 overflow-hidden">
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
          <p className="text-sm text-gray-600">
            Total: {filteredByDate.length} item
          </p>
        </div>

        {filteredByDate.length === 0 ? (
          <div className="p-12 text-center">
            <XCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg">Tidak ada item yang dibatalkan</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Waktu Pembatalan
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Item
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Jumlah
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Harga
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Transaksi
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Pelanggan
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Dibatalkan Oleh
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredByDate.map((item) => (
                  <tr key={item.uuid_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-sm text-gray-900">
                        <Calendar className="w-4 h-4 text-gray-400 mr-2" />
                        {formatCancelledDate(item.cancelled_at)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <Package className="w-4 h-4 text-gray-400 mr-2" />
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {item.product_name}
                          </div>
                          {item.custom_note && (
                            <div className="text-xs text-gray-500 mt-1">
                              Catatan: {item.custom_note}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {item.quantity}x
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatRupiah(item.total_price)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-sm text-gray-900">
                        <Receipt className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        {item.printer_type ? (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 ${item.printer_type === 'RR'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-blue-100 text-blue-800'
                            }`} title={item.printer_type === 'RR' ? 'Printer 2 (Receiptize)' : 'Printer 1 (Receipt)'}>
                            {item.printer_type}
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 flex-shrink-0"
                            title="Transaksi belum dicetak (semua item dibatalkan sebelum pembayaran)"
                          >
                            -
                          </span>
                        )}
                        <span className="whitespace-nowrap">
                          {item.transaction_receipt_number
                            ? `#${item.transaction_receipt_number}`
                            : `ID: ${item.transaction_id}`}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-sm text-gray-900">
                        <Users className="w-4 h-4 text-gray-400 mr-2" />
                        {item.customer_name || 'Guest'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-start text-sm text-gray-900">
                        <User className="w-4 h-4 text-gray-400 mr-2 mt-0.5 flex-shrink-0" />
                        <div>
                          {item.cancelled_by_user_name && (
                            <div>{item.cancelled_by_user_name}</div>
                          )}
                          {item.cancelled_by_waiter_name && item.cancelled_by_user_name !== item.cancelled_by_waiter_name && (
                            <div className="text-xs text-gray-500">Waiters {item.cancelled_by_waiter_name}</div>
                          )}
                          {!item.cancelled_by_user_name && !item.cancelled_by_waiter_name && (
                            <div>Tidak diketahui</div>
                          )}
                        </div>
                      </div>
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

