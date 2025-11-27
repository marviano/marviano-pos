'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Calendar, 
  User, 
  ChevronRight,
  ChevronDown,
  Filter,
  Download,
  RefreshCw,
  DollarSign,
  CreditCard,
  Search,
  X,
  CheckCircle,
  XCircle,
  Clock
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

// Types
interface Transaction {
  id: string;
  business_id: number;
  user_id: number;
  user_name?: string;
  shift_uuid?: string;
  payment_method: string;
  payment_method_id?: number;
  pickup_method: string;
  total_amount: number;
  voucher_discount?: number;
  final_amount: number;
  amount_received?: number;
  change_amount?: number;
  customer_name: string | null;
  customer_unit?: number | null;
  receipt_number: number | null;
  transaction_type: string;
  status: string;
  refund_status?: string;
  refund_total?: number;
  created_at: string;
  synced_at?: number | null;
  platform?: string;
}

interface TransactionItem {
  id?: number;
  transaction_id: string;
  product_id: number;
  product_name?: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  custom_note?: string | null;
  customizations?: unknown;
}

interface UserOption {
  user_id: number;
  user_name: string;
}

// Helper functions
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

const formatDateTime = (dateString: string): string => {
  return new Date(dateString).toLocaleString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  debit: 'Debit',
  qr: 'QR Code',
  ewallet: 'E-Wallet',
  cl: 'Credit Line',
  voucher: 'Voucher',
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopeefood: 'ShopeeFood',
  tiktok: 'TikTok',
  qpon: 'Qpon',
};

const formatPaymentMethod = (method: string): string => {
  return PAYMENT_METHOD_LABELS[method.toLowerCase()] || method;
};

const PLATFORM_LABELS: Record<string, string> = {
  offline: 'Offline',
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopeefood: 'ShopeeFood',
  qpon: 'Qpon',
  tiktok: 'TikTok',
};

const formatPlatform = (platform: string | undefined): string => {
  if (!platform) return 'Offline';
  return PLATFORM_LABELS[platform.toLowerCase()] || platform;
};

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function TransactionsReport() {
  const { user } = useAuth();
  const businessId = user?.selectedBusinessId ?? 14;
  
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [selectedTransactionItems, setSelectedTransactionItems] = useState<TransactionItem[]>([]);
  
  // Filters
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<Transaction[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedSyncStatus, setSelectedSyncStatus] = useState<string>('all');
  
  const [isLoading, setIsLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(true);

  // Stats
  const [stats, setStats] = useState({
    totalTransactions: 0,
    totalAmount: 0,
    totalFinalAmount: 0,
    totalDiscount: 0,
    syncedCount: 0,
    unsyncedCount: 0,
  });

  // Load users on mount
  useEffect(() => {
    const loadUsers = async () => {
      const electronAPI = getElectronAPI();
      if (electronAPI?.localDbGetShiftUsers) {
        const usersData = await electronAPI.localDbGetShiftUsers();
        setUsers(usersData as UserOption[]);
      }
    };
    loadUsers();
    
    // Set default date range (Last 30 days)
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    
    setEndDate(end.toISOString().split('T')[0]);
    setStartDate(start.toISOString().split('T')[0]);
  }, []);

  // Fetch transactions
  const fetchTransactions = useCallback(async () => {
    setIsLoading(true);
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetTransactions) {
        console.error('localDbGetTransactions not available');
        return;
      }

      // Get all transactions (no limit for comprehensive report)
      const allTransactions = await electronAPI.localDbGetTransactions(businessId, 50000);
      
      if (Array.isArray(allTransactions)) {
        setTransactions(allTransactions as Transaction[]);
      } else {
        setTransactions([]);
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
      setTransactions([]);
    } finally {
      setIsLoading(false);
    }
  }, [businessId]);

  // Initial load
  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Apply filters
  useEffect(() => {
    let filtered = [...transactions];

    // Date range filter
    if (startDate) {
      const startDateTime = new Date(startDate + 'T00:00:00').getTime();
      filtered = filtered.filter(tx => new Date(tx.created_at).getTime() >= startDateTime);
    }
    if (endDate) {
      const endDateTime = new Date(endDate + 'T23:59:59').getTime();
      filtered = filtered.filter(tx => new Date(tx.created_at).getTime() <= endDateTime);
    }

    // User filter
    if (selectedUserId !== 'all') {
      filtered = filtered.filter(tx => tx.user_id === parseInt(selectedUserId));
    }

    // Payment method filter
    if (selectedPaymentMethod !== 'all') {
      filtered = filtered.filter(tx => tx.payment_method.toLowerCase() === selectedPaymentMethod.toLowerCase());
    }

    // Status filter
    if (selectedStatus !== 'all') {
      filtered = filtered.filter(tx => tx.status === selectedStatus);
    }

    // Sync status filter
    if (selectedSyncStatus !== 'all') {
      if (selectedSyncStatus === 'synced') {
        filtered = filtered.filter(tx => tx.synced_at != null);
      } else if (selectedSyncStatus === 'unsynced') {
        filtered = filtered.filter(tx => tx.synced_at == null);
      }
    }

    // Search filter (receipt number, customer name, UUID)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(tx => 
        tx.receipt_number?.toString().includes(query) ||
        tx.customer_name?.toLowerCase().includes(query) ||
        tx.id.toLowerCase().includes(query)
      );
    }

    setFilteredTransactions(filtered);

    // Calculate stats
    const totalAmount = filtered.reduce((sum, tx) => sum + (tx.total_amount || 0), 0);
    const totalFinalAmount = filtered.reduce((sum, tx) => sum + (tx.final_amount || 0), 0);
    const totalDiscount = totalAmount - totalFinalAmount;
    const syncedCount = filtered.filter(tx => tx.synced_at != null).length;
    const unsyncedCount = filtered.filter(tx => tx.synced_at == null).length;

    setStats({
      totalTransactions: filtered.length,
      totalAmount,
      totalFinalAmount,
      totalDiscount,
      syncedCount,
      unsyncedCount,
    });
  }, [transactions, startDate, endDate, selectedUserId, selectedPaymentMethod, selectedStatus, selectedSyncStatus, searchQuery]);

  // Load transaction details
  const loadTransactionDetails = async (transaction: Transaction) => {
    setIsLoading(true);
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetTransactionItems) {
        return;
      }

      const items = await electronAPI.localDbGetTransactionItems(transaction.id);
      setSelectedTransactionItems(Array.isArray(items) ? items as TransactionItem[] : []);
      setSelectedTransaction(transaction);
      setViewMode('detail');
    } catch (error) {
      console.error('Error loading transaction details:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Export to CSV
  const exportToCSV = () => {
    const headers = [
      'Receipt #',
      'Date',
      'Customer',
      'Unit',
      'Payment Method',
      'Platform',
      'Total',
      'Discount',
      'Final Amount',
      'Status',
      'Synced',
      'UUID'
    ];

    const rows = filteredTransactions.map(tx => [
      tx.receipt_number || '',
      formatDateTime(tx.created_at),
      tx.customer_name || 'Guest',
      tx.customer_unit || '',
      formatPaymentMethod(tx.payment_method),
      formatPlatform(tx.platform),
      tx.total_amount,
      (tx.total_amount - tx.final_amount),
      tx.final_amount,
      tx.status,
      tx.synced_at ? 'Yes' : 'No',
      tx.id
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `transactions_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Get unique payment methods from transactions
  const paymentMethods = Array.from(new Set(transactions.map(tx => tx.payment_method))).sort();

  if (viewMode === 'detail' && selectedTransaction) {
    const transaction = selectedTransaction;
    
    return (
      <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
        {/* Detail Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => setViewMode('list')}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <ChevronRight className="w-6 h-6 text-gray-900 rotate-180" />
            </button>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Transaction Details</h2>
              <p className="text-sm text-gray-600">
                Receipt #{transaction.receipt_number} • {formatDateTime(transaction.created_at)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {transaction.synced_at ? (
              <span className="flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                <CheckCircle className="w-4 h-4" />
                Synced
              </span>
            ) : (
              <span className="flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
                <Clock className="w-4 h-4" />
                Not Synced
              </span>
            )}
          </div>
        </div>

        {/* Detail Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Transaction Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="text-sm font-medium text-gray-600 mb-1">Customer</div>
              <div className="text-lg font-bold text-gray-900">
                {transaction.customer_name || 'Guest'}
              </div>
              {transaction.customer_unit && (
                <div className="text-sm text-gray-600 mt-1">Unit {transaction.customer_unit}</div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="text-sm font-medium text-gray-600 mb-1">Payment Method</div>
              <div className="text-lg font-bold text-gray-900">
                {formatPaymentMethod(transaction.payment_method)}
              </div>
              <div className="text-sm text-gray-600 mt-1">
                {formatPlatform(transaction.platform)}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="text-sm font-medium text-gray-600 mb-1">Amount</div>
              <div className="text-lg font-bold text-gray-900">
                {formatRupiah(transaction.final_amount)}
              </div>
              {transaction.voucher_discount && transaction.voucher_discount > 0 && (
                <div className="text-sm text-green-600 mt-1">
                  Discount: {formatRupiah(transaction.voucher_discount)}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <div className="text-sm font-medium text-gray-600 mb-1">Status</div>
              <div className="flex flex-col gap-2">
                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                  transaction.status === 'completed' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {transaction.status}
                </span>
                {transaction.refund_status && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    {transaction.refund_status}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Items Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Items</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-900 font-medium border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3">Product</th>
                    <th className="px-6 py-3 text-right">Qty</th>
                    <th className="px-6 py-3 text-right">Unit Price</th>
                    <th className="px-6 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selectedTransactionItems.length > 0 ? (
                    selectedTransactionItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-6 py-3">
                          <div className="font-medium text-gray-900">{item.product_name || `Product #${item.product_id}`}</div>
                          {item.custom_note && (
                            <div className="text-xs text-gray-600 mt-1">Note: {item.custom_note}</div>
                          )}
                        </td>
                        <td className="px-6 py-3 text-right font-medium text-gray-900">{item.quantity}</td>
                        <td className="px-6 py-3 text-right font-medium text-gray-900">{formatRupiah(item.unit_price)}</td>
                        <td className="px-6 py-3 text-right font-medium text-gray-900">{formatRupiah(item.total_price)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-gray-500">No items found</td>
                    </tr>
                  )}
                </tbody>
                {selectedTransactionItems.length > 0 && (
                  <tfoot className="bg-gray-50 font-semibold text-gray-900">
                    <tr>
                      <td className="px-6 py-3" colSpan={3}>Total</td>
                      <td className="px-6 py-3 text-right">
                        {formatRupiah(selectedTransactionItems.reduce((sum, item) => sum + item.total_price, 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Additional Info */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Additional Information</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600">UUID:</span>
                <span className="ml-2 font-mono text-xs text-gray-900">{transaction.id}</span>
              </div>
              <div>
                <span className="text-gray-600">Receipt Number:</span>
                <span className="ml-2 font-medium text-gray-900">#{transaction.receipt_number}</span>
              </div>
              <div>
                <span className="text-gray-600">Transaction Type:</span>
                <span className="ml-2 font-medium text-gray-900">{transaction.transaction_type}</span>
              </div>
              <div>
                <span className="text-gray-600">Pickup Method:</span>
                <span className="ml-2 font-medium text-gray-900">{transaction.pickup_method}</span>
              </div>
              {transaction.amount_received && (
                <div>
                  <span className="text-gray-600">Amount Received:</span>
                  <span className="ml-2 font-medium text-gray-900">{formatRupiah(transaction.amount_received)}</span>
                </div>
              )}
              {transaction.change_amount && transaction.change_amount > 0 && (
                <div>
                  <span className="text-gray-600">Change:</span>
                  <span className="ml-2 font-medium text-gray-900">{formatRupiah(transaction.change_amount)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // List View
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-900">All Transactions</h1>
          <div className="flex gap-2">
            <button
              onClick={fetchTransactions}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={exportToCSV}
              disabled={filteredTransactions.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
            >
              <Filter className="w-4 h-4" />
              {showFilters ? 'Hide Filters' : 'Show Filters'}
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
            <div className="text-xs text-blue-600 font-medium mb-1">Total Transactions</div>
            <div className="text-lg font-bold text-blue-900">{stats.totalTransactions}</div>
          </div>
          <div className="bg-green-50 rounded-lg p-3 border border-green-200">
            <div className="text-xs text-green-600 font-medium mb-1">Total Amount</div>
            <div className="text-lg font-bold text-green-900">{formatRupiah(stats.totalAmount)}</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
            <div className="text-xs text-purple-600 font-medium mb-1">Final Amount</div>
            <div className="text-lg font-bold text-purple-900">{formatRupiah(stats.totalFinalAmount)}</div>
          </div>
          <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
            <div className="text-xs text-orange-600 font-medium mb-1">Total Discount</div>
            <div className="text-lg font-bold text-orange-900">{formatRupiah(stats.totalDiscount)}</div>
          </div>
          <div className="bg-teal-50 rounded-lg p-3 border border-teal-200">
            <div className="text-xs text-teal-600 font-medium mb-1">Synced</div>
            <div className="text-lg font-bold text-teal-900">{stats.syncedCount}</div>
          </div>
          <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-200">
            <div className="text-xs text-yellow-600 font-medium mb-1">Not Synced</div>
            <div className="text-lg font-bold text-yellow-900">{stats.unsyncedCount}</div>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by receipt #, customer name, or UUID..."
                className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Filter Grid */}
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
              {/* Date Range */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">End Date</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  />
                </div>
              </div>

              {/* User */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">User</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="w-full pl-10 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white text-gray-900"
                  >
                    <option value="all">All Users</option>
                    {users.map(user => (
                      <option key={user.user_id} value={user.user_id}>{user.user_name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Payment Method */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Payment</label>
                <div className="relative">
                  <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <select
                    value={selectedPaymentMethod}
                    onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                    className="w-full pl-10 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white text-gray-900"
                  >
                    <option value="all">All Methods</option>
                    {paymentMethods.map(method => (
                      <option key={method} value={method}>{formatPaymentMethod(method)}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                >
                  <option value="all">All Status</option>
                  <option value="completed">Completed</option>
                  <option value="pending">Pending</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              {/* Sync Status */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Sync Status</label>
                <select
                  value={selectedSyncStatus}
                  onChange={(e) => setSelectedSyncStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                >
                  <option value="all">All</option>
                  <option value="synced">Synced</option>
                  <option value="unsynced">Not Synced</option>
                </select>
              </div>
            </div>

            {/* Clear Filters */}
            <div className="flex justify-end">
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedUserId('all');
                  setSelectedPaymentMethod('all');
                  setSelectedStatus('all');
                  setSelectedSyncStatus('all');
                  const end = new Date();
                  const start = new Date();
                  start.setDate(start.getDate() - 30);
                  setEndDate(end.toISOString().split('T')[0]);
                  setStartDate(start.toISOString().split('T')[0]);
                }}
                className="flex items-center gap-2 px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
                Clear All Filters
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-900 font-semibold border-b border-gray-200">
              <tr>
                <th className="px-4 py-3">Receipt #</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Platform</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Sync</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center">
                    <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-2" />
                    <p className="text-gray-600">Loading transactions...</p>
                  </td>
                </tr>
              ) : filteredTransactions.length > 0 ? (
                filteredTransactions.map((transaction) => (
                  <tr 
                    key={transaction.id} 
                    onClick={() => loadTransactionDetails(transaction)}
                    className="hover:bg-blue-50 cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-blue-600">#{transaction.receipt_number || 'N/A'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{formatDate(transaction.created_at)}</div>
                      <div className="text-xs text-gray-500">{new Date(transaction.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{transaction.customer_name || 'Guest'}</div>
                      {transaction.customer_unit && (
                        <div className="text-xs text-gray-500">Unit {transaction.customer_unit}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                        {formatPaymentMethod(transaction.payment_method)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-gray-600 text-xs">
                        {formatPlatform(transaction.platform)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {formatRupiah(transaction.final_amount)}
                      {transaction.voucher_discount && transaction.voucher_discount > 0 && (
                        <div className="text-xs text-green-600">-{formatRupiah(transaction.voucher_discount)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        transaction.status === 'completed' 
                          ? 'bg-green-100 text-green-800' 
                          : transaction.status === 'cancelled'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {transaction.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {transaction.synced_at ? (
                        <CheckCircle className="w-5 h-5 text-green-600 mx-auto" />
                      ) : (
                        <XCircle className="w-5 h-5 text-yellow-600 mx-auto" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors" />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center justify-center text-gray-500">
                      <Filter className="w-12 h-12 mb-3 text-gray-300" />
                      <p className="font-medium">No transactions found</p>
                      <p className="text-sm mt-1">Try adjusting your filters</p>
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

