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
  payment_method: 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
  pickup_method: 'dine-in' | 'take-away';
  total_amount: number;
  voucher_discount: number;
  final_amount: number;
  amount_received: number;
  change_amount: number;
  contact_id: number | null;
  customer_name: string | null;
  note: string | null;
  receipt_number: number | null;
  transaction_type: 'drinks' | 'bakery';
  status: string;
  created_at: string;
  user_name?: string;
  business_name?: string;
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

export default function TransactionList({ businessId = 14 }: TransactionListProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMethod, setFilterMethod] = useState<string>('all');
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  
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

  // Manual Receiptize reveal state
  const [showManualReceiptize, setShowManualReceiptize] = useState(false);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<string>>(new Set());
  const [auditLogEntries, setAuditLogEntries] = useState<any[]>([]);
  const [isLoadingAuditLog, setIsLoadingAuditLog] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isPrintCancelled, setIsPrintCancelled] = useState(false);
  const [manualSearchTerm, setManualSearchTerm] = useState('');
  const [manualFromDate, setManualFromDate] = useState<string>(getTodayUTC7());
  const [manualToDate, setManualToDate] = useState<string>(getTodayUTC7());
  
  const loadAuditLog = useCallback(async () => {
    setIsLoadingAuditLog(true);
    try {
      if (window.electronAPI?.getPrinter2AuditLog) {
        const result = await window.electronAPI.getPrinter2AuditLog(manualFromDate, manualToDate, 100);
        if (result?.success) {
          setAuditLogEntries(result.entries || []);
        }
      }
    } catch (error) {
      console.error('Error loading audit log:', error);
    } finally {
      setIsLoadingAuditLog(false);
    }
  }, [manualFromDate, manualToDate]);
  
  const handleOpenManualReceiptize = useCallback(() => {
    setShowManualReceiptize(true);
    loadAuditLog();
  }, [loadAuditLog]);
  
  const handleCloseManualReceiptize = useCallback(() => {
    setShowManualReceiptize(false);
    setSelectedTransactionIds(new Set());
    setManualSearchTerm('');
  }, []);
  
  // Reload audit log when dates change and modal is open
  useEffect(() => {
    if (showManualReceiptize) {
      loadAuditLog();
    }
  }, [showManualReceiptize, manualFromDate, manualToDate, loadAuditLog]);
  
  const handleToggleTransactionSelection = (transactionId: string) => {
    setSelectedTransactionIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(transactionId)) {
        newSet.delete(transactionId);
      } else {
        newSet.add(transactionId);
      }
      return newSet;
    });
  };
  
  const handleManualPrint = async () => {
    if (selectedTransactionIds.size === 0) {
      alert('Pilih setidaknya satu transaksi untuk dicetak');
      return;
    }
    
    setIsPrinting(true);
    setIsPrintCancelled(false);
    try {
      const transactionIds = Array.from(selectedTransactionIds);
      const failedPrints: string[] = [];
      
      // Helper: timeout wrapper so we don't hang forever on a print
      const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
        return await Promise.race([
          promise,
          new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Print timeout')), ms))
        ]) as T;
      };

      for (const transactionId of transactionIds) {
        if (isPrintCancelled) {
          console.warn('Print cancelled by user. Stopping batch.');
          break;
        }
        try {
          // Find transaction data
          const transaction = transactions.find(tx => tx.id === transactionId);
          if (!transaction) {
            failedPrints.push(transactionId);
            continue;
          }
          
          // Get Printer 2 counter and increment (counter increments inside getPrinterCounter when increment=true)
          let printer2Counter = 1;
          if (window.electronAPI?.getPrinterCounter) {
            const counterResult = await window.electronAPI.getPrinterCounter('receiptizePrinter', businessId, true);
            // Handle both return types: number directly, or { success: boolean, counter: number }
            if (typeof counterResult === 'number') {
              printer2Counter = counterResult;
            } else if (counterResult && typeof counterResult === 'object' && 'counter' in counterResult) {
              printer2Counter = counterResult.counter || 1;
            }
            console.log(`📊 [MANUAL PRINT] Printer 2 counter for transaction ${transactionId}: ${printer2Counter}`);
          }
          
          // Log to audit
          await window.electronAPI?.logPrinter2Print?.(transactionId, printer2Counter, 'manual');
          
          // Get transaction details for printing (without opening modal)
          setIsLoadingDetail(true);
          let transactionDetails: any = null;
          try {
            const response = await offlineSyncService.fetchWithFallback(
              async () => {
                const response = await fetch(`/api/transactions/${transactionId}`);
                if (!response.ok) throw new Error('Failed to fetch');
                const data = await response.json();
                return data.success ? data.transaction : null;
              },
              async () => {
                if (typeof window === 'undefined' || !(window as any).electronAPI) throw new Error('No API');
                const txs = await (window as any).electronAPI.localDbGetTransactions(businessId, 1000);
                const tx = txs.find((t: any) => t.id === transactionId);
                if (!tx) throw new Error('Not found');
                const items = await (window as any).electronAPI.localDbGetTransactionItems(transactionId);
                const products = await (window as any).electronAPI.localDbGetAllProducts();
                const users = await (window as any).electronAPI.localDbGetUsers();
                const businesses = await (window as any).electronAPI.localDbGetBusinesses();
                const user = users.find((u: any) => u.id === tx.user_id);
                const business = businesses.find((b: any) => b.id === tx.business_id);
                return {
                  ...tx,
                  items: items.map((item: any) => {
                    const product = products.find((p: any) => p.id === item.product_id);
                    return {
                      id: item.id,
                      product_name: product?.nama || 'Unknown',
                      quantity: item.quantity,
                      unit_price: item.unit_price,
                      total_price: item.total_price,
                      custom_note: item.custom_note,
                      customizations_json: item.customizations_json || null
                    };
                  }),
                  user_name: user?.name || 'Unknown',
                  business_name: business?.name || 'Unknown'
                };
              }
            );
            transactionDetails = response;
          } catch (error) {
            console.error(`Error fetching transaction ${transactionId}:`, error);
          } finally {
            setIsLoadingDetail(false);
          }
          
          if (!transactionDetails) {
            failedPrints.push(transactionId);
            continue;
          }
          
          // Prepare print data - map items to correct format expected by receipt generator
          // Receipt generator expects: name (not product_name), price (or unit_price), quantity, total_price
          const mappedItems = (transactionDetails.items || []).map((item: any) => ({
            name: item.product_name || item.name || 'Unknown Product',
            quantity: item.quantity || 1,
            price: item.unit_price || item.price || 0,
            total_price: item.total_price || ((item.unit_price || item.price || 0) * (item.quantity || 1))
          }));
          
          const printData = {
            type: 'transaction',
            printerType: 'receiptizePrinter',
            printerName: '',
            business_id: transaction.business_id,
            items: mappedItems,
            total: transaction.final_amount,
            paymentMethod: transaction.payment_method,
            amountReceived: transaction.amount_received,
            change: transaction.change_amount || 0,
            date: transaction.created_at,
            receiptNumber: transactionId,
            cashier: transactionDetails.user_name || 'Kasir',
            pickupMethod: transaction.pickup_method || 'dine-in',
            printer2Counter: printer2Counter
          };
          
          // Print with small delay
          await new Promise(resolve => setTimeout(resolve, 500));
          // If API is missing, treat as failure immediately
          if (!window.electronAPI?.printReceipt) {
            throw new Error('Print API unavailable');
          }

          // Print with 10s timeout per job to avoid getting stuck
          const printResult = await withTimeout(window.electronAPI.printReceipt(printData), 10000);
          
          if (!printResult?.success) {
            failedPrints.push(transactionId);
          }
        } catch (error) {
          console.error(`Error printing transaction ${transactionId}:`, error);
          failedPrints.push(transactionId);
        }
      }
      
      if (isPrintCancelled) {
        alert('Pencetakan dibatalkan. Anda dapat mencoba lagi.');
      } else if (failedPrints.length > 0) {
        const sample = failedPrints.slice(0, 3).join(', ');
        alert(`Gagal mencetak ${failedPrints.length} transaksi. Contoh ID: ${sample}. Coba lagi untuk melihat error detail di console.`);
      } else {
        alert(`Berhasil mencetak ${transactionIds.length} transaksi ke Printer 2`);
        setSelectedTransactionIds(new Set());
        loadAuditLog(); // Refresh audit log
      }
    } catch (error) {
      console.error('Error in manual print:', error);
      alert('Terjadi kesalahan saat mencetak');
    } finally {
      setIsPrinting(false);
    }
  };
  
  // Filter transactions for manual receiptize modal
  const filteredTransactionsForManual = transactions.filter(tx => {
    if (manualSearchTerm) {
      const searchLower = manualSearchTerm.toLowerCase();
      return (
        tx.id.toLowerCase().includes(searchLower) ||
        (tx.user_name && tx.user_name.toLowerCase().includes(searchLower)) ||
        (tx.receipt_number && tx.receipt_number.toString().includes(searchLower))
      );
    }
    return true;
  });

  // Build a quick lookup for transactions already printed to Printer 2 (from audit log)
  const printedTransactionIdSet = new Set(
    (auditLogEntries || []).map((e: any) => e.transaction_id)
  );
  const printedTransactionsForManual = filteredTransactionsForManual.filter(tx => printedTransactionIdSet.has(tx.id));

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
                customizations_json: item.customizations_json || null
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

  // Fetch transactions function
  const fetchTransactions = useCallback(async () => {
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
        transactionsData = data.transactions || [];
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
            final_amount: tx.final_amount,
            amount_received: tx.amount_received,
            change_amount: tx.change_amount || 0,
            contact_id: tx.contact_id,
            customer_name: tx.customer_name,
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
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch transactions';
      setError(errorMessage);
      console.error('Error fetching transactions:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isOnlineMode, fromDate, toDate, businessId]);

  // Fetch transactions on mount and when dependencies change
  useEffect(() => {
    fetchTransactions();
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
          <GrandTotalCard totalRevenue={totalRevenue} onSecretOpen={handleOpenManualReceiptize} />
        </div>

        {/* Manual Receiptize Modal */}
        {showManualReceiptize && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white w-screen h-screen rounded-none shadow-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Manual Receiptize Print</h3>
                <button onClick={handleCloseManualReceiptize} className="text-gray-600 hover:text-gray-800">✕</button>
              </div>

              <div className="p-4 space-y-6 h-full flex flex-col">
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                  <p className="text-sm text-purple-800">Pilih transaksi untuk dicetak sebagai struk audit (Printer 2). Cetak manual selalu tersedia, terpisah dari mode otomatis.</p>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input type="date" className="border border-gray-300 rounded-lg px-3 py-2 text-black" value={manualFromDate} onChange={(e)=>setManualFromDate(e.target.value)} />
                  <input type="date" className="border border-gray-300 rounded-lg px-3 py-2 text-black" value={manualToDate} onChange={(e)=>setManualToDate(e.target.value)} />
                  <input type="text" className="border border-gray-300 rounded-lg px-3 py-2 text-black" placeholder="Cari ID/nota/kasir" value={manualSearchTerm} onChange={(e)=>setManualSearchTerm(e.target.value)} />
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    {selectedTransactionIds.size > 0 ? `${selectedTransactionIds.size} transaksi dipilih` : 'Pilih transaksi pada tabel di bawah'}
                  </div>
                  <div className="flex gap-2">
                    {isPrinting && (
                      <button 
                        onClick={() => setIsPrintCancelled(true)}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                      >
                        Batalkan
                      </button>
                    )}
                    <button 
                      onClick={loadAuditLog}
                      className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
                    >
                      Refresh Log
                    </button>
                    <button 
                      onClick={handleManualPrint}
                      disabled={selectedTransactionIds.size === 0 || isPrinting}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg disabled:bg-purple-300"
                    >
                      {isPrinting ? 'Mencetak...' : `Print ke Printer 2 (${selectedTransactionIds.size})`}
                    </button>
                  </div>
                </div>

                {/* Tables */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
                  {/* Transaction List */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col">
                    <div className="px-3 py-2 border-b border-gray-200 font-medium text-gray-800 bg-gray-50">
                      Semua Transaksi ({filteredTransactionsForManual.length})
                    </div>
                    <div className="h-[calc(100vh-350px)] overflow-y-auto">
                      {filteredTransactionsForManual.length === 0 ? (
                        <div className="p-4 text-sm text-gray-600 text-center">Tidak ada transaksi</div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="px-2 py-1 text-left w-8"></th>
                              <th className="px-2 py-1 text-left">ID</th>
                              <th className="px-2 py-1 text-left">Waktu</th>
                              <th className="px-2 py-1 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredTransactionsForManual.map((tx) => (
                              <tr key={tx.id} className={`border-b border-gray-100 hover:bg-gray-50 ${printedTransactionIdSet.has(tx.id) ? 'bg-yellow-50' : ''}`}>
                                <td className="px-2 py-1">
                                  <input
                                    type="checkbox"
                                    checked={selectedTransactionIds.has(tx.id)}
                                    onChange={() => handleToggleTransactionSelection(tx.id)}
                                    className="w-4 h-4"
                                  />
                                </td>
                                <td className="px-2 py-1 font-mono text-xs">
                                  {tx.id}
                                  {printedTransactionIdSet.has(tx.id) && (
                                    <span className="ml-2 inline-block px-1.5 py-0.5 text-[10px] rounded bg-yellow-200 text-yellow-900 align-middle">Printed</span>
                                  )}
                                </td>
                                <td className="px-2 py-1 text-xs">{new Date(tx.created_at).toLocaleTimeString('id-ID')}</td>
                                <td className="px-2 py-1 text-right">{formatPrice(tx.final_amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                    {/* Summary Footer */}
                    {filteredTransactionsForManual.length > 0 && (
                      <div className="border-t border-gray-200 bg-gray-50 p-3 space-y-2 flex-shrink-0">
                        {(() => {
                          const grandTotal = filteredTransactionsForManual.reduce((sum, tx) => {
                            const amount = typeof tx.final_amount === 'string' ? parseFloat(tx.final_amount) : tx.final_amount;
                            return sum + (isNaN(amount) ? 0 : amount);
                          }, 0);
                          
                          return (
                            <>
                              <div className="flex justify-between text-sm">
                                <span className="font-medium text-gray-700">Grand Total (Semua Transaksi):</span>
                                <span className="font-bold text-gray-900">{formatPrice(grandTotal)}</span>
                              </div>
                              <div className="text-xs text-gray-500"></div>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Audit Log */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col">
                    <div className="px-3 py-2 border-b border-gray-200 font-medium text-gray-800 bg-gray-50">
                      Audit Log ({auditLogEntries.length})
                    </div>
                    <div className="h-[calc(100vh-350px)] overflow-y-auto">
                      {isLoadingAuditLog ? (
                        <div className="p-4 text-sm text-gray-600 text-center">Memuat...</div>
                      ) : auditLogEntries.length === 0 ? (
                        <div className="p-4 text-sm text-gray-600 text-center">Belum ada audit log</div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="px-2 py-1 text-left">P2 #</th>
                              <th className="px-2 py-1 text-left">Waktu</th>
                              <th className="px-2 py-1 text-left">Mode</th>
                              <th className="px-2 py-1 text-left">ID</th>
                              <th className="px-2 py-1 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {auditLogEntries.map((entry, idx) => {
                              const transaction = filteredTransactionsForManual.find(tx => tx.id === entry.transaction_id);
                              return (
                                <tr key={idx} className="border-b border-gray-100">
                                  <td className="px-2 py-1 font-semibold">{entry.printer2_receipt_number}</td>
                                  <td className="px-2 py-1 text-xs">{new Date(entry.printed_at).toLocaleString('id-ID')}</td>
                                  <td className="px-2 py-1">
                                    <span className={`px-2 py-0.5 rounded text-xs ${
                                      entry.print_mode === 'auto' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
                                    }`}>
                                      {entry.print_mode === 'auto' ? 'Auto' : 'Manual'}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1 font-mono text-xs">{entry.transaction_id}</td>
                                  <td className="px-2 py-1 text-right text-xs">{transaction ? formatPrice(transaction.final_amount) : '-'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                    {/* Summary Footer */}
                    {auditLogEntries.length > 0 && (
                      <div className="border-t border-gray-200 bg-gray-50 p-3 space-y-2 flex-shrink-0">
                        {(() => {
                          const auditLogTransactionIds = new Set(auditLogEntries.map((e: any) => e.transaction_id));
                          const auditTransactions = filteredTransactionsForManual.filter(tx => auditLogTransactionIds.has(tx.id));
                          const grandTotal = auditTransactions.reduce((sum, tx) => {
                            const amount = typeof tx.final_amount === 'string' ? parseFloat(tx.final_amount) : tx.final_amount;
                            return sum + (isNaN(amount) ? 0 : amount);
                          }, 0);
                          const percentage = filteredTransactionsForManual.length > 0 ? ((auditTransactions.length / filteredTransactionsForManual.length) * 100).toFixed(1) : '0.0';
                          
                          return (
                            <>
                              <div className="flex justify-between text-sm">
                                <span className="font-medium text-gray-700">Grand Total (Audit Log):</span>
                                <span className="font-bold text-gray-900">{formatPrice(grandTotal)}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="font-medium text-gray-700">Persentase dari Semua Transaksi:</span>
                                <span className="font-bold text-blue-600">{percentage}%</span>
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                {auditTransactions.length} dari {filteredTransactionsForManual.length} transaksi
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                </div>
              </div>
            </div>
          </div>
        )}

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
              <option value="tiktok" className="text-black">TikTok</option>
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
                      className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-16"
                      onClick={() => handleSort('receipt_number')}
                    >
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-xs">#</span>
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
                          #{transaction.receipt_number || 'N/A'}
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
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-xs text-gray-500 italic">
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
  onSecretOpen: () => void;
}

function GrandTotalCard({ totalRevenue, onSecretOpen }: GrandTotalCardProps) {
  const [clickCount, setClickCount] = useState(0);
  const [timerId, setTimerId] = useState<number | null>(null);

  const handleClick = () => {
    const next = clickCount + 1;
    setClickCount(next);
    if (next === 1) {
      const id = window.setTimeout(() => {
        setClickCount(0);
        setTimerId(null);
      }, 3000);
      setTimerId(id);
    }
    if (next >= 5) {
      if (timerId) {
        window.clearTimeout(timerId);
        setTimerId(null);
      }
      setClickCount(0);
      onSecretOpen();
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:col-span-1 cursor-pointer select-none" onClick={handleClick}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
        <h3 className="font-semibold text-gray-900 text-sm">Grand Total</h3>
      </div>
      <div className="text-center">
        <div className="text-lg font-bold text-gray-900">{formatPrice(totalRevenue)}</div>
      </div>
    </div>
  );
}