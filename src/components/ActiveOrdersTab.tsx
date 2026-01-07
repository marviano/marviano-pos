'use client';

import { useState, useEffect } from 'react';
import { Edit, List, LayoutGrid } from 'lucide-react';
import TableLayout from './TableLayout';

interface PendingTransaction {
  id: string;
  uuid_id: string;
  table_id: number | null;
  customer_name: string | null;
  total_amount: number;
  final_amount: number;
  created_at: string;
  table_number?: string;
  room_name?: string;
}

interface ActiveOrdersTabProps {
  businessId: number;
  isOpen: boolean;
  onLoadTransaction?: (transactionId: string) => void;
}

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function ActiveOrdersTab({ businessId, isOpen, onLoadTransaction }: ActiveOrdersTabProps) {
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [viewMode, setViewMode] = useState<'list' | 'layout'>('list');

  useEffect(() => {
    if (isOpen) {
      fetchPendingTransactions();
      // Refresh transaction list every 5 seconds
      const interval = setInterval(fetchPendingTransactions, 5000);
      return () => clearInterval(interval);
    }
  }, [isOpen, businessId]);

  // Update timer display every second
  useEffect(() => {
    if (isOpen && pendingTransactions.length > 0) {
      const interval = setInterval(() => {
        setCurrentTime(new Date());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isOpen, pendingTransactions.length]);

  const fetchPendingTransactions = async () => {
    try {
      setLoading(true);
      setError(null);

      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetTransactions) {
        setError('localDbGetTransactions not available');
        setLoading(false);
        return;
      }

      // Fetch all transactions and filter for pending ones
      const allTransactions = await electronAPI.localDbGetTransactions(businessId, 10000);
      const transactionsArray = Array.isArray(allTransactions) ? allTransactions : [];

      // Fetch tables and rooms to get table numbers and room names
      const tablesMap = new Map<number, { table_number: string; room_id: number }>();
      const roomsMap = new Map<number, string>();
      if (electronAPI.getRestaurantTables && electronAPI.getRestaurantRooms) {
        // Get all rooms first
        const rooms = await electronAPI.getRestaurantRooms(businessId);
        const roomsArray = Array.isArray(rooms) ? rooms : [];

        // Store room names
        roomsArray.forEach((room: { id: number; name: string }) => {
          if (room.id) {
            roomsMap.set(room.id, room.name);
          }
        });

        // Fetch tables for each room
        for (const room of roomsArray) {
          if (room.id) {
            const tables = await electronAPI.getRestaurantTables(room.id);
            const tablesArray = Array.isArray(tables) ? tables : [];
            tablesArray.forEach((table: { id: number; table_number: string; room_id: number }) => {
              tablesMap.set(table.id, { table_number: table.table_number, room_id: table.room_id });
            });
          }
        }
      }

      // Filter for pending transactions and map to our format
      const pending = transactionsArray
        .filter((tx: unknown) => {
          if (tx && typeof tx === 'object' && 'status' in tx) {
            const transaction = tx as { status: string };
            return transaction.status === 'pending';
          }
          return false;
        })
        .map((tx: unknown) => {
          const t = tx as {
            id?: string;
            uuid_id?: string;
            table_id?: number | null;
            customer_name?: string | null;
            total_amount?: number;
            final_amount?: number;
            created_at?: string;
          };
          const txId = t.uuid_id || t.id || '';
          const tableId = t.table_id || null;
          const tableInfo = tableId && tablesMap.has(tableId) ? tablesMap.get(tableId)! : null;
          const tableNumber = tableInfo ? tableInfo.table_number : null;
          const roomId = tableInfo ? tableInfo.room_id : null;
          const roomName = roomId && roomsMap.has(roomId) ? roomsMap.get(roomId)! : null;

          // Format: "table_name/room_name" or "Take-away" if no table
          const tableRoomDisplay = tableId && tableNumber && roomName
            ? `${tableNumber}/${roomName}`
            : 'Take-away';

          return {
            id: txId,
            uuid_id: txId,
            table_id: tableId,
            customer_name: t.customer_name || null,
            total_amount: t.total_amount || 0,
            final_amount: t.final_amount || t.total_amount || 0,
            created_at: t.created_at || new Date().toISOString(),
            table_number: tableRoomDisplay,
            room_name: roomName || undefined,
          };
        })
        .sort((a, b) => {
          // Sort by created_at descending (newest first)
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

      setPendingTransactions(pending);
    } catch (error) {
      console.error('Error fetching pending transactions:', error);
      setError('Failed to fetch pending transactions');
    } finally {
      setLoading(false);
    }
  };

  const formatTimer = (createdAt: string): string => {
    const created = new Date(createdAt);
    const diffMs = currentTime.getTime() - created.getTime();

    const totalSeconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatPrice = (price: number): string => {
    // Round to integer and format with Indonesian locale (dots as thousand separators, no decimals)
    const roundedPrice = Math.round(price);
    return `Rp ${roundedPrice.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  if (!isOpen) return null;

  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Active Orders</h2>
            <p className="text-sm text-gray-600 mt-1">Daftar pesanan yang belum dibayar</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('list')}
              className={`px-4 py-2 rounded-md transition-colors flex items-center gap-2 ${
                viewMode === 'list'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              <List className="w-4 h-4" />
              List
            </button>
            <button
              onClick={() => setViewMode('layout')}
              className={`px-4 py-2 rounded-md transition-colors flex items-center gap-2 ${
                viewMode === 'layout'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              Layout
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'layout' ? (
        <div className="flex-1 overflow-hidden">
          <TableLayout onLoadTransaction={onLoadTransaction} />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          {loading && pendingTransactions.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-600">Memuat data...</div>
            </div>
          )}

          {error && (
            <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          {!loading && pendingTransactions.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-gray-500">
                <p className="text-lg">Tidak ada pesanan aktif</p>
                <p className="text-sm mt-2">Semua pesanan telah dibayar</p>
              </div>
            </div>
          )}

          {pendingTransactions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Table/Room
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Nama Pelanggan
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Total
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Timer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Transaction ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {pendingTransactions.map((transaction) => (
                    <tr key={transaction.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {transaction.table_number}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {transaction.customer_name || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {formatPrice(transaction.final_amount)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-mono text-gray-900">
                          {formatTimer(transaction.created_at)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-xs font-mono text-gray-600 bg-gray-50 px-2 py-1 rounded border border-gray-200">
                          {transaction.uuid_id}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                          onClick={() => {
                            if (onLoadTransaction) {
                              onLoadTransaction(transaction.uuid_id);
                            }
                          }}
                        >
                          <Edit className="w-4 h-4 mr-2" />
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
      )}
    </div>
  );
}

