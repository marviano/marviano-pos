'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, CreditCard, RefreshCw, Search, Filter, ChevronUp, ChevronDown, Wifi, WifiOff } from 'lucide-react';
import TransactionDetailModal, { TransactionDetail, TransactionRefund } from './TransactionDetailModal';
import { offlineSyncService } from '@/lib/offlineSync';
import { useAuth } from '@/hooks/useAuth';
import { hasPermission } from '@/lib/permissions';
import { isSuperAdmin } from '@/lib/auth';

import { getApiUrl } from '@/lib/api';

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
  shift_uuid?: string | null; // Added shift_uuid
  payment_method: 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher' | 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
  payment_method_id?: number; // Source of truth - foreign key to payment_methods table
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
  refund_status?: string | null;
  refund_total?: number | null;
}

interface TransactionListProps {
  businessId?: number;
}

// Types for electron API responses
interface ElectronTransaction {
  id: string;
  business_id: number;
  user_id: number;
  payment_method: string;
  pickup_method: string;
  total_amount: number;
  voucher_discount: number;
  voucher_type: string;
  voucher_value: number | null;
  voucher_label: string | null;
  final_amount: number;
  amount_received: number;
  change_amount: number;
  contact_id: number | null;
  customer_name: string | null;
  customer_unit: number | null;
  note: string | null;
  receipt_number: number | null;
  transaction_type: string;
  status: string;
  created_at: string;
  shift_uuid?: string;
  refund_total?: number | null;
  refund_status?: string | null;
}

interface ElectronUser {
  id: number;
  name: string;
}

interface ElectronBusiness {
  id: number;
  name: string;
}

interface ElectronProduct {
  id: number;
  nama: string;
}

interface ElectronTransactionItem {
  id: string;
  product_id: number;
  product_name?: string; // Added: product name from JOIN with products table
  quantity: number;
  unit_price: number;
  total_price: number;
  custom_note?: string;
  customizations?: Array<{
    customization_id: number;
    customization_name: string;
    selected_options: Array<{
      option_id: number;
      option_name: string;
      price_adjustment: number;
    }>;
  }>;
  bundleSelections?: Array<{
    category2_id: number;
    category2_name: string;
    selectedProducts: Array<{
      product: { id: number; nama: string };
      quantity?: number;
      customizations?: Array<{
        customization_id: number;
        customization_name: string;
        selected_options: Array<{
          option_id: number;
          option_name: string;
          price_adjustment: number;
        }>;
      }>;
      customNote?: string;
    }>;
    requiredQuantity: number;
  }>;
}

// Type for window.electronAPI
interface ElectronAPI {
  localDbGetTransactions: (businessId: number, limit: number) => Promise<ElectronTransaction[]>;
  localDbGetTransactionItems: (transactionId: string) => Promise<ElectronTransactionItem[]>;
  localDbGetTransactionRefunds: (transactionId: string) => Promise<TransactionRefund[]>;
  localDbGetAllProducts: () => Promise<ElectronProduct[]>;
  localDbGetUsers: () => Promise<ElectronUser[]>;
  localDbGetBusinesses: () => Promise<ElectronBusiness[]>;
  getPrinter1AuditLog?: (fromDate?: string, toDate?: string, limit?: number) => Promise<{ entries: Array<{ transaction_id?: string; printer1_receipt_number?: number; printed_at_epoch?: number; is_reprint?: number }> }>;
  getPrinter2AuditLog: (fromDate?: string, toDate?: string, limit?: number) => Promise<{ entries: Array<{ transaction_id?: string; printer2_receipt_number?: number; printed_at_epoch?: number; is_reprint?: number }> }>;
  navigateTo?: (path: string) => void;
}

export default function TransactionList({ businessId = 14 }: TransactionListProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMethod, setFilterMethod] = useState<string>('all');
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [receiptizePrintedIds, setReceiptizePrintedIds] = useState<Set<string>>(() => new Set());
  const [receiptizeCounters, setReceiptizeCounters] = useState<Record<string, number>>({});
  const [receiptCounters, setReceiptCounters] = useState<Record<string, number>>({});
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [voucherClickCount, setVoucherClickCount] = useState(0);
  const [showPrintingLogs, setShowPrintingLogs] = useState(false);

  // Get today's date in UTC+7 timezone
  // Import from shared utility for consistency
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
  // Default to online mode if offline database is not available (migration scenario)
  const [isOnlineMode, setIsOnlineMode] = useState(() => {
    if (typeof window === 'undefined') return true;
    const hasElectronAPI = !!(window as { electronAPI?: ElectronAPI }).electronAPI;
    // If no Electron API (offline DB), default to online mode
    return !hasElectronAPI;
  });

  // Permission checks
  const canViewPastData = hasPermission(user, 'daftartransaksi.viewpastdata');
  const canViewUserDataOnly = hasPermission(user, 'daftartransaksi.viewuserdataonly');
  const canViewAllData = hasPermission(user, 'daftartransaksi.viewalldata');
  const canViewPrintingLogs = hasPermission(user, 'daftartransaksi.viewprintinglogs');
  const canViewOfflineOnlineSwitch = isSuperAdmin(user) || hasPermission(user, 'daftartransaksi.offlineonlineswitch');
  const canRefund = isSuperAdmin(user) || hasPermission(user, 'daftartransaksi.refund');

  // Check for conflicting permissions (Super Admin bypasses this check)
  const hasConflictingPermissions = !isSuperAdmin(user) && canViewUserDataOnly && canViewAllData;

  // Fetch transaction details with offline fallback
  const fetchTransactionDetail = async (transactionId: string) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionList.tsx:207',message:'fetchTransactionDetail called',data:{transactionId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    console.log('🔍 [TransactionList] fetchTransactionDetail called with ID:', transactionId);
    setIsLoadingDetail(true);
    try {
      const response = await offlineSyncService.fetchWithFallback<TransactionDetail>(
        // Online fetch
        async () => {
          const apiUrl = getApiUrl(`/api/transactions/${transactionId}`);
          console.log('🌐 [TransactionList] Fetching transaction detail from API:', apiUrl);
          const response = await fetch(apiUrl);
          if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ [TransactionList] API error response:', {
              status: response.status,
              statusText: response.statusText,
              body: errorText
            });
            throw new Error('Failed to fetch transaction details');
          }
          const data = await response.json();
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionList.tsx:226',message:'API response received',data:{success:data.success,itemCount:data.transaction?.items?.length||0,firstItemHasProductName:!!data.transaction?.items?.[0]?.product_name,firstItemHasCustomizations:!!data.transaction?.items?.[0]?.customizations,firstItemCustomizationsCount:Array.isArray(data.transaction?.items?.[0]?.customizations)?data.transaction.items[0].customizations.length:0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          console.log('🌐 [TransactionList] API response received:', {
            success: data.success,
            transactionId: data.transaction?.id || data.transaction?.uuid_id,
            itemCount: data.transaction?.items?.length || 0
          });
          if (data.success) {
            const transaction = data.transaction;
            
            // FIX: If API doesn't return customizations, fetch from local DB and merge
            if (transaction && transaction.items && Array.isArray(transaction.items)) {
              const needsCustomizations = transaction.items.some((item: { customizations?: unknown }) => 
                !item.customizations || (Array.isArray(item.customizations) && item.customizations.length === 0)
              );
              
              if (needsCustomizations && typeof window !== 'undefined' && (window as { electronAPI?: ElectronAPI }).electronAPI) {
                try {
                  // Fetch items with customizations from local DB
                  const localItems: ElectronTransactionItem[] = await (window as { electronAPI: ElectronAPI }).electronAPI.localDbGetTransactionItems(transactionId);
                  
                  // Merge customizations from local DB into API response
                  transaction.items = transaction.items.map((apiItem: { id?: string; customizations?: unknown; custom_note?: string }) => {
                    const localItem = localItems.find(li => String(li.id) === String(apiItem.id));
                    if (localItem && localItem.customizations && Array.isArray(localItem.customizations) && localItem.customizations.length > 0) {
                      return {
                        ...apiItem,
                        customizations: localItem.customizations,
                        custom_note: localItem.custom_note || apiItem.custom_note
                      };
                    }
                    return apiItem;
                  });
                } catch (error) {
                  console.warn('Failed to fetch customizations from local DB:', error);
                }
              }
            }
            
            // Ensure all items have product_name, customizations, and custom_note
            if (transaction && transaction.items && Array.isArray(transaction.items)) {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionList.tsx:265',message:'Before processing items',data:{itemCount:transaction.items.length,itemsBeforeProcessing:transaction.items.map((i:any)=>({id:i.id,product_name:i.product_name,product_id:i.product_id,hasCustomizations:!!i.customizations,customizationsCount:Array.isArray(i.customizations)?i.customizations.length:0}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
              // #endregion
              // If any item is missing product_name, try to get it from local DB as fallback
              const needsProductName = transaction.items.some((item: { product_name?: string; product_id?: number }) =>
                !item.product_name && item.product_id
              );

              if (needsProductName && typeof window !== 'undefined' && (window as { electronAPI?: ElectronAPI }).electronAPI) {
                try {
                  const products: ElectronProduct[] = await (window as { electronAPI: ElectronAPI }).electronAPI.localDbGetAllProducts();
                  transaction.items = transaction.items.map((item: { product_name?: string; product_id?: number; customizations?: unknown; custom_note?: string }) => {
                    const mappedItem: { product_name?: string; product_id?: number; customizations?: unknown; custom_note?: string } = { ...item };
                    if (!item.product_name && item.product_id) {
                      const product = products.find((p) => p.id === item.product_id);
                      mappedItem.product_name = product?.nama || 'Unknown Product';
                    }
                    // Ensure customizations and custom_note are included (even if empty/null)
                    if (!mappedItem.customizations) {
                      mappedItem.customizations = [];
                    }
                    if (mappedItem.custom_note === undefined || mappedItem.custom_note === null) {
                      mappedItem.custom_note = undefined;
                    }
                    return mappedItem;
                  });
                } catch (error) {
                  console.warn('Failed to fetch products for fallback:', error);
                  // Ensure at least Unknown Product is set, and customizations/custom_note
                  transaction.items = transaction.items.map((item: { product_name?: string; customizations?: unknown; custom_note?: string }) => ({
                    ...item,
                    product_name: item.product_name || 'Unknown Product',
                    customizations: item.customizations || [],
                    custom_note: item.custom_note || undefined
                  }));
                }
              } else {
                // Ensure at least Unknown Product is set, and customizations/custom_note
                transaction.items = transaction.items.map((item: { product_name?: string; customizations?: unknown; custom_note?: string }) => ({
                  ...item,
                  product_name: item.product_name || 'Unknown Product',
                  customizations: item.customizations || [],
                  custom_note: item.custom_note || undefined
                }));
              }
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionList.tsx:308',message:'After processing items',data:{itemCount:transaction.items.length,itemsAfterProcessing:transaction.items.map((i:any)=>({id:i.id,product_name:i.product_name,product_id:i.product_id,hasCustomizations:!!i.customizations,customizationsCount:Array.isArray(i.customizations)?i.customizations.length:0}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
              // #endregion
            }
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionList.tsx:309',message:'Returning transaction',data:{hasTransaction:!!transaction,itemCount:transaction?.items?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            return transaction;
          } else {
            throw new Error(data.message || 'Failed to fetch transaction details');
          }
        },
        // Offline fetch
        async () => {
          if (typeof window === 'undefined' || !(window as { electronAPI?: ElectronAPI }).electronAPI) {
            throw new Error('Offline database not available');
          }

          // Get transaction from local database
          console.log('💾 [TransactionList] Fetching transaction detail from offline DB, ID:', transactionId);
          const transactions: ElectronTransaction[] = await (window as { electronAPI: ElectronAPI }).electronAPI.localDbGetTransactions(businessId, 1000);
          console.log('💾 [TransactionList] Found', transactions.length, 'transactions in offline DB');
          
          // Try to find transaction by ID (UUID) or receipt_number
          let transaction = transactions.find((tx) => {
            return String(tx.id) === String(transactionId);
          });
          
          // If not found by ID, try by receipt_number
          if (!transaction) {
            console.log('💾 [TransactionList] Not found by ID, trying receipt_number match');
            transaction = transactions.find((tx) => {
              return tx.receipt_number !== null && String(tx.receipt_number) === String(transactionId);
            });
          }

          if (!transaction) {
            console.error('❌ [TransactionList] Transaction not found in offline database:', {
              transactionId,
              availableIds: transactions.slice(0, 5).map(tx => ({ id: String(tx.id), receipt_number: tx.receipt_number }))
            });
            throw new Error('Transaction not found in offline database');
          }
          
          // Get the actual UUID from the transaction (id field should be UUID)
          const transactionUuid = transaction.id;
          
          console.log('✅ [TransactionList] Found transaction in offline DB:', {
            id: transaction.id,
            uuid_id: transactionUuid,
            receipt_number: transaction.receipt_number,
            totalAmount: transaction.total_amount,
            itemCount: 'will fetch items next'
          });

          // Get transaction items using the transaction's UUID (not the receipt number)
          console.log('💾 [TransactionList] Fetching transaction items for UUID:', transactionUuid);
          const items: ElectronTransactionItem[] = await (window as { electronAPI: ElectronAPI }).electronAPI.localDbGetTransactionItems(transactionUuid);
          console.log('💾 [TransactionList] Found', items.length, 'transaction items:', items.map(i => ({
            id: i.id,
            product_id: i.product_id,
            product_name: i.product_name,
            quantity: i.quantity,
            hasCustomizations: !!i.customizations && Array.isArray(i.customizations) && i.customizations.length > 0
          })));
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionList.tsx:375',message:'Offline items query result',data:{transactionId,transactionUuid,receiptNumber:transaction.receipt_number,itemCount:items.length,firstItem:items.length>0?{id:items[0].id,product_id:items[0].product_id,product_name:items[0].product_name}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'I'})}).catch(()=>{});
          // #endregion

          // Products fetch as fallback in case product_name wasn't in JOIN result
          const products: ElectronProduct[] = await (window as { electronAPI: ElectronAPI }).electronAPI.localDbGetAllProducts();
          console.log('💾 [TransactionList] Fetched', products.length, 'products for fallback');

          // Get users and businesses to show actual names
          const users: ElectronUser[] = await (window as { electronAPI: ElectronAPI }).electronAPI.localDbGetUsers();
          const businesses: ElectronBusiness[] = await (window as { electronAPI: ElectronAPI }).electronAPI.localDbGetBusinesses();
          const refunds: TransactionRefund[] = await (window as { electronAPI: ElectronAPI }).electronAPI.localDbGetTransactionRefunds(transactionId);

          const user = users.find((u) => u.id === transaction.user_id);
          const business = businesses.find((b) => b.id === transaction.business_id);

          // Removed normalizeJsonField - no longer using JSON for customizations

          const refundTotalValue = transaction.refund_total ?? refunds.reduce((sum, refund) => sum + (refund.refund_amount ?? 0), 0);
          const finalAmount = Number(transaction.final_amount ?? 0);
          const refundStatusValue =
            transaction.refund_status ??
            (refundTotalValue > 0
              ? refundTotalValue >= finalAmount - 0.01
                ? 'full'
                : 'partial'
              : 'none');

          console.log('💾 [TransactionList] Mapping items to transaction detail format');
          const mappedItems = items.map((item) => {
            // Use product_name from JOIN first, then fallback to active products lookup
            // Ensure product_id is properly compared (handle both number and string)
            const productId = typeof item.product_id === 'number' ? item.product_id : Number(item.product_id);
            const product = products.find((p) => p.id === productId);
            // Check if product_name is null, undefined, or empty string
            const productName = (item.product_name && String(item.product_name).trim())
              ? String(item.product_name).trim()
              : (product?.nama && String(product.nama).trim())
                ? String(product.nama).trim()
                : 'Unknown Product';
            
            const customizations = Array.isArray(item.customizations) 
              ? item.customizations 
              : (item.customizations ? [item.customizations] : []);
            
            // Safely convert prices to numbers (handle null, undefined, string, or number)
            const parsePrice = (value: unknown): number => {
              if (typeof value === 'number' && !isNaN(value)) return value;
              if (value === null || value === undefined) return 0;
              const parsed = Number(value);
              return isNaN(parsed) ? 0 : parsed;
            };
            
            const mappedItem = {
              id: item.id,
              product_name: productName,
              quantity: item.quantity,
              unit_price: parsePrice(item.unit_price),
              total_price: parsePrice(item.total_price),
              custom_note: item.custom_note || undefined,
              customizations: customizations,
              bundleSelections: item.bundleSelections || undefined
            };
            
            return mappedItem;
          });
          
          console.log('💾 [TransactionList] Total mapped items:', mappedItems.length);

          return {
            ...transaction,
            payment_method: (transaction.payment_method || 'cash') as TransactionDetail['payment_method'],
            items: mappedItems,
            user_name: user?.name || 'Unknown User',
            business_name: business?.name || 'Unknown Business',
            refunds,
            refund_total: refundTotalValue,
            refund_status: refundStatusValue
          } as TransactionDetail;
        }
      );

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionList.tsx:439',message:'Setting selectedTransaction',data:{hasResponse:!!response,itemCount:response?.items?.length||0,firstItemProductName:response?.items?.[0]?.product_name,firstItemHasCustomizations:!!response?.items?.[0]?.customizations},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      setSelectedTransaction(response);
      setIsDetailModalOpen(true);
    } catch (error: unknown) {
      console.error('Error fetching transaction details:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoadingDetail(false);
      setLoadingTransactionId(null);
    }
  };

  // Handle row click
  const handleRowClick = (transactionId: string) => {
    console.log('🖱️ [TransactionList] Row clicked, fetching details for transaction ID:', transactionId);
    setLoadingTransactionId(transactionId);
    setIsLoadingDetail(true);
    setIsDetailModalOpen(true);
    fetchTransactionDetail(transactionId);
  };

  const handleTransactionUpdated = (updatedTransaction: TransactionDetail) => {
    setSelectedTransaction(updatedTransaction);
    setTransactions((prev) =>
      prev.map((tx) =>
        tx.id === updatedTransaction.id
          ? {
            ...tx,
            refund_status: updatedTransaction.refund_status ?? tx.refund_status,
            refund_total: updatedTransaction.refund_total ?? tx.refund_total
          }
          : tx
      )
    );
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
      } catch {
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

  interface ReceiptFetchResult {
    success: boolean;
    counters: Record<string, number>;
  }

  // Fetch original Receiptize counters from Printer2 audit log (same logic as reprint)
  const fetchReceiptizePrintedIds = useCallback(async (): Promise<ReceiptizeFetchResult> => {
    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined;
    if (!electronAPI?.getPrinter2AuditLog) {
      console.warn('Receiptize audit log API unavailable');
      return { success: false, ids: new Set<string>(), counters: {} };
    }

    try {
      // Try with date range first
      let response = await electronAPI.getPrinter2AuditLog(fromDate, toDate, 2000);
      let entries = Array.isArray(response?.entries) ? response.entries : [];

      // If no results with date filter, try without date filter (fallback)
      if (entries.length === 0) {
        console.log('⚠️ [TransactionList] No receiptize entries with date filter, trying without date filter');
        response = await electronAPI.getPrinter2AuditLog(undefined, undefined, 2000);
        entries = Array.isArray(response?.entries) ? response.entries : [];
      }

      const ids = new Set<string>();
      const originalCounters: Record<string, number> = {};

      for (const entry of entries) {
        if (entry?.transaction_id == null) continue;
        const txId = String(entry.transaction_id);
        ids.add(txId);

        // Find ORIGINAL print (is_reprint = 0 or undefined/null) - same logic as reprint
        const isReprint = entry.is_reprint;
        if (isReprint === 1) {
          // Skip reprints, only use original prints
          continue;
        }

        const counterValue = Number(entry.printer2_receipt_number);
        if (Number.isNaN(counterValue)) continue;

        // Only set if we haven't found an original print for this transaction yet
        if (!(txId in originalCounters)) {
          originalCounters[txId] = counterValue;
        }
      }
      
      // Debug: Log sample IDs to see what format they are
      if (ids.size > 0) {
        const sampleIds = Array.from(ids).slice(0, 3);
        console.log('🔍 [TransactionList] Receiptize audit log transaction IDs (sample):', sampleIds);
      }

      console.log(`📊 [TransactionList] Receiptize audit log: ${entries.length} total entries, ${ids.size} unique transactions, ${Object.keys(originalCounters).length} with counters`);
      return { success: true, ids, counters: originalCounters };
    } catch (err) {
      console.error('Failed to fetch Receiptize audit log:', err);
      return { success: false, ids: new Set<string>(), counters: {} };
    }
  }, [fromDate, toDate]);

  // Fetch original Receipt counters from Printer1 audit log (same logic as reprint)
  const fetchReceiptPrintedIds = useCallback(async (): Promise<ReceiptFetchResult> => {
    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: ElectronAPI }).electronAPI : undefined;
    if (!electronAPI?.getPrinter1AuditLog) {
      console.warn('Receipt audit log API unavailable');
      return { success: false, counters: {} };
    }

    try {
      // Try with date range first
      let response = await electronAPI.getPrinter1AuditLog(fromDate, toDate, 2000);
      let entries = Array.isArray(response?.entries) ? response.entries : [];

      // If no results with date filter, try without date filter (fallback)
      if (entries.length === 0) {
        console.log('⚠️ [TransactionList] No receipt entries with date filter, trying without date filter');
        response = await electronAPI.getPrinter1AuditLog(undefined, undefined, 2000);
        entries = Array.isArray(response?.entries) ? response.entries : [];
      }

      const originalCounters: Record<string, number> = {};

      for (const entry of entries) {
        if (entry?.transaction_id == null) continue;
        const txId = String(entry.transaction_id);

        // Find ORIGINAL print (is_reprint = 0 or undefined/null) - same logic as reprint
        const isReprint = entry.is_reprint;
        if (isReprint === 1) {
          // Skip reprints, only use original prints
          continue;
        }

        const counterValue = Number(entry.printer1_receipt_number);
        if (Number.isNaN(counterValue)) continue;

        // Only set if we haven't found an original print for this transaction yet
        if (!(txId in originalCounters)) {
          originalCounters[txId] = counterValue;
        }
      }

      return { success: true, counters: originalCounters };
    } catch (err) {
      console.error('Failed to fetch Receipt audit log:', err);
      return { success: false, counters: {} };
    }
  }, [fromDate, toDate]);

  // Fetch transactions function
  const fetchTransactions = useCallback(async (): Promise<boolean> => {
    // console.log('🔄 [TransactionList] fetchTransactions called - isOnlineMode:', isOnlineMode);
    setIsLoading(true);
    setError(null);

    try {
      let transactionsData: Transaction[];

      if (isOnlineMode) {
        console.log('🌐 [TransactionList] Fetching from online API');
        console.log('🌐 [TransactionList] API URL:', getApiUrl(`/api/transactions?business_id=${businessId}&from_date=${fromDate}&to_date=${toDate}&limit=10000`));
        // Fetch from online API only
        // Using 10000 limit to ensure we get all transactions in the date range
        const apiUrl = getApiUrl(`/api/transactions?business_id=${businessId}&from_date=${fromDate}&to_date=${toDate}&limit=10000`);
        const response = await fetch(apiUrl);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ [TransactionList] API Error Response:', {
            status: response.status,
            statusText: response.statusText,
            body: errorText
          });
          throw new Error(`Failed to fetch transactions: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('🌐 [TransactionList] API Response:', {
          success: data.success,
          transactionCount: data.transactions?.length || 0,
          hasTransactions: Array.isArray(data.transactions)
        });
        
        if (!data.success) {
          throw new Error(data.error || 'API returned unsuccessful response');
        }
        
        transactionsData = (data.transactions || []).map((tx: Record<string, unknown>) => {
          // CRITICAL: Always use uuid_id as the id, never numeric id or receipt_number
          // This ensures the transaction list uses UUIDs that match the detail API
          const transactionId = tx.uuid_id || tx.id;
          
          if (!transactionId) {
            console.warn('⚠️ [TransactionList] Transaction missing both uuid_id and id:', tx);
          }
          
          // Ensure refund_total and refund_status are properly included
          const refundTotal = tx.refund_total !== undefined && tx.refund_total !== null
            ? (typeof tx.refund_total === 'number' ? tx.refund_total : parseFloat(String(tx.refund_total)))
            : null;
          const refundStatus = tx.refund_status || null;

          return {
            ...tx,
            id: transactionId, // Always use UUID, not numeric ID or receipt number
            voucher_value: tx.voucher_value !== undefined && tx.voucher_value !== null ? parseFloat(String(tx.voucher_value)) : null,
            voucher_discount: tx.voucher_discount !== undefined && tx.voucher_discount !== null ? parseFloat(String(tx.voucher_discount)) : 0,
            voucher_type: tx.voucher_type || 'none',
            voucher_label: tx.voucher_label || null,
            customer_unit: tx.customer_unit !== undefined && tx.customer_unit !== null ? Number(tx.customer_unit) : null,
            refund_total: refundTotal,
            refund_status: refundStatus
          };
        });
        
        console.log('🌐 [TransactionList] Processed transactions:', transactionsData.length);
      } else {
        // console.log('💾 [TransactionList] Fetching from offline database');
        // Fetch from offline database only
        if (typeof window === 'undefined' || !(window as { electronAPI?: ElectronAPI }).electronAPI) {
          console.warn('⚠️ [TransactionList] Offline database not available, showing empty list');
          setTransactions([]);
          return true;
        }

        // Fetch a large number of transactions to ensure we get all transactions in the date range
        // Using 50000 limit to match printing page (offline-first, need all transactions)
        // This ensures we capture all transactions even for busy days with many transactions
        const offlineTransactions: ElectronTransaction[] = await (window as { electronAPI: ElectronAPI }).electronAPI.localDbGetTransactions(businessId, 50000);
        // console.log('💾 [TransactionList] Raw offline transactions count:', offlineTransactions.length);

        // Get users and businesses to show actual names (fetch once for all transactions)
        const users: ElectronUser[] = await (window as { electronAPI: ElectronAPI }).electronAPI.localDbGetUsers();
        const businesses: ElectronBusiness[] = await (window as { electronAPI: ElectronAPI }).electronAPI.localDbGetBusinesses();


        // Filter by date range - need to convert to local date for accurate filtering
        // This ensures we only show transactions within the selected date range
        const filteredTransactions = offlineTransactions.filter((tx) => {
          // Convert UTC to local date for accurate filtering
          const localDate = new Date(tx.created_at);
          const localDateString = localDate.getFullYear() + '-' +
            String(localDate.getMonth() + 1).padStart(2, '0') + '-' +
            String(localDate.getDate()).padStart(2, '0');
          const isInRange = localDateString >= fromDate && localDateString <= toDate;
          return isInRange;
        });

        // console.log('💾 [TransactionList] Filtered transactions (date range):', filteredTransactions.length, 'from', fromDate, 'to', toDate);

        transactionsData = filteredTransactions.map((tx) => {
          const user = users.find((u) => u.id === tx.user_id);
          const business = businesses.find((b) => b.id === tx.business_id);

          // CRITICAL: Use UUID as id, not numeric ID
          // The offline database should have uuid_id field, but if not, use id as fallback
          // This ensures consistency with the API which uses UUIDs
          const transactionId = tx.id; // Offline DB already uses UUID as id
          
          // Calculate refund_total and refund_status from the transaction data
          // The query should already include these, but ensure they're properly typed
          const refundTotal = tx.refund_total !== undefined && tx.refund_total !== null 
            ? (typeof tx.refund_total === 'number' ? tx.refund_total : Number(tx.refund_total)) 
            : null;
          const refundStatus = tx.refund_status || null;

          // Debug logging for transactions with refunds
          if (refundTotal && refundTotal > 0) {
            console.log('💰 [TransactionList] Transaction with refund:', {
              txId: tx.id,
              refundTotal: refundTotal,
              refundStatus: refundStatus,
              rawRefundTotal: tx.refund_total,
              rawRefundStatus: tx.refund_status
            });
          }

          return {
            id: transactionId, // Should already be UUID from offline DB
            business_id: tx.business_id,
            user_id: tx.user_id,
            payment_method: tx.payment_method as Transaction['payment_method'],
            pickup_method: tx.pickup_method as Transaction['pickup_method'],
            total_amount: tx.total_amount,
            voucher_discount: tx.voucher_discount || 0,
            voucher_type: (tx.voucher_type || 'none') as Transaction['voucher_type'],
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
            transaction_type: (tx.transaction_type || 'drinks') as Transaction['transaction_type'],
            status: tx.status || 'paid',
            created_at: tx.created_at,
            shift_uuid: tx.shift_uuid, // Include shift_uuid
            refund_total: refundTotal,
            refund_status: refundStatus,
            user_name: user?.name || 'Unknown User',
            business_name: business?.name || 'Unknown Business'
          };
        });
        
        // Debug: Log sample transaction IDs to compare with receiptize IDs
        if (transactionsData.length > 0) {
          const sampleTxIds = transactionsData.slice(0, 3).map(t => String(t.id));
          console.log('🔍 [TransactionList] Transaction IDs from offline DB (sample):', sampleTxIds);
        }

        // console.log('💾 [TransactionList] Processed transactions for display:', transactionsData.length);

      }

      // Apply permission-based filtering
      let filteredTransactions = transactionsData;

      // Filter by user permissions (Super Admin sees all data)
      if (!isSuperAdmin(user) && canViewUserDataOnly && !canViewAllData && user) {
        filteredTransactions = filteredTransactions.filter(tx => tx.user_id === parseInt(user.id));
      }

      // Filter by date permissions (if user doesn't have viewpastdata permission, only show today's data)
      // Super Admin bypasses date restrictions
      if (!isSuperAdmin(user) && !canViewPastData) {
        const today = getTodayUTC7();
        filteredTransactions = filteredTransactions.filter(tx => {
          const txDate = new Date(tx.created_at);
          const txDateString = txDate.getFullYear() + '-' +
            String(txDate.getMonth() + 1).padStart(2, '0') + '-' +
            String(txDate.getDate()).padStart(2, '0');
          return txDateString === today;
        });
      }

      setTransactions(filteredTransactions);

      // Debug logging for offline mode revenue calculation (offline-first priority)
      if (!isOnlineMode) {
        const totalRevenueDebug = filteredTransactions.reduce((sum, t) => {
          const amount = typeof t.final_amount === 'string' ? parseFloat(t.final_amount) : t.final_amount;
          return sum + (isNaN(amount) ? 0 : amount);
        }, 0);
        console.log('💾 [TransactionList] Offline mode summary:', {
          afterDateFilter: transactionsData.length,
          afterPermissionFilter: filteredTransactions.length,
          totalRevenue: totalRevenueDebug,
          dateRange: { fromDate, toDate },
          businessId,
          paymentMethods: filteredTransactions.reduce((acc, tx) => {
            acc[tx.payment_method] = (acc[tx.payment_method] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        });
      }

      // Fetch original Receiptize counters (from Printer2 audit log)
      const receiptizeResult = await fetchReceiptizePrintedIds();
      setReceiptizePrintedIds(receiptizeResult.ids);
      setReceiptizeCounters(receiptizeResult.counters);

      console.log('🔍 [TransactionList] Receiptize Result:', {
        success: receiptizeResult.success,
        idsCount: receiptizeResult.ids.size,
        countersCount: Object.keys(receiptizeResult.counters).length,
        sampleIds: Array.from(receiptizeResult.ids).slice(0, 5),
        dateRange: { fromDate, toDate },
        fromEpoch: fromDate ? new Date(fromDate).getTime() : null,
        toEpoch: toDate ? new Date(toDate + 'T23:59:59').getTime() : null
      });

      if (!receiptizeResult.success) {
        setError(prev => prev ?? 'Failed to fetch Receiptize print history');
        return false;
      }

      // Fetch original Receipt counters (from Printer1 audit log)
      const receiptResult = await fetchReceiptPrintedIds();
      setReceiptCounters(receiptResult.counters);


      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch transactions';
      setError(errorMessage);
      console.error('❌ [TransactionList] Error fetching transactions:', {
        error: err,
        message: errorMessage,
        isOnlineMode,
        businessId,
        fromDate,
        toDate
      });
      // Set empty array on error to show empty state
      setTransactions([]);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isOnlineMode, fromDate, toDate, businessId, fetchReceiptizePrintedIds, fetchReceiptPrintedIds, canViewUserDataOnly, canViewAllData, canViewPastData, user]);

  // Fetch transactions on mount and when dependencies change
  useEffect(() => {
    // console.log('🔍 [TransactionList] useEffect triggered - starting fetch immediately');
    const initialLoad = async () => {
      await fetchTransactions();
      // Do NOT set showAllTransactions to true on initial load
      // Only show receiptize transactions by default
    };
    initialLoad();
  }, [fetchTransactions]);

  useEffect(() => {
    setShowAllTransactions(false);
    setReceiptizeCounters({});
    setReceiptizePrintedIds(new Set<string>());
    setReceiptCounters({});
  }, [businessId, fromDate, toDate, isOnlineMode]);

  // State for refresh click counter
  const [, setRefreshClickCount] = useState(0);
  const [lastRefreshClick, setLastRefreshClick] = useState(0);

  // Debug log for refresh clicks
  // console.log('🔄 [TransactionList] Refresh click count:', refreshClickCount);

  const handleRefresh = useCallback(async () => {
    const success = await fetchTransactions();
    if (!success) {
      return;
    }

    // Handle 5x refresh click logic
    const now = Date.now();
    if (now - lastRefreshClick > 3000) {
      // Reset counter if more than 3 seconds passed
      setRefreshClickCount(1);
    } else {
      setRefreshClickCount(prev => {
        const newCount = prev + 1;
        if (newCount >= 5) {
          // Show all transactions after 5 clicks
          setShowAllTransactions(true);
          console.log('🔓 [TransactionList] 5x refresh clicked - showing all transactions');
          return 0; // Reset counter
        }
        return newCount;
      });
    }
    setLastRefreshClick(now);
  }, [fetchTransactions, lastRefreshClick]);

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

  // Payment method ID to code mapping (matches database payment_methods table)
  // 1=cash, 2=debit, 3=qr, 4=ewallet, 5=cl, 6=voucher,
  // 14=gofood, 15=grabfood, 16=shopeefood, 17=tiktok, 18=qpon
  const paymentMethodIdToCode: Record<number, string> = {
    1: 'cash',
    2: 'debit',
    3: 'qr',
    4: 'ewallet',
    5: 'cl',
    6: 'voucher',
    14: 'gofood',
    15: 'grabfood',
    16: 'shopeefood',
    17: 'tiktok',
    18: 'qpon'
  };

  // Get payment method code from ID or string
  const getPaymentMethodCode = (transaction: Transaction): string => {
    // Use payment_method_id as source of truth if available
    if (transaction.payment_method_id && paymentMethodIdToCode[transaction.payment_method_id]) {
      return paymentMethodIdToCode[transaction.payment_method_id];
    }
    // Fallback to payment_method string
    return transaction.payment_method?.toLowerCase() || 'cash';
  };

  // Get payment method label
  const getPaymentMethodLabel = (transaction: Transaction | string) => {
    // Handle both transaction object and string for backward compatibility
    const method = typeof transaction === 'string'
      ? transaction.toLowerCase()
      : getPaymentMethodCode(transaction as Transaction);

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
  const getPaymentMethodColor = (transaction: Transaction | string) => {
    // Handle both transaction object and string for backward compatibility
    const method = typeof transaction === 'string'
      ? transaction.toLowerCase()
      : getPaymentMethodCode(transaction as Transaction);

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
  // In default mode, only show transactions that are in receiptizePrintedIds (printed to Printer2/receiptize)
  // If no receiptize data is available, show all transactions (fallback)
  let baseTransactions: Transaction[];
  
  if (showAllTransactions) {
    baseTransactions = transactions;
  } else if (receiptizePrintedIds.size > 0) {
    const filtered = transactions.filter(transaction => {
      const txId = String(transaction.id);
      const isInSet = receiptizePrintedIds.has(txId);
      
      // Debug logging for first few transactions
      if (transactions.indexOf(transaction) < 3) {
        console.log('🔍 [TransactionList] Filter check:', {
          txId,
          isInSet,
          receiptizeIds: Array.from(receiptizePrintedIds).slice(0, 5),
          transactionId: transaction.id
        });
      }
      
      // Show if transaction is in receiptizePrintedIds (meaning it was printed to Printer2/receiptize)
      // This is more reliable than checking counters since IDs are set even for reprints
      return isInSet;
    });
    
    // If filter resulted in no transactions, show all instead (fallback for ID mismatch issues)
    if (filtered.length === 0 && transactions.length > 0) {
      console.warn('⚠️ [TransactionList] Receiptize filter returned 0 transactions, showing all transactions as fallback');
      baseTransactions = transactions;
    } else {
      baseTransactions = filtered;
    }
  } else {
    // Fallback: show all if no receiptize data available
    baseTransactions = transactions;
  }
  
  console.log('📊 [TransactionList] Transaction filtering:', {
    totalTransactions: transactions.length,
    receiptizeIdsCount: receiptizePrintedIds.size,
    showAllTransactions,
    baseTransactionsCount: baseTransactions.length,
    receiptizeIds: Array.from(receiptizePrintedIds).slice(0, 5),
    transactionIds: transactions.slice(0, 3).map(t => String(t.id))
  });


  const resolveReceiptSequence = (tx: Transaction) => {
    const txId = String(tx.id);

    // First check for Receiptize counter (from Printer2 audit log - original print)
    const receiptizeCounter = receiptizeCounters[txId];
    if (typeof receiptizeCounter === 'number' && receiptizeCounter > 0) {
      return receiptizeCounter;
    }

    // Then check for Receipt counter (from Printer1 audit log - original print)
    const receiptCounter = receiptCounters[txId];
    if (typeof receiptCounter === 'number' && receiptCounter > 0) {
      return receiptCounter;
    }

    // Fallback to transaction table value (may not match original print)
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
      let aValue: string | number = a[sortField as keyof Transaction] as string | number;
      let bValue: string | number = b[sortField as keyof Transaction] as string | number;

      // Handle different data types
      if (sortField === 'receipt_number') {
        aValue = resolveReceiptSequence(a);
        bValue = resolveReceiptSequence(b);
      } else if (sortField === 'id' || sortField === 'total_amount' || sortField === 'voucher_discount' || sortField === 'final_amount' || sortField === 'amount_received' || sortField === 'change_amount' || sortField === 'customer_unit' || sortField === 'refund_total') {
        aValue = typeof aValue === 'string' ? parseFloat(aValue) : (aValue as number || 0);
        bValue = typeof bValue === 'string' ? parseFloat(bValue) : (bValue as number || 0);
      } else if (sortField === 'created_at') {
        aValue = new Date(aValue as string).getTime();
        bValue = new Date(bValue as string).getTime();
      } else {
        // String fields
        aValue = (aValue?.toString().toLowerCase() || '') as string;
        bValue = (bValue?.toString().toLowerCase() || '') as string;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

  // Calculate totals
  const totalRevenue = filteredTransactions.reduce((sum, t) => {
    const amount = typeof t.final_amount === 'string' ? parseFloat(t.final_amount) : t.final_amount;
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0);
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TransactionList.tsx:1211',message:'Total revenue calculated',data:{totalRevenue,transactionCount:filteredTransactions.length,fromDate,toDate,businessId,statuses:filteredTransactions.map(t=>({id:t.id,status:t.status,final_amount:t.final_amount}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  const totalRefund = filteredTransactions.reduce((sum, t) => {
    const amount = typeof t.refund_total === 'string' ? parseFloat(t.refund_total) : (t.refund_total || 0);
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0);
  const totalVoucherDiscount = filteredTransactions.reduce((sum, t) => {
    const amount = typeof t.voucher_discount === 'string' ? parseFloat(t.voucher_discount) : t.voucher_discount;
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0);
  // Calculate Total CU and Transaction Count from both receipt (Printer 1) and receiptize (Printer 2)
  const { totalCustomerUnit, totalTransactionCount } = (() => {
    let totalCU = 0;
    let txCount = 0;

    transactions.forEach((tx) => {
      const txId = String(tx.id);
      const hasReceiptCounter = typeof receiptCounters[txId] === 'number' && receiptCounters[txId] > 0;
      const hasReceiptizeCounter = typeof receiptizeCounters[txId] === 'number' && receiptizeCounters[txId] > 0;

      // Include transaction if it has either receipt or receiptize counter
      if (hasReceiptCounter || hasReceiptizeCounter) {
        txCount += 1;
        const cuValue = typeof tx.customer_unit === 'number' ? tx.customer_unit : 0;
        totalCU += Number.isFinite(cuValue) ? cuValue : 0;
      }
    });

    return { totalCustomerUnit: totalCU, totalTransactionCount: txCount };
  })();

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

  // Permission error handling
  if (hasConflictingPermissions) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center p-8 bg-red-50 rounded-lg border border-red-200">
          <div className="text-red-600 text-lg font-semibold mb-2">Permission Error</div>
          <div className="text-red-700">User have both permissions, contact admin</div>
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

          {/* Online/Offline Toggle - Only show for authorized users */}
          {canViewOfflineOnlineSwitch && (
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
          )}
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
                  if (process.env.NODE_ENV === 'development') {
                    // In development, use Next.js router for reliable navigation
                    router.push('/logs/printing');
                  } else {
                    // In production (Electron file://), use window.location
                    window.location.href = 'logs/printing.html';
                  }
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
          <GrandTotalCard totalRevenue={totalRevenue} totalRefund={totalRefund} totalCustomerUnit={totalCustomerUnit} totalTransactionCount={totalTransactionCount} />
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

        {/* Info Message for Online Mode */}
        {isOnlineMode && transactions.length === 0 && !error && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Wifi className="w-5 h-5 text-yellow-600" />
              <div>
                <p className="text-yellow-800 font-medium">No transactions found for this date range in MySQL database</p>
                <p className="text-yellow-600 text-sm mt-1">
                  Make sure the database connection is configured correctly and data has been migrated.
                  Check the console for API errors.
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
                          <span className="text-[10px]">Metode</span>
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
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                        onClick={() => handleSort('refund_total')}
                      >
                        <div className="flex items-center gap-1">
                          Refund
                          {getSortIcon('refund_total')}
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
                          <div className="flex items-center gap-1">
                            {(() => {
                              const txId = String(transaction.id);
                              const receiptizeCounter = receiptizeCounters[txId];
                              const receiptCounter = receiptCounters[txId];
                              const hasReceiptizeCounter = typeof receiptizeCounter === 'number' && receiptizeCounter > 0;
                              const hasReceiptCounter = typeof receiptCounter === 'number' && receiptCounter > 0;
                              const isInReceiptizeIds = receiptizePrintedIds.has(txId);

                              // Determine if this is a receiptize transaction (printed to Printer2)
                              // A transaction is receiptize if it's in receiptizePrintedIds OR has a receiptize counter
                              const isReceiptize = isInReceiptizeIds || hasReceiptizeCounter;

                              // Determine the number to display using resolveReceiptSequence logic
                              let displayNumber: number;
                              if (hasReceiptizeCounter) {
                                displayNumber = receiptizeCounter;
                              } else if (hasReceiptCounter) {
                                displayNumber = receiptCounter;
                              } else {
                                // Fallback to transaction receipt_number
                                displayNumber = typeof transaction.receipt_number === 'number' && transaction.receipt_number > 0
                                  ? transaction.receipt_number
                                  : 0;
                              }

                              // Receiptize transaction (printed to Printer2/receiptize)
                              if (isReceiptize) {
                                if (showAllTransactions) {
                                  // Show all mode: Show RR badge to distinguish from R transactions
                                  return (
                                    <>
                                      <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                        RR
                                      </span>
                                      <span className="text-xs font-medium text-blue-600">
                                        {displayNumber}
                                      </span>
                                    </>
                                  );
                                } else {
                                  // Default mode: Show just the number without badge (to avoid suspicion)
                                  return (
                                    <span className="text-xs font-medium text-blue-600">
                                      {displayNumber}
                                    </span>
                                  );
                                }
                              }

                              // Receipt transaction (printed to Printer1/receipt, but NOT to Printer2)
                              // Only show in "show all" mode (after 5x refresh clicks)
                              if (showAllTransactions && hasReceiptCounter && !isReceiptize) {
                                return (
                                  <>
                                    <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                      R
                                    </span>
                                    <span className="text-xs font-medium text-blue-600">
                                      {displayNumber}
                                    </span>
                                  </>
                                );
                              }

                              // Fallback: Show number if available (for transactions without audit log entries)
                              // This handles cases where audit logs are empty or not yet synced
                              if (displayNumber > 0) {
                                // In default mode, if we can't determine receiptize vs receipt, show without badge
                                // In show all mode, if neither counter exists, also show without badge
                                return (
                                  <span className="text-xs font-medium text-blue-600">
                                    {displayNumber}
                                  </span>
                                );
                              }

                              // Last resort: Show N/A
                              return (
                                <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                                  N/A
                                </span>
                              );
                            })()}
                          </div>
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
                          <span className={`inline-flex px-1.5 py-0.5 text-xs font-semibold rounded-full ${transaction.transaction_type === 'drinks'
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
                          <span className={`inline-flex px-1.5 py-0.5 text-xs font-semibold rounded-full ${getPaymentMethodColor(transaction)}`}>
                            {getPaymentMethodLabel(transaction)}
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
                        <td
                          className="px-6 py-4 whitespace-nowrap cursor-pointer"
                          onClick={() => {
                            setVoucherClickCount(prev => {
                              const newCount = prev + 1;
                              if (newCount >= 5 && canViewPrintingLogs) {
                                setShowPrintingLogs(true);
                                return 0; // Reset counter
                              }
                              return newCount;
                            });
                          }}
                        >
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
                        <td className="px-4 py-4 whitespace-nowrap">
                          {(() => {
                            // Convert refund_total to number if it's a string, handle null/undefined
                            const refundAmount = transaction.refund_total !== null && transaction.refund_total !== undefined
                              ? (typeof transaction.refund_total === 'number' 
                                  ? transaction.refund_total 
                                  : parseFloat(String(transaction.refund_total)))
                              : 0;
                            
                            if (refundAmount > 0) {
                              return (
                                <div className="flex flex-col">
                                  <span className="text-xs text-red-600 font-medium">
                                    -{formatPrice(refundAmount)}
                                  </span>
                                  {transaction.refund_status && (
                                    <span className={`text-[10px] font-medium ${transaction.refund_status === 'full'
                                        ? 'text-red-600'
                                        : 'text-orange-600'
                                      }`}>
                                      {transaction.refund_status === 'full' ? 'Full' : 'Partial'}
                                    </span>
                                  )}
                                </div>
                              );
                            }
                            return <span className="text-xs text-gray-400">-</span>;
                          })()}
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
        canRefund={canRefund}
        onTransactionUpdated={handleTransactionUpdated}
      />

      {/* Printing Logs Modal */}
      {showPrintingLogs && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Printing Logs</h2>
              <button
                onClick={() => setShowPrintingLogs(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <div className="text-center py-8">
                <div className="text-gray-500 mb-4">
                  <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Printing Logs</h3>
                <p className="text-gray-600 mb-4">
                  This feature shows receipt printing history, reprint logs, and voucher printing activities.
                </p>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800">
                    <strong>Access granted:</strong> You have permission to view printing logs.
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    Feature implementation pending - this is a placeholder for the printing logs functionality.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
  totalRefund: number;
  totalCustomerUnit: number;
  totalTransactionCount: number;
}

function GrandTotalCard({ totalRevenue, totalRefund, totalCustomerUnit, totalTransactionCount }: GrandTotalCardProps) {
  const netRevenue = totalRevenue - totalRefund;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 md:col-span-1">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
        <h3 className="font-semibold text-gray-900 text-sm">Grand Total</h3>
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-gray-600">Gross:</span>
          <span className="font-medium text-gray-900">{formatPrice(totalRevenue)}</span>
        </div>
        {totalRefund > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-gray-600">Refund:</span>
            <span className="font-medium text-red-600">-{formatPrice(totalRefund)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm border-t pt-1.5">
          <span className="font-semibold text-gray-900">Net:</span>
          <span className="font-bold text-gray-900">{formatPrice(netRevenue)}</span>
        </div>
        <div className="flex justify-between text-xs pt-1 border-t">
          <span className="text-gray-600">Txs/CU:</span>
          <span className="font-semibold text-gray-900">{totalTransactionCount}/{totalCustomerUnit}</span>
        </div>
      </div>
    </div>
  );
}