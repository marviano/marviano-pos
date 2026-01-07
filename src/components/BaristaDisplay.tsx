'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';

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
  created_at: string;
  customizations: Array<{
    customization_name: string;
    options: Array<{
      option_name: string;
      price_adjustment: number;
    }>;
  }>;
}

interface GroupedOrderItem extends OrderItem {
  total_quantity: number;
  display_text: string;
  timer: string;
}

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function BaristaDisplay() {
  const { user } = useAuth();
  const businessId = user?.selectedBusinessId ?? 14;
  const [activeOrders, setActiveOrders] = useState<GroupedOrderItem[]>([]);
  const [finishedOrders, setFinishedOrders] = useState<GroupedOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update timer every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch orders from database
  const fetchOrders = async () => {
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
        // Build display text
        let displayText = `${item.quantity}x ${item.product_name}`;
        
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
      setLoading(false);
    } catch (error) {
      console.error('Error fetching orders:', error);
      setLoading(false);
    }
  };

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
  }, [businessId, currentTime]);

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

  return (
    <div className="flex-1 flex h-full bg-gray-50">
      {/* Column 1: Active Orders */}
      <div className="w-1/2 border-r border-gray-300 flex flex-col">
        <div className="bg-blue-500 text-white px-6 py-4 flex-shrink-0">
          <h2 className="text-2xl font-bold">Barista - Pesanan Aktif</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {activeOrders.length === 0 ? (
            <div className="text-center text-gray-500 mt-8">
              <p>Tidak ada pesanan aktif</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeOrders.map((item, index) => (
                <div
                  key={`${item.uuid_id}-${index}`}
                  onDoubleClick={() => handleMarkFinished(item)}
                  className="bg-white border-2 border-blue-300 rounded-lg p-4 cursor-pointer hover:border-blue-500 hover:shadow-md transition-all"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="text-lg font-semibold text-gray-900">
                        {item.total_quantity}x {item.product_name}
                        {item.customizations && item.customizations.length > 0 && (
                          <span className="text-blue-700 font-bold">
                            {' '}
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
                          <span className="text-purple-700 font-bold">
                            {' '}note: {item.custom_note}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="ml-4">
                      <div className="text-2xl font-mono font-bold text-blue-600">
                        {item.timer}
                      </div>
                    </div>
                  </div>
                  {item.table_number && (
                    <div className="text-xs text-gray-600 mt-2 font-semibold">
                      {item.table_number}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Column 2: Finished Orders */}
      <div className="w-1/2 flex flex-col">
        <div className="bg-green-500 text-white px-6 py-4 flex-shrink-0">
          <h2 className="text-2xl font-bold">Barista - Pesanan Selesai</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {finishedOrders.length === 0 ? (
            <div className="text-center text-gray-500 mt-8">
              <p>Tidak ada pesanan selesai</p>
            </div>
          ) : (
            <div className="space-y-3">
              {finishedOrders.map((item, index) => {
                const duration = formatDuration(item.production_started_at, item.production_finished_at);
                return (
                  <div
                    key={`${item.uuid_id}-${index}`}
                    className="bg-gray-100 border-2 border-gray-300 rounded-lg p-4 opacity-75"
                  >
                    <div className="text-lg font-semibold text-gray-600">
                      {item.display_text}
                    </div>
                  {(item.table_number || item.production_started_at || item.production_finished_at) && (
                    <div className="text-xs text-gray-500 mt-1">
                      {(() => {
                        const tableText = item.table_number ? `${item.table_number} | ` : '';
                        // Use production_started_at if available, otherwise fall back to created_at
                        const startTimeSource = item.production_started_at || item.created_at;
                        const startTime = startTimeSource 
                          ? new Date(startTimeSource).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
                          : null;
                        const endTime = item.production_finished_at 
                          ? new Date(item.production_finished_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
                          : null;
                        let durationText = '';
                        if (startTimeSource && item.production_finished_at) {
                          const start = new Date(startTimeSource);
                          const end = new Date(item.production_finished_at);
                          const diffMs = end.getTime() - start.getTime();
                          const diffMinutes = Math.floor(diffMs / (1000 * 60));
                          durationText = ` | Waktu penyelesaian: ${diffMinutes} Menit`;
                        }
                        return `${tableText}${startTime ? `Mulai: ${startTime}` : ''}${startTime && endTime ? ' | ' : ''}${endTime ? `Selesai: ${endTime}` : ''}${durationText}`;
                      })()}
                    </div>
                  )}
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

