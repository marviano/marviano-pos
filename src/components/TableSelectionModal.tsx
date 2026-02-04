'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { generateTransactionId, generateTransactionItemId } from '@/lib/uuid';
import NewItemsConfirmationModal from './NewItemsConfirmationModal';

interface Room {
  id: number;
  business_id: number;
  name: string;
  table_count?: number;
  canvas_width?: number | null;
  canvas_height?: number | null;
  font_size_multiplier?: number | null;
}

interface Table {
  id: number;
  room_id: number;
  table_number: string;
  position_x: number | string;
  position_y: number | string;
  width: number | string;
  height: number | string;
  capacity: number;
  shape: 'circle' | 'rectangle';
}

interface LayoutElement {
  id: number;
  room_id: number;
  label: string;
  position_x: number | string;
  position_y: number | string;
  width: number | string;
  height: number | string;
  element_type: string;
  color: string;
  text_color: string;
}

interface PendingTransaction {
  id: string;
  table_id: number | null;
  status: string;
  created_at: string;
}

interface BundleSelectionItem {
  category2_id?: number;
  category2_name?: string;
  selectedProducts: {
    product: { id: number; nama: string };
    quantity?: number;
    customizations?: { selected_options: { option_name: string }[] }[];
    customNote?: string;
  }[];
  requiredQuantity?: number;
}

interface CartItem {
  id: number;
  product: {
    id: number;
    nama?: string; // Product name (optional to match different contexts)
    harga_jual: number;
    harga_qpon?: number;
    harga_gofood?: number;
    harga_grabfood?: number;
    harga_shopeefood?: number;
    harga_tiktok?: number;
    [key: string]: unknown; // Allow other product properties
  };
  quantity: number;
  customizations?: {
    customization_id: number;
    customization_name: string;
    selected_options: {
      option_id: number;
      option_name: string;
      price_adjustment: number;
    }[];
  }[];
  customNote?: string;
  bundleSelections?: BundleSelectionItem[];
  isLocked?: boolean;
  transactionItemId?: number;
  transactionId?: string;
  tableId?: number | null;
}

interface TableSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  transactionType: 'drinks' | 'bakery';
  onSuccess: () => void;
  customerName?: string;
  pickupMethod?: 'dine-in' | 'take-away';
  loadedTransactionInfo?: {
    transactionId: string;
    tableName: string | null;
    roomName: string | null;
    customerName: string | null;
    waiterName: string | null;
    waiterColor: string | null;
  } | null;
  onItemsLocked?: (itemIds: number[]) => void;
  waiterId?: number | null;
}

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function TableSelectionModal({
  isOpen,
  onClose,
  cartItems,
  transactionType,
  onSuccess,
  customerName = '',
  pickupMethod = 'dine-in',
  loadedTransactionInfo = null,
  onItemsLocked,
  waiterId = null,
}: TableSelectionModalProps) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<number | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [layoutElements, setLayoutElements] = useState<LayoutElement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const businessId = user?.selectedBusinessId;
  
  if (!businessId) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md">
          <h2 className="text-xl font-bold text-red-600 mb-2">No Business Selected</h2>
          <p className="text-gray-700">Please log in and select a business to select a table.</p>
        </div>
      </div>
    );
  }
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransaction[]>([]);
  // const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [newItemsToSave, setNewItemsToSave] = useState<CartItem[]>([]);
  const [pendingTableId, setPendingTableId] = useState<number | null>(null);
  const hasCheckedLihatMode = useRef(false);
  const saveNewItemsInProgressRef = useRef(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  // const [canvasScale, setCanvasScale] = useState(1);

  // Update canvas size
  useEffect(() => {
    const updateCanvasSize = () => {
      if (canvasRef.current && canvasContainerRef.current) {
        const selectedRoomData = rooms.find(r => r.id === selectedRoom);
        let width: number;
        let height: number;
        let scale = 1;

        // Use stored canvas dimensions if available, otherwise calculate from container
        if (selectedRoomData?.canvas_width && selectedRoomData?.canvas_height) {
          // Use exact stored dimensions without scaling
          // The container will handle scrolling if canvas is larger than viewport
          width = selectedRoomData.canvas_width;
          height = selectedRoomData.canvas_height;
          scale = 1; // No scaling when using explicit dimensions
        } else {
          // Fallback to calculated 16:9 aspect ratio
          const containerWidth = canvasContainerRef.current.clientWidth;
          width = containerWidth;
          height = (containerWidth / 16) * 9;
          scale = 1;
        }

        setCanvasSize(prev => {
          if (prev.width !== width || prev.height !== height) {
            return { width, height };
          }
          return prev;
        });
      }
    };

    // Always observe container resize to recalculate scale when using stored dimensions
    if (canvasRef.current && canvasContainerRef.current && isOpen) {
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
  }, [selectedRoom, isOpen, rooms]);

  // Fetch data when modal opens
  useEffect(() => {
    if (isOpen && businessId && businessId > 0) {
      fetchRooms();
      fetchPendingTransactions();
      
      // If in "lihat" mode, automatically show confirmation for new items
      // Only check once when modal opens
      if (loadedTransactionInfo && !hasCheckedLihatMode.current) {
        hasCheckedLihatMode.current = true;
        const newItems = cartItems.filter(item => !item.isLocked);
        if (newItems.length > 0) {
          // Fetch transaction to get table_id
          const fetchTableId = async () => {
            try {
              const electronAPI = getElectronAPI();
              if (!electronAPI) return;
              
              const transactions = await electronAPI.localDbGetTransactions?.(businessId, 10000);
              const transactionsArray = Array.isArray(transactions) ? transactions as Record<string, unknown>[] : [];
              const transaction = transactionsArray.find((tx) => 
                tx.uuid_id === loadedTransactionInfo.transactionId || tx.id === loadedTransactionInfo.transactionId
              ) as Record<string, unknown> | undefined;
              
              if (transaction) {
                const tableId = typeof transaction.table_id === 'number' 
                  ? transaction.table_id 
                  : (typeof transaction.table_id === 'string' ? parseInt(transaction.table_id, 10) : null);
                
                if (tableId) {
                  setNewItemsToSave(newItems);
                  setPendingTableId(tableId);
                  setShowConfirmationModal(true);
                }
              }
            } catch (error) {
              console.error('Error fetching transaction for table ID:', error);
            }
          };
          
          fetchTableId();
        } else {
          // No new items to add, close modal and show message
          alert('Tidak ada item baru untuk ditambahkan.');
          onClose();
        }
      }
    } else if (!isOpen) {
      // Reset flag when modal closes
      hasCheckedLihatMode.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, businessId, loadedTransactionInfo?.transactionId]);

  const fetchRooms = async () => {
    try {
      setLoading(true);
      setError(null);

      const electronAPI = window.electronAPI;
      if (!electronAPI?.getRestaurantRooms) {
        setError('getRestaurantRooms not available in Electron API');
        setLoading(false);
        return;
      }

      const roomsData = await electronAPI.getRestaurantRooms(businessId);
      const roomsArray = Array.isArray(roomsData) ? roomsData : [];
      setRooms(roomsArray);

      if (roomsArray.length === 0) {
        setError(`No rooms found for business ID ${businessId}. Please create rooms in Salespulse first.`);
      }

      // Auto-select first room if available and no room is selected
      if (roomsArray.length > 0 && selectedRoom === null) {
        setSelectedRoom(roomsArray[0].id);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error fetching rooms';
      setError(`Failed to fetch rooms: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchTables = useCallback(async () => {
    if (!selectedRoom) return;
    try {
      const electronAPI = window.electronAPI;
      if (!electronAPI?.getRestaurantTables) {
        console.error('getRestaurantTables not available');
        return;
      }

      const tablesData = await electronAPI.getRestaurantTables(selectedRoom);
      const tablesArray = Array.isArray(tablesData) ? tablesData : [];
      setTables(tablesArray);
    } catch (error) {
      console.error('Error fetching tables:', error);
    }
  }, [selectedRoom]);

  const fetchLayoutElements = useCallback(async () => {
    if (!selectedRoom) return;

    try {
      const electronAPI = window.electronAPI;
      if (!electronAPI?.getRestaurantLayoutElements) {
        console.error('getRestaurantLayoutElements not available');
        return;
      }

      const elementsData = await electronAPI.getRestaurantLayoutElements(selectedRoom);
      setLayoutElements(Array.isArray(elementsData) ? elementsData : []);
    } catch (error) {
      console.error('Error fetching layout elements:', error);
    }
  }, [selectedRoom]);

  // Fetch tables and elements when room is selected
  useEffect(() => {
    if (selectedRoom && isOpen) {
      // Clear tables first to ensure clean state
      setTables([]);
      setLayoutElements([]);
      fetchTables();
      fetchLayoutElements();
    } else {
      setTables([]);
      setLayoutElements([]);
    }
  }, [selectedRoom, isOpen, fetchTables, fetchLayoutElements]);

  const fetchPendingTransactions = async () => {
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetTransactions) {
        console.error('localDbGetTransactions not available');
        return;
      }

      // Fetch all transactions and filter for pending ones with table_id
      const allTransactions = await electronAPI.localDbGetTransactions(businessId, 10000);const pending = (Array.isArray(allTransactions) ? allTransactions : [])
        .filter((tx: unknown) => {
          if (tx && typeof tx === 'object' && 'status' in tx && 'table_id' in tx) {
            const transaction = tx as { status: string; table_id: number | null; uuid_id?: string; id?: string };
            const isPending = transaction.status === 'pending' && transaction.table_id !== null;return isPending;
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
        });setPendingTransactions(pending);
    } catch (error) {
      console.error('Error fetching pending transactions:', error);}
  };

  const checkTableHasPendingOrder = (tableId: number): boolean => {
    return pendingTransactions.some(tx => tx.table_id === tableId);
  };

  const getPendingTransactionForTable = (tableId: number): PendingTransaction | null => {
    const result = pendingTransactions.find(tx => tx.table_id === tableId) || null;return result;
  };

  const handleTableClick = async (tableId: number) => {
    // If in "lihat" mode, skip table selection and show confirmation modal for new items only
    if (loadedTransactionInfo) {
      // Filter only new items (unlocked items)
      const newItems = cartItems.filter(item => !item.isLocked);
      
      if (newItems.length === 0) {
        alert('Tidak ada item baru untuk ditambahkan.');
        return;
      }

      // Store new items and table ID for confirmation
      setNewItemsToSave(newItems);
      setPendingTableId(tableId);
      setShowConfirmationModal(true);
      return;
    }

    // Normal mode: check if table has pending order
    if (checkTableHasPendingOrder(tableId)) {
      alert(`Meja ${tables.find(t => t.id === tableId)?.table_number || tableId} sudah memiliki pesanan aktif. Silakan pilih meja lain.`);
      return;
    }

    // Check if cart is empty
    if (cartItems.length === 0) {
      alert('Keranjang kosong. Silakan tambahkan produk terlebih dahulu.');
      return;
    }

    await savePendingTransaction(tableId);
  };

  const savePendingTransaction = async (tableId: number | null) => {
    setIsSaving(true);
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI) {
        throw new Error('Electron API not available');
      }

      // Generate transaction ID
      let transactionId = '';
      if (window.electronAPI?.generateNumericUuid) {
        const uuidResult = await window.electronAPI.generateNumericUuid(businessId);if (uuidResult?.success && uuidResult?.uuid) {
          transactionId = uuidResult.uuid;
        } else {
          transactionId = generateTransactionId();
        }
      } else {
        transactionId = generateTransactionId();
      }// Calculate totals
      const orderTotal = cartItems.reduce((sum, item) => {
        let itemPrice = item.product.harga_jual || 0;
        // Add customization prices
        if (item.customizations) {
          item.customizations.forEach(customization => {
            customization.selected_options.forEach(option => {
              itemPrice += option.price_adjustment || 0;
            });
          });
        }
        return sum + (itemPrice * item.quantity);
      }, 0);

      // Prepare transaction data
      console.log('🔍 [TABLE SELECTION] Saving transaction with waiterId:', waiterId);
      const transactionData = {
        uuid_id: transactionId,
        id: transactionId, // For compatibility
        business_id: businessId,
        user_id: user?.id ? parseInt(String(user.id)) : 1,
        waiter_id: waiterId || null,
        payment_method: 'cash',
        pickup_method: (pickupMethod === 'take-away' ? 'take-away' : 'dine-in') as 'take-away' | 'dine-in',
        total_amount: orderTotal,
        voucher_discount: 0,
        voucher_type: 'none' as const,
        voucher_value: null,
        voucher_label: null,
        final_amount: orderTotal,
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
        transaction_type: transactionType,
        payment_method_id: 1, // Cash default
        table_id: tableId ?? null,
        receipt_number: null,
      };

      // Get payment method ID from local database (cash)
      try {
        const paymentMethods = await electronAPI.localDbGetPaymentMethods?.();
        if (Array.isArray(paymentMethods)) {
          const paymentMethod = (paymentMethods as Array<{ id: number; code: string }>).find(
            (pm) => pm.code === 'cash'
          );
          if (paymentMethod) {
            transactionData.payment_method_id = paymentMethod.id;
          }
        }
      } catch (error) {
        console.error('Failed to get payment methods from local DB:', error);
      }

      // Bind new transaction to current active shift
      try {
        if (electronAPI.localDbGetActiveShift && businessId) {
          const userId = user?.id ? parseInt(String(user.id)) : 0;
          const effectiveBizId = typeof businessId === 'number' ? businessId : (businessId ? parseInt(String(businessId), 10) : null);
          if (effectiveBizId != null && !isNaN(effectiveBizId)) {
            const activeShiftRes = await electronAPI.localDbGetActiveShift(userId, effectiveBizId);
            const shiftUuid = (activeShiftRes as { shift?: { uuid_id?: string } })?.shift?.uuid_id;
            if (shiftUuid) {
              (transactionData as Record<string, unknown>).shift_uuid = shiftUuid;
            }
          }
        }
      } catch (error) {
        console.warn('Failed to get active shift for transaction:', error);
      }

      // Prepare transaction items (store UUIDs for matching later)
      const transactionItemUuids: string[] = [];
      const transactionItems = cartItems.map(item => {
        const basePrice = item.product.harga_jual || 0;
        let itemPrice = basePrice;

        // Add customization prices
        if (item.customizations) {
          item.customizations.forEach(customization => {
            customization.selected_options.forEach(option => {
              itemPrice += option.price_adjustment || 0;
            });
          });
        }

        const itemUuid = generateTransactionItemId();
        transactionItemUuids.push(itemUuid);

        return {
          uuid_id: itemUuid,
          id: itemUuid, // For compatibility
          transaction_id: 0, // Will be set by database
          uuid_transaction_id: transactionId,
          product_id: item.product.id,
          quantity: item.quantity,
          unit_price: itemPrice,
          total_price: itemPrice * item.quantity,
          custom_note: item.customNote || null,
          bundle_selections_json: item.bundleSelections ? JSON.stringify(item.bundleSelections) : null,
          created_at: transactionData.created_at,
          waiter_id: waiterId ?? null,
          production_status: null,
          production_started_at: null,
          production_finished_at: null,
        };
      });
      // Save transaction and items to local database
      console.log('💾 [TABLE SELECTION] Saving transaction with data:', {
        transactionId: transactionData.id,
        waiter_id: transactionData.waiter_id,
        waiterId_prop: waiterId,
        business_id: transactionData.business_id,
        user_id: transactionData.user_id
      });
      await electronAPI.localDbUpsertTransactions?.([transactionData]);
      await electronAPI.localDbUpsertTransactionItems?.(transactionItems);
      // Fetch saved transaction items to get their database IDs for saving customizations
      const savedTransactionItems = await electronAPI.localDbGetTransactionItems?.(transactionId);
      const savedItemsArray = Array.isArray(savedTransactionItems) ? savedTransactionItems as Record<string, unknown>[] : [];
      // Prepare customizations and customization options
      // We need to save customizations first to get their database-generated IDs,
      // then use those IDs when saving options
      const customizationData: Array<{
        transaction_item_id: number;
        customization_type_id: number;
        bundle_product_id: number | null;
        created_at: string;
        options: Array<{
          customization_option_id: number;
          option_name: string;
          price_adjustment: number;
        }>;
      }> = [];

      // Match saved transaction items with cart items and build customization data
      cartItems.forEach((cartItem, cartIndex) => {
        // Find the corresponding saved transaction item by matching UUID (most reliable)
        // Fallback to product_id + transaction_id if UUID matching fails
        const itemUuid = transactionItemUuids[cartIndex];
        const savedItem = savedItemsArray.find((item: Record<string, unknown>) => 
          item.uuid_id === itemUuid || item.id === itemUuid
        ) as { id: number; uuid_id?: string } | undefined;

        if (!savedItem || !savedItem.id) {
          console.warn(`⚠️ Could not find saved transaction item for product ${cartItem.product.id}`);
          return;
        }

        // Process customizations for this item
        if (cartItem.customizations && cartItem.customizations.length > 0) {
          cartItem.customizations.forEach((customization) => {
            // Collect options for this customization
            const options: Array<{
              customization_option_id: number;
              option_name: string;
              price_adjustment: number;
            }> = [];

            if (customization.selected_options && customization.selected_options.length > 0) {
              customization.selected_options.forEach((option) => {
                options.push({
                  customization_option_id: option.option_id,
                  option_name: option.option_name,
                  price_adjustment: option.price_adjustment || 0,
                });
              });
            }

            // Add customization data (will save later)
            customizationData.push({
              transaction_item_id: savedItem.id,
              customization_type_id: customization.customization_id,
              bundle_product_id: null, // Not handling bundles in customizations for now
              created_at: transactionData.created_at,
              options,
            });
          });
        }
      });

      // Save customizations will be done after we verify the transaction// Immediately verify the saved transaction and items
      const verifyTransactions = await electronAPI.localDbGetTransactions?.(businessId, 100);
      const verifyTransactionsArray = Array.isArray(verifyTransactions) ? verifyTransactions as Record<string, unknown>[] : [];
      const savedTx = verifyTransactionsArray.find((tx) => (tx.uuid_id === transactionId || tx.id === transactionId)) || null;// Verify items were saved
      const verifyItems = await electronAPI.localDbGetTransactionItems?.(transactionId);
      const verifyItemsArray = Array.isArray(verifyItems) ? verifyItems as Record<string, unknown>[] : [];// Save customizations now that we have the saved transaction
      if (customizationData.length > 0 && savedTx) {
        const transactionItemCustomizations = customizationData.map(customization => ({
          id: null, // Let database auto-generate
          transaction_item_id: customization.transaction_item_id,
          customization_type_id: customization.customization_type_id,
          bundle_product_id: customization.bundle_product_id,
          created_at: customization.created_at,
        }));

        await electronAPI.localDbUpsertTransactionItemCustomizations?.(transactionItemCustomizations);
        console.log(`✅ Saved ${transactionItemCustomizations.length} customization(s)`);

        // Now fetch the saved customizations to get their database-generated IDs
        let savedCustomizationsArray: Array<Record<string, unknown>> = [];
        try {
          // Try both UUID and numeric ID
          const numericTransactionId = (typeof savedTx.id === 'string' || typeof savedTx.id === 'number') ? savedTx.id : 
                                       (typeof savedTx.transaction_id === 'string' || typeof savedTx.transaction_id === 'number') ? savedTx.transaction_id : null;
          const uuidTransactionId = typeof savedTx.uuid_id === 'string' ? savedTx.uuid_id : transactionId;// Try UUID first (more reliable)
          let customizationsResult = await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(uuidTransactionId);
          
          // If no results, try numeric ID
          if (!customizationsResult || !customizationsResult.customizations || customizationsResult.customizations.length === 0) {
            if (numericTransactionId) {
              customizationsResult = await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(String(numericTransactionId));
            }
          }
          
          if (customizationsResult && customizationsResult.customizations && Array.isArray(customizationsResult.customizations)) {
            // Filter to only the transaction items we just saved
            const savedItemIds = new Set(savedItemsArray.map((item: Record<string, unknown>) => item.id));
            savedCustomizationsArray = customizationsResult.customizations.filter((c: Record<string, unknown>) => 
              savedItemIds.has(c.transaction_item_id as number)
            );} else {
            console.warn('⚠️ No customizations found in query result');
          }
        } catch (error) {
          console.warn('⚠️ Could not fetch saved customizations, options may not be saved correctly:', error);
        }

        // Build options array with correct customization IDs
        const transactionItemCustomizationOptions: Array<{
          id: number | null;
          transaction_item_customization_id: number;
          customization_option_id: number;
          option_name: string;
          price_adjustment: number;
          created_at: string;
        }> = [];

        // Match saved customizations with our customization data
        for (const customization of customizationData) {
          // Find the saved customization that matches this one
          const savedCustomization = savedCustomizationsArray.find((sc: Record<string, unknown>) => 
            sc.transaction_item_id === customization.transaction_item_id &&
            sc.customization_type_id === customization.customization_type_id
          ) as { id: number } | undefined;

          if (savedCustomization && savedCustomization.id) {
            // Add options for this customization
            customization.options.forEach((option) => {
              transactionItemCustomizationOptions.push({
                id: null, // Let database auto-generate
                transaction_item_customization_id: savedCustomization.id,
                customization_option_id: option.customization_option_id,
                option_name: option.option_name,
                price_adjustment: option.price_adjustment,
                created_at: customization.created_at,
              });
            });
          } else {
            console.warn(`⚠️ Could not find saved customization for item ${customization.transaction_item_id}, type ${customization.customization_type_id}`);
          }
        }

        // Save options
        if (transactionItemCustomizationOptions.length > 0) {
          await electronAPI.localDbUpsertTransactionItemCustomizationOptions?.(transactionItemCustomizationOptions);
          console.log(`✅ Saved ${transactionItemCustomizationOptions.length} customization option(s)`);
        }
      }

      // Print labels for new order and mark checker as printed (so payment won't re-print)
      const MAX_CUSTOMIZATION_LENGTH_PER_LABEL = 70;
      const splitCustomizationsForLabels = (text: string): string[] => {
        if (!text || text.length <= MAX_CUSTOMIZATION_LENGTH_PER_LABEL) return [text];
        const parts = text.split('/');
        const chunks: string[] = [];
        let currentChunk = '';
        for (const part of parts) {
          const wouldExceed = currentChunk ? (currentChunk + '/' + part).length > MAX_CUSTOMIZATION_LENGTH_PER_LABEL : part.length > MAX_CUSTOMIZATION_LENGTH_PER_LABEL;
          if (wouldExceed && currentChunk) {
            chunks.push(currentChunk);
            currentChunk = part;
          } else if (wouldExceed && !currentChunk) {
            const words = part.split(' ');
            let wordChunk = '';
            for (const word of words) {
              if ((wordChunk + ' ' + word).length > MAX_CUSTOMIZATION_LENGTH_PER_LABEL && wordChunk) {
                chunks.push(wordChunk.trim());
                wordChunk = word;
              } else {
                wordChunk = wordChunk ? wordChunk + ' ' + word : word;
              }
            }
            currentChunk = wordChunk;
          } else {
            currentChunk = currentChunk ? currentChunk + '/' + part : part;
          }
        }
        if (currentChunk) chunks.push(currentChunk);
        return chunks.length > 0 ? chunks : [text];
      };
      const finalPickupMethod = pickupMethod === 'take-away' ? 'Take Away' : 'Dine In';
      const orderTime = transactionData.created_at;
      const newOrderLabels: Array<{
        printerType: string;
        counter: number;
        itemNumber: number;
        totalItems: number;
        pickupMethod: string;
        productName: string;
        customizations: string;
        customNote: string;
        orderTime: string;
        labelContinuation?: string;
      }> = [];
      let newOrderItemNumber = 0;
      for (const item of cartItems) {
        const isBundle = item.bundleSelections && (item.bundleSelections as unknown[]).length > 0;
        if (isBundle) {
          for (const bundleSel of item.bundleSelections as Array<{ selectedProducts: Array<{ quantity?: number; product: { nama: string }; customizations?: Array<{ selected_options: Array<{ option_name: string }> }>; customNote?: string }> }>) {
            for (const selectedProduct of bundleSel.selectedProducts) {
              const selectionQty = typeof selectedProduct.quantity === 'number' && !Number.isNaN(selectedProduct.quantity) ? selectedProduct.quantity : 1;
              const totalQty = item.quantity * selectionQty;
              const allOptions: string[] = [];
              if (selectedProduct.customizations?.length) {
                selectedProduct.customizations.forEach((c: { selected_options: Array<{ option_name: string }> }) => {
                  c.selected_options.forEach(opt => allOptions.push(opt.option_name));
                });
              }
              if (selectedProduct.customNote?.trim()) allOptions.push(selectedProduct.customNote.trim());
              const customizationText = allOptions.join('/');
              const customizationChunks = splitCustomizationsForLabels(customizationText);
              for (let qty = 0; qty < totalQty; qty++) {
                newOrderItemNumber++;
                for (let chunkIndex = 0; chunkIndex < customizationChunks.length; chunkIndex++) {
                  const isMultiLabel = customizationChunks.length > 1;
                  const labelNumber = chunkIndex + 1;
                  const totalLabels = customizationChunks.length;
                  newOrderLabels.push({
                    printerType: 'labelPrinter',
                    counter: 1,
                    itemNumber: newOrderItemNumber,
                    totalItems: 0,
                    pickupMethod: finalPickupMethod,
                    productName: selectedProduct.product.nama,
                    customizations: customizationChunks[chunkIndex],
                    customNote: '',
                    orderTime,
                    labelContinuation: isMultiLabel ? `${labelNumber}/${totalLabels}` : undefined
                  });
                }
              }
            }
          }
        } else {
          const allOptions: string[] = [];
          if (item.customizations?.length) {
            item.customizations.forEach(c => {
              c.selected_options.forEach(opt => allOptions.push(opt.option_name));
            });
          }
          if (item.customNote) allOptions.push(item.customNote);
          const customizationText = allOptions.join('/');
          const customizationChunks = splitCustomizationsForLabels(customizationText);
          for (let qty = 0; qty < item.quantity; qty++) {
            newOrderItemNumber++;
            for (let chunkIndex = 0; chunkIndex < customizationChunks.length; chunkIndex++) {
              const isMultiLabel = customizationChunks.length > 1;
              const labelNumber = chunkIndex + 1;
              const totalLabels = customizationChunks.length;
              newOrderLabels.push({
                printerType: 'labelPrinter',
                counter: 1,
                itemNumber: newOrderItemNumber,
                totalItems: 0,
                pickupMethod: finalPickupMethod,
                productName: item.product.nama || '',
                customizations: customizationChunks[chunkIndex],
                customNote: '',
                orderTime,
                labelContinuation: isMultiLabel ? `${labelNumber}/${totalLabels}` : undefined
              });
            }
          }
        }
      }
      const newOrderTotalItems = newOrderItemNumber;
      newOrderLabels.forEach(l => { l.totalItems = newOrderTotalItems; });

      // Build orderContext for checker templates that use {{waiterName}}, {{customerName}}, {{tableName}}, {{orderTime}}, {{items}}
      const escapeHtmlForChecker = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      let waiterNameForChecker = '';
      if (waiterId && window.electronAPI?.localDbGetEmployees) {
        try {
          const employees = await window.electronAPI.localDbGetEmployees();
          const arr = Array.isArray(employees) ? employees : [];
          const waiter = arr.find((emp: { id?: number; nama_karyawan?: string }) =>
            (typeof emp.id === 'number' ? emp.id : parseInt(String(emp.id), 10)) === waiterId
          );
          if (waiter && typeof waiter.nama_karyawan === 'string') {
            waiterNameForChecker = waiter.nama_karyawan;
          }
        } catch (_) {
          // ignore
        }
      }
      const rowForItem = (item: typeof cartItems[0]) => {
        let unitPrice = item.product.harga_jual || 0;
        if (item.customizations?.length) {
          item.customizations.forEach(c => c.selected_options.forEach(o => { unitPrice += o.price_adjustment || 0; }));
        }
        const subtotal = unitPrice * item.quantity;
        let cellText = item.product.nama || '';
        if (item.customNote?.trim()) {
          cellText += '\nCatatan: ' + item.customNote.trim();
        }
        if (item.customizations?.length) {
          const opts = item.customizations.flatMap(c => c.selected_options.map(o => o.option_name || '')).filter(Boolean);
          if (opts.length) cellText += '\n' + opts.join(', ');
        }
        const cellHtml = escapeHtmlForChecker(cellText).replace(/\n/g, '<br/>');
        return `<tr><td>${cellHtml}</td><td style="text-align: right;">${item.quantity}</td><td style="text-align: right;">${subtotal}</td></tr>`;
      };
      const lineForItem = (item: typeof cartItems[0]) => {
        let unitPrice = item.product.harga_jual || 0;
        if (item.customizations?.length) {
          item.customizations.forEach(c => c.selected_options.forEach(o => { unitPrice += o.price_adjustment || 0; }));
        }
        const subtotal = unitPrice * item.quantity;
        let cellText = item.product.nama || '';
        if (item.customNote?.trim()) cellText += '\nCatatan: ' + item.customNote.trim();
        if (item.customizations?.length) {
          const opts = item.customizations.flatMap(c => c.selected_options.map(o => o.option_name || '')).filter(Boolean);
          if (opts.length) cellText += '\n' + opts.join(', ');
        }
        const cellHtml = escapeHtmlForChecker(cellText).replace(/\n/g, '<br/>');
        return `<div class="item-line">- ${item.quantity}x ${cellHtml}</div>`;
      };
      const category1NameFromProduct = (item: typeof cartItems[0]) => ((item.product as { category1_name?: string | null }).category1_name ?? '').trim();
      const category1IdFromProduct = (item: typeof cartItems[0]) => (item.product as { category1_id?: number | null }).category1_id ?? null;
      const key = (item: typeof cartItems[0]) => category1NameFromProduct(item) || `_id_${category1IdFromProduct(item) ?? 'null'}`;
      const byCategory = new Map<string, typeof cartItems>();
      for (const item of cartItems) {
        const k = key(item);
        if (!byCategory.has(k)) byCategory.set(k, []);
        byCategory.get(k)!.push(item);
      }
      const sortedKeys = Array.from(byCategory.keys()).filter(k => !k.startsWith('_id_')).sort();
      const otherKeys = Array.from(byCategory.keys()).filter(k => k.startsWith('_id_'));
      const [firstKey, secondKey] = sortedKeys.length >= 2 ? [sortedKeys[0], sortedKeys[1]] : sortedKeys.length === 1 ? [sortedKeys[0], otherKeys[0] ?? ''] : [otherKeys[0] ?? '', otherKeys[1] ?? ''];
      const cat1Items = (firstKey ? byCategory.get(firstKey) : []) ?? [];
      const cat2Items = (secondKey ? byCategory.get(secondKey) : []) ?? [];
      const orderContextRows = cartItems.map(rowForItem).join('');
      const orderContextRowsCategory1 = cat1Items.map(lineForItem).join('');
      const orderContextRowsCategory2 = cat2Items.map(lineForItem).join('');
      const category1Name = (cat1Items[0] && category1NameFromProduct(cat1Items[0])) || firstKey.replace(/^_id_/, '') || 'Kategori 1';
      const category2Name = (cat2Items[0] && category1NameFromProduct(cat2Items[0])) || secondKey.replace(/^_id_/, '') || '';
      const orderContextForChecker = {
        waiterName: waiterNameForChecker,
        customerName: customerName.trim() || '',
        tableName: tableId != null ? (tables.find(t => t.id === tableId)?.table_number ?? `Meja ${tableId}`) : '',
        orderTime: transactionData.created_at,
        itemsHtml: orderContextRows,
        itemsHtmlCategory1: orderContextRowsCategory1,
        itemsHtmlCategory2: orderContextRowsCategory2,
        category1Name,
        category2Name,
      };

      if ((newOrderLabels.length > 0 || orderContextForChecker.itemsHtml) && window.electronAPI?.printLabelsBatch) {
        try {
          await window.electronAPI.printLabelsBatch({
            labels: newOrderLabels.length > 0 ? newOrderLabels : [{ orderTime: orderContextForChecker.orderTime, productName: '', counter: 1, itemNumber: 1, totalItems: 1, pickupMethod: pickupMethod === 'take-away' ? 'Take Away' : 'Dine In' }],
            printerType: 'labelPrinter',
            business_id: businessId ?? undefined,
            orderContext: orderContextForChecker
          });
          await window.electronAPI?.localDbSetTransactionCheckerPrinted?.(transactionId);
        } catch (labelErr) {
          console.error('❌ Error printing checker for new order:', labelErr);
        }
      }

      console.log('✅ Pending transaction saved:', transactionId);
      console.log('✅ Table ID:', tableId);
      console.log('✅ Items saved:', transactionItems.length);

      // Refresh pending transactions list
      await fetchPendingTransactions();
      
      // Dispatch custom event to immediately refresh pending orders count in POSLayout
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pendingTransactionSaved'));
      }
      
      // Call success callback and close modal
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving pending transaction:', error);
      alert('Gagal menyimpan pesanan. Silakan coba lagi.');
    } finally {
      setIsSaving(false);
    }
  };

  const saveNewItemsToExistingTransaction = async (itemsToSave: CartItem[]) => {
    setIsSaving(true);
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI || !loadedTransactionInfo) {
        throw new Error('Electron API not available or transaction info missing');
      }

      const transactionId = loadedTransactionInfo.transactionId;

      // Fetch existing transaction to update totals
      const transactions = await electronAPI.localDbGetTransactions?.(businessId, 10000);
      const transactionsArray = Array.isArray(transactions) ? transactions as Record<string, unknown>[] : [];
      const existingTransaction = transactionsArray.find((tx) => 
        tx.uuid_id === transactionId || tx.id === transactionId
      ) as Record<string, unknown> | undefined;

      if (!existingTransaction) {
        throw new Error('Existing transaction not found');
      }

      // Calculate totals for new items
      const newItemsTotal = itemsToSave.reduce((sum, item) => {
        let itemPrice = item.product.harga_jual || 0;
        // Add customization prices
        if (item.customizations) {
          item.customizations.forEach(customization => {
            customization.selected_options.forEach(option => {
              itemPrice += option.price_adjustment || 0;
            });
          });
        }
        return sum + (itemPrice * item.quantity);
      }, 0);

      // Update transaction totals
      const existingTotal = typeof existingTransaction.total_amount === 'number' 
        ? existingTransaction.total_amount 
        : (typeof existingTransaction.total_amount === 'string' ? parseFloat(existingTransaction.total_amount) : 0);
      const existingFinal = typeof existingTransaction.final_amount === 'number' 
        ? existingTransaction.final_amount 
        : (typeof existingTransaction.final_amount === 'string' ? parseFloat(existingTransaction.final_amount) : 0);

      const originalTxWaiterId = existingTransaction.waiter_id != null ? existingTransaction.waiter_id : null;
      const updatedTransactionData = {
        ...existingTransaction,
        total_amount: existingTotal + newItemsTotal,
        final_amount: existingFinal + newItemsTotal,
        updated_at: new Date().toISOString(),
        waiter_id: originalTxWaiterId,
      };

      // Prepare transaction items for new items only
      const transactionItemUuids: string[] = [];
      const transactionItems = itemsToSave.map(item => {
        const basePrice = item.product.harga_jual || 0;
        let itemPrice = basePrice;

        // Add customization prices
        if (item.customizations) {
          item.customizations.forEach(customization => {
            customization.selected_options.forEach(option => {
              itemPrice += option.price_adjustment || 0;
            });
          });
        }

        const itemUuid = generateTransactionItemId();
        transactionItemUuids.push(itemUuid);

        return {
          uuid_id: itemUuid,
          id: itemUuid,
          transaction_id: 0,
          uuid_transaction_id: transactionId,
          product_id: item.product.id,
          quantity: item.quantity,
          unit_price: itemPrice,
          total_price: itemPrice * item.quantity,
          custom_note: item.customNote || null,
          bundle_selections_json: item.bundleSelections ? JSON.stringify(item.bundleSelections) : null,
          created_at: new Date().toISOString(),
          waiter_id: waiterId != null ? waiterId : (existingTransaction.waiter_id as number | null) ?? null,
          production_status: null,
          production_started_at: null,
          production_finished_at: null,
        };
      });

      // Save updated transaction and new items
      await electronAPI.localDbUpsertTransactions?.([updatedTransactionData]);
      await electronAPI.localDbUpsertTransactionItems?.(transactionItems);

      // Small delay to ensure items are fully committed to database
      await new Promise(resolve => setTimeout(resolve, 100));

      // Fetch saved transaction items to get their database IDs for saving customizations
      const savedTransactionItems = await electronAPI.localDbGetTransactionItems?.(transactionId);
      const savedItemsArray = Array.isArray(savedTransactionItems) ? savedTransactionItems as Record<string, unknown>[] : [];
      
      console.log('🔍 [TableSelectionModal] Fetched saved items after adding new items:', {
        transactionId,
        savedItemsCount: savedItemsArray.length,
        newItemUuids: transactionItemUuids,
        savedItems: savedItemsArray.map((item: Record<string, unknown>) => ({
          id: item.id,
          idType: typeof item.id,
          uuid_id: item.uuid_id,
          product_id: item.product_id
        })).slice(0, 10)
      });

      // Prepare customizations for new items
      const customizationData: Array<{
        transaction_item_id: number;
        customization_type_id: number;
        bundle_product_id: number | null;
        created_at: string;
        options: Array<{
          customization_option_id: number;
          option_name: string;
          price_adjustment: number;
        }>;
      }> = [];

      // Match saved transaction items with cart items and build customization data
      itemsToSave.forEach((cartItem, cartIndex) => {
        const itemUuid = transactionItemUuids[cartIndex];
        const savedItem = savedItemsArray.find((item: Record<string, unknown>) => 
          item.uuid_id === itemUuid || String(item.id) === String(itemUuid)
        ) as { id: number | string; uuid_id?: string } | undefined;

        if (!savedItem) {
          console.warn(`⚠️ Could not find saved transaction item for product ${cartItem.product.id}`, {
            itemUuid,
            savedItemsCount: savedItemsArray.length,
            savedItemIds: savedItemsArray.map((item: Record<string, unknown>) => ({ 
              id: item.id, 
              uuid_id: item.uuid_id,
              product_id: item.product_id 
            })).slice(0, 5)
          });
          return;
        }

        // Get the numeric database ID (not UUID)
        // The database returns 'id' as numeric, but we need to ensure it's a number
        const numericItemId = typeof savedItem.id === 'number' 
          ? savedItem.id 
          : (typeof savedItem.id === 'string' ? parseInt(savedItem.id, 10) : null);

        if (!numericItemId || numericItemId === 0 || isNaN(numericItemId)) {
          console.warn(`⚠️ Invalid transaction_item_id for product ${cartItem.product.id}`, {
            itemUuid,
            savedItemId: savedItem.id,
            savedItemIdType: typeof savedItem.id,
            numericItemId
          });
          return;
        }

        // Process customizations for this item
        if (cartItem.customizations && cartItem.customizations.length > 0) {
          cartItem.customizations.forEach((customization) => {
            const options: Array<{
              customization_option_id: number;
              option_name: string;
              price_adjustment: number;
            }> = [];

            if (customization.selected_options && customization.selected_options.length > 0) {
              customization.selected_options.forEach((option) => {
                options.push({
                  customization_option_id: option.option_id,
                  option_name: option.option_name,
                  price_adjustment: option.price_adjustment || 0,
                });
              });
            }

            customizationData.push({
              transaction_item_id: numericItemId,
              customization_type_id: customization.customization_id,
              bundle_product_id: null,
              created_at: new Date().toISOString(),
              options,
            });
          });
        }
      });

      // Save customizations
      if (customizationData.length > 0) {
        const transactionItemCustomizations = customizationData.map(customization => ({
          id: null,
          transaction_item_id: customization.transaction_item_id,
          customization_type_id: customization.customization_type_id,
          bundle_product_id: customization.bundle_product_id,
          created_at: customization.created_at,
        }));

        await electronAPI.localDbUpsertTransactionItemCustomizations?.(transactionItemCustomizations);

        // Fetch saved customizations to get their database-generated IDs
        let savedCustomizationsArray: Array<Record<string, unknown>> = [];
        try {
          const customizationsResult = await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(transactionId);
          
          if (customizationsResult && customizationsResult.customizations && Array.isArray(customizationsResult.customizations)) {
            const savedItemIds = new Set(savedItemsArray.map((item: Record<string, unknown>) => item.id));
            savedCustomizationsArray = customizationsResult.customizations.filter((c: Record<string, unknown>) => 
              savedItemIds.has(c.transaction_item_id as number)
            );
          }
        } catch (error) {
          console.warn('⚠️ Could not fetch saved customizations:', error);
        }

        // Build options array with correct customization IDs
        const transactionItemCustomizationOptions: Array<{
          id: number | null;
          transaction_item_customization_id: number;
          customization_option_id: number;
          option_name: string;
          price_adjustment: number;
          created_at: string;
        }> = [];

        for (const customization of customizationData) {
          const savedCustomization = savedCustomizationsArray.find((sc: Record<string, unknown>) => 
            sc.transaction_item_id === customization.transaction_item_id &&
            sc.customization_type_id === customization.customization_type_id
          ) as { id: number } | undefined;

          if (savedCustomization && savedCustomization.id) {
            customization.options.forEach((option) => {
              transactionItemCustomizationOptions.push({
                id: null,
                transaction_item_customization_id: savedCustomization.id,
                customization_option_id: option.customization_option_id,
                option_name: option.option_name,
                price_adjustment: option.price_adjustment,
                created_at: customization.created_at,
              });
            });
          }
        }

        if (transactionItemCustomizationOptions.length > 0) {
          await electronAPI.localDbUpsertTransactionItemCustomizationOptions?.(transactionItemCustomizationOptions);
        }
      }

      console.log('✅ New items saved to existing transaction:', transactionId);
      console.log('✅ New items saved:', transactionItems.length);

      // Print checker (labels) for the newly added items only (same template logic as payment)
      const orderTime = typeof existingTransaction.created_at === 'string' ? existingTransaction.created_at : new Date().toISOString();
      const finalPickupMethod = pickupMethod === 'take-away' ? 'take-away' : 'dine-in';
      const MAX_CUSTOMIZATION_LENGTH_PER_LABEL = 70;
      const splitCustomizations = (text: string): string[] => {
        if (!text || text.length <= MAX_CUSTOMIZATION_LENGTH_PER_LABEL) return [text];
        const parts = text.split('/');
        const chunks: string[] = [];
        let currentChunk = '';
        for (const part of parts) {
          const wouldExceed = currentChunk ? (currentChunk + '/' + part).length > MAX_CUSTOMIZATION_LENGTH_PER_LABEL : part.length > MAX_CUSTOMIZATION_LENGTH_PER_LABEL;
          if (wouldExceed && currentChunk) {
            chunks.push(currentChunk);
            currentChunk = part;
          } else if (wouldExceed && !currentChunk) {
            const words = part.split(' ');
            let wordChunk = '';
            for (const word of words) {
              if ((wordChunk + ' ' + word).length > MAX_CUSTOMIZATION_LENGTH_PER_LABEL && wordChunk) {
                chunks.push(wordChunk.trim());
                wordChunk = word;
              } else {
                wordChunk = wordChunk ? wordChunk + ' ' + word : word;
              }
            }
            currentChunk = wordChunk;
          } else {
            currentChunk = currentChunk ? currentChunk + '/' + part : part;
          }
        }
        if (currentChunk) chunks.push(currentChunk);
        return chunks.length > 0 ? chunks : [text];
      };
      const allLabels: Array<{
        printerType: string;
        counter: number;
        itemNumber: number;
        totalItems: number;
        pickupMethod: string;
        productName: string;
        customizations: string;
        customNote: string;
        orderTime: string;
        labelContinuation?: string;
      }> = [];
      let currentItemNumber = 0;
      const labelCounter = 1;
      for (const item of itemsToSave) {
        const isBundle = item.bundleSelections && item.bundleSelections.length > 0;
        if (isBundle) {
          for (const bundleSel of item.bundleSelections!) {
            for (const selectedProduct of bundleSel.selectedProducts) {
              const selectionQty = typeof selectedProduct.quantity === 'number' && !Number.isNaN(selectedProduct.quantity) ? selectedProduct.quantity : 1;
              const totalQty = item.quantity * selectionQty;
              const allOptions: string[] = [];
              if (selectedProduct.customizations?.length) {
                selectedProduct.customizations.forEach((c: { selected_options: { option_name: string }[] }) => {
                  c.selected_options.forEach(opt => allOptions.push(opt.option_name));
                });
              }
              if (selectedProduct.customNote?.trim()) allOptions.push(selectedProduct.customNote.trim());
              const customizationText = allOptions.join('/');
              const customizationChunks = splitCustomizations(customizationText);
              for (let qty = 0; qty < totalQty; qty++) {
                currentItemNumber++;
                for (let chunkIndex = 0; chunkIndex < customizationChunks.length; chunkIndex++) {
                  const isMultiLabel = customizationChunks.length > 1;
                  const labelNumber = chunkIndex + 1;
                  const totalLabels = customizationChunks.length;
                  allLabels.push({
                    printerType: 'labelPrinter',
                    counter: labelCounter,
                    itemNumber: currentItemNumber,
                    totalItems: 0,
                    pickupMethod: finalPickupMethod,
                    productName: selectedProduct.product.nama,
                    customizations: customizationChunks[chunkIndex],
                    customNote: '',
                    orderTime,
                    labelContinuation: isMultiLabel ? `${labelNumber}/${totalLabels}` : undefined
                  });
                }
              }
            }
          }
        } else {
          const allOptions: string[] = [];
          if (item.customizations?.length) {
            item.customizations.forEach(c => {
              c.selected_options.forEach(opt => allOptions.push(opt.option_name));
            });
          }
          if (item.customNote) allOptions.push(item.customNote);
          const customizationText = allOptions.join('/');
          const customizationChunks = splitCustomizations(customizationText);
          for (let qty = 0; qty < item.quantity; qty++) {
            currentItemNumber++;
            for (let chunkIndex = 0; chunkIndex < customizationChunks.length; chunkIndex++) {
              const isMultiLabel = customizationChunks.length > 1;
              const labelNumber = chunkIndex + 1;
              const totalLabels = customizationChunks.length;
              allLabels.push({
                printerType: 'labelPrinter',
                counter: labelCounter,
                itemNumber: currentItemNumber,
                totalItems: 0,
                pickupMethod: finalPickupMethod,
                productName: item.product.nama || '',
                customizations: customizationChunks[chunkIndex],
                customNote: '',
                orderTime,
                labelContinuation: isMultiLabel ? `${labelNumber}/${totalLabels}` : undefined
              });
            }
          }
        }
      }
      const totalItems = currentItemNumber;
      allLabels.forEach(l => { l.totalItems = totalItems; });

      // Build orderContext so order-summary checker template ({{items}}) shows the newly added products
      const escapeHtmlForChecker = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const rowForNewItem = (item: typeof itemsToSave[0]) => {
        let unitPrice = item.product.harga_jual || 0;
        if (item.customizations?.length) {
          item.customizations.forEach(c => c.selected_options.forEach(o => { unitPrice += o.price_adjustment || 0; }));
        }
        const subtotal = unitPrice * item.quantity;
        let cellText = item.product.nama || '';
        if (item.customNote?.trim()) cellText += '\nCatatan: ' + item.customNote.trim();
        if (item.customizations?.length) {
          const opts = item.customizations.flatMap(c => c.selected_options.map(o => o.option_name || '')).filter(Boolean);
          if (opts.length) cellText += '\n' + opts.join(', ');
        }
        const cellHtml = escapeHtmlForChecker(cellText).replace(/\n/g, '<br/>');
        return `<tr><td>${cellHtml}</td><td style="text-align: right;">${item.quantity}</td><td style="text-align: right;">${subtotal}</td></tr>`;
      };
      const lineForNewItem = (item: typeof itemsToSave[0]) => {
        let unitPrice = item.product.harga_jual || 0;
        if (item.customizations?.length) {
          item.customizations.forEach(c => c.selected_options.forEach(o => { unitPrice += o.price_adjustment || 0; }));
        }
        const subtotal = unitPrice * item.quantity;
        let cellText = item.product.nama || '';
        if (item.customNote?.trim()) cellText += '\nCatatan: ' + item.customNote.trim();
        if (item.customizations?.length) {
          const opts = item.customizations.flatMap(c => c.selected_options.map(o => o.option_name || '')).filter(Boolean);
          if (opts.length) cellText += '\n' + opts.join(', ');
        }
        const cellHtml = escapeHtmlForChecker(cellText).replace(/\n/g, '<br/>');
        return `<div class="item-line">- ${item.quantity}x ${cellHtml}</div>`;
      };
      const category1NameFromNewItem = (item: typeof itemsToSave[0]) => ((item.product as { category1_name?: string | null }).category1_name ?? '').trim();
      const category1IdNew = (item: typeof itemsToSave[0]) => (item.product as { category1_id?: number | null }).category1_id ?? null;
      const keyNew = (item: typeof itemsToSave[0]) => category1NameFromNewItem(item) || `_id_${category1IdNew(item) ?? 'null'}`;
      const byCategoryNew = new Map<string, typeof itemsToSave>();
      for (const item of itemsToSave) {
        const k = keyNew(item);
        if (!byCategoryNew.has(k)) byCategoryNew.set(k, []);
        byCategoryNew.get(k)!.push(item);
      }
      const sortedKeysNew = Array.from(byCategoryNew.keys()).filter(k => !k.startsWith('_id_')).sort();
      const otherKeysNew = Array.from(byCategoryNew.keys()).filter(k => k.startsWith('_id_'));
      const [firstKeyNew, secondKeyNew] = sortedKeysNew.length >= 2 ? [sortedKeysNew[0], sortedKeysNew[1]] : sortedKeysNew.length === 1 ? [sortedKeysNew[0], otherKeysNew[0] ?? ''] : [otherKeysNew[0] ?? '', otherKeysNew[1] ?? ''];
      const cat1New = (firstKeyNew ? byCategoryNew.get(firstKeyNew) : []) ?? [];
      const cat2New = (secondKeyNew ? byCategoryNew.get(secondKeyNew) : []) ?? [];
      const newItemsRows = itemsToSave.map(rowForNewItem).join('');
      const newItemsRowsCategory1 = cat1New.map(lineForNewItem).join('');
      const newItemsRowsCategory2 = cat2New.map(lineForNewItem).join('');
      const category1NameNew = (cat1New[0] && category1NameFromNewItem(cat1New[0])) || firstKeyNew.replace(/^_id_/, '') || 'Kategori 1';
      const category2NameNew = (cat2New[0] && category1NameFromNewItem(cat2New[0])) || secondKeyNew.replace(/^_id_/, '') || '';
      const orderContextForNewItems = {
        waiterName: loadedTransactionInfo?.waiterName ?? '',
        customerName: loadedTransactionInfo?.customerName ?? '',
        tableName: loadedTransactionInfo?.tableName ?? '',
        orderTime,
        itemsHtml: newItemsRows,
        itemsHtmlCategory1: newItemsRowsCategory1,
        itemsHtmlCategory2: newItemsRowsCategory2,
        category1Name: category1NameNew,
        category2Name: category2NameNew,
      };

      if ((allLabels.length > 0 || orderContextForNewItems.itemsHtml) && window.electronAPI?.printLabelsBatch) {
        try {
          await window.electronAPI.printLabelsBatch({
            labels: allLabels,
            printerType: 'labelPrinter',
            business_id: businessId ?? undefined,
            orderContext: orderContextForNewItems
          });
        } catch (labelErr) {
          console.error('❌ Error printing checker for new items:', labelErr);
        }
      }

      // Mark new items as locked by calling callback
      if (onItemsLocked) {
        const newItemIds = itemsToSave.map(item => item.id);
        onItemsLocked(newItemIds);
      }

      // Refresh pending transactions list
      await fetchPendingTransactions();
      
      // Dispatch custom event to immediately refresh pending orders count in POSLayout
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pendingTransactionSaved'));
      }

      // Call success callback and close modal
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving new items to existing transaction:', error);
      alert('Gagal menyimpan item baru. Silakan coba lagi.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmNewItems = async () => {
    if (newItemsToSave.length === 0 || !pendingTableId) return;
    // Prevent double-submit: avoid duplicate items on barista/kitchen display
    if (saveNewItemsInProgressRef.current) return;
    saveNewItemsInProgressRef.current = true;
    try {
      // Keep confirmation modal open (with saving state) until save + checker print finish, then close both modals
      await saveNewItemsToExistingTransaction(newItemsToSave);
      setShowConfirmationModal(false);
    } finally {
      saveNewItemsInProgressRef.current = false;
    }
  };

  if (!isOpen) return null;

  // In lihat mode, hide table selection UI when confirmation modal is showing
  const shouldHideTableSelection = loadedTransactionInfo && showConfirmationModal;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      {/* Table Selection Modal - Hidden when confirmation modal is showing in lihat mode */}
      {!shouldHideTableSelection && (
        <div className="bg-white rounded-lg shadow-xl w-screen h-screen flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b gap-4">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <h2 className="text-xl font-bold text-gray-900 whitespace-nowrap">Pilih Meja</h2>
              {/* Simpan Take Away - when pickup is take-away and new order, allow saving without table */}
              {pickupMethod === 'take-away' && !loadedTransactionInfo && (
                <button
                  type="button"
                  onClick={() => savePendingTransaction(null)}
                  disabled={isSaving || cartItems.length === 0}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg whitespace-nowrap"
                >
                  {isSaving ? 'Menyimpan...' : 'Simpan Take Away'}
                </button>
              )}
              {/* Room Selector */}
              {!loading && !error && rooms.length > 0 && (
                <div className="flex flex-wrap gap-2 flex-1 min-w-0">
                  {rooms.map((room) => (
                    <button
                      key={room.id}
                      onClick={() => {setSelectedRoom(room.id);
                      }}
                      disabled={isSaving}
                      className={`px-3 py-1.5 text-sm rounded-md transition-colors disabled:opacity-50 whitespace-nowrap ${
                        selectedRoom === room.id
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                      }`}
                    >
                      {room.name} ({room.table_count || 0})
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              disabled={isSaving}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
            >
              <X className="w-5 h-5 text-gray-900" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden p-4">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-600">Memuat layout meja...</div>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          {!loading && !error && (
            <>

              {/* Canvas */}
              {selectedRoom && (
                <div 
                  ref={canvasContainerRef}
                  className="flex-1 min-h-0"
                  style={{
                    ...(rooms.find(r => r.id === selectedRoom)?.canvas_width && rooms.find(r => r.id === selectedRoom)?.canvas_height
                      ? {
                          // No constraints when explicit dimensions are set - let canvas be its natural size
                          minHeight: '400px',
                          overflow: 'visible'
                        }
                      : {
                          // Responsive constraints for auto-calculated dimensions
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
                      // Only apply maxWidth/maxHeight constraints when canvas dimensions are not explicitly set
                      ...(rooms.find(r => r.id === selectedRoom)?.canvas_width && rooms.find(r => r.id === selectedRoom)?.canvas_height
                        ? {} // No max constraints when explicit dimensions are set
                        : { maxWidth: '100%', maxHeight: '100%' } // Apply constraints for auto-calculated dimensions
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
                        {isSaving && (
                          <div className="text-blue-600 font-medium ml-2">Menyimpan pesanan...</div>
                        )}
                      </div>
                    </div>

                    {/* Layout Elements */}
                    {(() => {
                      const selectedRoomData = rooms.find(r => r.id === selectedRoom);
                      const fontSizeMultiplier = selectedRoomData?.font_size_multiplier ?? 1.0;
                      console.log('[TableSelectionModal] Font size multiplier:', fontSizeMultiplier, 'for room:', selectedRoom);
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
                      console.log('[TableSelectionModal] Font size multiplier:', fontSizeMultiplier, 'for room:', selectedRoom);
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
                        const baseFontSize = Math.max(7, Math.min(24, minDimension * 0.25));
                        const fontSize = baseFontSize * fontSizeMultiplier;
                        const smallFontSize = Math.max(6, fontSize * 0.7);

                      const MIN_SIZE_PERCENT = 4;
                      const minPixelSize = Math.min(
                        (MIN_SIZE_PERCENT / 100) * canvasSize.width,
                        (MIN_SIZE_PERCENT / 100) * canvasSize.height
                      );

                      const hasPendingOrder = checkTableHasPendingOrder(table.id);
                      const pendingTransaction = getPendingTransactionForTable(table.id);
                      const orderCreatedAt = pendingTransaction?.created_at || null;return (
                        <TableDisplay
                          key={table.id}
                          table={table}
                          pixelX={pixelX}
                          pixelY={pixelY}
                          pixelWidth={Math.max(pixelWidth, minPixelSize)}
                          pixelHeight={Math.max(pixelHeight, minPixelSize)}
                          fontSize={fontSize}
                          smallFontSize={smallFontSize}
                          hasPendingOrder={hasPendingOrder}
                          orderCreatedAt={orderCreatedAt}
                          onClick={() => !isSaving && handleTableClick(table.id)}
                        />
                      );
                      });
                    })()}
                  </div>
                </div>
              )}

              {!error && rooms.length === 0 && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center text-gray-600">
                    <p>No rooms found for this business.</p>
                    <p className="text-sm mt-2">Create rooms in Salespulse first.</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        </div>
      )}

      {/* New Items Confirmation Modal */}
      <NewItemsConfirmationModal
        isOpen={showConfirmationModal}
        onClose={() => {
          setShowConfirmationModal(false);
          // In lihat mode, close the entire modal when canceling confirmation
          if (loadedTransactionInfo) {
            onClose();
          }
        }}
        onConfirm={handleConfirmNewItems}
        isSaving={isSaving}
        newItems={newItemsToSave.map(item => ({
          ...item,
          product: {
            id: item.product.id,
            nama: (item.product as { nama?: string }).nama || `Product ${item.product.id}`,
            harga_jual: item.product.harga_jual,
            harga_qpon: item.product.harga_qpon,
            harga_gofood: item.product.harga_gofood,
            harga_grabfood: item.product.harga_grabfood,
            harga_shopeefood: item.product.harga_shopeefood,
            harga_tiktok: item.product.harga_tiktok,
          }
        }))}
        tableName={loadedTransactionInfo?.tableName || null}
        roomName={loadedTransactionInfo?.roomName || null}
      />
    </div>
  );
}

// Table Display — layout aligned with salespulse (no overlap on square, narrow padding)
function TableDisplay({
  table,
  pixelX,
  pixelY,
  pixelWidth,
  pixelHeight,
  fontSize,
  smallFontSize,
  hasPendingOrder,
  orderCreatedAt,
  onClick,
}: {
  table: Table;
  pixelX: number;
  pixelY: number;
  pixelWidth: number;
  pixelHeight: number;
  fontSize: number;
  smallFontSize: number;
  hasPendingOrder: boolean;
  orderCreatedAt: string | null;
  onClick: () => void;
}) {
  const [timer, setTimer] = useState<string>('--:--');

  const timerFontSize = Math.max(6, fontSize * 0.9);
  const timerPadV = Math.max(1, Math.round(timerFontSize * 0.12));
  const timerPadH = Math.max(1, Math.round(timerFontSize * 0.22));
  const timerTopPx = table.shape === 'circle' ? pixelHeight * 0.12 : 4;
  const timerBlockHeight = timerFontSize + 2 * timerPadV;

  useEffect(() => {
    const updateTimer = () => {
      if (orderCreatedAt) {
        const now = new Date();
        const created = new Date(orderCreatedAt);
        const diffMs = now.getTime() - created.getTime();
        const totalSeconds = Math.floor(diffMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        setTimer(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
      } else {
        setTimer('--:--');
      }
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [orderCreatedAt]);

  const tableBgColor = hasPendingOrder ? '#ef4444' : '#60a5fa';

  return (
    <div
      style={{
        position: 'absolute',
        left: pixelX,
        top: pixelY,
        width: pixelWidth,
        height: pixelHeight,
      }}
      className="cursor-pointer transition-all duration-200"
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(1.05)';
        e.currentTarget.style.zIndex = '10';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.zIndex = '1';
      }}
    >
      <div
        className={`w-full h-full flex flex-col items-center justify-center relative overflow-hidden transition-all duration-200 ${
          table.shape === 'circle' ? 'rounded-full' : 'rounded-lg'
        } text-gray-900 border-2 border-gray-800 shadow-lg hover:shadow-2xl hover:border-yellow-400`}
        style={{
          minWidth: '40px',
          minHeight: '40px',
          backgroundColor: tableBgColor,
        }}
      >
        {/* Timer — scaled padding; top offset included in main margin to avoid overlap on square */}
        <div
          className="absolute left-1/2 -translate-x-1/2 text-center"
          style={{
            fontSize: `${timerFontSize}px`,
            fontWeight: 'bold',
            top: table.shape === 'circle' ? '12%' : '4px',
            maxWidth: '90%',
            overflow: 'hidden'
          }}
        >
          <div
            className="bg-black/40 rounded text-white font-mono whitespace-nowrap"
            style={{
              padding: `${timerPadV}px ${timerPadH}px`,
              WebkitTextStroke: '0.8px rgba(0, 0, 0, 0.9)',
              textShadow: '0 0 3px rgba(0, 0, 0, 0.6), 0 1px 2px rgba(0, 0, 0, 0.4)',
              letterSpacing: '0.5px'
            }}
          >
            {timer}
          </div>
        </div>

        {/* Main content: marginTop = timer top + timer height + buffer; narrow padding; leading-tight + gap-px */}
        <div
          className="flex flex-col items-center justify-center flex-1 w-full px-0.5 gap-px"
          style={{ marginTop: `${timerTopPx + timerBlockHeight + 2}px` }}
        >
          <div className="font-bold whitespace-nowrap leading-tight" style={{ fontSize: `${fontSize}px` }}>
            {table.table_number}
          </div>
          <div className="opacity-75 whitespace-nowrap leading-tight" style={{ fontSize: `${smallFontSize}px` }}>
            {table.capacity}p
          </div>
        </div>
      </div>
    </div>
  );
}
