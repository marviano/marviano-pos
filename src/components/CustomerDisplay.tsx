'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { ShoppingCart } from 'lucide-react';
import { getApiUrl } from '@/lib/api';

// Removed OrderItem and CurrentOrder interfaces - not needed anymore
// Customer display only shows cart items, not order status

interface SelectedCustomization {
  customization_id: number;
  customization_name: string;
  selected_options: {
    option_id: number;
    option_name: string;
    price_adjustment: number;
  }[];
}

interface BundleSelection {
  category2_id: number;
  category2_name: string;
  selectedProducts: {
    product: {
      id: number;
      nama: string;
    };
    quantity?: number;
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
  }[];
  requiredQuantity: number;
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
  customNote?: string;
  bundleSelections?: BundleSelection[];
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
  dataUrl?: string; // Add data URL for display
}

type OnlinePlatform = 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
type TabName = 'Offline' | 'Gofood' | 'Grabfood' | 'Shopeefood' | 'Tiktok' | 'Qpon' | 'drinks' | 'bakery' | 'drinks (Online)' | 'bakery (Online)';

// Removed CustomerDisplayOrderPayload - not needed anymore

interface CustomerDisplayTabInfo {
  activeTab: TabName;
  isOnline: boolean;
  selectedPlatform?: OnlinePlatform | null;
}

interface CustomerDisplayUpdatePayload {
  cartItems?: CartItem[];
  tabInfo?: CustomerDisplayTabInfo;
}

interface SlideshowUpdatePayload {
  slideshowItems?: SlideshowItem[];
}

interface SlideshowImageResponse {
  success: boolean;
  images: SlideshowImage[];
}

const defaultSlideshowItems: SlideshowItem[] = [
  {
    id: 'default-1',
    title: 'MOMOYO',
    description: 'Premium Drinks & Bakery',
    image: '/images/default-1.jpg',
    duration: 5,
  },
];

const isSlideshowImage = (slide: SlideshowItem | SlideshowImage): slide is SlideshowImage =>
  'path' in slide;

const normalizePlatform = (platform?: string | null): OnlinePlatform | null => {
  if (!platform) return null;
  if (['qpon', 'gofood', 'grabfood', 'shopeefood', 'tiktok'].includes(platform)) {
    return platform as OnlinePlatform;
  }
  return null;
};

export default function CustomerDisplay() {
  // NEW STRUCTURE: 6 carts total - 1 offline + 5 online platforms
  // Each cart can contain both drinks AND bakery items
  const [offlineCart, setOfflineCart] = useState<CartItem[]>([]);
  const [gofoodCart, setGofoodCart] = useState<CartItem[]>([]);
  const [grabfoodCart, setGrabfoodCart] = useState<CartItem[]>([]);
  const [shopeefoodCart, setShopeefoodCart] = useState<CartItem[]>([]);
  const [tiktokCart, setTiktokCart] = useState<CartItem[]>([]);
  const [qponCart, setQponCart] = useState<CartItem[]>([]);
  
  const [slideshowItems, setSlideshowItems] = useState<SlideshowItem[]>(defaultSlideshowItems);
  const [slideshowImages, setSlideshowImages] = useState<SlideshowImage[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isClient, setIsClient] = useState(false);
  const [activeTab, setActiveTab] = useState<TabName>('Offline');
  const [isOnlineTab, setIsOnlineTab] = useState<boolean>(false);
  const [selectedOnlinePlatform, setSelectedOnlinePlatform] = useState<OnlinePlatform | null>(null);

  const tabSpecificSlideshowItems = useMemo<SlideshowItem[]>(() => {
    // For new tab structure: Offline = general items, Online platforms = online items
    switch (activeTab) {
      case 'Offline':
      case 'drinks':
      case 'bakery':
        return [
          {
            id: 'momoyo-1',
            title: 'MOMOYO',
            description: 'Fresh Drinks & Bakery Daily',
            image: '/images/drinks-1.jpg',
            duration: 5,
          },
          {
            id: 'momoyo-2',
            title: 'Premium Quality',
            description: 'Authentic Drinks & Fresh Baked Goods',
            image: '/images/drinks-2.jpg',
            duration: 5,
          },
          {
            id: 'momoyo-3',
            title: 'Fresh Daily',
            description: '100% Natural Ingredients',
            image: '/images/drinks-3.jpg',
            duration: 5,
          },
        ];
      case 'Gofood':
      case 'Grabfood':
      case 'Shopeefood':
      case 'Tiktok':
      case 'Qpon':
      case 'drinks (Online)':
      case 'bakery (Online)':
        return [
          {
            id: 'online-1',
            title: 'Order Online',
            description: `Order on ${activeTab === 'Gofood' ? 'GoFood' : activeTab === 'Grabfood' ? 'GrabFood' : activeTab === 'Shopeefood' ? 'ShopeeFood' : activeTab === 'Tiktok' ? 'TikTok' : activeTab === 'Qpon' ? 'Qpon' : 'Food Delivery Apps'}`,
            image: '/images/online-drinks-1.jpg',
            duration: 5,
          },
          {
            id: 'online-2',
            title: 'Delivery Special',
            description: 'Fast & Fresh Delivery',
            image: '/images/online-drinks-2.jpg',
            duration: 5,
          },
          {
            id: 'online-3',
            title: 'Online Exclusive',
            description: 'Special Online Menu Items',
            image: '/images/online-drinks-3.jpg',
            duration: 5,
          },
        ];
      default:
        return defaultSlideshowItems;
    }
  }, [activeTab]);

  // Load slideshow images from userData via Electron
  const loadSlideshowImages = useCallback(async () => {
    try {
      // Try electron API first (offline-first)
      if (typeof window !== 'undefined' && window.electronAPI?.getSlideshowImages) {
        const result = await window.electronAPI.getSlideshowImages();
        
        if (result.success && result.images && result.images.length > 0) {
          // Load each image as data URL for display
          const imagesWithDataUrls = await Promise.all(
            result.images.map(async (image) => {
              try {
                const imageData = await window.electronAPI?.readSlideshowImage?.(image.filename);
                if (imageData?.success && imageData.buffer) {
                  // Convert buffer to base64 data URL
                  const base64 = btoa(
                    new Uint8Array(imageData.buffer).reduce(
                      (data, byte) => data + String.fromCharCode(byte),
                      ''
                    )
                  );
                  return {
                    ...image,
                    dataUrl: `data:${imageData.mimeType};base64,${base64}`
                  };
                }
              } catch (error) {
                console.error('❌ Failed to load image:', image.filename, error);
              }
              return image;
            })
          );
          
          setSlideshowImages(imagesWithDataUrls);
          console.log('📸 Loaded slideshow images from userData:', imagesWithDataUrls.length);
          return;
        }
      }
      
      // Fallback to web API (shouldn't happen in electron app)
      const response = await fetch(getApiUrl('/api/slideshow/images'));
      const data: SlideshowImageResponse = await response.json();
      
      if (data.success && data.images.length > 0) {
        setSlideshowImages(data.images);
        console.log('📸 Loaded slideshow images from API:', data.images.length);
      } else {
        console.log('📸 No slideshow images found, using default content');
        setSlideshowImages([]);
        setSlideshowItems(defaultSlideshowItems);
      }
    } catch (error) {
      console.error('❌ Failed to load slideshow images:', error);
      setSlideshowImages([]);
      setSlideshowItems(defaultSlideshowItems);
    }
  }, []);

  useEffect(() => {
    setIsClient(true);
    loadSlideshowImages();
  }, [loadSlideshowImages]);

  const applyCartUpdate = useCallback(
    (items: CartItem[], tabInfo?: CustomerDisplayTabInfo) => {
      const targetOnline = tabInfo?.isOnline ?? isOnlineTab;
      const targetPlatform = tabInfo
        ? normalizePlatform(tabInfo.selectedPlatform ?? null)
        : selectedOnlinePlatform;

      // Offline mode - one cart for all
      if (!targetOnline) {
        setOfflineCart(items);
        return;
      }

      // Online mode - set cart based on platform
      switch (targetPlatform) {
        case 'gofood':
          setGofoodCart(items);
          break;
        case 'grabfood':
          setGrabfoodCart(items);
          break;
        case 'shopeefood':
          setShopeefoodCart(items);
          break;
        case 'tiktok':
          setTiktokCart(items);
          break;
        case 'qpon':
          setQponCart(items);
          break;
        default:
          break;
      }
    },
    [isOnlineTab, selectedOnlinePlatform]
  );

  // Listen for order updates from cashier display
  useEffect(() => {
    if (!isClient) {
      console.log('📱 Customer display: Not client yet');
      return;
    }
    
    const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!electronAPI) {
      console.log('📱 Customer display: ElectronAPI not available');
      return;
    }

    console.log('📱 Customer display: Setting up event listeners...');

    const handleOrderUpdate = (data: unknown) => {
      const payload = data as CustomerDisplayUpdatePayload;
      console.log('📱 Customer display received cart update:', payload);
      if (Array.isArray(payload.cartItems)) {
        applyCartUpdate(payload.cartItems, payload.tabInfo);
      }
      if (payload.tabInfo) {
        const newTab = ['Offline', 'Gofood', 'Grabfood', 'Shopeefood', 'Tiktok', 'Qpon', 'drinks', 'bakery', 'drinks (Online)', 'bakery (Online)'].includes(
          payload.tabInfo.activeTab
        )
          ? (payload.tabInfo.activeTab as TabName)
          : activeTab;
        setActiveTab(newTab);
        setIsOnlineTab(Boolean(payload.tabInfo.isOnline));
        setSelectedOnlinePlatform(normalizePlatform(payload.tabInfo.selectedPlatform ?? null));
        setCurrentSlideIndex(0);
      }
    };

    const handleSlideshowUpdate = (data: unknown) => {
      const payload = data as SlideshowUpdatePayload;
      console.log('📱 Customer display received slideshow update:', payload);
      if (Array.isArray(payload.slideshowItems) && payload.slideshowItems.length > 0) {
        setSlideshowItems(payload.slideshowItems);
      }
    };

    electronAPI.onOrderUpdate?.(handleOrderUpdate);
    electronAPI.onSlideshowUpdate?.(handleSlideshowUpdate);

    return () => {
      // IPC bridge does not expose removal handlers yet
    };
  }, [activeTab, applyCartUpdate, isClient]);

  const manualSlides = useMemo(
    () => (slideshowItems.length > 0 ? slideshowItems : tabSpecificSlideshowItems),
    [slideshowItems, tabSpecificSlideshowItems]
  );

  const activeSlides = useMemo(
    () => (slideshowImages.length > 0 ? slideshowImages : manualSlides),
    [slideshowImages, manualSlides]
  );

  const currentCartItems = useMemo(() => {
    // Offline mode - one cart for all (drinks + bakery)
    if (!isOnlineTab) {
      return offlineCart;
    }
    
    // Online mode - one cart per platform (drinks + bakery)
    switch (selectedOnlinePlatform) {
      case 'gofood':
        return gofoodCart;
      case 'grabfood':
        return grabfoodCart;
      case 'shopeefood':
        return shopeefoodCart;
      case 'tiktok':
        return tiktokCart;
      case 'qpon':
        return qponCart;
      default:
        return offlineCart;
    }
  }, [
    isOnlineTab,
    selectedOnlinePlatform,
    offlineCart,
    gofoodCart,
    grabfoodCart,
    shopeefoodCart,
    tiktokCart,
    qponCart,
  ]);

  // Auto-advance slideshow
  useEffect(() => {
    if (activeSlides.length === 0) return;
    const slide =
      activeSlides[currentSlideIndex % activeSlides.length] ?? activeSlides[0];
    const duration = slide?.duration ? slide.duration * 1000 : 5000;
    const timer = setInterval(() => {
      setCurrentSlideIndex((prev) => (prev + 1) % activeSlides.length);
    }, duration);

    return () => clearInterval(timer);
  }, [activeSlides, currentSlideIndex]);

  // Force slideshow to re-render when tab changes
  useEffect(() => {
    console.log('📱 Tab changed, forcing slideshow re-render:', activeTab);
    // Reset slide index and force re-render
    setCurrentSlideIndex(0);
  }, [activeTab, isOnlineTab]);

  if (!isClient) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  const slideCount = activeSlides.length;
  const currentSlide =
    slideCount > 0 ? activeSlides[currentSlideIndex % slideCount] : null;
  const formatPrice = (price: number) => {
    return `Rp ${price.toLocaleString('id-ID')}`;
  };

  const sumCustomizationPrice = (customizations?: SelectedCustomization[]) => {
    if (!customizations || customizations.length === 0) return 0;
    return customizations.reduce((sum, customization) => {
      const optionTotal = customization.selected_options.reduce((optionSum, option) => optionSum + option.price_adjustment, 0);
      return sum + optionTotal;
    }, 0);
  };

  const calculateBundleCustomizationCharge = (bundleSelections?: BundleSelection[]) => {
    if (!bundleSelections || bundleSelections.length === 0) return 0;

    return bundleSelections.reduce((bundleSum, bundleSelection) => {
      const selectionTotal = bundleSelection.selectedProducts.reduce((productSum, selectedProduct) => {
        const perUnitAdjustment = sumCustomizationPrice(selectedProduct.customizations);
        return productSum + perUnitAdjustment;
      }, 0);
      return bundleSum + selectionTotal;
    }, 0);
  };

  const totalItems = currentCartItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = currentCartItems.reduce((sum, item) => {
    let itemPrice = item.product.harga_jual;
    
    // Add customization prices
    itemPrice += sumCustomizationPrice(item.customizations);
    
    // Add bundle customization charges
    if (item.bundleSelections) {
      itemPrice += calculateBundleCustomizationCharge(item.bundleSelections);
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
              activeTab === 'Offline' ? 'bg-blue-100 text-blue-800' :
              activeTab === 'Gofood' ? 'bg-green-100 text-green-800' :
              activeTab === 'Grabfood' ? 'bg-emerald-100 text-emerald-800' :
              activeTab === 'Shopeefood' ? 'bg-orange-100 text-orange-800' :
              activeTab === 'Tiktok' ? 'bg-pink-100 text-pink-800' :
              activeTab === 'Qpon' ? 'bg-purple-100 text-purple-800' :
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
          {currentCartItems.length === 0 && (
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
                  <div>
                    <h4 className="font-medium text-gray-800 text-xs">{item.product.nama}</h4>
                    
                    {/* Customizations */}
                    {item.customizations && item.customizations.length > 0 && (
                      <div className="mt-1 space-y-1">
                        {item.customizations.map((customization) => (
                          <div key={customization.customization_id} className="text-xs">
                            <span className="text-gray-500">{customization.customization_name}:</span>
                            <div className="ml-2 space-y-0.5">
                              {customization.selected_options.map((option) => (
                                <div key={option.option_id} className="flex items-center justify-between">
                                  <span className="text-gray-600">• {option.option_name}</span>
                                  {option.price_adjustment !== 0 && (
                                    <span className={`text-xs ${
                                      option.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'
                                    }`}>
                                      {option.price_adjustment > 0 ? '+' : ''}{formatPrice(option.price_adjustment)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Custom Note */}
                    {item.customNote && (
                      <div className="mt-1">
                        <div className="text-xs">
                          <span className="text-gray-500">Note:</span>
                          <span className="text-gray-700 ml-1 italic">&ldquo;{item.customNote}&rdquo;</span>
                        </div>
                      </div>
                    )}
                    
                    {/* Bundle Selections */}
                    {item.bundleSelections && item.bundleSelections.length > 0 && (
                      <div className="mt-2 space-y-2">
                        <div className="text-xs font-semibold text-purple-700">Bundle Items:</div>
                        {item.bundleSelections.map((bundleSel, idx) => {
                          const totalQuantity = bundleSel.selectedProducts.length;
                          return (
                            <div key={idx} className="ml-2 border-l-2 border-purple-300 pl-2">
                              <div className="text-xs font-medium text-purple-600">
                                {bundleSel.category2_name} ({totalQuantity}/{bundleSel.requiredQuantity}):
                              </div>
                              <div className="ml-2 mt-1 space-y-1">
                                {bundleSel.selectedProducts.map((sp, spIdx) => (
                                  <div key={spIdx} className="text-xs text-gray-600 border border-gray-200 rounded px-2 py-1 bg-gray-50 space-y-1">
                                    <div className="font-medium text-gray-700">• {sp.product.nama}</div>
                                    {sp.customizations && sp.customizations.length > 0 && (
                                      <div className="ml-3 text-[11px] text-gray-500 space-y-0.5">
                                        {sp.customizations.map((customization) => (
                                          <div key={customization.customization_id}>
                                            <div className="font-semibold text-gray-600">{customization.customization_name}</div>
                                            <ul className="ml-3 list-disc">
                                              {customization.selected_options.map(option => (
                                                <li key={option.option_id}>
                                                  {option.option_name}
                                                  {option.price_adjustment !== 0 && (
                                                    <span className={`ml-1 ${option.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                      ({option.price_adjustment > 0 ? '+' : ''}{formatPrice(option.price_adjustment)})
                                                    </span>
                                                  )}
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {sp.customNote && (
                                      <div className="text-[11px] text-gray-500 italic">
                                        Note: &ldquo;{sp.customNote}&rdquo;
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  
                  {/* Price Section - Separate row at bottom */}
                  <div className="mt-2 flex justify-between items-center">
                    <div className="flex items-center space-x-2 text-xs text-gray-500">
                      <span>{formatPrice(item.product.harga_jual)}</span>
                      <span>x{item.quantity}</span>
                    </div>
                    <span className="font-semibold text-green-600 text-xs">
                      {formatPrice((() => {
                        let itemPrice = item.product.harga_jual;
                        itemPrice += sumCustomizationPrice(item.customizations);
                        if (item.bundleSelections) {
                          itemPrice += calculateBundleCustomizationCharge(item.bundleSelections);
                        }
                        return itemPrice * item.quantity;
                      })())}
                    </span>
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
                {formatPrice(totalPrice)}
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
                  Total: {formatPrice(totalPrice)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Slideshow (60% width) */}
      <div className="w-[60%] bg-black relative flex items-center justify-center">
        {/* Slideshow Content - Full Screen Images */}
        {currentSlide ? (
          <div key={`${activeTab}-${currentSlideIndex}`} className="w-full h-full flex items-center justify-center">
            {/* Show actual image if available */}
            {isSlideshowImage(currentSlide) ? (
              <div className="w-full h-full p-8 flex items-center justify-center">
                {currentSlide.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={currentSlide.dataUrl}
                    alt={currentSlide.title}
                    className="max-w-full max-h-full object-contain"
                    style={{ maxHeight: 'calc(100vh - 64px)' }}
                  />
                ) : (
                  <div className="text-white text-xl">Loading...</div>
                )}
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
                    {(activeTab === 'Offline' || activeTab === 'drinks') && (
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
                    
                    {(activeTab === 'Gofood' || activeTab === 'Grabfood' || activeTab === 'Shopeefood' || activeTab === 'Tiktok' || activeTab === 'Qpon' || activeTab === 'drinks (Online)' || activeTab === 'bakery (Online)') && (
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
