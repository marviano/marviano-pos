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
import { mockMenuItems } from '@/data/mockData';
import { fetchCategories, fetchProducts } from '@/lib/offlineDataFetcher';
import { databaseHealthService } from '@/lib/databaseHealth';
import { useAuth } from '@/hooks/useAuth';
import { isSuperAdmin } from '@/lib/auth';

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
          setProducts(productsData);
        }
      } catch (error) {
        if (!isCancelled) {
          console.error('❌ Error loading products:', error);
          setProducts([]);
        }
      } finally {
        if (!isCancelled) {
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

  const renderMainContent = () => {
    switch (activeMenuItem) {
      case 'Kasir':
        return (
          <div className="flex-1 flex flex-col h-full min-h-0">
            {/* Kasir Tabs - NEW STRUCTURE */}
            <div className="bg-white border-b border-gray-200 px-4 py-2">
              <div className="flex space-x-2 flex-wrap items-center justify-between">
                <div className="flex space-x-2 flex-wrap items-center">
                  {/* Offline Tab */}
                  <button
                    onClick={() => { setIsOnlineTab(false); setSelectedOnlinePlatform(null); }}
                    className={`px-6 py-2 rounded-lg font-medium transition-colors ${!isOnlineTab
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                  >
                    🏪 Offline
                  </button>

                  {/* Online Section with Platform Buttons */}
                  <div className={`flex items-center rounded-lg overflow-hidden ${isOnlineTab ? 'bg-blue-600' : 'bg-gray-100'
                    }`}>
                    <div
                      className={`px-4 py-2 font-medium cursor-default ${isOnlineTab ? 'text-white' : 'text-gray-700'
                        }`}
                    >
                      🌐 Online
                    </div>

                    <div className="flex h-full">
                      <button
                        onClick={() => { setSelectedOnlinePlatform('gofood'); setIsOnlineTab(true); }}
                        className={`px-3 py-1 text-sm font-medium transition-colors h-full ${selectedOnlinePlatform === 'gofood' && isOnlineTab
                          ? 'bg-green-600 text-white'
                          : isOnlineTab ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                          }`}
                      >
                        GoFood
                      </button>
                      <button
                        onClick={() => { setSelectedOnlinePlatform('grabfood'); setIsOnlineTab(true); }}
                        className={`px-3 py-1 text-sm font-medium transition-colors h-full ${selectedOnlinePlatform === 'grabfood' && isOnlineTab
                          ? 'bg-green-600 text-white'
                          : isOnlineTab ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                          }`}
                      >
                        Grab
                      </button>
                      <button
                        onClick={() => { setSelectedOnlinePlatform('shopeefood'); setIsOnlineTab(true); }}
                        className={`px-3 py-1 text-sm font-medium transition-colors h-full ${selectedOnlinePlatform === 'shopeefood' && isOnlineTab
                          ? 'bg-green-600 text-white'
                          : isOnlineTab ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                          }`}
                      >
                        Shopee
                      </button>
                      <button
                        onClick={() => { setSelectedOnlinePlatform('qpon'); setIsOnlineTab(true); }}
                        className={`px-3 py-1 text-sm font-medium transition-colors h-full ${selectedOnlinePlatform === 'qpon' && isOnlineTab
                          ? 'bg-green-600 text-white'
                          : isOnlineTab ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                          }`}
                      >
                        Qpon
                      </button>
                      <button
                        onClick={() => { setSelectedOnlinePlatform('tiktok'); setIsOnlineTab(true); }}
                        className={`px-3 py-1 text-sm font-medium transition-colors h-full rounded-r-lg ${selectedOnlinePlatform === 'tiktok' && isOnlineTab
                          ? 'bg-green-600 text-white'
                          : isOnlineTab ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                          }`}
                      >
                        TikTok
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex h-full min-h-0">
              {/* Center Content - Products filtered by selected category */}
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
              />

              {/* Right Sidebar - Categories from database */}
              <RightSidebar
                categories={categories}
                selectedCategory={selectedCategory}
                onCategorySelect={setSelectedCategory}
                isLoadingCategories={isLoadingCategories || isLoadingProducts}
              />
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
              </nav>
            </div>

            {/* Settings Content - Scrollable vertically only */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
              {activeSettingsTab === 'sync' && canAccessSync && <SyncManagement />}
              {activeSettingsTab === 'slideshow' && <SlideshowManager />}
              {activeSettingsTab === 'printers' && canAccessPrinter && <PrinterSetup />}
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
