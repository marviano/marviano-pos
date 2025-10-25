'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Delete } from 'lucide-react';
import TransactionConfirmationDialog from './TransactionConfirmationDialog';

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
  customNote?: string;
}

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  onPaymentComplete: () => void;
  transactionType: 'drinks' | 'bakery';
  isOnline?: boolean;
}

type PaymentMethod = 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
type PickupMethod = 'dine-in' | 'take-away';

export default function PaymentModal({
  isOpen,
  onClose,
  cartItems,
  onPaymentComplete,
  transactionType,
  isOnline = false
}: PaymentModalProps) {
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>('cash');
  const [selectedPickupMethod, setSelectedPickupMethod] = useState<PickupMethod>('dine-in');
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [voucherAmount, setVoucherAmount] = useState<string>('');
  const [preferenceAmount, setPreferenceAmount] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [isVoucherEnabled, setIsVoucherEnabled] = useState(false);
  const [activeInput, setActiveInput] = useState<'amount' | 'voucher' | 'preference' | 'customer'>('amount');
  const [bankId, setBankId] = useState<string>('');
  const [cardNumber, setCardNumber] = useState<string>('');
  const [selectedClAccount, setSelectedClAccount] = useState<string>('');
  const [banks, setBanks] = useState<Array<{id: number, bank_code: string, bank_name: string, is_popular: boolean}>>([]);
  const [bankSearchTerm, setBankSearchTerm] = useState<string>('');
  const [showBankDropdown, setShowBankDropdown] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  
  // Check if current payment method is an online platform
  const isOnlinePayment = ['gofood', 'grabfood', 'shopeefood', 'tiktok'].includes(selectedPaymentMethod);
  const [cardNumberError, setCardNumberError] = useState<string>('');
  const cardNumberRef = useRef<HTMLInputElement>(null);

  // Debug bank selection
  useEffect(() => {
    console.log('Bank ID changed:', bankId);
    console.log('Bank search term:', bankSearchTerm);
  }, [bankId, bankSearchTerm]);

  // Calculate order totals
  const calculateOrderTotal = () => {
    return cartItems.reduce((sum, item) => {
      let itemPrice = isOnline && (item.product as any).harga_online ? (item.product as any).harga_online : item.product.harga_jual;
      
      // Add customization prices
      if (item.customizations) {
        item.customizations.forEach(customization => {
          customization.selected_options.forEach(option => {
            itemPrice += option.price_adjustment;
          });
        });
      }
      
      return sum + (itemPrice * item.quantity);
    }, 0);
  };

  const originalPrice = calculateOrderTotal();
  const preferenceAmountValue = parseFloat(preferenceAmount) || 0;
  const voucherDiscount = isVoucherEnabled ? (parseFloat(voucherAmount) || 0) : 0;
  const orderTotal = originalPrice + preferenceAmountValue;
  const finalTotal = Math.max(0, orderTotal - voucherDiscount); // Ensure total doesn't go negative
  const receivedAmount = parseFloat(amountReceived) || 0;
  const shortage = Math.max(0, finalTotal - receivedAmount);

  const formatPrice = (price: number) => {
    return `Rp ${price.toLocaleString('id-ID')}`;
  };

  const handleCardNumberChange = (value: string) => {
    // Only allow numbers and limit to 16 digits
    const cleanValue = value.replace(/\D/g, '').slice(0, 16);
    setCardNumber(cleanValue);
    
    // Clear error when user starts typing
    if (cardNumberError) {
      setCardNumberError('');
    }
  };

  const handleKeypadInput = (value: string) => {
    // Target the currently active input field
    let currentAmount = '';
    let setAmount = setAmountReceived;
    
    if (activeInput === 'voucher') {
      currentAmount = voucherAmount;
      setAmount = setVoucherAmount;
    } else if (activeInput === 'preference') {
      currentAmount = preferenceAmount;
      setAmount = setPreferenceAmount;
    } else if (activeInput === 'customer') {
      // When customer name is focused, don't handle numpad input
      // Let the user type normally in the customer name field
      return;
    } else {
      currentAmount = amountReceived;
      setAmount = setAmountReceived;
    }

    if (value === 'clear') {
      setAmount('');
    } else if (value === 'backspace') {
      setAmount(prev => {
        const currentStr = prev || '0';
        if (currentStr.length <= 1) {
          return '';
        }
        return currentStr.slice(0, -1);
      });
    } else {
      // Single digit input - append digit
      if (['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(value)) {
        const currentStr = currentAmount || '0';
        
        // If current is 0, replace it with the new digit
        if (currentStr === '0') {
          setAmount(value);
        } else {
          // Append the digit
          const newAmountStr = currentStr + value;
          
          // Limit to max 9 digits
          if (newAmountStr.length <= 9) {
            setAmount(newAmountStr);
          }
        }
      } else if (value === '00') {
        // 00 button - append 00
        const currentStr = currentAmount || '';
        const newAmountStr = currentStr + '00';
        
        if (newAmountStr.length <= 9) {
          setAmount(newAmountStr);
        }
      } else if (value === '000') {
        // 000 button - append 000
        const currentStr = currentAmount || '';
        const newAmountStr = currentStr + '000';
        
        if (newAmountStr.length <= 9) {
          setAmount(newAmountStr);
        }
      }
    }
  };

  const handleConfirmPayment = () => {
    // Validate payment method
    if (!selectedPaymentMethod) {
      alert('Pilih metode pembayaran terlebih dahulu');
      return;
    }

    // Validate amount received for all payment methods EXCEPT CL and online platforms
    if (selectedPaymentMethod !== 'cl' && !isOnlinePayment && (!amountReceived || parseFloat(amountReceived) <= 0)) {
      alert('Masukkan jumlah yang diterima');
      return;
    }

    // Validate debit card information
    if (selectedPaymentMethod === 'debit') {
      console.log('Bank validation - bankId:', bankId, 'type:', typeof bankId);
      if (!bankId || bankId.trim() === '') {
        alert('Pilih bank');
        return;
      }
      if (!cardNumber || cardNumber.length !== 16) {
        setCardNumberError('Masukkan nomor kartu debit yang valid (16 digit)');
        // Focus the card number input
        setTimeout(() => {
          if (cardNumberRef.current) {
            cardNumberRef.current.focus();
            cardNumberRef.current.select();
          }
        }, 50);
        return;
      } else {
        setCardNumberError('');
      }
    }

    // Validate CL account selection
    if (selectedPaymentMethod === 'cl') {
      if (!selectedClAccount) {
        alert('Pilih akun City Ledger');
        return;
      }
    }

    // Check voucher validation if voucher is enabled
    if (isVoucherEnabled) {
      if (voucherDiscount <= 0) {
        alert('Masukkan jumlah voucher yang valid');
        return;
      }
      if (voucherDiscount > orderTotal) {
        alert('Jumlah voucher tidak boleh melebihi total pesanan');
        return;
      }
      if (finalTotal > 0 && selectedPaymentMethod !== 'cl' && !isOnlinePayment && receivedAmount < finalTotal) {
        alert(`Jumlah yang diterima kurang. Kurang: ${formatPrice(finalTotal - receivedAmount)}`);
        return;
      }
    } else {
      // For payments without voucher, check received amount covers the full order total
      // EXCEPT for CL payments and online platforms which don't require cash payment
      if (selectedPaymentMethod !== 'cl' && !isOnlinePayment && receivedAmount < orderTotal) {
        alert(`Jumlah yang diterima kurang. Kurang: ${formatPrice(orderTotal - receivedAmount)}`);
        return;
      }
    }

    // Show confirmation dialog instead of processing immediately
    setShowConfirmation(true);
  };

  const handleFinalConfirm = async () => {
    setIsProcessing(true);
    
    try {
      // Prepare transaction data
      const clAccountId = selectedPaymentMethod === 'cl' ? parseInt(selectedClAccount.substring(2)) : null;
      const clAccountName = selectedPaymentMethod === 'cl' ? selectedClAccount.split(' - ')[1] : null;
      
      console.log('CL Account Debug:', {
        selectedPaymentMethod,
        selectedClAccount,
        clAccountId,
        clAccountName
      });
      
      console.log('Transaction Data Debug:', {
        payment_method: selectedPaymentMethod,
        bank_id: selectedPaymentMethod === 'debit' ? parseInt(bankId) : null,
        card_number: selectedPaymentMethod === 'debit' ? cardNumber : null,
        bankId,
        cardNumber
      });

      const transactionData = {
        business_id: 14, // Momoyo Bakery Kalimantan business_id
        user_id: 1, // This should come from auth context
        payment_method: selectedPaymentMethod,
        pickup_method: selectedPickupMethod,
        total_amount: orderTotal,
        voucher_discount: voucherDiscount,
        final_amount: finalTotal,
        amount_received: receivedAmount,
        change_amount: receivedAmount - finalTotal,
        contact_id: null, // Will be used when contact book is integrated
        customer_name: customerName || null,
        bank_id: selectedPaymentMethod === 'debit' ? parseInt(bankId) : null,
        card_number: selectedPaymentMethod === 'debit' ? cardNumber : null,
        cl_account_id: clAccountId,
        cl_account_name: clAccountName,
        transaction_type: transactionType,
        items: cartItems.map(item => {
          let itemPrice = item.product.harga_jual;
          
          // Add customization prices
          if (item.customizations) {
            item.customizations.forEach(customization => {
              customization.selected_options.forEach(option => {
                itemPrice += option.price_adjustment;
              });
            });
          }
          
          return {
            product_id: item.product.id,
            quantity: item.quantity,
            unit_price: itemPrice,
            total_price: itemPrice * item.quantity,
            customizations: item.customizations,
            customNote: item.customNote || undefined
          };
        })
      };

      // Save transaction to database
      const response = await fetch('/api/transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(transactionData),
      });

      if (!response.ok) {
        throw new Error('Failed to save transaction');
      }

      const result = await response.json();
      console.log('Transaction saved:', result);
      
      // Close confirmation dialog first
      setShowConfirmation(false);
      
      // Clear cart and close modal after successful database operation
      onPaymentComplete();
      onClose();
      
      // Show success message
      alert(`Transaksi berhasil disimpan! ID: ${result.transaction_id}`);
      
    } catch (error) {
      console.error('Payment processing error:', error);
      alert('Terjadi kesalahan saat memproses pembayaran');
    } finally {
      setIsProcessing(false);
    }
  };

  // Fetch banks data
  useEffect(() => {
    const fetchBanks = async () => {
      try {
        const response = await fetch('/api/banks');
        if (response.ok) {
          const data = await response.json();
          setBanks(data.banks || []);
        }
      } catch (error) {
        console.error('Failed to fetch banks:', error);
      }
    };
    fetchBanks();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const bankDropdown = target.closest('.bank-dropdown');
      const customerInput = document.getElementById('customer-name-input');
      
      // Only close bank dropdown if clicking outside of it and not on customer input
      if (!bankDropdown && target !== customerInput && !customerInput?.contains(target) && showBankDropdown) {
        setShowBankDropdown(false);
      }
    };

    if (showBankDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showBankDropdown]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setAmountReceived('');
    setVoucherAmount('');
    setPreferenceAmount('');
    setCustomerName('');
    setIsVoucherEnabled(false);
    setBankId('');
    setCardNumber('');
    setSelectedClAccount('');
    setBankSearchTerm('');
    setShowBankDropdown(false);
      setSelectedPaymentMethod('cash');
      setSelectedPickupMethod('dine-in');
      setActiveInput('amount');
      setIsProcessing(false);
      setShowConfirmation(false);
      setCardNumberError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-2">
      <div className="bg-white rounded-2xl w-[98vw] max-w-[1350px] h-[92vh] max-h-[700px] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="text-xl font-bold text-gray-900">Payment</h2>
          <button
            onClick={onClose}
            className="w-10 h-10 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
          >
            <X size={20} className="text-gray-600" />
          </button>
        </div>

        <div className="px-6 pb-6 h-full">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
            {/* Left Side - Bill Details and Pickup Method */}
            <div className="space-y-8">
              {/* Bill Details */}
              <div className="bg-gray-50 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Rincian Tagihan</h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Harga produk asli</span>
                    <span className="text-sm font-medium text-gray-600">{formatPrice(originalPrice)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Tips/Layanan Tambahan</span>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        value={preferenceAmount ? `Rp ${parseFloat(preferenceAmount).toLocaleString('id-ID')}` : ''}
                        readOnly
                        onClick={() => setActiveInput('preference')}
                        className={`px-3 py-1 text-sm font-semibold border-2 rounded-lg text-gray-800 cursor-pointer transition-all duration-300 ${
                          activeInput === 'preference' 
                            ? 'border-orange-400 bg-orange-50 shadow-md shadow-orange-200 animate-pulse' 
                            : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                        }`}
                        placeholder="Rp 0"
                      />
                    </div>
                  </div>
                  {voucherDiscount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-green-600">Diskon Voucher</span>
                      <span className="font-medium text-green-600">-{formatPrice(voucherDiscount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t pt-3">
                    <span className="text-sm text-gray-800 font-semibold">Jumlah pesanan</span>
                    <span className="text-sm font-bold text-gray-800">{formatPrice(finalTotal)}</span>
                  </div>
                  {receivedAmount > finalTotal && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <div className="flex justify-between">
                        <span className="text-yellow-800 font-medium">Kembalian</span>
                        <span className="font-bold text-yellow-900">{formatPrice(receivedAmount - finalTotal)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>




              {/* Payment Method Specific Inputs */}
              {(selectedPaymentMethod === 'debit' || selectedPaymentMethod === 'cl') && (
                <div className={`rounded-xl p-4 ${
                  (selectedPaymentMethod === 'debit' && (!bankId || !cardNumber)) || 
                  (selectedPaymentMethod === 'cl' && !selectedClAccount)
                    ? 'bg-red-50 border-2 border-red-300 animate-pulse' 
                    : 'bg-gray-50'
                }`}>
                  <h3 className={`text-lg font-semibold mb-4 ${
                    (selectedPaymentMethod === 'debit' && (!bankId || !cardNumber)) || 
                    (selectedPaymentMethod === 'cl' && !selectedClAccount)
                      ? 'text-red-800' 
                      : 'text-gray-800'
                  }`}>
                    {selectedPaymentMethod === 'debit' ? 'Informasi Debit Card' : 'Pilih Akun City Ledger'}
                  </h3>
                  
                  {selectedPaymentMethod === 'debit' && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Pilih Bank
                        </label>
                        <div className="relative bank-dropdown">
                          <input
                            type="text"
                            value={bankSearchTerm}
                            onChange={(e) => {
                              setBankSearchTerm(e.target.value);
                              setShowBankDropdown(true);
                            }}
                            onFocus={() => {
                              setShowBankDropdown(true);
                              // Clear any active input when focusing on bank input
                              setActiveInput('amount');
                            }}
                            onBlur={() => {
                              // Small delay to allow clicking on dropdown items
                              setTimeout(() => setShowBankDropdown(false), 200);
                            }}
                            className={`w-full p-2 text-sm font-medium border rounded-md text-gray-800 bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 ${
                              !bankId ? 'border-red-300 animate-pulse' : 'border-gray-300'
                            }`}
                            placeholder="Cari bank... (BCA, BRI, Mandiri)"
                          />
                          
                          {showBankDropdown && (
                            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                              {/* Popular banks first */}
                              {banks.filter(bank => 
                                bank.is_popular && 
                                (bank.bank_name.toLowerCase().includes(bankSearchTerm.toLowerCase()) ||
                                 bank.bank_code.toLowerCase().includes(bankSearchTerm.toLowerCase()))
                              ).map(bank => (
                                <div
                                  key={bank.id}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    console.log('Bank selected:', bank.bank_name, 'ID:', bank.id);
                                    setBankId(bank.id.toString());
                                    setBankSearchTerm(bank.bank_name);
                                    setShowBankDropdown(false);
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault(); // Prevent input blur
                                  }}
                                  className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium text-gray-900 text-sm">{bank.bank_name}</span>
                                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">Popular</span>
                                  </div>
                                </div>
                              ))}
                              
                              {/* Other banks */}
                              {banks.filter(bank => 
                                !bank.is_popular && 
                                (bank.bank_name.toLowerCase().includes(bankSearchTerm.toLowerCase()) ||
                                 bank.bank_code.toLowerCase().includes(bankSearchTerm.toLowerCase()))
                              ).map(bank => (
                                <div
                                  key={bank.id}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    console.log('Bank selected:', bank.bank_name, 'ID:', bank.id);
                                    setBankId(bank.id.toString());
                                    setBankSearchTerm(bank.bank_name);
                                    setShowBankDropdown(false);
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault(); // Prevent input blur
                                  }}
                                  className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium text-gray-900 text-sm">{bank.bank_name}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Nomor Kartu (16 digit)
                        </label>
                        <input
                          ref={cardNumberRef}
                          type="text"
                          value={cardNumber}
                          onChange={(e) => handleCardNumberChange(e.target.value)}
                          onFocus={() => {
                            // Clear any active input when focusing on card number
                            setActiveInput('amount');
                          }}
                          className={`w-full p-2 text-sm font-medium border rounded-md text-gray-800 bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 ${
                            cardNumberError ? 'border-red-500 bg-red-50' : (!cardNumber ? 'border-red-300 animate-pulse' : 'border-gray-300')
                          }`}
                          placeholder="1234567890123456"
                          maxLength={16}
                        />
                        {cardNumberError ? (
                          <p className="text-xs text-red-600 mt-1 font-medium">
                            {cardNumberError}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-500 mt-1">
                            Masukkan 16 digit nomor kartu debit
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {selectedPaymentMethod === 'cl' && (
              <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Pilih Akun City Ledger
                      </label>
                      <select
                        value={selectedClAccount}
                        onChange={(e) => setSelectedClAccount(e.target.value)}
                        onFocus={() => {
                          // Clear any active input when focusing on CL account
                          setActiveInput('amount');
                        }}
                        className={`w-full p-2 text-sm font-medium border rounded-md text-gray-800 bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 ${
                          !selectedClAccount ? 'border-red-300 animate-pulse' : 'border-gray-300'
                        }`}
                      >
                        <option value="">Pilih akun...</option>
                        <option value="CL001">CL001 - Sony Hendarto</option>
                        <option value="CL002">CL002 - Jenny Sulistiowati</option>
                        <option value="CL003">CL003 - Sebastian Putra Hendarto</option>
                        <option value="CL004">CL004 - Larasati Putri Hendarto</option>
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right Side - Keypad */}
            <div className="space-y-4">
              {/* Customer Name Input and Pickup Toggle */}
              <div className="flex gap-4 items-center">
                <div className="w-1/2 relative z-10">
                  <input
                    id="customer-name-input"
                    type="text"
                    value={customerName}
                    onChange={(e) => {
                      console.log('Customer name changed:', e.target.value);
                      setCustomerName(e.target.value);
                    }}
                    onFocus={() => {
                      console.log('Customer name focused');
                      setActiveInput('customer');
                    }}
                    onClick={(e) => {
                      console.log('Customer name clicked');
                      e.stopPropagation();
                      setActiveInput('customer');
                      // Ensure the input is focused
                      setTimeout(() => {
                        e.target.focus();
                      }, 10);
                    }}
                    onKeyDown={(e) => {
                      console.log('Customer name keydown:', e.key);
                      // Prevent numpad from interfering
                      e.stopPropagation();
                    }}
                    className={`w-full p-3 pr-10 text-base font-semibold border-2 rounded-lg text-gray-800 transition-all duration-300 cursor-text ${
                      activeInput === 'customer' 
                        ? 'border-purple-400 bg-purple-50 shadow-lg shadow-purple-200' 
                        : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                    }`}
                    placeholder="Nama Pelanggan"
                    autoComplete="off"
                  />
                  <button
                    disabled
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 px-2 py-1 bg-gray-200 rounded cursor-not-allowed opacity-50"
                    title="Contact Book (Coming Soon)"
                  >
                    <span className="text-xs font-medium text-black">👥</span>
                  </button>
                </div>
                
                {/* Pickup Method Toggle */}
                <div className="w-1/2 relative bg-gray-200 rounded-lg p-0.5 flex h-[52px]">
                  {/* Sliding Background */}
                  <div
                    className={`absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-0.125rem)] bg-green-100 rounded-lg shadow-sm transition-transform duration-300 ease-in-out ${
                      selectedPickupMethod === 'dine-in' ? 'translate-x-0' : 'translate-x-full'
                    }`}
                  ></div>
                  
                  <button
                    onClick={() => setSelectedPickupMethod('dine-in')}
                    className={`relative z-10 flex-1 py-1 px-3 rounded-md font-medium text-xs transition-colors duration-300 ${
                      selectedPickupMethod === 'dine-in'
                        ? 'text-teal-600'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    DINE IN
                  </button>
                  
                  <button
                    onClick={() => setSelectedPickupMethod('take-away')}
                    className={`relative z-10 flex-1 py-1 px-3 rounded-md font-medium text-xs transition-colors duration-300 ${
                      selectedPickupMethod === 'take-away'
                        ? 'text-teal-600'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    TAKE AWAY
                  </button>
              </div>
            </div>

              {/* Payment Method Selection */}
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-2">Pilih Metode Pembayaran</h3>
                <div className="flex gap-1">
                  {!isOnline && (
                    <>
                  <button
                    onClick={() => setSelectedPaymentMethod('cash')}
                    className={`flex-1 py-2 rounded border transition-all duration-200 ${
                      selectedPaymentMethod === 'cash'
                        ? 'bg-teal-100 border-teal-400 text-teal-800'
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                      <span className="font-medium text-xs">Cash</span>
                  </button>
                  
                  <button
                    onClick={() => setSelectedPaymentMethod('debit')}
                    className={`flex-1 py-2 rounded border transition-all duration-200 ${
                      selectedPaymentMethod === 'debit'
                        ? 'bg-teal-100 border-teal-400 text-teal-800'
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                      <span className="font-medium text-xs">Debit</span>
                  </button>
                  
                  <button
                    onClick={() => setSelectedPaymentMethod('qr')}
                    className={`flex-1 py-2 rounded border transition-all duration-200 ${
                      selectedPaymentMethod === 'qr'
                        ? 'bg-teal-100 border-teal-400 text-teal-800'
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                      <span className="font-medium text-xs">QR</span>
                  </button>
                  
                  <button
                    onClick={() => setSelectedPaymentMethod('ewallet')}
                    className={`flex-1 py-2 rounded border transition-all duration-200 ${
                      selectedPaymentMethod === 'ewallet'
                        ? 'bg-teal-100 border-teal-400 text-teal-800'
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                      <span className="font-medium text-xs">E-Wallet</span>
                  </button>
                  
                  <button
                    onClick={() => {
                      setSelectedPaymentMethod('cl');
                      // Clear and reset amount input for CL
                      setAmountReceived('');
                      // Reset active input since amount field is disabled
                      setActiveInput('amount');
                      // Auto-disable voucher when CL is selected
                      if (isVoucherEnabled) {
                        setIsVoucherEnabled(false);
                      }
                    }}
                    className={`flex-1 py-2 rounded border transition-all duration-200 ${
                      selectedPaymentMethod === 'cl'
                        ? 'bg-purple-100 border-purple-400 text-purple-800'
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span className="font-medium text-xs">CL</span>
                  </button>
                  
                  <button
                    onClick={() => setIsVoucherEnabled(!isVoucherEnabled)}
                    disabled={selectedPaymentMethod === 'cl'}
                    className={`flex-1 py-2 rounded border transition-all duration-200 ${
                      selectedPaymentMethod === 'cl'
                        ? 'bg-gray-100 border-gray-300 text-gray-500 cursor-not-allowed opacity-50'
                        : isVoucherEnabled
                        ? 'bg-green-100 border-green-400 text-green-800'
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span className="font-medium text-xs">Voucher {isVoucherEnabled ? 'ON' : 'OFF'}</span>
                  </button>
                  </>
                  )}

                  {isOnline && (
                    <>
                      <button
                        onClick={() => setSelectedPaymentMethod('gofood')}
                        className={`flex-1 py-2 rounded border transition-all duration-200 ${
                          selectedPaymentMethod === 'gofood'
                            ? 'bg-teal-100 border-teal-400 text-teal-800'
                            : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                          <span className="font-medium text-xs">GoFood</span>
                      </button>
                      <button
                        onClick={() => setSelectedPaymentMethod('grabfood')}
                        className={`flex-1 py-2 rounded border transition-all duration-200 ${
                          selectedPaymentMethod === 'grabfood'
                            ? 'bg-teal-100 border-teal-400 text-teal-800'
                            : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                          <span className="font-medium text-xs">GrabFood</span>
                      </button>
                      <button
                        onClick={() => setSelectedPaymentMethod('shopeefood')}
                        className={`flex-1 py-2 rounded border transition-all duration-200 ${
                          selectedPaymentMethod === 'shopeefood'
                            ? 'bg-teal-100 border-teal-400 text-teal-800'
                            : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                          <span className="font-medium text-xs">ShopeeFood</span>
                      </button>
                      <button
                        onClick={() => setSelectedPaymentMethod('tiktok')}
                        className={`flex-1 py-2 rounded border transition-all duration-200 ${
                          selectedPaymentMethod === 'tiktok'
                            ? 'bg-teal-100 border-teal-400 text-teal-800'
                            : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                          <span className="font-medium text-xs">TikTok</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Amount Input and Shortage */}
              <div>
                {/* Amount Received Input - Show for all payment methods including CL */}
                <div className="mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">
                      Jumlah yang Diterima
                    </label>
                    {shortage > 0 && (
                      <span className="text-red-600 text-sm font-medium">
                        Kurang: {formatPrice(shortage)}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={amountReceived ? `Rp ${parseFloat(amountReceived).toLocaleString('id-ID')}` : ''}
                    readOnly
                    disabled={selectedPaymentMethod === 'cl' || isOnlinePayment}
                    onClick={() => selectedPaymentMethod !== 'cl' && !isOnlinePayment && setActiveInput('amount')}
                    className={`w-full p-3 text-base font-semibold border-2 rounded-lg transition-all duration-300 ${
                      selectedPaymentMethod === 'cl' || isOnlinePayment
                        ? 'border-gray-300 bg-gray-100 text-gray-500 cursor-not-allowed opacity-50'
                        : activeInput === 'amount' 
                        ? 'border-blue-400 bg-blue-50 shadow-lg shadow-blue-200 animate-pulse text-gray-800 cursor-pointer' 
                        : 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-800 cursor-pointer'
                    }`}
                    placeholder="Rp 0"
                  />
                  </div>

                {/* Voucher Amount Input - Only show when voucher is enabled */}
                {isVoucherEnabled && (
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700">
                        Jumlah Voucher
                      </label>
                      {voucherDiscount > orderTotal && (
                        <span className="text-red-600 text-sm font-medium">
                          Voucher melebihi total pesanan
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={voucherAmount ? `Rp ${parseFloat(voucherAmount).toLocaleString('id-ID')}` : ''}
                      readOnly
                      onClick={() => setActiveInput('voucher')}
                      className={`w-full p-3 text-base font-semibold border-2 rounded-lg text-gray-800 cursor-pointer transition-all duration-300 ${
                        activeInput === 'voucher' 
                          ? 'border-green-400 bg-green-50 shadow-lg shadow-green-200 animate-pulse' 
                          : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                      }`}
                    placeholder="Rp 0"
                  />
                </div>
                )}



                {/* Quick Amount Buttons - Show for all except CL */}
                {selectedPaymentMethod !== 'cl' && (
                <div className="mb-4">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={() => {
                          if (activeInput === 'voucher') {
                            setVoucherAmount(prev => (parseFloat(prev || '0') + 10000).toString());
                          } else {
                            // Default to amount received for all other cases (amount, customer, preference, etc.)
                            setAmountReceived(prev => (parseFloat(prev || '0') + 10000).toString());
                            setActiveInput('amount'); // Set focus back to amount
                          }
                        }}
                      className="p-2 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-md text-xs font-medium transition-colors"
                    >
                      +Rp 10.000
                    </button>
                    <button
                        onClick={() => {
                          if (activeInput === 'voucher') {
                            setVoucherAmount(prev => (parseFloat(prev || '0') + 20000).toString());
                          } else {
                            // Default to amount received for all other cases (amount, customer, preference, etc.)
                            setAmountReceived(prev => (parseFloat(prev || '0') + 20000).toString());
                            setActiveInput('amount'); // Set focus back to amount
                          }
                        }}
                      className="p-2 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-md text-xs font-medium transition-colors"
                    >
                      +Rp 20.000
                    </button>
                    <button
                        onClick={() => {
                          if (activeInput === 'voucher') {
                            setVoucherAmount(prev => (parseFloat(prev || '0') + 50000).toString());
                          } else {
                            // Default to amount received for all other cases (amount, customer, preference, etc.)
                            setAmountReceived(prev => (parseFloat(prev || '0') + 50000).toString());
                            setActiveInput('amount'); // Set focus back to amount
                          }
                        }}
                      className="p-2 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-md text-xs font-medium transition-colors"
                    >
                      +Rp 50.000
                    </button>
                    <button
                        onClick={() => {
                          if (activeInput === 'voucher') {
                            setVoucherAmount(prev => (parseFloat(prev || '0') + 100000).toString());
                          } else {
                            // Default to amount received for all other cases (amount, customer, preference, etc.)
                            setAmountReceived(prev => (parseFloat(prev || '0') + 100000).toString());
                            setActiveInput('amount'); // Set focus back to amount
                          }
                        }}
                      className="p-2 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-md text-xs font-medium transition-colors"
                    >
                      +Rp 100.000
                    </button>
                  </div>
                </div>
                )}



                {/* Numeric Keypad */}
                <div className="grid grid-cols-4 gap-2">
                  {/* Row 1: 1, 2, 3, backspace */}
                  <button
                    onClick={() => handleKeypadInput('1')}
                    className="p-3 bg-white border-2 border-gray-200 rounded-lg text-base font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
                  >
                    1
                  </button>
                  <button
                    onClick={() => handleKeypadInput('2')}
                    className="p-3 bg-white border-2 border-gray-200 rounded-lg text-base font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
                  >
                    2
                  </button>
                  <button
                    onClick={() => handleKeypadInput('3')}
                    className="p-3 bg-white border-2 border-gray-200 rounded-lg text-base font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
                  >
                    3
                  </button>
                  <button
                    onClick={() => handleKeypadInput('backspace')}
                    className="p-3 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center"
                  >
                    <Delete size={16} />
                  </button>
                  
                  {/* Row 2: 4, 5, 6, Hapus Semu */}
                  <button
                    onClick={() => handleKeypadInput('4')}
                    className="p-3 bg-white border-2 border-gray-200 rounded-lg text-base font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
                  >
                    4
                  </button>
                  <button
                    onClick={() => handleKeypadInput('5')}
                    className="p-3 bg-white border-2 border-gray-200 rounded-lg text-base font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
                  >
                    5
                  </button>
                  <button
                    onClick={() => handleKeypadInput('6')}
                    className="p-3 bg-white border-2 border-gray-200 rounded-lg text-base font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
                  >
                    6
                  </button>
                  <button
                    onClick={() => handleKeypadInput('clear')}
                    className="p-3 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    Hapus Semua
                  </button>
                  
                  {/* Row 3: 7, 8, 9, Konfirmasi (spans 2 rows) */}
                  <button
                    onClick={() => handleKeypadInput('7')}
                    className="p-3 bg-white border-2 border-gray-200 rounded-lg text-base font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
                  >
                    7
                  </button>
                  <button
                    onClick={() => handleKeypadInput('8')}
                    className="p-3 bg-white border-2 border-gray-200 rounded-lg text-base font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
                  >
                    8
                  </button>
                  <button
                    onClick={() => handleKeypadInput('9')}
                    className="p-3 bg-white border-2 border-gray-200 rounded-lg text-base font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
                  >
                    9
                  </button>
                  <button
                    onClick={handleConfirmPayment}
                    disabled={isProcessing || 
                      (selectedPaymentMethod !== 'cl' && !isOnlinePayment && selectedPaymentMethod !== 'voucher' && receivedAmount < finalTotal) ||
                      (selectedPaymentMethod === 'voucher' && (voucherDiscount <= 0 || voucherDiscount > orderTotal))
                    }
                    className={`row-span-2 p-2 rounded-lg font-medium text-xs transition-all duration-200 ${
                      isProcessing || 
                      (selectedPaymentMethod !== 'cl' && !isOnlinePayment && selectedPaymentMethod !== 'voucher' && receivedAmount < finalTotal) ||
                      (selectedPaymentMethod === 'voucher' && (voucherDiscount <= 0 || voucherDiscount > orderTotal))
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-green-500 hover:bg-green-600 text-white'
                    }`}
                  >
                    {isProcessing ? (
                      <div className="flex flex-col items-center justify-center">
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mb-1"></div>
                        <span className="text-xs">Memproses...</span>
                      </div>
                    ) : (
                      <span className="text-center">Konfirmasi</span>
                    )}
                  </button>
                  
                  {/* Row 4: 0, 00, 000 (Konfirmasi button spans from row 3) */}
                  <button
                    onClick={() => handleKeypadInput('0')}
                    className="p-3 bg-white border-2 border-gray-200 rounded-lg text-base font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
                  >
                    0
                  </button>
                  <button
                    onClick={() => handleKeypadInput('00')}
                    className="p-3 bg-white border-2 border-gray-200 rounded-lg text-base font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
                  >
                    00
                  </button>
                  <button
                    onClick={() => handleKeypadInput('000')}
                    className="p-3 bg-white border-2 border-gray-200 rounded-lg text-base font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
                  >
                    000
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
      
      {/* Transaction Confirmation Dialog */}
      <TransactionConfirmationDialog
        isOpen={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleFinalConfirm}
        cartItems={cartItems}
        paymentMethod={selectedPaymentMethod}
        pickupMethod={selectedPickupMethod}
        orderTotal={orderTotal}
        amountReceived={receivedAmount}
        change={receivedAmount - finalTotal}
        voucherDiscount={voucherDiscount}
        finalTotal={finalTotal}
        isProcessing={isProcessing}
      />
    </>
  );
}
