'use client';

import { useState, useEffect } from 'react';
import LeftSidebar from './LeftSidebar';
import RightSidebar from './RightSidebar';
import CenterContent from './CenterContent';
import BottomBar from './BottomBar';
import SlideshowManager from './SlideshowManager';
import TransactionList from './TransactionList';
import PrinterSetup from './PrinterSetup';
import { mockMenuItems } from '@/data/mockData';
import { fetchCategories, fetchProducts } from '@/lib/offlineDataFetcher';

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
  harga_online: number | null;
  image_url: string | null;
  status: string;
}

export default function POSLayout() {
  const [selectedCategory, setSelectedCategory] = useState('');
  
  // Separate carts for each category
  const [drinksCart, setDrinksCart] = useState<any[]>([]);
  const [bakeryCart, setBakeryCart] = useState<any[]>([]);
  const [drinksOnlineCart, setDrinksOnlineCart] = useState<any[]>([]);
  const [bakeryOnlineCart, setBakeryOnlineCart] = useState<any[]>([]);
  
  const [activeMenuItem, setActiveMenuItem] = useState('Kasir');
  const [activeKasirTab, setActiveKasirTab] = useState<'drinks' | 'bakery'>('drinks');
  const [isOnlineTab, setIsOnlineTab] = useState<boolean>(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState('slideshow');
  const [categories, setCategories] = useState<Category[]>([]); // Start with empty array
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [products, setProducts] = useState<Product[]>([]); // Start with empty array
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [isSwitchingCategory, setIsSwitchingCategory] = useState(false);

  // Helper functions to get current cart based on active tab
  const getCurrentCart = () => {
    if (activeKasirTab === 'drinks' && !isOnlineTab) return drinksCart;
    if (activeKasirTab === 'bakery' && !isOnlineTab) return bakeryCart;
    if (activeKasirTab === 'drinks' && isOnlineTab) return drinksOnlineCart;
    if (activeKasirTab === 'bakery' && isOnlineTab) return bakeryOnlineCart;
    return drinksCart; // fallback
  };

  const setCurrentCart = (newCart: any[]) => {
    if (activeKasirTab === 'drinks' && !isOnlineTab) {
      setDrinksCart(newCart);
    } else if (activeKasirTab === 'bakery' && !isOnlineTab) {
      setBakeryCart(newCart);
    } else if (activeKasirTab === 'drinks' && isOnlineTab) {
      setDrinksOnlineCart(newCart);
    } else if (activeKasirTab === 'bakery' && isOnlineTab) {
      setBakeryOnlineCart(newCart);
    }
  };

  // Function to clear current cart after payment
  const clearCurrentCart = () => {
    setCurrentCart([]);
  };

  // Send tab updates to customer display
  const sendTabUpdate = (tabInfo: { activeTab: string; isOnline: boolean }) => {
    if (window.electronAPI && window.electronAPI.updateCustomerDisplay) {
      window.electronAPI.updateCustomerDisplay({ tabInfo });
    }
  };

  // Fetch categories from database (business_id = 14) with offline fallback
  useEffect(() => {
    const loadCategories = async () => {
      try {
        console.log('📦 Fetching categories from database for tab:', activeKasirTab, 'online:', isOnlineTab);
        const categoriesData = await fetchCategories(activeKasirTab, { isOnline: isOnlineTab });
        
        if (categoriesData.length > 0) {
          console.log('✅ Categories loaded:', categoriesData);
          setCategories(categoriesData);
          setSelectedCategory(categoriesData[0].jenis);
        } else {
          console.log('⚠️ No categories available');
          setCategories([]);
        }
      } catch (error) {
        console.error('❌ Error loading categories:', error);
        setCategories([]);
      } finally {
        setIsLoadingCategories(false);
      }
    };

    loadCategories();
  }, [activeKasirTab, isOnlineTab]);

  // Fetch products when category or tab changes (business_id = 14) with offline fallback
  useEffect(() => {
    const loadProducts = async () => {
      if (!selectedCategory) {
        // No category selected yet
        return;
      }

      setIsLoadingProducts(true);
      setIsSwitchingCategory(true);
      try {
        console.log('📦 Fetching products for category:', selectedCategory, 'tab:', activeKasirTab, 'online:', isOnlineTab);
        // Force online mode to get fresh image URLs from VPS
        const productsData = await fetchProducts(selectedCategory, activeKasirTab, { 
          isOnline: isOnlineTab, 
          forceOnline: true 
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
  }, [selectedCategory, activeKasirTab, isOnlineTab]); // Re-fetch when category or tab changes

  // Send tab updates to customer display when tab changes
  useEffect(() => {
    const tabName = `${activeKasirTab}${isOnlineTab ? ' (Online)' : ''}`;
    console.log('📤 Sending tab update to customer display:', { activeTab: tabName, isOnline: isOnlineTab });
    
    // Check if electronAPI is available
    if (window.electronAPI) {
      console.log('📤 ElectronAPI is available, sending tab update...');
      sendTabUpdate({ activeTab: tabName, isOnline: isOnlineTab });
    } else {
      console.log('❌ ElectronAPI is not available');
    }
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

                <button
                  onClick={() => { setActiveKasirTab('drinks'); setIsOnlineTab(true); }}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    activeKasirTab === 'drinks' && isOnlineTab
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  🥤 Drinks (Online)
                </button>
                <button
                  onClick={() => { setActiveKasirTab('bakery'); setIsOnlineTab(true); }}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    activeKasirTab === 'bakery' && isOnlineTab
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  🥖 Bakery (Online)
                </button>
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
      
      case 'Setelan':
        return (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-6xl mx-auto">
              <h1 className="text-2xl font-bold text-gray-800 mb-6">Settings</h1>
              
              {/* Settings Tabs */}
              <div className="border-b border-gray-200 mb-6">
                <nav className="-mb-px flex space-x-8">
                  <button
                    onClick={() => setActiveSettingsTab('slideshow')}
                    className={`py-2 px-1 border-b-2 font-medium text-sm ${
                      activeSettingsTab === 'slideshow'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    Slideshow Manager
                  </button>
                  <button
                    onClick={() => setActiveSettingsTab('printers')}
                    className={`py-2 px-1 border-b-2 font-medium text-sm ${
                      activeSettingsTab === 'printers'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    Printer Setup
                  </button>
                </nav>
              </div>

              {/* Settings Content */}
              {activeSettingsTab === 'slideshow' && <SlideshowManager />}
              {activeSettingsTab === 'printers' && <PrinterSetup />}
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
