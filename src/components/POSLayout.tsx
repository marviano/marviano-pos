'use client';

import { useState, useEffect, type ComponentProps, useCallback } from 'react';
import LeftSidebar from './LeftSidebar';
import RightSidebar from './RightSidebar';
import CenterContent from './CenterContent';
import SlideshowManager from './SlideshowManager';
import TransactionList from './TransactionList';
import PrinterSetup from './PrinterSetup';
import SyncManagement from './SyncManagement';
import ServerSettings from './ServerSettings';
import GantiShift from './GantiShift';
import Laporan from './Laporan';
import GlobalSettings from './GlobalSettings';
import StartShiftModal from './StartShiftModal';
import TableLayout from './TableLayout';
import ActiveOrdersTab from './ActiveOrdersTab';
import KitchenDisplay from './KitchenDisplay';
import BaristaDisplay from './BaristaDisplay';
import { mockMenuItems } from '@/data/mockData';
import { fetchCategories, fetchProducts } from '@/lib/offlineDataFetcher';
import { databaseHealthService } from '@/lib/databaseHealth';
import { useAuth } from '@/hooks/useAuth';
import { isSuperAdmin } from '@/lib/auth';
import { ClipboardList, FilePlus } from 'lucide-react';

type LocalCategory = {
  jenis: string;
  active: boolean;
  productType?: 'drinks' | 'bakery'; // NEW: Track whether this is a drinks or bakery category
};

interface Product {
  id: number;
  menu_code: string;
  nama: string;
  satuan: string;
  category1_id: number | null;
  category2_id: number | null;
  category1_name: string | null;
  category2_name: string | null;
  harga_jual: number;
  harga_khusus: number | null;
  image_url: string | null;
  status: string;
}

type CenterContentProps = ComponentProps<typeof CenterContent>;
type CartItem = CenterContentProps['cartItems'][number];
type OnlinePlatform = NonNullable<CenterContentProps['selectedOnlinePlatform']>;

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

interface POSLayoutProps {
  activeMenuItem?: string;
  setActiveMenuItem?: (item: string) => void;
  shouldBlurKasir?: boolean;
}

import { systemPosSyncService } from '@/lib/systemPosSync';

// Initialize sync service
if (typeof window !== 'undefined') {
  // Access the singleton to ensure it's initialized
  // const _ = systemPosSyncService;
  // Initialize sync service (already imported side-effect)
  console.log('[POSLayout] Initializing sync service:', !!systemPosSyncService);
}

export default function POSLayout({ activeMenuItem: externalActiveMenuItem, setActiveMenuItem: externalSetActiveMenuItem /*, shouldBlurKasir = false */ }: POSLayoutProps = {}) {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const isAdmin = isSuperAdmin(user);

  // Get business ID from logged-in user (fallback to 14 for backward compatibility)
  const businessId = user?.selectedBusinessId ?? 14;
  const canAccessSync = isAdmin ||
    permissions.includes('setelan.sinkronisasi') ||
    permissions.includes('marviano-pos_setelan_sinkronisasi');
  const canAccessPrinter = isAdmin ||
    permissions.includes('setelan.printersetup') ||
    permissions.includes('marviano-pos_setelan_printer-setup');
  const [selectedCategory, setSelectedCategory] = useState('');

  // Use external state if provided, otherwise use internal state
  const [internalActiveMenuItem, setInternalActiveMenuItem] = useState('Kasir');
  const activeMenuItem = externalActiveMenuItem ?? internalActiveMenuItem;
  const setActiveMenuItem = externalSetActiveMenuItem ?? setInternalActiveMenuItem;

  // NEW STRUCTURE: 6 carts total - 1 offline + 5 online platforms
  // Each cart can contain both drinks AND bakery items
  const [offlineCart, setOfflineCart] = useState<CartItem[]>([]);
  const [gofoodCart, setGofoodCart] = useState<CartItem[]>([]);
  const [grabfoodCart, setGrabfoodCart] = useState<CartItem[]>([]);
  const [shopeefoodCart, setShopeefoodCart] = useState<CartItem[]>([]);
  const [tiktokCart, setTiktokCart] = useState<CartItem[]>([]);
  const [qponCart, setQponCart] = useState<CartItem[]>([]);

  const [isOnlineTab, setIsOnlineTab] = useState<boolean>(false);
  const [selectedOnlinePlatform, setSelectedOnlinePlatform] = useState<OnlinePlatform | null>(null);
  const [activeSettingsTab, setActiveSettingsTab] = useState('sync');
  const [showActiveOrders, setShowActiveOrders] = useState<boolean>(false);
  const [pendingOrdersCount, setPendingOrdersCount] = useState<number>(0);
  const [loadedTransactionInfo, setLoadedTransactionInfo] = useState<{
    transactionId: string;
    tableName: string | null;
    roomName: string | null;
    customerName: string | null;
  } | null>(null);
  const [categories, setCategories] = useState<LocalCategory[]>([]); // Start with empty array
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [products, setProducts] = useState<Product[]>([]); // Start with empty array
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showStartShiftModal, setShowStartShiftModal] = useState(false);
  const [hasCheckedShift, setHasCheckedShift] = useState(false);

  // Helper functions to get current cart based on online status and platform
  const getCurrentCart = (): CartItem[] => {
    // Offline mode - one cart for all (drinks + bakery)
    if (!isOnlineTab) {
      return offlineCart;
    }

    // Online mode - one cart per platform (drinks + bakery)
    if (selectedOnlinePlatform === 'gofood') return gofoodCart;
    if (selectedOnlinePlatform === 'grabfood') return grabfoodCart;
    if (selectedOnlinePlatform === 'shopeefood') return shopeefoodCart;
    if (selectedOnlinePlatform === 'tiktok') return tiktokCart;
    if (selectedOnlinePlatform === 'qpon') return qponCart;

    return offlineCart; // fallback
  };

  const setCurrentCart = (newCart: CartItem[]) => {
    // Offline mode - one cart for all
    if (!isOnlineTab) {
      setOfflineCart(newCart);
      return;
    }

    // Online mode - set cart based on platform
    if (selectedOnlinePlatform === 'gofood') {
      setGofoodCart(newCart);
    } else if (selectedOnlinePlatform === 'grabfood') {
      setGrabfoodCart(newCart);
    } else if (selectedOnlinePlatform === 'shopeefood') {
      setShopeefoodCart(newCart);
    } else if (selectedOnlinePlatform === 'tiktok') {
      setTiktokCart(newCart);
    } else if (selectedOnlinePlatform === 'qpon') {
      setQponCart(newCart);
    }
  };

  // Clear all carts function
  const clearAllCarts = () => {
    setOfflineCart([]);
    setGofoodCart([]);
    setGrabfoodCart([]);
    setShopeefoodCart([]);
    setTiktokCart([]);
    setQponCart([]);
    setIsOnlineTab(false);
    setSelectedOnlinePlatform(null);
    setShowActiveOrders(false);
    setLoadedTransactionInfo(null); // Reset transaction info
  };

  // Send tab updates to customer display (includes cart items for the active tab)
  const sendTabUpdate = useCallback((tabInfo: { activeTab: string; isOnline: boolean; selectedPlatform?: OnlinePlatform | null }) => {
    const electronAPI = getElectronAPI();
    const currentCart = getCurrentCart();
    electronAPI?.updateCustomerDisplay?.({
      tabInfo,
      cartItems: currentCart
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnlineTab, selectedOnlinePlatform, offlineCart, gofoodCart, grabfoodCart, shopeefoodCart, tiktokCart, qponCart]);

  // Fetch categories from database with offline fallback
  // NEW: Fetch both drinks AND bakery categories together
  useEffect(() => {
    let isCancelled = false;
    setIsLoadingCategories(true);

    const loadCategories = async () => {
      try {
        // Fetch both drinks and bakery categories
        const [drinksCategories, bakeryCategories] = await Promise.all([
          fetchCategories('drinks', {
            isOnline: isOnlineTab,
            platform: isOnlineTab ? (selectedOnlinePlatform ?? undefined) : undefined,
            businessId: businessId
          }) as Promise<Array<{ jenis: string; active?: boolean }>>,
          fetchCategories('bakery', {
            isOnline: isOnlineTab,
            platform: isOnlineTab ? (selectedOnlinePlatform ?? undefined) : undefined,
            businessId: businessId
          }) as Promise<Array<{ jenis: string; active?: boolean }>>
        ]);

        if (isCancelled) {
          return;
        }

        // Tag drinks categories
        const taggedDrinks = drinksCategories
          .filter(cat => cat.jenis && cat.jenis.trim() !== '')
          .map(cat => ({
            jenis: cat.jenis,
            active: cat.active ?? true,
            productType: 'drinks' as const
          }));

        // Tag bakery categories
        const taggedBakery = bakeryCategories
          .filter(cat => cat.jenis && cat.jenis.trim() !== '')
          .map(cat => ({
            jenis: cat.jenis,
            active: cat.active ?? true,
            productType: 'bakery' as const
          }));

        // Combine: drinks first, then bakery
        const validCategories: LocalCategory[] = [...taggedDrinks, ...taggedBakery];

        if (validCategories.length > 0) {
          setCategories(validCategories);
          // Always set the first valid category as selected - this will trigger product loading
          setSelectedCategory(validCategories[0].jenis);
        } else {
          setCategories([]);
          setSelectedCategory(''); // Clear selection if no categories
        }
      } catch (error) {
        if (!isCancelled) {
          console.error('❌ Error loading categories:', error);
          setCategories([]);
          setSelectedCategory('');
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingCategories(false);
        }
      }
    };

    loadCategories();

    return () => {
      isCancelled = true;
    };
  }, [isOnlineTab, selectedOnlinePlatform, businessId]);

  // Fetch products when category or tab changes with offline fallback
  // NEW: We need to determine transactionType from the selected category's products
  useEffect(() => {
    let isCancelled = false;

    const loadProducts = async () => {
      if (!selectedCategory) {
        if (!isCancelled) {
          setIsLoadingProducts(false); // Ensure loading state is cleared
          setProducts([]);
        }
        return;
      }

      setIsLoadingProducts(true);
      try {
        // Try both drinks and bakery - the category will naturally filter to the right products
        // We fetch both types and let the API/database filter by category2_name
        const [drinksData, bakeryData] = await Promise.all([
          fetchProducts(selectedCategory, 'drinks', {
            isOnline: isOnlineTab,
            platform: isOnlineTab ? (selectedOnlinePlatform ?? undefined) : undefined,
            businessId: businessId
          }),
          fetchProducts(selectedCategory, 'bakery', {
            isOnline: isOnlineTab,
            platform: isOnlineTab ? (selectedOnlinePlatform ?? undefined) : undefined,
            businessId: businessId
          })
        ]);

        // Combine results - only one will have data for this category
        const productsData = [...drinksData, ...bakeryData];

        if (!isCancelled) {
          // FIX: Update both states together to minimize re-renders
          setProducts(productsData);
          setIsLoadingProducts(false);
        }
      } catch (error) {
        if (!isCancelled) {
          console.error('❌ Error loading products:', error);
          setProducts([]);
          setIsLoadingProducts(false);
        }
      }
    };

    loadProducts();

    return () => {
      isCancelled = true;
    };
  }, [selectedCategory, isOnlineTab, selectedOnlinePlatform, businessId]); // Re-fetch when category or tab changes


  // Reset platform selection when switching away from online tab
  useEffect(() => {
    if (!isOnlineTab) {
      setSelectedOnlinePlatform(null);
    }
  }, [isOnlineTab]);

  // Send tab updates to customer display when tab changes
  useEffect(() => {
    let tabName = 'Offline';
    if (isOnlineTab && selectedOnlinePlatform) {
      // Capitalize first letter of platform name
      tabName = selectedOnlinePlatform.charAt(0).toUpperCase() + selectedOnlinePlatform.slice(1);
    }

    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      return;
    }
    sendTabUpdate({ activeTab: tabName, isOnline: isOnlineTab, selectedPlatform: selectedOnlinePlatform });
  }, [isOnlineTab, selectedOnlinePlatform, sendTabUpdate]);

  // Auto-sync products and prices on app startup to get latest data
  useEffect(() => {
    const syncOnStartup = async () => {
      try {
        // console.log('🔄 [STARTUP] Auto-syncing products and prices on app start...');
        const success = await databaseHealthService.forceSync();
        if (success) {
          console.log('✅ [STARTUP] Products and prices synced successfully');
          // Trigger UI refresh to show new data
          window.dispatchEvent(new CustomEvent('dataSynced'));
        } else {
          console.warn('⚠️ [STARTUP] Failed to sync products and prices (will use cached data)');
        }
      } catch (error) {
        console.error('❌ [STARTUP] Error syncing on startup:', error);
        // Don't block app startup if sync fails - use cached data
      }
    };

    syncOnStartup();
  }, []);

  // Listen for data sync events to refresh categories and products
  useEffect(() => {
    const handleDataSynced = async () => {
      console.log('🔄 Data synced event received, refreshing categories and products...');
      setIsLoadingCategories(true);
      setIsLoadingProducts(true);

      try {
        // Fetch both drinks and bakery categories
        const [drinksCategories, bakeryCategories] = await Promise.all([
          fetchCategories('drinks', {
            isOnline: isOnlineTab,
            platform: isOnlineTab ? (selectedOnlinePlatform ?? undefined) : undefined,
            businessId: businessId
          }),
          fetchCategories('bakery', {
            isOnline: isOnlineTab,
            platform: isOnlineTab ? (selectedOnlinePlatform ?? undefined) : undefined,
            businessId: businessId
          })
        ]);

        // Tag drinks categories
        const taggedDrinks = (drinksCategories as Array<{ jenis: string; active?: boolean }>)
          .filter(cat => cat.jenis && cat.jenis.trim() !== '')
          .map(cat => ({
            jenis: cat.jenis,
            active: cat.active ?? true,
            productType: 'drinks' as const
          }));

        // Tag bakery categories
        const taggedBakery = (bakeryCategories as Array<{ jenis: string; active?: boolean }>)
          .filter(cat => cat.jenis && cat.jenis.trim() !== '')
          .map(cat => ({
            jenis: cat.jenis,
            active: cat.active ?? true,
            productType: 'bakery' as const
          }));

        const validCategories: LocalCategory[] = [...taggedDrinks, ...taggedBakery];
        setCategories(validCategories);

        if (validCategories.length > 0 && validCategories[0].jenis) {
          setSelectedCategory(validCategories[0].jenis);
          // Fetch products from both drinks and bakery
          const [drinksProducts, bakeryProducts] = await Promise.all([
            fetchProducts(validCategories[0].jenis, 'drinks', {
              isOnline: isOnlineTab,
              platform: isOnlineTab ? (selectedOnlinePlatform ?? undefined) : undefined,
              businessId: businessId
            }),
            fetchProducts(validCategories[0].jenis, 'bakery', {
              isOnline: isOnlineTab,
              platform: isOnlineTab ? (selectedOnlinePlatform ?? undefined) : undefined,
              businessId: businessId
            })
          ]);
          setProducts([...drinksProducts, ...bakeryProducts]);
        }
      } catch (error) {
        console.error('❌ Error refreshing after sync:', error);
      } finally {
        setIsLoadingCategories(false);
        setIsLoadingProducts(false);
      }
    };

    window.addEventListener('dataSynced', handleDataSynced);
    return () => {
      window.removeEventListener('dataSynced', handleDataSynced);
    };
  }, [isOnlineTab, selectedOnlinePlatform, businessId]);

  // Check for active shift when Kasir page is active
  useEffect(() => {
    if (activeMenuItem === 'Kasir' && user?.id && !hasCheckedShift) {
      const checkActiveShift = async () => {
        try {
          const electronAPI = getElectronAPI();
          if (electronAPI?.localDbGetActiveShift) {
            const userId = typeof user.id === 'string' ? parseInt(user.id, 10) : user.id;
            const response = await electronAPI.localDbGetActiveShift(userId, businessId);
            if (!response.shift) {
              // No active shift, show modal
              setShowStartShiftModal(true);
            }
          }
        } catch (error) {
          console.error('❌ Error checking active shift:', error);
        } finally {
          setHasCheckedShift(true);
        }
      };
      checkActiveShift();
    } else if (activeMenuItem !== 'Kasir') {
      // Reset the check flag when navigating away from Kasir page
      setHasCheckedShift(false);
      setShowStartShiftModal(false);
    }
  }, [activeMenuItem, user?.id, businessId, hasCheckedShift]);

  // Fetch pending orders count when on Kasir page
  useEffect(() => {
    if (activeMenuItem === 'Kasir') {
      const fetchPendingCount = async () => {
        try {
          const electronAPI = getElectronAPI();
          if (electronAPI?.localDbGetTransactions) {
            const allTransactions = await electronAPI.localDbGetTransactions(businessId, 10000);
            const transactionsArray = Array.isArray(allTransactions) ? allTransactions : [];
            const pendingCount = transactionsArray.filter((tx: unknown) => {
              if (tx && typeof tx === 'object' && 'status' in tx) {
                const transaction = tx as { status: string };
                return transaction.status === 'pending';
              }
              return false;
            }).length;
            setPendingOrdersCount(pendingCount);
          }
        } catch (error) {
          console.error('❌ Error fetching pending orders count:', error);
        }
      };

      fetchPendingCount();
      // Refresh count every 5 seconds
      const interval = setInterval(fetchPendingCount, 5000);
      return () => clearInterval(interval);
    } else {
      setPendingOrdersCount(0);
    }
  }, [activeMenuItem, businessId]);

  // Load transaction into cart function
  const loadTransactionIntoCart = async (transactionId: string) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'POSLayout.tsx:468',message:'loadTransactionIntoCart called',data:{transactionId,transactionIdType:typeof transactionId,transactionIdLength:transactionId?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    console.log('🔄 Loading transaction into cart:', transactionId);
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI) {
        console.error('❌ Electron API not available');
        alert('Electron API tidak tersedia');
        return;
      }

      // Fetch transaction
      const transactions = await electronAPI.localDbGetTransactions?.(businessId, 10000);
      const transactionsArray = Array.isArray(transactions) ? transactions : [];
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'POSLayout.tsx:481',message:'Fetched all transactions',data:{transactionId,totalTransactions:transactionsArray.length,sampleTx:transactionsArray.length>0?{uuid_id:transactionsArray[0].uuid_id,id:transactionsArray[0].id,uuid_idType:typeof transactionsArray[0].uuid_id,idType:typeof transactionsArray[0].id}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
      const transaction = transactionsArray.find((tx: any) => 
        tx.uuid_id === transactionId || tx.id === transactionId
      ) as any;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'POSLayout.tsx:486',message:'Transaction lookup result',data:{transactionId,found:!!transaction,transactionUuidId:transaction?.uuid_id,transactionId:transaction?.id,matchByUuid:transaction?.uuid_id===transactionId,matchById:transaction?.id===transactionId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
      // #endregion

      if (!transaction) {
        alert('Transaksi tidak ditemukan');
        return;
      }

      // Fetch table and room info if table_id exists
      let tableName: string | null = null;
      let roomName: string | null = null;
      if (transaction.table_id && electronAPI.getRestaurantTables) {
        try {
          // Get all rooms first
          const rooms = await electronAPI.getRestaurantRooms(businessId);
          const roomsArray = Array.isArray(rooms) ? rooms : [];
          const roomsMap = new Map<number, string>();
          roomsArray.forEach((room: { id: number; name: string }) => {
            if (room.id) {
              roomsMap.set(room.id, room.name);
            }
          });

          // Fetch tables for each room to find the table
          for (const room of roomsArray) {
            if (room.id) {
              const tables = await electronAPI.getRestaurantTables(room.id);
              const tablesArray = Array.isArray(tables) ? tables : [];
              const foundTable = tablesArray.find((table: { id: number; table_number: string; room_id: number }) => 
                table.id === transaction.table_id
              );
              if (foundTable) {
                tableName = foundTable.table_number;
                roomName = roomsMap.get(foundTable.room_id) || null;
                break;
              }
            }
          }
        } catch (error) {
          console.error('Error fetching table/room info:', error);
        }
      }

      // Fetch transaction items
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'POSLayout.tsx:495',message:'Before fetching transaction items',data:{transactionId,transactionUuidId:transaction.uuid_id,transactionIdField:transaction.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
      // #endregion
      const transactionItems = await electronAPI.localDbGetTransactionItems?.(transactionId);
      const itemsArray = Array.isArray(transactionItems) ? transactionItems : [];
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'POSLayout.tsx:499',message:'Transaction items fetched',data:{transactionId,itemsCount:itemsArray.length,firstItem:itemsArray.length>0?{uuid_transaction_id:itemsArray[0].uuid_transaction_id,transaction_id:itemsArray[0].transaction_id,product_id:itemsArray[0].product_id,uuid_transaction_idType:typeof itemsArray[0].uuid_transaction_id,transaction_idType:typeof itemsArray[0].transaction_id}:null,allItemsUuidTransactionIds:itemsArray.map((i:any)=>i.uuid_transaction_id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
      console.log('📦 Transaction items fetched:', itemsArray.length);

      if (itemsArray.length === 0) {
        alert('Tidak ada item dalam transaksi ini');
        return;
      }

      // Fetch customizations for this transaction
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'POSLayout.tsx:516',message:'Before fetching customizations',data:{transactionId,transactionIdType:typeof transactionId,itemsCount:itemsArray.length,itemIds:itemsArray.map((item:any)=>item.id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AB'})}).catch(()=>{});
      // #endregion
      const customizationsData = await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(transactionId);
      const customizations = customizationsData?.customizations || [];
      const customizationOptions = customizationsData?.options || [];
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'POSLayout.tsx:521',message:'After fetching customizations',data:{transactionId,customizationsCount:customizations.length,optionsCount:customizationOptions.length,customizationsData:customizations.length>0?customizations.map((c:any)=>({id:c.id,transaction_item_id:c.transaction_item_id,customization_type_id:c.customization_type_id,customization_type_name:c.customization_type_name})):[],optionsData:customizationOptions.length>0?customizationOptions.map((o:any)=>({id:o.id,transaction_item_customization_id:o.transaction_item_customization_id,option_name:o.option_name})):[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AC'})}).catch(()=>{});
      // #endregion
      console.log('🎨 Customizations fetched:', customizations.length, 'customizations,', customizationOptions.length, 'options');

      // Create a map of transaction_item_id -> customizations
      const customizationsMap = new Map<number, Array<{
        customization_id: number;
        customization_name: string;
        selected_options: Array<{
          option_id: number;
          option_name: string;
          price_adjustment: number;
        }>;
      }>>();

      // Create a map of item database ID -> item for quick lookup
      const itemsByIdMap = new Map<number, any>();
      itemsArray.forEach((item: any) => {
        if (item.id) {
          itemsByIdMap.set(item.id, item);
        }
      });

      // Group customizations by transaction_item_id (can be string or number)
      customizations.forEach((cust: any) => {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'POSLayout.tsx:547',message:'Processing customization',data:{custId:cust.id,transactionItemId:cust.transaction_item_id,transactionItemIdType:typeof cust.transaction_item_id,customizationTypeId:cust.customization_type_id,customizationTypeName:cust.customization_type_name,itemsByIdMapHasItem:itemsByIdMap.has(typeof cust.transaction_item_id==='string'?parseInt(cust.transaction_item_id,10):cust.transaction_item_id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        // transaction_item_id might be string or number, convert to number for matching
        const itemId = typeof cust.transaction_item_id === 'string' 
          ? parseInt(cust.transaction_item_id, 10) 
          : cust.transaction_item_id;
        
        // Skip if item not found
        if (!itemsByIdMap.has(itemId)) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'POSLayout.tsx:554',message:'Skipping customization - item not found',data:{itemId,itemsByIdMapKeys:Array.from(itemsByIdMap.keys())},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
          return;
        }

        if (!customizationsMap.has(itemId)) {
          customizationsMap.set(itemId, []);
        }

        // Find options for this customization
        const options = customizationOptions.filter((opt: any) => 
          opt.transaction_item_customization_id === cust.id
        ).map((opt: any) => {
          // Ensure price_adjustment is a number (database might return string)
          const priceAdj = typeof opt.price_adjustment === 'number' 
            ? opt.price_adjustment 
            : (typeof opt.price_adjustment === 'string' ? parseFloat(opt.price_adjustment) || 0 : 0);
          return {
            option_id: opt.customization_option_id,
            option_name: opt.option_name,
            price_adjustment: priceAdj,
          };
        });
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'POSLayout.tsx:563',message:'Found options for customization',data:{custId:cust.id,customizationTypeId:cust.customization_type_id,optionsCount:options.length,options:options.map((o:any)=>({option_id:o.option_id,option_name:o.option_name,price_adjustment:o.price_adjustment})),allOptionsCount:customizationOptions.length,matchingOptions:customizationOptions.filter((opt:any)=>opt.transaction_item_customization_id===cust.id).map((o:any)=>({id:o.id,transaction_item_customization_id:o.transaction_item_customization_id,option_name:o.option_name}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
        // #endregion

        // Find or create customization type entry
        const custTypeId = cust.customization_type_id;
        const existingCust = customizationsMap.get(itemId)!.find(c => 
          c.customization_id === custTypeId
        );

        if (existingCust) {
          existingCust.selected_options.push(...options);
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'POSLayout.tsx:577',message:'Added options to existing customization',data:{itemId,custTypeId,existingCustOptionsCount:existingCust.selected_options.length,addedOptionsCount:options.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
          // #endregion
        } else {
          // Use customization_type_name from the query result (already fetched via JOIN)
          const customizationName = (cust.customization_type_name as string) || `Customization ${custTypeId}`;
          customizationsMap.get(itemId)!.push({
            customization_id: custTypeId,
            customization_name: customizationName,
            selected_options: options,
          });
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'POSLayout.tsx:582',message:'Created new customization entry',data:{itemId,custTypeId,customizationName,optionsCount:options.length,options:options.map((o:any)=>({option_id:o.option_id,option_name:o.option_name}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
          // #endregion
        }
      });

      // Fetch all products to get product details
      const allProducts = await electronAPI.localDbGetAllProducts?.();
      const productsArray = Array.isArray(allProducts) ? allProducts : [];
      const productsMap = new Map<number, any>();
      productsArray.forEach((p: any) => {
        if (p.id) {
          productsMap.set(p.id, p);
        }
      });

      // Convert transaction items to cart items
      const cartItems: CartItem[] = itemsArray.map((item: any) => {
        const product = productsMap.get(item.product_id);
        if (!product) {
          console.warn(`Product ${item.product_id} not found`);
          return null;
        }

        // Get customizations for this item
        const itemCustomizations = customizationsMap.get(item.id) || [];
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'POSLayout.tsx:609',message:'Creating cart item with customizations',data:{itemId:item.id,productId:item.product_id,productName:product.nama,itemCustomizationsCount:itemCustomizations.length,itemCustomizations:itemCustomizations.map((c:any)=>({customization_id:c.customization_id,customization_name:c.customization_name,selected_options_count:c.selected_options?.length||0,selected_options:c.selected_options?.map((o:any)=>({option_id:o.option_id,option_name:o.option_name}))||[]}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
        // #endregion

        return {
          id: Date.now() + Math.random(), // Generate unique ID for cart
          product: {
            id: product.id,
            menu_code: product.menu_code || '',
            nama: product.nama || '',
            satuan: product.satuan || '',
            category1_id: product.category1_id,
            category2_id: product.category2_id,
            category1_name: product.category1_name,
            category2_name: product.category2_name,
            harga_jual: product.harga_jual || 0,
            harga_qpon: product.harga_qpon,
            harga_gofood: product.harga_gofood,
            harga_grabfood: product.harga_grabfood,
            harga_shopeefood: product.harga_shopeefood,
            harga_tiktok: product.harga_tiktok,
            image_url: product.image_url,
            status: product.status || 'active',
          },
          quantity: item.quantity || 1,
          customizations: itemCustomizations.length > 0 ? itemCustomizations : undefined,
          customNote: item.custom_note || undefined,
          bundleSelections: item.bundle_selections_json 
            ? JSON.parse(item.bundle_selections_json) 
            : undefined,
          isLocked: true, // Mark as locked
          transactionItemId: item.id, // Database transaction_item ID
          transactionId: transactionId, // Transaction UUID
          tableId: transaction.table_id || null,
        };
      }).filter((item): item is CartItem => item !== null);

      // Load into cart (use offline cart since we're loading a pending transaction)
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'POSLayout.tsx:645',message:'Setting offline cart',data:{cartItemsCount:cartItems.length,firstItem:cartItems.length>0?{productName:cartItems[0].product.nama,hasCustomizations:!!cartItems[0].customizations,customizationsCount:cartItems[0].customizations?.length||0,firstCustomization:cartItems[0].customizations?.[0]?{name:cartItems[0].customizations[0].customization_name,optionsCount:cartItems[0].customizations[0].selected_options?.length||0,options:cartItems[0].customizations[0].selected_options?.map((o:any)=>({name:o.option_name}))||[]}:null}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
      setOfflineCart(cartItems);
      setIsOnlineTab(false);
      setSelectedOnlinePlatform(null);
      
      // Set loaded transaction info for display
      setLoadedTransactionInfo({
        transactionId: transactionId,
        tableName,
        roomName,
        customerName: transaction.customer_name || null,
      });

      // Switch to Kasir page if not already there
      if (activeMenuItem !== 'Kasir') {
        setActiveMenuItem('Kasir');
      }

      // Close Active Orders tab
      setShowActiveOrders(false);

      console.log(`✅ Loaded ${cartItems.length} items from transaction ${transactionId} into cart`);
    } catch (error) {
      console.error('Error loading transaction into cart:', error);
      alert('Gagal memuat transaksi ke keranjang. Silakan coba lagi.');
    }
  };

  const renderMainContent = () => {
    switch (activeMenuItem) {
      case 'Kasir':
        return (
          <div className="flex-1 flex flex-col h-full min-h-0">
            {/* Kasir Tabs - NEW STRUCTURE */}
            <div className="bg-white border-b border-gray-200 px-4 py-2 relative">
              <div className="flex space-x-2 flex-wrap items-center justify-between">
                <div className="flex space-x-2 flex-wrap items-center">
                  {/* Offline Tab */}
                  <button
                    onClick={() => { setIsOnlineTab(false); setSelectedOnlinePlatform(null); setShowActiveOrders(false); }}
                    className={`px-6 py-2 rounded-lg font-medium transition-colors ${!isOnlineTab && !showActiveOrders
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                  >
                    🏪 Offline
                  </button>

                  {/* Online Section with Platform Buttons */}
                  <div className={`flex items-center rounded-lg overflow-hidden ${isOnlineTab && !showActiveOrders ? 'bg-blue-600' : 'bg-gray-100'
                    }`}>
                    <div
                      className={`px-4 py-2 font-medium cursor-default ${isOnlineTab && !showActiveOrders ? 'text-white' : 'text-gray-700'
                        }`}
                    >
                      🌐 Online
                    </div>

                    <div className="flex h-full">
                      <button
                        onClick={() => { setSelectedOnlinePlatform('gofood'); setIsOnlineTab(true); setShowActiveOrders(false); }}
                        className={`px-3 py-1 text-sm font-medium transition-colors h-full ${selectedOnlinePlatform === 'gofood' && isOnlineTab && !showActiveOrders
                          ? 'bg-green-600 text-white'
                          : isOnlineTab && !showActiveOrders ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                          }`}
                      >
                        GoFood
                      </button>
                      <button
                        onClick={() => { setSelectedOnlinePlatform('grabfood'); setIsOnlineTab(true); setShowActiveOrders(false); }}
                        className={`px-3 py-1 text-sm font-medium transition-colors h-full ${selectedOnlinePlatform === 'grabfood' && isOnlineTab && !showActiveOrders
                          ? 'bg-green-600 text-white'
                          : isOnlineTab && !showActiveOrders ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                          }`}
                      >
                        Grab
                      </button>
                      <button
                        onClick={() => { setSelectedOnlinePlatform('shopeefood'); setIsOnlineTab(true); setShowActiveOrders(false); }}
                        className={`px-3 py-1 text-sm font-medium transition-colors h-full ${selectedOnlinePlatform === 'shopeefood' && isOnlineTab && !showActiveOrders
                          ? 'bg-green-600 text-white'
                          : isOnlineTab && !showActiveOrders ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                          }`}
                      >
                        Shopee
                      </button>
                      <button
                        onClick={() => { setSelectedOnlinePlatform('qpon'); setIsOnlineTab(true); setShowActiveOrders(false); }}
                        className={`px-3 py-1 text-sm font-medium transition-colors h-full ${selectedOnlinePlatform === 'qpon' && isOnlineTab && !showActiveOrders
                          ? 'bg-green-600 text-white'
                          : isOnlineTab && !showActiveOrders ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                          }`}
                      >
                        Qpon
                      </button>
                      <button
                        onClick={() => { setSelectedOnlinePlatform('tiktok'); setIsOnlineTab(true); setShowActiveOrders(false); }}
                        className={`px-3 py-1 text-sm font-medium transition-colors h-full rounded-r-lg ${selectedOnlinePlatform === 'tiktok' && isOnlineTab && !showActiveOrders
                          ? 'bg-green-600 text-white'
                          : isOnlineTab && !showActiveOrders ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                          }`}
                      >
                        TikTok
                      </button>
                    </div>
                  </div>
                </div>

                {/* New and Active Orders Buttons - Right Side */}
                <div className="flex items-center gap-2">
                  {/* New Button */}
                  <button
                    onClick={clearAllCarts}
                    className="px-6 py-2 rounded-lg font-medium transition-colors border-2 border-blue-500 bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-2"
                  >
                    <FilePlus className="w-4 h-4" />
                    New
                  </button>

                  {/* Active Orders Tab Button */}
                  <button
                    onClick={() => {
                      setShowActiveOrders(!showActiveOrders);
                      if (!showActiveOrders) {
                        setIsOnlineTab(false);
                        setSelectedOnlinePlatform(null);
                      }
                    }}
                    className={`px-6 py-2 rounded-lg font-medium transition-colors relative border-2 border-green-500 ${showActiveOrders
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      } flex items-center gap-2`}
                  >
                    <ClipboardList className="w-4 h-4" />
                    Active Orders
                    {pendingOrdersCount > 0 && (
                      <span className="ml-1 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-red-600 rounded-full">
                        {pendingOrdersCount > 99 ? '99+' : pendingOrdersCount}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex h-full min-h-0 relative">
              {/* Active Orders Tab - Overlay when active */}
              {showActiveOrders && (
                <ActiveOrdersTab 
                  businessId={businessId} 
                  isOpen={showActiveOrders}
                  onLoadTransaction={loadTransactionIntoCart}
                />
              )}

              {/* Center Content - Products filtered by selected category */}
              {!showActiveOrders && (
                <>
                  <CenterContent
                    products={products}
                    cartItems={getCurrentCart()}
                    setCartItems={setCurrentCart}
                    transactionType={categories.find(c => c.jenis === selectedCategory)?.productType || 'drinks'}
                    isLoadingProducts={isLoadingProducts}
                    isOnline={isOnlineTab}
                    selectedOnlinePlatform={selectedOnlinePlatform}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    loadedTransactionInfo={loadedTransactionInfo}
                  />

                  {/* Right Sidebar - Categories from database */}
                  <RightSidebar
                    categories={categories}
                    selectedCategory={selectedCategory}
                    onCategorySelect={setSelectedCategory}
                    isLoadingCategories={isLoadingCategories || isLoadingProducts}
                  />
                </>
              )}
            </div>
          </div>
        );

      case 'Daftar Transaksi':
        return <TransactionList businessId={businessId} />;

      case 'Ganti Shift':
        return <GantiShift />;

      case 'Laporan':
        return <Laporan />;

      case 'Setelan':
        if (!canAccessSync && !canAccessPrinter) {
          return (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-2">
                <h2 className="text-lg font-semibold text-gray-700">Akses Ditolak</h2>
                <p className="text-gray-500 text-sm">
                  Anda tidak memiliki izin untuk membuka menu Setelan.
                </p>
              </div>
            </div>
          );
        }
        return (
          <div className="flex-1 flex flex-col h-full overflow-y-auto overflow-x-hidden">
            {/* Settings Tabs */}
            <div className="border-b border-gray-200 mb-6 flex-shrink-0 bg-white">
              <nav className="-mb-px flex space-x-8 mt-4 px-6">
                {canAccessSync && (
                  <button
                    onClick={() => setActiveSettingsTab('sync')}
                    className={`py-2 px-1 border-b-2 font-semibold text-lg ${activeSettingsTab === 'sync'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                  >
                    Sinkronisasi
                  </button>
                )}
                <button
                  onClick={() => setActiveSettingsTab('slideshow')}
                  className={`py-2 px-1 border-b-2 font-semibold text-lg ${activeSettingsTab === 'slideshow'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                >
                  Slideshow Manager
                </button>
                {canAccessPrinter && (
                  <button
                    onClick={() => setActiveSettingsTab('printers')}
                    className={`py-2 px-1 border-b-2 font-semibold text-lg ${activeSettingsTab === 'printers'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                  >
                    Printer Setup
                  </button>
                )}
                <button
                  onClick={() => setActiveSettingsTab('server')}
                  className={`py-2 px-1 border-b-2 font-semibold text-lg ${activeSettingsTab === 'server'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                >
                  Server
                </button>
              </nav>
            </div>

            {/* Settings Content - Scrollable vertically only */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
              {activeSettingsTab === 'sync' && canAccessSync && <SyncManagement />}
              {activeSettingsTab === 'slideshow' && <SlideshowManager />}
              {activeSettingsTab === 'printers' && canAccessPrinter && <PrinterSetup />}
              {activeSettingsTab === 'server' && <ServerSettings />}
            </div>
          </div>
        );

      case 'Setelan Global':
        return (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-gray-100">
            <div className="flex-1 overflow-y-auto">
              <GlobalSettings />
            </div>
          </div>
        );

      case 'Table':
        return <TableLayout />;

      case 'Kitchen':
        return <KitchenDisplay />;

      case 'Barista':
        return <BaristaDisplay />;

      default:
        return (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-xl font-semibold text-gray-600 mb-2">
                {activeMenuItem}
              </h2>
              <p className="text-gray-500">This feature is coming soon!</p>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="flex flex-1 h-full min-h-0 bg-gray-100 overflow-hidden">
      {/* Left Sidebar - Always accessible */}
      <LeftSidebar
        menuItems={mockMenuItems}
        activeMenuItem={activeMenuItem}
        onMenuItemClick={setActiveMenuItem}
      />

      {/* Main Content Area - Blurred when shift modal is shown on Kasir page */}
      <div className={`flex-1 relative ${showStartShiftModal && activeMenuItem === 'Kasir' ? 'blur-sm pointer-events-none' : ''}`}>
        {renderMainContent()}
      </div>

      {/* Start Shift Modal - Only show on Kasir page */}
      {activeMenuItem === 'Kasir' && user && (
        <StartShiftModal
          isOpen={showStartShiftModal}
          userId={typeof user.id === 'string' ? parseInt(user.id, 10) : user.id}
          userName={user.name || 'Cashier'}
          businessId={businessId}
          onShiftStarted={() => {
            setShowStartShiftModal(false);
            setHasCheckedShift(false); // Allow re-checking if needed
          }}
        />
      )}
    </div>
  );
}
