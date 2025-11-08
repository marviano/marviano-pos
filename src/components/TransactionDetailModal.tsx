import React from 'react';

interface TransactionItem {
  id: string; // Changed to string for UUID
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  custom_note?: string;
  customizations_json?: string;
  bundle_selections_json?: string;
}

interface Transaction {
  id: string; // Changed to string for UUID
  business_id: number;
  user_id: number;
  user_name: string;
  business_name: string;
  payment_method: 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
  pickup_method: 'dine-in' | 'take-away';
  total_amount: number;
  voucher_discount: number;
  final_amount: number;
  amount_received: number;
  change_amount: number;
  contact_id?: number | null;
  customer_name?: string | null;
  receipt_number?: number | null;
  transaction_type?: 'drinks' | 'bakery';
  bank_id?: number | null;
  bank_name?: string | null;
  card_number?: string | null;
  cl_account_id?: number | null;
  cl_account_name?: string | null;
  created_at: string;
  items: TransactionItem[];
}

interface TransactionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction | null;
  isLoading?: boolean;
}

const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  isOpen,
  onClose,
  transaction,
  isLoading = false
}) => {
  if (!isOpen) return null;


  const formatPrice = (price: number) => {
    return `Rp ${price.toLocaleString('id-ID')}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('id-ID', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getPaymentMethodLabel = (method: string) => {
    const labels: { [key: string]: string } = {
      'cash': 'Cash/Tunai',
      'debit': 'Debit Card',
      'qr': 'QR Code',
      'ewallet': 'E-Wallet',
      'cl': 'City Ledger',
      'voucher': 'Voucher',
      'gofood': 'GoFood',
      'grabfood': 'GrabFood',
      'shopeefood': 'ShopeeFood',
      'tiktok': 'TikTok'
    };
    return labels[method] || method;
  };

  const getPickupMethodLabel = (method: string) => {
    const labels: { [key: string]: string } = {
      'dine-in': 'Dine In',
      'take-away': 'Take Away'
    };
    return labels[method] || method;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-xl">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {isLoading ? 'Memuat Detail Transaksi...' : `Detail Transaksi #${transaction?.id || ''}`}
              </h2>
              <div className="flex items-center gap-4 mt-1">
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    <p className="text-sm text-gray-500">Memuat...</p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-gray-500">
                      {formatDate(transaction?.created_at || '')}
                    </p>
                    {transaction?.receipt_number && (
                      <span className="text-sm font-medium text-blue-600">
                        Receipt #{transaction.receipt_number}
                      </span>
                    )}
                    {transaction?.transaction_type && (
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        transaction.transaction_type === 'drinks' 
                          ? 'bg-blue-100 text-blue-800' 
                          : 'bg-orange-100 text-orange-800'
                      }`}>
                        {transaction.transaction_type === 'drinks' ? '🥤' : '🥖'} {transaction.transaction_type}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="p-6 flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Memuat detail transaksi...</p>
            </div>
          </div>
        ) : transaction ? (
          <div className="p-6 space-y-6">
          {/* Transaction Summary */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-sm font-medium text-gray-600">Total Belanja</p>
                <p className="text-xl font-bold text-blue-600">
                  {formatPrice(transaction.total_amount)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-600">Diskon Voucher</p>
                <p className="text-xl font-bold text-red-600">
                  -{formatPrice(transaction.voucher_discount)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-600">Total Bayar</p>
                <p className="text-xl font-bold text-green-600">
                  {formatPrice(transaction.final_amount)}
                </p>
              </div>
            </div>
          </div>

          {/* Customer Information */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <span className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-bold mr-2">
                👤
              </span>
              Informasi Pelanggan
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-gray-600">Nama Pelanggan</p>
                <p className="text-base text-gray-900">
                  {transaction.customer_name || 'Tidak ada nama'}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Contact ID</p>
                <p className="text-base text-gray-900">
                  {transaction.contact_id || 'Tidak ada'}
                </p>
              </div>
            </div>
          </div>

          {/* Payment Information */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <span className="w-6 h-6 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-sm font-bold mr-2">
                💳
              </span>
              Informasi Pembayaran
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-gray-600">Metode Pembayaran</p>
                <p className="text-base text-gray-900">
                  {getPaymentMethodLabel(transaction.payment_method)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Metode Pengambilan</p>
                <p className="text-base text-gray-900">
                  {getPickupMethodLabel(transaction.pickup_method)}
                </p>
              </div>
              
              {/* Payment Method Specific Info */}
              {transaction.payment_method === 'debit' && (
                <>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Bank</p>
                    <p className="text-base text-gray-900">
                      {transaction.bank_name || 'Tidak ada informasi bank'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Nomor Kartu</p>
                    <p className="text-base text-gray-900 font-mono">
                      {transaction.card_number ? 
                        `**** **** **** ${transaction.card_number.slice(-4)}` : 
                        'Tidak ada'
                      }
                    </p>
                  </div>
                </>
              )}
              
              {transaction.payment_method === 'cl' && (
                <div className="md:col-span-2">
                  <p className="text-sm font-medium text-gray-600">Akun City Ledger</p>
                  <p className="text-base text-gray-900">
                    {transaction.cl_account_name || 'Tidak ada informasi akun'}
                  </p>
                </div>
              )}
              
              {transaction.payment_method !== 'cl' && (
                <>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Jumlah Diterima</p>
                    <p className="text-base text-gray-900">
                      {formatPrice(transaction.amount_received)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Kembalian</p>
                    <p className="text-base text-gray-900">
                      {formatPrice(transaction.change_amount)}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Transaction Items */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <span className="w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-bold mr-2">
                🛒
              </span>
              Item Transaksi ({transaction.items.length} item)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 font-medium text-gray-600">Produk</th>
                    <th className="text-center py-2 px-3 font-medium text-gray-600">Qty</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600">Harga Satuan</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {transaction.items.map((item, index) => (
                    <tr key={item.id} className={`border-b border-gray-100 ${index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}>
                      <td className="py-3 px-3">
                        <div>
                          <p className="font-medium text-gray-900">{item.product_name}</p>
                          
                          {/* Customizations Display */}
                          {item.customizations_json && item.customizations_json !== '[]' && (() => {
                            try {
                              const customizations = JSON.parse(item.customizations_json);
                              if (customizations.length === 0) return null;
                              
                              // Calculate total customization adjustments
                              const totalAdjustments = customizations.reduce((total: number, customization: any) => {
                                return total + customization.selected_options.reduce((optTotal: number, option: any) => {
                                  return optTotal + (option.price_adjustment || 0);
                                }, 0);
                              }, 0);
                              
                              // Calculate base price (unit price minus customization adjustments)
                              const basePrice = item.unit_price - totalAdjustments;
                              
                              return (
                                <div className="mt-2 space-y-2">
                                  {/* Base Price */}
                                  <div className="border-b border-gray-200 pb-1">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="text-gray-500 font-medium">Base Price:</span>
                                      <span className="text-gray-700 font-medium">{formatPrice(basePrice)}</span>
                                    </div>
                                  </div>
                                  
                                  {/* Customizations */}
                                  <div className="space-y-2">
                                    {customizations.map((customization: any, idx: number) => (
                                      <div key={idx} className="text-xs">
                                        <div className="border-b border-gray-100 pb-1 mb-1">
                                          <span className="text-gray-500 font-medium">{customization.customization_name}:</span>
                                        </div>
                                        <div className="ml-2 space-y-0.5">
                                          {customization.selected_options.map((option: any, optIdx: number) => (
                                            <div key={optIdx} className="flex items-center justify-between">
                                              <span className="text-gray-600">• {option.option_name}</span>
                                              {option.price_adjustment !== 0 && (
                                                <span className={`text-xs font-medium ${
                                                  option.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                  {option.price_adjustment > 0 ? '+' : ''}{formatPrice(Math.abs(option.price_adjustment))}
                                                </span>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  
                                  {/* Total Line */}
                                  <div className="border-t border-gray-200 pt-1">
                                    <div className="flex items-center justify-between text-xs font-medium">
                                      <span className="text-gray-700">Total:</span>
                                      <span className="text-gray-900">{formatPrice(item.unit_price)}</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            } catch (e) {
                              console.error('Error parsing customizations:', e);
                              return null;
                            }
                          })()}
                          
                          {/* Custom Note Display */}
                          {item.custom_note && (
                            <div className="mt-1">
                              <p className="text-xs text-gray-500">
                                <span className="text-gray-400">Note:</span>
                                <span className="text-gray-700 ml-1 italic">"{item.custom_note}"</span>
                              </p>
                            </div>
                          )}
                          
                          {/* Bundle Selections Display */}
                          {item.bundle_selections_json && item.bundle_selections_json !== 'null' && (() => {
                            try {
                              const bundleSelections = JSON.parse(item.bundle_selections_json);
                              if (!bundleSelections || bundleSelections.length === 0) return null;
                              
                              return (
                                <div className="mt-2 space-y-2">
                                  <div className="text-xs font-semibold text-purple-700">Bundle Items:</div>
                                  {bundleSelections.map((bundleSel: any, idx: number) => {
                                    // Support both old format (array of products) and new format (array of {product, quantity})
                                    const selectedProducts = bundleSel.selectedProducts || [];
                                    const isNewFormat = selectedProducts.length > 0 && selectedProducts[0]?.product;
                                    const totalQuantity = isNewFormat 
                                      ? selectedProducts.reduce((sum: number, sp: any) => sum + (sp.quantity ?? 1), 0)
                                      : selectedProducts.length;
                                    
                                    return (
                                      <div key={idx} className="ml-2 border-l-2 border-purple-300 pl-2">
                                        <div className="text-xs font-medium text-purple-600">
                                          {bundleSel.category2_name} ({totalQuantity}/{bundleSel.requiredQuantity}):
                                        </div>
                                        <div className="ml-2 mt-1 space-y-0.5">
                                          {isNewFormat 
                                            ? selectedProducts.map((sp: any, spIdx: number) => (
                                                <div key={spIdx} className="text-xs text-gray-600 space-y-1">
                                                  <div>• {sp.product?.nama || ''}</div>
                                                  {sp.customizations && Array.isArray(sp.customizations) && sp.customizations.length > 0 && (
                                                    <div className="ml-4 text-[11px] text-gray-500">
                                                      {sp.customizations.map((customization: any) => (
                                                        <div key={customization.customization_id || customization.id} className="mt-0.5">
                                                          <div className="font-medium text-gray-600">
                                                            {customization.customization_name || customization.name}
                                                          </div>
                                                          <div className="ml-2 space-y-0.5">
                                                            {(customization.selected_options || []).map((opt: any, optIdx: number) => (
                                                              <div key={opt.option_id || opt.id || optIdx} className="flex items-center justify-between">
                                                                <span>• {opt.option_name || opt.name}</span>
                                                                {opt.price_adjustment ? (
                                                                  <span className={`text-[10px] ${opt.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                                    {opt.price_adjustment > 0 ? '+' : ''}{formatPrice(opt.price_adjustment)}
                                                                  </span>
                                                                ) : null}
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
                                                </div>
                                              ))
                                            : selectedProducts.map((p: any, pIdx: number) => (
                                                <div key={pIdx} className="text-xs text-gray-600">• {p.nama}</div>
                                              ))
                                          }
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            } catch (e) {
                              console.error('Error parsing bundle selections:', e);
                              return null;
                            }
                          })()}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-sm font-medium">
                          {item.quantity}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-gray-900">
                        {formatPrice(item.unit_price)}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-gray-900">
                        {formatPrice(item.total_price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-100">
                    <td colSpan={3} className="py-3 px-3 text-right font-bold text-gray-900">
                      Total:
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-lg text-gray-900">
                      {formatPrice(transaction.total_amount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Staff Information */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <span className="w-6 h-6 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center text-sm font-bold mr-2">
                👨‍💼
              </span>
              Informasi Staff
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-gray-600">Kasir</p>
                <p className="text-base text-gray-900">
                  {transaction.user_name || 'Tidak ada nama kasir'}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Outlet</p>
                <p className="text-base text-gray-900">
                  {transaction.business_name || 'Tidak ada nama outlet'}
                </p>
              </div>
            </div>
          </div>
        </div>
        ) : null}

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 rounded-b-xl">
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransactionDetailModal;



