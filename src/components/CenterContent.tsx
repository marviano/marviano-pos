'use client';

import { ShoppingCart, LayoutGrid, Search, X } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import ProductCustomizationModal from './ProductCustomizationModal';
import CustomNoteModal from './CustomNoteModal';
import EditItemModal from './EditItemModal';
import PaymentModal from './PaymentModal';
import BundleSelectionModal from './BundleSelectionModal';
import TableSelectionModal from './TableSelectionModal';
import { offlineSyncService } from '@/lib/offlineSync';
import { getApiUrl } from '@/lib/api';

interface BundleItem {
  id: number;
  bundle_product_id: number;
  category2_id: number;
  category2_name?: string;
  required_quantity: number;
  display_order: number;
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
  harga_jual: number | null;
  harga_qpon?: number | null;
  harga_gofood?: number | null;
  harga_grabfood?: number | null;
  harga_shopeefood?: number | null;
  harga_tiktok?: number | null;
  image_url: string | null;
  status: string;
  is_bundle?: number | boolean;
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

interface BundleSelection {
  category2_id: number;
  category2_name: string;
  selectedProducts: {
    key?: string;
    product: {
      id: number;
      nama: string;
      image_url: string | null;
      category2_id: number | null;
      category2_name: string | null;
    };
    customizations?: SelectedCustomization[];
    customNote?: string;
  }[];
  requiredQuantity: number;
}

interface CartItem {
  id: number;
  product: Product;
  quantity: number;
  customizations?: SelectedCustomization[];
  customNote?: string;
  bundleSelections?: BundleSelection[];
  isLocked?: boolean; // Item from pending transaction - requires password to remove
  transactionItemId?: number; // ID of the transaction_item in database (for logging)
  transactionId?: string; // UUID of the transaction (for logging)
  tableId?: number | null; // Table ID (for logging)
}

const categoryEmoji = (categoryName?: string | null) => {
  switch (categoryName) {
    case 'Bakery':
      return '🥖';
    case 'Ice Cream Cone':
      return '🍦';
    case 'Sundae':
      return '🍨';
    case 'Milk Tea':
      return '🧋';
    default:
      return '🍦';
  }
};

function ProductCardImage({
  imageUrl,
  productName,
  categoryName,
  emojiSize = 'text-2xl',
}: {
  imageUrl: string | null;
  productName: string;
  categoryName?: string | null;
  emojiSize?: string;
}) {
  const [hasError, setHasError] = useState(false);

  if (!imageUrl || hasError) {
    return (
      <span className={`text-gray-400 ${emojiSize}`}>
        {categoryEmoji(categoryName)}
      </span>
    );
  }

  return (
    <Image
      src={imageUrl}
      alt={productName}
      fill
      sizes="(max-width: 768px) 45vw, 200px"
      className="object-contain rounded-lg"
      unoptimized
      onError={() => setHasError(true)}
    />
  );
}

interface CenterContentProps {
  products: Product[];
  cartItems: CartItem[];
  setCartItems: (items: CartItem[]) => void;
  transactionType: 'drinks' | 'bakery';
  isLoadingProducts?: boolean;
  isOnline?: boolean;
  selectedOnlinePlatform?: 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' | null;
  searchQuery?: string;
  setSearchQuery?: (query: string) => void;
  loadedTransactionInfo?: {
    transactionId: string;
    tableName: string | null;
    roomName: string | null;
    customerName: string | null;
  } | null;
}

export default function CenterContent({ products, cartItems, setCartItems, transactionType, isLoadingProducts = false, isOnline = false, selectedOnlinePlatform = null, searchQuery = '', setSearchQuery, loadedTransactionInfo = null }: CenterContentProps) {
  const [showCustomizationModal, setShowCustomizationModal] = useState(false);
  const [showCustomNoteModal, setShowCustomNoteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showBundleModal, setShowBundleModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedCartItem, setSelectedCartItem] = useState<CartItem | null>(null);
  const [loadingProductId, setLoadingProductId] = useState<number | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showTableSelectionModal, setShowTableSelectionModal] = useState(false);
  const [bundleItems, setBundleItems] = useState<BundleItem[]>([]);
  const [customerName, setCustomerName] = useState<string>('');

  // Column count state - load from localStorage, default to 5
  const [columnCount, setColumnCount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('product-grid-columns');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (parsed >= 3 && parsed <= 7) {
          return parsed;
        }
      }
    }
    return 5;
  });

  // Save column count to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('product-grid-columns', columnCount.toString());
    }
  }, [columnCount]);

  // Populate customer name when transaction is loaded
  useEffect(() => {
    if (loadedTransactionInfo?.customerName) {
      setCustomerName(loadedTransactionInfo.customerName);
    } else if (!loadedTransactionInfo) {
      // Clear customer name when no transaction is loaded (e.g., when New button is clicked)
      setCustomerName('');
    }
  }, [loadedTransactionInfo]);

  // Calculate responsive sizes based on column count
  const gridStyles = useMemo(() => {
    const baseSizes = {
      3: {
        gridCols: 'grid-cols-3',
        colSpan: 'col-span-3',
        cardPadding: 'p-3',
        productNameSize: 'text-sm',
        priceLabelSize: 'text-xs',
        priceValueSize: 'text-sm',
        bundleBadgeSize: 'text-xs',
        bundleBadgePadding: 'px-2 py-1',
        emojiSize: 'text-3xl',
      },
      4: {
        gridCols: 'grid-cols-4',
        colSpan: 'col-span-4',
        cardPadding: 'p-4',
        productNameSize: 'text-[18.48px]',
        priceLabelSize: 'text-[15.4px]',
        priceValueSize: 'text-[18.48px]',
        bundleBadgeSize: 'text-[15.4px]',
        bundleBadgePadding: 'px-3 py-1',
        emojiSize: 'text-[36.96px]',
      },
      5: {
        gridCols: 'grid-cols-5',
        colSpan: 'col-span-5',
        cardPadding: 'p-2',
        productNameSize: 'text-[10.8px]',
        priceLabelSize: 'text-[10px]',
        priceValueSize: 'text-xs',
        bundleBadgeSize: 'text-[10px]',
        bundleBadgePadding: 'px-1.5 py-0.5',
        emojiSize: 'text-2xl',
      },
    };
    return baseSizes[columnCount as keyof typeof baseSizes] || baseSizes[5];
  }, [columnCount]);

  // Send cart updates to customer display
  const sendCartUpdate = (cartItems: CartItem[]) => {
    if (window.electronAPI && window.electronAPI.updateCustomerDisplay) {
      window.electronAPI.updateCustomerDisplay({
        cartItems: cartItems,
        tabInfo: {
          activeTab: transactionType + (isOnline ? ' (Online)' : ''),
          isOnline: isOnline,
          selectedPlatform: selectedOnlinePlatform
        }
      });
    }
  };

  const PLATFORM_LABELS: Record<'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok', string> = {
    qpon: 'Qpon',
    gofood: 'GoFood',
    grabfood: 'GrabFood',
    shopeefood: 'ShopeeFood',
    tiktok: 'TikTok'
  };

  const sumCustomizationPrice = (customizations?: SelectedCustomization[]) => {
    if (!customizations || customizations.length === 0) return 0;
    return customizations.reduce((sum, customization) => {
      const optionTotal = customization.selected_options.reduce((optionSum, option) => {
        const priceAdj = typeof option.price_adjustment === 'number' ? option.price_adjustment : (typeof option.price_adjustment === 'string' ? parseFloat(option.price_adjustment) || 0 : 0);
        // #region agent log
        if (isNaN(priceAdj) || priceAdj !== option.price_adjustment) {
          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CenterContent.tsx:244',message:'Price adjustment type issue',data:{priceAdjustment:option.price_adjustment,priceAdjustmentType:typeof option.price_adjustment,parsedPriceAdj:priceAdj,optionName:option.option_name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'T'})}).catch(()=>{});
        }
        // #endregion
        return optionSum + priceAdj;
      }, 0);
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

  const checkProductCustomizations = async (product: Product) => {
    try {
      // Always try offline first for UI responsiveness
      const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (electronAPI?.localDbGetProductCustomizations) {
        const localData = await electronAPI.localDbGetProductCustomizations(product.id);
        if (Array.isArray(localData) && localData.length > 0) {
          return true;
        }
      }

      // Only try online if explicitly online mode and offline failed/empty
      if (isOnline && offlineSyncService.getStatus().isOnline) {
        try {
          const response = await fetch(getApiUrl(`/api/products/${product.id}/customizations`), {
            signal: AbortSignal.timeout(2000)
          });
          if (response.ok) {
            const data = await response.json();
            return data.customizations && data.customizations.length > 0;
          }
        } catch (e) {
          console.warn('Online check failed, ignoring:', e);
        }
      }

      return false;
    } catch (error) {
      console.error('Error checking customizations:', error);
    }
    return false;
  };

  const getOnlinePriceForPlatform = (product: Product): number | null => {
    if (!isOnline || !selectedOnlinePlatform) return null;
    switch (selectedOnlinePlatform) {
      case 'qpon':
        return product.harga_qpon ?? null;
      case 'gofood':
        return product.harga_gofood ?? null;
      case 'grabfood':
        return product.harga_grabfood ?? null;
      case 'shopeefood':
        return product.harga_shopeefood ?? null;
      case 'tiktok':
        return product.harga_tiktok ?? null;
      default:
        return null;
    }
  };

  const effectiveProductPrice = (product: Product): number | null => {
    if (isOnline && selectedOnlinePlatform) {
      const p = getOnlinePriceForPlatform(product);
      if (p === null) return null; // NULL price - don't show
      return p; // Return 0 if price is 0, or the actual price
    }
    // For offline mode, check if harga_jual is null
    if (product.harga_jual === null || product.harga_jual === undefined) {
      return null;
    }
    return product.harga_jual;
  };

  const handleProductClick = async (product: Product) => {
    if (isOnline && selectedOnlinePlatform) {
      const platformPrice = getOnlinePriceForPlatform(product);
      if (platformPrice === null) {
        return; // disabled in online mode for this platform (NULL price)
      }
      // Allow 0 prices - they should be clickable
    } else {
      // Offline mode - check if harga_jual is null
      const price = effectiveProductPrice(product);
      if (price === null) {
        return; // disabled if price is null
      }
    }
    setLoadingProductId(product.id);

    try {
      // Check if product is a bundle
      const isBundle = product.is_bundle === 1 || product.is_bundle === true;

      if (isBundle) {
        // Fetch bundle items
        try {
          console.log(`🔍 [BUNDLE] Fetching bundle items for product ${product.id} (${product.nama})`);

          // Always try offline first
          let finalItems: BundleItem[] = [];
          let foundLocally = false;

          const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
          if (electronAPI?.localDbGetBundleItems) {
            try {
              console.log(`🔄 [BUNDLE] Calling localDbGetBundleItems(${product.id})`);
              const localBundleItems = await electronAPI.localDbGetBundleItems(product.id);
              console.log(`📦 [BUNDLE] Offline fetch returned:`, localBundleItems);
              if (Array.isArray(localBundleItems) && localBundleItems.length > 0) {
                finalItems = localBundleItems as BundleItem[];
                foundLocally = true;
              }
            } catch (e) {
              console.warn('Local bundle fetch failed:', e);
            }
          }

          // Only try online if local failed/empty and we are online
          if (!foundLocally && offlineSyncService.getStatus().isOnline) {
            try {
              console.log(`🌐 [BUNDLE] Attempting online fetch for product ${product.id}`);
              const response = await fetch(getApiUrl(`/api/products/${product.id}/bundle-items`), {
                signal: AbortSignal.timeout(5000)
              });
              if (response.ok) {
                const data = await response.json();
                finalItems = data.bundleItems || [];
              }
            } catch (e) {
              console.warn('Online bundle fetch failed:', e);
            }
          }

          console.log(`📋 [BUNDLE] Final bundle items data:`, finalItems);
          console.log(`✅ [BUNDLE] Setting ${finalItems.length} bundle items and opening modal`);
          if (finalItems.length > 0) {
            console.log(`📦 [BUNDLE] First bundle item details:`, JSON.stringify(finalItems[0], null, 2));
            console.log(`📦 [BUNDLE] Bundle item has category2_name:`, finalItems[0].category2_name);
            console.log(`📦 [BUNDLE] Bundle item has category2_id:`, finalItems[0].category2_id);
          }
          setBundleItems(finalItems);
          setSelectedProduct(product);
          setShowBundleModal(true);
        } catch (error) {
          console.error('❌ [BUNDLE] Error fetching bundle items:', error);
          alert('Gagal memuat detail bundle. Silakan coba lagi.');
        }
      } else {
        // Regular product flow
        const hasCustomizations = await checkProductCustomizations(product);

        if (hasCustomizations) {
          setSelectedProduct(product);
          setShowCustomizationModal(true);
        } else {
          // Show custom note modal for products without customizations
          setSelectedProduct(product);
          setShowCustomNoteModal(true);
        }
      }
    } finally {
      setLoadingProductId(null);
    }
  };

  const addToCart = (product: Product, customizations?: SelectedCustomization[], quantity: number = 1, customNote?: string, bundleSelections?: BundleSelection[]) => {
    // Check if this is a basic product (no customizations, no custom note, no bundle)
    const hasCustomizations = customizations && customizations.length > 0;
    const hasCustomNote = customNote && customNote.trim() !== '';
    const isBundle = bundleSelections && bundleSelections.length > 0;

    let existingItem: CartItem | undefined;

    // For bundles, always create new cart item (each bundle selection is unique)
    if (isBundle) {
      existingItem = undefined;
    } else if (!hasCustomizations && !hasCustomNote) {
      // For basic products (no customizations, no notes), find any existing item of the same product
      // regardless of customizations or notes, as long as it's also a basic product
      existingItem = cartItems.find(item =>
        item.product.id === product.id &&
        (!item.customizations || item.customizations.length === 0) &&
        (!item.customNote || item.customNote.trim() === '') &&
        (!item.bundleSelections || item.bundleSelections.length === 0)
      );
    } else {
      // For products with customizations or notes, match exactly
      existingItem = cartItems.find(item =>
        item.product.id === product.id &&
        JSON.stringify(item.customizations) === JSON.stringify(customizations) &&
        item.customNote === customNote &&
        (!item.bundleSelections || item.bundleSelections.length === 0)
      );
    }

    let newCartItems: CartItem[];

    if (existingItem && !isBundle) {
      newCartItems = cartItems.map(item =>
        item.id === existingItem!.id
          ? { ...item, quantity: item.quantity + quantity }
          : item
      );
    } else {
      newCartItems = [...cartItems, {
        id: Date.now(),
        product,
        quantity,
        customizations: customizations || [],
        customNote: customNote || undefined,
        bundleSelections: bundleSelections || undefined
      }];
    }

    setCartItems(newCartItems);

    // Send cart update to customer display
    sendCartUpdate(newCartItems);
  };

  const handleCustomNoteConfirm = (note: string) => {
    if (selectedProduct) {
      addToCart(selectedProduct, undefined, 1, note);
    }
  };

  const handleBundleConfirm = (bundleSelections: BundleSelection[]) => {
    if (selectedProduct) {
      const sanitizedSelections = bundleSelections.map(selection => ({
        ...selection,
        selectedProducts: selection.selectedProducts.map(sp => ({
          product: sp.product,
          customizations: sp.customizations,
          customNote: sp.customNote
        }))
      }));
      addToCart(selectedProduct, undefined, 1, undefined, sanitizedSelections);
    }
  };

  const handleEditItem = (cartItem: CartItem) => {
    setSelectedCartItem(cartItem);
    setShowEditModal(true);
  };

  const handleUpdateItem = (updatedItem: CartItem) => {
    const newCartItems = cartItems.map(item =>
      item.id === updatedItem.id ? updatedItem : item
    );
    setCartItems(newCartItems);
    sendCartUpdate(newCartItems);
  };

  const handlePaymentComplete = () => {
    if (cartItems.length === 0) return;

    // Clear cart immediately after payment completion (receipt printed)
    setCartItems([]);
    sendCartUpdate([]);
  };

  const formatPrice = (price: number) => {
    return `Rp ${price.toLocaleString('id-ID')}`;
  };

  const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = cartItems.reduce((sum, item) => {
    let itemPrice = effectiveProductPrice(item.product);
    
    // If price is null, skip this item (shouldn't happen if items are already in cart, but safety check)
    if (itemPrice === null) return sum;

    // Add customization prices
    if (item.customizations) {
      item.customizations.forEach(customization => {
        customization.selected_options.forEach(option => {
          itemPrice! += option.price_adjustment;
        });
      });
    }

    // Add bundle customization prices per bundle unit
    if (item.bundleSelections) {
      itemPrice! += calculateBundleCustomizationCharge(item.bundleSelections);
    }

    return sum + (itemPrice! * item.quantity);
  }, 0);

  return (
    <div className="flex-1 bg-gray-50 flex">
      {/* Left Side - Cart Area */}
      <div className={`w-[34%] flex flex-col relative ${loadedTransactionInfo ? 'bg-yellow-50' : ''}`} style={{ height: 'calc(100vh - 80px)', maxHeight: 'calc(100vh - 80px)' }}>
        {/* Opening Transaction Header - Only show in lihat mode */}
        {loadedTransactionInfo && (
          <div className="bg-yellow-100 border-b-2 border-yellow-400 px-4 py-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-yellow-900">
                Opening - {loadedTransactionInfo.transactionId}
                {loadedTransactionInfo.tableName && loadedTransactionInfo.roomName
                  ? `/${loadedTransactionInfo.tableName}/${loadedTransactionInfo.roomName}`
                  : ''}
                {loadedTransactionInfo.customerName
                  ? `/${loadedTransactionInfo.customerName}`
                  : ''}
              </span>
            </div>
          </div>
        )}
        <div className="flex-1 p-4 flex flex-col overflow-hidden">
        {/* Top Navigation - Only show when not in lihat mode */}
        {!loadedTransactionInfo && (
          <div className="flex items-center justify-between mb-6 flex-shrink-0">
            <div className="flex space-x-2">
              <button className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-sm font-medium">
                Masuk
              </button>
              <button disabled className="px-3 py-1 text-gray-400 text-sm font-medium cursor-not-allowed opacity-50">
                <span className="line-through">Mendaftar</span>
              </button>
            </div>
            <button
              onClick={() => {
                if (cartItems.length > 0) {
                  if (confirm('Are you sure you want to clear all items from the cart?')) {
                    setCartItems([]);
                    sendCartUpdate([]);
                  }
                }
              }}
              className="p-2 text-gray-600 hover:text-gray-800 hover:bg-red-50 rounded-lg transition-colors"
              title="Clear Cart"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}

        {/* Customer Name Input - Only show when no transaction is loaded */}
        {!loadedTransactionInfo && (
          <div className="mb-4 flex-shrink-0">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nama Pelanggan
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Masukkan nama pelanggan"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        )}

        {/* Cart Items Area - Scrollable with Padding for Summary */}
        <div className="flex-1 overflow-y-auto mb-4" style={{ minHeight: 0, paddingBottom: '220px' }}>
          {/* Empty Cart Indicator */}
          {cartItems.length === 0 && (
            <div className="text-center py-12">
              <div className="w-24 h-24 mx-auto mb-4 text-gray-300">
                <ShoppingCart className="w-full h-full" />
              </div>
              <p className="text-gray-400 text-base">Keranjang belanja kosong</p>
            </div>
          )}

          {/* Cart Items List */}
          {cartItems.length > 0 && (
            <div className="space-y-2">
              {cartItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleEditItem(item)}
                  className="bg-white rounded-lg border border-gray-200 p-3 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all duration-200"
                  title="Click to edit item"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-800 text-sm">{item.product.nama}</h4>
                      {effectiveProductPrice(item.product) !== null && (
                        <p className="text-gray-600 text-xs">
                          {formatPrice(effectiveProductPrice(item.product)!)} each
                        </p>
                      )}

                      {/* Customizations */}
                      {item.customizations && item.customizations.length > 0 && (() => {
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CenterContent.tsx:605',message:'Rendering customizations in cart',data:{itemId:item.id,productName:item.product.nama,customizationsCount:item.customizations.length,customizations:item.customizations.map((c:any)=>({customization_id:c.customization_id,customization_name:c.customization_name,selected_options_count:c.selected_options?.length||0,selected_options:c.selected_options?.map((o:any)=>({option_id:o.option_id,option_name:o.option_name,hasOptionName:!!o.option_name}))||[],selected_options_type:typeof c.selected_options})),firstCustomization:item.customizations[0]?{name:item.customizations[0].customization_name,options:item.customizations[0].selected_options}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
                        // #endregion
                        return (
                        <div className="mt-1 space-y-1">
                          {item.customizations.map((customization) => (
                            <div key={customization.customization_id} className="text-xs">
                              <span className="text-gray-500">{customization.customization_name}:</span>
                              <div className="ml-2 space-y-0.5">
                                {customization.selected_options && customization.selected_options.length > 0 ? (
                                  customization.selected_options.map((option) => (
                                    <div key={option.option_id} className="flex items-center justify-between">
                                      <span className="text-gray-600">• {option.option_name}</span>
                                      {option.price_adjustment !== 0 && (
                                        <span className={`text-xs ${option.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'
                                          }`}>
                                          {option.price_adjustment > 0 ? '+' : ''}{formatPrice(option.price_adjustment)}
                                        </span>
                                      )}
                                    </div>
                                  ))
                                ) : (
                                  // #region agent log
                                  (() => {
                                    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'CenterContent.tsx:611',message:'Customization has no selected_options',data:{customization_id:customization.customization_id,customization_name:customization.customization_name,selected_options:customization.selected_options,selected_options_type:typeof customization.selected_options,selected_options_length:Array.isArray(customization.selected_options)?customization.selected_options.length:'not_array'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'L'})}).catch(()=>{});
                                    return null;
                                  })()
                                  // #endregion
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        );
                      })()}

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
                                    <div key={spIdx} className="text-xs text-gray-600 border border-gray-200 rounded px-2 py-1 bg-white space-y-1">
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
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent opening edit modal
                          if (item.quantity > 1) {
                            const newCartItems = cartItems.map(cartItem =>
                              cartItem.id === item.id
                                ? { ...cartItem, quantity: cartItem.quantity - 1 }
                                : cartItem
                            );
                            setCartItems(newCartItems);
                            sendCartUpdate(newCartItems);
                          } else {
                            const newCartItems = cartItems.filter(cartItem => cartItem.id !== item.id);
                            setCartItems(newCartItems);
                            sendCartUpdate(newCartItems);
                          }
                        }}
                        className="w-6 h-6 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-xs text-white"
                      >
                        -
                      </button>
                      <span className="text-sm font-medium w-8 text-center text-black">{item.quantity}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent opening edit modal
                          const newCartItems = cartItems.map(cartItem =>
                            cartItem.id === item.id
                              ? { ...cartItem, quantity: cartItem.quantity + 1 }
                              : cartItem
                          );
                          setCartItems(newCartItems);
                          sendCartUpdate(newCartItems);
                        }}
                        className="w-6 h-6 bg-green-500 hover:bg-green-600 text-white rounded-full flex items-center justify-center text-xs"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-between items-center">
                    <span className="text-xs text-gray-500">Subtotal</span>
                    <span className="font-semibold text-green-600">
                      {(() => {
                        // #region agent log
                        const logData = {location:'CenterContent.tsx:746',message:'Calculating subtotal',data:{itemId:item.id,productId:item.product.id,productName:item.product.nama,hasCustomizations:!!item.customizations,customizationsCount:item.customizations?.length||0,hasBundleSelections:!!item.bundleSelections,quantity:item.quantity,quantityType:typeof item.quantity},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'O'};
                        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(()=>{});
                        // #endregion
                        let itemPrice = effectiveProductPrice(item.product);
                        // #region agent log
                        const logData2 = {location:'CenterContent.tsx:747',message:'After effectiveProductPrice',data:{itemId:item.id,itemPrice,itemPriceType:typeof itemPrice,isNull:itemPrice===null,isNaN:Number.isNaN(itemPrice)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'P'};
                        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData2)}).catch(()=>{});
                        // #endregion
                        if (itemPrice === null) return 'N/A';
                        if (item.customizations) {
                          const customizationPrice = sumCustomizationPrice(item.customizations);
                          // #region agent log
                          const logData3 = {location:'CenterContent.tsx:749',message:'After sumCustomizationPrice',data:{itemId:item.id,customizationPrice,customizationPriceType:typeof customizationPrice,isNaN:Number.isNaN(customizationPrice),itemPriceBefore:itemPrice,itemPriceAfter:itemPrice+customizationPrice},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'Q'};
                          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData3)}).catch(()=>{});
                          // #endregion
                          itemPrice += customizationPrice;
                        }
                        if (item.bundleSelections) {
                          const bundleCharge = calculateBundleCustomizationCharge(item.bundleSelections);
                          // #region agent log
                          const logData4 = {location:'CenterContent.tsx:752',message:'After calculateBundleCustomizationCharge',data:{itemId:item.id,bundleCharge,bundleChargeType:typeof bundleCharge,isNaN:Number.isNaN(bundleCharge),itemPriceBefore:itemPrice,itemPriceAfter:itemPrice+bundleCharge},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'R'};
                          fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData4)}).catch(()=>{});
                          // #endregion
                          itemPrice += bundleCharge;
                        }
                        const finalPrice = itemPrice * item.quantity;
                        // #region agent log
                        const logData5 = {location:'CenterContent.tsx:754',message:'Final calculation',data:{itemId:item.id,itemPrice,quantity:item.quantity,quantityType:typeof item.quantity,finalPrice,finalPriceType:typeof finalPrice,isNaN:Number.isNaN(finalPrice)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'S'};
                        fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData5)}).catch(()=>{});
                        // #endregion
                        return formatPrice(finalPrice);
                      })()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cart Summary - Sticky at Bottom of Viewport */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 flex-shrink-0" style={{ position: 'sticky', bottom: '16px', zIndex: 10 }}>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-black">Harga produk asli</span>
              <span className="font-medium text-black">{formatPrice(totalPrice)}</span>
            </div>
            <hr className="border-gray-200" />
            <div className="flex justify-between items-center">
              <span className="text-gray-600">{totalItems} Barang</span>
              <div className="bg-blue-100 px-3 py-1 rounded">
                <span className="font-semibold text-blue-800">Yang Diterima: {formatPrice(totalPrice)}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-2 mt-3">
            <button
              onClick={() => setShowTableSelectionModal(true)}
              disabled={cartItems.length === 0}
              className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white py-1.5 px-3 rounded-lg transition-colors text-sm"
            >
              Simpan Order
            </button>
            <button
              onClick={() => setShowPaymentModal(true)}
              disabled={cartItems.length === 0}
              className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white py-1.5 px-3 rounded-lg transition-colors text-sm"
            >
              Bayar
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Right Side - Product Grid */}
      <div className="w-[66%] p-4 flex flex-col h-full relative">
        {/* Column Count Control and Search */}
        <div className="flex items-center justify-between mb-3 flex-shrink-0 gap-4">
          <div className="flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 text-gray-600" />
            <span className="text-xs text-gray-600">Columns:</span>
            <div className="flex items-center gap-1">
              {[3, 4, 5].map((cols) => (
                <button
                  key={cols}
                  onClick={() => setColumnCount(cols)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${columnCount === cols
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  title={`${cols} columns`}
                >
                  {cols}
                </button>
              ))}
            </div>
          </div>

          {/* Search Bar */}
          {setSearchQuery && (
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari produk atau harga..."
                className="pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm w-full text-black placeholder:text-gray-400"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Loading Overlay for Category Switching */}
        {isLoadingProducts && (
          <div className="absolute inset-0 bg-white/80 z-20 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-600 text-lg">Loading products...</p>
            </div>
          </div>
        )}

        {/* Product Grid - Scrollable with Fixed Height */}
        <div className="overflow-y-auto mb-4" style={{ height: 'calc(97vh)' }}>
          <div className={`grid ${gridStyles.gridCols} gap-2`}>
            {(() => {
              // Debug: Log ALL products and their harga_jual values
              console.log('🔍 [CENTER CONTENT] Total products received:', products.length);
              console.log('🔍 [CENTER CONTENT] Sample products (first 5):', products.slice(0, 5).map(p => ({ 
                id: p.id, 
                nama: p.nama, 
                harga_jual: p.harga_jual, 
                harga_jual_type: typeof p.harga_jual,
                isNull: p.harga_jual === null,
                isUndefined: p.harga_jual === undefined,
                isZero: p.harga_jual === 0
              })));
              
              // Debug: Log products with null harga_jual
              const productsWithNullPrice = products.filter(p => p.harga_jual === null || p.harga_jual === undefined);
              if (productsWithNullPrice.length > 0) {
                console.log('⚠️ [CENTER CONTENT] Products with NULL harga_jual found:', productsWithNullPrice.length, productsWithNullPrice.map(p => ({ id: p.id, nama: p.nama, harga_jual: p.harga_jual })));
              }
              
              // Debug: Log products with zero harga_jual
              const productsWithZeroPrice = products.filter(p => p.harga_jual === 0);
              if (productsWithZeroPrice.length > 0) {
                console.log('ℹ️ [CENTER CONTENT] Products with ZERO harga_jual (should show):', productsWithZeroPrice.length, productsWithZeroPrice.map(p => ({ id: p.id, nama: p.nama, harga_jual: p.harga_jual })));
              }

              // Helper function to check if price is null/undefined
              // Note: 0 is handled separately in filtering logic (filtered out in offline mode)
              const isPriceNull = (price: number | null | undefined): boolean => {
                return price === null || price === undefined;
              };

              // First filter by platform/online status and null harga_jual
              let filteredProducts = products.filter((product) => {
                // ALWAYS filter out products with null/undefined/zero harga_jual in offline mode
                if (!isOnline) {
                  // Filter out NULL, undefined, or 0 (0 is used as fallback for products that only have platform prices)
                  if (isPriceNull(product.harga_jual) || product.harga_jual === 0) {
                    return false; // Don't show products with NULL or 0 harga_jual in offline mode
                  }
                  return true;
                }
                
                // Online mode
                if (!selectedOnlinePlatform) {
                  // Online mode but no platform selected - still check harga_jual
                  if (isPriceNull(product.harga_jual)) {
                    return false;
                  }
                  return true;
                }
                
                // Online mode with platform selected - check platform price
                const p = getOnlinePriceForPlatform(product);
                // Allow 0 prices, only filter out null prices
                return !isPriceNull(p);
              });

              // Debug: Log filtering results
              const filteredOutCount = products.length - filteredProducts.length;
              console.log('🔍 [CENTER CONTENT] Filtering results:', {
                totalProducts: products.length,
                filteredOut: filteredOutCount,
                remaining: filteredProducts.length,
                isOnline: isOnline,
                selectedPlatform: selectedOnlinePlatform
              });
              
              // Debug: Check what was filtered out
              if (filteredOutCount > 0) {
                const filteredOutProducts = products.filter(p => !filteredProducts.includes(p));
                console.log('🔍 [CENTER CONTENT] Filtered out products details:', filteredOutProducts.map(p => ({ 
                  id: p.id, 
                  nama: p.nama, 
                  harga_jual: p.harga_jual,
                  harga_jual_type: typeof p.harga_jual
                })));
              }

              // Then filter by search query if provided
              if (searchQuery.trim()) {
                const query = searchQuery.trim().toLowerCase();
                const numericQuery = query.replace(/[^\d]/g, ''); // Extract only digits
                const isNumericQuery = numericQuery.length > 0;

                filteredProducts = filteredProducts.filter((product) => {
                  // Check product name match (case-insensitive)
                  const nameMatch = product.nama.toLowerCase().includes(query);

                  // Check price match if query contains numbers
                  let priceMatch = false;
                  if (isNumericQuery) {
                    const productPrice = effectiveProductPrice(product);
                    // Only check price if it's not null
                    if (productPrice !== null) {
                      const priceString = productPrice.toString();
                      priceMatch = priceString.includes(numericQuery);
                    }
                  }

                  return nameMatch || priceMatch;
                });
              }

              if (filteredProducts.length === 0 && !isLoadingProducts) {
                return (
                  <div className={`${gridStyles.colSpan} flex items-center justify-center h-32`}>
                    <p className="text-gray-500">
                      {searchQuery.trim()
                        ? 'No products found matching your search'
                        : isOnline && selectedOnlinePlatform
                          ? `No products available for ${PLATFORM_LABELS[selectedOnlinePlatform]}`
                          : 'No products available'}
                    </p>
                  </div>
                );
              }

              return filteredProducts.map((product) => {
                const isDisabledOnline = false;
                const isBundle = product.is_bundle === 1 || product.is_bundle === true;
                const productPrice = effectiveProductPrice(product);
                
                // Debug: Log if productPrice is null or 0 for products that shouldn't show
                if (productPrice === null) {
                  console.log('⚠️ [CENTER CONTENT] Product with NULL effectivePrice still in filtered list:', {
                    id: product.id,
                    nama: product.nama,
                    harga_jual: product.harga_jual,
                    effectivePrice: productPrice,
                    isOnline: isOnline,
                    platform: selectedOnlinePlatform
                  });
                }
                
                return (
                  <button
                    key={product.id}
                    onClick={() => handleProductClick(product)}
                    disabled={loadingProductId === product.id || isDisabledOnline}
                    className={`bg-white rounded-lg border border-gray-200 ${gridStyles.cardPadding} hover:shadow-md transition-shadow w-full text-left relative ${loadingProductId === product.id || isDisabledOnline ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                  >
                    {/* Loading Overlay */}
                    {loadingProductId === product.id && (
                      <div className="absolute inset-0 bg-white/80 rounded-lg flex items-center justify-center z-10">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                      </div>
                    )}

                    {/* Bundle Badge */}
                    {isBundle && (
                      <div className={`absolute top-1 right-1 bg-purple-500 text-white ${gridStyles.bundleBadgePadding} rounded-full ${gridStyles.bundleBadgeSize} font-semibold z-10`}>
                        Bundle
                      </div>
                    )}

                    {/* Product Image - 1st Row */}
                    <div className="relative w-full aspect-square bg-gray-50 rounded-lg mb-2 flex items-center justify-center overflow-hidden">
                      <ProductCardImage
                        imageUrl={product.image_url}
                        productName={product.nama}
                        categoryName={product.category2_name}
                        emojiSize={gridStyles.emojiSize}
                      />
                    </div>

                    {/* Product Info - 2nd Row */}
                    <div className="space-y-1">
                      {/* Product Name */}
                      <h3 className={`font-medium text-gray-800 ${gridStyles.productNameSize} leading-tight line-clamp-2`}>{product.nama}</h3>
                      {/* Price - Only show if price is not null */}
                      {productPrice !== null && (
                        <div className="flex items-baseline">
                          <span className={`text-gray-600 ${gridStyles.priceLabelSize}`}>RP</span>
                          <span className={`text-green-600 font-bold ${gridStyles.priceValueSize} ml-0.5`}>
                            {productPrice.toLocaleString('id-ID')}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              });
            })()}
          </div>
        </div>

        {/* Action Buttons - Fixed Footer */}
        <div className="py-2 mb-6 flex-shrink-0">
          <div className="flex justify-between items-center space-x-2">
            <button disabled className="flex-1 bg-gray-300 border border-gray-300 rounded px-2 py-2 text-gray-400 cursor-not-allowed opacity-50 flex items-center justify-center space-x-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span className="text-xs line-through">Ambil Pesanan</span>
            </button>

            <button disabled className="flex-1 bg-gray-300 border border-gray-300 rounded px-2 py-2 text-gray-400 cursor-not-allowed opacity-50 flex items-center justify-center space-x-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              <span className="text-xs line-through">Kupon</span>
            </button>

            <button disabled className="flex-1 bg-gray-300 border border-gray-300 rounded px-2 py-2 text-gray-400 cursor-not-allowed opacity-50 flex items-center justify-center space-x-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-xs line-through">Aktivitas</span>
            </button>

            <button disabled className="flex-1 bg-gray-300 border border-gray-300 rounded px-2 py-2 text-gray-400 cursor-not-allowed opacity-50 flex items-center justify-center space-x-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
              <span className="text-xs line-through">Menukarkan</span>
            </button>
          </div>
        </div>
      </div>

      {/* Product Customization Modal */}
      <ProductCustomizationModal
        isOpen={showCustomizationModal}
        onClose={() => {
          setShowCustomizationModal(false);
          setSelectedProduct(null);
        }}
        product={selectedProduct as unknown as { id: number; business_id: number; menu_code: string; nama: string; kategori: string; harga_jual: number; status: string } | null}
        effectivePrice={selectedProduct ? (effectiveProductPrice(selectedProduct) ?? undefined) : undefined}
        onAddToCart={(product, customizations, quantity, customNote) => {
          const centerProduct = product as unknown as Product;
          addToCart(centerProduct, customizations, quantity, customNote);
        }}
      />

      {/* Payment Modal */}
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        initialCustomerName={customerName}
        cartItems={cartItems as unknown as Array<{
          id: number;
          product: {
            id: number;
            business_id: number;
            menu_code: string;
            nama: string;
            kategori: string;
            harga_jual: number;
            status: string;
            harga_gofood?: number;
            harga_grabfood?: number;
            harga_shopeefood?: number;
            harga_tiktok?: number;
            harga_qpon?: number;
          };
          quantity: number;
          customizations?: Array<{
            customization_id: number;
            customization_name: string;
            selected_options: Array<{
              option_id: number;
              option_name: string;
              price_adjustment: number;
            }>;
          }>;
          customNote?: string;
          bundleSelections?: BundleSelection[];
        }>}
        onPaymentComplete={handlePaymentComplete}
        transactionType={transactionType}
        isOnline={isOnline}
        selectedOnlinePlatform={selectedOnlinePlatform}
      />

      {/* Table Selection Modal */}
      <TableSelectionModal
        isOpen={showTableSelectionModal}
        onClose={() => setShowTableSelectionModal(false)}
        customerName={customerName}
        cartItems={cartItems as unknown as Array<{
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
          customizations?: Array<{
            customization_id: number;
            customization_name: string;
            selected_options: Array<{
              option_id: number;
              option_name: string;
              price_adjustment: number;
            }>;
          }>;
          customNote?: string;
          bundleSelections?: unknown[];
        }>}
        transactionType={transactionType}
        onSuccess={() => {
          // Clear cart after successful save
          setCartItems([]);
          sendCartUpdate([]);
        }}
      />

      {/* Custom Note Modal */}
      <CustomNoteModal
        isOpen={showCustomNoteModal}
        onClose={() => {
          setShowCustomNoteModal(false);
          setSelectedProduct(null);
        }}
        product={selectedProduct as unknown as { id: number; business_id: number; menu_code: string; nama: string; kategori: string; harga_jual: number; status: string } | null}
        effectivePrice={selectedProduct ? (effectiveProductPrice(selectedProduct) ?? undefined) : undefined}
        onConfirm={handleCustomNoteConfirm}
      />

      {/* Edit Item Modal */}
      <EditItemModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedCartItem(null);
        }}
        cartItem={selectedCartItem as unknown as {
          id: number;
          product: {
            id: number;
            business_id: number;
            menu_code: string;
            nama: string;
            kategori: string;
            harga_jual: number;
            status: string;
          };
          quantity: number;
          customizations?: Array<{
            customization_id: number;
            customization_name: string;
            selected_options: Array<{
              option_id: number;
              option_name: string;
              price_adjustment: number;
            }>;
          }>;
          customNote?: string;
        } | null}
        effectivePrice={selectedCartItem ? (effectiveProductPrice(selectedCartItem.product) ?? undefined) : undefined}
        onUpdate={(updatedItem) => {
          const centerCartItem = updatedItem as unknown as CartItem;
          handleUpdateItem(centerCartItem);
        }}
      />

      {/* Bundle Selection Modal */}
      {selectedProduct && (
        <BundleSelectionModal
          isOpen={showBundleModal}
          onClose={() => {
            setShowBundleModal(false);
            setSelectedProduct(null);
            setBundleItems([]);
          }}
          onConfirm={handleBundleConfirm}
          bundleProduct={{
            id: selectedProduct.id,
            nama: selectedProduct.nama,
            harga_jual: selectedProduct.harga_jual
          }}
          bundleItems={bundleItems}
        />
      )}
    </div>
  );
}
