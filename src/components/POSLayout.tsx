'use client';

import { useState, useEffect } from 'react';
import LeftSidebar from './LeftSidebar';
import RightSidebar from './RightSidebar';
import CenterContent from './CenterContent';
import BottomBar from './BottomBar';
import SlideshowManager from './SlideshowManager';
import TransactionList from './TransactionList';
import PrinterSetup from './PrinterSetup';
import OfflineDebugPanel from './OfflineDebugPanel';
import SyncManagement from './SyncManagement';
import GantiShift from './GantiShift';
import { mockMenuItems } from '@/data/mockData';
import { fetchCategories, fetchProducts } from '@/lib/offlineDataFetcher';
import { databaseHealthService } from '@/lib/databaseHealth';
import { useAuth } from '@/hooks/useAuth';

interface Category {
  jenis: string;
  active: boolean;
}

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

export default function POSLayout() {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const canAccessSync = permissions.includes('marviano-pos_setelan_sinkronisasi');
  const canAccessPrinter = permissions.includes('marviano-pos_setelan_printer-setup');
  const [selectedCategory, setSelectedCategory] = useState('');
  
  // Separate carts for each category - offline
  const [drinksCart, setDrinksCart] = useState<any[]>([]);
  const [bakeryCart, setBakeryCart] = useState<any[]>([]);
  
  // Separate carts for each platform - online
  const [drinksGofoodCart, setDrinksGofoodCart] = useState<any[]>([]);
  const [drinksGrabfoodCart, setDrinksGrabfoodCart] = useState<any[]>([]);
  const [drinksShopeefoodCart, setDrinksShopeefoodCart] = useState<any[]>([]);
  const [drinksTiktokCart, setDrinksTiktokCart] = useState<any[]>([]);
  const [drinksQponCart, setDrinksQponCart] = useState<any[]>([]);
  const [bakeryGofoodCart, setBakeryGofoodCart] = useState<any[]>([]);
  const [bakeryGrabfoodCart, setBakeryGrabfoodCart] = useState<any[]>([]);
  const [bakeryShopeefoodCart, setBakeryShopeefoodCart] = useState<any[]>([]);
  const [bakeryTiktokCart, setBakeryTiktokCart] = useState<any[]>([]);
  const [bakeryQponCart, setBakeryQponCart] = useState<any[]>([]);
  
  const [activeMenuItem, setActiveMenuItem] = useState('Kasir');
  const [activeKasirTab, setActiveKasirTab] = useState<'drinks' | 'bakery'>('drinks');
  const [isOnlineTab, setIsOnlineTab] = useState<boolean>(false);
  const [selectedOnlinePlatform, setSelectedOnlinePlatform] = useState<'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' | null>(null);
  const [activeSettingsTab, setActiveSettingsTab] = useState('sync');
  const [categories, setCategories] = useState<Category[]>([]); // Start with empty array
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [products, setProducts] = useState<Product[]>([]); // Start with empty array
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [isSwitchingCategory, setIsSwitchingCategory] = useState(false);

  // Helper functions to get current cart based on active tab and platform
  const getCurrentCart = () => {
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

  const setCurrentCart = (newCart: any[]) => {
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

  // Function to clear current cart after payment
  const clearCurrentCart = () => {
    setCurrentCart([]);
  };

  // Send tab updates to customer display
  const sendTabUpdate = (tabInfo: { activeTab: string; isOnline: boolean; selectedPlatform?: 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' | null }) => {
    if (window.electronAPI && window.electronAPI.updateCustomerDisplay) {
      window.electronAPI.updateCustomerDisplay({ tabInfo });
    }
  };

  // Fetch categories from database (business_id = 14) with offline fallback
  useEffect(() => {
    const loadCategories = async () => {
      try {
        console.log('📦 Fetching categories from database for tab:', activeKasirTab, 'online:', isOnlineTab, 'platform:', selectedOnlinePlatform);
        const categoriesData = await fetchCategories(activeKasirTab, { 
          isOnline: isOnlineTab,
          platform: isOnlineTab ? (selectedOnlinePlatform ?? undefined) : undefined
        });
        
        // Filter out empty/invalid categories
        const validCategories = categoriesData.filter(cat => cat.jenis && cat.jenis.trim() !== '');
        
        if (validCategories.length > 0) {
          console.log('✅ Categories loaded:', validCategories);
          setCategories(validCategories);
          // Always set the first valid category as selected - this will trigger product loading
          setSelectedCategory(validCategories[0].jenis);
        } else {
          console.log('⚠️ No categories available');
          setCategories([]);
          setSelectedCategory(''); // Clear selection if no categories
        }
      } catch (error) {
        console.error('❌ Error loading categories:', error);
        setCategories([]);
        setSelectedCategory('');
      } finally {
        setIsLoadingCategories(false);
      }
    };

    loadCategories();
  }, [activeKasirTab, isOnlineTab, selectedOnlinePlatform]);

  // Fetch products when category or tab changes (business_id = 14) with offline fallback
  useEffect(() => {
    const loadProducts = async () => {
      if (!selectedCategory) {
        console.log('⚠️ No category selected, skipping product load');
        setIsLoadingProducts(false); // Ensure loading state is cleared
        setProducts([]);
        return;
      }

      setIsLoadingProducts(true);
      setIsSwitchingCategory(true);
      try {
        console.log('📦 Fetching products for category:', selectedCategory, 'tab:', activeKasirTab, 'online:', isOnlineTab, 'platform:', selectedOnlinePlatform);
        // Use smart offline/online mode - only force online for online tab
        const productsData = await fetchProducts(selectedCategory, activeKasirTab, { 
          isOnline: isOnlineTab,
          platform: isOnlineTab ? (selectedOnlinePlatform ?? undefined) : undefined
        });
        
        console.log('✅ Products loaded:', productsData.length, 'items');
        setProducts(productsData);
      } catch (error) {
        console.error('❌ Error loading products:', error);
        setProducts([]);
      } finally {
        setIsLoadingProducts(false);
        setIsSwitchingCategory(false);
      }
    };

    loadProducts();
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
    console.log('📤 Sending tab update to customer display:', { activeTab: tabName, isOnline: isOnlineTab, selectedPlatform: selectedOnlinePlatform });
    
    // Check if electronAPI is available
    if (window.electronAPI) {
      console.log('📤 ElectronAPI is available, sending tab update...');
      sendTabUpdate({ activeTab: tabName, isOnline: isOnlineTab, selectedPlatform: selectedOnlinePlatform });
    } else {
      console.log('❌ ElectronAPI is not available');
    }
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
        const validCategories = refreshedCategories.filter(cat => cat.jenis && cat.jenis.trim() !== '');
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
  }, [activeKasirTab, isOnlineTab]);

  const renderMainContent = () => {
    switch (activeMenuItem) {
      case 'Kasir':
        return (
          <div className="flex-1 flex flex-col h-full">
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
            <div className="flex-1 flex h-full">
              {/* Center Content - Products filtered by selected category */}
              <CenterContent 
                products={products}
                cartItems={getCurrentCart()}
                setCartItems={setCurrentCart}
                transactionType={activeKasirTab}
                isLoadingProducts={isSwitchingCategory}
                isOnline={isOnlineTab}
                selectedOnlinePlatform={selectedOnlinePlatform}
              />
              
              {/* Right Sidebar - Categories from database (business_id = 14) */}
              <RightSidebar 
                categories={categories}
                selectedCategory={selectedCategory}
                onCategorySelect={setSelectedCategory}
                isLoadingCategories={isSwitchingCategory || isLoadingCategories}
              />
            </div>
          </div>
        );
      
      case 'Daftar Transaksi':
        return <TransactionList businessId={14} />;
      
      case 'Ganti Shift':
        return <GantiShift />;
      
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
          <div className="flex-1 flex flex-col overflow-hidden">
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
    <div className="flex h-screen bg-gray-100 overflow-hidden">
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
