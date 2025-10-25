'use client';

import { useState, useEffect } from 'react';
import { Calendar, Clock, CreditCard, RefreshCw, Search, Filter, ChevronUp, ChevronDown } from 'lucide-react';
import TransactionDetailModal from './TransactionDetailModal';

interface Transaction {
  id: number;
  business_id: number;
  user_id: number;
  payment_method: 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
  pickup_method: 'dine-in' | 'take-away';
  total_amount: number;
  voucher_discount: number;
  final_amount: number;
  amount_received: number;
  change_amount: number;
  contact_id: number | null;
  customer_name: string | null;
  receipt_number: number | null;
  transaction_type: 'drinks' | 'bakery';
  status: string;
  created_at: string;
  user_name?: string;
  business_name?: string;
}

interface TransactionItem {
  id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  notes?: string;
}

interface TransactionDetail {
  id: number;
  business_id: number;
  user_id: number;
  user_name: string;
  business_name: string;
  payment_method: 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
  pickup_method: 'dine-in' | 'take-away';
  total_amount: number;
  voucher_discount: number;
  final_amount: number;
  amount_received: number;
  change_amount: number;
  contact_id?: number | null;
  customer_name?: string | null;
  bank_id?: number | null;
  bank_name?: string | null;
  card_number?: string | null;
  cl_account_id?: number | null;
  cl_account_name?: string | null;
  created_at: string;
  items: TransactionItem[];
}

interface TransactionListProps {
  businessId?: number;
}

export default function TransactionList({ businessId = 1 }: TransactionListProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMethod, setFilterMethod] = useState<string>('all');
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionDetail | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [loadingTransactionId, setLoadingTransactionId] = useState<number | null>(null);

  // Fetch transaction details
  const fetchTransactionDetail = async (transactionId: number) => {
    setIsLoadingDetail(true);
    try {
      const response = await fetch(`/api/transactions/${transactionId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch transaction details');
      }
      
      const data = await response.json();
      if (data.success) {
        setSelectedTransaction(data.transaction);
        setIsDetailModalOpen(true);
      } else {
        throw new Error(data.message || 'Failed to fetch transaction details');
      }
    } catch (error: any) {
      console.error('Error fetching transaction details:', error);
      setError(error.message);
    } finally {
      setIsLoadingDetail(false);
      setLoadingTransactionId(null);
    }
  };

  // Handle row click
  const handleRowClick = (transactionId: number) => {
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

  // Fetch today's transactions
  const fetchTransactions = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/transactions?business_id=${businessId}&date=${selectedDate}&limit=100`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch transactions');
      }
      
      const data = await response.json();
      console.log('TransactionList - Fetched transactions:', data.transactions?.slice(0, 3));
      if (data.transactions?.length > 0) {
        console.log('First transaction payment method:', data.transactions[0].payment_method);
      }
      setTransactions(data.transactions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch transactions');
      console.error('Error fetching transactions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Load transactions on component mount and when date changes
  useEffect(() => {
    fetchTransactions();
  }, [businessId, selectedDate]);

  // Format price for display
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

  // Filter and sort transactions
  const filteredTransactions = transactions
    .filter(transaction => {
      const matchesSearch = searchTerm === '' || 
        transaction.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        transaction.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        transaction.payment_method.toLowerCase().includes(searchTerm.toLowerCase()) ||
        transaction.receipt_number?.toString().includes(searchTerm);
      
      const matchesFilter = filterMethod === 'all' || transaction.payment_method === filterMethod;
      
      return matchesSearch && matchesFilter;
    })
    .sort((a, b) => {
      let aValue: any = a[sortField as keyof Transaction];
      let bValue: any = b[sortField as keyof Transaction];

      // Handle different data types
      if (sortField === 'id' || sortField === 'total_amount' || sortField === 'voucher_discount' || sortField === 'final_amount' || sortField === 'amount_received' || sortField === 'change_amount') {
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

  // Aggregations for footer
  const paymentMethodCounts: Record<string, number> = {
    cash: 0,
    debit: 0,
    qr: 0,
    ewallet: 0,
    cl: 0,
    voucher: 0,
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
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">
            Daftar Transaksi | {new Date(selectedDate).toLocaleDateString('id-ID', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </h1>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 flex-shrink-0">
          {/* Payment Methods Card */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <h3 className="font-semibold text-gray-900 text-sm">Metode Pembayaran</h3>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {/* Left Column */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-xs text-gray-600">Cash</span>
                  <span className="text-xs font-medium text-gray-900">{paymentMethodCounts.cash}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-600">Debit</span>
                  <span className="text-xs font-medium text-gray-900">{paymentMethodCounts.debit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-600">QR</span>
                  <span className="text-xs font-medium text-gray-900">{paymentMethodCounts.qr}</span>
                </div>
              </div>
              
              {/* Divider */}
              <div className="border-l border-gray-200 pl-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-600">E-Wallet</span>
                    <span className="text-xs font-medium text-gray-900">{paymentMethodCounts.ewallet}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-600">CL</span>
                    <span className="text-xs font-medium text-gray-900">{paymentMethodCounts.cl}</span>
                  </div>
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
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
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
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
              <h3 className="font-semibold text-gray-900 text-sm">Grand Total</h3>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-gray-900">{formatPrice(totalRevenue)}</div>
            </div>
          </div>
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
          
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
          />
          
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
            </select>
          </div>
          
          <button
            onClick={fetchTransactions}
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

        {/* Transactions Table Container */}
        <div className="flex-1 flex flex-col min-h-0 mb-8">
          {filteredTransactions.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <CreditCard className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-600 mb-2">Tidak ada transaksi</h3>
                <p className="text-gray-500">Belum ada transaksi hari ini</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="flex-1 overflow-auto pb-8">
                <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th 
                      className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-16"
                      onClick={() => handleSort('receipt_number')}
                    >
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-xs">Receipt #</span>
                        {getSortIcon('receipt_number')}
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
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('created_at')}
                    >
                      <div className="flex items-center gap-1">
                        Waktu
                        {getSortIcon('created_at')}
                      </div>
                    </th>
                    <th 
                      className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-20"
                      onClick={() => handleSort('payment_method')}
                    >
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-xs">Metode Pembayaran</span>
                        {getSortIcon('payment_method')}
                      </div>
                    </th>
                    <th 
                      className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-16"
                      onClick={() => handleSort('pickup_method')}
                    >
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-xs">Pengambilan</span>
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
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('voucher_discount')}
                    >
                      <div className="flex items-center gap-1">
                        Diskon Voucher
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
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
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
                          #{transaction.receipt_number || 'N/A'}
                        </span>
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
                        <span className="text-xs text-gray-900">
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
                          <span className="text-xs text-green-600 font-medium">
                            -{formatPrice(transaction.voucher_discount)}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-xs font-bold text-gray-900">
                          {formatPrice(transaction.final_amount)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-xs text-gray-900">
                          {transaction.customer_name || 'Guest'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-xs text-gray-900">
                          {transaction.user_name || 'Unknown'}
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
    </div>
  );
}
