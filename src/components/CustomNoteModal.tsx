'use client';

import { useState } from 'react';
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

interface CustomNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  onConfirm: (note: string) => void;
}

export default function CustomNoteModal({ isOpen, onClose, product, onConfirm }: CustomNoteModalProps) {
  const [customNote, setCustomNote] = useState('');

  const handleConfirm = () => {
    onConfirm(customNote);
    setCustomNote('');
    onClose();
  };

  const handleClose = () => {
    setCustomNote('');
    onClose();
  };

  if (!isOpen || !product) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={handleClose}
    >
      <div 
        className="bg-white rounded-2xl w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="text-xl font-bold text-gray-900">Add to Cart</h2>
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
            <h3 className="font-semibold text-gray-800 mb-2">{product.nama}</h3>
            <p className="text-2xl font-bold text-green-600">Rp {product.harga_jual.toLocaleString('id-ID')}</p>
          </div>

          {/* Custom Note Section */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Custom Note (Optional)
            </label>
            <textarea
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="w-full p-3 border border-gray-300 rounded-lg text-gray-800 bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none cursor-text"
              placeholder="Add any special instructions or notes for this item..."
              rows={3}
              maxLength={200}
              autoComplete="off"
              autoFocus
            />
            <p className="text-xs text-gray-500 mt-1">
              {customNote.length}/200 characters
            </p>
          </div>

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
              className="flex-1 py-3 px-4 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
            >
              Add to Cart
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
