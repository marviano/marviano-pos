'use client';

import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { generateTransactionId, generateTransactionItemId } from '@/lib/uuid';

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

interface CartItem {
  id: number;
  product: {
    id: number;
    harga_jual: number;
    harga_qpon?: number;
    harga_gofood?: number;
    harga_grabfood?: number;
    harga_shopeefood?: number;
    harga_tiktok?: number;
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
  bundleSelections?: unknown[];
}

interface TableSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  transactionType: 'drinks' | 'bakery';
  onSuccess: () => void;
  customerName?: string;
}

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function TableSelectionModal({
  isOpen,
  onClose,
  cartItems,
  transactionType,
  onSuccess,
  customerName = '',
}: TableSelectionModalProps) {
  const { user } = useAuth();
  const businessId = user?.selectedBusinessId ?? 14;

  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<number | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [layoutElements, setLayoutElements] = useState<LayoutElement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransaction[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [canvasScale, setCanvasScale] = useState(1);

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
        
        setCanvasScale(scale);
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
    }
  }, [isOpen, businessId]);

  // Fetch tables and elements when room is selected
  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:149',message:'Room selection useEffect triggered',data:{selectedRoom,isOpen,willFetch:!!(selectedRoom&&isOpen),currentTableCount:tables.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
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
  }, [selectedRoom, isOpen]);

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

  const fetchTables = async () => {
    if (!selectedRoom) return;

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:196',message:'Fetching tables for room',data:{selectedRoom},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    try {
      const electronAPI = window.electronAPI;
      if (!electronAPI?.getRestaurantTables) {
        console.error('getRestaurantTables not available');
        return;
      }

      const tablesData = await electronAPI.getRestaurantTables(selectedRoom);
      const tablesArray = Array.isArray(tablesData) ? tablesData : [];
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:201',message:'Tables fetched',data:{selectedRoom,tableCount:tablesArray.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      setTables(tablesArray);
    } catch (error) {
      console.error('Error fetching tables:', error);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:203',message:'Error fetching tables',data:{selectedRoom,error:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
    }
  };

  const fetchLayoutElements = async () => {
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
  };

  const fetchPendingTransactions = async () => {
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI?.localDbGetTransactions) {
        console.error('localDbGetTransactions not available');
        return;
      }

      // Fetch all transactions and filter for pending ones with table_id
      const allTransactions = await electronAPI.localDbGetTransactions(businessId, 10000);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:234',message:'All transactions fetched',data:{totalCount:Array.isArray(allTransactions)?allTransactions.length:0,sampleTx:Array.isArray(allTransactions)&&allTransactions.length>0?{id:(allTransactions[0]as any)?.id||(allTransactions[0]as any)?.uuid_id,status:(allTransactions[0]as any)?.status,table_id:(allTransactions[0]as any)?.table_id}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      const pending = (Array.isArray(allTransactions) ? allTransactions : [])
        .filter((tx: unknown) => {
          if (tx && typeof tx === 'object' && 'status' in tx && 'table_id' in tx) {
            const transaction = tx as { status: string; table_id: number | null; uuid_id?: string; id?: string };
            const isPending = transaction.status === 'pending' && transaction.table_id !== null;
            // #region agent log
            if (transaction.status === 'pending') {
              fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:239',message:'Checking pending transaction',data:{txId:transaction.uuid_id||transaction.id,status:transaction.status,table_id:transaction.table_id,isPending},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            }
            // #endregion
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

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:253',message:'Pending transactions fetched',data:{pendingCount:pending.length,pendingTransactions:pending.map(tx=>({id:tx.id,table_id:tx.table_id,created_at:tx.created_at,createdAtType:typeof tx.created_at}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      setPendingTransactions(pending);
    } catch (error) {
      console.error('Error fetching pending transactions:', error);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:255',message:'Error fetching pending transactions',data:{error:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    }
  };

  const checkTableHasPendingOrder = (tableId: number): boolean => {
    return pendingTransactions.some(tx => tx.table_id === tableId);
  };

  const getPendingTransactionForTable = (tableId: number): PendingTransaction | null => {
    const result = pendingTransactions.find(tx => tx.table_id === tableId) || null;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:263',message:'Getting pending transaction for table',data:{tableId,found:!!result,orderCreatedAt:result?.created_at||null,hasPendingOrder:!!result},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return result;
  };

  const handleTableClick = async (tableId: number) => {
    // Check if table has pending order
    if (checkTableHasPendingOrder(tableId)) {
      alert(`Meja ${tables.find(t => t.id === tableId)?.table_number || tableId} sudah memiliki pesanan aktif. Silakan pilih meja lain.`);
      return;
    }

    // Check if cart is empty
    if (cartItems.length === 0) {
      alert('Keranjang kosong. Silakan tambahkan produk terlebih dahulu.');
      return;
    }

    setSelectedTableId(tableId);
    await savePendingTransaction(tableId);
  };

  const savePendingTransaction = async (tableId: number) => {
    setIsSaving(true);
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI) {
        throw new Error('Electron API not available');
      }

      // Generate transaction ID
      let transactionId = '';
      if (window.electronAPI?.generateNumericUuid) {
        const uuidResult = await window.electronAPI.generateNumericUuid(businessId);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:356',message:'generateNumericUuid result',data:{success:uuidResult?.success,uuid:uuidResult?.uuid,uuidType:typeof uuidResult?.uuid,uuidLength:uuidResult?.uuid?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
        if (uuidResult?.success && uuidResult?.uuid) {
          transactionId = uuidResult.uuid;
        } else {
          transactionId = generateTransactionId();
        }
      } else {
        transactionId = generateTransactionId();
      }
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:365',message:'Final transactionId generated',data:{transactionId,transactionIdType:typeof transactionId,transactionIdLength:transactionId.length,isNumeric:!/[^0-9]/.test(transactionId)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'L'})}).catch(()=>{});
      // #endregion

      // Calculate totals
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
      const transactionData = {
        uuid_id: transactionId,
        id: transactionId, // For compatibility
        business_id: businessId,
        user_id: user?.id ? parseInt(String(user.id)) : 1,
        payment_method: 'cash',
        pickup_method: 'dine-in' as const,
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
        table_id: tableId,
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

      // Prepare transaction items (store UUIDs for matching later)
      const transactionItemUuids: string[] = [];
      const transactionItems = cartItems.map(item => {
        let basePrice = item.product.harga_jual || 0;
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
          production_status: null,
          production_started_at: null,
          production_finished_at: null,
        };
      });
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:471',message:'Transaction items prepared',data:{transactionId,itemsCount:transactionItems.length,firstItem:transactionItems.length>0?{uuid_transaction_id:transactionItems[0].uuid_transaction_id,product_id:transactionItems[0].product_id,quantity:transactionItems[0].quantity}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:407',message:'Before saving transaction',data:{transactionId,tableId,status:transactionData.status,table_id:transactionData.table_id,created_at:transactionData.created_at,transactionDataKeys:Object.keys(transactionData),itemsCount:transactionItems.length,itemsSample:transactionItems.length>0?{uuid_transaction_id:transactionItems[0].uuid_transaction_id,product_id:transactionItems[0].product_id,quantity:transactionItems[0].quantity}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      // Save transaction and items to local database
      await electronAPI.localDbUpsertTransactions?.([transactionData]);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:471',message:'After saving transaction, before saving items',data:{transactionId,itemsToSave:transactionItems.length,firstItemUuidTransactionId:transactionItems[0]?.uuid_transaction_id,firstItemId:transactionItems[0]?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:483',message:'Calling localDbUpsertTransactionItems',data:{transactionId,itemsToSave:transactionItems.length,itemsData:transactionItems.map((item:any)=>({uuid_id:item.uuid_id,uuid_transaction_id:item.uuid_transaction_id,transaction_id:item.transaction_id,product_id:item.product_id,quantity:item.quantity}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'M'})}).catch(()=>{});
      // #endregion
      await electronAPI.localDbUpsertTransactionItems?.(transactionItems);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:486',message:'After saving items (await completed)',data:{transactionId,itemsSaved:transactionItems.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion

      // Fetch saved transaction items to get their database IDs for saving customizations
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:490',message:'Before fetching saved items to verify',data:{transactionId,transactionIdType:typeof transactionId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'N'})}).catch(()=>{});
      // #endregion
      const savedTransactionItems = await electronAPI.localDbGetTransactionItems?.(transactionId);
      const savedItemsArray = Array.isArray(savedTransactionItems) ? savedTransactionItems : [];
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:493',message:'After fetching saved items to verify',data:{transactionId,itemsFound:savedItemsArray.length,itemsData:savedItemsArray.length>0?savedItemsArray.map((item:any)=>({uuid_id:item.uuid_id,uuid_transaction_id:item.uuid_transaction_id,transaction_id:item.transaction_id,product_id:item.product_id})):[],rawResult:Array.isArray(savedTransactionItems)?'array':typeof savedTransactionItems},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'O'})}).catch(()=>{});
      // #endregion

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
        const savedItem = savedItemsArray.find((item: any) => 
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

      // Save customizations will be done after we verify the transaction

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:611',message:'After saving transaction and customizations',data:{transactionId,tableId,itemsCount:transactionItems.length,customizationsCount:customizationData.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      // Immediately verify the saved transaction and items
      const verifyTransactions = await electronAPI.localDbGetTransactions?.(businessId, 100);
      const savedTx = Array.isArray(verifyTransactions) ? verifyTransactions.find((tx: any) => (tx.uuid_id === transactionId || tx.id === transactionId)) : null;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:479',message:'Verifying saved transaction',data:{transactionId,found:!!savedTx,savedTableId:savedTx?.table_id,savedStatus:savedTx?.status,hasTableId:!!savedTx?.table_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      
      // Verify items were saved
      const verifyItems = await electronAPI.localDbGetTransactionItems?.(transactionId);
      const verifyItemsArray = Array.isArray(verifyItems) ? verifyItems : [];
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:485',message:'Verifying saved items',data:{transactionId,itemsFound:verifyItemsArray.length,itemsExpected:transactionItems.length,firstItem:verifyItemsArray.length>0?{uuid_transaction_id:verifyItemsArray[0].uuid_transaction_id,transaction_id:verifyItemsArray[0].transaction_id,product_id:verifyItemsArray[0].product_id}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      
      // Save customizations now that we have the saved transaction
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
        let savedCustomizationsArray: any[] = [];
        try {
          // Try both UUID and numeric ID
          const numericTransactionId = savedTx.id || savedTx.transaction_id;
          const uuidTransactionId = savedTx.uuid_id || transactionId;
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:599',message:'Before fetching customizations',data:{transactionId,uuidTransactionId,numericTransactionId,savedItemIds:savedItemsArray.map((item:any)=>item.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'Z'})}).catch(()=>{});
          // #endregion
          
          // Try UUID first (more reliable)
          let customizationsResult = await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(uuidTransactionId);
          
          // If no results, try numeric ID
          if (!customizationsResult || !customizationsResult.customizations || customizationsResult.customizations.length === 0) {
            if (numericTransactionId) {
              customizationsResult = await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(String(numericTransactionId));
            }
          }
          
          if (customizationsResult && customizationsResult.customizations && Array.isArray(customizationsResult.customizations)) {
            // Filter to only the transaction items we just saved
            const savedItemIds = new Set(savedItemsArray.map((item: any) => item.id));
            savedCustomizationsArray = customizationsResult.customizations.filter((c: any) => 
              savedItemIds.has(c.transaction_item_id)
            );
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:616',message:'After fetching customizations',data:{totalCustomizations:customizationsResult.customizations.length,filteredCustomizations:savedCustomizationsArray.length,savedItemIds:Array.from(savedItemIds),foundCustomizations:savedCustomizationsArray.map((c:any)=>({id:c.id,transaction_item_id:c.transaction_item_id,customization_type_id:c.customization_type_id}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AA'})}).catch(()=>{});
            // #endregion
          } else {
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
          const savedCustomization = savedCustomizationsArray.find((sc: any) => 
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
      console.log('✅ Pending transaction saved:', transactionId);
      console.log('✅ Table ID:', tableId);
      console.log('✅ Items saved:', transactionItems.length);

      // Refresh pending transactions list
      await fetchPendingTransactions();
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:419',message:'After refresh pending transactions',data:{pendingCount:pendingTransactions.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

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

  if (!isOpen) return null;


  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-screen h-screen flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <h2 className="text-xl font-bold text-gray-900 whitespace-nowrap">Pilih Meja</h2>
            {/* Room Selector */}
            {!loading && !error && rooms.length > 0 && (
              <div className="flex flex-wrap gap-2 flex-1 min-w-0">
                {rooms.map((room) => (
                  <button
                    key={room.id}
                    onClick={() => {
                      // #region agent log
                      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:520',message:'Room button clicked',data:{roomId:room.id,roomName:room.name,currentSelectedRoom:selectedRoom},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                      // #endregion
                      setSelectedRoom(room.id);
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
                    {/* #region agent log */}
                    {(() => {
                      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:580',message:'Rendering tables list',data:{selectedRoom,tableCount:tables.length,tableIds:tables.map(t=>t.id),canvasWidth:canvasSize.width,canvasHeight:canvasSize.height,hasCanvasSize:canvasSize.width>0&&canvasSize.height>0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                      return null;
                    })()}
                    {/* #endregion */}
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
                        const baseFontSize = Math.max(10, Math.min(24, minDimension * 0.25));
                        const fontSize = baseFontSize * fontSizeMultiplier; // Apply global font size multiplier
                        const smallFontSize = Math.max(8, fontSize * 0.7);

                      const MIN_SIZE_PERCENT = 4;
                      const minPixelSize = Math.min(
                        (MIN_SIZE_PERCENT / 100) * canvasSize.width,
                        (MIN_SIZE_PERCENT / 100) * canvasSize.height
                      );

                      const hasPendingOrder = checkTableHasPendingOrder(table.id);
                      const pendingTransaction = getPendingTransactionForTable(table.id);
                      const orderCreatedAt = pendingTransaction?.created_at || null;
                      
                      // #region agent log
                      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableSelectionModal.tsx:570',message:'Rendering table',data:{tableId:table.id,tableNumber:table.table_number,hasPendingOrder,orderCreatedAt,orderCreatedAtType:typeof orderCreatedAt},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                      // #endregion

                      return (
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
    </div>
  );
}

// Table Display Component
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

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableDisplay.tsx:684',message:'Timer useEffect triggered',data:{tableNumber:table.table_number,orderCreatedAt,orderCreatedAtType:typeof orderCreatedAt,hasOrderCreatedAt:!!orderCreatedAt},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    const updateTimer = () => {
      if (orderCreatedAt) {
        // Calculate elapsed time since order was created
        const now = new Date();
        const created = new Date(orderCreatedAt);
        const diffMs = now.getTime() - created.getTime();
        
        // Convert to minutes and seconds
        const totalSeconds = Math.floor(diffMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        
        // Format as "MM:SS" (e.g., "15:30" = 15 minutes 30 seconds)
        const timerValue = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableDisplay.tsx:697',message:'Calculating elapsed timer',data:{tableNumber:table.table_number,orderCreatedAt,now:now.toISOString(),created:created.toISOString(),diffMs,totalSeconds,minutes,seconds,timerValue},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        setTimer(timerValue);
      } else {
        // No pending order, show "--:--" instead of current time
        // Timer should only show elapsed time for pending orders
        const timerValue = '--:--';
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'TableDisplay.tsx:705',message:'No order - showing placeholder',data:{tableNumber:table.table_number,orderCreatedAt,timerValue},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        setTimer(timerValue);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [orderCreatedAt]);

  // Determine table color - RED if has pending order, otherwise blue/green
  const tableBgColor = hasPendingOrder ? '#ef4444' : '#60a5fa'; // red-500 : blue-400

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
          backgroundColor: tableBgColor, // Use inline style to ensure color override
        }}
      >
        {/* Timer area at the top */}
        <div
          className="absolute left-1/2 -translate-x-1/2 text-center"
          style={{
            fontSize: `${Math.max(fontSize * 0.9, 12)}px`,
            fontWeight: 'bold',
            top: table.shape === 'circle' ? '12%' : '4px',
            maxWidth: '90%',
            overflow: 'hidden'
          }}
        >
          <div
            className="bg-black/40 px-2 py-0.5 rounded text-white font-mono whitespace-nowrap"
            style={{
              WebkitTextStroke: '0.8px rgba(0, 0, 0, 0.9)',
              textStroke: '0.8px rgba(0, 0, 0, 0.9)',
              textShadow: '0 0 3px rgba(0, 0, 0, 0.6), 0 1px 2px rgba(0, 0, 0, 0.4)',
              letterSpacing: '0.5px'
            }}
          >
            {timer}
          </div>
        </div>

        {/* Main content area */}
        <div
          className="flex flex-col items-center justify-center flex-1 w-full px-1"
          style={{ marginTop: `${Math.max(fontSize * 0.9, 12) + 8}px` }}
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
    </div>
  );
}
