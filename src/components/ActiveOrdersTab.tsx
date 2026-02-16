'use client';

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Edit, List, LayoutGrid, Printer, Scissors } from 'lucide-react';
import { formatPackageLineDisplay } from './PackageSelectionModal';
import TableLayout from './TableLayout';
import SplitBillModal from './SplitBillModal';
import PrintBillModal, { type PrintBillModalData } from './PrintBillModal';
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
  waiter_color?: string | null;
  waiter_id?: number | null;
  /** All distinct waiter names (transaction + item-level) for tooltip */
  waiter_names_all?: string[];
  pickup_method: 'dine-in' | 'take-away';
  shift_uuid?: string | null;
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
  const [showPrintBillModal, setShowPrintBillModal] = useState(false);
  const [printBillModalData, setPrintBillModalData] = useState<PrintBillModalData | null>(null);
  const [openWaiterPopoverFor, setOpenWaiterPopoverFor] = useState<string | null>(null);
  const waiterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const waiterPopoverRef = useRef<HTMLDivElement>(null);
  const [waiterPopoverPos, setWaiterPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [shiftLabelByUuid, setShiftLabelByUuid] = useState<Record<string, string>>({});
  useLayoutEffect(() => {
    if (openWaiterPopoverFor === null) {
      setWaiterPopoverPos(null);
      return;
    }
    const el = waiterTriggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const popoverH = 120;
    const showAbove = rect.bottom + popoverH > window.innerHeight;
    setWaiterPopoverPos({
      top: showAbove ? rect.top - popoverH - 4 : rect.bottom + 4,
      left: rect.left,
    });
  }, [openWaiterPopoverFor]);
  useEffect(() => {
    if (openWaiterPopoverFor === null) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (waiterTriggerRef.current?.contains(target) || waiterPopoverRef.current?.contains(target)) return;
      setOpenWaiterPopoverFor(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openWaiterPopoverFor]);
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
      const employeesColorMap = new Map<number, string | null>();

      // Fetch employees to get waiter names and colors
      if (electronAPI.localDbGetEmployees) {
        try {
          const allEmployees = await electronAPI.localDbGetEmployees();
          const employeesArray = Array.isArray(allEmployees) ? allEmployees : [];
          employeesArray.forEach((emp: { id?: number | string; nama_karyawan?: string; color?: string | null }) => {
            const empId = typeof emp.id === 'number' ? emp.id : (typeof emp.id === 'string' ? parseInt(emp.id, 10) : null);
            if (empId) {
              if (typeof emp.nama_karyawan === 'string') employeesMap.set(empId, emp.nama_karyawan);
              employeesColorMap.set(empId, typeof emp.color === 'string' && emp.color ? emp.color : null);
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
            pickup_method?: string;
            payment_method?: string;
            shift_uuid?: string | null;
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

              // Filter out cancelled items to check for truly empty transactions
              // Cast as any because type definition might be loose here
              const activeItems = itemsArray.filter((item: any) => item.production_status !== 'cancelled');

              // If transaction has no ACTIVE items, mark it for cancellation
              if (activeItems.length === 0) {
                console.log(`⚠️ [ACTIVE ORDERS] Transaction ${txId} has no active items (all cancelled or empty), marking as cancelled`);
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

          // Get waiter name and color
          const waiterId = typeof transaction.waiter_id === 'number'
            ? transaction.waiter_id
            : (typeof transaction.waiter_id === 'string' ? parseInt(transaction.waiter_id, 10) : null);
          const waiterName = waiterId && employeesMap.has(waiterId) ? employeesMap.get(waiterId)! : null;
          const waiterColor = waiterId ? (employeesColorMap.get(waiterId) ?? null) : null;
          console.log('🔍 [ACTIVE ORDERS] Transaction waiter lookup:', {
            transactionId: txId,
            waiter_id_from_db: transaction.waiter_id,
            waiterId_parsed: waiterId,
            employeesMap_size: employeesMap.size,
            employeesMap_has_waiterId: waiterId ? employeesMap.has(waiterId) : false,
            waiterName: waiterName
          });

          // Pickup method: use stored value, or default take-away for platform orders (gofood/grabfood/shopeefood/qpon/tiktok)
          const platformPaymentMethods = ['gofood', 'grabfood', 'shopeefood', 'qpon', 'tiktok'];
          const pm = typeof transaction.pickup_method === 'string' ? transaction.pickup_method : null;
          const paymentMethod = typeof transaction.payment_method === 'string' ? (transaction.payment_method as string).toLowerCase() : '';
          const pickupMethod: 'dine-in' | 'take-away' =
            pm === 'take-away' || pm === 'dine-in' ? pm
              : platformPaymentMethods.includes(paymentMethod) ? 'take-away'
                : 'dine-in';

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
            waiter_color: waiterColor,
            waiter_id: waiterId ?? null,
            pickup_method: pickupMethod,
            shift_uuid: typeof transaction.shift_uuid === 'string' ? transaction.shift_uuid : null,
          });
        }
      }

      // Fetch distinct item-level waiter IDs per transaction and enrich waiter display (primary + tooltip)
      if (pendingTransactionsWithItems.length > 0 && electronAPI.localDbGetDistinctItemWaiterIdsByTransaction) {
        try {
          const txIds = pendingTransactionsWithItems.map((t) => t.uuid_id);
          const itemWaiterIdsByTx = await electronAPI.localDbGetDistinctItemWaiterIdsByTransaction(txIds);
          for (const t of pendingTransactionsWithItems) {
            const itemWaiterIds = itemWaiterIdsByTx[t.uuid_id] || [];
            const allWaiterIds = [...new Set([t.waiter_id, ...itemWaiterIds].filter((id): id is number => id != null))];
            const primaryId = t.waiter_id ?? allWaiterIds[0];
            if (allWaiterIds.length > 0) {
              t.waiter_name = primaryId && employeesMap.has(primaryId) ? employeesMap.get(primaryId)! : (t.waiter_name ?? null);
              t.waiter_color = primaryId ? (employeesColorMap.get(primaryId) ?? t.waiter_color) : t.waiter_color;
            }
            t.waiter_names_all = allWaiterIds.map((id) => employeesMap.get(id)).filter((n): n is string => Boolean(n));
          }
        } catch (e) {
          console.warn('Failed to fetch item waiter IDs by transaction:', e);
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

      // Fetch shift labels for display (Shift 1, Shift 2, ...)
      if (electronAPI.localDbGetShifts && pending.length > 0) {
        try {
          const now = new Date();
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          const tomorrow = new Date(now);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const fmt = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          const startDate = `${fmt(yesterday)}T00:00:00.000Z`;
          const endDate = `${fmt(tomorrow)}T23:59:59.999Z`;
          const { shifts } = await electronAPI.localDbGetShifts({
            businessId,
            startDate,
            endDate,
            limit: 50
          });
          type ShiftItem = { uuid_id?: string; shift_start?: string };
          let allShifts: ShiftItem[] = [...((shifts || []) as ShiftItem[])];
          // Merge active shift if not in list
          if (electronAPI.localDbGetActiveShift && user?.id) {
            try {
              const activeRes = await electronAPI.localDbGetActiveShift(parseInt(String(user.id)), businessId);
              const activeShift = (activeRes as { shift?: ShiftItem })?.shift;
              if (activeShift?.uuid_id && !allShifts.some((s) => s.uuid_id === activeShift.uuid_id)) {
                allShifts.push(activeShift);
              }
            } catch {
              // ignore
            }
          }
          const sorted = allShifts.sort(
            (a, b) => new Date(a.shift_start || 0).getTime() - new Date(b.shift_start || 0).getTime()
          );
          const map: Record<string, string> = {};
          // Group by date (GMT+7) so each day resets to Shift 1, Shift 2, ...
          const getGmt7DateKey = (iso: string) => {
            const d = new Date(iso);
            const gmt7 = new Date(d.getTime() + 7 * 60 * 60 * 1000);
            return gmt7.toISOString().slice(0, 10);
          };
          const byDate = new Map<string, ShiftItem[]>();
          for (const s of sorted) {
            const key = getGmt7DateKey(s.shift_start || '');
            if (!byDate.has(key)) byDate.set(key, []);
            byDate.get(key)!.push(s);
          }
          for (const [, dayShifts] of byDate) {
            dayShifts.forEach((s, i) => {
              const uuid = s.uuid_id;
              if (uuid) map[uuid] = `Shift ${i + 1}`;
            });
          }
          setShiftLabelByUuid(map);
        } catch {
          setShiftLabelByUuid({});
        }
      } else {
        setShiftLabelByUuid({});
      }

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
    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (totalMinutes >= 60) {
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      const hr = hours === 1 ? 'hr' : 'hrs';
      const min = mins === 1 ? 'min' : 'mins';
      return `${hours} ${hr} ${mins} ${min}`;
    }
    return `${totalMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatPrice = (price: number): string => {
    // Round to integer and format with Indonesian locale (dots as thousand separators, no decimals)
    const roundedPrice = Math.round(price);
    return `Rp ${roundedPrice.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  // Format creation time like daftar transaksi (Waktu)
  const formatCreatedAt = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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

      // Fetch package lines for bill (same as TransactionList/Daftar Transaksi)
      const itemUuids = (itemsArray as Array<Record<string, unknown>>)
        .map((i) => (i.uuid_id ?? i.id) as string)
        .filter(Boolean) as string[];
      const packageLinesByItem = new Map<string, Array<{ product_id: number; quantity: number }>>();
      if (itemUuids.length > 0 && electronAPI.localDbGetPackageLines) {
        try {
          const packageLines = await electronAPI.localDbGetPackageLines(itemUuids);
          for (const line of packageLines) {
            const itemUuid = line.uuid_transaction_item_id;
            if (!packageLinesByItem.has(itemUuid)) {
              packageLinesByItem.set(itemUuid, []);
            }
            packageLinesByItem.get(itemUuid)!.push({ product_id: line.product_id, quantity: line.quantity });
          }
        } catch (e) {
          console.warn('Failed to fetch package lines for bill:', e);
        }
      }

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

        // Get base price
        const basePrice = typeof product.harga_jual === 'number' ? product.harga_jual : 0;
        const itemPrice = basePrice + sumCustomizationPrice(itemCustomizations);

        // Format item name with customizations (exclude custom note on bill)
        let itemName = typeof product.nama === 'string' ? product.nama : '';
        if (itemCustomizations.length > 0) {
          const customizationText = itemCustomizations.map(c =>
            `${c.customization_name}: ${c.selected_options.map(opt => opt.option_name).join(', ')}`
          ).join(', ');
          itemName = `${itemName} (${customizationText})`;
        }
        // Do not append itemCustomNote to bill — customization note not shown on printed bill

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
                  // Exclude custom note from bill — customization note not shown on printed bill

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

        // Package: push main line (package name) first, then package sub-items so the bill shows "Package Name" then "  └ selected items"
        const itemUuid = (item.uuid_id ?? item.id) as string | undefined;
        const pkgLines = itemUuid ? packageLinesByItem.get(String(itemUuid)) : undefined;
        const hasPackageLines = pkgLines && pkgLines.length > 0;

        if (hasPackageLines) {
          receiptItems.push({
            name: itemName,
            quantity: itemQuantity,
            price: itemPrice,
            total_price: itemPrice * itemQuantity
          });
          pkgLines!.forEach((line) => {
            const p = productsMap.get(line.product_id);
            const pkgName = (p && typeof (p as { nama?: string }).nama === 'string') ? (p as { nama: string }).nama : (line as { product_name?: string }).product_name ?? 'Unknown';
            const totalQty = line.quantity * itemQuantity;
            receiptItems.push({
              name: `    ${formatPackageLineDisplay(pkgName, totalQty)}`,
              quantity: totalQty,
              price: 0,
              total_price: 0
            });
          });
        } else {
          receiptItems.push({
            name: itemName,
            quantity: itemQuantity,
            price: itemPrice,
            total_price: itemPrice * itemQuantity
          });
        }
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

      const customerName = typeof transaction.customer_name === 'string' ? transaction.customer_name : '';
      const modalData: PrintBillModalData = {
        transactionId,
        transaction,
        receiptItems,
        total,
        tableNumber,
        cashier: cashierName,
        customerName,
        date: typeof transaction.created_at === 'string' ? transaction.created_at : new Date().toISOString(),
        transactionType: typeof transaction.transaction_type === 'string' ? transaction.transaction_type : 'dine-in',
        pickupMethod: typeof transaction.pickup_method === 'string' ? transaction.pickup_method : 'dine-in',
        businessId,
      };
      setPrintBillModalData(modalData);
      setShowPrintBillModal(true);
    } catch (error) {
      console.error('Error preparing bill:', error);
      alert('Terjadi kesalahan saat menyiapkan bill');
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
              className={`px-[14px] py-[7px] text-sm rounded-lg transition-all flex items-center gap-1.5 font-medium shadow-lg active:scale-95 active:shadow-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${canAccessSplitBillButton
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
              className={`px-4 py-2 rounded-md transition-colors flex items-center gap-2 ${viewMode === 'list'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
            >
              <List className="w-4 h-4" />
              List
            </button>
            <button
              onClick={() => setViewMode('layout')}
              className={`px-4 py-2 rounded-md transition-colors flex items-center gap-2 ${viewMode === 'layout'
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
        <div className="flex-1 overflow-auto pt-0 pb-6 px-0">
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
              <div className="bg-white shadow-sm border border-gray-200 overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 text-gray-900 font-semibold border-b border-gray-200 sticky top-0 z-10">
                    <tr>
                      <th className="pl-3 pr-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Table/Room
                      </th>
                      <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Take Away / Dine In
                      </th>
                      <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Waiter
                      </th>
                      <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Nama Pelanggan
                      </th>
                      <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Total
                      </th>
                      <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Shift
                      </th>
                      <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Waktu Mulai
                      </th>
                      <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Timer
                      </th>
                      <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Transaction ID
                      </th>
                      <th className="px-2 py-3 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pendingTransactions.map((transaction) => {
                      const borderColor = transaction.waiter_color || undefined;
                      return (
                        <tr
                          key={transaction.id}
                          className="hover:bg-blue-50 transition-colors group"
                          style={borderColor ? { boxShadow: `inset 10px 0 0 0 ${borderColor}` } : undefined}
                        >
                          <td className="pl-3 pr-2 py-3 whitespace-nowrap">
                            <span className="text-xs font-medium text-gray-900">
                              {transaction.table_number}
                            </span>
                          </td>
                          <td className="px-2 py-3 whitespace-nowrap">
                            <span className={`inline-flex px-1.5 py-0.5 text-xs font-semibold rounded-full ${transaction.pickup_method === 'take-away' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                              {transaction.pickup_method === 'take-away' ? 'Take Away' : 'Dine In'}
                            </span>
                          </td>
                          <td className="px-2 py-3 whitespace-nowrap">
                            <div className="relative inline-block">
                              <button
                                ref={openWaiterPopoverFor === transaction.uuid_id ? waiterTriggerRef : undefined}
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setOpenWaiterPopoverFor((id) => (id === transaction.uuid_id ? null : transaction.uuid_id)); }}
                                className="text-left text-xs text-gray-900 hover:underline cursor-pointer rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                                title={transaction.waiter_names_all && transaction.waiter_names_all.length > 1 ? transaction.waiter_names_all.join(', ') : undefined}
                              >
                                {transaction.waiter_name || '-'}
                                {transaction.waiter_names_all && transaction.waiter_names_all.length > 1 && (
                                  <span className="text-gray-500 ml-0.5">(+{transaction.waiter_names_all.length - 1})</span>
                                )}
                              </button>
                              {openWaiterPopoverFor === transaction.uuid_id && transaction.waiter_names_all && transaction.waiter_names_all.length > 0 && waiterPopoverPos && typeof document !== 'undefined' && createPortal(
                                <div
                                  ref={waiterPopoverRef}
                                  className="fixed z-[9999] min-w-[120px] rounded-lg border border-gray-200 bg-white py-2 shadow-lg"
                                  style={{ top: waiterPopoverPos.top, left: waiterPopoverPos.left }}
                                >
                                  <div className="px-3 py-1 text-xs font-semibold text-gray-500 uppercase">Waiters</div>
                                  {transaction.waiter_names_all.map((name, i) => (
                                    <div key={i} className="px-3 py-1.5 text-sm text-gray-900">{name}</div>
                                  ))}
                                </div>,
                                document.body
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-3 whitespace-nowrap">
                            <span className="text-xs text-gray-900 truncate block max-w-[120px]" title={transaction.customer_name || '-'}>
                              {transaction.customer_name || '-'}
                            </span>
                          </td>
                          <td className="px-2 py-3 whitespace-nowrap">
                            <span className="text-xs font-medium text-gray-900">
                              {formatPrice(transaction.final_amount)}
                            </span>
                          </td>
                          <td className="px-2 py-3 whitespace-nowrap">
                            <span className="text-xs text-gray-700" title={transaction.shift_uuid ?? undefined}>
                              {transaction.shift_uuid ? (shiftLabelByUuid[transaction.shift_uuid] ?? 'Shift') : '-'}
                            </span>
                          </td>
                          <td className="px-2 py-3 whitespace-nowrap">
                            <span className="text-[10px] text-gray-900">
                              {formatCreatedAt(transaction.created_at)}
                            </span>
                          </td>
                          <td className="px-2 py-3 whitespace-nowrap">
                            <span className="text-xs font-mono text-gray-900">
                              {formatTimer(transaction.created_at)}
                            </span>
                          </td>
                          <td className="px-2 py-3 whitespace-nowrap">
                            <span className="text-[10px] text-gray-600 font-mono truncate block max-w-[140px]" title={transaction.uuid_id}>
                              {transaction.uuid_id}
                            </span>
                          </td>
                          <td className="px-2 py-3 whitespace-nowrap">
                            <div className="flex gap-1.5">
                              <button
                                className="inline-flex items-center px-2 py-1.5 border border-gray-300 shadow-sm text-xs leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                                onClick={() => {
                                  if (onLoadTransaction) {
                                    onLoadTransaction(transaction.uuid_id);
                                  }
                                }}
                              >
                                <Edit className="w-3.5 h-3.5 mr-1.5" />
                                Lihat
                              </button>
                              <button
                                className="inline-flex items-center px-2 py-1.5 border border-gray-300 shadow-sm text-xs leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={() => handlePrintBill(transaction.uuid_id)}
                                disabled={printingBill === transaction.uuid_id}
                              >
                                <Printer className="w-3.5 h-3.5 mr-1.5" />
                                {printingBill === transaction.uuid_id ? 'Mencetak...' : 'Print Bill'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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

      {/* Print Bill Modal */}
      <PrintBillModal
        isOpen={showPrintBillModal}
        onClose={() => {
          setShowPrintBillModal(false);
          setPrintBillModalData(null);
        }}
        data={printBillModalData}
        onPrinted={fetchPendingTransactions}
      />
    </div>
  );
}




