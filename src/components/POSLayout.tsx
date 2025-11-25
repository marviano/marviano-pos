'use client';

import { useState, useEffect, type ComponentProps } from 'react';
import LeftSidebar from './LeftSidebar';
import RightSidebar from './RightSidebar';
import CenterContent from './CenterContent';
import SlideshowManager from './SlideshowManager';
import TransactionList from './TransactionList';
import PrinterSetup from './PrinterSetup';
import OfflineDebugPanel from './OfflineDebugPanel';
import SyncManagement from './SyncManagement';
import GantiShift from './GantiShift';
import Laporan from './Laporan';
import { mockMenuItems } from '@/data/mockData';
import { fetchCategories, fetchProducts } from '@/lib/offlineDataFetcher';
import { databaseHealthService } from '@/lib/databaseHealth';
import { useAuth } from '@/hooks/useAuth';
import { isSuperAdmin } from '@/lib/auth';

type LocalCategory = {
  jenis: string;
  active: boolean;
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

export default function POSLayout() {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const isAdmin = isSuperAdmin(user);
  const canAccessSync = isAdmin ||
    permissions.includes('setelan.sinkronisasi') ||
    permissions.includes('marviano-pos_setelan_sinkronisasi');
  const canAccessPrinter = isAdmin ||
    permissions.includes('setelan.printersetup') ||
    permissions.includes('marviano-pos_setelan_printer-setup');
  const [selectedCategory, setSelectedCategory] = useState('');
  
  // Separate carts for each category - offline
  const [drinksCart, setDrinksCart] = useState<CartItem[]>([]);
  const [bakeryCart, setBakeryCart] = useState<CartItem[]>([]);
  
  // Separate carts for each platform - online
  const [drinksGofoodCart, setDrinksGofoodCart] = useState<CartItem[]>([]);
  const [drinksGrabfoodCart, setDrinksGrabfoodCart] = useState<CartItem[]>([]);
  const [drinksShopeefoodCart, setDrinksShopeefoodCart] = useState<CartItem[]>([]);
  const [drinksTiktokCart, setDrinksTiktokCart] = useState<CartItem[]>([]);
  const [drinksQponCart, setDrinksQponCart] = useState<CartItem[]>([]);
  const [bakeryGofoodCart, setBakeryGofoodCart] = useState<CartItem[]>([]);
  const [bakeryGrabfoodCart, setBakeryGrabfoodCart] = useState<CartItem[]>([]);
  const [bakeryShopeefoodCart, setBakeryShopeefoodCart] = useState<CartItem[]>([]);
  const [bakeryTiktokCart, setBakeryTiktokCart] = useState<CartItem[]>([]);
  const [bakeryQponCart, setBakeryQponCart] = useState<CartItem[]>([]);
  
  const [activeMenuItem, setActiveMenuItem] = useState('Kasir');
  const [activeKasirTab, setActiveKasirTab] = useState<'drinks' | 'bakery'>('drinks');
  const [isOnlineTab, setIsOnlineTab] = useState<boolean>(false);
  const [selectedOnlinePlatform, setSelectedOnlinePlatform] = useState<OnlinePlatform | null>(null);
  const [activeSettingsTab, setActiveSettingsTab] = useState('sync');
  const [categories, setCategories] = useState<LocalCategory[]>([]); // Start with empty array
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [products, setProducts] = useState<Product[]>([]); // Start with empty array
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);

  // Helper functions to get current cart based on active tab and platform
  const getCurrentCart = (): CartItem[] => {
    // Offline carts
    if (activeKasirTab === 'drinks' && !isOnlineTab) return drinksCart;
    if (activeKasirTab === 'bakery' && !isOnlineTab) return bakeryCart;
    
    // Online carts - Drinks platforms
    if (activeKasirTab === 'drinks' && isOnlineTab && selectedOnlinePlatform === 'qpon') return drinksQponCart;
    if (activeKasirTab === 'drinks' && isOnlineTab && selectedOnlinePlatform === 'gofood') return drinksGofoodCart;
    if (activeKasirTab === 'drinks' && isOnlineTab && selectedOnlinePlatform === 'grabfood') return drinksGrabfoodCart;
    if (activeKasirTab === 'drinks' && isOnlineTab && selectedOnlinePlatform === 'shopeefood') return drinksShopeefoodCart;
    if (activeKasirTab === 'drinks' && isOnlineTab && selectedOnlinePlatform === 'tiktok') return drinksTiktokCart;
    
    // Online carts - Bakery platforms
    if (activeKasirTab === 'bakery' && isOnlineTab && selectedOnlinePlatform === 'qpon') return bakeryQponCart;
    if (activeKasirTab === 'bakery' && isOnlineTab && selectedOnlinePlatform === 'gofood') return bakeryGofoodCart;
    if (activeKasirTab === 'bakery' && isOnlineTab && selectedOnlinePlatform === 'grabfood') return bakeryGrabfoodCart;
    if (activeKasirTab === 'bakery' && isOnlineTab && selectedOnlinePlatform === 'shopeefood') return bakeryShopeefoodCart;
    if (activeKasirTab === 'bakery' && isOnlineTab && selectedOnlinePlatform === 'tiktok') return bakeryTiktokCart;
    
    return drinksCart; // fallback
  };

  const setCurrentCart = (newCart: CartItem[]) => {
    // Offline carts
    if (activeKasirTab === 'drinks' && !isOnlineTab) {
      setDrinksCart(newCart);
    } else if (activeKasirTab === 'bakery' && !isOnlineTab) {
      setBakeryCart(newCart);
    } 
    // Online carts - Drinks platforms
    else if (activeKasirTab === 'drinks' && isOnlineTab && selectedOnlinePlatform === 'qpon') {
      setDrinksQponCart(newCart);
    } else if (activeKasirTab === 'drinks' && isOnlineTab && selectedOnlinePlatform === 'gofood') {
      setDrinksGofoodCart(newCart);
    } else if (activeKasirTab === 'drinks' && isOnlineTab && selectedOnlinePlatform === 'grabfood') {
      setDrinksGrabfoodCart(newCart);
    } else if (activeKasirTab === 'drinks' && isOnlineTab && selectedOnlinePlatform === 'shopeefood') {
      setDrinksShopeefoodCart(newCart);
    } else if (activeKasirTab === 'drinks' && isOnlineTab && selectedOnlinePlatform === 'tiktok') {
      setDrinksTiktokCart(newCart);
    }
    // Online carts - Bakery platforms
    else if (activeKasirTab === 'bakery' && isOnlineTab && selectedOnlinePlatform === 'qpon') {
      setBakeryQponCart(newCart);
    } else if (activeKasirTab === 'bakery' && isOnlineTab && selectedOnlinePlatform === 'gofood') {
      setBakeryGofoodCart(newCart);
    } else if (activeKasirTab === 'bakery' && isOnlineTab && selectedOnlinePlatform === 'grabfood') {
      setBakeryGrabfoodCart(newCart);
    } else if (activeKasirTab === 'bakery' && isOnlineTab && selectedOnlinePlatform === 'shopeefood') {
      setBakeryShopeefoodCart(newCart);
    } else if (activeKasirTab === 'bakery' && isOnlineTab && selectedOnlinePlatform === 'tiktok') {
      setBakeryTiktokCart(newCart);
    }
  };

  // Send tab updates to customer display
  const sendTabUpdate = (tabInfo: { activeTab: string; isOnline: boolean; selectedPlatform?: OnlinePlatform | null }) => {
    const electronAPI = getElectronAPI();
    electronAPI?.updateCustomerDisplay?.({ tabInfo });
  };

  // Fetch categories from database (business_id = 14) with offline fallback
  useEffect(() => {
    let isCancelled = false;
    setIsLoadingCategories(true);

    const loadCategories = async () => {
      try {
        const categoriesData = await fetchCategories(activeKasirTab, { 
          isOnline: isOnlineTab,
          platform: isOnlineTab ? (selectedOnlinePlatform ?? undefined) : undefined
        }) as Array<{ jenis: string; active?: boolean }>;
        
        if (isCancelled) {
          return;
        }

        // Filter out empty/invalid categories and map to expected type
        const validCategories: LocalCategory[] = categoriesData
          .filter(cat => cat.jenis && cat.jenis.trim() !== '')
          .map(cat => ({ jenis: cat.jenis, active: cat.active ?? true }));
        
        if (validCategories.length > 0) {
          setCategories(validCategories as unknown as LocalCategory[]);
          // Always set the first valid category as selected - this will trigger product loading
          setSelectedCategory(validCategories[0].jenis);
        } else {
          setCategories([] as LocalCategory[]);
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
  }, [activeKasirTab, isOnlineTab, selectedOnlinePlatform]);

  // Fetch products when category or tab changes (business_id = 14) with offline fallback
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
        // Use smart offline/online mode - only force online for online tab
        const productsData = await fetchProducts(selectedCategory, activeKasirTab, { 
          isOnline: isOnlineTab,
          platform: isOnlineTab ? (selectedOnlinePlatform ?? undefined) : undefined
        });
        
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
  }, [selectedCategory, activeKasirTab, isOnlineTab, selectedOnlinePlatform]); // Re-fetch when category or tab changes

  // Reset platform selection when switching away from online tab
  useEffect(() => {
    if (!isOnlineTab) {
      setSelectedOnlinePlatform(null);
    }
  }, [isOnlineTab]);

  // Send tab updates to customer display when tab changes
  useEffect(() => {
    const tabName = `${activeKasirTab}${isOnlineTab ? ' (Online)' : ''}`;
    
    const electronAPI = getElectronAPI();
    if (!electronAPI) {
      return;
    }
    sendTabUpdate({ activeTab: tabName, isOnline: isOnlineTab, selectedPlatform: selectedOnlinePlatform });
  }, [activeKasirTab, isOnlineTab, selectedOnlinePlatform]);

  // Check database health on mount and ensure it's populated
  useEffect(() => {
    const checkDatabaseHealth = async () => {
      try {
        // If database is empty, try to populate it
        const health = await databaseHealthService.checkDatabaseHealth();
        if (health.needsSync) {
          console.log('🔄 Database is empty, performing initial sync...');
          const success = await databaseHealthService.ensureDatabasePopulated();
          if (success) {
            console.log('✅ Database populated successfully');
          } else {
            console.warn('⚠️ Failed to populate database');
          }
        }
      } catch (error) {
        console.error('❌ Error checking database health:', error);
      }
    };

    checkDatabaseHealth();
  }, []);

  // Listen for data sync events to refresh categories and products
  useEffect(() => {
    const handleDataSynced = async () => {
      console.log('🔄 Data synced event received, refreshing categories and products...');
      setIsLoadingCategories(true);
      setIsLoadingProducts(true);
      
      try {
        const refreshedCategories = await fetchCategories(activeKasirTab, { 
          isOnline: isOnlineTab,
          platform: isOnlineTab ? (selectedOnlinePlatform ?? undefined) : undefined
        });
        const validCategories: LocalCategory[] = (refreshedCategories as Array<{ jenis: string; active?: boolean }>)
          .filter(cat => cat.jenis && cat.jenis.trim() !== '')
          .map(cat => ({ jenis: cat.jenis, active: cat.active ?? true }));
        setCategories(validCategories);
        
        if (validCategories.length > 0 && validCategories[0].jenis) {
          setSelectedCategory(validCategories[0].jenis);
          const refreshedProducts = await fetchProducts(validCategories[0].jenis, activeKasirTab, { 
            isOnline: isOnlineTab,
            platform: isOnlineTab ? (selectedOnlinePlatform ?? undefined) : undefined
          });
          setProducts(refreshedProducts);
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
  }, [activeKasirTab, isOnlineTab, selectedOnlinePlatform]);

  const renderMainContent = () => {
    switch (activeMenuItem) {
      case 'Kasir':
        return (
          <div className="flex-1 flex flex-col h-full min-h-0">
            {/* Kasir Tabs */}
            <div className="bg-white border-b border-gray-200 px-4 py-2">
              <div className="flex space-x-1 flex-wrap">
                <button
                  onClick={() => { setActiveKasirTab('drinks'); setIsOnlineTab(false); }}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    activeKasirTab === 'drinks'
                      && !isOnlineTab ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  🥤 Drinks
                </button>
                <button
                  onClick={() => { setActiveKasirTab('bakery'); setIsOnlineTab(false); }}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    activeKasirTab === 'bakery'
                      && !isOnlineTab ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  🥖 Bakery
                </button>

                {/* Drinks Online with integrated platform buttons */}
                <div className={`flex items-center rounded-lg overflow-hidden ${
                  activeKasirTab === 'drinks' && isOnlineTab
                    ? 'bg-blue-600'
                    : 'bg-gray-100'
                }`}>
                  <div
                    className={`px-4 py-2 font-medium cursor-default ${
                      activeKasirTab === 'drinks' && isOnlineTab
                        ? 'text-white'
                        : 'text-gray-700'
                    }`}
                  >
                    🥤 Drinks (Online)
                  </div>
                  
                  <div className="flex h-full">
                    <button
                      onClick={() => { setSelectedOnlinePlatform('gofood'); setActiveKasirTab('drinks'); setIsOnlineTab(true); }}
                      className={`px-2 py-1 text-xs font-medium transition-colors h-full ${
                        selectedOnlinePlatform === 'gofood' && activeKasirTab === 'drinks' && isOnlineTab
                          ? 'bg-green-600 text-white'
                          : activeKasirTab === 'drinks' && isOnlineTab ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      GoFood
                    </button>
                    <button
                      onClick={() => { setSelectedOnlinePlatform('grabfood'); setActiveKasirTab('drinks'); setIsOnlineTab(true); }}
                      className={`px-2 py-1 text-xs font-medium transition-colors h-full ${
                        selectedOnlinePlatform === 'grabfood' && activeKasirTab === 'drinks' && isOnlineTab
                          ? 'bg-green-600 text-white'
                          : activeKasirTab === 'drinks' && isOnlineTab ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      Grab
                    </button>
                    <button
                      onClick={() => { setSelectedOnlinePlatform('shopeefood'); setActiveKasirTab('drinks'); setIsOnlineTab(true); }}
                      className={`px-2 py-1 text-xs font-medium transition-colors h-full ${
                        selectedOnlinePlatform === 'shopeefood' && activeKasirTab === 'drinks' && isOnlineTab
                          ? 'bg-green-600 text-white'
                          : activeKasirTab === 'drinks' && isOnlineTab ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      Shopee
                    </button>
                    <button
                      onClick={() => { setSelectedOnlinePlatform('qpon'); setActiveKasirTab('drinks'); setIsOnlineTab(true); }}
                      className={`px-2 py-1 text-xs font-medium transition-colors h-full ${
                        selectedOnlinePlatform === 'qpon' && activeKasirTab === 'drinks' && isOnlineTab
                          ? 'bg-green-600 text-white'
                          : activeKasirTab === 'drinks' && isOnlineTab ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      Qpon
                    </button>
                    <button
                      onClick={() => { setSelectedOnlinePlatform('tiktok'); setActiveKasirTab('drinks'); setIsOnlineTab(true); }}
                      className={`px-2 py-1 text-xs font-medium transition-colors h-full rounded-r-lg ${
                        selectedOnlinePlatform === 'tiktok' && activeKasirTab === 'drinks' && isOnlineTab
                          ? 'bg-green-600 text-white'
                          : activeKasirTab === 'drinks' && isOnlineTab ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      TikTok
                    </button>
                  </div>
                </div>

                {/* Bakery Online with integrated platform buttons */}
                <div className={`flex items-center rounded-lg overflow-hidden ${
                  activeKasirTab === 'bakery' && isOnlineTab
                    ? 'bg-blue-600'
                    : 'bg-gray-100'
                }`}>
                  <div
                    className={`px-4 py-2 font-medium cursor-default ${
                      activeKasirTab === 'bakery' && isOnlineTab
                        ? 'text-white'
                        : 'text-gray-700'
                    }`}
                  >
                    🥖 Bakery (Online)
                  </div>
                  
                  <div className="flex h-full">
                  <button
                    onClick={() => { setSelectedOnlinePlatform('gofood'); setActiveKasirTab('bakery'); setIsOnlineTab(true); }}
                    className={`px-2 py-1 text-xs font-medium transition-colors h-full ${
                      selectedOnlinePlatform === 'gofood' && activeKasirTab === 'bakery' && isOnlineTab
                        ? 'bg-green-600 text-white'
                        : activeKasirTab === 'bakery' && isOnlineTab ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    GoFood
                  </button>
                  <button
                    onClick={() => { setSelectedOnlinePlatform('grabfood'); setActiveKasirTab('bakery'); setIsOnlineTab(true); }}
                    className={`px-2 py-1 text-xs font-medium transition-colors h-full ${
                      selectedOnlinePlatform === 'grabfood' && activeKasirTab === 'bakery' && isOnlineTab
                        ? 'bg-green-600 text-white'
                        : activeKasirTab === 'bakery' && isOnlineTab ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Grab
                  </button>
                  <button
                    onClick={() => { setSelectedOnlinePlatform('shopeefood'); setActiveKasirTab('bakery'); setIsOnlineTab(true); }}
                    className={`px-2 py-1 text-xs font-medium transition-colors h-full ${
                      selectedOnlinePlatform === 'shopeefood' && activeKasirTab === 'bakery' && isOnlineTab
                        ? 'bg-green-600 text-white'
                        : activeKasirTab === 'bakery' && isOnlineTab ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Shopee
                  </button>
                  <button
                    onClick={() => { setSelectedOnlinePlatform('qpon'); setActiveKasirTab('bakery'); setIsOnlineTab(true); }}
                    className={`px-2 py-1 text-xs font-medium transition-colors h-full ${
                      selectedOnlinePlatform === 'qpon' && activeKasirTab === 'bakery' && isOnlineTab
                        ? 'bg-green-600 text-white'
                        : activeKasirTab === 'bakery' && isOnlineTab ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Qpon
                  </button>
                  <button
                    onClick={() => { setSelectedOnlinePlatform('tiktok'); setActiveKasirTab('bakery'); setIsOnlineTab(true); }}
                    className={`px-2 py-1 text-xs font-medium transition-colors h-full rounded-r-lg ${
                      selectedOnlinePlatform === 'tiktok' && activeKasirTab === 'bakery' && isOnlineTab
                        ? 'bg-green-600 text-white'
                        : activeKasirTab === 'bakery' && isOnlineTab ? 'text-white hover:bg-blue-700' : 'text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    TikTok
                  </button>
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
                transactionType={activeKasirTab}
                isLoadingProducts={isLoadingProducts}
                isOnline={isOnlineTab}
                selectedOnlinePlatform={selectedOnlinePlatform}
              />
              
              {/* Right Sidebar - Categories from database (business_id = 14) */}
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
        return <TransactionList businessId={14} />;
      
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
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="max-w-6xl mx-auto w-full flex flex-col h-full">
              {/* Settings Tabs */}
              <div className="border-b border-gray-200 mb-6">
                <nav className="-mb-px flex space-x-8 mt-4">
                  {canAccessSync && (
                    <button
                      onClick={() => setActiveSettingsTab('sync')}
                      className={`py-2 px-1 border-b-2 font-semibold text-lg ${
                        activeSettingsTab === 'sync'
                          ? 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      Sinkronisasi
                    </button>
                  )}
                  <button
                    onClick={() => setActiveSettingsTab('slideshow')}
                    className={`py-2 px-1 border-b-2 font-semibold text-lg ${
                      activeSettingsTab === 'slideshow'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    Slideshow Manager
                  </button>
                  {canAccessPrinter && (
                    <button
                      onClick={() => setActiveSettingsTab('printers')}
                      className={`py-2 px-1 border-b-2 font-semibold text-lg ${
                        activeSettingsTab === 'printers'
                          ? 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      Printer Setup
                    </button>
                  )}
                  <button
                    onClick={() => setActiveSettingsTab('debug')}
                    className={`py-2 px-1 border-b-2 font-semibold text-lg ${
                      activeSettingsTab === 'debug'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    Offline Debug
                  </button>
                </nav>
              </div>
              
              {/* Settings Content */}
              <div className="flex-1 overflow-y-auto">
                {activeSettingsTab === 'sync' && canAccessSync && <SyncManagement />}
                {activeSettingsTab === 'slideshow' && <SlideshowManager />}
                {activeSettingsTab === 'printers' && canAccessPrinter && <PrinterSetup />}
                {activeSettingsTab === 'debug' && <OfflineDebugPanel />}
              </div>
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
      {/* Left Sidebar */}
      <LeftSidebar 
        menuItems={mockMenuItems}
        activeMenuItem={activeMenuItem}
        onMenuItemClick={setActiveMenuItem}
      />
      
      {/* Main Content Area */}
      {renderMainContent()}
    </div>
  );
}
