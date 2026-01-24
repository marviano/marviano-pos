'use client';

import { useState, useEffect, type ComponentProps, useCallback } from 'react';
import LeftSidebar from './LeftSidebar';
import RightSidebar from './RightSidebar';
import CenterContent from './CenterContent';
import SlideshowManager from './SlideshowManager';
import TransactionList from './TransactionList';
import PrinterSetup from './PrinterSetup';
import SyncManagement from './SyncManagement';
import GantiShift from './GantiShift';
import Laporan from './Laporan';
import GlobalSettings from './GlobalSettings';
import StartShiftModal from './StartShiftModal';
import ActiveOrdersTab from './ActiveOrdersTab';
import KitchenDisplay from './KitchenDisplay';
import BaristaDisplay from './BaristaDisplay';
import ReceiptTemplateSettings from './ReceiptTemplateSettings';
import { mockMenuItems } from '@/data/mockData';
import { fetchCategories, fetchProducts } from '@/lib/offlineDataFetcher';
import { offlineSyncService } from '@/lib/offlineSync';
import { useAuth } from '@/hooks/useAuth';
import { isSuperAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { ClipboardList, FilePlus, ChevronRight, Store, Globe } from 'lucide-react';

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
  const [selectedCategory, setSelectedCategory] = useState('');

  // Use external state if provided, otherwise use internal state
  const [internalActiveMenuItem, setInternalActiveMenuItem] = useState('Kasir');
  const activeMenuItem = externalActiveMenuItem ?? internalActiveMenuItem;
  
  // Sidebar visibility state - auto-hide for Kitchen/Barista displays
  const [sidebarVisible, setSidebarVisible] = useState(true);

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
    waiterName: string | null;
    waiterColor: string | null;
  } | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  const [categories, setCategories] = useState<LocalCategory[]>([]); // Start with empty array
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [products, setProducts] = useState<Product[]>([]); // Start with empty array
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showStartShiftModal, setShowStartShiftModal] = useState(false);
  const [hasCheckedShift, setHasCheckedShift] = useState(false);

  // Early return if user is not loaded yet
  if (!user) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center p-8 bg-white rounded-lg shadow-lg">
          <h2 className="text-xl font-bold text-gray-600 mb-2">Loading...</h2>
          <p className="text-gray-700">Loading user data...</p>
        </div>
      </div>
    );
  }

  // Get business ID from logged-in user
  const businessId = user.selectedBusinessId;
  
  const permissions = user.permissions ?? [];
  const isAdmin = isSuperAdmin(user);
  const canAccessSync = isAdmin ||
    permissions.includes('setelan.sinkronisasi') ||
    permissions.includes('marviano-pos_setelan_sinkronisasi');
  const canAccessPrinter = isAdmin ||
    permissions.includes('setelan.printersetup') ||
    permissions.includes('marviano-pos_setelan_printer-setup');
  
  // Helper function to check and prompt for unsaved changes
  const checkUnsavedChanges = (): boolean => {
    if (hasUnsavedChanges) {
      // Show different message based on whether we're in "lihat" mode
      let message = 'Ada perubahan yang belum disimpan pada cart, apakah anda yakin untuk berpindah halaman?';
      if (loadedTransactionInfo && loadedTransactionInfo.customerName) {
        message = `Ada perubahan pada orderan pelanggan: ${loadedTransactionInfo.customerName}. Apakah anda yakin untuk berpindah halaman sebelum simpan pesanan?`;
      } else if (loadedTransactionInfo) {
        message = 'Ada perubahan pada orderan pelanggan. Apakah anda yakin untuk berpindah halaman sebelum simpan pesanan?';
      }
      const confirmed = window.confirm(message);
      if (!confirmed) {
        return false; // User cancelled, don't proceed
      }
      setHasUnsavedChanges(false); // Clear flag if user confirms
    }
    return true; // Proceed with action
  };
  
  // Wrapper for setActiveMenuItem with unsaved changes check
  const setActiveMenuItemWithCheck = (item: string) => {
    // If trying to change page and there are unsaved changes, show confirmation
    if (activeMenuItem !== item && activeMenuItem === 'Kasir' && !checkUnsavedChanges()) {
      return; // Don't change page if user cancels
    }
    const setter = externalSetActiveMenuItem ?? setInternalActiveMenuItem;
    setter(item);
  };
  
  const setActiveMenuItem = setActiveMenuItemWithCheck;
  
  // Auto-hide sidebar when switching to Kitchen/Barista
  useEffect(() => {
    if (activeMenuItem === 'Kitchen' || activeMenuItem === 'Barista') {
      setSidebarVisible(false);
    } else {
      setSidebarVisible(true);
    }
  }, [activeMenuItem]);

  // Handle opening Barista & Kitchen window
  useEffect(() => {
    if (activeMenuItem === 'Barista & Kitchen') {
      const canAccess = isSuperAdmin(user) || hasPermission(user, 'access_baristaandkitchen');
      
      if (canAccess) {
        const electronAPI = getElectronAPI();
        if (electronAPI?.createBaristaKitchenWindow) {
          electronAPI.createBaristaKitchenWindow()
            .then((result) => {
              console.log('✅ Barista & Kitchen window result:', result);
              if (result?.success === false) {
                console.error('❌ Failed to create window:', result.error);
                alert(`Failed to open Barista & Kitchen window: ${result.error || 'Unknown error'}`);
              }
            })
            .catch((error) => {
              console.error('❌ Error creating Barista & Kitchen window:', error);
              alert(`Error opening window: ${error instanceof Error ? error.message : String(error)}`);
            });
        } else {
          console.error('❌ createBaristaKitchenWindow method not available');
          alert('Window creation method not available. Please check Electron API.');
        }
      }
    }
  }, [activeMenuItem, user]);
  
  if (!businessId) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center p-8 bg-white rounded-lg shadow-lg">
          <h2 className="text-xl font-bold text-red-600 mb-2">No Business Selected</h2>
          <p className="text-gray-700">Please log in and select a business to access the POS system.</p>
        </div>
      </div>
    );
  }

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
    if (!businessId || !fetchCategories) return;
    
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
    if (!businessId || !fetchProducts) return;
    
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

  // Auto-sync master data on app startup to get latest data
  useEffect(() => {
    if (!businessId || !offlineSyncService) return;
    
    const syncOnStartup = async () => {
      try {
        // console.log('🔄 [STARTUP] Auto-syncing master data on app start...');
        // Use the complete sync function (same as manual sync button)
        if (typeof offlineSyncService.syncFromOnline === 'function') {
          await offlineSyncService.syncFromOnline(businessId);
          // Trigger UI refresh to show new data
          window.dispatchEvent(new CustomEvent('dataSynced'));
        }
      } catch (error) {
        console.error('❌ [STARTUP] Error syncing on startup:', error);
        // Don't block app startup if sync fails - use cached data
      }
    };

    syncOnStartup();
  }, [businessId]);

  // Listen for data sync events to refresh categories and products
  useEffect(() => {
    if (!businessId || !fetchCategories || !fetchProducts) return;
    
    const handleDataSynced = async () => {
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
    if (!businessId) return;
    if (activeMenuItem === 'Kasir' && user.id && !hasCheckedShift) {
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
  }, [activeMenuItem, user.id, businessId, hasCheckedShift]);

  // Fetch pending orders count when on Kasir page
  useEffect(() => {
    if (!businessId) return;
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
      
      // Listen for immediate refresh when transaction is saved
      const handlePendingTransactionSaved = () => {
        fetchPendingCount();
      };
      window.addEventListener('pendingTransactionSaved', handlePendingTransactionSaved);
      
      // Refresh count every 5 seconds
      const interval = setInterval(fetchPendingCount, 5000);
      return () => {
        clearInterval(interval);
        window.removeEventListener('pendingTransactionSaved', handlePendingTransactionSaved);
      };
    } else {
      setPendingOrdersCount(0);
    }
  }, [activeMenuItem, businessId]);

  // Load transaction into cart function
  const loadTransactionIntoCart = async (transactionId: string) => {
    if (!businessId) {
      console.error('❌ No business ID available');
      return;
    }
    
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
      const transactionsArray = Array.isArray(transactions) ? transactions as Record<string, unknown>[] : [];const transaction = transactionsArray.find((tx) => 
        tx.uuid_id === transactionId || tx.id === transactionId
      ) as Record<string, unknown> | undefined;if (!transaction) {
        alert('Transaksi tidak ditemukan');
        return;
      }

      // Fetch table and room info if table_id exists
      let tableName: string | null = null;
      let roomName: string | null = null;
      if (transaction.table_id && electronAPI.getRestaurantTables && electronAPI.getRestaurantRooms) {
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
      const transactionItems = await electronAPI.localDbGetTransactionItems?.(transactionId);
      const itemsArray = Array.isArray(transactionItems) ? transactionItems as Record<string, unknown>[] : [];
      console.log('📦 Transaction items fetched:', itemsArray.length);

      if (itemsArray.length === 0) {
        alert('Tidak ada item dalam transaksi ini');
        return;
      }

      // Fetch customizations for this transaction
      const customizationsData = await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(transactionId);
      const customizations = Array.isArray(customizationsData?.customizations) ? customizationsData.customizations as Record<string, unknown>[] : [];
      const customizationOptions = customizationsData?.options || [];
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
      const itemsByIdMap = new Map<number, Record<string, unknown>>();
      itemsArray.forEach((item) => {
        const id = typeof item.id === 'number' ? item.id : (typeof item.id === 'string' ? parseInt(item.id, 10) : null);
        if (id) {
          itemsByIdMap.set(id, item);
        }
      });

      // Group customizations by transaction_item_id (can be string or number)
      customizations.forEach((cust) => {
        // transaction_item_id might be string or number, convert to number for matching
        const itemId = typeof cust.transaction_item_id === 'number' 
          ? cust.transaction_item_id 
          : (typeof cust.transaction_item_id === 'string' ? parseInt(cust.transaction_item_id, 10) : null);// Skip if item not found
        if (!itemId || !itemsByIdMap.has(itemId)) {return;
        }

        if (!customizationsMap.has(itemId)) {
          customizationsMap.set(itemId, []);
        }

        // Find options for this customization
        const options = customizationOptions.filter((opt) => 
          opt.transaction_item_customization_id === cust.id
        ).map((opt) => {
          // Ensure price_adjustment is a number (database might return string)
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
        });// Find or create customization type entry
        const custTypeId = typeof cust.customization_type_id === 'number' 
          ? cust.customization_type_id 
          : (typeof cust.customization_type_id === 'string' ? parseInt(cust.customization_type_id, 10) : 0);
        const existingCust = customizationsMap.get(itemId)!.find(c => 
          c.customization_id === custTypeId
        );

        if (existingCust) {
          existingCust.selected_options.push(...options);} else {
          // Use customization_type_name from the query result (already fetched via JOIN)
          const customizationName = (cust.customization_type_name as string) || `Customization ${custTypeId}`;
          customizationsMap.get(itemId)!.push({
            customization_id: custTypeId,
            customization_name: customizationName,
            selected_options: options,
          });}
      });

      // Fetch all products to get product details
      const allProducts = await electronAPI.localDbGetAllProducts?.();
      const productsArray = Array.isArray(allProducts) ? allProducts as Record<string, unknown>[] : [];
      const productsMap = new Map<number, Record<string, unknown>>();
      productsArray.forEach((p) => {
        const id = typeof p.id === 'number' ? p.id : (typeof p.id === 'string' ? parseInt(p.id, 10) : null);
        if (id) {
          productsMap.set(id, p);
        }
      });

      // Convert transaction items to cart items
      // Filter out cancelled items - they should not be loaded into cart
      const activeItems = itemsArray.filter((item) => {
        const productionStatus = typeof item.production_status === 'string' ? item.production_status : null;
        return productionStatus !== 'cancelled';
      });
      
      const cartItems = activeItems.map((item) => {
        const productId = typeof item.product_id === 'number' ? item.product_id : (typeof item.product_id === 'string' ? parseInt(item.product_id, 10) : null);
        if (!productId) return null;
        
        const product = productsMap.get(productId);
        if (!product) {
          console.warn(`Product ${productId} not found`);
          return null;
        }

        // Get customizations for this item
        const itemId = typeof item.id === 'number' ? item.id : (typeof item.id === 'string' ? parseInt(item.id, 10) : null);
        const itemCustomizations: Array<{
          customization_id: number;
          customization_name: string;
          selected_options: Array<{
            option_id: number;
            option_name: string;
            price_adjustment: number;
          }>;
        }> = itemId ? (customizationsMap.get(itemId) || []) : [];const productIdValue = typeof product.id === 'number' ? product.id : (typeof product.id === 'string' ? parseInt(product.id, 10) : 0);
        const itemQuantity = typeof item.quantity === 'number' ? item.quantity : (typeof item.quantity === 'string' ? parseInt(item.quantity, 10) : 1);
        const itemCustomNote = typeof item.custom_note === 'string' ? item.custom_note : undefined;
        const itemBundleSelections = typeof item.bundle_selections_json === 'string' ? item.bundle_selections_json : undefined;
        const transactionTableId = typeof transaction.table_id === 'number' ? transaction.table_id : (typeof transaction.table_id === 'string' ? parseInt(transaction.table_id, 10) : null);
        
        // Check if item should be locked
        // In "lihat" mode, ALL items should be locked because they've already been saved to the transaction
        // Items with production_status IS NULL or 'preparing' are visible on kitchen/barista and should be locked
        // Items with production_status 'finished' should also be locked because they've been saved
        // The only items that shouldn't be locked are cancelled items, but those are already filtered out above
        const productionStatus = typeof item.production_status === 'string' ? item.production_status : (item.production_status === null ? null : String(item.production_status || ''));
        // ALL items in "lihat" mode should be locked (they've all been saved to the transaction)
        const isItemLocked = true;

        return {
          id: Date.now() + Math.random(), // Generate unique ID for cart
          product: {
            id: productIdValue,
            menu_code: typeof product.menu_code === 'string' ? product.menu_code : '',
            nama: typeof product.nama === 'string' ? product.nama : '',
            satuan: typeof product.satuan === 'string' ? product.satuan : '',
            category1_id: typeof product.category1_id === 'number' ? product.category1_id : undefined,
            category2_id: typeof product.category2_id === 'number' ? product.category2_id : undefined,
            category1_name: typeof product.category1_name === 'string' ? product.category1_name : undefined,
            category2_name: typeof product.category2_name === 'string' ? product.category2_name : undefined,
            harga_jual: typeof product.harga_jual === 'number' ? product.harga_jual : 0,
            harga_qpon: typeof product.harga_qpon === 'number' ? product.harga_qpon : undefined,
            harga_gofood: typeof product.harga_gofood === 'number' ? product.harga_gofood : undefined,
            harga_grabfood: typeof product.harga_grabfood === 'number' ? product.harga_grabfood : undefined,
            harga_shopeefood: typeof product.harga_shopeefood === 'number' ? product.harga_shopeefood : undefined,
            harga_tiktok: typeof product.harga_tiktok === 'number' ? product.harga_tiktok : undefined,
            image_url: typeof product.image_url === 'string' ? product.image_url : undefined,
            status: typeof product.status === 'string' ? product.status : 'active',
          },
          quantity: itemQuantity,
          customizations: itemCustomizations.length > 0 ? itemCustomizations : undefined,
          customNote: itemCustomNote,
          bundleSelections: itemBundleSelections 
            ? JSON.parse(itemBundleSelections) 
            : undefined,
          isLocked: isItemLocked, // Lock items that are visible on kitchen/barista (production_status IS NULL or 'preparing')
          transactionItemId: itemId || 0, // Database transaction_item ID
          transactionId: transactionId, // Transaction UUID
          tableId: transactionTableId,
        };
      }).filter((item) => item !== null) as CartItem[];

      // Load into cart (use offline cart since we're loading a pending transaction)
      setOfflineCart(cartItems);
      setIsOnlineTab(false);
      setSelectedOnlinePlatform(null);
      
      // Fetch waiter information if waiter_id exists
      let waiterName: string | null = null;
      let waiterColor: string | null = null;
      const waiterId = typeof transaction.waiter_id === 'number' ? transaction.waiter_id : (typeof transaction.waiter_id === 'string' ? parseInt(transaction.waiter_id, 10) : null);
      if (waiterId && electronAPI.localDbGetEmployees) {
        try {
          const allEmployees = await electronAPI.localDbGetEmployees();
          const employeesArray = Array.isArray(allEmployees) ? allEmployees : [];
          const waiter = employeesArray.find((emp: { id?: number | string; nama_karyawan?: string; color?: string | null }) => {
            const empId = typeof emp.id === 'number' ? emp.id : (typeof emp.id === 'string' ? parseInt(emp.id, 10) : null);
            return empId === waiterId;
          });
          if (waiter && typeof waiter.nama_karyawan === 'string') {
            waiterName = waiter.nama_karyawan;
            waiterColor = typeof waiter.color === 'string' && waiter.color ? waiter.color : null;
          }
        } catch (error) {
          console.warn('Failed to fetch waiter information:', error);
        }
      }

      // Set loaded transaction info for display
      const customerName = typeof transaction.customer_name === 'string' ? transaction.customer_name : null;
      setLoadedTransactionInfo({
        transactionId: transactionId,
        tableName,
        roomName,
        customerName,
        waiterName,
        waiterColor,
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
      case 'Kasir': {
        // Check permission to access Kasir page
        const canAccessKasir = isSuperAdmin(user) || hasPermission(user, 'access_kasir');
        if (!canAccessKasir) {
          return (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-2">
                <h2 className="text-lg font-semibold text-gray-700">Akses Ditolak</h2>
                <p className="text-gray-500 text-sm">
                  Anda tidak memiliki izin untuk mengakses halaman Kasir.
                </p>
              </div>
            </div>
          );
        }
        return (
          <div className="flex-1 flex flex-col h-full min-h-0">
            {/* Kasir Tabs - NEW STRUCTURE */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 relative">
              <div className="flex space-x-3 flex-wrap items-center justify-between">
                <div className="flex space-x-3 flex-wrap items-center">
                  {/* Offline Tab */}
                  <button
                    onClick={() => {
                      if (!checkUnsavedChanges()) return;
                      setIsOnlineTab(false);
                      setSelectedOnlinePlatform(null);
                      setShowActiveOrders(false);
                    }}
                    className={`group relative px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 flex items-center gap-2.5 ${
                      !isOnlineTab && !showActiveOrders
                        ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-lg hover:shadow-xl hover:scale-105 active:scale-100 border border-indigo-400/20'
                        : 'bg-white text-gray-700 hover:bg-gray-50 shadow-md hover:shadow-lg hover:scale-105 active:scale-100 border-2 border-indigo-500/30 hover:border-indigo-500/50'
                    }`}
                  >
                    <Store className={`w-4 h-4 transition-transform duration-300 ${!isOnlineTab && !showActiveOrders ? 'group-hover:scale-110' : 'group-hover:scale-110'}`} />
                    <span>Offline</span>
                    {!isOnlineTab && !showActiveOrders && (
                      <div className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/10 transition-colors duration-300"></div>
                    )}
                  </button>

                  {/* Online Section with Platform Buttons - Disabled in "lihat" mode */}
                  <div className={`flex items-center rounded-xl overflow-hidden shadow-md transition-all duration-300 ${
                    isOnlineTab && !showActiveOrders && !loadedTransactionInfo 
                      ? 'bg-gradient-to-r from-cyan-500 to-cyan-600 border border-cyan-400/20' 
                      : 'bg-white border-2 border-cyan-500/30'
                    } ${loadedTransactionInfo ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <div
                      className={`px-4 py-2.5 font-semibold text-sm flex items-center gap-2 transition-all duration-300 ${
                        isOnlineTab && !showActiveOrders && !loadedTransactionInfo 
                          ? 'text-white' 
                          : 'text-gray-700'
                        } ${loadedTransactionInfo ? 'cursor-not-allowed' : 'cursor-default'}`}
                    >
                      <Globe className="w-4 h-4" />
                      <span>Online</span>
                    </div>

                    <div className="flex h-full border-l border-cyan-400/20">
                      <button
                        onClick={() => {
                          if (loadedTransactionInfo) return; // Disabled in lihat mode
                          if (!checkUnsavedChanges()) return;
                          setSelectedOnlinePlatform('gofood');
                          setIsOnlineTab(true);
                          setShowActiveOrders(false);
                        }}
                        disabled={!!loadedTransactionInfo}
                        className={`group relative px-4 py-2.5 text-sm font-semibold transition-all duration-300 h-full ${
                          selectedOnlinePlatform === 'gofood' && isOnlineTab && !showActiveOrders && !loadedTransactionInfo
                            ? 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-inner'
                            : isOnlineTab && !showActiveOrders && !loadedTransactionInfo 
                              ? 'text-white hover:bg-cyan-700/50' 
                              : 'text-gray-700 hover:bg-gray-100'
                          } ${loadedTransactionInfo ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}`}
                      >
                        GoFood
                        {selectedOnlinePlatform === 'gofood' && isOnlineTab && !showActiveOrders && !loadedTransactionInfo && (
                          <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors duration-300"></div>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          if (loadedTransactionInfo) return; // Disabled in lihat mode
                          if (!checkUnsavedChanges()) return;
                          setSelectedOnlinePlatform('grabfood');
                          setIsOnlineTab(true);
                          setShowActiveOrders(false);
                        }}
                        disabled={!!loadedTransactionInfo}
                        className={`group relative px-4 py-2.5 text-sm font-semibold transition-all duration-300 h-full ${
                          selectedOnlinePlatform === 'grabfood' && isOnlineTab && !showActiveOrders && !loadedTransactionInfo
                            ? 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-inner'
                            : isOnlineTab && !showActiveOrders && !loadedTransactionInfo 
                              ? 'text-white hover:bg-cyan-700/50' 
                              : 'text-gray-700 hover:bg-gray-100'
                          } ${loadedTransactionInfo ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}`}
                      >
                        Grab
                        {selectedOnlinePlatform === 'grabfood' && isOnlineTab && !showActiveOrders && !loadedTransactionInfo && (
                          <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors duration-300"></div>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          if (loadedTransactionInfo) return; // Disabled in lihat mode
                          if (!checkUnsavedChanges()) return;
                          setSelectedOnlinePlatform('shopeefood');
                          setIsOnlineTab(true);
                          setShowActiveOrders(false);
                        }}
                        disabled={!!loadedTransactionInfo}
                        className={`group relative px-4 py-2.5 text-sm font-semibold transition-all duration-300 h-full ${
                          selectedOnlinePlatform === 'shopeefood' && isOnlineTab && !showActiveOrders && !loadedTransactionInfo
                            ? 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-inner'
                            : isOnlineTab && !showActiveOrders && !loadedTransactionInfo 
                              ? 'text-white hover:bg-cyan-700/50' 
                              : 'text-gray-700 hover:bg-gray-100'
                          } ${loadedTransactionInfo ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}`}
                      >
                        Shopee
                        {selectedOnlinePlatform === 'shopeefood' && isOnlineTab && !showActiveOrders && !loadedTransactionInfo && (
                          <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors duration-300"></div>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          if (loadedTransactionInfo) return; // Disabled in lihat mode
                          if (!checkUnsavedChanges()) return;
                          setSelectedOnlinePlatform('qpon');
                          setIsOnlineTab(true);
                          setShowActiveOrders(false);
                        }}
                        disabled={!!loadedTransactionInfo}
                        className={`group relative px-4 py-2.5 text-sm font-semibold transition-all duration-300 h-full ${
                          selectedOnlinePlatform === 'qpon' && isOnlineTab && !showActiveOrders && !loadedTransactionInfo
                            ? 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-inner'
                            : isOnlineTab && !showActiveOrders && !loadedTransactionInfo 
                              ? 'text-white hover:bg-cyan-700/50' 
                              : 'text-gray-700 hover:bg-gray-100'
                          } ${loadedTransactionInfo ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}`}
                      >
                        Qpon
                        {selectedOnlinePlatform === 'qpon' && isOnlineTab && !showActiveOrders && !loadedTransactionInfo && (
                          <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors duration-300"></div>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          if (loadedTransactionInfo) return; // Disabled in lihat mode
                          if (!checkUnsavedChanges()) return;
                          setSelectedOnlinePlatform('tiktok');
                          setIsOnlineTab(true);
                          setShowActiveOrders(false);
                        }}
                        disabled={!!loadedTransactionInfo}
                        className={`group relative px-4 py-2.5 text-sm font-semibold transition-all duration-300 h-full rounded-r-xl ${
                          selectedOnlinePlatform === 'tiktok' && isOnlineTab && !showActiveOrders && !loadedTransactionInfo
                            ? 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-inner'
                            : isOnlineTab && !showActiveOrders && !loadedTransactionInfo 
                              ? 'text-white hover:bg-cyan-700/50' 
                              : 'text-gray-700 hover:bg-gray-100'
                          } ${loadedTransactionInfo ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}`}
                      >
                        TikTok
                        {selectedOnlinePlatform === 'tiktok' && isOnlineTab && !showActiveOrders && !loadedTransactionInfo && (
                          <div className="absolute inset-0 rounded-r-xl bg-white/0 group-hover:bg-white/10 transition-colors duration-300"></div>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* New and Active Orders Buttons - Right Side */}
                <div className="flex items-center gap-3">
                  {/* New Button */}
                  <button
                    onClick={clearAllCarts}
                    className="group relative px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 flex items-center gap-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 shadow-lg hover:shadow-xl hover:scale-105 active:scale-100 border border-blue-400/20"
                  >
                    <FilePlus className="w-4 h-4 transition-transform duration-300 group-hover:rotate-90" />
                    <span>New</span>
                    <div className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/10 transition-colors duration-300"></div>
                  </button>

                  {/* Active Orders Tab Button */}
                  <button
                    onClick={() => {
                      // If trying to close Active Orders and there are unsaved changes, show confirmation
                      if (showActiveOrders && !checkUnsavedChanges()) {
                        return; // Don't close if user cancels
                      }
                      setShowActiveOrders(!showActiveOrders);
                      if (!showActiveOrders) {
                        setIsOnlineTab(false);
                        setSelectedOnlinePlatform(null);
                      }
                    }}
                    className={`group relative px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 flex items-center gap-2.5 ${
                      showActiveOrders
                        ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg hover:shadow-xl hover:scale-105 active:scale-100 border border-emerald-400/20'
                        : 'bg-white text-gray-700 hover:bg-gray-50 shadow-md hover:shadow-lg hover:scale-105 active:scale-100 border-2 border-emerald-500/30 hover:border-emerald-500/50'
                    }`}
                  >
                    <ClipboardList className={`w-4 h-4 transition-transform duration-300 ${showActiveOrders ? 'group-hover:scale-110' : 'group-hover:scale-110'}`} />
                    <span>Active Orders</span>
                    {pendingOrdersCount > 0 && (
                      <span className={`ml-1 inline-flex items-center justify-center min-w-[22px] h-5 px-2 text-xs font-bold leading-none rounded-full transition-all duration-300 ${
                        showActiveOrders 
                          ? 'text-emerald-600 bg-white shadow-sm' 
                          : 'text-white bg-gradient-to-r from-red-500 to-red-600 shadow-md'
                      }`}>
                        {pendingOrdersCount > 99 ? '99+' : pendingOrdersCount}
                      </span>
                    )}
                    {showActiveOrders && (
                      <div className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/10 transition-colors duration-300"></div>
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
                    onReloadTransaction={loadTransactionIntoCart}
                    onClearLoadedTransaction={() => {
                      setLoadedTransactionInfo(null);
                      setHasUnsavedChanges(false);
                    }}
                    onUnsavedChangesChange={setHasUnsavedChanges}
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
      }

      case 'Daftar Transaksi':
        return <TransactionList businessId={businessId} onLoadTransaction={loadTransactionIntoCart} />;

      case 'Ganti Shift': {
        // Check permission to access Ganti Shift page
        const canAccessGantiShift = isSuperAdmin(user) || hasPermission(user, 'access_gantishift');
        if (!canAccessGantiShift) {
          return (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-2">
                <h2 className="text-lg font-semibold text-gray-700">Akses Ditolak</h2>
                <p className="text-gray-500 text-sm">
                  Anda tidak memiliki izin untuk mengakses halaman Ganti Shift.
                </p>
              </div>
            </div>
          );
        }
        return <GantiShift />;
      }

      case 'Laporan': {
        // Check permission to access Laporan page
        const canAccessLaporan = isSuperAdmin(user) || hasPermission(user, 'access_laporan');
        if (!canAccessLaporan) {
          return (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-2">
                <h2 className="text-lg font-semibold text-gray-700">Akses Ditolak</h2>
                <p className="text-gray-500 text-sm">
                  Anda tidak memiliki izin untuk mengakses halaman Laporan.
                </p>
              </div>
            </div>
          );
        }
        return <Laporan />;
      }

      case 'Settings':
        if (!canAccessSync && !canAccessPrinter) {
          return (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-2">
                <h2 className="text-lg font-semibold text-gray-700">Akses Ditolak</h2>
                <p className="text-gray-500 text-sm">
                  Anda tidak memiliki izin untuk membuka menu Settings.
                </p>
              </div>
            </div>
          );
        }
        return (
          <div className="flex-1 flex flex-col h-full overflow-y-auto overflow-x-hidden">
            {/* Settings Tabs */}
            <div className="border-b border-gray-200 flex-shrink-0 bg-white">
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
                  onClick={() => setActiveSettingsTab('receipt-template')}
                  className={`py-2 px-1 border-b-2 font-semibold text-lg ${activeSettingsTab === 'receipt-template'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                >
                  Template Struk
                </button>
              </nav>
            </div>

            {/* Settings Content - Scrollable vertically only */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
              {activeSettingsTab === 'sync' && canAccessSync && <SyncManagement />}
              {activeSettingsTab === 'slideshow' && <SlideshowManager />}
              {activeSettingsTab === 'printers' && canAccessPrinter && <PrinterSetup />}
              {activeSettingsTab === 'receipt-template' && <ReceiptTemplateSettings />}
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

      case 'Kitchen':
        // Check permission before rendering
        if (!isSuperAdmin(user) && !hasPermission(user, 'access_kitchen')) {
          return (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center p-8 bg-white rounded-lg shadow-lg">
                <h2 className="text-xl font-bold text-red-600 mb-2">Access Denied</h2>
                <p className="text-gray-700">You do not have permission to access the Kitchen Display.</p>
              </div>
            </div>
          );
        }
        return <KitchenDisplay />;

      case 'Barista':
        // Check permission before rendering
        if (!isSuperAdmin(user) && !hasPermission(user, 'access_barista')) {
          return (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center p-8 bg-white rounded-lg shadow-lg">
                <h2 className="text-xl font-bold text-red-600 mb-2">Access Denied</h2>
                <p className="text-gray-700">You do not have permission to access the Barista Display.</p>
              </div>
            </div>
          );
        }
        return <BaristaDisplay />;

      case 'Barista & Kitchen':
        // Check permissions before opening window
        const canAccess = isSuperAdmin(user) || hasPermission(user, 'access_baristaandkitchen');
        
        if (!canAccess) {
          return (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center p-8 bg-white rounded-lg shadow-lg">
                <h2 className="text-xl font-bold text-red-600 mb-2">Access Denied</h2>
                <p className="text-gray-700">You need access_baristaandkitchen permission to open this window.</p>
              </div>
            </div>
          );
        }

        return (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center p-8 bg-white rounded-lg shadow-lg">
              <h2 className="text-xl font-bold text-blue-600 mb-2">Barista & Kitchen Window</h2>
              <p className="text-gray-700">A new window has been opened. You can close this view.</p>
            </div>
          </div>
        );

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
      {/* Left Sidebar - Conditionally rendered */}
      {sidebarVisible && (
        <LeftSidebar
          menuItems={mockMenuItems}
          activeMenuItem={activeMenuItem}
          onMenuItemClick={setActiveMenuItemWithCheck}
          onToggleSidebar={() => setSidebarVisible(!sidebarVisible)}
          isKitchenOrBarista={activeMenuItem === 'Kitchen' || activeMenuItem === 'Barista'}
        />
      )}

      {/* Toggle button when sidebar is hidden (for Kitchen/Barista) */}
      {!sidebarVisible && (activeMenuItem === 'Kitchen' || activeMenuItem === 'Barista') && (
        <button
          onClick={() => setSidebarVisible(true)}
          className="absolute left-0 bottom-6 z-50 bg-blue-800 text-white p-2 rounded-r-lg hover:bg-blue-900 transition-colors"
          title="Show Sidebar"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      )}

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
