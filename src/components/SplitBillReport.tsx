'use client';

import { useState, useEffect } from 'react';
import { Scissors, Calendar, User, Package, ArrowRight, Copy, Check } from 'lucide-react';

interface SplitBillLog {
  id: number;
  user_id: number;
  action: string;
  business_id: number | null;
  details: string;
  created_at: string;
  user_name?: string;
  parsed_details?: {
    message: string;
    source_transaction_uuid: string;
    source_transaction_table: string;
    source_transaction_room?: string | null;
    source_transaction_customer?: string | null;
    destination_transaction_uuid: string;
    destination_table: string | null;
    destination_room?: string | null;
    destination_customer?: string | null;
    moved_items: Array<{
      item_id: number;
      item_uuid: string;
      product_id: number;
      product_name: string;
      quantity: number;
      unit_price: number;
      total_price: number;
    }>;
    waiter_name: string;
    user_name?: string;
    moved_at: string;
  };
}

interface ElectronAPI {
  localDbGetActivityLogs?: (businessId?: number) => Promise<unknown[]>;
  localDbGetUsers?: () => Promise<unknown[]>;
}

const getElectronAPI = (): ElectronAPI | undefined => {
  if (typeof window === 'undefined') return undefined;
  return window.electronAPI as ElectronAPI | undefined;
};

// Format date to "Rabu, 14.40 14 Jan 2025"
const formatDate = (dateString: string): string => {
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

export default function SplitBillReport() {
  const [logs, setLogs] = useState<SplitBillLog[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<SplitBillLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Set default to today UTC+7
  const getTodayUTC7 = (): string => {
    const now = new Date();
    const utc7Offset = 7 * 60 * 60 * 1000; // UTC+7 in milliseconds
    const utc7Time = new Date(now.getTime() + utc7Offset);
    const year = utc7Time.getUTCFullYear();
    const month = String(utc7Time.getUTCMonth() + 1).padStart(2, '0');
    const day = String(utc7Time.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [fromDate, setFromDate] = useState<string>(getTodayUTC7());
  const [toDate, setToDate] = useState<string>(getTodayUTC7());
  const [selectedWaiter, setSelectedWaiter] = useState<string>('all');
  const [waiters, setWaiters] = useState<Array<{ name: string; id: number }>>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [logs, fromDate, toDate, selectedWaiter]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      const electronAPI = getElectronAPI();
      if (!electronAPI) {
        setError('Electron API tidak tersedia');
        setLoading(false);
        return;
      }

      // Fetch activity logs from local database
      let activityLogs: unknown[] = [];
      if (electronAPI.localDbGetActivityLogs) {
        try {
          activityLogs = await electronAPI.localDbGetActivityLogs();
          console.log('[SPLIT BILL REPORT] Fetched activity logs:', activityLogs.length);
        } catch (err) {
          console.error('[SPLIT BILL REPORT] Error fetching activity logs:', err);
          setError('Gagal memuat data log dari database lokal');
        }
      } else {
        console.warn('[SPLIT BILL REPORT] localDbGetActivityLogs not available');
        setError('Fungsi untuk mengambil log tidak tersedia');
      }

      // Filter for split_bill_pindah_meja action
      const splitBillLogs = (activityLogs as Array<Record<string, unknown>>)
        .filter(log => {
          const action = typeof log.action === 'string' ? log.action : '';
          return action === 'split_bill_pindah_meja';
        })
        .map(log => {
          let parsedDetails = null;
          try {
            const detailsStr = typeof log.details === 'string' ? log.details : '';
            parsedDetails = JSON.parse(detailsStr);
            
            // Ensure moved_items is always an array (handle missing or invalid data)
            if (parsedDetails) {
              if (!parsedDetails.moved_items) {
                parsedDetails.moved_items = [];
              } else if (!Array.isArray(parsedDetails.moved_items)) {
                console.warn('[SPLIT BILL REPORT] moved_items is not an array, converting:', {
                  logId: log.id,
                  moved_items: parsedDetails.moved_items
                });
                parsedDetails.moved_items = [];
              }
              
              // Debug: log if moved_items is empty
              if (parsedDetails.moved_items.length === 0) {
                console.warn('[SPLIT BILL REPORT] No moved_items found in log:', {
                  logId: log.id,
                  hasDetails: !!parsedDetails,
                  message: parsedDetails?.message,
                  movedItemsCount: 0,
                  hasMovedItemsKey: 'moved_items' in parsedDetails
                });
              }
            }
          } catch (err) {
            console.warn('Failed to parse details:', err);
            // If parsing fails, create empty details object
            parsedDetails = { moved_items: [] };
          }

          return {
            id: typeof log.id === 'number' ? log.id : 0,
            user_id: typeof log.user_id === 'number' ? log.user_id : 0,
            action: typeof log.action === 'string' ? log.action : '',
            business_id: typeof log.business_id === 'number' ? log.business_id : null,
            details: typeof log.details === 'string' ? log.details : '',
            created_at: typeof log.created_at === 'string' ? log.created_at : new Date().toISOString(),
            parsed_details: parsedDetails,
          } as SplitBillLog;
        });

      // Get users to map user names
      const allUsers = electronAPI.localDbGetUsers ? await electronAPI.localDbGetUsers() : [];
      const usersArray = Array.isArray(allUsers) ? allUsers as Record<string, unknown>[] : [];
      const usersMap = new Map<number, string>();
      usersArray.forEach((u) => {
        const id = typeof u.id === 'number' ? u.id : (typeof u.id === 'string' ? parseInt(u.id, 10) : null);
        if (id) {
          const name = typeof u.name === 'string' ? u.name : (typeof u.email === 'string' ? u.email : 'Unknown');
          usersMap.set(id, name);
        }
      });

      // Add user names and extract waiter names
      const waiterSet = new Set<string>();
      const logsWithNames = splitBillLogs.map(log => {
        const userName = usersMap.get(log.user_id) || 'Unknown';
        // Get waiter name from parsed_details, fallback to user_name if no waiter
        const waiterName = log.parsed_details?.waiter_name || null;
        // Add both waiter and user to the set for filtering
        if (waiterName) waiterSet.add(waiterName);
        waiterSet.add(userName);
        return {
          ...log,
          user_name: userName,
        };
      });

      setWaiters(Array.from(waiterSet).sort().map(name => ({ name, id: 0 })));
      setLogs(logsWithNames);
    } catch (err) {
      console.error('Error fetching split bill logs:', err);
      setError('Gagal memuat data log split bill/pindah meja');
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...logs];

    // Filter by date
    if (fromDate) {
      const from = new Date(fromDate);
      from.setHours(0, 0, 0, 0);
      filtered = filtered.filter(log => {
        const logDate = new Date(log.created_at);
        return logDate >= from;
      });
    }

    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      filtered = filtered.filter(log => {
        const logDate = new Date(log.created_at);
        return logDate <= to;
      });
    }

    // Filter by waiter (match either waiter or user)
    if (selectedWaiter !== 'all') {
      filtered = filtered.filter(log => {
        const waiterName = log.parsed_details?.waiter_name || null;
        const userName = log.user_name || '';
        return waiterName === selectedWaiter || userName === selectedWaiter;
      });
    }

    // Sort by created_at descending (newest first)
    filtered.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    setFilteredLogs(filtered);
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
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
          <Scissors className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-600">{error}</p>
          <button
            onClick={fetchLogs}
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
        {/* Filters */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Date From */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Dari Tanggal
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="pl-10 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            {/* Date To */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sampai Tanggal
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="pl-10 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            {/* Waiter Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Waiter
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <select
                  value={selectedWaiter}
                  onChange={(e) => setSelectedWaiter(e.target.value)}
                  className={`pl-10 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    selectedWaiter === 'all' ? 'text-gray-600' : 'text-gray-900'
                  }`}
                >
                  <option value="all" className="text-gray-600">Semua Waiter</option>
                  {waiters.map((waiter) => (
                    <option key={waiter.name} value={waiter.name} className="text-gray-900">
                      {waiter.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Clear Filters */}
          {(fromDate || toDate || selectedWaiter !== 'all') && (
            <button
              onClick={() => {
                setFromDate('');
                setToDate('');
                setSelectedWaiter('all');
              }}
              className="mt-4 px-4 py-2 text-sm text-gray-600 hover:text-gray-800 underline"
            >
              Hapus Filter
            </button>
          )}
        </div>

        {/* Content */}
        {filteredLogs.length === 0 ? (
          <div className="p-12 text-center">
            <Scissors className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 text-lg">
              {logs.length === 0 
                ? 'Tidak ada aktivitas split bill/pindah meja. Log akan muncul setelah data tersinkronisasi dari server.' 
                : 'Tidak ada aktivitas yang sesuai dengan filter'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Waktu
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Waiter
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Item Dipindahkan
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Dari
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                    Ke
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredLogs.map((log) => {
                  const details = log.parsed_details;
                  const items = details?.moved_items || [];

                  return (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-gray-900">
                          <Calendar className="w-4 h-4 text-gray-400 mr-2" />
                          {formatDate(log.created_at)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-start text-sm">
                          <User className="w-4 h-4 text-gray-400 mr-2 mt-0.5 flex-shrink-0" />
                          <div className="flex flex-col">
                            <span className="text-gray-900 font-medium">
                              {details?.waiter_name || 'Tidak ada waiter'}
                            </span>
                            <span className="text-gray-600 text-xs mt-0.5">
                              {log.user_name || 'Unknown'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm">
                          {(() => {
                            // Ensure items is always an array
                            const itemsArray = Array.isArray(items) ? items : [];
                            
                            if (itemsArray.length > 0) {
                              return (
                                <div className="space-y-1">
                                  {itemsArray.map((item, idx) => (
                                    <div key={item.item_id || idx} className="flex items-center gap-2">
                                      <Package className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                      <span className="font-medium text-gray-900">
                                        {item.quantity}x {item.product_name}
                                      </span>
                                      <span className="text-gray-600">
                                        ({formatRupiah(item.total_price)})
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              );
                            } else {
                              // Show message only if no items found
                              return (
                                <span className="text-gray-600 italic">
                                  {details?.message || 'Tidak ada item dipindahkan'}
                                </span>
                              );
                            }
                          })()}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900">
                          {(() => {
                            const customer = details?.source_transaction_customer || null;
                            let table = details?.source_transaction_table || null;
                            let room = details?.source_transaction_room || null;
                            
                            // For backward compatibility: if room is not separate, try to parse from table
                            // Check if room is null, undefined, or empty string, and table contains '/'
                            if ((!room || room === '') && table && table.includes('/')) {
                              const parts = table.split('/');
                              table = parts[0]?.trim() || null;
                              room = parts[1]?.trim() || null;
                            }
                            
                            const parts: string[] = [];
                            if (customer) parts.push(customer);
                            if (table) parts.push(table);
                            if (room) parts.push(room);
                            return parts.length > 0 ? parts.join(' | ') : 'Take-away';
                          })()}
                        </div>
                        {details?.source_transaction_uuid && (
                          <div className="flex items-center gap-2 mt-1">
                            <code className="text-xs text-gray-600 font-mono bg-gray-100 px-2 py-1 rounded">
                              {details.source_transaction_uuid}
                            </code>
                            <button
                              onClick={() => copyToClipboard(details.source_transaction_uuid, `source-${log.id}`)}
                              className="p-1 hover:bg-gray-200 rounded transition-colors"
                              title="Copy transaction ID"
                            >
                              {copiedId === `source-${log.id}` ? (
                                <Check className="w-3 h-3 text-green-600" />
                              ) : (
                                <Copy className="w-3 h-3 text-gray-400" />
                              )}
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <div className="flex-1">
                            <div className="text-sm text-gray-900">
                              {(() => {
                                const customer = details?.destination_customer || null;
                                let table = details?.destination_table || null;
                                let room = details?.destination_room || null;
                                
                                // For backward compatibility: if room is not separate, try to parse from table
                                // Check if room is null, undefined, or empty string, and table contains '/'
                                if ((!room || room === '') && table && table.includes('/')) {
                                  const parts = table.split('/');
                                  table = parts[0]?.trim() || null;
                                  room = parts[1]?.trim() || null;
                                }
                                
                                if (details?.destination_transaction_uuid) {
                                  const parts: string[] = [];
                                  if (customer) parts.push(customer);
                                  if (table) parts.push(table);
                                  if (room) parts.push(room);
                                  return parts.length > 0 ? parts.join(' | ') : 'Transaksi Baru';
                                }
                                return '-';
                              })()}
                            </div>
                            {details?.destination_transaction_uuid && (
                              <div className="flex items-center gap-2 mt-1">
                                <code className="text-xs text-gray-600 font-mono bg-gray-100 px-2 py-1 rounded">
                                  {details.destination_transaction_uuid}
                                </code>
                                <button
                                  onClick={() => copyToClipboard(details.destination_transaction_uuid, `dest-${log.id}`)}
                                  className="p-1 hover:bg-gray-200 rounded transition-colors"
                                  title="Copy transaction ID"
                                >
                                  {copiedId === `dest-${log.id}` ? (
                                    <Check className="w-3 h-3 text-green-600" />
                                  ) : (
                                    <Copy className="w-3 h-3 text-gray-400" />
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
