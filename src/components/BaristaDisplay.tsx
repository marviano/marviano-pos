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

export default function BaristaDisplay({ viewOnly = false, legacyCardLayout = false }: { viewOnly?: boolean; legacyCardLayout?: boolean }) {
  const { user } = useAuth();
  const [activeOrders, setActiveOrders] = useState<GroupedOrderItem[]>([]);
  const [finishedOrders, setFinishedOrders] = useState<GroupedOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const previousOrderIdsRef = useRef<Set<string>>(new Set());
  const hasCompletedInitialFetchRef = useRef(false);
  const soundRef = useRef<HTMLAudioElement | null>(null);
  const firstTextWrapperRef = useRef<HTMLDivElement | null>(null);
  const firstProductNameRef = useRef<HTMLDivElement | null>(null);
  const firstCardRef = useRef<HTMLDivElement | null>(null);

  const businessId = user?.selectedBusinessId;
  
  if (!businessId) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center p-8 bg-white rounded-lg shadow-lg">
          <h2 className="text-xl font-bold text-red-600 mb-2">No Business Selected</h2>
          <p className="text-gray-700">Please log in and select a business to access the Barista Display.</p>
        </div>
      </div>
    );
  }

  // Check permission - if viewOnly, also check for access_baristaandkitchen
  const hasBaristaPermission = user?.permissions?.includes('access_barista') || false;
  const hasBaristaKitchenPermission = user?.permissions?.includes('access_baristaandkitchen') || false;
  const hasPermission = hasBaristaPermission || (viewOnly && hasBaristaKitchenPermission);
  
  if (!isSuperAdmin(user) && !hasPermission) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center p-8 bg-white rounded-lg shadow-lg">
          <h2 className="text-xl font-bold text-red-600 mb-2">Access Denied</h2>
          <p className="text-gray-700">You do not have permission to access the Barista Display.</p>
        </div>
      </div>
    );
  }

  // Update timer every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

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
        if (p.id) {
          const productId = typeof p.id === 'number' ? p.id : Number(p.id);
          if (!isNaN(productId)) {
            productsMap.set(productId, p);
          }
        }
      });

      // Fetch tables and rooms
      const tablesMap = new Map<number, { table_number: string; room_id: number }>();
      const roomsMap = new Map<number, string>();
      if (electronAPI.getRestaurantRooms) {
        const rooms = await electronAPI.getRestaurantRooms(businessId);
        const roomsArray = Array.isArray(rooms) ? rooms : [];
        roomsArray.forEach((room: { id: number; name: string }) => {
          if (room.id) {
            roomsMap.set(room.id, room.name);
          }
        });

        for (const room of roomsArray) {
          if (room.id && electronAPI.getRestaurantTables) {
            const tables = await electronAPI.getRestaurantTables(room.id);
            const tablesArray = Array.isArray(tables) ? tables : [];
            tablesArray.forEach((table: { id: number; table_number: string; room_id: number }) => {
              tablesMap.set(table.id, { table_number: table.table_number, room_id: table.room_id });
            });
          }
        }
      }

      // Fetch transaction items for all relevant transactions
      const allOrderItems: OrderItem[] = [];
      
      for (const tx of relevantTransactions) {
        const transactionId = (tx.uuid_id || tx.id) as string | number | undefined;
        const items = await electronAPI.localDbGetTransactionItems?.(transactionId);
        const itemsArray = Array.isArray(items) ? items as Record<string, unknown>[] : [];
        
        // Fetch customizations
        const transactionIdStr = transactionId ? String(transactionId) : '';
        const customizationsData = transactionIdStr ? await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(transactionIdStr) : undefined;
        const customizations = customizationsData?.customizations || [];
        const customizationOptions = customizationsData?.options || [];

        // Create customizations map
        const customizationsMap = new Map<number, Array<{
          customization_name: string;
          options: Array<{ option_name: string; price_adjustment: number }>;
        }>>();

        customizations.forEach((cust: Record<string, unknown>) => {
          const itemId = typeof cust.transaction_item_id === 'string' 
            ? parseInt(cust.transaction_item_id, 10) 
            : (typeof cust.transaction_item_id === 'number' ? cust.transaction_item_id : 0);
          
          if (!customizationsMap.has(itemId)) {
            customizationsMap.set(itemId, []);
          }

          const options = customizationOptions
            .filter((opt: Record<string, unknown>) => opt.transaction_item_customization_id === cust.id)
            .map((opt: Record<string, unknown>) => ({
              option_name: String(opt.option_name || ''),
              price_adjustment: typeof opt.price_adjustment === 'number' 
                ? opt.price_adjustment 
                : (typeof opt.price_adjustment === 'string' ? parseFloat(opt.price_adjustment) || 0 : 0),
            }));

          const existingCust = customizationsMap.get(itemId)!.find(c => 
            c.customization_name === cust.customization_type_name
          );

          if (existingCust) {
            existingCust.options.push(...options);
          } else {
            const customizationTypeName = typeof cust.customization_type_name === 'string' 
              ? cust.customization_type_name 
              : `Customization ${cust.customization_type_id || ''}`;
            customizationsMap.get(itemId)!.push({
              customization_name: customizationTypeName,
              options,
            });
          }
        });

        // Process items
        for (const item of itemsArray) {
          const productId = typeof item.product_id === 'number' ? item.product_id : (typeof item.product_id === 'string' ? parseInt(item.product_id, 10) : 0);
          const product = productId ? productsMap.get(productId) : undefined;
          if (!product) continue;

          // Filter by category - minuman and dessert for barista
          const categoryName = typeof product.category1_name === 'string' ? product.category1_name.toLowerCase() : '';
          if (categoryName !== 'minuman' && categoryName !== 'dessert') {
            continue;
          }

          const tableId = typeof tx.table_id === 'number' ? tx.table_id : (typeof tx.table_id === 'string' ? parseInt(tx.table_id, 10) : undefined);
          const tableInfo = tableId && tablesMap.has(tableId) ? tablesMap.get(tableId)! : null;
          const tableNumber = tableInfo ? tableInfo.table_number : null;
          const roomId = tableInfo ? tableInfo.room_id : null;
          const roomName = roomId && roomsMap.has(roomId) ? roomsMap.get(roomId)! : null;
          const customerName = typeof tx.customer_name === 'string' ? tx.customer_name : null;

          const itemId = typeof item.id === 'number' ? item.id : (typeof item.id === 'string' ? parseInt(item.id, 10) : 0);
          const itemCustomizations = itemId ? customizationsMap.get(itemId) || [] : [];

          // Filter out cancelled items - they should not appear on barista display
          const itemProductionStatus = typeof item.production_status === 'string' ? item.production_status : null;
          if (itemProductionStatus === 'cancelled') {
            continue;
          }
          
          const orderItem = {
            id: itemId,
            uuid_id: typeof item.uuid_id === 'string' ? item.uuid_id : (itemId ? String(itemId) : ''),
            transaction_id: transactionIdStr || (transactionId ? String(transactionId) : ''),
            product_id: productId,
            product_name: typeof product.nama === 'string' ? product.nama : 'Unknown',
            quantity: typeof item.quantity === 'number' ? item.quantity : (typeof item.quantity === 'string' ? parseInt(item.quantity, 10) : 1),
            custom_note: typeof item.custom_note === 'string' ? item.custom_note : null,
            production_status: itemProductionStatus,
            production_started_at: typeof item.production_started_at === 'string' ? item.production_started_at : (item.production_started_at instanceof Date ? item.production_started_at.toISOString() : null),
            production_finished_at: typeof item.production_finished_at === 'string' ? item.production_finished_at : (item.production_finished_at instanceof Date ? item.production_finished_at.toISOString() : null),
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
            created_at: (() => {
              const txCreatedAt = typeof tx.created_at === 'string' ? tx.created_at : (tx.created_at instanceof Date ? tx.created_at.toISOString() : null);
              const itemCreatedAt = typeof item.created_at === 'string' ? item.created_at : (item.created_at instanceof Date ? item.created_at.toISOString() : null);
              
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
              return finalCreatedAt;
            })(),
            customizations: itemCustomizations,
          };
          
          allOrderItems.push(orderItem);
          
          // Debug: Log item details for this specific transaction
          if (transactionId === '0142601012201470001') {
            console.log('🔍 Item from transaction 0142601012201470001:', {
              itemId: item.id,
              uuid_id: item.uuid_id,
              product_id: item.product_id,
              product_name: product.nama,
              production_status: item.production_status,
              production_finished_at: item.production_finished_at,
              customizationsCount: itemCustomizations.length
            });
          }
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
            customizationTexts.push(`+${option.option_name}`);
          });
        });
        if (customizationTexts.length > 0) {
          displayText += ` ${customizationTexts.join(', ')}`;
        }

        // Add custom note
        if (item.custom_note) {
          displayText += ` note: ${item.custom_note}`;
        }

        // Use production_started_at if available, otherwise created_at
        const startTime = item.production_started_at || item.created_at;
        
        groupedMap.set(signature, {
          ...item,
          total_quantity: item.quantity,
          display_text: displayText,
          timer: formatTimer(startTime, currentTime),
          production_started_at: startTime,
        });
      });

      // Separate active and finished orders
      const active: GroupedOrderItem[] = [];
      const finished: GroupedOrderItem[] = [];

      groupedMap.forEach((item, signature) => {
        const itemsInGroup = groupItemsMap.get(signature) || [];
        
        // For timer, use the earliest production_started_at from items in the group, or earliest created_at
        const startTimes = itemsInGroup
          .map(i => i.production_started_at || i.created_at)
          .filter((t): t is string => t !== null)
          .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        const earliestStartTime = startTimes.length > 0 ? startTimes[0] : item.created_at;
        
        const groupedItem = {
          ...item,
          production_started_at: earliestStartTime,
          timer: formatTimer(earliestStartTime, currentTime),
        };

        // Check if ALL items in this group are finished
        const allFinished = itemsInGroup.length > 0 && itemsInGroup.every(i => i.production_status === 'finished');
        
        const statuses = itemsInGroup.map(i => ({
          id: i.id,
          uuid_id: i.uuid_id,
          status: i.production_status,
          statusType: typeof i.production_status,
          isNull: i.production_status === null,
          isFinished: i.production_status === 'finished',
          finished_at: i.production_finished_at
        }));
        
        const finishedCount = itemsInGroup.filter(i => i.production_status === 'finished').length;
        const nullCount = itemsInGroup.filter(i => i.production_status === null).length;
        const otherCount = itemsInGroup.filter(i => i.production_status !== 'finished' && i.production_status !== null).length;
        
        console.log('📋 Group status check:', {
          signature,
          product_name: item.product_name,
          itemsInGroup: itemsInGroup.length,
          allFinished,
          finishedCount,
          nullCount,
          otherCount,
          statuses: statuses
        });

        if (allFinished) {
          // Update the grouped item's production_status to finished
          groupedItem.production_status = 'finished';
          // Use the most recent finished_at time from the items
          // Since each item has unique signature now, itemsInGroup should have 1 item
          const finishedTimes = itemsInGroup
            .map(i => i.production_finished_at)
            .filter((t): t is string => t !== null)
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
          if (finishedTimes.length > 0) {
            groupedItem.production_finished_at = finishedTimes[0];
          } else {
            // If production_finished_at is null, use the item's production_finished_at directly
            // This handles the case where the item is marked finished but finished_at wasn't set
            const itemFinishedAt = itemsInGroup[0]?.production_finished_at;
            if (itemFinishedAt) {
              groupedItem.production_finished_at = itemFinishedAt;
            } else {
              // Log warning if finished item has no finished_at time
              console.warn('Finished item has no production_finished_at:', {
                itemId: itemsInGroup[0]?.id,
                uuid_id: itemsInGroup[0]?.uuid_id,
                production_status: itemsInGroup[0]?.production_status
              });
            }
          }
          finished.push(groupedItem);
        } else {
          // Only add to active if there are unfinished items
          const hasUnfinishedItems = itemsInGroup.some(i => i.production_status !== 'finished');
          if (hasUnfinishedItems) {
            active.push(groupedItem);
          }
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
      
      // Check for new orders and play sound (only on standalone Barista display, not in Barista & Kitchen combined view)
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
  }, [businessId, currentTime]);

  const formatTimer = (startTime: string | null, currentTime: Date): string => {
    if (!startTime) {
      return '00:00';
    }
    const start = new Date(startTime);
    
    // Check if date is valid
    if (isNaN(start.getTime())) {
      console.warn('Invalid date for timer:', startTime);
      return '00:00';
    }
    const diffMs = currentTime.getTime() - start.getTime();
    
    // Handle negative time (if date is in future due to timezone issues)
    if (diffMs < 0) {
      console.warn('Negative time difference detected:', { startTime, currentTime: currentTime.toISOString(), diffMs });
      return '00:00';
    }
    const totalSeconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const result = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    return result;
  };

  const formatDuration = (startTime: string | null, endTime: string | null): string => {
    if (!startTime || !endTime) return '00:00';
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffMs = end.getTime() - start.getTime();
    const totalSeconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatTime = (dateTime: string | null): string => {
    if (!dateTime) return '';
    const date = new Date(dateTime);
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

      // Fetch transaction to get table_id, then get table_number
      const transactions = await electronAPI.localDbGetTransactions?.(businessId, 10000);
      const transactionsArray = Array.isArray(transactions) ? transactions as Record<string, unknown>[] : [];
      const currentTransaction = transactionsArray.find((tx) => 
        tx.uuid_id === item.transaction_id || tx.id === item.transaction_id
      ) as Record<string, unknown> | undefined;
      
      // Get table info if available
      let transactionTableNumber = '';
      if (currentTransaction && electronAPI.getRestaurantRooms && electronAPI.getRestaurantTables) {
        const tableId = typeof currentTransaction.table_id === 'number' ? currentTransaction.table_id : (typeof currentTransaction.table_id === 'string' ? parseInt(currentTransaction.table_id, 10) : null);
        if (tableId) {
          const rooms = await electronAPI.getRestaurantRooms(businessId);
          const roomsArray = Array.isArray(rooms) ? rooms : [];
          for (const room of roomsArray) {
            if (room.id && electronAPI.getRestaurantTables) {
              const tables = await electronAPI.getRestaurantTables(room.id);
              const tablesArray = Array.isArray(tables) ? tables : [];
              const table = tablesArray.find((t: { id: number }) => t.id === tableId);
              if (table) {
                transactionTableNumber = table.table_number || '';
                break;
              }
            }
          }
        }
      }

      // Fetch customizations to match items by signature
      const customizationsData = await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(item.transaction_id);
      const customizations = customizationsData?.customizations || [];
      const customizationOptions = customizationsData?.options || [];

      // Create customizations map
      const customizationsMap = new Map<number, Array<{
        customization_name: string;
        options: Array<{ option_name: string; price_adjustment: number }>;
      }>>();

      customizations.forEach((cust: Record<string, unknown>) => {
        const itemId = typeof cust.transaction_item_id === 'string' 
          ? parseInt(cust.transaction_item_id, 10) 
          : (typeof cust.transaction_item_id === 'number' ? cust.transaction_item_id : 0);
        
        if (!customizationsMap.has(itemId)) {
          customizationsMap.set(itemId, []);
        }

        const options = customizationOptions
          .filter((opt: Record<string, unknown>) => opt.transaction_item_customization_id === cust.id)
          .map((opt: Record<string, unknown>) => ({
            option_name: String(opt.option_name || ''),
            price_adjustment: typeof opt.price_adjustment === 'number' 
              ? opt.price_adjustment 
              : (typeof opt.price_adjustment === 'string' ? parseFloat(opt.price_adjustment) || 0 : 0),
          }));

        const existingCust = customizationsMap.get(itemId)!.find(c => 
          c.customization_name === cust.customization_type_name
        );

        if (existingCust) {
          existingCust.options.push(...options);
        } else {
          const customizationTypeName = typeof cust.customization_type_name === 'string' 
            ? cust.customization_type_name 
            : `Customization ${cust.customization_type_id || ''}`;
          customizationsMap.get(itemId)!.push({
            customization_name: customizationTypeName,
            options,
          });
        }
      });

      // Find all items that match this signature (same product_id + same customizations + same note)
      const itemsToUpdate: Array<Record<string, unknown>> = [];
      const finishedAt = new Date().toISOString();

      itemsArray.forEach((transactionItem: Record<string, unknown>) => {
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
        const itemIdForLookup = typeof transactionItem.id === 'string' 
          ? parseInt(transactionItem.id, 10) 
          : (typeof transactionItem.id === 'number' ? transactionItem.id : 0);
        const itemCustomizations = itemIdForLookup ? customizationsMap.get(itemIdForLookup) || [] : [];
        
        // Create signature for this item (must match grouping signature including table_number)
        const allOptionIds: number[] = [];
        itemCustomizations.forEach((customization: { options: Array<{ option_name: string }> }) => {
          customization.options.forEach((option: { option_name: string }) => {
            allOptionIds.push(option.option_name.charCodeAt(0));
          });
        });
        const sortedOptionIds = allOptionIds.sort((a, b) => a - b).join(',');
        // Use the table_number we fetched from the transaction (all items in same transaction have same table)
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
          console.log('✅ Signature match:', {
            transactionItemId: transactionItem.id,
            itemSignature,
            groupedSignature,
            product_id: transactionItem.product_id,
            note: itemNote
          });
          // Ensure we have all required fields for the update
          // Set production_started_at if not already set (use created_at as fallback)
          const startedAt = transactionItem.production_started_at || transactionItem.created_at || finishedAt;
          
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
            production_started_at: startedAt,
            production_finished_at: finishedAt,
          };
          
          console.log('📝 Item to update structure:', {
            id: itemToUpdate.id,
            uuid_id: itemToUpdate.uuid_id,
            production_status: itemToUpdate.production_status,
            production_finished_at: itemToUpdate.production_finished_at
          });
          
          itemsToUpdate.push(itemToUpdate);
        } else {
          console.log('❌ Signature mismatch:', {
            transactionItemId: transactionItem.id,
            itemSignature,
            groupedSignature,
            product_id: transactionItem.product_id,
            note: itemNote
          });
        }
      });

      console.log('🔍 Found', itemsToUpdate.length, 'items to update (after signature matching)');
      if (itemsToUpdate.length === 0) {
        console.warn('⚠️ No items found matching signature, trying fallback (product_id + note only)');
        // Fallback: try matching by product_id and note only (for items without customizations)
        const fallbackItems = itemsArray.filter((transactionItem: Record<string, unknown>) => {
          return transactionItem.product_id === item.product_id &&
                 (transactionItem.custom_note || '') === (item.custom_note || '') &&
                 (transactionItem.production_status !== 'finished');
        });
        
        if (fallbackItems.length > 0) {
          console.log('✅ Found', fallbackItems.length, 'items using fallback method');
          const finishedAt = new Date().toISOString();
          const fallbackUpdates = fallbackItems.map((transactionItem: Record<string, unknown>) => {
            // Set production_started_at if not already set (use created_at as fallback)
            const startedAt = transactionItem.production_started_at || transactionItem.created_at || finishedAt;
            return {
              ...transactionItem,
              production_status: 'finished',
              production_started_at: startedAt,
              production_finished_at: finishedAt,
            };
          });
          itemsToUpdate.push(...fallbackUpdates);
        } else {
          console.error('❌ No items found even with fallback method');
          console.log('Looking for product_id:', item.product_id, 'note:', item.custom_note);
          alert('Item tidak ditemukan. Check console for details.');
          return;
        }
      }

      console.log('💾 Updating items:', itemsToUpdate.map(i => ({ 
        id: i.id, 
        uuid_id: i.uuid_id, 
        product_id: i.product_id,
        production_status: i.production_status,
        production_finished_at: i.production_finished_at
      })));
      
      // Update all matching items
      const updateResult = await electronAPI.localDbUpsertTransactionItems?.(itemsToUpdate);
      console.log('✅ Items updated successfully. Update result:', updateResult);

      // Verify the update by fetching items again
      console.log('🔍 Verifying update...');
      const verifyItems = await electronAPI.localDbGetTransactionItems?.(item.transaction_id);
      const verifyItemsArray = Array.isArray(verifyItems) ? verifyItems as Record<string, unknown>[] : [];
      const updatedItemIds = itemsToUpdate.map(u => u.id || u.uuid_id);
      const updatedItems = verifyItemsArray.filter((i: Record<string, unknown>) => 
        updatedItemIds.includes(i.id as number | string) || updatedItemIds.includes(i.uuid_id as number | string)
      );
      console.log('🔍 Verification - Updated items status:', updatedItems.map((i: Record<string, unknown>) => ({
        id: i.id,
        uuid_id: i.uuid_id,
        production_status: i.production_status,
        production_finished_at: i.production_finished_at
      })));

      // Wait a bit for database to commit
      await new Promise(resolve => setTimeout(resolve, 500));

      // Refresh orders immediately
      console.log('🔄 Refreshing orders...');
      await fetchOrders();
      console.log('✅ Orders refreshed');
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
    <div className="flex-1 flex h-full bg-gray-50" title="BaristaDisplay ROOT">
      {/* Column 1: Active Orders */}
      <div className="w-1/2 border-r border-gray-300 flex flex-col bg-indigo-50/50" title="BARISTA ACTIVE COLUMN">
        <div className="bg-blue-500 text-white px-6 py-4 flex-shrink-0 flex items-center justify-between">
          <h2 className="text-2xl font-bold">Barista - Pesanan Aktif</h2>
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
                  ref={index === 0 ? firstCardRef : undefined}
                  onDoubleClick={viewOnly ? undefined : () => handleMarkFinished(item)}
                  className={legacyCardLayout
                    ? `w-full min-w-0 border-2 border-blue-300 rounded-lg p-2 transition-all flex relative bg-amber-100 ${viewOnly ? '' : 'cursor-pointer hover:border-blue-500 hover:shadow-md'}`
                    : `w-full min-w-0 border-2 border-gray-800 rounded-lg p-2.5 transition-all flex flex-col relative bg-white shadow-sm ${viewOnly ? '' : 'cursor-pointer hover:border-blue-700 hover:shadow-md'}`
                  }
                  style={{ minHeight: legacyCardLayout ? '100px' : '60px' }}
                  title="CARD"
                >
                  {legacyCardLayout ? (
                    <>
                      <div ref={index === 0 ? firstTextWrapperRef : undefined} className="flex-1 flex flex-col gap-0.5 min-w-0 basis-0 overflow-visible">
                        <div ref={index === 0 ? firstProductNameRef : undefined} className="text-lg font-semibold text-gray-900 break-all">
                          {item.total_quantity}x [{item.platform_label}] {item.product_name}
                        </div>
                        {item.customizations && item.customizations.length > 0 && (
                          <div className="text-blue-700 font-bold text-base flex flex-wrap break-words">
                            {item.customizations.map((customization, idx) => (
                              <span key={idx}>
                                {customization.options.map((option, optIdx) => (
                                  <span key={optIdx}>
                                    +{option.option_name}
                                    {optIdx < customization.options.length - 1 && ', '}
                                  </span>
                                ))}
                                {idx < item.customizations.length - 1 && ', '}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.custom_note && (
                          <div className="text-purple-700 font-bold text-base break-words">
                            note: {item.custom_note}
                          </div>
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
                    <div ref={index === 0 ? firstTextWrapperRef : undefined} className="flex flex-col gap-0.5 min-w-0 overflow-visible" title="TEXT WRAPPER">
                      <div
                        ref={index === 0 ? firstProductNameRef : undefined}
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
      <div className="w-1/2 flex flex-col bg-indigo-50/30" title="BARISTA FINISHED COLUMN">
        <div className="bg-green-500 text-white px-6 py-4 flex-shrink-0">
          <h2 className="text-2xl font-bold">Barista - Pesanan Selesai</h2>
        </div>
        <div className={`flex-1 overflow-y-auto px-0.5 py-3 ${legacyCardLayout ? 'bg-yellow-50' : 'bg-white'}`} title="SCROLL CONTAINER (finished)">
          {finishedOrders.length === 0 ? (
            <div className="text-center text-gray-500 mt-8">
              <p>Tidak ada pesanan selesai</p>
            </div>
          ) : (
            <div className={`space-y-2 ${legacyCardLayout ? 'bg-lime-50' : ''}`} title="LIST WRAPPER (finished)">
              {finishedOrders.map((item, index) => {
                const duration = formatDuration(item.production_started_at, item.production_finished_at);
                if (legacyCardLayout) {
                  return (
                    <div key={`${item.uuid_id}-${index}`} className="border-2 border-gray-300 rounded-lg p-2 opacity-75 bg-amber-100" title="FINISHED CARD">
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="text-lg font-semibold text-gray-600 break-all">
                          {item.total_quantity}x {item.platform_label === 'Offline' ? '' : `[${item.platform_label}] `}{item.product_name}
                        </div>
                        {item.customizations && item.customizations.length > 0 && (
                          <div className="text-blue-700 font-bold text-base flex flex-wrap break-words">
                            {item.customizations.map((customization, idx) => (
                              <span key={idx}>
                                {customization.options.map((option, optIdx) => (
                                  <span key={optIdx}>
                                    +{option.option_name}
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
                        className="text-base font-bold text-gray-900 grid gap-x-2 items-center line-through"
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

