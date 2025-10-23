'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface CartItem {
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
  customizations?: {
    customization_id: number;
    customization_name: string;
    selected_options: {
      option_id: number;
      option_name: string;
      price_adjustment: number;
    }[];
  }[];
}

interface TransactionConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  cartItems: CartItem[];
  paymentMethod: 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher';
  pickupMethod: 'dine-in' | 'take-away';
  orderTotal: number;
  amountReceived: number;
  change: number;
  voucherDiscount?: number;
  finalTotal?: number;
  isProcessing?: boolean;
}

export default function TransactionConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  cartItems,
  paymentMethod,
  pickupMethod,
  orderTotal,
  amountReceived,
  change,
  voucherDiscount = 0,
  finalTotal = orderTotal,
  isProcessing = false
}: TransactionConfirmationDialogProps) {
  const formatPrice = (price: number) => {
    return `Rp ${price.toLocaleString('id-ID')}`;
  };

  const getPaymentMethodLabel = (method: string) => {
    switch (method) {
      case 'cash': return 'Tunai';
      case 'debit': return 'Kartu Debit';
      case 'qr': return 'QR Code';
      case 'ewallet': return 'E-Wallet';
      case 'cl': return 'City Ledger';
      case 'voucher': return 'Voucher';
      default: return method;
    }
  };

  const getPickupMethodLabel = (method: string) => {
    switch (method) {
      case 'dine-in': return 'Makan di Tempat';
      case 'take-away': return 'Bungkus';
      default: return method;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Konfirmasi Transaksi</h2>
              <p className="text-sm text-gray-600">Periksa detail transaksi sebelum melanjutkan</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors disabled:opacity-50"
          >
            <XCircle className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Order Summary */}
          <div className="bg-gray-50 rounded-xl p-4">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Rincian Pesanan</h3>
            <div className="space-y-3">
              {cartItems.map((item, index) => {
                let itemPrice = item.product.harga_jual;
                
                // Add customization prices
                if (item.customizations) {
                  item.customizations.forEach(customization => {
                    customization.selected_options.forEach(option => {
                      itemPrice += option.price_adjustment;
                    });
                  });
                }
                
                const totalItemPrice = itemPrice * item.quantity;
                
                return (
                  <div key={index} className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="font-medium text-gray-800">{item.product.nama}</div>
                      <div className="text-sm text-gray-600">
                        {item.quantity}x {formatPrice(itemPrice)}
                        {item.customizations && item.customizations.length > 0 && (
                          <div className="mt-1 text-xs text-gray-500">
                            {item.customizations.map(customization => (
                              <div key={customization.customization_id}>
                                {customization.customization_name}: {customization.selected_options.map(opt => opt.option_name).join(', ')}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="font-semibold text-gray-800">
                      {formatPrice(totalItemPrice)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Payment Details */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 rounded-xl p-4">
              <h4 className="font-semibold text-blue-800 mb-2">Metode Pembayaran</h4>
              <p className="text-blue-700">{getPaymentMethodLabel(paymentMethod)}</p>
            </div>
            <div className="bg-green-50 rounded-xl p-4">
              <h4 className="font-semibold text-green-800 mb-2">Metode Pengambilan</h4>
              <p className="text-green-700">{getPickupMethodLabel(pickupMethod)}</p>
            </div>
          </div>

          {/* Amount Summary */}
          <div className="bg-gray-50 rounded-xl p-4">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Rincian Pembayaran</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Pesanan</span>
                <span className="font-medium text-gray-800">{formatPrice(orderTotal)}</span>
              </div>
              {voucherDiscount > 0 && (
                <div className="flex justify-between">
                  <span className="text-green-600">Diskon Voucher</span>
                  <span className="font-medium text-green-600">-{formatPrice(voucherDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-2">
                <span className="font-semibold text-gray-800">Total Akhir</span>
                <span className="font-bold text-lg text-gray-800">{formatPrice(finalTotal)}</span>
              </div>
              {paymentMethod !== 'cl' && paymentMethod !== 'voucher' && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Uang Diterima</span>
                    <span className="font-medium text-gray-800">{formatPrice(amountReceived)}</span>
                  </div>
                  {change > 0 && (
                    <div className="flex justify-between border-t pt-2">
                      <span className="font-semibold text-green-600">Kembalian</span>
                      <span className="font-bold text-lg text-green-600">{formatPrice(change)}</span>
                    </div>
                  )}
                </>
              )}
              {paymentMethod === 'cl' && (
                <div className="flex justify-between border-t pt-2">
                  <span className="font-semibold text-purple-600">City Ledger</span>
                  <span className="font-bold text-lg text-purple-600">Tidak ada pembayaran tunai</span>
                </div>
              )}
              {paymentMethod === 'voucher' && finalTotal === 0 && (
                <div className="flex justify-between border-t pt-2">
                  <span className="font-semibold text-green-600">Lunas dengan Voucher</span>
                  <span className="font-bold text-lg text-green-600">Rp 0</span>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Sticky Footer */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 bg-white rounded-b-2xl flex-shrink-0">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={onConfirm}
            disabled={isProcessing}
            className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center space-x-2"
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Memproses...</span>
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                <span>Konfirmasi Transaksi</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
