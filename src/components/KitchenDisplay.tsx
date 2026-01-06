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

export default function KitchenDisplay() {
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

      // Fetch all pending transactions
      const transactions = await electronAPI.localDbGetTransactions?.(businessId, 10000);
      const transactionsArray = Array.isArray(transactions) ? transactions as Record<string, unknown>[] : [];
      
      // Filter for pending transactions
      const pendingTransactions = transactionsArray.filter((tx) => 
        tx.status === 'pending'
      );

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

      // Fetch transaction items for all pending transactions
      const allOrderItems: OrderItem[] = [];
      
      for (const tx of pendingTransactions) {
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
          
          const itemProductionStartedAt = typeof item.production_started_at === 'string' ? item.production_started_at : null;
          const itemProductionFinishedAt = typeof item.production_finished_at === 'string' ? item.production_finished_at : null;
          const itemCreatedAt = typeof item.created_at === 'string' ? item.created_at : null;
          const txCreatedAt = typeof tx.created_at === 'string' ? tx.created_at : null;
          const productNama = typeof product.nama === 'string' ? product.nama : 'Unknown';

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
            created_at: txCreatedAt || itemCreatedAt || new Date().toISOString(),
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
        const signature = `${item.product_id}_${sortedOptionIds}_${customNote}`;

        // Track all items in this group
        if (!groupItemsMap.has(signature)) {
          groupItemsMap.set(signature, []);
        }
        groupItemsMap.get(signature)!.push(item);

        if (groupedMap.has(signature)) {
          const existing = groupedMap.get(signature)!;
          existing.total_quantity += item.quantity;
          // Update display text with new total quantity
          let displayText = `${existing.total_quantity}x ${item.product_name}`;
          
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

          // Add table number
          if (item.table_number) {
            displayText += ` table ${item.table_number}`;
          }

          existing.display_text = displayText;
        } else {
          // Build display text
          let displayText = `${item.quantity}x ${item.product_name}`;
          
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

          // Add table number
          if (item.table_number) {
            displayText += ` table ${item.table_number}`;
          }

          groupedMap.set(signature, {
            ...item,
            total_quantity: item.quantity,
            display_text: displayText,
            timer: formatTimer(item.created_at),
          });
        }
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
      setLoading(false);
    } catch (error) {
      console.error('Error fetching orders:', error);
      setLoading(false);
    }
  };

  const formatTimer = (createdAt: string): string => {
    const created = new Date(createdAt);
    const diffMs = currentTime.getTime() - created.getTime();
    const totalSeconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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
        const itemSignature = `${transactionItem.product_id}_${sortedOptionIds}_${itemNote}`;

        // Create signature for the grouped item
        const groupedOptionIds: number[] = [];
        item.customizations.forEach(customization => {
          customization.options.forEach(option => {
            groupedOptionIds.push(option.option_name.charCodeAt(0));
          });
        });
        const groupedSortedOptionIds = groupedOptionIds.sort((a, b) => a - b).join(',');
        const groupedSignature = `${item.product_id}_${groupedSortedOptionIds}_${itemNote}`;

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

  return (
    <div className="flex-1 flex h-full bg-gray-50">
      {/* Column 1: Active Orders */}
      <div className="w-1/2 border-r border-gray-300 flex flex-col">
        <div className="bg-orange-500 text-white px-6 py-4 flex-shrink-0">
          <h2 className="text-2xl font-bold">Dapur - Pesanan Aktif</h2>
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
                  className="bg-white border-2 border-orange-300 rounded-lg p-4 cursor-pointer hover:border-orange-500 hover:shadow-md transition-all"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="text-lg font-semibold text-gray-900">
                        {item.display_text}
                      </div>
                    </div>
                    <div className="ml-4">
                      <div className="text-2xl font-mono font-bold text-orange-600">
                        {item.timer}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Double tap to mark as finished
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Column 2: Finished Orders */}
      <div className="w-1/2 flex flex-col">
        <div className="bg-green-500 text-white px-6 py-4 flex-shrink-0">
          <h2 className="text-2xl font-bold">Dapur - Pesanan Selesai</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {finishedOrders.length === 0 ? (
            <div className="text-center text-gray-500 mt-8">
              <p>Tidak ada pesanan selesai</p>
            </div>
          ) : (
            <div className="space-y-3">
              {finishedOrders.map((item, index) => (
                <div
                  key={`${item.uuid_id}-${index}`}
                  className="bg-gray-100 border-2 border-gray-300 rounded-lg p-4 opacity-75"
                >
                  <div className="text-lg font-semibold text-gray-600 line-through">
                    {item.display_text}
                  </div>
                  {item.production_finished_at && (
                    <div className="text-xs text-gray-500 mt-1">
                      Selesai: {new Date(item.production_finished_at).toLocaleTimeString('id-ID')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

