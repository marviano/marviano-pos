'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { X, Check, Plus, Minus, SlidersHorizontal, MessageCircle } from 'lucide-react';
import BundleProductCustomizationModal, { SelectedCustomization } from './BundleProductCustomizationModal';
import CustomNoteModal from './CustomNoteModal';
// import { getApiUrl } from '@/lib/api';

interface Product {
  id: number;
  nama: string;
  image_url: string | null;
  category2_id: number | null;
  category2_name: string | null;
  has_customization?: number | boolean;
}

type RawProduct = Product & {
  is_bundle?: number | boolean;
};

const isRawProduct = (value: unknown): value is RawProduct => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<RawProduct>;
  return typeof candidate.id === 'number' && typeof candidate.nama === 'string';
};

interface BundleItem {
  id: number;
  bundle_product_id: number;
  category2_id: number;
  category2_name?: string;
  required_quantity: number;
  display_order: number;
}

interface SelectedBundleProduct {
  key: string;
  product: Product;
  customizations?: SelectedCustomization[];
  customNote?: string;
}

interface BundleSelection {
  category2_id: number;
  category2_name: string;
  selectedProducts: SelectedBundleProduct[];
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

const getCategoryEmoji = (categoryName?: string | null) => {
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

function BundleProductImage({
  imageUrl,
  productName,
  categoryName,
}: {
  imageUrl: string | null;
  productName: string;
  categoryName?: string | null;
}) {
  const [hasError, setHasError] = useState(false);

  if (!imageUrl || hasError) {
    return (
      <span className="text-gray-400 text-2xl">
        {getCategoryEmoji(categoryName)}
      </span>
    );
  }

  // Next.js Image doesn't support custom protocols like pos-image://
  // Use regular <img> for pos-image:// URLs, Next.js Image for others
  if (imageUrl.startsWith('pos-image://')) {
    return (
      <img
        src={imageUrl}
        alt={productName}
        className="object-contain w-full h-full"
        onError={() => setHasError(true)}
      />
    );
  }

  return (
    <Image
      src={imageUrl}
      alt={productName}
      fill
      sizes="(max-width: 768px) 33vw, 120px"
      className="object-contain"
      unoptimized
      onError={() => setHasError(true)}
    />
  );
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
  const [customizationTarget, setCustomizationTarget] = useState<{
    category2Id: number;
    product: Product;
    instanceKey: string;
    customizations: SelectedCustomization[];
  } | null>(null);
  const [noteTarget, setNoteTarget] = useState<{
    category2Id: number;
    instanceKey: string;
    note: string;
  } | null>(null);

  // Initialize selections from bundleItems
  useEffect(() => {
    if (isOpen && bundleItems.length > 0) {
      console.log(`🔍 [BUNDLE MODAL] Initializing with ${bundleItems.length} bundle items:`, bundleItems);
      const initialSelections: BundleSelection[] = bundleItems.map(item => {
        console.log(`📦 [BUNDLE MODAL] Processing bundle item:`, {
          category2_id: item.category2_id,
          category2_name: item.category2_name,
          required_quantity: item.required_quantity
        });
        return {
          category2_id: item.category2_id,
          category2_name: item.category2_name || '',
          selectedProducts: [], // Array of { product, quantity }
          requiredQuantity: item.required_quantity
        };
      });
      console.log(`✅ [BUNDLE MODAL] Created ${initialSelections.length} initial selections:`, initialSelections);
      setSelections(initialSelections);
    } else if (isOpen && bundleItems.length === 0) {
      console.warn(`⚠️ [BUNDLE MODAL] Modal opened but bundleItems is empty!`);
    }
  }, [isOpen, bundleItems, bundleProduct.id]);

  // Fetch products for each category
  useEffect(() => {
    if (isOpen && bundleItems.length > 0) {
      const fetchProducts = async () => {
        setLoading(true);
        console.log(`🔄 [BUNDLE MODAL] Starting to fetch products for ${bundleItems.length} categories`);
        try {
          const productsByCategory: { [key: number]: Product[] } = {};
          
          for (const item of bundleItems) {
            try {
              console.log(`🔍 [BUNDLE MODAL] Fetching products for category:`, {
                category2_id: item.category2_id,
                category2_name: item.category2_name
              });
              
              if (!item.category2_name) {
                console.warn(`⚠️ [BUNDLE MODAL] Bundle item has no category2_name, skipping:`, item);
                productsByCategory[item.category2_id] = [];
                continue;
              }
              
              // Use category2_name from bundle item
              const categoryName = item.category2_name || '';
              
              let products: RawProduct[] = [];
              
              if (!categoryName) {
                console.warn(`⚠️ [BUNDLE MODAL] Category name not found`);
              } else {
                console.log(`🔍 [BUNDLE MODAL] Fetching products from MySQL for category: ${categoryName}`);
                try {
                  const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
                  if (electronAPI?.localDbGetProductsByCategory2) {
                    const categoryProducts = await electronAPI.localDbGetProductsByCategory2(categoryName);
                    products = Array.isArray(categoryProducts) ? categoryProducts.filter(isRawProduct) : [];
                    console.log(`✅ [BUNDLE MODAL] Got ${products.length} products from MySQL for ${categoryName}`);
                  } else {
                    console.warn(`⚠️ [BUNDLE MODAL] MySQL query method not available`);
                    products = [];
                  }
                } catch (error) {
                  console.error(`❌ [BUNDLE MODAL] Error fetching products from MySQL:`, error);
                  products = [];
                }
              }
              
              console.log(`📦 [BUNDLE MODAL] Raw products fetched: ${Array.isArray(products) ? products.length : 0}`);
              
              // Filter out bundle products and the bundle product itself
              const filteredProducts = (Array.isArray(products) ? products : [])
                .filter(isRawProduct)
                .filter((p) => {
                  // Exclude bundle products
                  const isBundle = p.is_bundle === 1 || p.is_bundle === true;
                  // Exclude the bundle product itself
                  const isBundleProduct = p.id === bundleProduct.id;
                  const shouldInclude = !isBundle && !isBundleProduct;
                  if (!shouldInclude) {
                    console.log(`🚫 [BUNDLE MODAL] Excluding product ${p.id} (${p.nama}): isBundle=${isBundle}, isBundleProduct=${isBundleProduct}`);
                  }
                  return shouldInclude;
                })
                .map((p) => ({
                  id: p.id,
                  nama: p.nama,
                  image_url: p.image_url,
                  category2_id: p.category2_id,
                  category2_name: p.category2_name,
                  has_customization: p.has_customization
                }));
              
              productsByCategory[item.category2_id] = filteredProducts;
              console.log(`✅ [BUNDLE MODAL] Fetched ${filteredProducts.length} products for category ${item.category2_name} (category2_id: ${item.category2_id})`);
              if (filteredProducts.length > 0) {
                console.log(`📦 [BUNDLE MODAL] First product in category:`, filteredProducts[0]);
              } else {
                console.warn(`⚠️ [BUNDLE MODAL] No products found for category ${item.category2_name} (category2_id: ${item.category2_id})`);
              }
            } catch (error) {
              console.error(`❌ [BUNDLE MODAL] Error fetching products for category ${item.category2_id}:`, error);
              productsByCategory[item.category2_id] = [];
            }
          }
          
          console.log(`✅ [BUNDLE MODAL] Finished fetching products. Total categories with products:`, Object.keys(productsByCategory).length);
          console.log(`📊 [BUNDLE MODAL] Products by category:`, Object.entries(productsByCategory).map(([catId, prods]) => ({
            category2_id: catId,
            productCount: Array.isArray(prods) ? prods.length : 0
          })));
          setCategoryProducts(productsByCategory);
        } catch (error) {
          console.error('❌ [BUNDLE MODAL] Error fetching category products:', error);
        } finally {
          setLoading(false);
        }
      };
      
      fetchProducts();
    }
  }, [isOpen, bundleItems, bundleProduct.id]);

  const getTotalQuantity = (category2Id: number): number => {
    const categorySelection = selections.find(s => s.category2_id === category2Id);
    if (!categorySelection) return 0;
    return categorySelection.selectedProducts.length;
  };

  const getProductQuantity = (category2Id: number, productId: number): number => {
    const categorySelection = selections.find(s => s.category2_id === category2Id);
    if (!categorySelection) return 0;
    return categorySelection.selectedProducts.filter(sp => sp.product.id === productId).length;
  };

  const addProductInstance = (category2Id: number, product: Product) => {
    setSelections(prev => {
      const categorySelection = prev.find(s => s.category2_id === category2Id);
      if (!categorySelection) return prev;

      if (categorySelection.selectedProducts.length >= categorySelection.requiredQuantity) {
        return prev;
      }

      const instanceKey = `${category2Id}-${product.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      return prev.map(selection => {
        if (selection.category2_id !== category2Id) return selection;
        return {
          ...selection,
          selectedProducts: [
            ...selection.selectedProducts,
            { key: instanceKey, product }
          ]
        };
      });
    });
  };

  const removeProductInstance = (category2Id: number, instanceKey: string) => {
    setSelections(prev =>
      prev.map(selection =>
        selection.category2_id === category2Id
          ? {
              ...selection,
              selectedProducts: selection.selectedProducts.filter(sp => sp.key !== instanceKey)
            }
          : selection
      )
    );
  };

  const openCustomizationModal = (category2Id: number, product: Product, instanceKey: string) => {
    const categorySelection = selections.find((s) => s.category2_id === category2Id);
    const existingProduct = categorySelection?.selectedProducts.find((sp) => sp.key === instanceKey);

    setCustomizationTarget({
      category2Id,
      product,
      instanceKey,
      customizations: existingProduct?.customizations || []
    });
  };

  const handleCustomizationSave = (customizations: SelectedCustomization[]) => {
    if (!customizationTarget) return;
    setSelections((prev) =>
      prev.map((selection) => {
        if (selection.category2_id !== customizationTarget.category2Id) return selection;
        return {
          ...selection,
          selectedProducts: selection.selectedProducts.map((sp) =>
            sp.key === customizationTarget.instanceKey
              ? {
                  ...sp,
                  customizations: customizations.length > 0 ? customizations : undefined
                }
              : sp
          )
        };
      })
    );
    setCustomizationTarget(null);
  };

  const closeCustomizationModal = () => {
    setCustomizationTarget(null);
  };

  const openNoteModal = (category2Id: number, instanceKey: string, note?: string) => {
    setNoteTarget({
      category2Id,
      instanceKey,
      note: note || ''
    });
  };

  const handleNoteSave = (note: string) => {
    if (!noteTarget) return;
    setSelections(prev =>
      prev.map(selection =>
        selection.category2_id === noteTarget.category2Id
          ? {
              ...selection,
              selectedProducts: selection.selectedProducts.map(sp =>
                sp.key === noteTarget.instanceKey
                  ? {
                      ...sp,
                      customNote: note.trim() ? note.trim() : undefined
                    }
                  : sp
              )
            }
          : selection
      )
    );
    setNoteTarget(null);
  };

  const formatPrice = (price: number) => {
    return `Rp ${Number(price).toLocaleString('id-ID')}`;
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
                        const totalQuantityForCategory = getTotalQuantity(item.category2_id);
                        const canAddMore = totalQuantityForCategory < item.required_quantity;
                        const hasQuantity = currentQuantity > 0;
                        const categorySelection = selections.find(s => s.category2_id === item.category2_id);
                        const selectedInstances = categorySelection?.selectedProducts.filter(sp => sp.product.id === product.id) || [];
                        const hasCustomizationFlag = product.has_customization === 1 || product.has_customization === true;
                        const hasExistingCustomizations = selectedInstances.some(
                          sp =>
                            (sp.customizations && sp.customizations.length > 0) ||
                            (sp.customNote && sp.customNote.trim() !== '')
                        );
                        const canCustomize = hasCustomizationFlag || product.has_customization === undefined || product.has_customization === null || hasExistingCustomizations;

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
                            {hasQuantity && selectedInstances.some(sp => (sp.customizations && sp.customizations.length > 0) || (sp.customNote && sp.customNote.trim() !== '')) && (
                              <div className="absolute top-2 left-2 bg-purple-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-sm">
                                Custom
                              </div>
                            )}

                            {hasQuantity && (
                              <div className="absolute top-2 right-2 bg-green-500 text-white rounded-full px-2 py-0.5 flex items-center justify-center text-[10px] font-bold">
                                x{currentQuantity}
                              </div>
                            )}
                            
                            <div className="relative w-full h-24 bg-gray-50 rounded-lg mb-2 flex items-center justify-center overflow-hidden">
                              <BundleProductImage
                                imageUrl={product.image_url}
                                productName={product.nama}
                                categoryName={product.category2_name}
                              />
                            </div>
                            
                            <h4 className="font-medium text-gray-800 text-sm leading-tight mb-2">
                              {product.nama}
                            </h4>

                            {/* Quantity Controls */}
                            <div className="flex items-center w-full">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (selectedInstances.length > 0) {
                                    const targetKey = selectedInstances[selectedInstances.length - 1].key;
                                    removeProductInstance(item.category2_id, targetKey);
                                  }
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
                                  addProductInstance(item.category2_id, product);
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

                            {selectedInstances.length > 0 && (
                              <div className="mt-3 space-y-2">
                                {selectedInstances.map(sp => (
                                  <div key={sp.key} className="border border-gray-200 rounded-lg p-2 space-y-2 bg-white shadow-sm">
                                    <div className="flex items-center justify-between text-xs text-gray-600">
                                      <span>Instance</span>
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openNoteModal(item.category2_id, sp.key, sp.customNote);
                                          }}
                                          className="flex items-center gap-1 px-2 py-1 rounded border border-blue-200 text-blue-600 hover:bg-blue-50 transition text-[11px] font-semibold"
                                        >
                                          <MessageCircle className="w-3 h-3" />
                                          {sp.customNote ? 'Edit Note' : 'Add Note'}
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            removeProductInstance(item.category2_id, sp.key);
                                          }}
                                          className="text-red-500 hover:text-red-600 text-xs font-semibold"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    </div>

                                    {canCustomize && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openCustomizationModal(item.category2_id, product, sp.key);
                                        }}
                                        className="w-full flex items-center justify-center gap-2 rounded-lg border border-purple-200 bg-purple-50 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-100"
                                      >
                                        <SlidersHorizontal className="w-4 h-4" />
                                        {sp.customizations && sp.customizations.length > 0 ? 'Edit Customization' : 'Set Customization'}
                                      </button>
                                    )}

                                    {sp.customizations && sp.customizations.length > 0 && (
                                      <div className="text-[11px] text-gray-600 space-y-1">
                                        {sp.customizations.map(customization => (
                                          <div key={customization.customization_id}>
                                            <div className="font-semibold text-gray-700">{customization.customization_name}</div>
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
                                      <div className="text-[11px] text-gray-600">
                                        <span className="font-semibold text-gray-700">Note:</span> {sp.customNote}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
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

      <BundleProductCustomizationModal
        isOpen={!!customizationTarget}
        product={customizationTarget?.product || null}
        initialCustomizations={customizationTarget?.customizations}
        onClose={closeCustomizationModal}
        onSave={handleCustomizationSave}
      />

      <CustomNoteModal
        isOpen={!!noteTarget}
        onClose={() => setNoteTarget(null)}
        onConfirm={handleNoteSave}
        product={noteTarget ? (selections.flatMap(sel => sel.selectedProducts).find(sp => sp.key === noteTarget.instanceKey)?.product as unknown as { id: number; business_id: number; menu_code: string; nama: string; kategori: string; harga_jual: number; status: string } | null) || null : null}
      />
    </div>
  );
}

