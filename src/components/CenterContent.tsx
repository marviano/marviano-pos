'use client';

import { ShoppingCart, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import ProductCustomizationModal from './ProductCustomizationModal';
import CustomNoteModal from './CustomNoteModal';
import EditItemModal from './EditItemModal';
import PaymentModal from './PaymentModal';

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
  harga_online?: number | null;
  image_url: string | null;
  status: string;
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
  product: Product;
  quantity: number;
  customizations?: SelectedCustomization[];
  customNote?: string;
}

interface CenterContentProps {
  products: Product[];
  cartItems: CartItem[];
  setCartItems: (items: CartItem[]) => void;
  transactionType: 'drinks' | 'bakery';
  isLoadingProducts?: boolean;
  isOnline?: boolean;
}

export default function CenterContent({ products, cartItems, setCartItems, transactionType, isLoadingProducts = false, isOnline = false }: CenterContentProps) {
  const [showCustomizationModal, setShowCustomizationModal] = useState(false);
  const [showCustomNoteModal, setShowCustomNoteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedCartItem, setSelectedCartItem] = useState<CartItem | null>(null);
  const [loadingProductId, setLoadingProductId] = useState<number | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  // Send order updates to customer display
  const sendOrderUpdate = (orderData: any) => {
    if (window.electronAPI && window.electronAPI.updateCustomerDisplay) {
      window.electronAPI.updateCustomerDisplay({ order: orderData });
    }
  };

  // Send cart updates to customer display
  const sendCartUpdate = (cartItems: CartItem[]) => {
    if (window.electronAPI && window.electronAPI.updateCustomerDisplay) {
      window.electronAPI.updateCustomerDisplay({ 
        cartItems: cartItems,
        tabInfo: {
          activeTab: transactionType + (isOnline ? ' (Online)' : ''),
          isOnline: isOnline
        }
      });
    }
  };

  const checkProductCustomizations = async (product: Product) => {
    try {
      const response = await fetch(`/api/products/${product.id}/customizations`);
      if (response.ok) {
        const data = await response.json();
        return data.customizations && data.customizations.length > 0;
      }
    } catch (error) {
      console.error('Error checking customizations:', error);
    }
    return false;
  };

  const handleProductClick = async (product: Product) => {
    if (isOnline && (!product.harga_online || product.harga_online <= 0)) {
      return; // disabled in online mode
    }
    setLoadingProductId(product.id);
    
    try {
      const hasCustomizations = await checkProductCustomizations(product);
      
      if (hasCustomizations) {
        setSelectedProduct(product);
        setShowCustomizationModal(true);
      } else {
        // Show custom note modal for products without customizations
        setSelectedProduct(product);
        setShowCustomNoteModal(true);
      }
    } finally {
      setLoadingProductId(null);
    }
  };

  const addToCart = (product: Product, customizations?: SelectedCustomization[], quantity: number = 1, customNote?: string) => {
    // Check if this is a basic product (no customizations and no custom note)
    const hasCustomizations = customizations && customizations.length > 0;
    const hasCustomNote = customNote && customNote.trim() !== '';
    
    let existingItem: CartItem | undefined;
    
    if (!hasCustomizations && !hasCustomNote) {
      // For basic products (no customizations, no notes), find any existing item of the same product
      // regardless of customizations or notes, as long as it's also a basic product
      existingItem = cartItems.find(item => 
        item.product.id === product.id && 
        (!item.customizations || item.customizations.length === 0) &&
        (!item.customNote || item.customNote.trim() === '')
      );
    } else {
      // For products with customizations or notes, match exactly
      existingItem = cartItems.find(item => 
        item.product.id === product.id && 
        JSON.stringify(item.customizations) === JSON.stringify(customizations) &&
        item.customNote === customNote
      );
    }
    
    let newCartItems: CartItem[];
    
    if (existingItem) {
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
        customNote: customNote || undefined
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
    
    // Update order status to preparing
    const orderData = {
      id: `order-${Date.now()}`,
      items: cartItems.map(item => ({
        id: item.id.toString(),
        name: item.product.nama,
        quantity: item.quantity,
        price: item.product.harga_jual,
        status: 'preparing'
      })),
      total: totalPrice,
      status: 'preparing',
      timestamp: new Date()
    };
    
    sendOrderUpdate(orderData);
    
    // Clear cart immediately after payment completion
    setCartItems([]);
    sendCartUpdate([]);
    
    // Simulate order completion after 10 seconds
    setTimeout(() => {
      const completedOrderData = {
        ...orderData,
        items: orderData.items.map(item => ({ ...item, status: 'ready' })),
        status: 'ready'
      };
      sendOrderUpdate(completedOrderData);
    }, 10000);
  };

  const formatPrice = (price: number) => {
    return `Rp ${price.toLocaleString('id-ID')}`;
  };

  const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = cartItems.reduce((sum, item) => {
    // Use harga_online for online tabs, otherwise use harga_jual
    let itemPrice = isOnline && item.product.harga_online ? item.product.harga_online : item.product.harga_jual;
    
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
    <div className="flex-1 bg-gray-50 flex">
      {/* Left Side - Cart Area */}
      <div className="w-[40%] p-4 pb-12 flex flex-col">
        {/* Top Navigation */}
        <div className="flex items-center justify-between mb-6 flex-shrink-0">
          <div className="flex space-x-2">
            <button className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-sm font-medium">
              Masuk
            </button>
            <button className="px-3 py-1 text-gray-500 text-sm font-medium">
              Mendaftar
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

        {/* Cart Items Area - Scrollable */}
        <div className="flex-1 overflow-y-auto mb-4">
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
                      <p className="text-gray-600 text-xs">
                        {formatPrice(isOnline && item.product.harga_online ? item.product.harga_online : item.product.harga_jual)} each
                      </p>
                      
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
                            <span className="text-gray-700 ml-1 italic">"{item.customNote}"</span>
                          </div>
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
              ))}
            </div>
          )}
        </div>

        {/* Cart Summary - Sticky at Bottom */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 flex-shrink-0">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-black">Harga produk asli</span>
              <span className="font-medium text-black">{formatPrice(totalPrice)}</span>
            </div>
            <div className="flex justify-between text-red-600">
              <span>Berpartisipasi</span>
              <span>-{formatPrice(0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Kupon</span>
              <span>-</span>
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
            <button className="flex-1 bg-gray-500 hover:bg-gray-600 text-white py-1.5 px-3 rounded-lg transition-colors text-sm">
              Pesanan Tertunda
            </button>
            <button 
              onClick={() => setShowPaymentModal(true)}
              disabled={cartItems.length === 0}
              className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white py-1.5 px-3 rounded-lg transition-colors text-sm"
            >
              Menerima Pesanan
            </button>
          </div>
        </div>
      </div>

      {/* Right Side - Product Grid */}
      <div className="w-[60%] p-4 flex flex-col h-full relative">
        {/* Loading Overlay for Category Switching */}
        {isLoadingProducts && (
          <div className="absolute inset-0 bg-white/80 z-20 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-600 text-lg">Loading products...</p>
            </div>
          </div>
        )}
        
        {/* Product Grid - Scrollable */}
        <div className="flex-1 overflow-y-auto mb-4">
          <div className="grid grid-cols-3 gap-3">
            {products.length === 0 && !isLoadingProducts ? (
              <div className="col-span-3 flex items-center justify-center h-32">
                <p className="text-gray-500">No products available</p>
              </div>
            ) : (
              products.map((product) => {
                const isDisabledOnline = isOnline && (!product.harga_online || product.harga_online <= 0);
                return (
              <button
                key={product.id}
                  onClick={() => handleProductClick(product)}
                  disabled={loadingProductId === product.id || isDisabledOnline}
                  className={`bg-white rounded-lg border border-gray-200 p-3 hover:shadow-md transition-shadow w-full text-left relative ${
                    loadingProductId === product.id || isDisabledOnline ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  }`}
              >
                {/* Loading Overlay */}
                {loadingProductId === product.id && (
                  <div className="absolute inset-0 bg-white/80 rounded-lg flex items-center justify-center z-10">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  </div>
                )}
                
                {/* Product Image */}
                <div className="w-full aspect-square bg-gray-50 rounded-lg mb-3 flex items-center justify-center overflow-hidden">
                  {product.image_url ? (
                    <img 
                      src={product.image_url} 
                      alt={product.nama}
                      className="w-full h-full object-contain rounded-lg"
                      onError={(e) => {
                        // Fallback to emoji if image fails to load
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const parent = target.parentElement;
                        if (parent) {
                          // Choose emoji based on category
                          let emoji = '🍦'; // default
                          if (product.category2_name === 'Bakery') {
                            emoji = '🥖';
                          } else if (product.category2_name === 'Ice Cream Cone') {
                            emoji = '🍦';
                          } else if (product.category2_name === 'Sundae') {
                            emoji = '🍨';
                          } else if (product.category2_name === 'Milk Tea') {
                            emoji = '🧋';
                          }
                          parent.innerHTML = `<span class="text-gray-400 text-2xl">${emoji}</span>`;
                        }
                      }}
                    />
                  ) : (
                    <span className="text-gray-400 text-2xl">
                      {product.category2_name === 'Bakery' ? '🥖' : 
                       product.category2_name === 'Ice Cream Cone' ? '🍦' :
                       product.category2_name === 'Sundae' ? '🍨' :
                       product.category2_name === 'Milk Tea' ? '🧋' : '🍦'}
                    </span>
                  )}
                </div>
                
                {/* Product Info */}
                <div className="space-y-2">
                  <h3 className="font-medium text-gray-800 text-sm leading-tight">{product.nama}</h3>
                  <div className="flex items-baseline">
                    <span className="text-gray-600 text-xs">RP</span>
                    <span className="text-green-600 font-bold text-base ml-1">
                      {(isOnline ? (product.harga_online || 0) : product.harga_jual).toLocaleString('id-ID')}
                    </span>
                  </div>
                </div>
              </button>
              );
              })
            )}
          </div>
        </div>

         {/* Action Buttons - Fixed Footer */}
         <div className="py-2 mb-6 flex-shrink-0">
          <div className="flex justify-between items-center space-x-2">
            <button className="flex-1 bg-white border border-gray-300 rounded px-2 py-2 text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center space-x-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span className="text-xs">Ambil Pesanan</span>
            </button>
            
            <button className="flex-1 bg-white border border-gray-300 rounded px-2 py-2 text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center space-x-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              <span className="text-xs">Kupon</span>
            </button>
            
            <button className="flex-1 bg-white border border-gray-300 rounded px-2 py-2 text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center space-x-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-xs">Aktivitas</span>
            </button>
            
            <button className="flex-1 bg-white border border-gray-300 rounded px-2 py-2 text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center space-x-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
              <span className="text-xs">Menukarkan</span>
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
        product={selectedProduct}
        onAddToCart={addToCart}
      />

      {/* Payment Modal */}
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        cartItems={cartItems}
        onPaymentComplete={handlePaymentComplete}
        transactionType={transactionType}
        isOnline={isOnline}
      />

      {/* Custom Note Modal */}
      <CustomNoteModal
        isOpen={showCustomNoteModal}
        onClose={() => {
          setShowCustomNoteModal(false);
          setSelectedProduct(null);
        }}
        product={selectedProduct}
        onConfirm={handleCustomNoteConfirm}
      />

      {/* Edit Item Modal */}
      <EditItemModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedCartItem(null);
        }}
        cartItem={selectedCartItem}
        onUpdate={handleUpdateItem}
      />
    </div>
  );
}
