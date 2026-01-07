'use client';

import { X } from 'lucide-react';

interface CartItem {
  id: number;
  product: {
    id: number;
    nama?: string; // Made optional to match TableSelectionModal interface
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
  tableId?: number | null;
}

interface NewItemsConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  newItems: CartItem[];
  tableName?: string | null;
  roomName?: string | null;
}

export default function NewItemsConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  newItems,
  tableName,
  roomName,
}: NewItemsConfirmationModalProps) {
  if (!isOpen) return null;

  const tableRoomDisplay = tableName && roomName
    ? `${tableName}/${roomName}`
    : 'Take-away';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-xl font-bold text-gray-900">Konfirmasi Penambahan Item</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <p className="text-sm text-gray-600 mb-2">
              Item berikut akan ditampilkan pada kitchen/barista untuk dikerjakan:
            </p>
            <div className="text-sm font-medium text-gray-900 mb-4">
              {tableRoomDisplay}
            </div>
          </div>

          <div className="space-y-3">
            {newItems.map((item) => (
              <div
                key={item.id}
                className="border border-gray-200 rounded-lg p-3 bg-gray-50"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">
                      {item.quantity}x {item.product.nama || `Product ${item.product.id}`}
                    </div>
                    {item.customNote && (
                      <div className="text-sm text-gray-600 mt-1">
                        Catatan: {item.customNote}
                      </div>
                    )}
                  </div>
                </div>

                {item.customizations && item.customizations.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {item.customizations.map((customization, idx) => (
                      <div key={idx} className="text-sm text-gray-700">
                        <span className="font-medium">{customization.customization_name}:</span>{' '}
                        {customization.selected_options.map((opt, optIdx) => (
                          <span key={optIdx}>
                            {opt.option_name}
                            {opt.price_adjustment !== 0 && (
                              <span className="text-gray-500">
                                {' '}({opt.price_adjustment > 0 ? '+' : ''}Rp {opt.price_adjustment.toLocaleString('id-ID')})
                              </span>
                            )}
                            {optIdx < customization.selected_options.length - 1 && ', '}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Batal
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}

