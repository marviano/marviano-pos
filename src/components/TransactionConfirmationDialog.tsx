'use client';

import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface BundleSelection {
  category2_id: number;
  category2_name: string;
  selectedProducts: {
    product: {
      id: number;
      nama: string;
    };
    customizations?: {
      customization_id: number;
      customization_name: string;
      selected_options: {
        option_id: number;
        option_name: string;
        price_adjustment: number;
      }[];
    }[];
    customNote?: string;
  }[];
  requiredQuantity: number;
}

interface CartItem {
  id: number;
  product: {
    id: number;
    business_id: number;
    menu_code: string;
    nama: string;
    kategori: string;
    harga_jual: number;
    harga_qpon?: number | null;
    harga_gofood?: number | null;
    harga_grabfood?: number | null;
    harga_shopeefood?: number | null;
    harga_tiktok?: number | null;
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
  bundleSelections?: BundleSelection[];
}

interface TransactionConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (target: 'receipt' | 'receiptize') => void;
  cartItems: CartItem[];
  paymentMethod: 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher' | 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
  pickupMethod: 'dine-in' | 'take-away';
  orderTotal: number;
  amountReceived: number;
  change: number;
  voucherDiscount?: number;
  finalTotal?: number;
  isProcessing?: boolean;
  isOnline?: boolean;
  selectedOnlinePlatform?: 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' | null;
  customerName?: string;
  promotionLabel?: string;
  promotionType?: 'none' | 'percent' | 'nominal' | 'free';
  promotionValue?: number | null;
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
  isProcessing = false,
  isOnline = false,
  selectedOnlinePlatform = null,
  customerName = '',
  promotionLabel = '',
  promotionType = 'none',
  promotionValue = null
}: TransactionConfirmationDialogProps) {
  const formatPrice = (price: number) => {
    return `Rp ${price.toLocaleString('id-ID')}`;
  };

  const sumCustomizationPrice = (customizations?: CartItem['customizations']) => {
    if (!customizations || customizations.length === 0) return 0;
    return customizations.reduce((sum, customization) => {
      const optionTotal = customization.selected_options.reduce((optionSum, option) => optionSum + option.price_adjustment, 0);
      return sum + optionTotal;
    }, 0);
  };

  const calculateBundleCustomizationCharge = (bundleSelections?: BundleSelection[]) => {
    if (!bundleSelections || bundleSelections.length === 0) return 0;

    return bundleSelections.reduce((bundleSum, bundleSelection) => {
      const selectionTotal = bundleSelection.selectedProducts.reduce((productSum, selectedProduct) => {
        const perUnitAdjustment = selectedProduct.customizations?.reduce((sum, customization) => {
          const optionTotal = customization.selected_options.reduce((optionSum, option) => optionSum + option.price_adjustment, 0);
          return sum + optionTotal;
        }, 0) || 0;
        return productSum + perUnitAdjustment;
      }, 0);
      return bundleSum + selectionTotal;
    }, 0);
  };

  const getPaymentMethodLabel = (method: string) => {
    switch (method) {
      case 'cash': return 'Tunai';
      case 'debit': return 'Kartu Debit';
      case 'qr': return 'QR Code';
      case 'ewallet': return 'E-Wallet';
      case 'cl': return 'City Ledger';
      case 'voucher': return 'Voucher';
      case 'qpon': return 'Qpon';
      case 'gofood': return 'GoFood';
      case 'grabfood': return 'GrabFood';
      case 'shopeefood': return 'ShopeeFood';
      case 'tiktok': return 'TikTok';
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

  const percentLabel =
    promotionType === 'percent' && promotionValue !== null
      ? `Diskon ${promotionValue}%`
      : '';
  const showPercentDetails =
    promotionType === 'percent' &&
    promotionValue !== null &&
    percentLabel !== promotionLabel;

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
                // Use the same pricing logic as PaymentModal
                const getEffectiveProductPrice = (product: typeof item.product): number => {
                if (isOnline && selectedOnlinePlatform) {
                  switch (selectedOnlinePlatform) {
                    case 'qpon':
                        const qponPrice = product.harga_qpon;
                        if (qponPrice && qponPrice > 0) return qponPrice;
                        return 0; // No fallback in online mode when platform is selected
                    case 'gofood':
                        const gofoodPrice = product.harga_gofood;
                        if (gofoodPrice && gofoodPrice > 0) return gofoodPrice;
                        return 0;
                    case 'grabfood':
                        const grabfoodPrice = product.harga_grabfood;
                        if (grabfoodPrice && grabfoodPrice > 0) return grabfoodPrice;
                        return 0;
                    case 'shopeefood':
                        const shopeefoodPrice = product.harga_shopeefood;
                        if (shopeefoodPrice && shopeefoodPrice > 0) return shopeefoodPrice;
                        return 0;
                    case 'tiktok':
                        const tiktokPrice = product.harga_tiktok;
                        if (tiktokPrice && tiktokPrice > 0) return tiktokPrice;
                        return 0;
                      default:
                        return 0;
                    }
                  }
                  return product.harga_jual;
                };
                
                let itemPrice = getEffectiveProductPrice(item.product);
                itemPrice += sumCustomizationPrice(item.customizations);
                itemPrice += calculateBundleCustomizationCharge(item.bundleSelections);
                
                const totalItemPrice = itemPrice * item.quantity;
                
                // Debug logging
                console.log('🔍 [TransactionConfirmationDialog] Pricing Debug:', {
                  productName: item.product.nama,
                  isOnline,
                  selectedOnlinePlatform,
                  harga_jual: item.product.harga_jual,
                  harga_qpon: item.product.harga_qpon,
                  effectivePrice: getEffectiveProductPrice(item.product),
                  finalItemPrice: itemPrice,
                  totalItemPrice
                });
                
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
                        {item.bundleSelections && item.bundleSelections.length > 0 && (
                          <div className="mt-2 text-xs text-purple-600">
                            <div className="font-semibold mb-1">Bundle Items:</div>
                            {item.bundleSelections.map((bundleSel, idx) => {
                              const totalQuantity = bundleSel.selectedProducts.length;
                              return (
                                <div key={idx} className="ml-2 mb-1">
                                  <span className="font-medium">{bundleSel.category2_name} ({totalQuantity}/{bundleSel.requiredQuantity}):</span>
                                  <ul className="ml-3 mt-0.5 space-y-1">
                                    {bundleSel.selectedProducts.map((sp, spIdx) => (
                                      <li key={spIdx} className="text-gray-700">
                                        <div>• {sp.product.nama}</div>
                                        {sp.customizations && sp.customizations.length > 0 && (
                                          <div className="ml-4 text-[11px] text-gray-500 space-y-1">
                                            {sp.customizations.map((customization) => (
                                              <div key={customization.customization_id}>
                                                <div className="font-medium text-gray-600">
                                                  {customization.customization_name}
                                                </div>
                                                <div className="ml-2 space-y-0.5">
                                                  {customization.selected_options.map(option => (
                                                    <div key={option.option_id} className="flex items-center justify-between">
                                                      <span>• {option.option_name}</span>
                                                      {option.price_adjustment !== 0 && (
                                                        <span className={`text-[10px] ${option.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'}`}>
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
                                        {sp.customNote && (
                                          <div className="ml-4 text-[11px] text-purple-600 italic">
                                            Note: {sp.customNote}
                                          </div>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              );
                            })}
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
          <div className="border border-black rounded-lg overflow-hidden">
            <div className="grid grid-cols-3 divide-x divide-black/50">
              <div className="p-3">
                <div className="text-[11px] font-semibold uppercase text-gray-600 tracking-wide">
                  Metode Pembayaran
                </div>
                <div className="mt-1 text-sm font-medium text-gray-900">
                  {getPaymentMethodLabel(paymentMethod)}
                </div>
              </div>
              <div className="p-3">
                <div className="text-[11px] font-semibold uppercase text-gray-600 tracking-wide">
                  Metode Pengambilan
                </div>
                <div className="mt-1 text-sm font-medium text-gray-900">
                  {getPickupMethodLabel(pickupMethod)}
                </div>
              </div>
              <div className="p-3">
                <div className="text-[11px] font-semibold uppercase text-gray-600 tracking-wide">
                  Nama Pelanggan
                </div>
                <div className="mt-1 text-sm font-medium text-gray-900">
                  {customerName || '-'}
                </div>
              </div>
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
                <div className="flex justify-between items-start">
                  <div className="flex flex-col">
                    <span className="text-green-600">Diskon Voucher</span>
                    {promotionLabel && (
                      <span className="text-xs text-green-500 font-medium">{promotionLabel}</span>
                    )}
                    {showPercentDetails && (
                      <span className="text-[11px] text-green-500">{percentLabel}</span>
                    )}
                    {promotionType === 'free' && (
                      <span className="text-[11px] text-green-500">Gratis 100%</span>
                    )}
                  </div>
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
            onClick={(event) => {
              if (isProcessing) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const clickX = event.clientX - rect.left;
              const target = clickX <= rect.width / 2 ? 'receipt' : 'receiptize';
              onConfirm(target);
            }}
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
