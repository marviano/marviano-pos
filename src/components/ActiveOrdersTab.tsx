'use client';

import { useState, useEffect, useCallback } from 'react';
import { Edit, List, LayoutGrid, Printer, Scissors } from 'lucide-react';
import TableLayout from './TableLayout';
import SplitBillModal from './SplitBillModal';
import { useAuth } from '@/hooks/useAuth';
import { hasPermission } from '@/lib/permissions';
import { isSuperAdmin } from '@/lib/auth';

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
  waiter_name?: string | null;
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
  const [printingBill, setPrintingBill] = useState<string | null>(null);
  const [showSplitBillModal, setShowSplitBillModal] = useState(false);
  const { user } = useAuth();
  const canAccessSplitBillButton = isSuperAdmin(user) || hasPermission(user, 'access_kasir_splitbillpindahmeja_button');

  const fetchPendingTransactions = useCallback(async () => {
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
      const employeesMap = new Map<number, string>();
      
      // Fetch employees to get waiter names
      if (electronAPI.localDbGetEmployees) {
        try {
          const allEmployees = await electronAPI.localDbGetEmployees();
          const employeesArray = Array.isArray(allEmployees) ? allEmployees : [];
          employeesArray.forEach((emp: { id?: number | string; nama_karyawan?: string }) => {
            const empId = typeof emp.id === 'number' ? emp.id : (typeof emp.id === 'string' ? parseInt(emp.id, 10) : null);
            if (empId && typeof emp.nama_karyawan === 'string') {
              employeesMap.set(empId, emp.nama_karyawan);
            }
          });
          console.log('🔍 [ACTIVE ORDERS] Employees loaded:', {
            totalEmployees: employeesArray.length,
            employeesMap_size: employeesMap.size,
            sampleEmployeeIds: Array.from(employeesMap.keys()).slice(0, 5)
          });
        } catch (error) {
          console.warn('Failed to fetch employees:', error);
        }
      }
      
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

      // Filter for pending transactions, check for items, and map to our format
      const pendingTransactionsWithItems: PendingTransaction[] = [];
      const transactionsToCancel: Array<Record<string, unknown>> = [];

      // First pass: Check each pending transaction for items
      for (const tx of transactionsArray) {
        if (tx && typeof tx === 'object' && 'status' in tx) {
          const transaction = tx as Record<string, unknown> & { 
            status: string; 
            uuid_id?: string; 
            id?: string;
            table_id?: number | null;
            customer_name?: string | null;
            waiter_id?: number | null;
            total_amount?: number;
            final_amount?: number;
            created_at?: string;
          };
          
          // Only process pending transactions
          if (transaction.status !== 'pending') {
            continue;
          }

          const txId = transaction.uuid_id || transaction.id || '';
          if (!txId) continue;

          // Check if transaction has items
          if (electronAPI.localDbGetTransactionItems) {
            try {
              const items = await electronAPI.localDbGetTransactionItems(txId);
              const itemsArray = Array.isArray(items) ? items : [];
              
              // If transaction has no items, mark it for cancellation
              if (itemsArray.length === 0) {
                console.log(`⚠️ [ACTIVE ORDERS] Transaction ${txId} has no items, marking as cancelled`);
                transactionsToCancel.push(transaction);
                continue; // Skip adding to pending list
              }
            } catch (error) {
              console.warn(`Failed to check items for transaction ${txId}:`, error);
              // If we can't check items, include the transaction anyway to be safe
            }
          }

          // Transaction has items, process it
          const tableId = transaction.table_id || null;
          const tableInfo = tableId && tablesMap.has(tableId) ? tablesMap.get(tableId)! : null;
          const tableNumber = tableInfo ? tableInfo.table_number : null;
          const roomId = tableInfo ? tableInfo.room_id : null;
          const roomName = roomId && roomsMap.has(roomId) ? roomsMap.get(roomId)! : null;

          // Format: "table_name/room_name" or "Take-away" if no table
          const tableRoomDisplay = tableId && tableNumber && roomName
            ? `${tableNumber}/${roomName}`
            : 'Take-away';

          // Get waiter name
          const waiterId = typeof transaction.waiter_id === 'number' 
            ? transaction.waiter_id 
            : (typeof transaction.waiter_id === 'string' ? parseInt(transaction.waiter_id, 10) : null);
          const waiterName = waiterId && employeesMap.has(waiterId) ? employeesMap.get(waiterId)! : null;
          console.log('🔍 [ACTIVE ORDERS] Transaction waiter lookup:', {
            transactionId: txId,
            waiter_id_from_db: transaction.waiter_id,
            waiterId_parsed: waiterId,
            employeesMap_size: employeesMap.size,
            employeesMap_has_waiterId: waiterId ? employeesMap.has(waiterId) : false,
            waiterName: waiterName
          });

          pendingTransactionsWithItems.push({
            id: txId,
            uuid_id: txId,
            table_id: tableId,
            customer_name: transaction.customer_name || null,
            total_amount: transaction.total_amount || 0,
            final_amount: transaction.final_amount || transaction.total_amount || 0,
            created_at: transaction.created_at || new Date().toISOString(),
            table_number: tableRoomDisplay,
            room_name: roomName || undefined,
            waiter_name: waiterName,
          });
        }
      }

      // Update empty transactions to cancelled status
      if (transactionsToCancel.length > 0 && electronAPI.localDbUpsertTransactions) {
        try {
          const transactionsToUpdate = transactionsToCancel.map(tx => ({
            ...tx,
            status: 'cancelled',
            updated_at: new Date().toISOString()
          }));
          
          await electronAPI.localDbUpsertTransactions(transactionsToUpdate);
          console.log(`✅ [ACTIVE ORDERS] Updated ${transactionsToUpdate.length} empty transaction(s) to cancelled status`);
        } catch (error) {
          console.error('Failed to update empty transactions to cancelled:', error);
        }
      }

      // Sort by created_at descending (newest first)
      const pending = pendingTransactionsWithItems.sort((a, b) => {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      setPendingTransactions(pending);
    } catch (error) {
      console.error('Error fetching pending transactions:', error);
      setError('Failed to fetch pending transactions');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (isOpen) {
      fetchPendingTransactions();
      // Refresh transaction list every 5 seconds
      const interval = setInterval(fetchPendingTransactions, 5000);
      return () => clearInterval(interval);
    }
  }, [isOpen, fetchPendingTransactions]);

  // Update timer display every second
  useEffect(() => {
    if (isOpen && pendingTransactions.length > 0) {
      const interval = setInterval(() => {
        setCurrentTime(new Date());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isOpen, pendingTransactions.length]);

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

  const sumCustomizationPrice = (customizations?: Array<{ selected_options?: Array<{ price_adjustment?: number }> }>) => {
    if (!customizations || customizations.length === 0) return 0;
    return customizations.reduce((sum, customization) => {
      const optionTotal = (customization.selected_options || []).reduce(
        (optionSum, option) => optionSum + (option.price_adjustment || 0),
        0
      );
      return sum + optionTotal;
    }, 0);
  };

  const handlePrintBill = async (transactionId: string) => {
    try {
      setPrintingBill(transactionId);
      const electronAPI = getElectronAPI();
      
      if (!electronAPI?.localDbGetTransactions || !electronAPI?.localDbGetTransactionItems || !electronAPI?.localDbGetTransactionItemCustomizationsNormalized) {
        alert('Print Bill tidak tersedia. Pastikan aplikasi terhubung dengan database lokal.');
        return;
      }

      // Fetch transaction data
      const allTransactions = await electronAPI.localDbGetTransactions(businessId, 10000);
      const transactionsArray = Array.isArray(allTransactions) ? allTransactions : [];
      const transaction = transactionsArray.find((tx: unknown) => {
        if (tx && typeof tx === 'object') {
          const t = tx as { uuid_id?: string; id?: string };
          return (t.uuid_id === transactionId) || (t.id === transactionId);
        }
        return false;
      }) as Record<string, unknown> | undefined;

      if (!transaction) {
        alert('Transaksi tidak ditemukan');
        return;
      }

      // Fetch transaction items
      const transactionItems = await electronAPI.localDbGetTransactionItems(transactionId);
      const itemsArray = Array.isArray(transactionItems) ? transactionItems : [];
      
      if (itemsArray.length === 0) {
        alert('Tidak ada item dalam transaksi ini');
        return;
      }

      // Fetch customizations
      const customizationsData = await electronAPI.localDbGetTransactionItemCustomizationsNormalized(transactionId);
      const customizations = Array.isArray(customizationsData?.customizations) ? customizationsData.customizations : [];
      const customizationOptions = customizationsData?.options || [];

      // Create customizations map
      const customizationsMap = new Map<number, Array<{
        customization_id: number;
        customization_name: string;
        selected_options: Array<{
          option_id: number;
          option_name: string;
          price_adjustment: number;
        }>;
      }>>();

      const itemsByIdMap = new Map<number, Record<string, unknown>>();
      itemsArray.forEach((item) => {
        const itemRecord = item as Record<string, unknown>;
        const id = typeof itemRecord.id === 'number' ? itemRecord.id : (typeof itemRecord.id === 'string' ? parseInt(itemRecord.id, 10) : null);
        if (id) {
          itemsByIdMap.set(id, itemRecord);
        }
      });

      // Group customizations by transaction_item_id
      customizations.forEach((cust: Record<string, unknown>) => {
        const itemId = typeof cust.transaction_item_id === 'number' 
          ? cust.transaction_item_id 
          : (typeof cust.transaction_item_id === 'string' ? parseInt(cust.transaction_item_id, 10) : null);
        if (!itemId || !itemsByIdMap.has(itemId)) return;

        if (!customizationsMap.has(itemId)) {
          customizationsMap.set(itemId, []);
        }

        const options = (customizationOptions as Array<Record<string, unknown>>).filter((opt) => 
          opt.transaction_item_customization_id === cust.id
        ).map((opt) => {
          const priceAdj = typeof opt.price_adjustment === 'number' 
            ? opt.price_adjustment 
            : (typeof opt.price_adjustment === 'string' ? parseFloat(opt.price_adjustment) || 0 : 0);
          const optionId = typeof opt.customization_option_id === 'number' 
            ? opt.customization_option_id 
            : (typeof opt.customization_option_id === 'string' ? parseInt(opt.customization_option_id, 10) : 0);
          const optionName = typeof opt.option_name === 'string' ? opt.option_name : String(opt.option_name || '');
          return {
            option_id: optionId,
            option_name: optionName,
            price_adjustment: priceAdj,
          };
        });

        const custTypeId = typeof cust.customization_type_id === 'number' 
          ? cust.customization_type_id 
          : (typeof cust.customization_type_id === 'string' ? parseInt(cust.customization_type_id, 10) : 0);
        const existingCust = customizationsMap.get(itemId)!.find(c => 
          c.customization_id === custTypeId
        );

        if (existingCust) {
          existingCust.selected_options.push(...options);
        } else {
          const customizationName = (cust.customization_type_name as string) || `Customization ${custTypeId}`;
          customizationsMap.get(itemId)!.push({
            customization_id: custTypeId,
            customization_name: customizationName,
            selected_options: options,
          });
        }
      });

      // Fetch products
      const allProducts = await electronAPI.localDbGetAllProducts?.();
      const productsArray = Array.isArray(allProducts) ? allProducts : [];
      const productsMap = new Map<number, Record<string, unknown>>();
      productsArray.forEach((p) => {
        const pRecord = p as Record<string, unknown>;
        const id = typeof pRecord.id === 'number' ? pRecord.id : (typeof pRecord.id === 'string' ? parseInt(pRecord.id, 10) : null);
        if (id) {
          productsMap.set(id, pRecord);
        }
      });

      // Prepare receipt items
      const receiptItems: Array<{ name: string; quantity: number; price: number; total_price: number }> = [];

      (itemsArray as Array<Record<string, unknown>>).forEach((item) => {
        const productId = typeof item.product_id === 'number' ? item.product_id : (typeof item.product_id === 'string' ? parseInt(item.product_id, 10) : null);
        if (!productId) return;
        
        const product = productsMap.get(productId);
        if (!product) return;

        const itemId = typeof item.id === 'number' ? item.id : (typeof item.id === 'string' ? parseInt(item.id, 10) : null);
        const itemCustomizations = itemId ? (customizationsMap.get(itemId) || []) : [];
        const itemQuantity = typeof item.quantity === 'number' ? item.quantity : (typeof item.quantity === 'string' ? parseInt(item.quantity, 10) : 1);
        const itemCustomNote = typeof item.custom_note === 'string' ? item.custom_note : undefined;

        // Get base price
        const basePrice = typeof product.harga_jual === 'number' ? product.harga_jual : 0;
        const itemPrice = basePrice + sumCustomizationPrice(itemCustomizations);

        // Format item name with customizations
        let itemName = typeof product.nama === 'string' ? product.nama : '';
        if (itemCustomizations.length > 0) {
          const customizationText = itemCustomizations.map(c =>
            `${c.customization_name}: ${c.selected_options.map(opt => opt.option_name).join(', ')}`
          ).join(', ');
          itemName = `${itemName} (${customizationText})`;
        }
        if (itemCustomNote) {
          if (itemName.includes('(')) {
            itemName = `${itemName}, ${itemCustomNote})`;
          } else {
            itemName = `${itemName} (${itemCustomNote})`;
          }
        }

        // Handle bundle selections if any
        const bundleSelectionsJson = typeof item.bundle_selections_json === 'string' ? item.bundle_selections_json : undefined;
        if (bundleSelectionsJson) {
          try {
            const bundleSelections = JSON.parse(bundleSelectionsJson) as Array<{
              category2_name?: string;
              selectedProducts?: Array<{
                product?: { nama?: string };
                quantity?: number;
                customizations?: Array<{ customization_name?: string; selected_options?: Array<{ option_name?: string; price_adjustment?: number }> }>;
                customNote?: string;
              }>;
            }>;
            
            if (Array.isArray(bundleSelections)) {
              bundleSelections.forEach(bundleSel => {
                (bundleSel.selectedProducts || []).forEach(sp => {
                  const selectionQty = typeof sp.quantity === 'number' && !Number.isNaN(sp.quantity) ? sp.quantity : 1;
                  const totalQty = itemQuantity * selectionQty;
                  
                  const customizationDetails: string[] = [];
                  if (sp.customizations && sp.customizations.length > 0) {
                    sp.customizations.forEach(customization => {
                      const optionNames = (customization.selected_options || []).map(opt => opt.option_name).join(', ');
                      if (optionNames) {
                        customizationDetails.push(
                          customization.customization_name
                            ? `${customization.customization_name}: ${optionNames}`
                            : optionNames
                        );
                      }
                    });
                  }
                  if (sp.customNote && sp.customNote.trim() !== '') {
                    customizationDetails.push(sp.customNote.trim());
                  }

                  let subItemName = `  └ ${sp.product?.nama || ''}${selectionQty > 1 ? ` (×${selectionQty})` : ''}`;
                  if (customizationDetails.length > 0) {
                    subItemName = `${subItemName} (${customizationDetails.join(', ')})`;
                  }

                  const perUnitAdjustment = sumCustomizationPrice(sp.customizations);
                  receiptItems.push({
                    name: subItemName,
                    quantity: totalQty,
                    price: perUnitAdjustment,
                    total_price: perUnitAdjustment * totalQty
                  });
                });
              });
            }
          } catch (e) {
            console.warn('Failed to parse bundle selections:', e);
          }
        }

        receiptItems.push({
          name: itemName,
          quantity: itemQuantity,
          price: itemPrice,
          total_price: itemPrice * itemQuantity
        });
      });

      // Calculate total
      const total = receiptItems.reduce((sum, item) => sum + item.total_price, 0);

      // Get cashier name
      const cashierName = user?.name || 'Kasir';

      // Get table number
      const tableId = typeof transaction.table_id === 'number' ? transaction.table_id : null;
      let tableNumber = 'Take-away';
      if (tableId && electronAPI.getRestaurantTables && electronAPI.getRestaurantRooms) {
        try {
          const rooms = await electronAPI.getRestaurantRooms(businessId);
          const roomsArray = Array.isArray(rooms) ? rooms : [];
          for (const room of roomsArray) {
            if (room.id) {
              const tables = await electronAPI.getRestaurantTables(room.id);
              const tablesArray = Array.isArray(tables) ? tables : [];
              const table = tablesArray.find((t: { id: number }) => t.id === tableId);
              if (table) {
                const roomName = roomsArray.find((r: { id: number }) => r.id === room.id)?.name || '';
                tableNumber = `${table.table_number}/${roomName}`;
                break;
              }
            }
          }
        } catch (error) {
          console.warn('Failed to fetch table info:', error);
        }
      }

      // Prepare print data for bill (without payment fields)
      const printData = {
        type: 'transaction',
        printerType: 'receiptPrinter',
        printerName: '',
        business_id: businessId,
        items: receiptItems,
        total: total,
        date: typeof transaction.created_at === 'string' ? transaction.created_at : new Date().toISOString(),
        tableNumber: tableNumber,
        cashier: cashierName,
        transactionType: typeof transaction.transaction_type === 'string' ? transaction.transaction_type : 'dine-in',
        pickupMethod: typeof transaction.pickup_method === 'string' ? transaction.pickup_method : 'dine-in',
        isBill: true, // Flag to indicate this is a bill, not a receipt
      };

      // Print the bill
      const printResult = await electronAPI.printReceipt?.(printData);
      if (printResult && typeof printResult === 'object' && 'success' in printResult && !printResult.success) {
        alert(`Gagal mencetak bill: ${(printResult as { error?: string }).error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error printing bill:', error);
      alert('Terjadi kesalahan saat mencetak bill');
    } finally {
      setPrintingBill(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute top-0 right-0 bottom-0 left-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Active Orders</h2>
            </div>
            <button
              onClick={() => setShowSplitBillModal(true)}
              disabled={!canAccessSplitBillButton}
              className={`px-[14px] py-[7px] text-sm rounded-lg transition-all flex items-center gap-1.5 font-medium shadow-lg active:scale-95 active:shadow-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
                canAccessSplitBillButton
                  ? 'bg-gradient-to-r from-purple-600 to-purple-700 text-white hover:shadow-xl hover:from-purple-700 hover:to-purple-800'
                  : 'bg-gray-400 text-gray-200 cursor-not-allowed'
              }`}
              title={!canAccessSplitBillButton ? 'Anda tidak memiliki izin untuk mengakses fitur Split Bill/Pindah Meja' : undefined}
            >
              <Scissors className="w-3.5 h-3.5" />
              Split Bill/Pindah Meja
            </button>
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
                      Waiter
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
                          {transaction.waiter_name || '-'}
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
                        <div className="flex gap-2">
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
                          <button
                            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => handlePrintBill(transaction.uuid_id)}
                            disabled={printingBill === transaction.uuid_id}
                          >
                            <Printer className="w-4 h-4 mr-2" />
                            {printingBill === transaction.uuid_id ? 'Mencetak...' : 'Print Bill'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Split Bill Modal */}
      <SplitBillModal
        isOpen={showSplitBillModal}
        onClose={() => setShowSplitBillModal(false)}
        businessId={businessId}
        onRefresh={fetchPendingTransactions}
      />
    </div>
  );
}




