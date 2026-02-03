'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Volume2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { isSuperAdmin } from '@/lib/auth';

interface OrderItem {
  id: number;
  uuid_id: string;
  transaction_id: string;
  product_id: number;
  product_name: string;
  quantity: number;
  custom_note: string | null;
  production_status: string | null;
  production_started_at: string | null;
  production_finished_at: string | null;
  table_number: string | null;
  room_name: string | null;
  customer_name: string | null;
  pickup_method?: 'dine-in' | 'take-away';
  created_at: string;
  platform_label: string;
  customizations: Array<{
    customization_name: string;
    options: Array<{
      option_name: string;
      price_adjustment: number;
    }>;
  }>;
}

const OFFLINE_PAYMENT_CODES = new Set(['cash', 'debit', 'qr', 'ewallet', 'cl', 'voucher', 'offline', 'tunai', 'edc']);

function getPlatformLabel(paymentMethod: string | null | undefined): string {
  const code = (paymentMethod || '').toString().trim().toLowerCase();
  if (!code || OFFLINE_PAYMENT_CODES.has(code)) return 'Offline';
  switch (code) {
    case 'gofood': return 'GoFood';
    case 'grabfood': return 'GrabFood';
    case 'shopeefood': return 'ShopeeFood';
    case 'qpon': return 'Qpon';
    case 'tiktok': return 'TikTok';
    default: return code.charAt(0).toUpperCase() + code.slice(1);
  }
}

interface GroupedOrderItem extends OrderItem {
  total_quantity: number;
  display_text: string;
  timer: string;
}

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function KitchenDisplay({ viewOnly = false, legacyCardLayout = false }: { viewOnly?: boolean; legacyCardLayout?: boolean }) {
  const { user } = useAuth();
  const [activeOrders, setActiveOrders] = useState<GroupedOrderItem[]>([]);
  const [finishedOrders, setFinishedOrders] = useState<GroupedOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const previousOrderIdsRef = useRef<Set<string>>(new Set());
  const hasCompletedInitialFetchRef = useRef(false);
  const soundRef = useRef<HTMLAudioElement | null>(null);
  
  const businessId = user?.selectedBusinessId;
  
  if (!businessId) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center p-8 bg-white rounded-lg shadow-lg">
          <h2 className="text-xl font-bold text-red-600 mb-2">No Business Selected</h2>
          <p className="text-gray-700">Please log in and select a business to access the Kitchen Display.</p>
        </div>
      </div>
    );
  }

  // Check permission - if viewOnly, also check for access_baristaandkitchen
  const hasKitchenPermission = user?.permissions?.includes('access_kitchen') || false;
  const hasBaristaKitchenPermission = user?.permissions?.includes('access_baristaandkitchen') || false;
  const hasPermission = hasKitchenPermission || (viewOnly && hasBaristaKitchenPermission);
  
  if (!isSuperAdmin(user) && !hasPermission) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center p-8 bg-white rounded-lg shadow-lg">
          <h2 className="text-xl font-bold text-red-600 mb-2">Access Denied</h2>
          <p className="text-gray-700">You do not have permission to access the Kitchen Display.</p>
        </div>
      </div>
    );
  }

  // Update timer every second
  useEffect(() => {
    const interval = setInterval(() => {
      const newTime = new Date();
      setCurrentTime(newTime);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTimer = useCallback((createdAt: string | null | undefined): string => {
    if (!createdAt) {
      return '00:00';
    }
    const created = new Date(createdAt);
    
    // Check if date is valid
    if (isNaN(created.getTime())) {
      console.warn('Invalid date for timer:', createdAt);
      return '00:00';
    }
    const diffMs = currentTime.getTime() - created.getTime();
    
    // Handle negative time (if date is in future due to timezone issues)
    if (diffMs < 0) {
      console.warn('Negative time difference detected:', { createdAt, currentTime: currentTime.toISOString(), diffMs });
      return '00:00';
    }
    const totalSeconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const result = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    return result;
  }, [currentTime]);

  // Fetch orders from database
  const fetchOrders = useCallback(async () => {
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI) {
        console.error('Electron API not available');
        return;
      }

      // Fetch all transactions (pending, paid, and completed)
      // We include paid/completed transactions because items might still be in production
      const transactions = await electronAPI.localDbGetTransactions?.(businessId, 10000);
      const transactionsArray = Array.isArray(transactions) ? transactions as Record<string, unknown>[] : [];
      
      // Filter for transactions that might have items in production
      // Include pending (unpaid), paid, and completed transactions
      // Items will be filtered by production_status later (only show unfinished items)
      const relevantTransactions = transactionsArray.filter((tx) => {
        const status = typeof tx.status === 'string' ? tx.status.toLowerCase() : '';
        return status === 'pending' || status === 'paid' || status === 'completed';
      });

      // Fetch all products to get category info
      const allProducts = await electronAPI.localDbGetAllProducts?.();
      const productsArray = Array.isArray(allProducts) ? allProducts as Record<string, unknown>[] : [];
      const productsMap = new Map<number, Record<string, unknown>>();
      productsArray.forEach((p) => {
        const id = typeof p.id === 'number' ? p.id : (typeof p.id === 'string' ? parseInt(p.id, 10) : null);
        if (id) {
          productsMap.set(id, p);
        }
      });

      // Fetch tables and rooms
      const tablesMap = new Map<number, { table_number: string; room_id: number }>();
      const roomsMap = new Map<number, string>();
      if (electronAPI.getRestaurantRooms) {
        const rooms = await electronAPI.getRestaurantRooms(businessId);
        const roomsArray = Array.isArray(rooms) ? rooms as { id: number; name: string }[] : [];
        roomsArray.forEach((room) => {
          if (room.id) {
            roomsMap.set(room.id, room.name);
          }
        });

        for (const room of roomsArray) {
          if (room.id && electronAPI.getRestaurantTables) {
            const tables = await electronAPI.getRestaurantTables(room.id);
            const tablesArray = Array.isArray(tables) ? tables as { id: number; table_number: string; room_id: number }[] : [];
            tablesArray.forEach((table) => {
              tablesMap.set(table.id, { table_number: table.table_number, room_id: table.room_id });
            });
          }
        }
      }

      // Fetch transaction items for all relevant transactions
      const allOrderItems: OrderItem[] = [];
      
      for (const tx of relevantTransactions) {
        const transactionId = (typeof tx.uuid_id === 'string' ? tx.uuid_id : null) || 
                              (typeof tx.id === 'string' ? tx.id : (typeof tx.id === 'number' ? tx.id.toString() : null)) ||
                              '';
        const items = await electronAPI.localDbGetTransactionItems?.(transactionId);
        const itemsArray = Array.isArray(items) ? items as Record<string, unknown>[] : [];
        
        // Fetch customizations
        const customizationsData = await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(transactionId);
        const customizations = Array.isArray(customizationsData?.customizations) ? customizationsData.customizations as Record<string, unknown>[] : [];
        const customizationOptions = Array.isArray(customizationsData?.options) ? customizationsData.options as Record<string, unknown>[] : [];

        // Create customizations map
        const customizationsMap = new Map<number, Array<{
          customization_name: string;
          options: Array<{ option_name: string; price_adjustment: number }>;
        }>>();

        customizations.forEach((cust) => {
          const itemId = typeof cust.transaction_item_id === 'string' 
            ? parseInt(cust.transaction_item_id, 10) 
            : (typeof cust.transaction_item_id === 'number' ? cust.transaction_item_id : 0);
          
          if (!customizationsMap.has(itemId)) {
            customizationsMap.set(itemId, []);
          }

          const options = customizationOptions
            .filter((opt) => opt.transaction_item_customization_id === cust.id)
            .map((opt) => ({
              option_name: typeof opt.option_name === 'string' ? opt.option_name : String(opt.option_name || ''),
              price_adjustment: typeof opt.price_adjustment === 'number' 
                ? opt.price_adjustment 
                : (typeof opt.price_adjustment === 'string' ? parseFloat(opt.price_adjustment) || 0 : 0),
            }));

          const customizationName = typeof cust.customization_type_name === 'string' ? cust.customization_type_name : null;
          const customizationTypeId = typeof cust.customization_type_id === 'number' ? cust.customization_type_id : (typeof cust.customization_type_id === 'string' ? parseInt(cust.customization_type_id, 10) : null);
          const existingCust = customizationsMap.get(itemId)!.find(c => 
            c.customization_name === customizationName
          );

          if (existingCust) {
            existingCust.options.push(...options);
          } else {
            customizationsMap.get(itemId)!.push({
              customization_name: customizationName || `Customization ${customizationTypeId || ''}`,
              options,
            });
          }
        });

        // Process items
        for (const item of itemsArray) {
          const productId = typeof item.product_id === 'number' ? item.product_id : (typeof item.product_id === 'string' ? parseInt(item.product_id, 10) : null);
          if (!productId) continue;
          
          const product = productsMap.get(productId);
          if (!product) continue;

          // Filter by category - makanan and bakery for kitchen
          const categoryName = typeof product.category1_name === 'string' ? product.category1_name.toLowerCase() : null;
          if (categoryName !== 'makanan' && categoryName !== 'bakery') {
            continue;
          }

          const tableId = typeof tx.table_id === 'number' ? tx.table_id : (typeof tx.table_id === 'string' ? parseInt(tx.table_id, 10) : null);
          const tableInfo = tableId && tablesMap.has(tableId) ? tablesMap.get(tableId)! : null;
          const tableNumber = tableInfo ? tableInfo.table_number : null;
          const roomId = tableInfo ? tableInfo.room_id : null;
          const roomName = roomId && roomsMap.has(roomId) ? roomsMap.get(roomId)! : null;
          const customerName = typeof tx.customer_name === 'string' ? tx.customer_name : null;

          const itemId = typeof item.id === 'number' ? item.id : (typeof item.id === 'string' ? parseInt(item.id, 10) : null);
          const itemCustomizations = itemId ? customizationsMap.get(itemId) || [] : [];

          const itemUuidId = typeof item.uuid_id === 'string' ? item.uuid_id : (itemId ? itemId.toString() : '');
          const itemQuantity = typeof item.quantity === 'number' ? item.quantity : (typeof item.quantity === 'string' ? parseInt(item.quantity, 10) : 1);
          const itemCustomNote = typeof item.custom_note === 'string' ? item.custom_note : null;
          const itemProductionStatus = typeof item.production_status === 'string' ? item.production_status : null;
          
          // Filter out cancelled items - they should not appear on kitchen display
          if (itemProductionStatus === 'cancelled') {
            continue;
          }
          
          const itemProductionStartedAt = typeof item.production_started_at === 'string' ? item.production_started_at : (item.production_started_at instanceof Date ? item.production_started_at.toISOString() : null);
          const itemProductionFinishedAt = typeof item.production_finished_at === 'string' ? item.production_finished_at : (item.production_finished_at instanceof Date ? item.production_finished_at.toISOString() : null);
          const itemCreatedAt = typeof item.created_at === 'string' ? item.created_at : (item.created_at instanceof Date ? item.created_at.toISOString() : null);
          const txCreatedAt = typeof tx.created_at === 'string' ? tx.created_at : (tx.created_at instanceof Date ? tx.created_at.toISOString() : null);
          const productNama = typeof product.nama === 'string' ? product.nama : 'Unknown';

          // CRITICAL FIX: Use transaction created_at as the source of truth for timer
          // If item.created_at is null, use transaction.created_at (when item was ordered)
          // Only fall back to current time if BOTH are null (should never happen in normal operation)
          let finalCreatedAt: string;
          if (itemCreatedAt) {
            finalCreatedAt = itemCreatedAt;
          } else if (txCreatedAt) {
            // Use transaction created_at as fallback - this is when the order was placed
            finalCreatedAt = txCreatedAt;
          } else {
            // Last resort: use current time (but log warning)
            console.warn('Both item.created_at and tx.created_at are null, using current time (this should not happen):', { itemId, transactionId, productId });
            finalCreatedAt = new Date().toISOString();
          }
          
          // Validate the date string
          const testDate = new Date(finalCreatedAt);
          
          if (isNaN(testDate.getTime())) {
            console.warn('Invalid created_at date detected, using current time:', { txCreatedAt, itemCreatedAt, finalCreatedAt });
            finalCreatedAt = new Date().toISOString();
          }

          allOrderItems.push({
            id: itemId || 0,
            uuid_id: itemUuidId,
            transaction_id: transactionId,
            product_id: productId,
            product_name: productNama,
            quantity: itemQuantity,
            custom_note: itemCustomNote,
            production_status: itemProductionStatus,
            production_started_at: itemProductionStartedAt,
            production_finished_at: itemProductionFinishedAt,
            table_number: tableNumber || null,
            room_name: roomName || null,
            customer_name: customerName || null,
            pickup_method: (() => {
              const paymentCode = (typeof tx.payment_method === 'string' ? tx.payment_method : (tx.payment_method != null ? String(tx.payment_method) : '')).trim().toLowerCase();
              const isPlatformOrder = !!paymentCode && !OFFLINE_PAYMENT_CODES.has(paymentCode);
              if (isPlatformOrder) return 'take-away' as const;
              return (typeof tx.pickup_method === 'string' && (tx.pickup_method === 'take-away' || tx.pickup_method === 'dine-in')) ? tx.pickup_method as 'dine-in' | 'take-away' : 'dine-in';
            })(),
            platform_label: getPlatformLabel(typeof tx.payment_method === 'string' ? tx.payment_method : (tx.payment_method != null ? String(tx.payment_method) : undefined)),
            created_at: finalCreatedAt,
            customizations: itemCustomizations,
          });
        }
      }

      // Group items by product_id + customization signature
      // Track all items in each group to check if all are finished
      const groupedMap = new Map<string, GroupedOrderItem>();
      const groupItemsMap = new Map<string, OrderItem[]>();

      allOrderItems.forEach(item => {
        // Create customization signature
        const allOptionIds: number[] = [];
        item.customizations.forEach(customization => {
          customization.options.forEach(option => {
            // Use option name for signature (since we don't have option_id here)
            allOptionIds.push(option.option_name.charCodeAt(0)); // Simple hash
          });
        });
        const sortedOptionIds = allOptionIds.sort((a, b) => a - b).join(',');
        const customNote = item.custom_note || '';
        // Include table_number in signature to prevent grouping items from different tables
        const tableNumber = item.table_number || '';
        // Include uuid_id to ensure each item is unique (one line per item, no grouping)
        const itemUuid = item.uuid_id || item.id?.toString() || '';
        const signature = `${item.product_id}_${sortedOptionIds}_${customNote}_${tableNumber}_${itemUuid}`;

        // Track all items in this group (each item has unique signature now, so groups will be size 1)
        if (!groupItemsMap.has(signature)) {
          groupItemsMap.set(signature, []);
        }
        groupItemsMap.get(signature)!.push(item);

        // Since each item has unique signature (includes uuid_id), this will always be a new entry
        // Build display text: 1x [platform name] [product name] for online; 1x [product name] for offline
        const platformPrefix = item.platform_label === 'Offline' ? '' : `[${item.platform_label}] `;
        let displayText = `${item.quantity}x ${platformPrefix}${item.product_name}`;
        
        // Add customizations
        const customizationTexts: string[] = [];
        item.customizations.forEach(customization => {
          customization.options.forEach(option => {
            const priceText = option.price_adjustment !== 0 
              ? ` (+${option.price_adjustment})` 
              : '';
            customizationTexts.push(`+${option.option_name}${priceText}`);
          });
        });
        if (customizationTexts.length > 0) {
          displayText += ` ${customizationTexts.join(', ')}`;
        }

        // Add custom note
        if (item.custom_note) {
          displayText += ` note: ${item.custom_note}`;
        }

        groupedMap.set(signature, {
          ...item,
          total_quantity: item.quantity,
          display_text: displayText,
          timer: formatTimer(item.created_at),
        });
      });

      // Separate active and finished orders
      const active: GroupedOrderItem[] = [];
      const finished: GroupedOrderItem[] = [];

      groupedMap.forEach((item, signature) => {
        const groupedItem = {
          ...item,
          timer: formatTimer(item.created_at),
        };

        // Check if ALL items in this group are finished
        const itemsInGroup = groupItemsMap.get(signature) || [];
        const allFinished = itemsInGroup.length > 0 && itemsInGroup.every(i => i.production_status === 'finished');
        
        console.log('📋 Group status check:', {
          signature,
          product_name: item.product_name,
          itemsInGroup: itemsInGroup.length,
          allFinished,
          statuses: itemsInGroup.map(i => i.production_status)
        });

        if (allFinished) {
          // Update the grouped item's production_status to finished
          groupedItem.production_status = 'finished';
          finished.push(groupedItem);
        } else {
          active.push(groupedItem);
        }
      });

      // Sort active by created_at (oldest first)
      active.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      
      // Sort finished by finished_at (most recent first)
      finished.sort((a, b) => {
        const aTime = a.production_finished_at ? new Date(a.production_finished_at).getTime() : 0;
        const bTime = b.production_finished_at ? new Date(b.production_finished_at).getTime() : 0;
        return bTime - aTime;
      });

      setActiveOrders(active);
      setFinishedOrders(finished);
      
      // Check for new orders and play sound (only on standalone Kitchen display, not in Barista & Kitchen combined view)
      // Use hasCompletedInitialFetchRef so we also play when first order arrives after empty list (no sound on very first page load)
      if (!viewOnly && !loading && hasCompletedInitialFetchRef.current) {
        const currentOrderIds = new Set(active.map(order => order.uuid_id));
        const newOrderIds = [...currentOrderIds].filter(id => !previousOrderIdsRef.current.has(id));
        
        if (newOrderIds.length > 0) {
          try {
            if (!soundRef.current) {
              soundRef.current = new Audio('./blacksmith_refine.mp3');
              soundRef.current.volume = 0.7;
            }
            soundRef.current.pause();
            soundRef.current.currentTime = 0;
            soundRef.current.play().catch(error => {
              console.warn('Failed to play sound:', error);
            });
          } catch (error) {
            console.warn('Error playing sound:', error);
          }
        }
      }
      
      hasCompletedInitialFetchRef.current = true;
      // Update previous order IDs
      previousOrderIdsRef.current = new Set(active.map(order => order.uuid_id));
      
      setLoading(false);
    } catch (error) {
      console.error('Error fetching orders:', error);
      setLoading(false);
    }
  }, [businessId, formatTimer]);

  const formatTimeHHmm = (dateTime: string | null | undefined): string => {
    if (!dateTime) return '-';
    const date = new Date(dateTime);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const formatDurationMinutes = (startTime: string | null | undefined, endTime: string | null | undefined): string => {
    if (!startTime || !endTime) return '-';
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return '-';
    const diffMs = end.getTime() - start.getTime();
    if (diffMs < 0) return '-';
    const minutes = Math.round(diffMs / 60000);
    return `${minutes} Menit`;
  };

  // Poll database every 5 seconds
  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 5000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  // Cleanup audio only on unmount (not when polling effect re-runs, so sound can finish playing)
  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.pause();
        soundRef.current = null;
      }
    };
  }, []);

  const handleMarkFinished = async (item: GroupedOrderItem) => {
    console.log('🔵 handleMarkFinished called for item:', item);
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetTransactionItems || !electronAPI?.localDbUpsertTransactionItems) {
        console.error('❌ Electron API functions not available');
        alert('Function not available');
        return;
      }

      console.log('📦 Fetching transaction items for:', item.transaction_id);
      // Fetch all transaction items for this transaction
      const items = await electronAPI.localDbGetTransactionItems?.(item.transaction_id);
      const itemsArray = Array.isArray(items) ? items as Record<string, unknown>[] : [];
      console.log('📦 Found', itemsArray.length, 'transaction items');

      // Fetch customizations to match items by signature
      const customizationsData = await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(item.transaction_id);
      const customizations = Array.isArray(customizationsData?.customizations) ? customizationsData.customizations as Record<string, unknown>[] : [];
      const customizationOptions = Array.isArray(customizationsData?.options) ? customizationsData.options as Record<string, unknown>[] : [];

      // Create customizations map
      const customizationsMap = new Map<number, Array<{
        customization_name: string;
        options: Array<{ option_name: string; price_adjustment: number }>;
      }>>();

      customizations.forEach((cust) => {
        const itemId = typeof cust.transaction_item_id === 'string' 
          ? parseInt(cust.transaction_item_id, 10) 
          : (typeof cust.transaction_item_id === 'number' ? cust.transaction_item_id : 0);
        
        if (!customizationsMap.has(itemId)) {
          customizationsMap.set(itemId, []);
        }

        const options = customizationOptions
          .filter((opt) => opt.transaction_item_customization_id === cust.id)
          .map((opt) => ({
            option_name: typeof opt.option_name === 'string' ? opt.option_name : String(opt.option_name || ''),
            price_adjustment: typeof opt.price_adjustment === 'number' 
              ? opt.price_adjustment 
              : (typeof opt.price_adjustment === 'string' ? parseFloat(opt.price_adjustment) || 0 : 0),
          }));

        const customizationName = typeof cust.customization_type_name === 'string' ? cust.customization_type_name : null;
        const customizationTypeId = typeof cust.customization_type_id === 'number' ? cust.customization_type_id : (typeof cust.customization_type_id === 'string' ? parseInt(cust.customization_type_id, 10) : null);
        const existingCust = customizationsMap.get(itemId)!.find(c => 
          c.customization_name === customizationName
        );

        if (existingCust) {
          existingCust.options.push(...options);
        } else {
          customizationsMap.get(itemId)!.push({
            customization_name: customizationName || `Customization ${customizationTypeId || ''}`,
            options,
          });
        }
      });

      // Find all items that match this signature (same product_id + same customizations + same note)
      const itemsToUpdate: Array<Record<string, unknown>> = [];
      const finishedAt = new Date().toISOString();

      itemsArray.forEach((transactionItem) => {
        // Check if product_id matches
        if (transactionItem.product_id !== item.product_id) {
          return;
        }

        // Check if custom note matches
        const itemNote = transactionItem.custom_note || '';
        if (itemNote !== (item.custom_note || '')) {
          return;
        }

        // Check if customizations match
        // Normalize ID type for lookup
        const itemIdForLookup = typeof transactionItem.id === 'number' 
          ? transactionItem.id 
          : (typeof transactionItem.id === 'string' ? parseInt(transactionItem.id, 10) : null);
        const itemCustomizations = itemIdForLookup ? customizationsMap.get(itemIdForLookup) || [] : [];
        
        // Create signature for this item
        const allOptionIds: number[] = [];
        itemCustomizations.forEach((customization: { options: Array<{ option_name: string }> }) => {
          customization.options.forEach((option: { option_name: string }) => {
            allOptionIds.push(option.option_name.charCodeAt(0));
          });
        });
        const sortedOptionIds = allOptionIds.sort((a, b) => a - b).join(',');
        // Get table_number from transaction (we need to fetch it)
        // For now, use item.table_number as fallback since all items in same transaction have same table
        const transactionTableNumber = item.table_number || '';
        const itemSignature = `${transactionItem.product_id}_${sortedOptionIds}_${itemNote}_${transactionTableNumber}`;

        // Create signature for the grouped item (must match grouping signature including table_number)
        const groupedOptionIds: number[] = [];
        item.customizations.forEach(customization => {
          customization.options.forEach(option => {
            groupedOptionIds.push(option.option_name.charCodeAt(0));
          });
        });
        const groupedSortedOptionIds = groupedOptionIds.sort((a, b) => a - b).join(',');
        const groupedTableNumber = item.table_number || '';
        const groupedSignature = `${item.product_id}_${groupedSortedOptionIds}_${itemNote}_${groupedTableNumber}`;

        // If signatures match, add to update list (only if not already finished)
        if (itemSignature === groupedSignature) {
          if (transactionItem.production_status === 'finished') {
            console.log('⏭️ Item already finished, skipping:', transactionItem.id);
            return;
          }
          // Ensure we have all required fields for the update
          const itemToUpdate: Record<string, unknown> = {
            id: transactionItem.id,
            uuid_id: transactionItem.uuid_id || transactionItem.id?.toString(),
            transaction_id: transactionItem.transaction_id || 0,
            uuid_transaction_id: transactionItem.uuid_transaction_id || item.transaction_id,
            product_id: transactionItem.product_id,
            quantity: transactionItem.quantity,
            unit_price: transactionItem.unit_price,
            total_price: transactionItem.total_price,
            custom_note: transactionItem.custom_note,
            bundle_selections_json: transactionItem.bundle_selections_json,
            created_at: transactionItem.created_at,
            production_status: 'finished',
            production_started_at: transactionItem.production_started_at,
            production_finished_at: finishedAt,
          };
          
          itemsToUpdate.push(itemToUpdate);
        }
      });

      console.log('🔍 Found', itemsToUpdate.length, 'items to update');
      if (itemsToUpdate.length === 0) {
        console.warn('⚠️ No items found matching signature, trying fallback (product_id + note only)');
        // Fallback: try matching by product_id and note only (for items without customizations)
        const fallbackItems = itemsArray.filter((transactionItem) => {
          return transactionItem.product_id === item.product_id &&
                 (transactionItem.custom_note || '') === (item.custom_note || '') &&
                 (transactionItem.production_status !== 'finished');
        });
        
        if (fallbackItems.length > 0) {
          console.log('✅ Found', fallbackItems.length, 'items using fallback method');
          const finishedAt = new Date().toISOString();
          const fallbackUpdates = fallbackItems.map((transactionItem) => ({
            ...transactionItem,
            production_status: 'finished',
            production_finished_at: finishedAt,
          }));
          itemsToUpdate.push(...fallbackUpdates);
        } else {
          console.error('❌ No items found even with fallback method');
          console.log('Looking for product_id:', item.product_id, 'note:', item.custom_note);
          alert('Item tidak ditemukan. Check console for details.');
          return;
        }
      }

      console.log('💾 Updating items:', itemsToUpdate.map(i => ({ id: i.id, uuid_id: i.uuid_id, product_id: i.product_id })));
      // Update all matching items
      await electronAPI.localDbUpsertTransactionItems?.(itemsToUpdate);
      console.log('✅ Items updated successfully');

      // Refresh orders immediately
      await fetchOrders();
    } catch (error) {
      console.error('❌ Error marking item as finished:', error);
      alert(`Gagal menandai item sebagai selesai: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-600">Memuat data...</div>
      </div>
    );
  }

  const playTestSound = () => {
    try {
      const audio = new Audio('./blacksmith_refine.mp3');
      audio.volume = 0.7;
      audio.play().catch((err) => console.warn('Test sound failed:', err));
    } catch (err) {
      console.warn('Test sound failed:', err);
    }
  };

  return (
    <div className="flex-1 flex h-full bg-gray-50" title="KitchenDisplay ROOT">
      {/* Column 1: Active Orders */}
      <div className="w-1/2 border-r border-gray-300 flex flex-col bg-violet-50/50" title="KITCHEN ACTIVE COLUMN">
        <div className="bg-blue-500 text-white px-6 py-4 flex-shrink-0 flex items-center justify-between">
          <h2 className="text-2xl font-bold">Dapur - Pesanan Aktif</h2>
          <button
            type="button"
            onClick={playTestSound}
            className="p-1.5 rounded hover:bg-blue-600 transition-colors"
            title="Test sound"
          >
            <Volume2 className="w-5 h-5" />
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto px-0.5 py-3 ${legacyCardLayout ? 'bg-yellow-50' : 'bg-white'}`} title="SCROLL CONTAINER (active)">
          {activeOrders.length === 0 ? (
            <div className="text-center text-gray-500 mt-8">
              <p>Tidak ada pesanan aktif</p>
            </div>
          ) : (
            <div className={`space-y-2 ${legacyCardLayout ? 'bg-lime-50' : ''}`} title="LIST WRAPPER">
              {activeOrders.map((item, index) => (
                <div
                  key={`${item.uuid_id}-${index}`}
                  onDoubleClick={viewOnly ? undefined : () => handleMarkFinished(item)}
                  className={legacyCardLayout
                    ? `w-full min-w-0 border-2 border-orange-300 rounded-lg p-2 transition-all flex relative bg-amber-100 ${viewOnly ? '' : 'cursor-pointer hover:border-orange-500 hover:shadow-md'}`
                    : `w-full min-w-0 border-2 border-gray-800 rounded-lg p-2.5 transition-all flex flex-col relative bg-white shadow-sm ${viewOnly ? '' : 'cursor-pointer hover:border-orange-700 hover:shadow-md'}`
                  }
                  style={{ minHeight: legacyCardLayout ? '100px' : '60px' }}
                  title="CARD"
                >
                  {legacyCardLayout ? (
                    <>
                      <div className="flex-1 flex flex-col gap-0.5 min-w-0 basis-0 overflow-visible">
                        <div className="text-lg font-semibold text-gray-900 break-all">
                          {item.total_quantity}x {item.platform_label === 'Offline' ? '' : `[${item.platform_label}] `}{item.product_name}
                        </div>
                        {item.customizations && item.customizations.length > 0 && (
                          <div className="text-blue-700 font-bold text-base flex flex-wrap break-words">
                            {item.customizations.map((customization, idx) => (
                              <span key={idx}>
                                {customization.options.map((option, optIdx) => (
                                  <span key={optIdx}>
                                    +{option.option_name}
                                    {option.price_adjustment !== 0 && ` (+${option.price_adjustment})`}
                                    {optIdx < customization.options.length - 1 && ', '}
                                  </span>
                                ))}
                                {idx < item.customizations.length - 1 && ', '}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.custom_note && (
                          <div className="text-purple-700 font-bold text-base break-words">note: {item.custom_note}</div>
                        )}
                      </div>
                      <div className="flex-shrink-0 w-[100px] flex flex-col items-center justify-center p-1.5 bg-orange-200" style={{ minHeight: '100%' }}>
                        <div className="text-2xl font-mono font-bold text-blue-600">{item.timer}</div>
                        {item.customer_name && (
                          <div className="text-base text-gray-600 font-semibold text-center mt-1 truncate max-w-full" title={item.customer_name}>{item.customer_name}</div>
                        )}
                        {item.pickup_method === 'take-away' ? (
                          <div className="text-sm font-bold text-green-700 text-center mt-0.5 uppercase">Take Away</div>
                        ) : item.table_number ? (
                          <div className="text-base text-gray-600 font-semibold text-center mt-0.5">{item.table_number}</div>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col gap-0.5 min-w-0 overflow-visible" title="TEXT WRAPPER">
                      <div
                        className="text-base font-bold text-black grid gap-x-2 items-center"
                        style={{ gridTemplateColumns: '1fr 6rem 7rem 5rem' }}
                        title={`${item.total_quantity}x ${item.product_name}`}
                      >
                        <span className="min-w-0 break-words">{item.total_quantity}x {item.product_name}</span>
                        <span className="text-black font-semibold truncate" title={item.pickup_method === 'take-away' ? 'Take Away' : (item.table_number || '-')}>{item.pickup_method === 'take-away' ? 'Take Away' : (item.table_number || '-')}</span>
                        <span className="text-black font-semibold truncate" title={item.customer_name || '-'}>{item.customer_name || '-'}</span>
                        <span className="text-xl font-mono font-bold text-blue-700 shrink-0">{item.timer}</span>
                      </div>
                      {(item.custom_note || (item.customizations && item.customizations.length > 0)) && (
                        <div className="text-sm text-black break-words flex flex-wrap gap-x-1 font-medium">
                          {item.customizations && item.customizations.length > 0 && (
                            <span className="text-blue-900">
                              {item.customizations.map((customization, idx) => (
                                <span key={idx}>
                                  {customization.options.map((option, optIdx) => (
                                    <span key={optIdx}>
                                      +{option.option_name}
                                      {option.price_adjustment !== 0 && ` (+${option.price_adjustment})`}
                                      {optIdx < customization.options.length - 1 && ', '}
                                    </span>
                                  ))}
                                  {idx < item.customizations.length - 1 && ', '}
                                </span>
                              ))}
                            </span>
                          )}
                          {item.custom_note && (
                            <span className="text-purple-900">
                              {item.customizations && item.customizations.length > 0 && ' | '}
                              note: {item.custom_note}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Column 2: Finished Orders */}
      <div className="w-1/2 flex flex-col bg-violet-50/30" title="KITCHEN FINISHED COLUMN">
        <div className="bg-green-500 text-white px-6 py-4 flex-shrink-0">
          <h2 className="text-2xl font-bold">Dapur - Pesanan Selesai</h2>
        </div>
        <div className={`flex-1 overflow-y-auto px-0.5 py-3 ${legacyCardLayout ? 'bg-yellow-50' : 'bg-white'}`} title="SCROLL CONTAINER (finished)">
          {finishedOrders.length === 0 ? (
            <div className="text-center text-gray-500 mt-8">
              <p>Tidak ada pesanan selesai</p>
            </div>
          ) : (
            <div className={`space-y-2 ${legacyCardLayout ? 'bg-lime-50' : ''}`} title="LIST WRAPPER (finished)">
              {finishedOrders.map((item, index) => {
                if (legacyCardLayout) {
                  return (
                    <div key={`${item.uuid_id}-${index}`} className="border-2 border-gray-300 rounded-lg p-2 opacity-75 bg-amber-100" title="FINISHED CARD">
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="text-lg font-semibold text-gray-600 line-through break-all">
                          {item.total_quantity}x {item.platform_label === 'Offline' ? '' : `[${item.platform_label}] `}{item.product_name}
                        </div>
                        {item.customizations && item.customizations.length > 0 && (
                          <div className="text-blue-700 font-bold text-base line-through flex flex-wrap break-words">
                            {item.customizations.map((customization, idx) => (
                              <span key={idx}>
                                {customization.options.map((option, optIdx) => (
                                  <span key={optIdx}>
                                    +{option.option_name}
                                    {option.price_adjustment !== 0 && ` (+${option.price_adjustment})`}
                                    {optIdx < customization.options.length - 1 && ', '}
                                  </span>
                                ))}
                                {idx < item.customizations.length - 1 && ', '}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.custom_note && (
                          <div className="text-purple-700 font-bold text-base line-through break-words">note: {item.custom_note}</div>
                        )}
                      </div>
                      {(item.table_number || item.pickup_method === 'take-away' || item.production_started_at || item.production_finished_at) && (
                        <div className="text-xs text-gray-500 mt-1">
                          {(() => {
                            const tableText = item.pickup_method === 'take-away' ? 'Take Away | ' : (item.table_number ? `${item.table_number} | ` : '');
                            const startTimeSource = item.production_started_at || item.created_at;
                            const startTime = startTimeSource ? new Date(startTimeSource).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
                            const endTime = item.production_finished_at ? new Date(item.production_finished_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
                            let durationText = '';
                            if (startTimeSource && item.production_finished_at) {
                              const start = new Date(startTimeSource);
                              const end = new Date(item.production_finished_at);
                              const diffMinutes = Math.floor((end.getTime() - start.getTime()) / (1000 * 60));
                              durationText = ` | Waktu penyelesaian: ${diffMinutes} Menit`;
                            }
                            return `${tableText}${startTime ? `Mulai: ${startTime}` : ''}${startTime && endTime ? ' | ' : ''}${endTime ? `Selesai: ${endTime}` : ''}${durationText}`;
                          })()}
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <div
                    key={`${item.uuid_id}-${index}`}
                    className="border-2 border-gray-700 rounded-lg p-2.5 bg-white"
                    title="FINISHED CARD"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div
                        className="text-base font-bold text-gray-900 line-through grid gap-x-2 items-center"
                        style={{ gridTemplateColumns: '1fr 6rem 7rem 9rem' }}
                      >
                        <span className="min-w-0 break-words">{item.total_quantity}x {item.product_name}</span>
                        <span className="text-gray-900 font-semibold truncate">{item.pickup_method === 'take-away' ? 'Take Away' : (item.table_number || '-')}</span>
                        <span className="text-gray-900 font-semibold truncate">{item.customer_name || '-'}</span>
                        {(() => {
                          const startTimeSource = item.production_started_at || item.created_at;
                          const startTime = startTimeSource ? new Date(startTimeSource).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
                          const endTime = item.production_finished_at ? new Date(item.production_finished_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
                          return <span className="font-mono text-gray-800 text-sm shrink-0">{startTime && endTime ? `${startTime} - ${endTime}` : (startTime || '-')}</span>;
                        })()}
                      </div>
                      {(item.custom_note || (item.customizations && item.customizations.length > 0)) && (
                        <div className="text-sm text-gray-900 break-words flex flex-wrap gap-x-1 font-medium line-through">
                          {item.customizations && item.customizations.length > 0 && (
                            <span className="text-blue-900">
                              {item.customizations.map((customization, idx) => (
                                <span key={idx}>
                                  {customization.options.map((option, optIdx) => (
                                    <span key={optIdx}>
                                      +{option.option_name}
                                      {option.price_adjustment !== 0 && ` (+${option.price_adjustment})`}
                                      {optIdx < customization.options.length - 1 && ', '}
                                    </span>
                                  ))}
                                  {idx < item.customizations.length - 1 && ', '}
                                </span>
                              ))}
                            </span>
                          )}
                          {item.custom_note && (
                            <span className="text-purple-900">
                              {item.customizations && item.customizations.length > 0 && ' | '}
                              note: {item.custom_note}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

