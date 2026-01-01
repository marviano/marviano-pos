'use client';

import { useEffect, useMemo, useState, Fragment, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

// Transaction type from API
type Transaction = {
  id: string;
  uuid_id?: string;
  payment_method: string;
  payment_method_id?: number | null;
  pickup_method: string;
  final_amount: number;
  customer_name?: string | null;
  customer_unit?: number | null;
  created_at: string;
};

// Printer audit types from API
type Printer1Audit = {
  transaction_id: string;
  printer1_receipt_number: number;
  printed_at: string;
  printed_at_epoch: number;
  global_counter?: number;
  is_reprint?: number;
  reprint_count?: number;
};

type Printer2Audit = {
  transaction_id: string;
  printer2_receipt_number: number;
  print_mode: 'auto' | 'manual';
  cycle_number?: number | null;
  printed_at: string;
  printed_at_epoch: number;
  global_counter?: number;
  is_reprint?: number;
  reprint_count?: number;
};

// Transaction item type
type TransactionItem = {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
};

export default function PrintingLogsPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [isClient, setIsClient] = useState(false);
  const businessId = user?.selectedBusinessId || 14; // Default to 14 if not set

  // Ensure we're on the client side
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Redirect to login if not authenticated (similar to main page)
  useEffect(() => {
    if (isClient && !isAuthenticated) {
      console.log('🔍 [PrintingLogs] Not authenticated, redirecting to login');
      if (process.env.NODE_ENV === 'development') {
        router.replace('/login');
      } else {
        // In production (Electron file://), use window.location
        window.location.href = 'login.html';
      }
    }
  }, [isClient, isAuthenticated, router]);

  // Get today's date in UTC+7 (Jakarta timezone)
  const getTodayInUTC7 = useCallback(() => {
    const nowUtc = new Date();
    const utcMs = nowUtc.getTime() + (nowUtc.getTimezoneOffset() * 60000);
    const utc7 = new Date(utcMs + 7 * 60 * 60 * 1000);
    const y = utc7.getUTCFullYear();
    const m = String(utc7.getUTCMonth() + 1).padStart(2, '0');
    const d = String(utc7.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  const [fromDate, setFromDate] = useState<string>(getTodayInUTC7());
  const [toDate, setToDate] = useState<string>(getTodayInUTC7());
  const [search, setSearch] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [audit1, setAudit1] = useState<Printer1Audit[]>([]);
  const [audit2, setAudit2] = useState<Printer2Audit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethodMap, setPaymentMethodMap] = useState<{ byId: Record<number, string>; byCode: Record<string, string> }>({ byId: {}, byCode: {} });


  // Electron API interface
  interface ElectronAPI {
    localDbGetTransactions?: (businessId: number, limit: number) => Promise<Array<Record<string, unknown>>>;
    getPrinter1AuditLog?: (fromDate?: string, toDate?: string, limit?: number) => Promise<{ entries: Array<Record<string, unknown>> }>;
    getPrinter2AuditLog?: (fromDate?: string, toDate?: string, limit?: number) => Promise<{ entries: Array<Record<string, unknown>> }>;
    localDbGetPaymentMethods?: () => Promise<Array<{ id?: number; code?: string; name?: string }>>;
  }

  // Load data from local MySQL database via Electron API (offline-first, same as TransactionList)
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined;
    
    try {
      if (!electronAPI?.localDbGetTransactions || !electronAPI?.getPrinter1AuditLog || !electronAPI?.getPrinter2AuditLog) {
        throw new Error('Electron local database API is not available. This page requires offline database support.');
      }
      
      console.log('📱 [PrintingLogs] Loading from local MySQL database (offline-first)');
      console.log('📱 [PrintingLogs] Fetching data for businessId:', businessId, 'from', fromDate, 'to', toDate);
      
      // Fetch transactions from local database
      const allTransactions = await electronAPI.localDbGetTransactions(businessId, 50000);
      console.log('📱 [PrintingLogs] Raw transactions received:', allTransactions.length);
      
      // Filter by date range - use same logic as TransactionList (date string comparison, not epoch)
      const txList = allTransactions
        .filter((tx: Record<string, unknown>) => {
          if (!tx.created_at) return false;
          // Convert UTC to local date for accurate filtering (same as TransactionList)
          const localDate = new Date(String(tx.created_at));
          const localDateString = localDate.getFullYear() + '-' +
            String(localDate.getMonth() + 1).padStart(2, '0') + '-' +
            String(localDate.getDate()).padStart(2, '0');
          const isInRange = localDateString >= fromDate && localDateString <= toDate;
          return isInRange;
        })
        .map((tx: Record<string, unknown>) => {
          const txId = String(tx.id || '');
          const uuidId = tx.uuid_id ? String(tx.uuid_id) : (tx.id ? String(tx.id) : undefined);
          
          return {
            id: txId,
            uuid_id: uuidId,
            payment_method: String(tx.payment_method || ''),
            payment_method_id: tx.payment_method_id !== undefined && tx.payment_method_id !== null ? Number(tx.payment_method_id) : null,
            pickup_method: String(tx.pickup_method || ''),
            final_amount: Number(tx.final_amount || 0),
            customer_name: tx.customer_name ? String(tx.customer_name) : null,
            customer_unit: tx.customer_unit !== undefined && tx.customer_unit !== null ? Number(tx.customer_unit) : null,
            created_at: String(tx.created_at || ''),
          };
        });
      
      console.log('📊 [PrintingLogs] Loaded transactions from offline DB:', txList.length);
      setTransactions(txList);
      
      // Fetch printer audits from local database
      const printer1Result = await electronAPI.getPrinter1AuditLog(fromDate, toDate, 50000);
      const printer2Result = await electronAPI.getPrinter2AuditLog(fromDate, toDate, 50000);
      
      const p1Audits = ((printer1Result?.entries || []) as Array<Record<string, unknown>>).map((a: Record<string, unknown>): Printer1Audit => ({
        transaction_id: String(a.transaction_id || ''),
        printer1_receipt_number: Number(a.printer1_receipt_number || 0),
        printed_at: a.printed_at ? String(a.printed_at) : new Date().toISOString(),
        printed_at_epoch: a.printed_at_epoch ? Number(a.printed_at_epoch) : (a.printed_at ? new Date(String(a.printed_at)).getTime() : Date.now()),
        global_counter: a.global_counter !== null && a.global_counter !== undefined ? Number(a.global_counter) : undefined,
        is_reprint: a.is_reprint !== null && a.is_reprint !== undefined ? Number(a.is_reprint) : undefined,
        reprint_count: a.reprint_count !== null && a.reprint_count !== undefined ? Number(a.reprint_count) : undefined,
      }));
      
      const p2Audits = ((printer2Result?.entries || []) as Array<Record<string, unknown>>).map((a: Record<string, unknown>): Printer2Audit => ({
        transaction_id: String(a.transaction_id || ''),
        printer2_receipt_number: Number(a.printer2_receipt_number || 0),
        print_mode: (a.print_mode as 'auto' | 'manual') || 'auto',
        cycle_number: a.cycle_number !== undefined && a.cycle_number !== null ? Number(a.cycle_number) : null,
        printed_at: a.printed_at ? String(a.printed_at) : new Date().toISOString(),
        printed_at_epoch: a.printed_at_epoch ? Number(a.printed_at_epoch) : (a.printed_at ? new Date(String(a.printed_at)).getTime() : Date.now()),
        global_counter: a.global_counter !== null && a.global_counter !== undefined ? Number(a.global_counter) : undefined,
        is_reprint: a.is_reprint !== null && a.is_reprint !== undefined ? Number(a.is_reprint) : undefined,
        reprint_count: a.reprint_count !== null && a.reprint_count !== undefined ? Number(a.reprint_count) : undefined,
      }));
      
      console.log('🖨️ [PrintingLogs] Loaded printer audits from offline DB:', {
        p1Count: p1Audits.length,
        p2Count: p2Audits.length,
      });
      
      setAudit1(p1Audits);
      setAudit2(p2Audits);
      
      // Fetch payment methods from local database
      if (electronAPI.localDbGetPaymentMethods) {
        const paymentMethods = await electronAPI.localDbGetPaymentMethods();
        const pmMapById: Record<number, string> = {};
        const pmMapByCode: Record<string, string> = {};
        paymentMethods.forEach((pm) => {
          if (pm.id && pm.name) {
            pmMapById[pm.id] = pm.name;
          }
          if (pm.code && pm.name) {
            const codeLower = pm.code.toLowerCase();
            pmMapByCode[codeLower] = pm.name;
            pmMapByCode[pm.code] = pm.name;
          }
        });
        setPaymentMethodMap({ byId: pmMapById, byCode: pmMapByCode });
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error('❌ [PrintingLogs] Failed to load printing logs:', {
        error: e,
        message: errorMessage,
        businessId,
        fromDate,
        toDate,
        electronAPI: !!electronAPI,
        hasLocalDbGetTransactions: !!electronAPI?.localDbGetTransactions,
        hasGetPrinter1AuditLog: !!electronAPI?.getPrinter1AuditLog,
        hasGetPrinter2AuditLog: !!electronAPI?.getPrinter2AuditLog,
      });
      
      // Set a user-friendly error message
      let displayError = 'Failed to load data from local database. ';
      if (errorMessage.includes('Electron local database API')) {
        displayError += 'Please ensure you are running the Electron app. The printing logs require offline database access.';
      } else {
        displayError += errorMessage.substring(0, 200);
      }
      
      setError(displayError);
      setTransactions([]);
      setAudit1([]);
      setAudit2([]);
    } finally {
      setIsLoading(false);
    }
  }, [businessId, fromDate, toDate]);

  useEffect(() => {
    // Only load data if authenticated and client-side
    if (isClient && isAuthenticated && businessId) {
      console.log('🔍 [PrintingLogs] Starting data load:', { isClient, isAuthenticated, businessId, fromDate, toDate });
      loadData().catch((err) => {
        console.error('❌ [PrintingLogs] Unhandled error in loadData:', err);
        setError(`Failed to load data: ${err instanceof Error ? err.message : String(err)}`);
        setIsLoading(false);
      });
    } else {
      console.log('⏸️ [PrintingLogs] Not loading data yet:', { isClient, isAuthenticated, businessId });
    }
  }, [isClient, isAuthenticated, businessId, fromDate, toDate, loadData]);

  // Create sets for quick lookup of printed transactions
  // Normalize transaction_id to string for consistent matching
  const txIdToReceiptPrinted = useMemo(() => {
    const set = new Set<string>();
    for (const a of audit1) {
      if (a.transaction_id) {
        // Normalize to string and add both formats if needed
        const txId = String(a.transaction_id);
        set.add(txId);
      }
    }
    console.log('✅ [PrintingLogs] Receipt printed transaction IDs (first 10):', Array.from(set).slice(0, 10));
    return set;
  }, [audit1]);

  const txIdToReceiptizePrinted = useMemo(() => {
    const set = new Set<string>();
    for (const a of audit2) {
      if (a.transaction_id) {
        // Normalize to string and add both formats if needed
        const txId = String(a.transaction_id);
        set.add(txId);
      }
    }
    console.log('✅ [PrintingLogs] Receiptize printed transaction IDs (first 10):', Array.from(set).slice(0, 10));
    return set;
  }, [audit2]);

  // Filter transactions by search query (date filtering already done in loadData)
  const filteredTxs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter(t => {
      return (
        (t.id && String(t.id).toLowerCase().includes(q)) ||
        (t.uuid_id && t.uuid_id.toLowerCase().includes(q)) ||
        (t.customer_name && t.customer_name.toLowerCase().includes(q)) ||
        (typeof t.customer_unit === 'number' && t.customer_unit.toString().includes(q))
      );
    });
  }, [transactions, search]);

  // Calculate summary statistics
  const { totalAll, totalReceiptize, percentReceiptize } = useMemo(() => {
    const all = filteredTxs.reduce((sum, t) => sum + Number(t.final_amount || 0), 0);
    const rset = new Set<string>();
    for (const a of audit2) rset.add(a.transaction_id);
    const rz = filteredTxs.reduce((sum, t) => {
      // Check both id and uuid_id for receiptize transactions
      const isReceiptize = rset.has(t.id) || (t.uuid_id && rset.has(t.uuid_id));
      return sum + (isReceiptize ? Number(t.final_amount || 0) : 0);
    }, 0);
    const pct = all > 0 ? (rz / all) * 100 : 0;
    return { totalAll: all, totalReceiptize: rz, percentReceiptize: pct };
  }, [filteredTxs, audit2]);


  // Close handler using Next.js router
  const handleClose = useCallback(() => {
    if (process.env.NODE_ENV === 'development') {
      // In development, use Next.js router for reliable navigation
      router.back();
    } else {
      // In production (Electron file://), use window.location
      window.location.href = 'index.html';
    }
  }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

  // Show loading while checking authentication or during SSR
  if (!isClient || !isAuthenticated) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm">
        <div className="absolute inset-0 bg-white w-screen h-screen rounded-none shadow-2xl overflow-hidden flex items-center justify-center">
          <div className="text-center">
            <div className="text-gray-600 text-lg mb-2">Loading...</div>
            <div className="text-xs text-gray-400">
              {!isClient && 'Initializing...'}
              {isClient && !isAuthenticated && 'Checking authentication...'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  console.log('🎨 [PrintingLogs] Rendering page:', { isClient, isAuthenticated, isLoading, error: !!error, transactionsCount: transactions.length, audit1Count: audit1.length, audit2Count: audit2.length });

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm">
      <div className="absolute inset-0 bg-white w-screen h-screen rounded-none shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-white">
          <div>
            <h1 className="text-base font-bold text-gray-900">Printing Logs</h1>
            <div className="text-xs text-gray-500 mt-0.5">Offline Database • Business ID: {businessId}</div>
          </div>
          <button 
            onClick={handleClose} 
            className="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm transition-colors"
            type="button"
            aria-label="Close printing logs"
          >
            Close
          </button>
        </div>
        <div className="p-4 flex-1 overflow-y-auto">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              <strong>Error:</strong> {error}
              <div className="mt-2 text-xs text-red-600">
                <p>Please check:</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>Open DevTools (Press F12) to see detailed console logs</li>
                  <li>Ensure you are running the built Electron app (not just the web version)</li>
                  <li>The offline database should be connected to localhost MySQL</li>
                </ul>
              </div>
            </div>
          )}
          
          {!error && isLoading && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-blue-700 text-sm">
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span>Loading printing logs from offline database...</span>
              </div>
            </div>
          )}

          <div className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded border border-gray-200 p-3 bg-gray-50">
              <div className="text-xs text-gray-600">Total Transaksi (Rp)</div>
              <div className="text-lg font-semibold text-gray-900">
                {totalAll.toLocaleString('id-ID')}
              </div>
            </div>
            <div className="rounded border border-gray-200 p-3 bg-gray-50">
              <div className="text-xs text-gray-600">Total Dicetak Receiptize (Rp)</div>
              <div className="text-lg font-semibold text-purple-700">
                {totalReceiptize.toLocaleString('id-ID')}
              </div>
            </div>
            <div className="rounded border border-gray-200 p-3 bg-gray-50">
              <div className="text-xs text-gray-600">Persentase Receiptize Terhadap Total Omset</div>
              <div className="text-lg font-semibold text-gray-900">
                {percentReceiptize.toFixed(2)}%
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-end gap-3 mb-4">
            <div className="flex items-center gap-2">
              <label htmlFor="from-date" className="text-sm text-gray-700">Dari</label>
              <input
                id="from-date"
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-black"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="to-date" className="text-sm text-gray-700">Sampai</label>
              <input
                id="to-date"
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-black"
              />
            </div>
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search UUID/Customer"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1 text-black"
                aria-label="Search transactions"
              />
            </div>
            <div>
              <button
                onClick={loadData}
                disabled={isLoading}
                className="px-3 py-1 bg-gray-700 text-white rounded hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                type="button"
                aria-label="Refresh data"
              >
                {isLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>

          <div className="border border-gray-200 rounded overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2 text-left text-black">Transaction UUID</th>
                    <th className="px-2 py-2 text-left text-black">Payment</th>
                    <th className="px-2 py-2 text-left text-black">Pickup</th>
                    <th className="px-2 py-2 text-right text-black">Total</th>
                    <th className="px-2 py-2 text-left text-black">Customer</th>
                    <th className="px-2 py-2 text-center text-black">CU</th>
                    <th className="px-2 py-2 text-center text-black">Receipt</th>
                    <th className="px-2 py-2 text-center text-black">Receiptize</th>
                    <th className="px-2 py-2 text-left text-black">Printed At (last)</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-black">
                        Loading...
                      </td>
                    </tr>
                  ) : filteredTxs.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-black">
                        No data
                      </td>
                    </tr>
                  ) : (
                    filteredTxs.map(tx => {
                      // Normalize transaction IDs to strings for matching
                      const txIdStr = String(tx.id);
                      const uuidIdStr = tx.uuid_id ? String(tx.uuid_id) : null;
                      
                      // Debug: Log transaction IDs for first transaction
                      if (tx === filteredTxs[0]) {
                        console.log('🔍 [PrintingLogs] First transaction debug:', {
                          id: tx.id,
                          idStr: txIdStr,
                          uuid_id: tx.uuid_id,
                          uuidIdStr: uuidIdStr,
                          customer_unit: tx.customer_unit,
                          receiptSetHasUuid: uuidIdStr ? txIdToReceiptPrinted.has(uuidIdStr) : false,
                          receiptSetHasId: txIdToReceiptPrinted.has(txIdStr),
                        });
                      }
                      
                      // Check if transaction was printed
                      // Printer audits use uuid_id (transaction UUID) as transaction_id
                      // Try uuid_id first (most common), then fall back to id
                      const receiptTick = (uuidIdStr && txIdToReceiptPrinted.has(uuidIdStr)) || 
                                        txIdToReceiptPrinted.has(txIdStr);
                      const receiptizeTick = (uuidIdStr && txIdToReceiptizePrinted.has(uuidIdStr)) || 
                                           txIdToReceiptizePrinted.has(txIdStr);
                      
                      // Find last printed timestamp
                      // Match by normalizing both sides to strings
                      const allAudits = [
                        ...audit1.filter(a => {
                          const auditTxId = String(a.transaction_id || '');
                          return (uuidIdStr && auditTxId === uuidIdStr) || auditTxId === txIdStr;
                        }),
                        ...audit2.filter(a => {
                          const auditTxId = String(a.transaction_id || '');
                          return (uuidIdStr && auditTxId === uuidIdStr) || auditTxId === txIdStr;
                        }),
                      ];
                      const lastPrintedEpoch = allAudits.length > 0
                        ? Math.max(...allAudits.map(a => a.printed_at_epoch || new Date(a.printed_at).getTime()))
                        : 0;
                      const lastPrintedAt = lastPrintedEpoch
                        ? new Date(lastPrintedEpoch).toLocaleString('id-ID')
                        : '';
                      return (
                        <Fragment key={tx.id}>
                          <tr className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                            <td className="px-2 py-2 font-mono text-xs text-black">
                              {tx.uuid_id || tx.id}
                            </td>
                            <td className="px-2 py-2 text-black">
                              {(() => {
                                // Priority 1: Use payment_method_id if available (most reliable)
                                if (tx.payment_method_id && paymentMethodMap.byId[tx.payment_method_id]) {
                                  return paymentMethodMap.byId[tx.payment_method_id];
                                }
                                // Priority 2: Use payment_method code (case-insensitive)
                                const codeLower = tx.payment_method?.toLowerCase() || '';
                                if (codeLower && paymentMethodMap.byCode[codeLower]) {
                                  return paymentMethodMap.byCode[codeLower];
                                }
                                // Priority 3: Try original case
                                if (tx.payment_method && paymentMethodMap.byCode[tx.payment_method]) {
                                  return paymentMethodMap.byCode[tx.payment_method];
                                }
                                // Fallback: Display raw code
                                return tx.payment_method || 'Unknown';
                              })()}
                            </td>
                            <td className="px-2 py-2 text-black">{tx.pickup_method}</td>
                            <td className="px-2 py-2 text-right text-black">
                              {Number(tx.final_amount || 0).toLocaleString('id-ID')}
                            </td>
                            <td className="px-2 py-2 text-black">{tx.customer_name || ''}</td>
                            <td className="px-2 py-2 text-center text-black">
                              {typeof tx.customer_unit === 'number' ? tx.customer_unit : '-'}
                            </td>
                            <td className="px-2 py-2 text-center text-black">{receiptTick ? '✔' : ''}</td>
                            <td className="px-2 py-2 text-center text-black">{receiptizeTick ? '✔' : ''}</td>
                            <td className="px-2 py-2 text-black">{lastPrintedAt}</td>
                          </tr>
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Details component for expanded transaction view (currently unused but kept for future use)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function Details({ transactionId, uuidId }: { transactionId: string; uuidId?: string }) {
  const [items, setItems] = useState<TransactionItem[]>([]);
  const [p1, setP1] = useState<Printer1Audit[]>([]);
  const [p2, setP2] = useState<Printer2Audit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Cancel any pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Use uuid_id if available, otherwise use transactionId
        const txId = uuidId || transactionId;
        
        // Fetch transaction details from API (includes items)
        const txUrl = getApiUrl(`/api/transactions/${txId}`);
        const txResponse = await fetch(txUrl, {
          signal: abortController.signal,
        });
        
        if (!txResponse.ok) {
          throw new Error(`Failed to fetch transaction details: ${txResponse.status} ${txResponse.statusText}`);
        }
        
        const txData = await txResponse.json();
        if (txData.success && txData.transaction) {
          const tx = txData.transaction;
          setItems((tx.items || []).map((item: Record<string, unknown>) => ({
            id: String(item.id || ''),
            product_name: String(item.product_name || ''),
            quantity: Number(item.quantity || 0),
            unit_price: Number(item.unit_price || 0),
            total_price: Number(item.total_price || 0),
          })));
        }

        // Fetch printer audits from sync endpoint
        const syncUrl = getApiUrl('/api/sync');
        const syncResponse = await fetch(syncUrl, {
          signal: abortController.signal,
        });
        
        if (syncResponse.ok) {
          const syncData = await syncResponse.json();
          // The sync API returns data nested under "data" property
          const syncResults = syncData.data || syncData;
          const p1Audits = (syncResults.printer1Audits || syncResults.printer1 || []) as Printer1Audit[];
          const p2Audits = (syncResults.printer2Audits || syncResults.printer2 || []) as Printer2Audit[];
          
          // Normalize transaction IDs to strings for matching
          const txIdStr = String(transactionId);
          const uuidIdStr = uuidId ? String(uuidId) : null;
          
          // Filter audits for this transaction (check both transactionId and uuidId)
          setP1(p1Audits.filter(a => {
            const auditTxId = String(a.transaction_id || '');
            return (uuidIdStr && auditTxId === uuidIdStr) || auditTxId === txIdStr;
          }));
          setP2(p2Audits.filter(a => {
            const auditTxId = String(a.transaction_id || '');
            return (uuidIdStr && auditTxId === uuidIdStr) || auditTxId === txIdStr;
          }));
        }
      } catch (e) {
        // Ignore abort errors
        if (e instanceof Error && e.name === 'AbortError') {
          return;
        }
        
        console.error('Failed to load details:', e);
        setError(e instanceof Error ? e.message : 'Failed to load details');
      } finally {
        setIsLoading(false);
      }
    })();

    // Cleanup on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [transactionId, uuidId]);

  if (isLoading) {
    return (
      <div className="text-center py-4 text-gray-600 text-sm">Loading details...</div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-4 text-red-600 text-sm">
        <strong>Error:</strong> {error}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="border border-gray-200 rounded">
        <div className="px-3 py-2 bg-white border-b text-gray-800 font-medium">Items</div>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left text-black">Name</th>
                <th className="px-2 py-1 text-right text-black">Qty</th>
                <th className="px-2 py-1 text-right text-black">Price</th>
                <th className="px-2 py-1 text-right text-black">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-center text-black">
                    No items
                  </td>
                </tr>
              ) : (
                items.map(it => (
                  <tr key={it.id} className="border-t border-gray-100">
                    <td className="px-2 py-1 text-black">{it.product_name}</td>
                    <td className="px-2 py-1 text-right text-black">{it.quantity}</td>
                    <td className="px-2 py-1 text-right text-black">
                      {Number(it.unit_price || 0).toLocaleString('id-ID')}
                    </td>
                    <td className="px-2 py-1 text-right text-black">
                      {Number(it.total_price || 0).toLocaleString('id-ID')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="border border-gray-200 rounded">
        <div className="px-3 py-2 bg-white border-b text-gray-800 font-medium">Print Events</div>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left text-black">Printer</th>
                <th className="px-2 py-1 text-left text-black">Mode</th>
                <th className="px-2 py-1 text-right text-black">Counter</th>
                <th className="px-2 py-1 text-left text-black">Printed At</th>
              </tr>
            </thead>
            <tbody>
              {p1.map(e => (
                <tr key={`p1-${e.printed_at_epoch}`} className="border-t border-gray-100">
                  <td className="px-2 py-1 text-black">Receipt</td>
                  <td className="px-2 py-1 text-black">manual</td>
                  <td className="px-2 py-1 text-right text-black">{e.printer1_receipt_number}</td>
                  <td className="px-2 py-1 text-black">
                    {new Date(e.printed_at).toLocaleString('id-ID')}
                  </td>
                </tr>
              ))}
              {p2.map(e => (
                <tr key={`p2-${e.printed_at_epoch}`} className="border-t border-gray-100">
                  <td className="px-2 py-1 text-black">Receiptize</td>
                  <td className="px-2 py-1 text-black">{e.print_mode}</td>
                  <td className="px-2 py-1 text-right text-black">{e.printer2_receipt_number}</td>
                  <td className="px-2 py-1 text-black">
                    {new Date(e.printed_at).toLocaleString('id-ID')}
                  </td>
                </tr>
              ))}
              {p1.length === 0 && p2.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-center text-black">
                    No print events
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
