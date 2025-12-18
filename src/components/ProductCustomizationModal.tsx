'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Plus, Minus } from 'lucide-react';
import { offlineSyncService } from '@/lib/offlineSync';
import { getApiUrl } from '@/lib/api';

interface Product {
  id: number;
  business_id: number;
  menu_code: string;
  nama: string;
  kategori: string;
  harga_jual: number;
  status: string;
}

interface CustomizationOption {
  id: number;
  customization_type_id: number;
  name: string;
  price_adjustment: number;
}

interface Customization {
  id: number;
  name: string;
  selection_mode: 'single' | 'multiple';
  options: CustomizationOption[];
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

interface ProductCustomizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  effectivePrice?: number; // Platform-specific price
  onAddToCart: (product: Product, customizations: SelectedCustomization[], quantity: number, customNote?: string) => void;
}

export default function ProductCustomizationModal({
  isOpen,
  onClose,
  product,
  effectivePrice,
  onAddToCart
}: ProductCustomizationModalProps) {
  const [customizations, setCustomizations] = useState<Customization[]>([]);
  const [selectedCustomizations, setSelectedCustomizations] = useState<SelectedCustomization[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [customNote, setCustomNote] = useState('');
  const [loading, setLoading] = useState(false);
  const customNoteRef = useRef<HTMLTextAreaElement>(null);

  const fetchCustomizations = useCallback(async () => {
    if (!product) return;

    try {
      setLoading(true);

      // Always try offline first for UI responsiveness
      let fetchedCustomizations: Customization[] = [];
      let foundLocally = false;

      const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (electronAPI?.localDbGetProductCustomizations) {
        try {
          // console.log('💾 Attempting offline fetch first...');
          const localCustomizations = await electronAPI.localDbGetProductCustomizations(product.id);
          // console.log('💾 Retrieved customizations:', Array.isArray(localCustomizations) ? localCustomizations.length : 0);
          if (Array.isArray(localCustomizations) && localCustomizations.length > 0) {
            fetchedCustomizations = localCustomizations as Customization[];
            foundLocally = true;
          }
        } catch (e) {
          console.warn('Local fetch failed:', e);
        }
      }

      // If not found locally and we are online, try fetching
      if (!foundLocally && offlineSyncService.getStatus().isOnline) {
        try {
          console.log('🌐 Local empty, attempting online fetch...');
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);

          const response = await fetch(getApiUrl(`/api/products/${product.id}/customizations`), {
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const data = await response.json();
            fetchedCustomizations = data.customizations || [];
          }
        } catch (error) {
          console.log('🌐 Online fetch error:', error);
        }
      }

      setCustomizations(fetchedCustomizations);

      const initialSelections = fetchedCustomizations.map((customization: Customization) => ({
        customization_id: customization.id,
        customization_name: customization.name,
        selected_options: []
      }));
      setSelectedCustomizations(initialSelections);

    } catch (error) {
      console.error('Error fetching customizations:', error);
    } finally {
      setLoading(false);
    }
  }, [product]);

  useEffect(() => {
    if (isOpen && product) {
      fetchCustomizations();
      setQuantity(1);
      setCustomNote('');
    }
  }, [fetchCustomizations, isOpen, product]);

  const handleOptionToggle = (customizationId: number, option: CustomizationOption) => {
    setSelectedCustomizations(prev => {
      return prev.map(selection => {
        if (selection.customization_id === customizationId) {
          const customization = customizations.find(c => c.id === customizationId);
          if (customization?.selection_mode === 'single') {
            // Single selection - replace current selection
            return {
              ...selection,
              selected_options: [{
                option_id: option.id,
                option_name: option.name,
                price_adjustment: option.price_adjustment
              }]
            };
          } else {
            // Multiple selection - toggle option
            const existingIndex = selection.selected_options.findIndex(
              opt => opt.option_id === option.id
            );

            if (existingIndex >= 0) {
              // Remove option
              return {
                ...selection,
                selected_options: selection.selected_options.filter(
                  opt => opt.option_id !== option.id
                )
              };
            } else {
              // Add option
              return {
                ...selection,
                selected_options: [...selection.selected_options, {
                  option_id: option.id,
                  option_name: option.name,
                  price_adjustment: option.price_adjustment
                }]
              };
            }
          }
        }
        return selection;
      });
    });
  };

  const isOptionSelected = (customizationId: number, optionId: number) => {
    const selection = selectedCustomizations.find(s => s.customization_id === customizationId);
    return selection?.selected_options.some(opt => opt.option_id === optionId) || false;
  };

  const calculateTotalPrice = () => {
    if (!product) return 0;

    const basePrice = effectivePrice !== undefined ? Number(effectivePrice) : Number(product.harga_jual);
    let customizationPrice = 0;

    selectedCustomizations.forEach(selection => {
      selection.selected_options.forEach(option => {
        const adjustment = Number(option.price_adjustment);
        if (!isNaN(adjustment)) {
          customizationPrice += adjustment;
        }
      });
    });

    const total = (basePrice + customizationPrice) * quantity;
    /* console.log('Price calculation:', { 
      basePrice, 
      customizationPrice, 
      quantity, 
      total,
      productPrice: product.harga_jual,
      productPriceType: typeof product.harga_jual
    }); */
    return isNaN(total) ? 0 : total;
  };

  const handleAddToCart = () => {
    if (!product) return;

    // Filter out customizations with no selections
    const validCustomizations = selectedCustomizations.filter(
      selection => selection.selected_options.length > 0
    );

    onAddToCart(product, validCustomizations, quantity, customNote);

    // Reset quantity and customNote after adding to cart
    setQuantity(1);
    setCustomNote('');

    onClose();
  };

  const formatPrice = (price: number) => {
    return `Rp ${price.toLocaleString('id-ID')}`;
  };

  if (!isOpen || !product) return null;

  return (
    <div
      className="fixed inset-0 bg-blue-200/30 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => {
        // Don't let backdrop steal focus from textarea
        if (e.target === e.currentTarget) {
          e.preventDefault();
        }
      }}
      onClick={(e) => {
        // Don't let backdrop clicks affect the textarea
        if (e.target === e.currentTarget) {
          e.preventDefault();
        }
      }}
    >
      <div
        className="bg-white rounded-2xl max-w-4xl w-full max-h-[85vh] overflow-y-auto shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 pb-3">
          <h2 className="text-lg font-bold text-gray-900">
            {product.nama}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 bg-blue-100 hover:bg-blue-200 rounded-full flex items-center justify-center transition-colors"
          >
            <X size={18} className="text-blue-600" />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 pb-3">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading customizations...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Customizations */}
              {customizations.map((customization) => (
                <div key={customization.id} className="space-y-2">
                  <h3 className="font-semibold text-gray-800 text-sm">
                    {customization.name}
                  </h3>

                  {/* Single selection - horizontal buttons */}
                  {customization.selection_mode === 'single' && (
                    <div className="flex gap-2">
                      {customization.options.map((option) => (
                        <button
                          key={option.id}
                          onClick={() => handleOptionToggle(customization.id, option)}
                          className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 border-2 ${isOptionSelected(customization.id, option.id)
                              ? 'bg-teal-100 border-teal-400 text-teal-800 shadow-sm'
                              : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100 hover:border-gray-300'
                            }`}
                        >
                          {option.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Multiple selection - grid layout */}
                  {customization.selection_mode === 'multiple' && (
                    <div className="grid grid-cols-3 gap-2">
                      {customization.options.map((option) => (
                        <button
                          key={option.id}
                          onClick={() => handleOptionToggle(customization.id, option)}
                          className={`px-2 py-2 rounded-lg text-xs font-medium transition-all duration-200 border-2 ${isOptionSelected(customization.id, option.id)
                              ? 'bg-teal-100 border-teal-400 text-teal-800 shadow-sm'
                              : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100 hover:border-gray-300'
                            }`}
                        >
                          <div className="text-center">
                            <div className="font-medium">
                              {option.price_adjustment > 0 ? '+' : ''}{option.name}
                            </div>
                            {option.price_adjustment !== 0 && (
                              <div className="text-xs mt-0.5 font-normal">
                                {formatPrice(Number(option.price_adjustment) || 0)}
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

            </div>
          )}
        </div>

        {/* Custom Note Section */}
        <div className="px-4 pb-3 relative z-10">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Custom Note (Optional)
          </label>
          <textarea
            ref={customNoteRef}
            id="custom-note-textarea"
            value={customNote}
            onChange={(e) => setCustomNote(e.target.value)}
            className="w-full p-2 border-2 border-gray-300 rounded-lg text-sm text-gray-800 bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-200 resize-none cursor-text focus:outline-none"
            placeholder="Add any special instructions or notes for this item..."
            rows={2}
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            tabIndex={1}
          />
          <p className="text-xs text-gray-500 mt-0.5">
            {customNote.length}/200 characters
          </p>
        </div>

        {/* Footer - All in one line */}
        <div className="flex items-center justify-between gap-4 px-4 pb-4 pt-3 border-t border-gray-100">
          {/* Quantity controls */}
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              className="w-8 h-8 bg-gray-200 hover:bg-gray-300 rounded-full flex items-center justify-center transition-colors"
            >
              <Minus size={16} className="text-gray-700" />
            </button>
            <span className="text-lg font-bold w-6 text-center text-black">{quantity}</span>
            <button
              onClick={() => setQuantity(quantity + 1)}
              className="w-8 h-8 bg-teal-100 hover:bg-teal-200 text-teal-700 rounded-full flex items-center justify-center transition-colors"
            >
              <Plus size={16} />
            </button>
          </div>

          {/* Total Price */}
          <div className="text-right flex-1">
            <span className="text-lg font-bold text-gray-900">
              {formatPrice(calculateTotalPrice())}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-6 py-3 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-xl transition-colors font-medium"
            >
              Batal
            </button>
            <button
              onClick={handleAddToCart}
              disabled={loading}
              className="px-6 py-3 bg-teal-500 hover:bg-teal-600 text-white rounded-xl transition-colors disabled:bg-gray-400 font-medium"
            >
              Konfirmasi
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
