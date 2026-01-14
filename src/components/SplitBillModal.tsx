'use client';

import { useState, useEffect, useRef } from 'react';
import { X, ChevronDown, ChevronUp, RotateCcw, Plus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { generateTransactionId } from '@/lib/uuid';
import { getApiUrl } from '@/lib/api';

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

interface SelectedCustomization {
  customization_id: number;
  customization_name: string;
  selected_options: {
    option_id: number;
    option_name: string;
    price_adjustment: number;
  }[];
}

interface TransactionItem {
  id: number;
  uuid_id: string;
  product_id: number;
  quantity: number;
  unit_price: number;
  total_price: number;
  custom_note: string | null;
  bundle_selections_json: string | null;
  production_status: string | null;
  product?: {
    id: number;
    nama: string;
    harga_jual: number;
  };
  customizations?: SelectedCustomization[];
}

interface SplitBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  businessId: number;
  onRefresh?: () => void;
}

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function SplitBillModal({ isOpen, onClose, businessId, onRefresh }: SplitBillModalProps) {
  const { user } = useAuth();
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransaction[]>([]);
  const [expandedTransactionId, setExpandedTransactionId] = useState<string | null>(null);
  const [transactionItemsMap, setTransactionItemsMap] = useState<Map<string, TransactionItem[]>>(new Map());
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [loadingItemsMap, setLoadingItemsMap] = useState<Map<string, boolean>>(new Map());
  
  // Source transaction (Dari) - selected when user clicks "Pilih"
  const [sourceTransaction, setSourceTransaction] = useState<PendingTransaction | null>(null);
  const [sourceTransactionItems, setSourceTransactionItems] = useState<TransactionItem[]>([]);
  const [movedItemIds, setMovedItemIds] = useState<Set<number>>(new Set()); // Track items that have been moved
  const [movedItems, setMovedItems] = useState<TransactionItem[]>([]); // Track actual moved items with full data
  
  // Destination transaction (Ke) - selected when user clicks a transaction
  const [destinationTransaction, setDestinationTransaction] = useState<PendingTransaction | null>(null);
  const [destinationTransactionItems, setDestinationTransactionItems] = useState<TransactionItem[]>([]);
  const [expandedDestinationTransactionId, setExpandedDestinationTransactionId] = useState<string | null>(null);
  
  // New transaction creation (stored in state, not created until Save)
  const [newTransactionData, setNewTransactionData] = useState<{ tableId: number; customerName: string; tableNumber?: string } | null>(null);
  const [showTableSelection, setShowTableSelection] = useState(false);
  const [newTransactionCustomerName, setNewTransactionCustomerName] = useState('');
  const [showCustomerNameInput, setShowCustomerNameInput] = useState(false);
  const [rooms, setRooms] = useState<Array<{ id: number; name: string; business_id: number; canvas_width?: number | null; canvas_height?: number | null; font_size_multiplier?: number | null }>>([]);
  const [selectedRoom, setSelectedRoom] = useState<number | null>(null);
  const [tables, setTables] = useState<Array<{ id: number; room_id: number; table_number: string; position_x: number | string; position_y: number | string; width: number | string; height: number | string; capacity: number; shape: 'circle' | 'rectangle' }>>([]);
  const [layoutElements, setLayoutElements] = useState<Array<{ id: number; room_id: number; label: string; position_x: number | string; position_y: number | string; width: number | string; height: number | string; element_type: string; color: string; text_color: string }>>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [pendingTransactionsForTables, setPendingTransactionsForTables] = useState<Array<{ id: string; table_id: number; status: string; created_at: string }>>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (isOpen) {
      fetchPendingTransactions();
    } else {
      // Reset state when modal closes
      setExpandedTransactionId(null);
      setTransactionItemsMap(new Map());
      setLoadingItemsMap(new Map());
      setSourceTransaction(null);
      setSourceTransactionItems([]);
      setMovedItemIds(new Set());
      setMovedItems([]);
      setDestinationTransaction(null);
      setDestinationTransactionItems([]);
      setExpandedDestinationTransactionId(null);
      setNewTransactionData(null);
    }
  }, [isOpen, businessId]);

  const fetchPendingTransactions = async () => {
    try {
      setLoadingTransactions(true);
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetTransactions) {
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

      // Filter for pending transactions and map to our format
      const pending = transactionsArray
        .filter((tx: unknown) => {
          if (tx && typeof tx === 'object' && 'status' in tx) {
            const transaction = tx as { status: string };
            return transaction.status === 'pending';
          }
          return false;
        })
        .map((tx: unknown) => {
          const t = tx as {
            id?: string;
            uuid_id?: string;
            table_id?: number | null;
            customer_name?: string | null;
            waiter_id?: number | null;
            total_amount?: number;
            final_amount?: number;
            created_at?: string;
          };
          const txId = t.uuid_id || t.id || '';
          const tableId = t.table_id || null;
          const tableInfo = tableId && tablesMap.has(tableId) ? tablesMap.get(tableId)! : null;
          const tableNumber = tableInfo ? tableInfo.table_number : null;
          const roomId = tableInfo ? tableInfo.room_id : null;
          const roomName = roomId && roomsMap.has(roomId) ? roomsMap.get(roomId)! : null;

          // Format: "table_name/room_name" or "Take-away" if no table
          const tableRoomDisplay = tableId && tableNumber && roomName
            ? `${tableNumber}/${roomName}`
            : 'Take-away';

          // Get waiter name
          const waiterId = typeof t.waiter_id === 'number' ? t.waiter_id : (typeof t.waiter_id === 'string' ? parseInt(t.waiter_id, 10) : null);
          const waiterName = waiterId && employeesMap.has(waiterId) ? employeesMap.get(waiterId)! : null;

          return {
            id: txId,
            uuid_id: txId,
            table_id: tableId,
            customer_name: t.customer_name || null,
            total_amount: t.total_amount || 0,
            final_amount: t.final_amount || t.total_amount || 0,
            created_at: t.created_at || new Date().toISOString(),
            table_number: tableRoomDisplay,
            room_name: roomName || undefined,
            waiter_name: waiterName,
          };
        })
        .sort((a, b) => {
          // Sort by created_at descending (newest first)
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

      setPendingTransactions(pending);
    } catch (error) {
      console.error('Error fetching pending transactions:', error);
    } finally {
      setLoadingTransactions(false);
    }
  };

  const handleTransactionClick = async (transactionId: string) => {
    // Toggle expansion
    if (expandedTransactionId === transactionId) {
      setExpandedTransactionId(null);
      return;
    }

    setExpandedTransactionId(transactionId);
    
    // If items already loaded, don't fetch again
    if (transactionItemsMap.has(transactionId)) {
      return;
    }

    // Set loading state for this transaction
    setLoadingItemsMap(prev => new Map(prev).set(transactionId, true));
    
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetTransactionItems || !electronAPI?.localDbGetAllProducts || !electronAPI?.localDbGetTransactionItemCustomizationsNormalized) {
        return;
      }

      // Fetch transaction items
      const items = await electronAPI.localDbGetTransactionItems(transactionId);
      const itemsArray = Array.isArray(items) ? items : [];

      // Filter out cancelled items
      const activeItems = (itemsArray as Record<string, unknown>[]).filter((item) => {
        const productionStatus = typeof item.production_status === 'string' ? item.production_status : null;
        return productionStatus !== 'cancelled';
      });

      // Fetch customizations
      const customizationsData = await electronAPI.localDbGetTransactionItemCustomizationsNormalized(transactionId);
      const customizations = Array.isArray(customizationsData?.customizations) ? customizationsData.customizations as Record<string, unknown>[] : [];
      const customizationOptions = customizationsData?.options || [];

      // Create a map of transaction_item_id -> customizations
      const customizationsMap = new Map<number, Array<SelectedCustomization>>();
      const itemsByIdMap = new Map<number, Record<string, unknown>>();
      
      activeItems.forEach((item: Record<string, unknown>) => {
        const id = typeof item.id === 'number' ? item.id : (typeof item.id === 'string' ? parseInt(item.id, 10) : null);
        if (id) {
          itemsByIdMap.set(id, item);
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

        const options = customizationOptions.filter((opt: Record<string, unknown>) => 
          opt.transaction_item_customization_id === cust.id
        ).map((opt: Record<string, unknown>) => {
          const priceAdj = typeof opt.price_adjustment === 'number' 
            ? opt.price_adjustment 
            : (typeof opt.price_adjustment === 'string' ? parseFloat(String(opt.price_adjustment)) || 0 : 0);
          const optionId = typeof opt.customization_option_id === 'number' 
            ? opt.customization_option_id 
            : (typeof opt.customization_option_id === 'string' ? parseInt(String(opt.customization_option_id), 10) : 0);
          const optionName = typeof opt.option_name === 'string' ? opt.option_name : String(opt.option_name || '');
          return {
            option_id: optionId,
            option_name: optionName,
            price_adjustment: priceAdj,
          };
        });

        const custTypeId = typeof cust.customization_type_id === 'number' 
          ? cust.customization_type_id 
          : (typeof cust.customization_type_id === 'string' ? parseInt(String(cust.customization_type_id), 10) : 0);
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

      // Fetch all products to get product names
      const allProducts = await electronAPI.localDbGetAllProducts();
      const productsArray = Array.isArray(allProducts) ? allProducts : [];
      const productsMap = new Map<number, { id: number; nama: string; harga_jual: number }>();
      
      (productsArray as { id?: number | string; nama?: string; harga_jual?: number }[]).forEach((p) => {
        const id = typeof p.id === 'number' ? p.id : (typeof p.id === 'string' ? parseInt(p.id, 10) : null);
        if (id && typeof p.nama === 'string') {
          productsMap.set(id, {
            id,
            nama: p.nama,
            harga_jual: typeof p.harga_jual === 'number' ? p.harga_jual : 0,
          });
        }
      });

      // Map items with product info and customizations
      const itemsWithProducts = activeItems.map((item: Record<string, unknown>) => {
        const productId = typeof item.product_id === 'number' 
          ? item.product_id 
          : (typeof item.product_id === 'string' ? parseInt(item.product_id, 10) : null);
        const product = productId ? productsMap.get(productId) : undefined;
        const itemId = typeof item.id === 'number' ? item.id : (typeof item.id === 'string' ? parseInt(item.id, 10) : null);
        const itemCustomizations = itemId ? (customizationsMap.get(itemId) || []) : [];
        
        // Get unit_price - use from database, calculate from total_price if needed, or use product harga_jual
        const quantity = typeof item.quantity === 'number' ? item.quantity : 1;
        const dbUnitPrice = typeof item.unit_price === 'number' ? item.unit_price : 0;
        const dbTotalPrice = typeof item.total_price === 'number' ? item.total_price : 0;
        
        // Calculate customization price first
        const customizationPrice = itemCustomizations.reduce((sum, customization) => {
          const optionTotal = customization.selected_options.reduce((optionSum, option) => {
            return optionSum + (option.price_adjustment || 0);
          }, 0);
          return sum + optionTotal;
        }, 0);
        
        // Determine unit_price: use DB value, or calculate from total_price, or use product price
        let unitPrice = dbUnitPrice;
        if (unitPrice === 0 || unitPrice === null) {
          if (dbTotalPrice > 0 && quantity > 0) {
            // Calculate unit price from total (subtract customization price first)
            unitPrice = (dbTotalPrice / quantity) - customizationPrice;
          } else if (product) {
            unitPrice = product.harga_jual || 0;
          }
        }
        
        // Calculate total_price with customizations
        const totalPrice = (unitPrice + customizationPrice) * quantity;

        return {
          id: itemId || 0,
          uuid_id: typeof item.uuid_id === 'string' ? item.uuid_id : '',
          product_id: productId || 0,
          quantity: quantity,
          unit_price: unitPrice,
          total_price: totalPrice,
          custom_note: typeof item.custom_note === 'string' ? item.custom_note : null,
          bundle_selections_json: typeof item.bundle_selections_json === 'string' ? item.bundle_selections_json : null,
          production_status: typeof item.production_status === 'string' ? item.production_status : null,
          product: product,
          customizations: itemCustomizations.length > 0 ? itemCustomizations : undefined,
        };
      });

      setTransactionItemsMap(prev => new Map(prev).set(transactionId, itemsWithProducts));
    } catch (error) {
      console.error('Error fetching transaction items:', error);
    } finally {
      setLoadingItemsMap(prev => {
        const newMap = new Map(prev);
        newMap.set(transactionId, false);
        return newMap;
      });
    }
  };

  const sumCustomizationPrice = (customizations?: SelectedCustomization[]) => {
    if (!customizations || customizations.length === 0) return 0;
    return customizations.reduce((sum, customization) => {
      const optionTotal = customization.selected_options.reduce((optionSum, option) => {
        return optionSum + (option.price_adjustment || 0);
      }, 0);
      return sum + optionTotal;
    }, 0);
  };

  const handlePilihTransaction = (transaction: PendingTransaction) => {
    const items = transactionItemsMap.get(transaction.uuid_id) || [];
    setSourceTransaction(transaction);
    setSourceTransactionItems(items);
    setMovedItemIds(new Set()); // Reset moved items
    setMovedItems([]); // Reset moved items array
    setExpandedTransactionId(null); // Collapse all
  };

  const handlePindahItem = (item: TransactionItem) => {
    // Check if destination transaction or new transaction is selected
    if (!destinationTransaction && !newTransactionData) {
      alert('Pilih transaksi "Ke" terlebih dahulu');
      return;
    }

    console.log('[SPLIT BILL] Moving item:', {
      itemId: item.id,
      productId: item.product_id,
      productName: item.product?.nama,
      hasProduct: !!item.product,
      quantity: item.quantity
    });

    // Mark item as moved
    setMovedItemIds(prev => new Set(prev).add(item.id));
    
    // Store the moved item with full data
    setMovedItems(prev => {
      const updated = [...prev, item];
      console.log('[SPLIT BILL] Updated movedItems:', updated.length, 'items');
      return updated;
    });
    
    // Remove item from source transaction items
    setSourceTransactionItems(prev => prev.filter(i => i.id !== item.id));
    
    // Add item to destination transaction items
    setDestinationTransactionItems(prev => [...prev, item]);
  };

  const handleReset = () => {
    setSourceTransaction(null);
    setSourceTransactionItems([]);
    setMovedItemIds(new Set());
    setMovedItems([]);
    setExpandedTransactionId(null);
    setDestinationTransaction(null);
    setDestinationTransactionItems([]);
    setExpandedDestinationTransactionId(null);
    setNewTransactionData(null);
  };

  const handleDestinationTransactionClick = async (transactionId: string) => {
    // Don't allow selecting the same transaction as source
    if (sourceTransaction && sourceTransaction.uuid_id === transactionId) {
      return;
    }

    // Toggle expansion
    if (expandedDestinationTransactionId === transactionId) {
      setExpandedDestinationTransactionId(null);
      return;
    }

    setExpandedDestinationTransactionId(transactionId);
    
    // If items already loaded in transactionItemsMap, don't fetch again
    if (transactionItemsMap.has(transactionId)) {
      return;
    }

    // Set loading state for this transaction
    setLoadingItemsMap(prev => new Map(prev).set(transactionId, true));
    
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetTransactionItems || !electronAPI?.localDbGetAllProducts || !electronAPI?.localDbGetTransactionItemCustomizationsNormalized) {
        return;
      }

      // Fetch transaction items
      const items = await electronAPI.localDbGetTransactionItems(transactionId);
      const itemsArray = Array.isArray(items) ? items : [];

      // Filter out cancelled items
      const activeItems = (itemsArray as Record<string, unknown>[]).filter((item) => {
        const productionStatus = typeof item.production_status === 'string' ? item.production_status : null;
        return productionStatus !== 'cancelled';
      });

      // Fetch customizations
      const customizationsData = await electronAPI.localDbGetTransactionItemCustomizationsNormalized(transactionId);
      const customizations = Array.isArray(customizationsData?.customizations) ? customizationsData.customizations as Record<string, unknown>[] : [];
      const customizationOptions = customizationsData?.options || [];

      // Create a map of transaction_item_id -> customizations
      const customizationsMap = new Map<number, Array<SelectedCustomization>>();
      const itemsByIdMap = new Map<number, Record<string, unknown>>();
      
      activeItems.forEach((item: Record<string, unknown>) => {
        const id = typeof item.id === 'number' ? item.id : (typeof item.id === 'string' ? parseInt(item.id, 10) : null);
        if (id) {
          itemsByIdMap.set(id, item);
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

        const options = customizationOptions.filter((opt: Record<string, unknown>) => 
          opt.transaction_item_customization_id === cust.id
        ).map((opt: Record<string, unknown>) => {
          const priceAdj = typeof opt.price_adjustment === 'number' 
            ? opt.price_adjustment 
            : (typeof opt.price_adjustment === 'string' ? parseFloat(String(opt.price_adjustment)) || 0 : 0);
          const optionId = typeof opt.customization_option_id === 'number' 
            ? opt.customization_option_id 
            : (typeof opt.customization_option_id === 'string' ? parseInt(String(opt.customization_option_id), 10) : 0);
          const optionName = typeof opt.option_name === 'string' ? opt.option_name : String(opt.option_name || '');
          return {
            option_id: optionId,
            option_name: optionName,
            price_adjustment: priceAdj,
          };
        });

        const custTypeId = typeof cust.customization_type_id === 'number' 
          ? cust.customization_type_id 
          : (typeof cust.customization_type_id === 'string' ? parseInt(String(cust.customization_type_id), 10) : 0);
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

      // Fetch all products to get product names
      const allProducts = await electronAPI.localDbGetAllProducts();
      const productsArray = Array.isArray(allProducts) ? allProducts : [];
      const productsMap = new Map<number, { id: number; nama: string; harga_jual: number }>();
      
      (productsArray as { id?: number | string; nama?: string; harga_jual?: number }[]).forEach((p) => {
        const id = typeof p.id === 'number' ? p.id : (typeof p.id === 'string' ? parseInt(p.id, 10) : null);
        if (id && typeof p.nama === 'string') {
          productsMap.set(id, {
            id,
            nama: p.nama,
            harga_jual: typeof p.harga_jual === 'number' ? p.harga_jual : 0,
          });
        }
      });

      // Map items with product info and customizations
      const itemsWithProducts = activeItems.map((item: Record<string, unknown>) => {
        const productId = typeof item.product_id === 'number' 
          ? item.product_id 
          : (typeof item.product_id === 'string' ? parseInt(item.product_id, 10) : null);
        const product = productId ? productsMap.get(productId) : undefined;
        const itemId = typeof item.id === 'number' ? item.id : (typeof item.id === 'string' ? parseInt(item.id, 10) : null);
        const itemCustomizations = itemId ? (customizationsMap.get(itemId) || []) : [];
        
        // Get unit_price - use from database, calculate from total_price if needed, or use product harga_jual
        const quantity = typeof item.quantity === 'number' ? item.quantity : 1;
        const dbUnitPrice = typeof item.unit_price === 'number' ? item.unit_price : 0;
        const dbTotalPrice = typeof item.total_price === 'number' ? item.total_price : 0;
        
        // Calculate customization price first
        const customizationPrice = itemCustomizations.reduce((sum, customization) => {
          const optionTotal = customization.selected_options.reduce((optionSum, option) => {
            return optionSum + (option.price_adjustment || 0);
          }, 0);
          return sum + optionTotal;
        }, 0);
        
        // Determine unit_price: use DB value, or calculate from total_price, or use product price
        let unitPrice = dbUnitPrice;
        if (unitPrice === 0 || unitPrice === null) {
          if (dbTotalPrice > 0 && quantity > 0) {
            // Calculate unit price from total (subtract customization price first)
            unitPrice = (dbTotalPrice / quantity) - customizationPrice;
          } else if (product) {
            unitPrice = product.harga_jual || 0;
          }
        }
        
        // Calculate total_price with customizations
        const totalPrice = (unitPrice + customizationPrice) * quantity;

        return {
          id: itemId || 0,
          uuid_id: typeof item.uuid_id === 'string' ? item.uuid_id : '',
          product_id: productId || 0,
          quantity: quantity,
          unit_price: unitPrice,
          total_price: totalPrice,
          custom_note: typeof item.custom_note === 'string' ? item.custom_note : null,
          bundle_selections_json: typeof item.bundle_selections_json === 'string' ? item.bundle_selections_json : null,
          production_status: typeof item.production_status === 'string' ? item.production_status : null,
          product: product,
          customizations: itemCustomizations.length > 0 ? itemCustomizations : undefined,
        };
      });

      // Store items in transactionItemsMap for reuse
      setTransactionItemsMap(prev => new Map(prev).set(transactionId, itemsWithProducts));
    } catch (error) {
      console.error('Error fetching destination transaction items:', error);
    } finally {
      setLoadingItemsMap(prev => {
        const newMap = new Map(prev);
        newMap.set(transactionId, false);
        return newMap;
      });
    }
  };

  const formatPrice = (price: number): string => {
    const roundedPrice = Math.round(price);
    return `Rp ${roundedPrice.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const createEmptyTransaction = async (tableId: number, customerName: string = '') => {
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI) {
        throw new Error('Electron API not available');
      }

      // Generate transaction ID
      let transactionId = '';
      if (window.electronAPI?.generateNumericUuid) {
        const uuidResult = await window.electronAPI.generateNumericUuid(businessId);
        if (uuidResult?.success && uuidResult?.uuid) {
          transactionId = uuidResult.uuid;
        } else {
          transactionId = generateTransactionId();
        }
      } else {
        transactionId = generateTransactionId();
      }

      // Get payment method ID (cash)
      let paymentMethodId = 1;
      try {
        const paymentMethods = await electronAPI.localDbGetPaymentMethods?.();
        if (Array.isArray(paymentMethods)) {
          const paymentMethod = (paymentMethods as Array<{ id: number; code: string }>).find(
            (pm) => pm.code === 'cash'
          );
          if (paymentMethod) {
            paymentMethodId = paymentMethod.id;
          }
        }
      } catch (error) {
        console.error('Failed to get payment methods:', error);
      }

      // Create empty transaction
      const transactionData = {
        uuid_id: transactionId,
        id: transactionId,
        business_id: businessId,
        user_id: user?.id ? parseInt(String(user.id)) : 1,
        waiter_id: null,
        payment_method: 'cash',
        pickup_method: 'dine-in' as const,
        total_amount: 0,
        voucher_discount: 0,
        voucher_type: 'none' as const,
        voucher_value: null,
        voucher_label: null,
        final_amount: 0,
        amount_received: 0,
        change_amount: 0,
        status: 'pending' as const,
        sync_status: 'pending' as const,
        created_at: new Date().toISOString(),
        note: null,
        bank_name: null,
        contact_id: null,
        customer_name: customerName.trim() || null,
        customer_unit: null,
        bank_id: null,
        card_number: null,
        cl_account_id: null,
        cl_account_name: null,
        transaction_type: 'drinks' as const,
        payment_method_id: paymentMethodId,
        table_id: tableId,
        receipt_number: null,
      };

      await electronAPI.localDbUpsertTransactions?.([transactionData]);
      
      // Refresh pending transactions
      await fetchPendingTransactions();
      
      // Find and set the newly created transaction as destination
      const allTransactions = await electronAPI.localDbGetTransactions?.(businessId, 10000);
      const transactionsArray = Array.isArray(allTransactions) ? allTransactions : [];
      const newTransaction = (transactionsArray as PendingTransaction[]).find((tx) => 
        tx.uuid_id === transactionId || tx.id === transactionId
      );

      if (newTransaction) {
        setDestinationTransaction(newTransaction);
        setDestinationTransactionItems([]);
        setExpandedDestinationTransactionId(null);
      }

      setShowTableSelection(false);
      setShowCustomerNameInput(false);
      setNewTransactionCustomerName('');
      
      return { success: true, transactionId };
    } catch (error) {
      console.error('Error creating empty transaction:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const fetchRoomsForNewTransaction = async () => {
    try {
      setLoadingTables(true);
      const electronAPI = getElectronAPI();
      if (!electronAPI?.getRestaurantRooms) {
        return;
      }
      const roomsData = await electronAPI.getRestaurantRooms(businessId);
      const roomsArray = Array.isArray(roomsData) ? roomsData : [];
      setRooms(roomsArray);
      if (roomsArray.length > 0 && selectedRoom === null) {
        setSelectedRoom(roomsArray[0].id);
      }
      // Also fetch pending transactions to check table occupancy
      await fetchPendingTransactionsForTables();
    } catch (error) {
      console.error('Error fetching rooms:', error);
    } finally {
      setLoadingTables(false);
    }
  };

  const fetchPendingTransactionsForTables = async () => {
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetTransactions) {
        return;
      }

      const allTransactions = await electronAPI.localDbGetTransactions(businessId, 10000);
      const pending = (Array.isArray(allTransactions) ? allTransactions : [])
        .filter((tx: unknown) => {
          if (tx && typeof tx === 'object' && 'status' in tx && 'table_id' in tx) {
            const transaction = tx as { status: string; table_id: number | null; uuid_id?: string; id?: string };
            const isPending = transaction.status === 'pending' && transaction.table_id !== null;
            return isPending;
          }
          return false;
        })
        .map((tx: unknown) => {
          const t = tx as { id?: string; uuid_id?: string; table_id: number; status: string; created_at?: string };
          const txId = t.uuid_id || t.id || '';
          return {
            id: txId,
            table_id: t.table_id,
            status: t.status,
            created_at: t.created_at || new Date().toISOString(),
          };
        });
      setPendingTransactionsForTables(pending);
    } catch (error) {
      console.error('Error fetching pending transactions:', error);
    }
  };

  const checkTableHasPendingOrder = (tableId: number): boolean => {
    return pendingTransactionsForTables.some(tx => tx.table_id === tableId);
  };

  const fetchTablesForNewTransaction = async (roomId: number) => {
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.getRestaurantTables) {
        return;
      }
      const tablesData = await electronAPI.getRestaurantTables(roomId);
      const tablesArray = Array.isArray(tablesData) ? tablesData : [];
      setTables(tablesArray);
    } catch (error) {
      console.error('Error fetching tables:', error);
    }
  };

  const fetchLayoutElementsForNewTransaction = async (roomId: number) => {
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.getRestaurantLayoutElements) {
        return;
      }
      const elementsData = await electronAPI.getRestaurantLayoutElements(roomId);
      setLayoutElements(Array.isArray(elementsData) ? elementsData : []);
    } catch (error) {
      console.error('Error fetching layout elements:', error);
    }
  };

  // Update canvas size when room is selected
  useEffect(() => {
    const updateCanvasSize = () => {
      if (canvasRef.current && canvasContainerRef.current && selectedRoom) {
        const selectedRoomData = rooms.find(r => r.id === selectedRoom);
        let width: number;
        let height: number;

        if (selectedRoomData?.canvas_width && selectedRoomData?.canvas_height) {
          width = selectedRoomData.canvas_width;
          height = selectedRoomData.canvas_height;
        } else {
          const containerWidth = canvasContainerRef.current.clientWidth;
          width = containerWidth;
          height = (containerWidth / 16) * 9;
        }

        setCanvasSize(prev => {
          if (prev.width !== width || prev.height !== height) {
            return { width, height };
          }
          return prev;
        });
      }
    };

    if (canvasRef.current && canvasContainerRef.current && showTableSelection && selectedRoom) {
      updateCanvasSize();

      const resizeObserver = new ResizeObserver(() => {
        updateCanvasSize();
      });

      resizeObserver.observe(canvasContainerRef.current);

      window.addEventListener('resize', updateCanvasSize);

      return () => {
        if (canvasContainerRef.current) {
          resizeObserver.unobserve(canvasContainerRef.current);
        }
        window.removeEventListener('resize', updateCanvasSize);
      };
    }
  }, [selectedRoom, showTableSelection, rooms]);

  useEffect(() => {
    if (showTableSelection) {
      fetchRoomsForNewTransaction();
    }
  }, [showTableSelection, businessId]);

  // Refresh pending transactions when room changes to update occupancy
  useEffect(() => {
    if (selectedRoom && showTableSelection) {
      fetchPendingTransactionsForTables();
    }
  }, [selectedRoom, showTableSelection]);

  useEffect(() => {
    if (selectedRoom && showTableSelection) {
      fetchTablesForNewTransaction(selectedRoom);
      fetchLayoutElementsForNewTransaction(selectedRoom);
    }
  }, [selectedRoom, showTableSelection]);

  const handleTableClickForNewTransaction = (tableId: number) => {
    // Check if table has pending order
    if (checkTableHasPendingOrder(tableId)) {
      const table = tables.find(t => t.id === tableId);
      alert(`Meja ${table?.table_number || tableId} sudah memiliki pesanan aktif. Silakan pilih meja lain.`);
      return;
    }

    // Store new transaction data in state (don't create transaction yet)
    const table = tables.find(t => t.id === tableId);
    setNewTransactionData({
      tableId,
      customerName: newTransactionCustomerName.trim(),
      tableNumber: table?.table_number,
    });
    
    // Clear existing destination transaction if any
    setDestinationTransaction(null);
    setDestinationTransactionItems([]);
    setExpandedDestinationTransactionId(null);
    
    // Close table selection modal
    setShowTableSelection(false);
    setShowCustomerNameInput(false);
    setNewTransactionCustomerName('');
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={(e) => {
        // Close modal when clicking backdrop
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        className="bg-white rounded-lg shadow-xl w-[90vw] h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center gap-3">
            <div className="w-1 h-8 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full"></div>
            <h2 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              Split Bill
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/60 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-700" />
          </button>
        </div>

        {/* Content - 2 Columns */}
        <div className="flex-1 flex overflow-hidden">
          {/* Column 1: Dari (From) */}
          <div className="w-1/2 border-r flex flex-col">
            <div className="p-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">
                {sourceTransaction ? (
                  <>
                    <span className="text-blue-600">Dari</span> ({sourceTransaction.customer_name || sourceTransaction.table_number || 'Tanpa nama'})
                  </>
                ) : (
                  <span className="text-blue-600">Dari</span>
                )}
              </h3>
              {sourceTransaction && (
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {sourceTransaction ? (
                // Show items from selected transaction with checkboxes
                sourceTransactionItems.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-gray-500">
                      <p>Tidak ada item dalam transaksi ini</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sourceTransactionItems.map((item) => {
                      const customizationPrice = sumCustomizationPrice(item.customizations);
                      const itemPrice = item.unit_price + customizationPrice;
                      const itemTotal = itemPrice * item.quantity;
                      const isMoved = movedItemIds.has(item.id);
                      
                      return (
                        <div
                          key={item.id}
                          className={`p-4 rounded-xl border-2 transition-all duration-200 shadow-sm ${
                            isMoved
                              ? 'border-gray-200 bg-gray-100 opacity-50'
                              : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-gradient-to-br hover:from-blue-50/50 hover:to-indigo-50/50 hover:shadow-md'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex-1">
                              <div className="font-medium text-sm text-gray-900">
                                {item.product?.nama || `Product ${item.product_id}`}
                              </div>
                              <div className="text-xs text-gray-600 mt-1">
                                {item.quantity}x {formatPrice(item.unit_price)}
                              </div>

                              {/* Customizations */}
                              {item.customizations && item.customizations.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {item.customizations.map((customization) => (
                                    <div key={customization.customization_id} className="text-xs">
                                      <span className="text-gray-500">{customization.customization_name}:</span>
                                      <div className="ml-2 space-y-0.5">
                                        {customization.selected_options && customization.selected_options.length > 0 && (
                                          customization.selected_options.map((option) => (
                                            <div key={option.option_id} className="flex items-center justify-between">
                                              <span className="text-gray-600">� {option.option_name}</span>
                                              {option.price_adjustment !== 0 && (
                                                <span className={`text-xs ${option.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                  {option.price_adjustment > 0 ? '+' : ''}{formatPrice(option.price_adjustment)}
                                                </span>
                                              )}
                                            </div>
                                          ))
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Custom Note */}
                              {item.custom_note && (
                                <div className="mt-1">
                                  <div className="text-xs">
                                    <span className="text-gray-500">Note:</span>
                                    <span className="text-gray-700 ml-1 italic">&ldquo;{item.custom_note}&rdquo;</span>
                                  </div>
                                </div>
                              )}

                              {/* Bundle Selections */}
                              {item.bundle_selections_json && (
                                <div className="mt-2 text-xs text-gray-500">
                                  Bundle item (lihat detail)
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <div className={`font-bold text-base px-3 py-1.5 rounded-lg ${
                                isMoved 
                                  ? 'bg-gray-300 text-gray-600' 
                                  : 'bg-gray-100 text-gray-900'
                              }`}>
                                {formatPrice(itemTotal)}
                              </div>
                              {!isMoved && (
                                <button
                                  onClick={() => handlePindahItem(item)}
                                  disabled={!destinationTransaction && !newTransactionData}
                                  className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all shadow-xl hover:shadow-2xl transform hover:scale-[1.02] ${(destinationTransaction || newTransactionData) ? 'bg-blue-500 hover:bg-blue-600 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
                                >
                                  Pindah
                                </button>
                              )}
                              {isMoved && (
                                <span className="text-xs text-gray-500 italic">Dipindah</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                // Show list of transactions
                loadingTransactions ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-gray-600">Memuat transaksi...</div>
                  </div>
                ) : pendingTransactions.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-gray-500">
                      <p>Tidak ada pesanan aktif</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingTransactions.map((transaction) => {
                      const displayName = transaction.customer_name || transaction.table_number || 'Tanpa nama';
                      const isExpanded = expandedTransactionId === transaction.uuid_id;
                      const items = transactionItemsMap.get(transaction.uuid_id) || [];
                      const isLoading = loadingItemsMap.get(transaction.uuid_id) || false;
                      const itemCount = items.length;
                      const hasLoadedItems = transactionItemsMap.has(transaction.uuid_id);
                      
                      // All cards use blue color scheme
                      const colorVariant = { 
                        bg: 'bg-gradient-to-br from-blue-50 to-indigo-50', 
                        border: 'border-blue-300', 
                        hover: 'hover:from-blue-100 hover:to-indigo-100', 
                        accent: 'bg-blue-500' 
                      };
                      
                      return (
                        <div
                          key={transaction.uuid_id}
                          className={`rounded-xl border-2 ${colorVariant.border} ${colorVariant.bg} overflow-hidden transition-all duration-200 shadow-md hover:shadow-lg ${isExpanded ? 'shadow-xl' : ''}`}
                        >
                          {/* Transaction Header - Clickable */}
                          <div
                            onClick={() => handleTransactionClick(transaction.uuid_id)}
                            className={`p-4 cursor-pointer transition-all duration-200 ${colorVariant.hover} ${isExpanded ? colorVariant.hover : ''}`}
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <div className={`w-1 h-8 ${colorVariant.accent} rounded-full`}></div>
                                  <div>
                                    <div className="font-semibold text-gray-900 text-base">
                                      {displayName}
                                      {hasLoadedItems && itemCount > 0 && (
                                        <span className="ml-2 px-2 py-0.5 bg-white/70 rounded-full text-xs font-medium text-gray-700">
                                          {itemCount} item{itemCount > 1 ? 's' : ''}
                                        </span>
                                      )}
                                    </div>
                                    {transaction.table_number && transaction.customer_name && (
                                      <div className="text-sm text-gray-600 mt-1 font-medium">{transaction.table_number}</div>
                                    )}
                                  </div>
                                  {isExpanded ? (
                                    <ChevronUp className="w-5 h-5 text-gray-600 flex-shrink-0" />
                                  ) : (
                                    <ChevronDown className="w-5 h-5 text-gray-600 flex-shrink-0" />
                                  )}
                                </div>
                              </div>
                              <div className="text-right ml-4">
                                <div className={`px-3 py-1.5 ${colorVariant.accent} text-white font-bold text-lg shadow-sm`}>
                                  {formatPrice(transaction.final_amount)}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Expanded Items Section */}
                          {isExpanded && (
                            <div className="border-t-2 border-white/50 bg-white/40 backdrop-blur-sm">
                              {isLoading ? (
                                <div className="p-4 text-center text-gray-600">
                                  Memuat item...
                                </div>
                              ) : items.length === 0 ? (
                                <div className="p-4 text-center text-gray-500">
                                  Tidak ada item dalam transaksi ini
                                </div>
                              ) : (
                                <div className="p-4 space-y-3">
                                  {items.map((item) => {
                                    const customizationPrice = sumCustomizationPrice(item.customizations);
                                    const itemPrice = item.unit_price + customizationPrice;
                                    const itemTotal = itemPrice * item.quantity;
                                    
                                    return (
                                      <div
                                        key={item.id}
                                        className="p-3 rounded-lg border border-white/60 bg-white/90 backdrop-blur-sm shadow-sm hover:shadow-md transition-all hover:bg-white"
                                      >
                                        <div className="flex justify-between items-start">
                                          <div className="flex-1">
                                            <div className="font-semibold text-sm text-gray-900">
                                              {item.product?.nama || `Product ${item.product_id}`}
                                            </div>
                                            <div className="text-xs text-gray-600 mt-1 font-medium">
                                              {item.quantity}x {formatPrice(item.unit_price)}
                                            </div>

                                            {/* Customizations */}
                                            {item.customizations && item.customizations.length > 0 && (
                                              <div className="mt-2 space-y-1">
                                                {item.customizations.map((customization) => (
                                                  <div key={customization.customization_id} className="text-xs">
                                                    <span className="text-gray-500">{customization.customization_name}:</span>
                                                    <div className="ml-2 space-y-0.5">
                                                      {customization.selected_options && customization.selected_options.length > 0 && (
                                                        customization.selected_options.map((option) => (
                                                          <div key={option.option_id} className="flex items-center justify-between">
                                                            <span className="text-gray-600">� {option.option_name}</span>
                                                            {option.price_adjustment !== 0 && (
                                                              <span className={`text-xs ${option.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                                {option.price_adjustment > 0 ? '+' : ''}{formatPrice(option.price_adjustment)}
                                                              </span>
                                                            )}
                                                          </div>
                                                        ))
                                                      )}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            )}

                                            {/* Custom Note */}
                                            {item.custom_note && (
                                              <div className="mt-1">
                                                <div className="text-xs">
                                                  <span className="text-gray-500">Note:</span>
                                                  <span className="text-gray-700 ml-1 italic">&ldquo;{item.custom_note}&rdquo;</span>
                                                </div>
                                              </div>
                                            )}

                                            {/* Bundle Selections */}
                                            {item.bundle_selections_json && (
                                              <div className="mt-2 text-xs text-gray-500">
                                                Bundle item (lihat detail)
                                              </div>
                                            )}
                                          </div>
                                          <div className="text-right ml-4">
                                            <div className="font-bold text-sm px-2 py-1 bg-white/80 rounded text-gray-900 shadow-sm">
                                              {formatPrice(itemTotal)}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  
                                  {/* Pilih Button */}
                                  <div className="pt-3 border-t-2 border-white/50">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handlePilihTransaction(transaction);
                                      }}
                                      className={`w-full px-4 py-3 ${colorVariant.accent} hover:opacity-90 text-white rounded-lg font-semibold transition-all shadow-xl hover:shadow-2xl transform hover:scale-[1.02]`}
                                    >
                                      Pilih
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          </div>

          {/* Column 2: Ke (To) */}
          <div className="w-1/2 flex flex-col">
            <div className="p-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">
                {newTransactionData ? (
                  <>
                    <span className="text-blue-600">Ke</span> (Meja {newTransactionData.tableNumber || newTransactionData.tableId} - Baru)
                  </>
                ) : destinationTransaction ? (
                  <>
                    <span className="text-blue-600">Ke</span> ({destinationTransaction.customer_name || destinationTransaction.table_number || 'Tanpa nama'})
                  </>
                ) : (
                  <span className="text-blue-600">Ke</span>
                )}
              </h3>
              {(destinationTransaction || newTransactionData) && (
                <button
                  onClick={() => {
                    setDestinationTransaction(null);
                    setDestinationTransactionItems([]);
                    setExpandedDestinationTransactionId(null);
                    setNewTransactionData(null);
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {!sourceTransaction ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-gray-500">
                    <p>Pilih transaksi &quot;Dari&quot; terlebih dahulu</p>
                  </div>
                </div>
              ) : newTransactionData ? (
                // Show items that will be moved to new transaction
                destinationTransactionItems.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-gray-500">
                      <p>Belum ada item yang dipindahkan</p>
                      <p className="text-sm mt-2">Gunakan tombol &quot;Pindah&quot; pada item di kolom &quot;Dari&quot;</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {destinationTransactionItems.map((item) => {
                      const customizationPrice = sumCustomizationPrice(item.customizations);
                      const itemPrice = item.unit_price + customizationPrice;
                      const itemTotal = itemPrice * item.quantity;
                      
                      return (
                        <div
                          key={item.id}
                          className="p-4 rounded-xl border-2 border-gray-200 bg-white shadow-sm"
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="font-semibold text-sm text-gray-900">
                                {item.product?.nama || `Product ${item.product_id}`}
                              </div>
                              <div className="text-xs text-gray-600 mt-1 font-medium">
                                {item.quantity}x {formatPrice(item.unit_price)}
                              </div>

                              {/* Customizations */}
                              {item.customizations && item.customizations.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {item.customizations.map((customization) => (
                                    <div key={customization.customization_id} className="text-xs">
                                      <span className="text-gray-500">{customization.customization_name}:</span>
                                      <div className="ml-2 space-y-0.5">
                                        {customization.selected_options && customization.selected_options.length > 0 && (
                                          customization.selected_options.map((option) => (
                                            <div key={option.option_id} className="flex items-center justify-between">
                                              <span className="text-gray-600">� {option.option_name}</span>
                                              {option.price_adjustment !== 0 && (
                                                <span className={`text-xs ${option.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                  {option.price_adjustment > 0 ? '+' : ''}{formatPrice(option.price_adjustment)}
                                                </span>
                                              )}
                                            </div>
                                          ))
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Custom Note */}
                              {item.custom_note && (
                                <div className="mt-1">
                                  <div className="text-xs">
                                    <span className="text-gray-500">Note:</span>
                                    <span className="text-gray-700 ml-1 italic">&ldquo;{item.custom_note}&rdquo;</span>
                                  </div>
                                </div>
                              )}

                              {/* Bundle Selections */}
                              {item.bundle_selections_json && (
                                <div className="mt-2 text-xs text-gray-500">
                                  Bundle item (lihat detail)
                                </div>
                              )}
                            </div>
                            <div className="text-right ml-4">
                              <div className="font-bold text-sm px-2 py-1 bg-gray-100 rounded text-gray-900 shadow-sm">
                                {formatPrice(itemTotal)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : destinationTransaction ? (
                // Show items from selected destination transaction
                destinationTransactionItems.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-gray-500">
                      <p>Tidak ada item dalam transaksi ini</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {destinationTransactionItems.map((item) => {
                      const customizationPrice = sumCustomizationPrice(item.customizations);
                      const itemPrice = item.unit_price + customizationPrice;
                      const itemTotal = itemPrice * item.quantity;
                      
                      return (
                        <div
                          key={item.id}
                          className="p-4 rounded-xl border-2 border-gray-200 bg-white shadow-sm"
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="font-semibold text-sm text-gray-900">
                                {item.product?.nama || `Product ${item.product_id}`}
                              </div>
                              <div className="text-xs text-gray-600 mt-1 font-medium">
                                {item.quantity}x {formatPrice(item.unit_price)}
                              </div>

                              {/* Customizations */}
                              {item.customizations && item.customizations.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {item.customizations.map((customization) => (
                                    <div key={customization.customization_id} className="text-xs">
                                      <span className="text-gray-500">{customization.customization_name}:</span>
                                      <div className="ml-2 space-y-0.5">
                                        {customization.selected_options && customization.selected_options.length > 0 && (
                                          customization.selected_options.map((option) => (
                                            <div key={option.option_id} className="flex items-center justify-between">
                                              <span className="text-gray-600">� {option.option_name}</span>
                                              {option.price_adjustment !== 0 && (
                                                <span className={`text-xs ${option.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                  {option.price_adjustment > 0 ? '+' : ''}{formatPrice(option.price_adjustment)}
                                                </span>
                                              )}
                                            </div>
                                          ))
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Custom Note */}
                              {item.custom_note && (
                                <div className="mt-1">
                                  <div className="text-xs">
                                    <span className="text-gray-500">Note:</span>
                                    <span className="text-gray-700 ml-1 italic">&ldquo;{item.custom_note}&rdquo;</span>
                                  </div>
                                </div>
                              )}

                              {/* Bundle Selections */}
                              {item.bundle_selections_json && (
                                <div className="mt-2 text-xs text-gray-500">
                                  Bundle item (lihat detail)
                                </div>
                              )}
                            </div>
                            <div className="text-right ml-4">
                              <div className="font-bold text-sm px-2 py-1 bg-gray-100 rounded text-gray-900 shadow-sm">
                                {formatPrice(itemTotal)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                // Show list of transactions (excluding source transaction) or "New Transaction" button
                <>
                  {/* New Transaction Button */}
                  <div className="mb-4 space-y-3">
                    {!showCustomerNameInput ? (
                      <button
                        onClick={() => setShowCustomerNameInput(true)}
                        className="w-full px-4 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold transition-all shadow-xl hover:shadow-2xl transform hover:scale-[1.02] flex items-center justify-center gap-2"
                      >
                        <Plus className="w-5 h-5" />
                        Transaksi Baru
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder="Nama Pelanggan (opsional)"
                          value={newTransactionCustomerName}
                          onChange={(e) => setNewTransactionCustomerName(e.target.value)}
                          className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-gray-900 placeholder:text-gray-500"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              setShowTableSelection(true);
                            }
                          }}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => setShowTableSelection(true)}
                            className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold transition-all shadow-lg hover:shadow-xl"
                          >
                            Pilih Meja
                          </button>
                          <button
                            onClick={() => {
                              setShowCustomerNameInput(false);
                              setNewTransactionCustomerName('');
                            }}
                            className="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-lg font-semibold transition-all"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Transactions List */}
                  {loadingTransactions ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-gray-600">Memuat transaksi...</div>
                    </div>
                  ) : pendingTransactions.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center text-gray-500">
                        <p>Tidak ada pesanan aktif</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                    {pendingTransactions.map((transaction) => {
                      const displayName = transaction.customer_name || transaction.table_number || 'Tanpa nama';
                      const isExpanded = expandedDestinationTransactionId === transaction.uuid_id;
                      const isDisabled = sourceTransaction?.uuid_id === transaction.uuid_id;
                      const items = transactionItemsMap.get(transaction.uuid_id) || [];
                      const isLoading = loadingItemsMap.get(transaction.uuid_id) || false;
                      const itemCount = items.length;
                      const hasLoadedItems = transactionItemsMap.has(transaction.uuid_id);
                      
                      // All cards use blue color scheme
                      const colorVariant = { 
                        bg: 'bg-gradient-to-br from-blue-50 to-indigo-50', 
                        border: 'border-blue-300', 
                        hover: 'hover:from-blue-100 hover:to-indigo-100', 
                        accent: 'bg-blue-500' 
                      };
                      
                      return (
                        <div
                          key={transaction.uuid_id}
                          className={`rounded-xl border-2 ${colorVariant.border} ${colorVariant.bg} overflow-hidden transition-all duration-200 shadow-md hover:shadow-lg ${isExpanded ? 'shadow-xl' : ''} ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          {/* Transaction Header - Clickable */}
                          <div
                            onClick={() => !isDisabled && handleDestinationTransactionClick(transaction.uuid_id)}
                            className={`p-4 transition-all duration-200 ${colorVariant.hover} ${isExpanded ? colorVariant.hover : ''} ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <div className={`w-1 h-8 ${colorVariant.accent} rounded-full`}></div>
                                  <div>
                                    <div className="font-semibold text-gray-900 text-base">
                                      {displayName}
                                      {isDisabled && (
                                        <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                                          (Dari)
                                        </span>
                                      )}
                                      {hasLoadedItems && itemCount > 0 && !isDisabled && (
                                        <span className="ml-2 px-2 py-0.5 bg-white/70 rounded-full text-xs font-medium text-gray-700">
                                          {itemCount} item{itemCount > 1 ? 's' : ''}
                                        </span>
                                      )}
                                    </div>
                                    {transaction.table_number && transaction.customer_name && (
                                      <div className="text-sm text-gray-600 mt-1 font-medium">{transaction.table_number}</div>
                                    )}
                                  </div>
                                  {!isDisabled && (
                                    isExpanded ? (
                                      <ChevronUp className="w-5 h-5 text-gray-600 flex-shrink-0" />
                                    ) : (
                                      <ChevronDown className="w-5 h-5 text-gray-600 flex-shrink-0" />
                                    )
                                  )}
                                </div>
                              </div>
                              <div className="text-right ml-4">
                                <div className={`px-3 py-1.5 ${colorVariant.accent} text-white font-bold text-lg shadow-sm`}>
                                  {formatPrice(transaction.final_amount)}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Expanded Items Section */}
                          {isExpanded && !isDisabled && (
                            <div className="border-t-2 border-white/50 bg-white/40 backdrop-blur-sm">
                              {isLoading ? (
                                <div className="p-4 text-center text-gray-600">
                                  Memuat item...
                                </div>
                              ) : items.length === 0 ? (
                                <div className="p-4 text-center text-gray-500">
                                  Tidak ada item dalam transaksi ini
                                </div>
                              ) : (
                                <div className="p-4 space-y-3">
                                  {items.map((item) => {
                                    const customizationPrice = sumCustomizationPrice(item.customizations);
                                    const itemPrice = item.unit_price + customizationPrice;
                                    const itemTotal = itemPrice * item.quantity;
                                    
                                    return (
                                      <div
                                        key={item.id}
                                        className="p-3 rounded-lg border border-white/60 bg-white/90 backdrop-blur-sm shadow-sm hover:shadow-md transition-all hover:bg-white"
                                      >
                                        <div className="flex justify-between items-start">
                                          <div className="flex-1">
                                            <div className="font-semibold text-sm text-gray-900">
                                              {item.product?.nama || `Product ${item.product_id}`}
                                            </div>
                                            <div className="text-xs text-gray-600 mt-1 font-medium">
                                              {item.quantity}x {formatPrice(item.unit_price)}
                                            </div>

                                            {/* Customizations */}
                                            {item.customizations && item.customizations.length > 0 && (
                                              <div className="mt-2 space-y-1">
                                                {item.customizations.map((customization) => (
                                                  <div key={customization.customization_id} className="text-xs">
                                                    <span className="text-gray-500">{customization.customization_name}:</span>
                                                    <div className="ml-2 space-y-0.5">
                                                      {customization.selected_options && customization.selected_options.length > 0 && (
                                                        customization.selected_options.map((option) => (
                                                          <div key={option.option_id} className="flex items-center justify-between">
                                                            <span className="text-gray-600">� {option.option_name}</span>
                                                            {option.price_adjustment !== 0 && (
                                                              <span className={`text-xs ${option.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                                {option.price_adjustment > 0 ? '+' : ''}{formatPrice(option.price_adjustment)}
                                                              </span>
                                                            )}
                                                          </div>
                                                        ))
                                                      )}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            )}

                                            {/* Custom Note */}
                                            {item.custom_note && (
                                              <div className="mt-1">
                                                <div className="text-xs">
                                                  <span className="text-gray-500">Note:</span>
                                                  <span className="text-gray-700 ml-1 italic">&ldquo;{item.custom_note}&rdquo;</span>
                                                </div>
                                              </div>
                                            )}

                                            {/* Bundle Selections */}
                                            {item.bundle_selections_json && (
                                              <div className="mt-2 text-xs text-gray-500">
                                                Bundle item (lihat detail)
                                              </div>
                                            )}
                                          </div>
                                          <div className="text-right ml-4">
                                            <div className="font-bold text-sm px-2 py-1 bg-white/80 rounded text-gray-900 shadow-sm">
                                              {formatPrice(itemTotal)}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  
                                  {/* Pilih Button */}
                                  <div className="pt-3 border-t-2 border-white/50">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const selectedTx = pendingTransactions.find(tx => tx.uuid_id === transaction.uuid_id);
                                        if (selectedTx) {
                                          // Use items from transactionItemsMap (already loaded)
                                          const txItems = transactionItemsMap.get(transaction.uuid_id) || items;
                                          setDestinationTransaction(selectedTx);
                                          setDestinationTransactionItems(txItems);
                                          setExpandedDestinationTransactionId(null);
                                          // Clear new transaction data when selecting existing transaction
                                          setNewTransactionData(null);
                                        }
                                      }}
                                      className={`w-full px-4 py-3 ${colorVariant.accent} hover:opacity-90 text-white rounded-lg font-semibold transition-all shadow-xl hover:shadow-2xl transform hover:scale-[1.02]`}
                                    >
                                      Pilih
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer with Save Button */}
        <div className="border-t p-4 bg-gradient-to-r from-blue-50 to-indigo-50">
          <button
            onClick={async () => {
              if (!sourceTransaction || movedItemIds.size === 0) {
                return;
              }

              // Check if we need to create a new transaction first
              let finalDestinationUuid = destinationTransaction?.uuid_id;
              
              if (newTransactionData && !destinationTransaction) {
                // Create new transaction first
                try {
                  const electronAPI = getElectronAPI();
                  if (!electronAPI) {
                    throw new Error('Electron API not available');
                  }

                  // Generate transaction ID
                  let transactionId = '';
                  if (window.electronAPI?.generateNumericUuid) {
                    const uuidResult = await window.electronAPI.generateNumericUuid(businessId);
                    if (uuidResult?.success && uuidResult?.uuid) {
                      transactionId = uuidResult.uuid;
                    } else {
                      transactionId = generateTransactionId();
                    }
                  } else {
                    transactionId = generateTransactionId();
                  }

                  // Get payment method ID (cash)
                  let paymentMethodId = 1;
                  try {
                    const paymentMethods = await electronAPI.localDbGetPaymentMethods?.();
                    if (Array.isArray(paymentMethods)) {
                      const paymentMethod = (paymentMethods as Array<{ id: number; code: string }>).find(
                        (pm) => pm.code === 'cash'
                      );
                      if (paymentMethod) {
                        paymentMethodId = paymentMethod.id;
                      }
                    }
                  } catch (error) {
                    console.error('Failed to get payment methods:', error);
                  }

                  // Create empty transaction
                  const transactionData = {
                    uuid_id: transactionId,
                    id: transactionId,
                    business_id: businessId,
                    user_id: user?.id ? parseInt(String(user.id)) : 1,
                    waiter_id: null,
                    payment_method: 'cash',
                    pickup_method: 'dine-in' as const,
                    total_amount: 0,
                    voucher_discount: 0,
                    voucher_type: 'none' as const,
                    voucher_value: null,
                    voucher_label: null,
                    final_amount: 0,
                    amount_received: 0,
                    change_amount: 0,
                    status: 'pending' as const,
                    sync_status: 'pending' as const,
                    created_at: new Date().toISOString(),
                    note: null,
                    bank_name: null,
                    contact_id: null,
                    customer_name: newTransactionData.customerName || null,
                    customer_unit: null,
                    bank_id: null,
                    card_number: null,
                    cl_account_id: null,
                    cl_account_name: null,
                    transaction_type: 'drinks' as const,
                    payment_method_id: paymentMethodId,
                    table_id: newTransactionData.tableId,
                    receipt_number: null,
                  };

                  await electronAPI.localDbUpsertTransactions?.([transactionData]);
                  finalDestinationUuid = transactionId;
                } catch (error) {
                  console.error('Error creating new transaction:', error);
                  alert(`Error: ${error instanceof Error ? error.message : 'Gagal membuat transaksi baru'}`);
                  return;
                }
              }

              if (!finalDestinationUuid) {
                alert('Error: Tidak ada transaksi tujuan yang dipilih');
                return;
              }

              try {
                const electronAPI = getElectronAPI();
                if (!electronAPI?.localDbSplitBill) {
                  alert('Error: Database API not available');
                  return;
                }

                const itemIdsArray = Array.from(movedItemIds);
                const result = await electronAPI.localDbSplitBill({
                  sourceTransactionUuid: sourceTransaction.uuid_id,
                  destinationTransactionUuid: finalDestinationUuid,
                  itemIds: itemIdsArray,
                });

                if (result.success) {
                  // Log activity for split bill/pindah meja
                  try {
                    // Use the tracked moved items array (contains only items that were actually moved)
                    // Ensure it's always an array and has valid items
                    const itemsToLog = Array.isArray(movedItems) ? movedItems.filter(item => 
                      item && 
                      typeof item.id === 'number' && 
                      typeof item.product_id === 'number'
                    ) : [];
                    
                    console.log('[SPLIT BILL] Preparing to log activity:', {
                      movedItemsStateLength: movedItems.length,
                      itemsToLogLength: itemsToLog.length,
                      itemsToLog: itemsToLog.map(item => ({
                        id: item.id,
                        product_id: item.product_id,
                        product_name: item.product?.nama,
                        hasProduct: !!item.product,
                        quantity: item.quantity
                      }))
                    });
                    
                    // Warn if no items to log
                    if (itemsToLog.length === 0) {
                      console.warn('[WARN] [SPLIT BILL] No items to log! movedItems state:', movedItems);
                    }
                    
                    const itemNames = itemsToLog.map(item => {
                      const productName = item.product?.nama || `Product ${item.product_id}`;
                      const quantity = item.quantity > 1 ? `${item.quantity}x ` : '';
                      return `${quantity}${productName}`;
                    }).join(', ');

                    // Get waiter name from transaction, fallback to logged-in user
                    const transactionWaiterName = sourceTransaction.waiter_name || null;
                    const loggedInUserName = user?.name || 'Unknown';

                    // Determine destination description
                    let destinationDescription = '';
                    if (newTransactionData) {
                      // New transaction with table
                      destinationDescription = `transaksi baru meja ${newTransactionData.tableNumber || newTransactionData.tableId}`;
                    } else if (destinationTransaction) {
                      // Existing transaction
                      const destTable = destinationTransaction.table_number || 'Take-away';
                      const destCustomer = destinationTransaction.customer_name || '';
                      destinationDescription = `transaksi ${finalDestinationUuid}${destTable !== 'Take-away' ? ` (${destTable})` : ''}${destCustomer ? ` - ${destCustomer}` : ''}`;
                    } else {
                      destinationDescription = `transaksi ${finalDestinationUuid}`;
                    }

                    // Create log message (use waiter if available, otherwise user)
                    const logMessage = `waiter ${transactionWaiterName || loggedInUserName} memindahkan item ${itemNames} ke ${destinationDescription}`;

                    // Create activity log entry
                    const userId = user?.id ? parseInt(String(user.id)) : null;
                    
                    // Parse source table and room
                    const sourceTableParts = (sourceTransaction.table_number || 'Take-away').split('/');
                    const sourceTableName = sourceTableParts[0] || 'Take-away';
                    const sourceRoomName = sourceTableParts[1] || null;
                    
                    // Parse destination table and room
                    let destTableName: string | null = null;
                    let destRoomName: string | null = null;
                    if (newTransactionData) {
                      const table = tables.find(t => t.id === newTransactionData.tableId);
                      const room = rooms.find(r => r.id === table?.room_id);
                      destTableName = table?.table_number || String(newTransactionData.tableId);
                      destRoomName = room?.name || null;
                    } else if (destinationTransaction?.table_number) {
                      const destTableParts = destinationTransaction.table_number.split('/');
                      destTableName = destTableParts[0] || null;
                      destRoomName = destTableParts[1] || null;
                    }
                    
                    const detailsJson = {
                      message: logMessage,
                      source_transaction_uuid: sourceTransaction.uuid_id,
                      source_transaction_table: sourceTableName,
                      source_transaction_room: sourceRoomName,
                      source_transaction_customer: sourceTransaction.customer_name || null,
                      destination_transaction_uuid: finalDestinationUuid,
                      destination_table: destTableName,
                      destination_room: destRoomName,
                      destination_customer: newTransactionData?.customerName || destinationTransaction?.customer_name || null,
                      moved_items: itemsToLog.length > 0 ? itemsToLog.map(item => ({
                        item_id: item.id,
                        item_uuid: item.uuid_id,
                        product_id: item.product_id,
                        product_name: item.product?.nama || `Product ${item.product_id}`,
                        quantity: item.quantity,
                        unit_price: item.unit_price,
                        total_price: item.total_price
                      })) : [],
                      waiter_name: transactionWaiterName || loggedInUserName,
                      user_name: loggedInUserName,
                      moved_at: new Date().toISOString()
                    };

                    console.log('[LOG] [SPLIT BILL] Starting activity log:', {
                      userId,
                      action: 'split_bill_pindah_meja',
                      businessId,
                      movedItemsCount: itemsToLog.length,
                      movedItems: itemsToLog.map(item => ({
                        id: item.id,
                        product_id: item.product_id,
                        product_name: item.product?.nama,
                        quantity: item.quantity
                      }))
                    });

                    // Save activity log to local database (offline-first)
                    try {
                      if (!userId) {
                        console.warn('[WARN] [SPLIT BILL] Cannot log activity: user ID not available');
                      } else {
                        const electronAPI = getElectronAPI();
                        if (electronAPI?.localDbUpsertActivityLogs) {
                          const activityLogPayload = {
                            user_id: userId,
                            action: 'split_bill_pindah_meja',
                            business_id: businessId,
                            details: JSON.stringify(detailsJson),
                            created_at: new Date().toISOString()
                          };

                          console.log('[LOG] [SPLIT BILL] Saving activity log to local database:', activityLogPayload);

                          const result = await electronAPI.localDbUpsertActivityLogs([activityLogPayload]);
                          
                          if (result?.success) {
                            console.log('[OK] [SPLIT BILL] Activity log saved to local database successfully');
                          } else {
                            console.warn('[WARN] [SPLIT BILL] Failed to save activity log to local database:', result?.error);
                          }
                        } else {
                          console.warn('[WARN] [SPLIT BILL] localDbUpsertActivityLogs not available');
                        }
                      }
                    } catch (dbError) {
                      console.error('[ERROR] [SPLIT BILL] Error saving activity log to local database:', dbError);
                      // Don't block the operation if logging fails
                    }
                  } catch (logError) {
                    console.error('Error logging split bill activity:', logError);
                    // Don't block the operation if logging fails
                  }

                  console.log('[SUCCESS] [SPLIT BILL] Split bill operation completed successfully');

                  alert(`Berhasil memindahkan ${itemIdsArray.length} item ke transaksi tujuan`);

                  // Close modal
                  onClose();

                  // Refresh transaction list without reloading the whole page
                  if (onRefresh) {
                    console.log('[SPLIT BILL] Refreshing transaction list...');
                    setTimeout(() => {
                      onRefresh();
                    }, 500); // Small delay to ensure modal closes first
                  }
                } else {
                  alert(`Error: ${result.error || 'Gagal memindahkan item'}`);
                }
              } catch (error) {
                console.error('Error splitting bill:', error);
                alert(`Error: ${error instanceof Error ? error.message : 'Gagal memindahkan item'}`);
              }
            }}
            disabled={movedItemIds.size === 0 || !sourceTransaction || (!destinationTransaction && !newTransactionData)}
            className={`w-full px-6 py-3 rounded-lg font-semibold text-lg transition-all shadow-xl hover:shadow-2xl transform hover:scale-[1.01] ${
              movedItemIds.size === 0 || !sourceTransaction || (!destinationTransaction && !newTransactionData)
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            }`}
          >
            Simpan
          </button>
        </div>
      </div>

      {/* Table Selection Modal for New Transaction */}
      {showTableSelection && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
            <div className="bg-white rounded-lg shadow-xl w-screen h-screen flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b">
                <h2 className="text-xl font-bold text-gray-900">Pilih Meja untuk Transaksi Baru</h2>
                <button
                  onClick={() => {
                    setShowTableSelection(false);
                    setShowCustomerNameInput(false);
                    setNewTransactionCustomerName('');
                    setSelectedRoom(null);
                    setTables([]);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-900" />
                </button>
              </div>

              {/* Room Selector */}
              {rooms.length > 0 && (
                <div className="p-4 border-b flex gap-2 overflow-x-auto">
                  {rooms.map((room) => (
                    <button
                      key={room.id}
                      onClick={() => setSelectedRoom(room.id)}
                      className={`px-3 py-1.5 text-sm rounded-md transition-colors whitespace-nowrap ${
                        selectedRoom === room.id
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                      }`}
                    >
                      {room.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Canvas */}
              {selectedRoom && (
                <div 
                  ref={canvasContainerRef}
                  className="flex-1 min-h-0"
                  style={{
                    ...(rooms.find(r => r.id === selectedRoom)?.canvas_width && rooms.find(r => r.id === selectedRoom)?.canvas_height
                      ? {
                          minHeight: '400px',
                          overflow: 'visible'
                        }
                      : {
                          minHeight: '400px',
                          maxHeight: 'calc(100vh - 200px)',
                          overflow: 'auto'
                        }
                    )
                  }}
                >
                  <div
                    ref={canvasRef}
                    className="relative bg-gray-100 rounded-lg border-2 border-gray-300 overflow-hidden"
                    style={{
                      width: canvasSize.width > 0 ? `${canvasSize.width}px` : '100%',
                      height: canvasSize.height || 400,
                      minHeight: '400px',
                      ...(rooms.find(r => r.id === selectedRoom)?.canvas_width && rooms.find(r => r.id === selectedRoom)?.canvas_height
                        ? {}
                        : { maxWidth: '100%', maxHeight: '100%' }
                      ),
                      margin: '0 auto',
                      backgroundImage: `
                        linear-gradient(to right, rgba(0,0,0,0.05) 1px, transparent 1px),
                        linear-gradient(to bottom, rgba(0,0,0,0.05) 1px, transparent 1px)
                      `,
                      backgroundSize: '20px 20px'
                    }}
                  >
                    {/* Legend - Inside Canvas at Bottom Left */}
                    <div className="absolute bottom-2 left-2 z-50 bg-white/95 backdrop-blur-sm rounded-lg shadow-md px-3 py-2 border border-gray-300">
                      <div className="flex items-center gap-4 text-sm text-gray-700">
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 rounded-full bg-blue-400 border-2 border-gray-800"></div>
                          <span>Meja Tersedia</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 rounded-full border-2 border-gray-800" style={{ backgroundColor: '#ef4444' }}></div>
                          <span>Meja dengan Pesanan Aktif</span>
                        </div>
                      </div>
                    </div>

                    {/* Layout Elements */}
                    {(() => {
                      const selectedRoomData = rooms.find(r => r.id === selectedRoom);
                      const fontSizeMultiplier = selectedRoomData?.font_size_multiplier ?? 1.0;
                      return layoutElements.map((element) => {
                        const posX = typeof element.position_x === 'string' ? parseFloat(element.position_x) : element.position_x;
                        const posY = typeof element.position_y === 'string' ? parseFloat(element.position_y) : element.position_y;
                        const widthPercent = typeof element.width === 'string' ? parseFloat(element.width) : element.width;
                        const heightPercent = typeof element.height === 'string' ? parseFloat(element.height) : element.height;

                        const pixelX = (posX / 100) * canvasSize.width;
                        const pixelY = (posY / 100) * canvasSize.height;
                        const pixelWidth = (widthPercent / 100) * canvasSize.width;
                        const pixelHeight = (heightPercent / 100) * canvasSize.height;

                        const minDimension = Math.min(pixelWidth, pixelHeight);
                        const baseFontSize = Math.max(10, Math.min(20, minDimension * 0.3));
                        const fontSize = baseFontSize * fontSizeMultiplier;

                        const MIN_SIZE_PERCENT = 3;
                        const minPixelSize = Math.min(
                          (MIN_SIZE_PERCENT / 100) * canvasSize.width,
                          (MIN_SIZE_PERCENT / 100) * canvasSize.height
                        );

                        return (
                          <div
                            key={`element-${element.id}`}
                            style={{
                              position: 'absolute',
                              left: pixelX,
                              top: pixelY,
                              width: Math.max(pixelWidth, minPixelSize),
                              height: Math.max(pixelHeight, minPixelSize),
                            }}
                            className="cursor-default"
                          >
                            <div
                              className="w-full h-full flex items-center justify-center relative shadow-lg overflow-hidden"
                              style={{
                                backgroundColor: element.color,
                                color: element.text_color,
                                minWidth: '30px',
                                minHeight: '30px',
                              }}
                            >
                              <div
                                className="font-bold whitespace-nowrap text-center px-2"
                                style={{ fontSize: `${fontSize}px` }}
                              >
                                {element.label}
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}

                    {/* Tables */}
                    {(() => {
                      const selectedRoomData = rooms.find(r => r.id === selectedRoom);
                      const fontSizeMultiplier = selectedRoomData?.font_size_multiplier ?? 1.0;
                      return tables.map((table) => {
                        const posX = typeof table.position_x === 'string' ? parseFloat(table.position_x) : table.position_x;
                        const posY = typeof table.position_y === 'string' ? parseFloat(table.position_y) : table.position_y;
                        const widthPercent = typeof table.width === 'string' ? parseFloat(table.width) : table.width;
                        const heightPercent = typeof table.height === 'string' ? parseFloat(table.height) : table.height;

                        const pixelX = (posX / 100) * canvasSize.width;
                        const pixelY = (posY / 100) * canvasSize.height;
                        const pixelWidth = (widthPercent / 100) * canvasSize.width;
                        const pixelHeight = (heightPercent / 100) * canvasSize.height;

                        const minDimension = Math.min(pixelWidth, pixelHeight);
                        const baseFontSize = Math.max(10, Math.min(24, minDimension * 0.25));
                        const fontSize = baseFontSize * fontSizeMultiplier;
                        const smallFontSize = Math.max(8, fontSize * 0.7);

                        const MIN_SIZE_PERCENT = 4;
                        const minPixelSize = Math.min(
                          (MIN_SIZE_PERCENT / 100) * canvasSize.width,
                          (MIN_SIZE_PERCENT / 100) * canvasSize.height
                        );

                        const hasPendingOrder = checkTableHasPendingOrder(table.id);
                        const tableBgColor = hasPendingOrder ? '#ef4444' : '#60a5fa'; // red-500 if occupied, blue-400 if available

                        return (
                          <div
                            key={table.id}
                            style={{
                              position: 'absolute',
                              left: pixelX,
                              top: pixelY,
                              width: Math.max(pixelWidth, minPixelSize),
                              height: Math.max(pixelHeight, minPixelSize),
                            }}
                            className={`transition-all duration-200 ${hasPendingOrder ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}
                            onClick={() => !hasPendingOrder && handleTableClickForNewTransaction(table.id)}
                            onMouseEnter={(e) => {
                              if (!hasPendingOrder) {
                                e.currentTarget.style.transform = 'scale(1.05)';
                                e.currentTarget.style.zIndex = '10';
                              }
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'scale(1)';
                              e.currentTarget.style.zIndex = '1';
                            }}
                          >
                            <div
                              className={`w-full h-full flex flex-col items-center justify-center relative overflow-hidden transition-all duration-200 ${
                                table.shape === 'circle' ? 'rounded-full' : 'rounded-lg'
                              } text-gray-900 border-2 border-gray-800 shadow-lg ${hasPendingOrder ? '' : 'hover:shadow-2xl hover:border-yellow-400'}`}
                              style={{
                                minWidth: '40px',
                                minHeight: '40px',
                                backgroundColor: tableBgColor,
                              }}
                            >
                              {/* Table number */}
                              <div
                                className="font-bold whitespace-nowrap"
                                style={{ fontSize: `${fontSize}px` }}
                              >
                                {table.table_number}
                              </div>

                              {/* Capacity */}
                              <div
                                className="opacity-75 whitespace-nowrap"
                                style={{ fontSize: `${smallFontSize}px` }}
                              >
                                {table.capacity}p
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              {!selectedRoom && loadingTables && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-gray-600">Memuat layout meja...</div>
                </div>
              )}

              {!selectedRoom && !loadingTables && rooms.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-gray-500">
                    <p>Tidak ada ruangan tersedia</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
    </div>
  );
}










