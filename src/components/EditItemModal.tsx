'use client';

import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface Product {
  id: number;
  business_id: number;
  menu_code: string;
  nama: string;
  kategori: string;
  harga_jual: number;
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

interface EditItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItem: CartItem | null;
  effectivePrice?: number; // Platform-specific price
  onUpdate: (updatedItem: CartItem) => void;
}

export default function EditItemModal({ isOpen, onClose, cartItem, effectivePrice, onUpdate }: EditItemModalProps) {
  const [quantity, setQuantity] = useState(1);
  const [customNote, setCustomNote] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initialize form when modal opens
  useEffect(() => {
    if (cartItem) {
      setQuantity(cartItem.quantity);
      setCustomNote(cartItem.customNote || '');
    }
  }, [cartItem]);

  const handleConfirm = () => {
    if (cartItem) {
      const updatedItem = {
        ...cartItem,
        quantity,
        customNote: customNote.trim() || undefined
      };
      onUpdate(updatedItem);
      onClose();
    }
  };

  const handleClose = () => {
    // Reset form
    setQuantity(1);
    setCustomNote('');
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only close if clicking the backdrop itself, not child elements
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!isOpen || !cartItem) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div 
        className="bg-white rounded-2xl w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="text-xl font-bold text-gray-900">Edit Item</h2>
          <button
            onClick={handleClose}
            className="w-10 h-10 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
          >
            <X size={20} className="text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-6">
          {/* Product Info */}
          <div className="bg-gray-50 rounded-xl p-4 mb-4">
            <h3 className="font-semibold text-gray-800 mb-2">{cartItem.product.nama}</h3>
            <p className="text-2xl font-bold text-green-600">Rp {(effectivePrice !== undefined ? effectivePrice : cartItem.product.harga_jual).toLocaleString('id-ID')}</p>
          </div>

          {/* Quantity Section */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Quantity
            </label>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center transition-colors"
              >
                -
              </button>
              <span className="text-2xl font-semibold text-gray-800 w-12 text-center">{quantity}</span>
              <button
                onClick={() => setQuantity(quantity + 1)}
                className="w-10 h-10 bg-green-500 hover:bg-green-600 text-white rounded-full flex items-center justify-center transition-colors"
              >
                +
              </button>
            </div>
          </div>

          {/* Custom Note Section */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Custom Note (Optional)
            </label>
            <textarea
              ref={textareaRef}
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              className="w-full p-3 border-2 border-gray-300 rounded-lg text-gray-800 bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-200 resize-none cursor-text"
              placeholder="Add any special instructions or notes for this item..."
              rows={3}
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              tabIndex={1}
            />
            <p className="text-xs text-gray-500 mt-1">
              {customNote.length}/200 characters
            </p>
          </div>

          {/* Customizations Display (Read-only) */}
          {cartItem.customizations && cartItem.customizations.length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Customizations
              </label>
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                {cartItem.customizations.map((customization) => (
                  <div key={customization.customization_id} className="text-sm">
                    <span className="font-medium text-gray-700">{customization.customization_name}:</span>
                    <div className="ml-2 space-y-1">
                      {customization.selected_options.map((option) => (
                        <div key={option.option_id} className="flex items-center justify-between">
                          <span className="text-gray-600">• {option.option_name}</span>
                          {option.price_adjustment !== 0 && (
                            <span className={`text-xs ${
                              option.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {option.price_adjustment > 0 ? '+' : ''}Rp {Math.abs(option.price_adjustment).toLocaleString('id-ID')}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Customizations cannot be edited. To change customizations, remove this item and add a new one.
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="flex-1 py-3 px-4 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 py-3 px-4 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
            >
              Update Item
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
