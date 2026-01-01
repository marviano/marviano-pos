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

      // Fetch all pending transactions
      const transactions = await electronAPI.localDbGetTransactions?.(businessId, 10000);
      const transactionsArray = Array.isArray(transactions) ? transactions : [];
      
      // Filter for pending transactions
      const pendingTransactions = transactionsArray.filter((tx: any) => 
        tx.status === 'pending'
      );

      // Fetch all products to get category info
      const allProducts = await electronAPI.localDbGetAllProducts?.();
      const productsArray = Array.isArray(allProducts) ? allProducts : [];
      const productsMap = new Map<number, any>();
      productsArray.forEach((p: any) => {
        if (p.id) {
          productsMap.set(p.id, p);
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

      // Fetch transaction items for all pending transactions
      const allOrderItems: OrderItem[] = [];
      
      for (const tx of pendingTransactions) {
        const transactionId = tx.uuid_id || tx.id;
        const items = await electronAPI.localDbGetTransactionItems?.(transactionId);
        const itemsArray = Array.isArray(items) ? items : [];
        
        // Fetch customizations
        const customizationsData = await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(transactionId);
        const customizations = customizationsData?.customizations || [];
        const customizationOptions = customizationsData?.options || [];

        // Create customizations map
        const customizationsMap = new Map<number, Array<{
          customization_name: string;
          options: Array<{ option_name: string; price_adjustment: number }>;
        }>>();

        customizations.forEach((cust: any) => {
          const itemId = typeof cust.transaction_item_id === 'string' 
            ? parseInt(cust.transaction_item_id, 10) 
            : cust.transaction_item_id;
          
          if (!customizationsMap.has(itemId)) {
            customizationsMap.set(itemId, []);
          }

          const options = customizationOptions
            .filter((opt: any) => opt.transaction_item_customization_id === cust.id)
            .map((opt: any) => ({
              option_name: opt.option_name,
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
            customizationsMap.get(itemId)!.push({
              customization_name: cust.customization_type_name || `Customization ${cust.customization_type_id}`,
              options,
            });
          }
        });

        // Process items
        for (const item of itemsArray) {
          const product = productsMap.get(item.product_id);
          if (!product) continue;

          // Filter by category - minuman and dessert for barista
          const categoryName = product.category1_name?.toLowerCase();
          if (categoryName !== 'minuman' && categoryName !== 'dessert') {
            continue;
          }

          const tableId = tx.table_id;
          const tableInfo = tableId && tablesMap.has(tableId) ? tablesMap.get(tableId)! : null;
          const tableNumber = tableInfo ? tableInfo.table_number : null;
          const roomId = tableInfo ? tableInfo.room_id : null;
          const roomName = roomId && roomsMap.has(roomId) ? roomsMap.get(roomId)! : null;

          const itemCustomizations = customizationsMap.get(item.id) || [];

          allOrderItems.push({
            id: item.id,
            uuid_id: item.uuid_id || item.id?.toString() || '',
            transaction_id: transactionId,
            product_id: item.product_id,
            product_name: product.nama || 'Unknown',
            quantity: item.quantity || 1,
            custom_note: item.custom_note || null,
            production_status: item.production_status || null,
            production_started_at: item.production_started_at || null,
            production_finished_at: item.production_finished_at || null,
            table_number: tableNumber || null,
            room_name: roomName || null,
            created_at: tx.created_at || item.created_at || new Date().toISOString(),
            customizations: itemCustomizations,
          });
        }
      }

      // Group items by product_id + customization signature
      const groupedMap = new Map<string, GroupedOrderItem>();

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

      groupedMap.forEach(item => {
        const groupedItem = {
          ...item,
          timer: formatTimer(item.created_at),
        };

        if (item.production_status === 'finished') {
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
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetTransactionItems || !electronAPI?.localDbUpsertTransactionItems) {
        alert('Function not available');
        return;
      }

      // Fetch the transaction item to get all its data
      const items = await electronAPI.localDbGetTransactionItems?.(item.transaction_id);
      const itemsArray = Array.isArray(items) ? items : [];
      const itemToUpdate = itemsArray.find((i: any) => 
        (i.uuid_id === item.uuid_id) || (i.id?.toString() === item.uuid_id)
      );

      if (!itemToUpdate) {
        alert('Item tidak ditemukan');
        return;
      }

      // Update production status
      const updatedItem = {
        ...itemToUpdate,
        production_status: 'finished',
        production_finished_at: new Date().toISOString(),
      };

      // Upsert the updated item
      await electronAPI.localDbUpsertTransactionItems?.([updatedItem]);

      // Refresh orders
      fetchOrders();
    } catch (error) {
      console.error('Error marking item as finished:', error);
      alert('Gagal menandai item sebagai selesai');
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
                        {item.display_text}
                      </div>
                    </div>
                    <div className="ml-4">
                      <div className="text-2xl font-mono font-bold text-blue-600">
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
          <h2 className="text-2xl font-bold">Barista - Pesanan Selesai</h2>
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

