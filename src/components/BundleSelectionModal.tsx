'use client';

import { useState, useEffect } from 'react';
import { X, Check, Plus, Minus } from 'lucide-react';
import { offlineSyncService } from '@/lib/offlineSync';

interface Product {
  id: number;
  nama: string;
  image_url: string | null;
  category2_id: number | null;
  category2_name: string | null;
}

interface BundleItem {
  id: number;
  bundle_product_id: number;
  category2_id: number;
  category2_name?: string;
  required_quantity: number;
  display_order: number;
}

interface SelectedProductWithQuantity {
  product: Product;
  quantity: number;
}

interface BundleSelection {
  category2_id: number;
  category2_name: string;
  selectedProducts: SelectedProductWithQuantity[];
  requiredQuantity: number;
}

interface BundleSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selections: BundleSelection[]) => void;
  bundleProduct: {
    id: number;
    nama: string;
    harga_jual: number;
  };
  bundleItems: BundleItem[];
}

export default function BundleSelectionModal({
  isOpen,
  onClose,
  onConfirm,
  bundleProduct,
  bundleItems
}: BundleSelectionModalProps) {
  const [selections, setSelections] = useState<BundleSelection[]>([]);
  const [categoryProducts, setCategoryProducts] = useState<{ [key: number]: Product[] }>({});
  const [loading, setLoading] = useState(false);

  // Initialize selections from bundleItems
  useEffect(() => {
    if (isOpen && bundleItems.length > 0) {
      const initialSelections: BundleSelection[] = bundleItems.map(item => ({
        category2_id: item.category2_id,
        category2_name: item.category2_name || '',
        selectedProducts: [], // Array of { product, quantity }
        requiredQuantity: item.required_quantity
      }));
      setSelections(initialSelections);
    }
  }, [isOpen, bundleItems]);

  // Fetch products for each category
  useEffect(() => {
    if (isOpen && bundleItems.length > 0) {
      const fetchProducts = async () => {
        setLoading(true);
        try {
          const productsByCategory: { [key: number]: Product[] } = {};
          
          for (const item of bundleItems) {
            try {
              const products = await offlineSyncService.fetchWithFallback(
                // Online fetch
                async () => {
                  // Use category2_name from bundle item
                  const categoryName = item.category2_name || '';
                  
                  if (!categoryName) {
                    throw new Error('Category name not found');
                  }
                  
                  const response = await fetch(`/api/products?category2_name=${encodeURIComponent(categoryName)}`, {
                    signal: AbortSignal.timeout(5000)
                  });
                  if (!response.ok) throw new Error('Failed to fetch');
                  const data = await response.json();
                  return data.products || [];
                },
                // Offline fetch
                async () => {
                  if (typeof window !== 'undefined' && (window as any).electronAPI) {
                    // Get all products and filter by category2_id
                    const allProducts = await (window as any).electronAPI.localDbGetAllProducts();
                    return allProducts.filter((p: any) => p.category2_id === item.category2_id);
                  }
                  return [];
                }
              );
              
              // Filter out bundle products and the bundle product itself
              const filteredProducts = products
                .filter((p: any) => {
                  // Exclude bundle products
                  const isBundle = p.is_bundle === 1 || p.is_bundle === true;
                  // Exclude the bundle product itself
                  const isBundleProduct = p.id === bundleProduct.id;
                  return !isBundle && !isBundleProduct;
                })
                .map((p: any) => ({
                  id: p.id,
                  nama: p.nama,
                  image_url: p.image_url,
                  category2_id: p.category2_id,
                  category2_name: p.category2_name
                }));
              
              productsByCategory[item.category2_id] = filteredProducts;
            } catch (error) {
              console.error(`Error fetching products for category ${item.category2_id}:`, error);
              productsByCategory[item.category2_id] = [];
            }
          }
          
          setCategoryProducts(productsByCategory);
        } catch (error) {
          console.error('Error fetching category products:', error);
        } finally {
          setLoading(false);
        }
      };
      
      fetchProducts();
    }
  }, [isOpen, bundleItems]);

  const getTotalQuantity = (category2Id: number): number => {
    const categorySelection = selections.find(s => s.category2_id === category2Id);
    if (!categorySelection) return 0;
    return categorySelection.selectedProducts.reduce((sum, sp) => sum + sp.quantity, 0);
  };

  const getProductQuantity = (category2Id: number, productId: number): number => {
    const categorySelection = selections.find(s => s.category2_id === category2Id);
    if (!categorySelection) return 0;
    const selectedProduct = categorySelection.selectedProducts.find(sp => sp.product.id === productId);
    return selectedProduct?.quantity || 0;
  };

  const updateProductQuantity = (category2Id: number, product: Product, delta: number) => {
    setSelections(prev => {
      const categorySelection = prev.find(s => s.category2_id === category2Id);
      if (!categorySelection) return prev;

      // Calculate current totals from prev state
      const currentTotalQuantity = categorySelection.selectedProducts.reduce((sum, sp) => sum + sp.quantity, 0);
      const existingProduct = categorySelection.selectedProducts.find(sp => sp.product.id === product.id);
      const currentQuantity = existingProduct?.quantity || 0;
      const newQuantity = currentQuantity + delta;

      // Check if we can add more
      if (delta > 0 && currentTotalQuantity >= categorySelection.requiredQuantity) {
        return prev; // Can't add more, limit reached
      }

      // Can't go below 0
      if (newQuantity < 0) {
        return prev;
      }

      return prev.map(s => {
        if (s.category2_id !== category2Id) return s;

        const existingIndex = s.selectedProducts.findIndex(sp => sp.product.id === product.id);

        if (newQuantity === 0) {
          // Remove product if quantity becomes 0
          return {
            ...s,
            selectedProducts: s.selectedProducts.filter(sp => sp.product.id !== product.id)
          };
        } else if (existingIndex >= 0) {
          // Update existing quantity
          const updated = [...s.selectedProducts];
          updated[existingIndex] = { ...updated[existingIndex], quantity: newQuantity };
          return {
            ...s,
            selectedProducts: updated
          };
        } else {
          // Add new product with quantity 1
          return {
            ...s,
            selectedProducts: [...s.selectedProducts, { product, quantity: 1 }]
          };
        }
      });
    });
  };

  const isSelectionComplete = (): boolean => {
    return selections.every(s => {
      const totalQuantity = getTotalQuantity(s.category2_id);
      return totalQuantity === s.requiredQuantity;
    });
  };

  const handleConfirm = () => {
    if (isSelectionComplete()) {
      onConfirm(selections);
      onClose();
    }
  };

  if (!isOpen) return null;

  // Sort bundleItems by display_order
  const sortedBundleItems = [...bundleItems].sort((a, b) => a.display_order - b.display_order);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{bundleProduct.nama}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                <p className="text-gray-600">Memuat produk...</p>
              </div>
            </div>
          ) : (
            sortedBundleItems.map((item, index) => {
              const categorySelection = selections.find(s => s.category2_id === item.category2_id);
              const products = categoryProducts[item.category2_id] || [];
              const totalQuantity = getTotalQuantity(item.category2_id);
              const isComplete = totalQuantity === item.required_quantity;

              return (
                <div key={item.id} className="bg-gray-50 rounded-xl p-4">
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-gray-800 inline-flex items-center gap-2">
                      <span>{item.category2_name || `Kategori ${index + 1}`}</span>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                        isComplete 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {totalQuantity} / {item.required_quantity}
                      </span>
                    </h3>
                  </div>

                  {products.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <p>Tidak ada produk tersedia di kategori ini</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      {products.map((product) => {
                        const currentQuantity = getProductQuantity(item.category2_id, product.id);
                        const totalQuantity = getTotalQuantity(item.category2_id);
                        const canAddMore = totalQuantity < item.required_quantity;
                        const hasQuantity = currentQuantity > 0;

                        return (
                          <div
                            key={product.id}
                            className={`relative bg-white rounded-lg border-2 p-3 transition-all ${
                              hasQuantity
                                ? 'border-green-500 bg-green-50 shadow-md'
                                : canAddMore
                                ? 'border-gray-200 hover:border-blue-300'
                                : 'border-gray-100 bg-gray-50 opacity-50'
                            }`}
                          >
                            {hasQuantity && (
                              <div className="absolute top-2 right-2 bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
                                {currentQuantity}
                              </div>
                            )}
                            
                            <div className="w-full h-24 bg-gray-50 rounded-lg mb-2 flex items-center justify-center overflow-hidden">
                              {product.image_url ? (
                                <img
                                  src={product.image_url}
                                  alt={product.nama}
                                  className="h-full w-auto object-contain"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = 'none';
                                  }}
                                />
                              ) : (
                                <span className="text-gray-400 text-xl">📦</span>
                              )}
                            </div>
                            
                            <h4 className="font-medium text-gray-800 text-sm leading-tight mb-2">
                              {product.nama}
                            </h4>

                            {/* Quantity Controls */}
                            <div className="flex items-center w-full">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateProductQuantity(item.category2_id, product, -1);
                                }}
                                disabled={!hasQuantity}
                                className={`flex-1 py-2 rounded-l flex items-center justify-center transition-colors ${
                                  hasQuantity
                                    ? 'bg-red-500 hover:bg-red-600 text-white'
                                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                }`}
                              >
                                <Minus className="w-4 h-4" />
                              </button>
                              
                              <span className="text-sm font-semibold text-gray-700 min-w-[40px] text-center py-2 bg-gray-50">
                                {currentQuantity}
                              </span>
                              
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateProductQuantity(item.category2_id, product, 1);
                                }}
                                disabled={!canAddMore}
                                className={`flex-1 py-2 rounded-r flex items-center justify-center transition-colors ${
                                  canAddMore
                                    ? 'bg-blue-500 hover:bg-blue-600 text-white'
                                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                }`}
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 bg-white rounded-b-2xl flex-shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors"
          >
            Batal
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isSelectionComplete()}
            className={`px-6 py-3 rounded-xl font-medium transition-colors flex items-center space-x-2 ${
              isSelectionComplete()
                ? 'bg-green-500 hover:bg-green-600 text-white'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            <Check className="w-4 h-4" />
            <span>Konfirmasi</span>
          </button>
        </div>
      </div>
    </div>
  );
}

