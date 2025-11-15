'use client';

import { useState, useEffect, useCallback } from 'react';
import { Calendar, Clock, CreditCard, RefreshCw, Search, Filter, ChevronUp, ChevronDown, Wifi, WifiOff } from 'lucide-react';
import TransactionDetailModal from './TransactionDetailModal';
import { offlineSyncService } from '@/lib/offlineSync';

// Format price for display (hoisted to module scope so it can be reused)
const formatPrice = (price: number | string) => {
  const numPrice = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(numPrice)) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(numPrice);
};

interface Transaction {
  id: string; // Changed to string for UUID
  business_id: number;
  user_id: number;
  payment_method: 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher' | 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
  pickup_method: 'dine-in' | 'take-away';
  total_amount: number;
  voucher_discount: number;
  final_amount: number;
  amount_received: number;
  change_amount: number;
  contact_id: number | null;
  customer_name: string | null;
  customer_unit?: number | null;
  note: string | null;
  receipt_number: number | null;
  transaction_type: 'drinks' | 'bakery';
  status: string;
  created_at: string;
  user_name?: string;
  business_name?: string;
  voucher_type?: 'none' | 'percent' | 'nominal' | 'free';
  voucher_value?: number | null;
  voucher_label?: string | null;
}

interface TransactionItem {
  id: string; // Changed to string for UUID
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  notes?: string;
}

interface TransactionDetail {
  id: string; // Changed to string for UUID
  business_id: number;
  user_id: number;
  user_name: string;
  business_name: string;
  payment_method: 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher' | 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
  pickup_method: 'dine-in' | 'take-away';
  total_amount: number;
  voucher_discount: number;
  final_amount: number;
  amount_received: number;
  change_amount: number;
  contact_id?: number | null;
  customer_name?: string | null;
  customer_unit?: number | null;
  bank_id?: number | null;
  bank_name?: string | null;
  card_number?: string | null;
  cl_account_id?: number | null;
  cl_account_name?: string | null;
  created_at: string;
  items: TransactionItem[];
  voucher_type?: 'none' | 'percent' | 'nominal' | 'free';
  voucher_value?: number | null;
  voucher_label?: string | null;
}

interface TransactionListProps {
  businessId?: number;
}

export default function TransactionList({ businessId = 14 }: TransactionListProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMethod, setFilterMethod] = useState<string>('all');
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [receiptizePrintedIds, setReceiptizePrintedIds] = useState<Set<string>>(() => new Set());
  const [receiptizeCounters, setReceiptizeCounters] = useState<Record<string, number>>({});
  const [refreshSuccessCount, setRefreshSuccessCount] = useState(0);
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  
  // Get today's date in UTC+7 timezone
  const getTodayUTC7 = () => {
    const now = new Date();
    const utc7Time = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    return utc7Time.toISOString().split('T')[0];
  };
  
  const [fromDate, setFromDate] = useState<string>(getTodayUTC7());
  const [toDate, setToDate] = useState<string>(getTodayUTC7());
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionDetail | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [loadingTransactionId, setLoadingTransactionId] = useState<string | null>(null);
  const [copiedUuid, setCopiedUuid] = useState<string | null>(null);
  const [isOnlineMode, setIsOnlineMode] = useState(false); // Default to offline mode

  // Fetch transaction details with offline fallback
  const fetchTransactionDetail = async (transactionId: string) => {
    setIsLoadingDetail(true);
    try {
      const response = await offlineSyncService.fetchWithFallback(
        // Online fetch
        async () => {
      const response = await fetch(`/api/transactions/${transactionId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch transaction details');
      }
      const data = await response.json();
      if (data.success) {
            return data.transaction;
      } else {
        throw new Error(data.message || 'Failed to fetch transaction details');
      }
        },
        // Offline fetch
        async () => {
          if (typeof window === 'undefined' || !(window as any).electronAPI) {
            throw new Error('Offline database not available');
          }
          
          // Get transaction from local database
          const transactions = await (window as any).electronAPI.localDbGetTransactions(businessId, 1000);
          const transaction = transactions.find((tx: any) => tx.id === transactionId);
          
          if (!transaction) {
            throw new Error('Transaction not found in offline database');
          }
          
          // Get transaction items
          const items = await (window as any).electronAPI.localDbGetTransactionItems(transactionId);
          
          // Get all products to map product_id to product_name
          const products = await (window as any).electronAPI.localDbGetAllProducts();
          
          // Get users and businesses to show actual names
          const users = await (window as any).electronAPI.localDbGetUsers();
          const businesses = await (window as any).electronAPI.localDbGetBusinesses();
          
          const user = users.find((u: any) => u.id === transaction.user_id);
          const business = businesses.find((b: any) => b.id === transaction.business_id);
          
          return {
            ...transaction,
            items: items.map((item: any) => {
              const product = products.find((p: any) => p.id === item.product_id);
              return {
                id: item.id,
                product_name: product?.nama || 'Unknown Product',
                quantity: item.quantity,
                unit_price: item.unit_price,
                total_price: item.total_price,
                custom_note: item.custom_note,
                customizations_json: item.customizations_json || null,
                bundle_selections_json: item.bundle_selections_json || null
              };
            }),
            user_name: user?.name || 'Unknown User',
            business_name: business?.name || 'Unknown Business'
          };
        }
      );
      
      setSelectedTransaction(response);
      setIsDetailModalOpen(true);
    } catch (error: any) {
      console.error('Error fetching transaction details:', error);
      setError(error.message);
    } finally {
      setIsLoadingDetail(false);
      setLoadingTransactionId(null);
    }
  };

  // Handle row click
  const handleRowClick = (transactionId: string) => {
    setLoadingTransactionId(transactionId);
    setIsLoadingDetail(true);
    setIsDetailModalOpen(true);
    fetchTransactionDetail(transactionId);
  };

  // Close detail modal
  const handleCloseDetailModal = () => {
    setIsDetailModalOpen(false);
    setSelectedTransaction(null);
    setLoadingTransactionId(null);
  };

  // Handle UUID copy with notification
  const handleCopyUuid = async (uuid: string, event?: React.MouseEvent) => {
    try {
      // Prevent default to maintain focus
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      
      // Use fallback method that works better in Electron
      const textArea = document.createElement('textarea');
      textArea.value = uuid;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '0';
      textArea.style.opacity = '0';
      textArea.setAttribute('readonly', '');
      document.body.appendChild(textArea);
      
      // Focus and select
      textArea.focus();
      textArea.select();
      textArea.setSelectionRange(0, uuid.length);
      
      // Try clipboard API first (with focus fix)
      try {
        if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(uuid);
        } else {
          // Fallback for non-secure contexts
          const successful = document.execCommand('copy');
          if (!successful) {
            throw new Error('execCommand copy failed');
          }
        }
      } catch (clipboardError) {
        // Final fallback: use execCommand
        const successful = document.execCommand('copy');
        if (!successful) {
          throw new Error('All copy methods failed');
        }
      }
      
      // Clean up
      document.body.removeChild(textArea);
      
      setCopiedUuid(uuid);
      // Auto-hide after 2 seconds
      setTimeout(() => {
        setCopiedUuid(null);
      }, 2000);
    } catch (error) {
      console.error('Failed to copy UUID:', error);
      // Show error to user
      alert('Gagal menyalin UUID. Silakan salin manual: ' + uuid);
    }
  };

  interface ReceiptizeFetchResult {
    success: boolean;
    ids: Set<string>;
    counters: Record<string, number>;
  }

  const fetchReceiptizePrintedIds = useCallback(async (): Promise<ReceiptizeFetchResult> => {
    if (typeof window === 'undefined' || !(window as any).electronAPI?.getPrinter2AuditLog) {
      console.warn('Receiptize audit log API unavailable');
      return { success: false, ids: new Set<string>(), counters: {} };
    }

    try {
      const response = await (window as any).electronAPI.getPrinter2AuditLog(fromDate, toDate, 2000);
      const entries = Array.isArray(response?.entries) ? response.entries : [];
      const ids = new Set<string>();
      const latestCounters: Record<string, { counter: number; epoch: number }> = {};

      for (const entry of entries) {
        if (entry?.transaction_id == null) continue;
        const txId = String(entry.transaction_id);
        ids.add(txId);

        const counterValue = Number(entry.printer2_receipt_number);
        const epochValue = Number(entry.printed_at_epoch ?? 0);
        if (Number.isNaN(counterValue)) continue;

        const existing = latestCounters[txId];
        if (!existing || epochValue >= existing.epoch) {
          latestCounters[txId] = { counter: counterValue, epoch: epochValue };
        }
      }

      const counters: Record<string, number> = {};
      Object.entries(latestCounters).forEach(([txId, info]) => {
        counters[txId] = info.counter;
      });

      return { success: true, ids, counters };
    } catch (err) {
      console.error('Failed to fetch Receiptize audit log:', err);
      return { success: false, ids: new Set<string>(), counters: {} };
    }
  }, [fromDate, toDate]);

  // Fetch transactions function
  const fetchTransactions = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    
    try {
      let transactionsData: Transaction[];
      
      if (isOnlineMode) {
        // Fetch from online API only
        const response = await fetch(`/api/transactions?business_id=${businessId}&from_date=${fromDate}&to_date=${toDate}&limit=1000`);
        if (!response.ok) {
          throw new Error('Failed to fetch transactions');
        }
        const data = await response.json();
        transactionsData = (data.transactions || []).map((tx: any) => ({
          ...tx,
          voucher_value: tx.voucher_value !== undefined && tx.voucher_value !== null ? parseFloat(tx.voucher_value) : null,
          voucher_discount: tx.voucher_discount !== undefined && tx.voucher_discount !== null ? parseFloat(tx.voucher_discount) : 0,
          voucher_type: tx.voucher_type || 'none',
          voucher_label: tx.voucher_label || null,
          customer_unit: tx.customer_unit !== undefined && tx.customer_unit !== null ? Number(tx.customer_unit) : null
        }));
      } else {
        // Fetch from offline database only
        if (typeof window === 'undefined' || !(window as any).electronAPI) {
          throw new Error('Offline database not available');
        }
        
        const offlineTransactions = await (window as any).electronAPI.localDbGetTransactions(businessId, 100);
        
        // Get users and businesses to show actual names (fetch once for all transactions)
        const users = await (window as any).electronAPI.localDbGetUsers();
        const businesses = await (window as any).electronAPI.localDbGetBusinesses();
        
        // Show ALL unique LOCAL dates in the database for debugging
        const allDates = [...new Set(offlineTransactions.map((tx: any) => {
          const localDate = new Date(tx.created_at);
          const dateString = localDate.getFullYear() + '-' + 
            String(localDate.getMonth() + 1).padStart(2, '0') + '-' + 
            String(localDate.getDate()).padStart(2, '0');
          console.log(`📅 [OFFLINE] Transaction ${tx.id}: raw=${tx.created_at}, parsed=${localDate.toISOString()}, dateString=${dateString}`);
          return dateString;
        }))].sort();
        console.log('📱 [OFFLINE] Total:', offlineTransactions.length, '| Date range:', fromDate, 'to', toDate, '| Available dates:', allDates);
        
        // Filter by date range - need to convert to local date for comparison
        const filteredTransactions = offlineTransactions.filter((tx: any) => {
          // Convert UTC to local date for accurate filtering
          const localDate = new Date(tx.created_at);
          const localDateString = localDate.getFullYear() + '-' + 
            String(localDate.getMonth() + 1).padStart(2, '0') + '-' + 
            String(localDate.getDate()).padStart(2, '0');
          const isInRange = localDateString >= fromDate && localDateString <= toDate;
          if (!isInRange && localDateString === '2025-10-27') {
            console.log(`❌ [OFFLINE] Transaction ${tx.id} excluded: date=${localDateString}, range=${fromDate} to ${toDate}`);
          }
          return isInRange;
        });
        
        console.log('📱 [OFFLINE] Found:', filteredTransactions.length, 'transactions from', fromDate, 'to', toDate);
        
        transactionsData = filteredTransactions.map((tx: any) => {
          const user = users.find((u: any) => u.id === tx.user_id);
          const business = businesses.find((b: any) => b.id === tx.business_id);
          
          return {
            id: tx.id,
            business_id: tx.business_id,
            user_id: tx.user_id,
            payment_method: tx.payment_method,
            pickup_method: tx.pickup_method,
            total_amount: tx.total_amount,
            voucher_discount: tx.voucher_discount || 0,
            voucher_type: tx.voucher_type || 'none',
            voucher_value: tx.voucher_value !== undefined && tx.voucher_value !== null ? Number(tx.voucher_value) : null,
            voucher_label: tx.voucher_label || null,
            final_amount: tx.final_amount,
            amount_received: tx.amount_received,
            change_amount: tx.change_amount || 0,
            contact_id: tx.contact_id,
            customer_name: tx.customer_name,
            customer_unit: tx.customer_unit !== undefined && tx.customer_unit !== null ? Number(tx.customer_unit) : null,
            note: tx.note || null,
            receipt_number: tx.receipt_number,
            transaction_type: tx.transaction_type || 'drinks',
            status: tx.status || 'completed',
            created_at: tx.created_at,
            user_name: user?.name || 'Unknown User',
            business_name: business?.name || 'Unknown Business'
          };
        });
        
      }
      
      setTransactions(transactionsData);

      const receiptizeResult = await fetchReceiptizePrintedIds();
      setReceiptizePrintedIds(receiptizeResult.ids);
      setReceiptizeCounters(receiptizeResult.counters);

      if (!receiptizeResult.success) {
        setError(prev => prev ?? 'Failed to fetch Receiptize print history');
        return false;
      }

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch transactions';
      setError(errorMessage);
      console.error('Error fetching transactions:', err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isOnlineMode, fromDate, toDate, businessId, fetchReceiptizePrintedIds]);

  // Fetch transactions on mount and when dependencies change
  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  useEffect(() => {
    setShowAllTransactions(false);
    setRefreshSuccessCount(0);
    setReceiptizeCounters({});
    setReceiptizePrintedIds(new Set<string>());
  }, [businessId, fromDate, toDate, isOnlineMode]);

  const handleRefresh = useCallback(async () => {
    const success = await fetchTransactions();
    if (!success) {
      return;
    }

    setRefreshSuccessCount(prev => {
      const next = Math.min(prev + 1, 5);
      if (next >= 5) {
        setShowAllTransactions(true);
      }
      return next;
    });
  }, [fetchTransactions]);

  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Get payment method label
  const getPaymentMethodLabel = (method: string) => {
    const labels: { [key: string]: string } = {
      'cash': 'Cash',
      'debit': 'Debit',
      'qr': 'QR Code',
      'ewallet': 'E-Wallet',
      'cl': 'City Ledger',
      'voucher': 'Voucher',
      'qpon': 'Qpon',
      'gofood': 'GoFood',
      'grabfood': 'GrabFood',
      'shopeefood': 'ShopeeFood',
      'tiktok': 'TikTok'
    };
    return labels[method] || method;
  };

  // Get payment method color
  const getPaymentMethodColor = (method: string) => {
    const colors: { [key: string]: string } = {
      'cash': 'bg-green-100 text-green-800',
      'debit': 'bg-blue-100 text-blue-800',
      'qr': 'bg-purple-100 text-purple-800',
      'ewallet': 'bg-orange-100 text-orange-800',
      'cl': 'bg-gray-100 text-gray-800',
      'voucher': 'bg-yellow-100 text-yellow-800',
      'qpon': 'bg-indigo-100 text-indigo-800',
      'gofood': 'bg-teal-100 text-teal-800',
      'grabfood': 'bg-green-100 text-green-800',
      'shopeefood': 'bg-orange-100 text-orange-800',
      'tiktok': 'bg-red-100 text-red-800'
    };
    return colors[method] || 'bg-gray-100 text-gray-800';
  };

  // Get sort icon for column headers
  const getSortIcon = (field: string) => {
    if (sortField !== field) {
      return <ChevronUp className="w-3 h-3 text-gray-400" />;
    }
    return sortDirection === 'asc' 
      ? <ChevronUp className="w-3 h-3 text-blue-600" />
      : <ChevronDown className="w-3 h-3 text-blue-600" />;
  };

  // Handle column sorting
  const handleSort = (field: string) => {
    if (sortField === field) {
      // Toggle direction if same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Apply Receiptize filter unless full list unlocked
  const baseTransactions = showAllTransactions
    ? transactions
    : transactions.filter(transaction => receiptizePrintedIds.has(String(transaction.id)));

  const resolveReceiptSequence = (tx: Transaction) => {
    const txId = String(tx.id);
    const receiptizeCounter = receiptizeCounters[txId];
    if (typeof receiptizeCounter === 'number' && receiptizeCounter > 0) {
      return receiptizeCounter;
    }
    return typeof tx.receipt_number === 'number' ? tx.receipt_number : 0;
  };

  // Filter and sort transactions
  const filteredTransactions = baseTransactions
    .filter(transaction => {
      const matchesSearch = searchTerm === '' || 
        transaction.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        transaction.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (transaction.customer_unit !== undefined && transaction.customer_unit !== null && transaction.customer_unit.toString().includes(searchTerm)) ||
        transaction.payment_method.toLowerCase().includes(searchTerm.toLowerCase()) ||
        transaction.receipt_number?.toString().includes(searchTerm) ||
        transaction.voucher_label?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesFilter = filterMethod === 'all' || transaction.payment_method === filterMethod;
      
      return matchesSearch && matchesFilter;
    })
    .sort((a, b) => {
      let aValue: any = a[sortField as keyof Transaction];
      let bValue: any = b[sortField as keyof Transaction];

      // Handle different data types
      if (sortField === 'receipt_number') {
        aValue = resolveReceiptSequence(a);
        bValue = resolveReceiptSequence(b);
      } else if (sortField === 'id' || sortField === 'total_amount' || sortField === 'voucher_discount' || sortField === 'final_amount' || sortField === 'amount_received' || sortField === 'change_amount' || sortField === 'customer_unit') {
        aValue = typeof aValue === 'string' ? parseFloat(aValue) : aValue;
        bValue = typeof bValue === 'string' ? parseFloat(bValue) : bValue;
      } else if (sortField === 'created_at') {
        aValue = new Date(aValue).getTime();
        bValue = new Date(bValue).getTime();
      } else {
        // String fields
        aValue = aValue?.toString().toLowerCase() || '';
        bValue = bValue?.toString().toLowerCase() || '';
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

  // Calculate totals
  const totalTransactions = filteredTransactions.length;
  const totalRevenue = filteredTransactions.reduce((sum, t) => {
    const amount = typeof t.final_amount === 'string' ? parseFloat(t.final_amount) : t.final_amount;
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0);
  const totalVoucherDiscount = filteredTransactions.reduce((sum, t) => {
    const amount = typeof t.voucher_discount === 'string' ? parseFloat(t.voucher_discount) : t.voucher_discount;
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0);
  const totalCustomerUnit = filteredTransactions.reduce((sum, t) => {
    const value = typeof t.customer_unit === 'number' ? t.customer_unit : 0;
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  // Aggregations for footer
  const paymentMethodCounts: Record<string, number> = {
    cash: 0,
    debit: 0,
    qr: 0,
    ewallet: 0,
    cl: 0,
    voucher: 0,
    qpon: 0,
    gofood: 0,
    grabfood: 0,
    shopeefood: 0,
    tiktok: 0,
  };

  let dineInCount = 0;
  let takeAwayCount = 0;
  let voucherCount = 0;

  filteredTransactions.forEach((t) => {
    paymentMethodCounts[t.payment_method] = (paymentMethodCounts[t.payment_method] || 0) + 1;
    if (t.pickup_method === 'dine-in') dineInCount += 1;
    if (t.pickup_method === 'take-away') takeAwayCount += 1;
    const vd = typeof t.voucher_discount === 'string' ? parseFloat(t.voucher_discount) : t.voucher_discount;
    if (!isNaN(vd) && vd > 0) voucherCount += 1;
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600 text-lg">Loading transactions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white h-full">
      <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full px-3 py-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800">
            Daftar Transaksi | {new Date(fromDate).toLocaleDateString('id-ID', {
              day: 'numeric',
              month: 'short',
              year: 'numeric'
            })} - {new Date(toDate).toLocaleDateString('id-ID', {
              day: 'numeric',
              month: 'short',
              year: 'numeric'
            })}
          </h1>
          
          {/* Online/Offline Toggle */}
          <div className="flex items-center gap-3">
            <span className={`text-sm font-medium ${!isOnlineMode ? 'text-gray-900' : 'text-gray-500'}`}>
              <WifiOff className="inline w-4 h-4 mr-1" />
              Offline
            </span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isOnlineMode}
                onChange={(e) => setIsOnlineMode(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
            <span className={`text-sm font-medium ${isOnlineMode ? 'text-gray-900' : 'text-gray-500'}`}>
              <Wifi className="inline w-4 h-4 mr-1" />
              Online
            </span>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6 flex-shrink-0">
          {/* Payment Methods Card */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:col-span-3">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <h3 className="font-semibold text-gray-900 text-sm">Metode Pembayaran</h3>
            </div>
            <div className="grid grid-cols-4 gap-x-3 gap-y-1.5 text-xs">
              {/* Column 1 */}
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-gray-600">Cash</span>
                  <span className="font-medium text-gray-900">{paymentMethodCounts.cash}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Debit</span>
                  <span className="font-medium text-gray-900">{paymentMethodCounts.debit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">QR</span>
                  <span className="font-medium text-gray-900">{paymentMethodCounts.qr}</span>
                </div>
              </div>
              
              {/* Column 2 */}
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-gray-600">E-Wallet</span>
                  <span className="font-medium text-gray-900">{paymentMethodCounts.ewallet}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">CL</span>
                  <span className="font-medium text-gray-900">{paymentMethodCounts.cl}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">GoFood</span>
                  <span className="font-medium text-gray-900">{paymentMethodCounts.gofood}</span>
                </div>
              </div>

              {/* Column 3 */}
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-gray-600">GrabFood</span>
                  <span className="font-medium text-gray-900">{paymentMethodCounts.grabfood}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">ShopeeFood</span>
                  <span className="font-medium text-gray-900">{paymentMethodCounts.shopeefood}</span>
                </div>
              </div>

              {/* Column 4 */}
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-gray-600">TikTok</span>
                  <span className="font-medium text-gray-900">{paymentMethodCounts.tiktok}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Qpon</span>
                  <span className="font-medium text-gray-900">{paymentMethodCounts.qpon}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Voucher</span>
                  <span className="font-medium text-gray-900">{paymentMethodCounts.voucher}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Pickup Methods Card */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <h3 className="font-semibold text-gray-900 text-sm">Metode Pengambilan</h3>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-xs text-gray-600">Dine In</span>
                <span className="text-xs font-medium text-gray-900">{dineInCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-600">Take Away</span>
                <span className="text-xs font-medium text-gray-900">{takeAwayCount}</span>
              </div>
            </div>
          </div>

          {/* Voucher Card */}
          <div
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-4"
            onClick={(() => {
              let clicks = 0;
              let last = 0;
              return () => {
                const now = Date.now();
                if (now - last > 3000) {
                  clicks = 0;
                }
                clicks += 1;
                last = now;
                if (clicks >= 5) {
                  clicks = 0;
                  last = 0;
                  (window as any).electronAPI?.navigateTo?.('/logs/printing');
                }
              };
            })()}
            role="button"
            aria-label="Voucher Card"
            title="Voucher"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
              <h3 className="font-semibold text-gray-900 text-sm">Voucher</h3>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-xs text-gray-600">Jumlah Voucher</span>
                <span className="text-xs font-medium text-gray-900">{voucherCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-600">Total Diskon</span>
                <span className="text-xs font-medium text-green-700">{formatPrice(totalVoucherDiscount)}</span>
              </div>
            </div>
          </div>

          {/* Grand Total Card */}
          <GrandTotalCard totalRevenue={totalRevenue} totalCustomerUnit={totalCustomerUnit} />
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6 flex-shrink-0">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Cari transaksi..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Dari:</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
            />
            <label className="text-sm font-medium text-gray-700">Sampai:</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
            />
          </div>
          
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <select
              value={filterMethod}
              onChange={(e) => setFilterMethod(e.target.value)}
              className="pl-10 pr-8 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white text-black"
            >
              <option value="all" className="text-black">Semua Metode</option>
              <option value="cash" className="text-black">Cash</option>
              <option value="debit" className="text-black">Debit</option>
              <option value="qr" className="text-black">QR Code</option>
              <option value="ewallet" className="text-black">E-Wallet</option>
              <option value="cl" className="text-black">City Ledger</option>
              <option value="voucher" className="text-black">Voucher</option>
              <option value="gofood" className="text-black">GoFood</option>
              <option value="grabfood" className="text-black">GrabFood</option>
              <option value="shopeefood" className="text-black">ShopeeFood</option>
              <option value="qpon" className="text-black">Qpon</option>
              <option value="tiktok" className="text-black">TikTok</option>
            </select>
          </div>
          
          <button
            onClick={handleRefresh}
            className="flex items-center space-x-2 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh</span>
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex-shrink-0">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Info Message for Offline Mode */}
        {!isOnlineMode && transactions.length === 0 && !error && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" />
              <div>
                <p className="text-blue-800 font-medium">No transactions found for this date in offline database</p>
                <p className="text-blue-600 text-sm mt-1">
                  Try syncing data from online database or select a different date. 
                  Check console for available dates in offline database.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Transactions Table Container */}
        <div className="flex-1 flex flex-col min-h-0 mb-8" style={{ maxHeight: 'calc(100vh - 390px)' }}>
          {filteredTransactions.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <CreditCard className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">Tidak ada transaksi</h3>
                <p className="text-gray-500">Belum ada transaksi hari ini</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden h-full">
              <div className="overflow-y-auto flex-1">
                <table className="w-full table-fixed">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th 
                      className="px-2 py-3 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-16"
                      onClick={() => handleSort('receipt_number')}
                    >
                      <div className="flex items-center gap-1">
                        <span className="text-[10px]">#</span>
                        {getSortIcon('receipt_number')}
                      </div>
                    </th>
                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                      <div className="flex items-center gap-1">
                        <span className="text-xs">UUID</span>
                      </div>
                    </th>
                    <th 
                      className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-20"
                      onClick={() => handleSort('transaction_type')}
                    >
                      <div className="flex items-center gap-1">
                        Type
                        {getSortIcon('transaction_type')}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('created_at')}
                    >
                      <div className="flex items-center gap-1">
                        Waktu
                        {getSortIcon('created_at')}
                      </div>
                    </th>
                    <th 
                      className="px-2 py-3 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-20"
                      onClick={() => handleSort('payment_method')}
                    >
                      <div className="flex items-center gap-1">
                        <span className="text-[10px]">M.Pembayaran</span>
                        {getSortIcon('payment_method')}
                      </div>
                    </th>
                    <th 
                      className="px-2 py-3 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-16"
                      onClick={() => handleSort('pickup_method')}
                    >
                      <div className="flex items-center gap-1">
                        <span className="text-[10px]">DI/TA</span>
                        {getSortIcon('pickup_method')}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('total_amount')}
                    >
                      <div className="flex items-center gap-1">
                        Total
                        {getSortIcon('total_amount')}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('voucher_discount')}
                    >
                      <div className="flex items-center gap-1">
                        Disc/Vc
                        {getSortIcon('voucher_discount')}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('final_amount')}
                    >
                      <div className="flex items-center gap-1">
                        Final
                        {getSortIcon('final_amount')}
                      </div>
                    </th>
                    <th 
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-12"
                      onClick={() => handleSort('customer_unit')}
                    >
                      <div className="flex items-center gap-1">
                        CU
                        {getSortIcon('customer_unit')}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('customer_name')}
                    >
                      <div className="flex items-center gap-1">
                        Pelanggan
                        {getSortIcon('customer_name')}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('user_name')}
                    >
                      <div className="flex items-center gap-1">
                        Kasir
                        {getSortIcon('user_name')}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('note')}
                    >
                      <div className="flex items-center gap-1">
                        Catatan
                        {getSortIcon('note')}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredTransactions.map((transaction, index) => (
                    <tr 
                      key={transaction.id} 
                      className={`hover:bg-gray-50 cursor-pointer transition-colors ${index % 2 === 0 ? 'bg-blue-50' : 'bg-white'} ${loadingTransactionId === transaction.id ? 'opacity-50' : ''}`}
                      onClick={() => handleRowClick(transaction.id)}
                    >
                      <td className="px-2 py-4 whitespace-nowrap">
                        <span className="text-xs font-medium text-blue-600">
                          {(() => {
                            const txId = String(transaction.id);
                            const receiptizeCounter = receiptizeCounters[txId];
                            if (typeof receiptizeCounter === 'number' && receiptizeCounter > 0) {
                              return `#${receiptizeCounter}`;
                            }
                            if (showAllTransactions) {
                              return transaction.receipt_number ? `#${transaction.receipt_number}` : '#N/A';
                            }
                            return '#N/A';
                          })()}
                        </span>
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent row click
                            handleCopyUuid(String(transaction.id), e);
                          }}
                          className="p-1 hover:bg-gray-200 rounded transition-colors"
                          title={`Copy UUID: ${String(transaction.id)}`}
                        >
                          <svg className="w-4 h-4 text-gray-500 hover:text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          transaction.transaction_type === 'drinks' 
                            ? 'bg-blue-100 text-blue-800' 
                            : 'bg-orange-100 text-orange-800'
                        }`}>
                          {transaction.transaction_type === 'drinks' ? '🥤' : '🥖'} {transaction.transaction_type}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-[10px] text-gray-900">
                          {formatDate(transaction.created_at)}
                        </span>
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getPaymentMethodColor(transaction.payment_method)}`}>
                          {getPaymentMethodLabel(transaction.payment_method)}
                        </span>
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap">
                        <span className="text-xs text-gray-900 capitalize">
                          {transaction.pickup_method.replace('-', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-xs font-medium text-gray-900">
                          {formatPrice(transaction.total_amount)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {transaction.voucher_discount > 0 ? (
                          <div className="flex flex-col">
                            <span className="text-xs text-green-600 font-medium">
                              -{formatPrice(transaction.voucher_discount)}
                            </span>
                            {transaction.voucher_label && (
                              <span className="text-[10px] text-green-500 font-medium">
                                {transaction.voucher_label}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-xs font-bold text-gray-900">
                          {formatPrice(transaction.final_amount)}
                        </span>
                      </td>
                      <td className="px-2 py-4 whitespace-nowrap">
                        <span className="text-xs text-gray-900">
                          {transaction.customer_unit !== undefined && transaction.customer_unit !== null
                            ? transaction.customer_unit
                            : '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span 
                          className="text-xs text-gray-900 truncate block max-w-[120px]" 
                          title={transaction.customer_name || 'Guest'}
                        >
                          {transaction.customer_name || 'Guest'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span 
                          className="text-xs text-gray-900 truncate block max-w-[120px]" 
                          title={transaction.user_name || 'Unknown'}
                        >
                          {transaction.user_name || 'Unknown'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span 
                          className="text-xs text-gray-500 italic truncate block max-w-[120px]" 
                          title={transaction.note || '-'}
                        >
                          {transaction.note || '-'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Transaction Detail Modal */}
      <TransactionDetailModal
        isOpen={isDetailModalOpen}
        onClose={handleCloseDetailModal}
        transaction={selectedTransaction}
        isLoading={isLoadingDetail}
      />

      {/* Copy Notification */}
      {copiedUuid && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in-out">
          <div className="bg-black text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-medium">Copied UUID!</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface GrandTotalCardProps {
  totalRevenue: number;
  totalCustomerUnit: number;
}

function GrandTotalCard({ totalRevenue, totalCustomerUnit }: GrandTotalCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:col-span-1">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
        <h3 className="font-semibold text-gray-900 text-sm">Grand Total</h3>
      </div>
      <div className="text-center">
        <div className="text-lg font-bold text-gray-900">{formatPrice(totalRevenue)}</div>
        <div className="text-xs text-gray-600 mt-2">
          Total Customer Unit: <span className="font-semibold text-gray-900">{totalCustomerUnit}</span>
        </div>
      </div>
    </div>
  );
}