'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Minus } from 'lucide-react';

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
  onAddToCart: (product: Product, customizations: SelectedCustomization[], quantity: number, customNote?: string) => void;
}

export default function ProductCustomizationModal({
  isOpen,
  onClose,
  product,
  onAddToCart
}: ProductCustomizationModalProps) {
  const [customizations, setCustomizations] = useState<Customization[]>([]);
  const [selectedCustomizations, setSelectedCustomizations] = useState<SelectedCustomization[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [customNote, setCustomNote] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && product) {
      fetchCustomizations();
    }
  }, [isOpen, product]);

  const fetchCustomizations = async () => {
    if (!product) return;
    
    try {
      setLoading(true);
      const response = await fetch(`/api/products/${product.id}/customizations`);
      if (response.ok) {
        const data = await response.json();
        setCustomizations(data.customizations || []);
        
        // Initialize selected customizations
        const initialSelections = data.customizations.map((customization: Customization) => ({
          customization_id: customization.id,
          customization_name: customization.name,
          selected_options: []
        }));
        setSelectedCustomizations(initialSelections);
      }
    } catch (error) {
      console.error('Error fetching customizations:', error);
    } finally {
      setLoading(false);
    }
  };

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
    
    let basePrice = Number(product.harga_jual) || 0;
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
    console.log('Price calculation:', { 
      basePrice, 
      customizationPrice, 
      quantity, 
      total,
      productPrice: product.harga_jual,
      productPriceType: typeof product.harga_jual
    });
    return isNaN(total) ? 0 : total;
  };

  const handleAddToCart = () => {
    if (!product) return;
    
    // Filter out customizations with no selections
    const validCustomizations = selectedCustomizations.filter(
      selection => selection.selected_options.length > 0
    );
    
    onAddToCart(product, validCustomizations, quantity, customNote);
    onClose();
  };

  const formatPrice = (price: number) => {
    return `Rp ${price.toLocaleString('id-ID')}`;
  };

  if (!isOpen || !product) return null;

  return (
    <div className="fixed inset-0 bg-blue-200/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="text-xl font-bold text-gray-900">
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
        <div className="px-6 pb-4">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading customizations...</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Customizations */}
              {customizations.map((customization) => (
                <div key={customization.id} className="space-y-3">
                  <h3 className="font-semibold text-gray-800 text-base">
                    {customization.name}
                  </h3>
                  
                  {/* Single selection - horizontal buttons */}
                  {customization.selection_mode === 'single' && (
                    <div className="flex gap-3">
                      {customization.options.map((option) => (
                        <button
                          key={option.id}
                          onClick={() => handleOptionToggle(customization.id, option)}
                          className={`px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 border-2 ${
                            isOptionSelected(customization.id, option.id)
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
                    <div className="grid grid-cols-2 gap-3">
                      {customization.options.map((option) => (
                        <button
                          key={option.id}
                          onClick={() => handleOptionToggle(customization.id, option)}
                          className={`px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 border-2 ${
                            isOptionSelected(customization.id, option.id)
                              ? 'bg-teal-100 border-teal-400 text-teal-800 shadow-sm'
                              : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100 hover:border-gray-300'
                          }`}
                        >
                          <div className="text-center">
                            <div className="font-medium">
                              {option.price_adjustment > 0 ? '+' : ''}{option.name}
                            </div>
                            {option.price_adjustment !== 0 && (
                              <div className="text-xs mt-1 font-normal">
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

              {/* Custom Note Section */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Custom Note (Optional)
                </label>
                <textarea
                  value={customNote}
                  onChange={(e) => setCustomNote(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg text-gray-800 bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none cursor-text"
                  placeholder="Add any special instructions or notes for this item..."
                  rows={2}
                  maxLength={200}
                  autoComplete="off"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {customNote.length}/200 characters
                </p>
              </div>

              {/* Quantity and Total */}
              <div className="flex items-center justify-between pt-6 border-t border-gray-100">
                <div className="flex items-center space-x-4">
                  <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="w-10 h-10 bg-gray-200 hover:bg-gray-300 rounded-full flex items-center justify-center transition-colors"
                  >
                    <Minus size={18} className="text-gray-700" />
                  </button>
                  <span className="text-xl font-bold w-8 text-center text-black">{quantity}</span>
                  <button
                    onClick={() => setQuantity(quantity + 1)}
                    className="w-10 h-10 bg-teal-100 hover:bg-teal-200 text-teal-700 rounded-full flex items-center justify-center transition-colors"
                  >
                    <Plus size={18} />
                  </button>
                </div>
                
                <div className="text-right">
                  <span className="text-xl font-bold text-gray-900">
                    {formatPrice(calculateTotalPrice())}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 pt-4">
          <button
            onClick={onClose}
            className="px-6 py-3 text-gray-600 hover:text-gray-800 transition-colors font-medium"
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
  );
}
