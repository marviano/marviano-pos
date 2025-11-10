'use client';

import { useEffect, useState } from 'react';
import { ShoppingCart, Clock, CheckCircle } from 'lucide-react';

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  status: 'pending' | 'preparing' | 'ready';
}

interface CurrentOrder {
  id: string;
  items: OrderItem[];
  total: number;
  status: 'pending' | 'preparing' | 'ready';
  timestamp: Date;
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

interface CartItem {
  id: number;
  product: {
    id: number;
    nama: string;
    harga_jual: number;
  };
  quantity: number;
  customizations?: SelectedCustomization[];
}

interface SlideshowItem {
  id: string;
  title: string;
  description: string;
  image: string;
  duration: number; // in seconds
}

interface SlideshowImage {
  id: string;
  filename: string;
  path: string;
  title: string;
  duration: number;
  order: number;
}

export default function CustomerDisplay() {
  const [currentOrder, setCurrentOrder] = useState<CurrentOrder | null>(null);
  
  // Separate carts for each tab, just like the main POS - offline
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
  
  const [slideshowItems, setSlideshowItems] = useState<SlideshowItem[]>([]);
  const [slideshowImages, setSlideshowImages] = useState<SlideshowImage[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [showOrderList, setShowOrderList] = useState(true);
  const [isClient, setIsClient] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('drinks');
  const [isOnlineTab, setIsOnlineTab] = useState<boolean>(false);
  const [selectedOnlinePlatform, setSelectedOnlinePlatform] = useState<'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' | null>(null);

  // Helper functions to get current cart based on active tab and platform
  const getCurrentCart = (): CartItem[] => {
    // Offline carts
    if (activeTab === 'drinks' && !isOnlineTab) return drinksCart;
    if (activeTab === 'bakery' && !isOnlineTab) return bakeryCart;
    
    // Online carts - Drinks platforms
    if (activeTab === 'drinks (Online)' && isOnlineTab && selectedOnlinePlatform === 'qpon') return drinksQponCart;
    if (activeTab === 'drinks (Online)' && isOnlineTab && selectedOnlinePlatform === 'gofood') return drinksGofoodCart;
    if (activeTab === 'drinks (Online)' && isOnlineTab && selectedOnlinePlatform === 'grabfood') return drinksGrabfoodCart;
    if (activeTab === 'drinks (Online)' && isOnlineTab && selectedOnlinePlatform === 'shopeefood') return drinksShopeefoodCart;
    if (activeTab === 'drinks (Online)' && isOnlineTab && selectedOnlinePlatform === 'tiktok') return drinksTiktokCart;
    
    // Online carts - Bakery platforms
    if (activeTab === 'bakery (Online)' && isOnlineTab && selectedOnlinePlatform === 'qpon') return bakeryQponCart;
    if (activeTab === 'bakery (Online)' && isOnlineTab && selectedOnlinePlatform === 'gofood') return bakeryGofoodCart;
    if (activeTab === 'bakery (Online)' && isOnlineTab && selectedOnlinePlatform === 'grabfood') return bakeryGrabfoodCart;
    if (activeTab === 'bakery (Online)' && isOnlineTab && selectedOnlinePlatform === 'shopeefood') return bakeryShopeefoodCart;
    if (activeTab === 'bakery (Online)' && isOnlineTab && selectedOnlinePlatform === 'tiktok') return bakeryTiktokCart;
    
    return drinksCart; // fallback
  };

  const setCurrentCart = (newCart: CartItem[]) => {
    // Offline carts
    if (activeTab === 'drinks' && !isOnlineTab) {
      setDrinksCart(newCart);
    } else if (activeTab === 'bakery' && !isOnlineTab) {
      setBakeryCart(newCart);
    } 
    // Online carts - Drinks platforms
    else if (activeTab === 'drinks (Online)' && isOnlineTab && selectedOnlinePlatform === 'qpon') {
      setDrinksQponCart(newCart);
    } else if (activeTab === 'drinks (Online)' && isOnlineTab && selectedOnlinePlatform === 'gofood') {
      setDrinksGofoodCart(newCart);
    } else if (activeTab === 'drinks (Online)' && isOnlineTab && selectedOnlinePlatform === 'grabfood') {
      setDrinksGrabfoodCart(newCart);
    } else if (activeTab === 'drinks (Online)' && isOnlineTab && selectedOnlinePlatform === 'shopeefood') {
      setDrinksShopeefoodCart(newCart);
    } else if (activeTab === 'drinks (Online)' && isOnlineTab && selectedOnlinePlatform === 'tiktok') {
      setDrinksTiktokCart(newCart);
    }
    // Online carts - Bakery platforms
    else if (activeTab === 'bakery (Online)' && isOnlineTab && selectedOnlinePlatform === 'qpon') {
      setBakeryQponCart(newCart);
    } else if (activeTab === 'bakery (Online)' && isOnlineTab && selectedOnlinePlatform === 'gofood') {
      setBakeryGofoodCart(newCart);
    } else if (activeTab === 'bakery (Online)' && isOnlineTab && selectedOnlinePlatform === 'grabfood') {
      setBakeryGrabfoodCart(newCart);
    } else if (activeTab === 'bakery (Online)' && isOnlineTab && selectedOnlinePlatform === 'shopeefood') {
      setBakeryShopeefoodCart(newCart);
    } else if (activeTab === 'bakery (Online)' && isOnlineTab && selectedOnlinePlatform === 'tiktok') {
      setBakeryTiktokCart(newCart);
    }
  };

  // Tab-specific slideshow items
  const getTabSpecificSlideshowItems = (): SlideshowItem[] => {
    if (activeTab === 'drinks') {
      return [
        {
          id: '1',
          title: 'MOMOYO Drinks',
          description: 'Fresh Lemon Drinks with Real Fruit',
          image: '/images/drinks-1.jpg',
          duration: 5
        },
        {
          id: '2',
          title: 'Premium Tea',
          description: 'Authentic Milk Tea & Bubble Tea',
          image: '/images/drinks-2.jpg',
          duration: 5
        },
        {
          id: '3',
          title: 'Fresh Juices',
          description: '100% Natural Fruit Juices',
          image: '/images/drinks-3.jpg',
          duration: 5
        }
      ];
    } else if (activeTab === 'bakery') {
      return [
        {
          id: '1',
          title: 'MOMOYO Bakery',
          description: 'Fresh Baked Goods Daily',
          image: '/images/bakery-1.jpg',
          duration: 5
        },
        {
          id: '2',
          title: 'Premium Cakes',
          description: 'Handcrafted Cakes & Pastries',
          image: '/images/bakery-2.jpg',
          duration: 5
        },
        {
          id: '3',
          title: 'Fresh Bread',
          description: 'Artisan Bread & Croissants',
          image: '/images/bakery-3.jpg',
          duration: 5
        }
      ];
    } else if (activeTab === 'drinks (Online)') {
      return [
        {
          id: '1',
          title: 'Online Drinks',
          description: 'Order Drinks Online - GoFood, GrabFood, ShopeeFood, TikTok, Qpon',
          image: '/images/online-drinks-1.jpg',
          duration: 5
        },
        {
          id: '2',
          title: 'Delivery Special',
          description: 'Free Delivery on Orders Above Rp 50.000',
          image: '/images/online-drinks-2.jpg',
          duration: 5
        },
        {
          id: '3',
          title: 'Online Exclusive',
          description: 'Special Online Menu Items',
          image: '/images/online-drinks-3.jpg',
          duration: 5
        }
      ];
    } else if (activeTab === 'bakery (Online)') {
      return [
        {
          id: '1',
          title: 'Online Bakery',
          description: 'Order Bakery Items Online - ShopeeFood, TikTok, Qpon',
          image: '/images/online-bakery-1.jpg',
          duration: 5
        },
        {
          id: '2',
          title: 'Fresh Delivery',
          description: 'Fresh Bakery Items Delivered to Your Door',
          image: '/images/online-bakery-2.jpg',
          duration: 5
        },
        {
          id: '3',
          title: 'Online Special',
          description: 'Exclusive Online Bakery Menu',
          image: '/images/online-bakery-3.jpg',
          duration: 5
        }
      ];
    }
    
    // Default fallback
    return [
      {
        id: '1',
        title: 'MOMOYO',
        description: 'Premium Drinks & Bakery',
        image: '/images/default-1.jpg',
        duration: 5
      }
    ];
  };

  // Load slideshow images from API
  const loadSlideshowImages = async () => {
    try {
      const response = await fetch('/api/slideshow/images');
      const data = await response.json();
      
      if (data.success && data.images.length > 0) {
        setSlideshowImages(data.images);
        console.log('📸 Loaded slideshow images:', data.images.length);
      } else {
        console.log('📸 No slideshow images found, using default content');
        setSlideshowItems(defaultSlideshowItems);
      }
    } catch (error) {
      console.error('❌ Failed to load slideshow images:', error);
      setSlideshowItems(defaultSlideshowItems);
    }
  };

  useEffect(() => {
    setIsClient(true);
    loadSlideshowImages();
  }, []);

  // Listen for order updates from cashier display
  useEffect(() => {
    if (!isClient) {
      console.log('📱 Customer display: Not client yet');
      return;
    }
    
    if (!window.electronAPI) {
      console.log('📱 Customer display: ElectronAPI not available');
      return;
    }

    console.log('📱 Customer display: Setting up event listeners...');

    const handleOrderUpdate = (data: any) => {
      console.log('📱 Customer display received order update:', data);
      if (data.order) {
        setCurrentOrder(data.order);
        setShowOrderList(true);
      }
      if (data.cartItems) {
        // Update the correct cart based on tab info
        if (data.tabInfo) {
          const tabName = data.tabInfo.activeTab;
          const isOnline = data.tabInfo.isOnline;
          
          if (tabName === 'drinks' && !isOnline) {
            setDrinksCart(data.cartItems);
          } else if (tabName === 'bakery' && !isOnline) {
            setBakeryCart(data.cartItems);
          } else if (tabName === 'drinks (Online)' && isOnline && data.tabInfo.selectedPlatform === 'qpon') {
            setDrinksQponCart(data.cartItems);
          } else if (tabName === 'drinks (Online)' && isOnline && data.tabInfo.selectedPlatform === 'gofood') {
            setDrinksGofoodCart(data.cartItems);
          } else if (tabName === 'drinks (Online)' && isOnline && data.tabInfo.selectedPlatform === 'grabfood') {
            setDrinksGrabfoodCart(data.cartItems);
          } else if (tabName === 'drinks (Online)' && isOnline && data.tabInfo.selectedPlatform === 'shopeefood') {
            setDrinksShopeefoodCart(data.cartItems);
          } else if (tabName === 'drinks (Online)' && isOnline && data.tabInfo.selectedPlatform === 'tiktok') {
            setDrinksTiktokCart(data.cartItems);
          } else if (tabName === 'bakery (Online)' && isOnline && data.tabInfo.selectedPlatform === 'qpon') {
            setBakeryQponCart(data.cartItems);
          } else if (tabName === 'bakery (Online)' && isOnline && data.tabInfo.selectedPlatform === 'gofood') {
            setBakeryGofoodCart(data.cartItems);
          } else if (tabName === 'bakery (Online)' && isOnline && data.tabInfo.selectedPlatform === 'grabfood') {
            setBakeryGrabfoodCart(data.cartItems);
          } else if (tabName === 'bakery (Online)' && isOnline && data.tabInfo.selectedPlatform === 'shopeefood') {
            setBakeryShopeefoodCart(data.cartItems);
          } else if (tabName === 'bakery (Online)' && isOnline && data.tabInfo.selectedPlatform === 'tiktok') {
            setBakeryTiktokCart(data.cartItems);
          }
        }
        setShowOrderList(true);
      }
      if (data.tabInfo) {
        console.log('📱 Customer display received tab update:', data.tabInfo);
        setActiveTab(data.tabInfo.activeTab);
        setIsOnlineTab(data.tabInfo.isOnline);
        setSelectedOnlinePlatform(data.tabInfo.selectedPlatform || null);
        // Force slideshow to update immediately when tab changes
        setCurrentSlideIndex(0);
      }
    };

    const handleSlideshowUpdate = (data: any) => {
      console.log('📱 Customer display received slideshow update:', data);
      if (data.slideshowItems) {
        setSlideshowItems(data.slideshowItems);
      }
    };

    // Listen for IPC messages
    window.electronAPI.onOrderUpdate?.(handleOrderUpdate);
    window.electronAPI.onSlideshowUpdate?.(handleSlideshowUpdate);

    return () => {
      // Cleanup listeners if needed
    };
  }, [isClient]);

  // Auto-advance slideshow
  useEffect(() => {
    const items = slideshowImages.length > 0 ? slideshowImages : getTabSpecificSlideshowItems();
    if (items.length === 0) return;

    const timer = setInterval(() => {
      setCurrentSlideIndex((prev) => (prev + 1) % items.length);
    }, items[currentSlideIndex]?.duration * 1000 || 5000);

    return () => clearInterval(timer);
  }, [slideshowImages, activeTab, currentSlideIndex]);

  // Force slideshow to re-render when tab changes
  useEffect(() => {
    console.log('📱 Tab changed, forcing slideshow re-render:', activeTab);
    // Reset slide index and force re-render
    setCurrentSlideIndex(0);
  }, [activeTab, isOnlineTab]);

  // Auto-hide order list after 30 seconds if no new orders
  useEffect(() => {
    const currentCartItems = getCurrentCart();
    if (!currentOrder && currentCartItems.length === 0) return;

    const timer = setTimeout(() => {
      setShowOrderList(false);
    }, 30000);

    return () => clearTimeout(timer);
  }, [currentOrder, activeTab, isOnlineTab]);

  if (!isClient) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  const currentSlide = slideshowImages.length > 0 ? slideshowImages[currentSlideIndex] : getTabSpecificSlideshowItems()[currentSlideIndex];
  const formatPrice = (price: number) => {
    return `Rp ${price.toLocaleString('id-ID')}`;
  };

  const currentCartItems = getCurrentCart();
  const totalItems = currentCartItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = currentCartItems.reduce((sum, item) => {
    let itemPrice = item.product.harga_jual;
    
    // Add customization prices
    if (item.customizations) {
      item.customizations.forEach(customization => {
        customization.selected_options.forEach(option => {
          itemPrice += option.price_adjustment;
        });
      });
    }
    
    return sum + (itemPrice * item.quantity);
  }, 0);

  return (
    <div className="h-screen bg-black text-white overflow-hidden flex">
      {/* Left Side - Order List (40% width) */}
      <div className="w-[40%] bg-gray-100 flex flex-col">
        {/* Top Navigation */}
        <div className="flex items-center justify-between p-4 bg-white border-b border-gray-200">
          <div className="flex space-x-2">
            <button className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-sm font-medium">
              Masuk
            </button>
            <button disabled className="px-3 py-1 text-gray-400 text-sm font-medium cursor-not-allowed opacity-50">
              <span className="line-through">Mendaftar</span>
            </button>
          </div>
          {/* Active Tab Indicator */}
          <div className="flex items-center space-x-2">
            <div className={`px-2 py-1 rounded text-xs font-medium ${
              activeTab === 'drinks' ? 'bg-blue-100 text-blue-800' :
              activeTab === 'bakery' ? 'bg-orange-100 text-orange-800' :
              activeTab === 'drinks (Online)' ? 'bg-green-100 text-green-800' :
              activeTab === 'bakery (Online)' ? 'bg-purple-100 text-purple-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {activeTab.toUpperCase()}
            </div>
            <button className="p-2 text-gray-600 hover:text-gray-800">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

        {/* Cart Items Area */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Empty Cart Indicator */}
          {currentCartItems.length === 0 && !currentOrder && (
            <div className="text-center py-12">
              <div className="w-24 h-24 mx-auto mb-4 text-gray-300">
                <ShoppingCart className="w-full h-full" />
              </div>
              <p className="text-gray-400 text-base">Keranjang belanja kosong</p>
            </div>
          )}
          
          {/* Cart Items List - Compact */}
          {currentCartItems.length > 0 && (
            <div className="space-y-1">
              {currentCartItems.map((item) => (
                <div key={item.id} className="bg-white rounded border border-gray-200 p-2">
                  <div className="flex justify-between items-center">
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-800 text-xs">{item.product.nama}</h4>
                      
                      {/* Customizations */}
                      {item.customizations && item.customizations.length > 0 && (
                        <div className="mt-0.5 space-y-0.5">
                          {item.customizations.map((customization) => (
                            <div key={customization.customization_id} className="text-xs">
                              <span className="text-gray-500">{customization.customization_name}:</span>
                              <div className="ml-1">
                                {customization.selected_options.map((option) => (
                                  <span key={option.option_id} className="text-gray-600 text-xs">
                                    {option.option_name}
                                    {option.price_adjustment !== 0 && (
                                      <span className={`ml-1 ${
                                        option.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'
                                      }`}>
                                        ({option.price_adjustment > 0 ? '+' : ''}{formatPrice(option.price_adjustment)})
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 text-xs">
                      <span className="text-gray-600">{formatPrice(item.product.harga_jual)}</span>
                      <span className="font-medium text-gray-800">x{item.quantity}</span>
                      <span className="font-semibold text-green-600">
                        {formatPrice((() => {
                          let itemPrice = item.product.harga_jual;
                          if (item.customizations) {
                            item.customizations.forEach(customization => {
                              customization.selected_options.forEach(option => {
                                itemPrice += option.price_adjustment;
                              });
                            });
                          }
                          return itemPrice * item.quantity;
                        })())}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Order Items (when payment is processed) - Compact */}
          {currentOrder && (
            <div className="space-y-1">
              {currentOrder.items.map((item) => (
                <div key={item.id} className="bg-white rounded border border-gray-200 p-2">
                  <div className="flex justify-between items-center">
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-800 text-xs">{item.name}</h4>
                    </div>
                    <div className="flex items-center space-x-2 text-xs">
                      <span className="text-gray-600">Rp {item.price.toLocaleString('id-ID')}</span>
                      <span className="font-medium text-gray-800">x{item.quantity}</span>
                      <span className="font-semibold text-green-600">
                        Rp {(item.price * item.quantity).toLocaleString('id-ID')}
                      </span>
                      {item.status === 'ready' && (
                        <CheckCircle className="w-3 h-3 text-green-400" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cart Summary - Compact */}
        <div className="bg-white border-t border-gray-200 p-2 flex-shrink-0">
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-600">Produk:</span>
              <span className="font-medium">
                {currentCartItems.length > 0 ? formatPrice(totalPrice) : currentOrder ? `Rp ${currentOrder.total.toLocaleString('id-ID')}` : 'Rp 0'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Diskon:</span>
              <span className="text-red-600">-Rp 0</span>
            </div>
            <hr className="border-gray-200" />
            <div className="flex justify-between items-center">
              <span className="text-gray-600">{totalItems} item</span>
              <div className="bg-blue-100 px-2 py-1 rounded">
                <span className="font-semibold text-blue-800 text-xs">
                  Total: {currentCartItems.length > 0 ? formatPrice(totalPrice) : currentOrder ? `Rp ${currentOrder.total.toLocaleString('id-ID')}` : 'Rp 0'}
                </span>
              </div>
            </div>
          </div>
          
          {/* Status Indicator - Compact */}
          <div className="mt-2 flex justify-center">
            <div className="flex items-center space-x-1">
              {currentOrder?.status === 'ready' && (
                <>
                  <CheckCircle className="w-3 h-3 text-green-400" />
                  <span className="text-xs text-green-400 font-medium">Ready!</span>
                </>
              )}
              {currentOrder?.status === 'preparing' && (
                <>
                  <Clock className="w-3 h-3 text-yellow-400" />
                  <span className="text-xs text-yellow-400 font-medium">Preparing...</span>
                </>
              )}
              {!currentOrder && currentCartItems.length > 0 && (
                <>
                  <Clock className="w-3 h-3 text-blue-400" />
                  <span className="text-xs text-blue-400 font-medium">Ordering...</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Slideshow (60% width) */}
      <div className="w-[60%] bg-black relative overflow-hidden">
        {/* Slideshow Content - Full Screen Images */}
        {currentSlide ? (
          <div key={`${activeTab}-${currentSlideIndex}`}>
            {/* Show actual image if available */}
            {slideshowImages.length > 0 ? (
              <div className="w-full h-full p-6 flex items-center justify-center">
                <img
                  src={currentSlide.path}
                  alt={currentSlide.title}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
                />
              </div>
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center relative overflow-hidden">
                {/* Background pattern */}
                <div className="absolute inset-0 opacity-10">
                  <div className="w-full h-full bg-white" style={{
                    backgroundImage: 'radial-gradient(circle at 25% 25%, rgba(255,255,255,0.3) 2px, transparent 2px)',
                    backgroundSize: '20px 20px'
                  }}></div>
                </div>

                <div className="text-center p-8 relative z-10">
                  <div className="mb-6">
                    <h1 className="text-4xl font-bold text-yellow-400 mb-2">
                      {currentSlide.title}
                    </h1>
                    <p className="text-xl text-white/90">
                      {currentSlide.description}
                    </p>
                  </div>
                  
                  {/* Product Images - Tab-specific Layout */}
                  <div className="flex justify-center space-x-8 mb-6">
                    {activeTab === 'drinks' && (
                      <>
                        {/* Left Product - Lemon Drinks */}
                        <div className="w-48 h-64 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-lg flex items-center justify-center relative overflow-hidden">
                          <div className="text-center">
                            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-2">
                              <span className="text-2xl">🍋</span>
                            </div>
                            <p className="text-white font-semibold text-sm">MOMOYO</p>
                            <p className="text-white/80 text-xs">Fresh Lemon</p>
                          </div>
                          <div className="absolute top-0 right-0 w-8 h-8 bg-white/30 rounded-full animate-pulse"></div>
                        </div>
                        
                        {/* Right Product - Milk Tea */}
                        <div className="w-48 h-64 bg-gradient-to-br from-green-400 to-blue-500 rounded-lg flex items-center justify-center relative overflow-hidden">
                          <div className="text-center">
                            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-2">
                              <span className="text-2xl">🧋</span>
                            </div>
                            <p className="text-white font-semibold text-sm">MOMOYO</p>
                            <p className="text-white/80 text-xs">Milk Tea</p>
                          </div>
                          <div className="absolute top-0 left-0 w-8 h-8 bg-white/30 rounded-full animate-pulse"></div>
                        </div>
                      </>
                    )}
                    
                    {activeTab === 'bakery' && (
                      <>
                        {/* Left Product - Cakes */}
                        <div className="w-48 h-64 bg-gradient-to-br from-pink-400 to-red-500 rounded-lg flex items-center justify-center relative overflow-hidden">
                          <div className="text-center">
                            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-2">
                              <span className="text-2xl">🎂</span>
                            </div>
                            <p className="text-white font-semibold text-sm">MOMOYO</p>
                            <p className="text-white/80 text-xs">Premium Cakes</p>
                          </div>
                          <div className="absolute top-0 right-0 w-8 h-8 bg-white/30 rounded-full animate-pulse"></div>
                        </div>
                        
                        {/* Right Product - Bread */}
                        <div className="w-48 h-64 bg-gradient-to-br from-amber-400 to-orange-500 rounded-lg flex items-center justify-center relative overflow-hidden">
                          <div className="text-center">
                            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-2">
                              <span className="text-2xl">🥖</span>
                            </div>
                            <p className="text-white font-semibold text-sm">MOMOYO</p>
                            <p className="text-white/80 text-xs">Fresh Bread</p>
                          </div>
                          <div className="absolute top-0 left-0 w-8 h-8 bg-white/30 rounded-full animate-pulse"></div>
                        </div>
                      </>
                    )}
                    
                    {(activeTab === 'drinks (Online)' || activeTab === 'bakery (Online)') && (
                      <>
                        {/* Left Product - Online Ordering */}
                        <div className="w-48 h-64 bg-gradient-to-br from-blue-400 to-purple-500 rounded-lg flex items-center justify-center relative overflow-hidden">
                          <div className="text-center">
                            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-2">
                              <span className="text-2xl">📱</span>
                            </div>
                            <p className="text-white font-semibold text-sm">ONLINE</p>
                            <p className="text-white/80 text-xs">Order Now</p>
                          </div>
                          <div className="absolute top-0 right-0 w-8 h-8 bg-white/30 rounded-full animate-pulse"></div>
                        </div>
                        
                        {/* Right Product - Delivery */}
                        <div className="w-48 h-64 bg-gradient-to-br from-green-400 to-teal-500 rounded-lg flex items-center justify-center relative overflow-hidden">
                          <div className="text-center">
                            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-2">
                              <span className="text-2xl">🚚</span>
                            </div>
                            <p className="text-white font-semibold text-sm">DELIVERY</p>
                            <p className="text-white/80 text-xs">Fast & Fresh</p>
                          </div>
                          <div className="absolute top-0 left-0 w-8 h-8 bg-white/30 rounded-full animate-pulse"></div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div key={`${activeTab}-fallback`} className="w-full h-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-4xl font-bold text-yellow-400 mb-4">MOMOYO</h1>
              <p className="text-xl text-white/90">Premium Drinks & Ice Cream</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
