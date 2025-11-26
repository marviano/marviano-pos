'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Delete } from 'lucide-react';
import TransactionConfirmationDialog from './TransactionConfirmationDialog';
import { offlineSyncService } from '@/lib/offlineSync';
import { smartSyncService } from '@/lib/smartSync';
import { generateTransactionId, generateTransactionItemId } from '@/lib/uuid';
import { useAuth } from '@/hooks/useAuth';
import { getApiUrl } from '@/lib/api';

interface BundleSelection {
  category2_id: number;
  category2_name: string;
  selectedProducts: {
    product: {
      id: number;
      nama: string;
    };
    quantity?: number;
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
    status: string;
    harga_gofood?: number;
    harga_grabfood?: number;
    harga_shopeefood?: number;
    harga_tiktok?: number;
    harga_qpon?: number;
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
  bundleSelections?: BundleSelection[];
}

type ProductInfo = CartItem['product'];

type PaymentMethodRow = {
  id: number;
  code: string;
};

type ReceiptItem = {
  name: string;
  quantity: number;
  price: number;
  total_price: number;
};

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

type SuccessResponse = {
  success?: boolean;
  error?: string;
};

type CounterResponse = SuccessResponse & {
  counter?: number;
};

const isSuccessResponse = (value: unknown): value is SuccessResponse =>
  typeof value === 'object' && value !== null && ('success' in (value as Record<string, unknown>) || 'error' in (value as Record<string, unknown>));

const isCounterResponse = (value: unknown): value is CounterResponse =>
  typeof value === 'object' && value !== null && ('counter' in (value as Record<string, unknown>) || 'success' in (value as Record<string, unknown>));

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  onPaymentComplete: () => void;
  transactionType: 'drinks' | 'bakery';
  isOnline?: boolean;
  selectedOnlinePlatform?: 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' | null;
}

type PaymentMethod = 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher' | 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
type PromotionSelection = 'none' | 'percent_30' | 'percent_35' | 'percent_50' | 'custom' | 'free';
type PickupMethod = 'dine-in' | 'take-away';

export default function PaymentModal({
  isOpen,
  onClose,
  cartItems,
  onPaymentComplete,
  transactionType,
  isOnline = false,
  selectedOnlinePlatform = null
}: PaymentModalProps) {
  const { user } = useAuth();
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>('cash');
  const [selectedPickupMethod, setSelectedPickupMethod] = useState<PickupMethod>('dine-in');
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [customVoucherAmount, setCustomVoucherAmount] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [customerUnit, setCustomerUnit] = useState<string>('1');
  const [promotionSelection, setPromotionSelection] = useState<PromotionSelection>('none');
  const [activeInput, setActiveInput] = useState<'amount' | 'voucher' | 'customer' | 'customerUnit'>('amount');
  const [bankId, setBankId] = useState<string>('');
  const [cardNumber, setCardNumber] = useState<string>('');
  const [banks, setBanks] = useState<Array<{id: number, bank_code: string, bank_name: string, is_popular: boolean}>>([]);
  const [bankSearchTerm, setBankSearchTerm] = useState<string>('');
  const [showBankDropdown, setShowBankDropdown] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showDebitModal, setShowDebitModal] = useState(false);
  const [bankError, setBankError] = useState<string>('');
  
  // Check if current payment method is an online platform
  const [cardNumberError, setCardNumberError] = useState<string>('');
  const cardNumberRef = useRef<HTMLInputElement>(null);
  const previousPaymentMethod = useRef<PaymentMethod>(selectedPaymentMethod);
  const promotionOptions: Array<{ id: PromotionSelection; label: string }> = [
    { id: 'percent_30', label: 'Diskon 30%' },
    { id: 'percent_35', label: 'Diskon 35%' },
    { id: 'percent_50', label: 'Diskon 50%' },
    { id: 'custom', label: 'Custom Nominal' },
    { id: 'free', label: 'FREE' }
  ];

  const trimmedCustomerName = customerName.trim();
  const customerUnitNumber = Math.min(999, Math.max(1, parseInt(customerUnit, 10) || 1));
  const customerUnitQuickOptions = Array.from({ length: 10 }, (_, index) => index + 1);
  const selectedBank = bankId ? banks.find(bank => bank.id.toString() === bankId) ?? null : null;
  const isCustomerNameRequired = selectedPaymentMethod === 'cl';
  const isCustomerNameMissing = isCustomerNameRequired && trimmedCustomerName.length === 0;
  const isClInfoIncomplete = selectedPaymentMethod === 'cl' && isCustomerNameMissing;

  // Auto-set pickup method for online orders
  useEffect(() => {
    if (isOnline) {
      setSelectedPickupMethod('take-away');
    }
  }, [isOnline]);

  // Auto-set payment method based on selected online platform
  useEffect(() => {
    if (isOnline && selectedOnlinePlatform) {
      setSelectedPaymentMethod(selectedOnlinePlatform as PaymentMethod);
      setSelectedPickupMethod('take-away');
    } else if (!isOnline) {
      // Reset to default for non-online orders
      setSelectedPaymentMethod('cash');
    }
  }, [isOnline, selectedOnlinePlatform]);
  
  // Initialize payment method when modal opens for online orders
  useEffect(() => {
    if (isOpen && isOnline && selectedOnlinePlatform) {
      setSelectedPaymentMethod(selectedOnlinePlatform as PaymentMethod);
      setSelectedPickupMethod('take-away');
    }
  }, [isOpen, isOnline, selectedOnlinePlatform]);

  // Calculate order totals
  const getOnlinePriceForPlatform = (product: ProductInfo): number | null => {
    if (!isOnline || !selectedOnlinePlatform) return null;
    switch (selectedOnlinePlatform) {
      case 'qpon':
        return product.harga_qpon ?? null;
      case 'gofood':
        return product.harga_gofood ?? null;
      case 'grabfood':
        return product.harga_grabfood ?? null;
      case 'shopeefood':
        return product.harga_shopeefood ?? null;
      case 'tiktok':
        return product.harga_tiktok ?? null;
      default:
        return null;
    }
  };

  const effectiveProductPrice = (product: ProductInfo): number => {
    if (isOnline && selectedOnlinePlatform) {
      const p = getOnlinePriceForPlatform(product);
      if (p && p > 0) return p;
      return 0; // No fallback in online mode when platform is selected
    }
    return product.harga_jual;
  };

  type GenericCustomization = {
    selected_options: {
      price_adjustment: number;
    }[];
  };

  const sumCustomizationPrice = (customizations?: GenericCustomization[]) => {
    if (!customizations || customizations.length === 0) return 0;
    return customizations.reduce((sum, customization) => {
      const optionTotal = customization.selected_options.reduce(
        (optionSum, option) => optionSum + option.price_adjustment,
        0
      );
      return sum + optionTotal;
    }, 0);
  };

  const calculateBundleCustomizationCharge = (bundleSelections?: BundleSelection[]) => {
    if (!bundleSelections || bundleSelections.length === 0) return 0;

    return bundleSelections.reduce((bundleSum, bundleSelection) => {
      const selectionTotal = bundleSelection.selectedProducts.reduce((productSum, selectedProduct) => {
        const perUnitAdjustment = sumCustomizationPrice(selectedProduct.customizations);
        const quantity =
          typeof selectedProduct.quantity === 'number' && !Number.isNaN(selectedProduct.quantity)
            ? selectedProduct.quantity
            : 1;
        return productSum + perUnitAdjustment * quantity;
      }, 0);
      return bundleSum + selectionTotal;
    }, 0);
  };

  const calculateOrderTotal = () => {
    return cartItems.reduce((sum, item) => {
      let itemPrice = effectiveProductPrice(item.product);
      
      // Add customization prices
      itemPrice += sumCustomizationPrice(item.customizations);
      itemPrice += calculateBundleCustomizationCharge(item.bundleSelections);
      
      return sum + (itemPrice * item.quantity);
    }, 0);
  };

  const originalPrice = calculateOrderTotal();
  const orderTotal = originalPrice;

  const promotionDetails = (() => {
    switch (promotionSelection) {
      case 'percent_30':
        return { type: 'percent' as const, value: 30, label: 'Diskon 30%', discount: Math.round(orderTotal * 0.3) };
      case 'percent_35':
        return { type: 'percent' as const, value: 35, label: 'Diskon 35%', discount: Math.round(orderTotal * 0.35) };
      case 'percent_50':
        return { type: 'percent' as const, value: 50, label: 'Diskon 50%', discount: Math.round(orderTotal * 0.5) };
      case 'custom': {
        const nominal = parseFloat(customVoucherAmount) || 0;
        const effectiveNominal = Math.min(nominal, orderTotal);
        const labelValue = effectiveNominal > 0
          ? `Voucher Custom Rp ${effectiveNominal.toLocaleString('id-ID')}`
          : 'Voucher Custom';
        return { type: 'nominal' as const, value: effectiveNominal, label: labelValue, discount: effectiveNominal };
      }
      case 'free':
        return { type: 'free' as const, value: null, label: 'Gratis 100%', discount: orderTotal };
      default:
        return { type: 'none' as const, value: null, label: '', discount: 0 };
    }
  })();

  const voucherDiscount = Math.min(orderTotal, Math.max(0, promotionDetails.discount || 0));
  const finalTotal = Math.max(0, orderTotal - voucherDiscount); // Ensure total doesn't go negative
  const receivedAmount = parseFloat(amountReceived) || 0;
  const shortage = Math.max(0, finalTotal - receivedAmount);
  const promotionLabel = promotionDetails.label;
  const promotionType = promotionDetails.type;
  const promotionValue = promotionDetails.value;
  const isPromotionApplied = promotionSelection !== 'none' && voucherDiscount > 0;
  const requiresCashInput = selectedPaymentMethod !== 'cl' && finalTotal > 0;
  const promotionsDisabled = selectedPaymentMethod === 'cl';
  const hasEnteredAmount = amountReceived !== '' && parseFloat(amountReceived) > 0;
  const amountIsSufficient = !requiresCashInput || receivedAmount >= finalTotal;
  const hasValidCustomPromotion = promotionsDisabled || promotionSelection !== 'custom' || ((promotionValue ?? 0) > 0);
  const hasValidDiscount = promotionsDisabled || !(promotionSelection !== 'none' && voucherDiscount <= 0 && orderTotal > 0);
  const voucherMethodValid = !(selectedPaymentMethod === 'voucher' && finalTotal > 0 && voucherDiscount <= 0);
  const isConfirmDisabled =
    isProcessing ||
    !hasValidCustomPromotion ||
    !hasValidDiscount ||
    !voucherMethodValid ||
    (requiresCashInput && (!hasEnteredAmount || !amountIsSufficient)) ||
    (selectedPaymentMethod === 'cl' && trimmedCustomerName === '');

  const formatPrice = (price: number) => {
    return `Rp ${price.toLocaleString('id-ID')}`;
  };

  const updateAmountString = (currentAmount: string, input: string, clampTo?: number): string => {
    const base = currentAmount || '';

    if (input === 'clear') {
      return '';
    }

    if (input === 'backspace') {
      if (base.length <= 1) {
        return '';
      }
      return base.slice(0, -1);
    }

    if (input === '00' || input === '000') {
      const newAmountStr = base + input;
      if (newAmountStr.length <= 9) {
        if (clampTo !== undefined) {
          const numeric = parseFloat(newAmountStr);
          if (Number.isNaN(numeric) || numeric <= 0) {
            return '';
          }
          const clamped = Math.min(clampTo, numeric);
          return clamped.toFixed(0);
        }
        return newAmountStr;
      }
      return base;
    }

    if (/^\d$/.test(input)) {
      if (base === '' || base === '0') {
        if (clampTo !== undefined) {
          const numeric = parseFloat(input);
          if (Number.isNaN(numeric) || numeric <= 0) {
            return '';
          }
          const clamped = Math.min(clampTo, numeric);
          return clamped.toFixed(0);
        }
        return input;
      }

      const newAmountStr = base + input;
      if (newAmountStr.length <= 9) {
        if (clampTo !== undefined) {
          const numeric = parseFloat(newAmountStr);
          if (Number.isNaN(numeric) || numeric <= 0) {
            return '';
          }
          const clamped = Math.min(clampTo, numeric);
          return clamped.toFixed(0);
        }
        return newAmountStr;
      }
      return base;
    }

    return base;
  };

  const adjustCustomerUnit = (delta: number) => {
    setCustomerUnit(prev => {
      const current = parseInt(prev || '1', 10) || 1;
      const next = Math.min(999, Math.max(1, current + delta));
      return next.toString();
    });
    setActiveInput('customerUnit');
  };

  const handleCustomerUnitQuickSelect = (value: number) => {
    setCustomerUnit(value.toString());
    setActiveInput('customerUnit');
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
    if (activeInput === 'customer') {
      // Let the user type manually for customer input
      return;
    }

    if (activeInput === 'customerUnit') {
      setCustomerUnit(prev => updateAmountString(prev, value, 999));
      return;
    }

    if (activeInput === 'voucher') {
      if (promotionSelection !== 'custom') {
        setPromotionSelection('custom');
        setCustomVoucherAmount('');
      }
      setCustomVoucherAmount(prev => updateAmountString(prev, value, orderTotal));
      return;
    }

    setAmountReceived(prev => updateAmountString(prev, value));
  };

  const applyQuickIncrement = (increment: number) => {
    setAmountReceived(prev => {
      const current = parseFloat(prev || '0');
      const next = current + increment;
      if (next <= 0) {
        return '';
      }
      return next.toFixed(0);
    });
    setActiveInput('amount');
  };

  const handlePromotionSelect = (selection: PromotionSelection) => {
    if (selection === 'none' || promotionSelection === selection) {
      setPromotionSelection('none');
      setCustomVoucherAmount('');
      setActiveInput('amount');
      return;
    }

    setPromotionSelection(selection);
    if (amountReceived) {
      setAmountReceived('');
    }
    if (selection === 'custom') {
      setActiveInput('voucher');
    } else {
      setActiveInput('amount');
      setCustomVoucherAmount('');
    }
  };

  const handleDebitModalClose = () => {
    setShowDebitModal(false);
    setBankError('');
    setCardNumberError('');
    setShowBankDropdown(false);
  };

  const handleDebitModalSave = () => {
    if (!bankId) {
      setBankError('Pilih bank terlebih dahulu');
      return;
    }
    if (!cardNumber || cardNumber.length !== 16) {
      setCardNumberError('Masukkan nomor kartu debit yang valid (16 digit)');
      setTimeout(() => {
        if (cardNumberRef.current) {
          cardNumberRef.current.focus();
          cardNumberRef.current.select();
        }
      }, 100);
      return;
    }

    setBankError('');
    setCardNumberError('');
    setShowDebitModal(false);
  };

  const handleConfirmPayment = () => {
    // Validate payment method
    if (!selectedPaymentMethod) {
      alert('Pilih metode pembayaran terlebih dahulu');
      return;
    }

    // Validate debit card information
    if (selectedPaymentMethod === 'debit') {
      if (!bankId) {
        setBankError('Pilih bank terlebih dahulu');
        setShowDebitModal(true);
        return;
      }
      if (!cardNumber || cardNumber.length !== 16) {
        setShowDebitModal(true);
        setCardNumberError('Masukkan nomor kartu debit yang valid (16 digit)');
        setTimeout(() => {
          if (cardNumberRef.current) {
            cardNumberRef.current.focus();
            cardNumberRef.current.select();
          }
        }, 100);
        return;
      } else {
        setBankError('');
        setCardNumberError('');
      }
    }

    // Validate City Ledger customer name
    if (selectedPaymentMethod === 'cl') {
      if (trimmedCustomerName === '') {
        alert('Masukkan nama pelanggan untuk City Ledger');
        return;
      }
    }

    // Validate promotion selection
    if (promotionSelection === 'custom') {
      if ((promotionValue ?? 0) <= 0) {
        alert('Masukkan nominal voucher custom yang valid');
        return;
      }
    }

    if (promotionSelection !== 'none' && voucherDiscount <= 0 && orderTotal > 0) {
      alert('Diskon voucher belum valid');
      return;
    }

    if (selectedPaymentMethod === 'voucher' && finalTotal > 0 && voucherDiscount <= 0) {
      alert('Gunakan diskon atau ubah metode pembayaran dari Voucher');
      return;
    }

    if (requiresCashInput) {
      if (!hasEnteredAmount) {
        alert('Masukkan jumlah yang diterima');
        return;
      }

      if (!amountIsSufficient) {
        alert(`Jumlah yang diterima kurang. Kurang: ${formatPrice(finalTotal - receivedAmount)}`);
        return;
      }
    }

    // Show confirmation dialog instead of processing immediately
    setShowConfirmation(true);
  };

  const handleFinalConfirm = async (target: 'receipt' | 'receiptize') => {
    setIsProcessing(true);
    
    try {
      // Prepare transaction data
      const clAccountId = null;
      const clAccountName = selectedPaymentMethod === 'cl' ? (trimmedCustomerName || null) : null;
      // For online orders, force pickup_method to 'take-away'
      const finalPickupMethod = isOnline ? 'take-away' : selectedPickupMethod;
      
      const voucherTypeForPayload = promotionType;
      const voucherValueForPayload =
        promotionType === 'percent'
          ? promotionValue ?? null
          : promotionType === 'nominal'
            ? voucherDiscount
            : promotionType === 'free'
              ? 100
              : null;
      const voucherLabelForPayload = promotionLabel || null;
      
      // Generate 19-digit numeric UUID instead of random UUID
      let transactionId = '';
      if (window.electronAPI?.generateNumericUuid) {
        const uuidResult = await window.electronAPI.generateNumericUuid(14); // business_id
        if (uuidResult?.success && uuidResult?.uuid) {
          transactionId = uuidResult.uuid;
        } else {
          // Fallback to old UUID if generation fails
          transactionId = generateTransactionId();
          console.warn('⚠️ Failed to generate numeric UUID, using fallback');
        }
      } else {
        transactionId = generateTransactionId();
        console.warn('⚠️ Numeric UUID generation not available, using fallback');
      }
      
      const transactionData = {
        id: transactionId,
        business_id: 14, // Momoyo Bakery Kalimantan business_id
        user_id: user?.id ? parseInt(user.id) : 1, // Get user ID from auth context
        payment_method: selectedPaymentMethod,
        pickup_method: finalPickupMethod,
        total_amount: orderTotal,
        voucher_discount: voucherDiscount,
        voucher_type: voucherTypeForPayload,
        voucher_value: voucherValueForPayload,
        voucher_label: voucherLabelForPayload,
        final_amount: finalTotal,
        amount_received: receivedAmount,
        change_amount: receivedAmount - finalTotal,
        status: 'completed',
        created_at: new Date().toISOString(),
        contact_id: null, // Will be used when contact book is integrated
        customer_name: trimmedCustomerName || null,
        customer_unit: customerUnitNumber,
        bank_id: selectedPaymentMethod === 'debit' && bankId ? parseInt(bankId) : null,
        card_number: selectedPaymentMethod === 'debit' ? cardNumber : null,
        cl_account_id: clAccountId,
        cl_account_name: clAccountName,
        transaction_type: transactionType,
        items: cartItems.map(item => {
          // For online orders, use platform-specific price, otherwise use harga_jual
          let basePrice = item.product.harga_jual;
          
          if (isOnline && selectedOnlinePlatform) {
            switch (selectedOnlinePlatform) {
              case 'qpon':
                basePrice = item.product.harga_qpon || item.product.harga_jual;
                break;
              case 'gofood':
                basePrice = item.product.harga_gofood || item.product.harga_jual;
                break;
              case 'grabfood':
                basePrice = item.product.harga_grabfood || item.product.harga_jual;
                break;
              case 'shopeefood':
                basePrice = item.product.harga_shopeefood || item.product.harga_jual;
                break;
              case 'tiktok':
                basePrice = item.product.harga_tiktok || item.product.harga_jual;
                break;
            }
          }
          
          let itemPrice = basePrice;
          
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
            customNote: item.customNote || undefined,
            bundleSelections: item.bundleSelections || undefined
          };
        })
      };

      // Save transaction - when online, save to BOTH databases
      try {
        const isOnline = offlineSyncService.getStatus().isOnline;
        
        let onlineResult = null;
        
        // Step 1: Save to online database if connected
        if (isOnline) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
            
            const response = await fetch(getApiUrl('/api/transactions'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(transactionData),
              signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
              throw new Error('Failed to save transaction online');
            }

            onlineResult = await response.json();
          } catch (error) {
            console.error('❌ Failed to save to online database:', error);
            // Continue to offline save even if online save fails
          }
        }
        
        // Step 2: Save to offline database (always, for redundancy and offline capability)
        const electronAPI = getElectronAPI();
        if (electronAPI) {
          // Get payment method ID from local database
          let paymentMethodId = 1; // Default to cash
          try {
            const paymentMethods = await electronAPI.localDbGetPaymentMethods?.();
            if (Array.isArray(paymentMethods)) {
              const paymentMethod = (paymentMethods as PaymentMethodRow[]).find((pm) => pm.code === selectedPaymentMethod);
            if (paymentMethod) {
              paymentMethodId = paymentMethod.id;
            } else {
              console.warn('⚠️ Payment method not found in local DB, defaulting to cash (ID: 1)');
              }
            }
          } catch (error) {
            console.error('❌ Failed to get payment methods from local DB:', error);
          }
          
          // Map transaction data for SQLite (include all fields needed by local DB)
          const sqliteTransactionData = {
            id: transactionData.id,
            business_id: transactionData.business_id,
            user_id: transactionData.user_id,
            payment_method: transactionData.payment_method,
            pickup_method: transactionData.pickup_method,
            total_amount: transactionData.total_amount,
            voucher_discount: transactionData.voucher_discount,
            voucher_type: transactionData.voucher_type,
            voucher_value: transactionData.voucher_value,
            voucher_label: transactionData.voucher_label,
            final_amount: transactionData.final_amount,
            amount_received: transactionData.amount_received,
            change_amount: transactionData.change_amount,
            status: transactionData.status,
            created_at: transactionData.created_at,
            note: null,
            bank_name: selectedPaymentMethod === 'debit' ? (banks.find(b => b.id.toString() === bankId)?.bank_name || null) : null,
            contact_id: transactionData.contact_id,
            customer_name: transactionData.customer_name,
            customer_unit: transactionData.customer_unit,
            bank_id: transactionData.bank_id,
            card_number: transactionData.card_number,
            cl_account_id: transactionData.cl_account_id,
            cl_account_name: transactionData.cl_account_name,
            receipt_number: onlineResult?.receipt_number || null, // Use receipt number from online save if available
            transaction_type: transactionData.transaction_type,
            payment_method_id: paymentMethodId // Use the looked-up payment method ID from local database
          };
          
          const transactionItems = cartItems.map(item => {
            // Determine base price depending on platform when online
            let basePrice = item.product.harga_jual;
            if (isOnline && selectedOnlinePlatform) {
              switch (selectedOnlinePlatform) {
              case 'qpon':
                basePrice = item.product.harga_qpon || item.product.harga_jual;
                break;
                case 'gofood':
                  basePrice = item.product.harga_gofood || item.product.harga_jual;
                  break;
                case 'grabfood':
                  basePrice = item.product.harga_grabfood || item.product.harga_jual;
                  break;
                case 'shopeefood':
                  basePrice = item.product.harga_shopeefood || item.product.harga_jual;
                  break;
                case 'tiktok':
                  basePrice = item.product.harga_tiktok || item.product.harga_jual;
                  break;
              }
            }

            let itemPrice = basePrice;

            // Add customization prices
            itemPrice += sumCustomizationPrice(item.customizations);
            itemPrice += calculateBundleCustomizationCharge(item.bundleSelections);
            
            return {
              id: generateTransactionItemId(), // Generate UUID for transaction item
              transaction_id: transactionData.id,
              product_id: item.product.id,
              quantity: item.quantity,
              unit_price: itemPrice,
              total_price: itemPrice * item.quantity,
              customizations: item.customizations || null,
              custom_note: item.customNote || null,
              bundle_selections_json: item.bundleSelections ? JSON.stringify(item.bundleSelections) : null,
              created_at: transactionData.created_at
            };
          });
          
          // Save transaction and items to local database
          await electronAPI.localDbUpsertTransactions?.([sqliteTransactionData]);
          await electronAPI.localDbUpsertTransactionItems?.(transactionItems);

          // If online save failed or was skipped (offline), queue for background sync
          if (!onlineResult) {
            console.log('🔄 Queuing transaction for background sync...');
            await smartSyncService.queueTransaction(transactionData);
          }
          
        } else {
          throw new Error('Offline database not available');
        }
        
        // Close confirmation dialog first
        setShowConfirmation(false);
        
        // Determine user-selected print targets
        const shouldPrintReceipt = target === 'receipt';
        const shouldPrintReceiptize = target === 'receiptize';

        // Fetch global display counter (used to hide multiple printers)
        let globalCounter = 1;
        if (window.electronAPI?.getPrinterCounter) {
          try {
            const globalCounterResult = await window.electronAPI.getPrinterCounter('globalPrinter', 14, true);
            if (isCounterResponse(globalCounterResult) && typeof globalCounterResult.counter === 'number') {
              globalCounter = globalCounterResult.counter;
            }
          } catch (counterError) {
            console.warn('⚠️ Failed to increment global printer counter:', counterError);
          }
        }

        // Prepare receipt data for printing
        const receiptNumber = onlineResult?.receipt_number || 'N/A';
        const getTableNumber = () => {
          // Extract table number from receipt number
          if (typeof receiptNumber === 'number') {
            return receiptNumber.toString().padStart(2, '0');
          }
          return '01';
        };
        
        // Transform cart items to receipt format - use platform price for online orders
        const receiptItems: ReceiptItem[] = [];
        
        cartItems.forEach(item => {
          // For online orders, use platform-specific price, otherwise use harga_jual
          let basePrice = item.product.harga_jual;
          
          if (isOnline && selectedOnlinePlatform) {
            switch (selectedOnlinePlatform) {
              case 'qpon':
                basePrice = item.product.harga_qpon || item.product.harga_jual;
                break;
              case 'gofood':
                basePrice = item.product.harga_gofood || item.product.harga_jual;
                break;
              case 'grabfood':
                basePrice = item.product.harga_grabfood || item.product.harga_jual;
                break;
              case 'shopeefood':
                basePrice = item.product.harga_shopeefood || item.product.harga_jual;
                break;
              case 'tiktok':
                basePrice = item.product.harga_tiktok || item.product.harga_jual;
                break;
            }
          }
          
          let itemPrice = basePrice;
          
          // Add customization prices for main item only
          itemPrice += sumCustomizationPrice(item.customizations);
          
          // Format item name with customizations and custom note if any
          let itemName = item.product.nama;
          if (item.customizations && item.customizations.length > 0) {
            const customizationText = item.customizations.map(c => 
              `${c.customization_name}: ${c.selected_options.map(opt => opt.option_name).join(', ')}`
            ).join(', ');
            itemName = `${itemName} (${customizationText})`;
          }
          // Add custom note if exists
          if (item.customNote) {
            if (itemName.includes('(')) {
              itemName = `${itemName}, ${item.customNote})`;
            } else {
              itemName = `${itemName} (${item.customNote})`;
            }
          }
          
          // Add main bundle item
          receiptItems.push({
            name: itemName,
            quantity: item.quantity,
            price: itemPrice,
            total_price: itemPrice * item.quantity
          });
          
          // Add bundle selections as sub-items
          if (item.bundleSelections && item.bundleSelections.length > 0) {
            item.bundleSelections.forEach(bundleSel => {
              bundleSel.selectedProducts.forEach(sp => {
                // Multiply by bundle quantity and selected product quantity
                const selectionQty =
                  typeof sp.quantity === 'number' && !Number.isNaN(sp.quantity) ? sp.quantity : 1;
                const totalQty = item.quantity * selectionQty;
                const customizationDetails: string[] = [];

                if (sp.customizations && sp.customizations.length > 0) {
                  sp.customizations.forEach(customization => {
                    const optionNames = customization.selected_options.map(opt => opt.option_name).join(', ');
                    if (optionNames) {
                      customizationDetails.push(
                        customization.customization_name
                          ? `${customization.customization_name}: ${optionNames}`
                          : optionNames
                      );
                    }
                  });
                }

                if (sp.customNote && sp.customNote.trim() !== '') {
                  customizationDetails.push(sp.customNote.trim());
                }

                let subItemName = `  └ ${sp.product.nama}${selectionQty > 1 ? ` (×${selectionQty})` : ''}`;
                if (customizationDetails.length > 0) {
                  subItemName = `${subItemName} (${customizationDetails.join(', ')})`;
                }

                const perUnitAdjustment = sumCustomizationPrice(sp.customizations);
                const perUnitTotal = perUnitAdjustment;

                receiptItems.push({
                  name: subItemName,
                  quantity: totalQty,
                  price: perUnitTotal,
                  total_price: perUnitTotal * totalQty
                });
              });
            });
          }
        });

        // Append voucher discount as a negative line on the receipt when applied
        if (voucherDiscount > 0) {
          receiptItems.push({
            name: promotionLabel ? `Diskon Voucher (${promotionLabel})` : 'Diskon Voucher',
            quantity: 1,
            price: -voucherDiscount,
            total_price: -voucherDiscount
          });
        }
        
        // Get user info from auth
        const cashierName = user?.name || 'Kasir';
        
        // Prepare receipt print data
        const printData = {
          type: 'transaction',
          printerType: 'receiptPrinter',
          printerName: '', // Will be auto-determined from saved printer config
          business_id: transactionData.business_id, // Include business_id for fetching business name
          items: receiptItems,
          total: finalTotal,
          paymentMethod: selectedPaymentMethod === 'cash' ? 'Cash' : 
                        selectedPaymentMethod === 'debit' ? 'Debit Card' :
                        selectedPaymentMethod === 'qr' ? 'QR Code' :
                        selectedPaymentMethod === 'ewallet' ? 'E-Wallet' :
                        selectedPaymentMethod === 'cl' ? 'City Ledger' :
                        selectedPaymentMethod === 'qpon' ? 'Qpon' :
                        selectedPaymentMethod === 'gofood' ? 'GoFood' :
                        selectedPaymentMethod === 'grabfood' ? 'GrabFood' :
                        selectedPaymentMethod === 'shopeefood' ? 'ShopeeFood' :
                        selectedPaymentMethod === 'tiktok' ? 'TikTok' :
                        selectedPaymentMethod,
          amountReceived: receivedAmount,
          change: Math.max(0, receivedAmount - finalTotal),
          date: transactionData.created_at,
          receiptNumber: transactionData.id, // Use 19-digit transaction UUID as nomor pesanan
          tableNumber: getTableNumber(),
          cashier: cashierName,
          transactionType: transactionType,
          pickupMethod: finalPickupMethod,
          globalCounter
        };
        
        // Variables to store printer counters for label printing
        let printer1Counter: number | undefined = undefined;
        let printer2Counter: number | undefined = undefined;
        
        // Get printer configs to read copies setting
        let printer1Copies = 1;
        let printer2Copies = 1;
        try {
          const configsRaw = await window.electronAPI?.localDbGetPrinterConfigs?.();
          if (Array.isArray(configsRaw)) {
            configsRaw.forEach((config: any) => {
              if (config?.printer_type === 'receiptPrinter' && config?.extra_settings) {
                try {
                  const extra = typeof config.extra_settings === 'string'
                    ? JSON.parse(config.extra_settings)
                    : config.extra_settings;
                  if (extra && typeof extra === 'object' && typeof extra.copies === 'number' && extra.copies > 0) {
                    printer1Copies = extra.copies;
                  }
                } catch (parseError) {
                  console.warn('⚠️ Failed to parse Printer 1 extra_settings:', parseError);
                }
              }
              if (config?.printer_type === 'receiptizePrinter' && config?.extra_settings) {
                try {
                  const extra = typeof config.extra_settings === 'string'
                    ? JSON.parse(config.extra_settings)
                    : config.extra_settings;
                  if (extra && typeof extra === 'object' && typeof extra.copies === 'number' && extra.copies > 0) {
                    printer2Copies = extra.copies;
                  }
                } catch (parseError) {
                  console.warn('⚠️ Failed to parse Printer 2 extra_settings:', parseError);
                }
              }
            });
          }
        } catch (configError) {
          console.warn('⚠️ Failed to load printer configs for copies setting:', configError);
        }
        
        // Print to Printer 1 if selected
        if (shouldPrintReceipt) {
          try {
            // Get Printer 1 counter and increment
            printer1Counter = 1;
            if (window.electronAPI?.getPrinterCounter) {
              const counterResult = await window.electronAPI.getPrinterCounter('receiptPrinter', 14, true); // true = increment
              if (isCounterResponse(counterResult) && typeof counterResult.counter === 'number') {
                printer1Counter = counterResult.counter;
              }
            }
            
            // Create printer1Data with receiptPrinter counter
            const printer1Data = { 
              ...printData, 
              printerType: 'receiptPrinter', 
              receiptNumber: transactionData.id, 
              printer1Counter // Receipt printer daily counter (only for receiptPrinter)
            };
            
            // Log to audit BEFORE printing (so reprint is possible even if print fails)
            try {
              const logResult = await window.electronAPI?.logPrinter1Print?.(transactionData.id, printer1Counter, globalCounter);
              if (isSuccessResponse(logResult) && !logResult.success) {
                console.error('❌ Failed to log Printer 1 audit:', logResult?.error);
                console.warn('⚠️ Transaction saved but audit log failed - receipt badge may not appear correctly');
              } else if (!isSuccessResponse(logResult)) {
                console.warn('⚠️ Failed to log Printer 1 audit: Invalid response', logResult);
              }
            } catch (logError) {
              console.error('❌ Error logging Printer 1 audit:', logError);
              console.warn('⚠️ Transaction saved but audit log failed - receipt badge may not appear correctly');
            }
            
            // Print after logging - loop for copies
            await new Promise(r => setTimeout(r, 500));
            for (let copy = 1; copy <= printer1Copies; copy++) {
              if (copy > 1) {
                // Small delay between copies
                await new Promise(r => setTimeout(r, 300));
              }
              const printResult = await window.electronAPI?.printReceipt?.(printer1Data);
              if (isSuccessResponse(printResult) && !printResult.success) {
                console.error(`❌ Printer 1 failed (copy ${copy}/${printer1Copies}):`, printResult?.error);
              } else if (copy === 1) {
                console.log(`✅ Printer 1 print successful (${printer1Copies} copy/copies)`);
              }
            }
          } catch (printError) {
            console.error('❌ Error printing to Printer 1:', printError);
          }
        }
        
        // Printer 2 manual print if selected via confirmation dialog
        if (shouldPrintReceiptize) {
          try {
            // Get Printer 2 counter and increment
            printer2Counter = 1;
            if (window.electronAPI?.getPrinterCounter) {
              const counterResult = await window.electronAPI.getPrinterCounter('receiptizePrinter', 14, true); // true = increment
              if (isCounterResponse(counterResult) && typeof counterResult.counter === 'number') {
                printer2Counter = counterResult.counter;
              }
            }
            
            // Create printer2Data with receiptizePrinter counter
            const printer2Data = { 
              ...printData, 
              printerType: 'receiptizePrinter', 
              receiptNumber: transactionData.id, 
              printer2Counter // Receiptize printer daily counter (only for receiptizePrinter)
            };
            
            // Log to audit BEFORE printing (so reprint is possible even if print fails)
            try {
              const logResult = await window.electronAPI?.logPrinter2Print?.(transactionData.id, printer2Counter, 'manual', undefined, globalCounter);
              if (isSuccessResponse(logResult) && !logResult.success) {
                console.error('❌ Failed to log Printer 2 audit:', logResult?.error);
                console.warn('⚠️ Transaction saved but audit log failed - receiptize badge may not appear correctly');
              } else if (!isSuccessResponse(logResult)) {
                console.warn('⚠️ Failed to log Printer 2 audit: Invalid response', logResult);
              }
            } catch (logError) {
              console.error('❌ Error logging Printer 2 audit:', logError);
              console.warn('⚠️ Transaction saved but audit log failed - receiptize badge may not appear correctly');
            }
            
            // Print after logging - loop for copies
            await new Promise(r => setTimeout(r, 500));
            for (let copy = 1; copy <= printer2Copies; copy++) {
              if (copy > 1) {
                // Small delay between copies
                await new Promise(r => setTimeout(r, 300));
              }
              const printResult = await window.electronAPI?.printReceipt?.(printer2Data);
              if (isSuccessResponse(printResult) && !printResult.success) {
                console.error(`❌ Printer 2 failed (copy ${copy}/${printer2Copies}):`, printResult?.error);
              } else if (copy === 1) {
                console.log(`✅ Printer 2 print successful (${printer2Copies} copy/copies)`);
              }
            }
          } catch (printError) {
            console.error('❌ Error printing to Printer 2:', printError);
          }
        }
        
        // Print labels for each order item
        try {
          // Get the counter to use (from the selected printer)
          let labelCounter: number = 1;
          if (shouldPrintReceipt && typeof printer1Counter === 'number') {
            labelCounter = printer1Counter;
          } else if (shouldPrintReceiptize && typeof printer2Counter === 'number') {
            labelCounter = printer2Counter;
          } else if (!shouldPrintReceipt && shouldPrintReceiptize && window.electronAPI?.getPrinterCounter) {
            const counterResult = await window.electronAPI.getPrinterCounter('receiptizePrinter', 14, false); // Don't increment
            if (isCounterResponse(counterResult) && typeof counterResult.counter === 'number') {
              labelCounter = counterResult.counter;
            }
          }
          
          // Calculate total items for numbering
          // For bundles: count each selected product × quantity
          // For regular products: count the item quantity
          const totalItems = cartItems.reduce((sum, item) => {
            if (item.bundleSelections && item.bundleSelections.length > 0) {
              // For bundles, count all selected products (each entry represents one unit unless quantity provided)
              let bundleItemCount = 0;
              for (const bundleSel of item.bundleSelections) {
                for (const selectedProduct of bundleSel.selectedProducts) {
                  const selectionQty = typeof selectedProduct.quantity === 'number' && !Number.isNaN(selectedProduct.quantity)
                    ? selectedProduct.quantity
                    : 1;
                  bundleItemCount += selectionQty;
                }
              }
              return sum + (bundleItemCount * item.quantity);
            } else {
              // For regular products
              return sum + item.quantity;
            }
          }, 0);
          
          // Track current item number across all items
          let currentItemNumber = 0;
          
          // Helper function to split customizations into chunks that fit on a label
          // Each label can roughly fit 60-80 characters of customizations
          const MAX_CUSTOMIZATION_LENGTH_PER_LABEL = 70;
          
          const splitCustomizations = (customizationText: string): string[] => {
            if (!customizationText || customizationText.length <= MAX_CUSTOMIZATION_LENGTH_PER_LABEL) {
              return [customizationText];
            }
            
            // Split by '/' to preserve individual options
            const parts = customizationText.split('/');
            const chunks: string[] = [];
            let currentChunk = '';
            
            for (const part of parts) {
              // If adding this part would exceed limit, start new chunk
              const wouldExceed = currentChunk 
                ? (currentChunk + '/' + part).length > MAX_CUSTOMIZATION_LENGTH_PER_LABEL
                : part.length > MAX_CUSTOMIZATION_LENGTH_PER_LABEL;
              
              if (wouldExceed && currentChunk) {
                chunks.push(currentChunk);
                currentChunk = part;
              } else if (wouldExceed && !currentChunk) {
                // Single part is too long, split it further (by word or character)
                const words = part.split(' ');
                let wordChunk = '';
                for (const word of words) {
                  if ((wordChunk + ' ' + word).length > MAX_CUSTOMIZATION_LENGTH_PER_LABEL && wordChunk) {
                    chunks.push(wordChunk.trim());
                    wordChunk = word;
                  } else {
                    wordChunk = wordChunk ? wordChunk + ' ' + word : word;
                  }
                }
                if (wordChunk) {
                  currentChunk = wordChunk;
                }
              } else {
                currentChunk = currentChunk ? currentChunk + '/' + part : part;
              }
            }
            
            if (currentChunk) {
              chunks.push(currentChunk);
            }
            
            return chunks.length > 0 ? chunks : [customizationText];
          };
          
          // Print label for each unit of each cart item
          for (const item of cartItems) {
            // Check if this is a bundle product
            const isBundle = item.bundleSelections && item.bundleSelections.length > 0;
            
            if (isBundle) {
              // For bundle products, print labels for each selected product
              for (const bundleSel of item.bundleSelections!) {
                for (const selectedProduct of bundleSel.selectedProducts) {
                  // Calculate total quantity (bundle quantity × selected product quantity)
                  const selectionQty = typeof selectedProduct.quantity === 'number' && !Number.isNaN(selectedProduct.quantity)
                    ? selectedProduct.quantity
                    : 1;
                  const totalQty = item.quantity * selectionQty;

                  // Build customization text for bundle selected product
                  const allOptions: string[] = [];
                  if (selectedProduct.customizations && selectedProduct.customizations.length > 0) {
                    selectedProduct.customizations.forEach(c => {
                      c.selected_options.forEach(opt => {
                        allOptions.push(opt.option_name);
                      });
                    });
                  }

                  if (selectedProduct.customNote && selectedProduct.customNote.trim() !== '') {
                    allOptions.push(selectedProduct.customNote.trim());
                  }

                  const customizationText = allOptions.join('/');
                  const customizationChunks = splitCustomizations(customizationText);
                  
                  // Print one label per unit of each selected product
                  for (let qty = 0; qty < totalQty; qty++) {
                    currentItemNumber++;
                    
                    for (let chunkIndex = 0; chunkIndex < customizationChunks.length; chunkIndex++) {
                      const isMultiLabel = customizationChunks.length > 1;
                      const labelNumber = chunkIndex + 1;
                      const totalLabels = customizationChunks.length;

                      // Prepare label data for bundle selected product
                      const labelData = {
                        printerType: 'labelPrinter',
                        counter: labelCounter,
                        itemNumber: currentItemNumber,
                        totalItems: totalItems,
                        pickupMethod: finalPickupMethod,
                        productName: selectedProduct.product.nama,
                        customizations: customizationChunks[chunkIndex],
                        customNote: '',
                        orderTime: transactionData.created_at,
                        labelContinuation: isMultiLabel ? `${labelNumber}/${totalLabels}` : undefined
                      };
                      
                      // Print label with delay between prints
                      await new Promise(resolve => setTimeout(resolve, 300));
                      const labelResult = await window.electronAPI?.printLabel?.(labelData);
                      if (!isSuccessResponse(labelResult) || !labelResult.success) {
                        const errorMessage = isSuccessResponse(labelResult) ? labelResult.error : undefined;
                        console.error(`❌ Bundle label print failed:`, errorMessage);
                      }
                    }
                  }
                }
              }
            } else {
              // For regular products (non-bundle), use existing logic
              // Build customization text - format as xxx/xxx/xxx
              const allOptions: string[] = [];
              if (item.customizations && item.customizations.length > 0) {
                item.customizations.forEach(c => {
                  c.selected_options.forEach(opt => {
                    allOptions.push(opt.option_name);
                  });
                });
              }
              
              // Add custom note if exists
              if (item.customNote) {
                allOptions.push(item.customNote);
              }
              
              const customizationText = allOptions.join('/');
              
              // Split customizations into chunks if too long
              const customizationChunks = splitCustomizations(customizationText);
              
              // Print one label per quantity, and if customizations are split, multiple labels per unit
              for (let qty = 0; qty < item.quantity; qty++) {
                currentItemNumber++;
                
                // Print each chunk as a separate label
                for (let chunkIndex = 0; chunkIndex < customizationChunks.length; chunkIndex++) {
                  const isMultiLabel = customizationChunks.length > 1;
                  const labelNumber = chunkIndex + 1;
                  const totalLabels = customizationChunks.length;
                  
                  // Prepare label data
                  const labelData = {
                    printerType: 'labelPrinter',
                    counter: labelCounter,
                    itemNumber: currentItemNumber,
                    totalItems: totalItems,
                    pickupMethod: finalPickupMethod,
                    productName: item.product.nama,
                    customizations: customizationChunks[chunkIndex],
                    customNote: '', // No longer used separately
                    orderTime: transactionData.created_at,
                    labelContinuation: isMultiLabel ? `${labelNumber}/${totalLabels}` : undefined
                  };
                  
                  // Print label with delay between prints
                  await new Promise(resolve => setTimeout(resolve, 300));
                  const labelResult = await window.electronAPI?.printLabel?.(labelData);
                  if (!isSuccessResponse(labelResult) || !labelResult.success) {
                    const errorMessage = isSuccessResponse(labelResult) ? labelResult.error : undefined;
                    console.error(`❌ Label print failed:`, errorMessage);
                  }
                }
              }
            }
          }
        } catch (labelError) {
          console.error('❌ Error printing labels:', labelError);
          // Don't fail the transaction if label printing fails
        }
        
        // Clear cart and close modal after successful database operation
        onPaymentComplete();
        onClose();
        
      } catch (error) {
        console.error('❌ Failed to save transaction:', error);
        
        // Show error message
        alert(`Gagal menyimpan transaksi: ${error instanceof Error ? error.message : 'Unknown error'}`);
          
        // Close confirmation dialog
        setShowConfirmation(false);
      }
      
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
        const banksData = await offlineSyncService.fetchWithFallback(
          // Online fetch
          async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
            
            try {
              const response = await fetch(getApiUrl('/api/banks'), {
                signal: controller.signal
              });
              clearTimeout(timeoutId);
              
              if (!response.ok) {
                throw new Error('Failed to fetch banks online');
              }
          const data = await response.json();
              return data.banks || [];
            } catch (error) {
              clearTimeout(timeoutId);
              throw error;
            }
          },
          // Offline fetch
          async () => {
            const electronAPI = getElectronAPI();
            if (!electronAPI?.localDbGetBanks) {
              throw new Error('Offline database not available');
        }
            const banks = await electronAPI.localDbGetBanks();
            return Array.isArray(banks) ? banks : [];
          }
        );
        
        setBanks(Array.isArray(banksData) ? banksData : []);
      } catch (error) {
        console.error('Failed to fetch banks:', error);
        setBanks([]); // Set empty array as fallback
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

  useEffect(() => {
    if (showDebitModal) {
      setBankSearchTerm(selectedBank?.bank_name ?? '');
    } else {
      setShowBankDropdown(false);
      if (selectedBank) {
        setBankSearchTerm(selectedBank.bank_name);
      }
    }
  }, [showDebitModal, selectedBank]);

  useEffect(() => {
    if (selectedPaymentMethod !== 'debit' && showDebitModal) {
      handleDebitModalClose();
    }
  }, [selectedPaymentMethod, showDebitModal]);

  useEffect(() => {
    const previous = previousPaymentMethod.current;
    if (
      selectedPaymentMethod === 'debit' &&
      previous !== 'debit' &&
      (!bankId || !cardNumber || cardNumber.length !== 16)
    ) {
      setBankError('');
      setCardNumberError('');
      setShowDebitModal(true);
    }
    previousPaymentMethod.current = selectedPaymentMethod;
  }, [selectedPaymentMethod, bankId, cardNumber]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setAmountReceived('');
      setCustomVoucherAmount('');
      setCustomerName('');
      setCustomerUnit('1');
      setPromotionSelection('none');
      setBankId('');
      setCardNumber('');
      setBankSearchTerm('');
    setShowBankDropdown(false);
      // Don't reset payment method if it's an online order with a selected platform
      if (!isOnline || !selectedOnlinePlatform) {
        setSelectedPaymentMethod('cash');
      }
      // Don't reset pickup method if it's an online order
      if (!isOnline) {
        setSelectedPickupMethod('dine-in');
      }
      setActiveInput('amount');
      setIsProcessing(false);
      setShowConfirmation(false);
      setCardNumberError('');
    }
  }, [isOpen, isOnline, selectedOnlinePlatform]);

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
            <div className="space-y-2">
              {/* Customer Name and Pickup Method */}
              <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
                <div className="flex gap-4 items-center">
                  <div className="w-1/2 relative z-10">
                    <input
                      id="customer-name-input"
                      type="text"
                      value={customerName}
                      onChange={(e) => {
                        setCustomerName(e.target.value);
                      }}
                      onFocus={() => {
                        setActiveInput('customer');
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveInput('customer');
                        // Ensure the input is focused
                        setTimeout(() => {
                          const input = document.getElementById('customer-name-input') as HTMLInputElement;
                          input?.focus();
                        }, 10);
                      }}
                      onKeyDown={(e) => {
                        // Prevent numpad from interfering
                        e.stopPropagation();
                      }}
                      className={`w-full p-3 pr-10 text-base font-semibold border-2 rounded-lg text-gray-800 transition-all duration-300 cursor-text ${
                        isCustomerNameMissing
                          ? 'border-red-400 bg-red-50 shadow-lg shadow-red-100 animate-pulse'
                          : activeInput === 'customer' 
                            ? 'border-purple-400 bg-purple-50 shadow-lg shadow-purple-200' 
                            : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                      }`}
                      placeholder="Nama Pelanggan"
                      autoComplete="off"
                    />
                  {isCustomerNameMissing && (
                    <p className="mt-1 text-xs font-semibold text-red-600">
                      Nama pelanggan wajib diisi untuk City Ledger.
                    </p>
                  )}
                    <button
                      disabled
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 px-2 py-1 bg-gray-200 rounded cursor-not-allowed opacity-50"
                      title="Contact Book (Coming Soon)"
                    >
                      <span className="text-xs font-medium text-black">👥</span>
                    </button>
                  </div>
                  
                  {/* Pickup Method Toggle or Display */}
                  {isOnline ? (
                    <div className="w-1/2 bg-green-50 border-2 border-green-300 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-green-800">Pickup:</span>
                        <span className="text-xs font-bold text-green-900 uppercase">TAKE AWAY</span>
                      </div>
                    </div>
                  ) : (
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
                  )}
                </div>
                <div className="mt-4">
                  <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                    Customer Unit
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => adjustCustomerUnit(-1)}
                      disabled={customerUnitNumber <= 1}
                      className={`w-10 h-10 rounded-lg border text-lg font-bold transition-colors ${
                        customerUnitNumber <= 1
                          ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveInput('customerUnit')}
                      className={`flex-1 px-4 py-2 rounded-lg border-2 text-base font-semibold transition-all duration-300 ${
                        activeInput === 'customerUnit'
                          ? 'border-blue-400 bg-blue-50 text-blue-800 shadow-lg shadow-blue-100 animate-pulse'
                          : 'border-gray-200 bg-white text-gray-800 hover:border-blue-300'
                      }`}
                    >
                      {`${customerUnitNumber} Orang`}
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustCustomerUnit(1)}
                      className="w-10 h-10 rounded-lg border border-gray-300 bg-white text-lg font-bold text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      +
                    </button>
                  </div>
                  <div className="grid grid-cols-5 gap-2 mt-3">
                    {customerUnitQuickOptions.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => handleCustomerUnitQuickSelect(value)}
                        className={`w-full px-3 py-1 rounded-full border text-xs font-medium transition-colors ${
                          customerUnitNumber === value
                            ? 'bg-blue-100 border-blue-400 text-blue-800'
                            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {/* Bill Details */}
              <div className="bg-gray-50 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-800">Rincian Tagihan</h3>
                  {selectedPaymentMethod === 'debit' && (
                    <button
                      type="button"
                      onClick={() => {
                        setBankError('');
                        setCardNumberError('');
                        setShowDebitModal(true);
                      }}
                      className="px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                    >
                      Isi / Ubah Debit
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Harga produk asli</span>
                    <span className="text-sm font-medium text-gray-600">{formatPrice(originalPrice)}</span>
                  </div>
                  {selectedPaymentMethod === 'debit' && (
                    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-blue-700 font-semibold uppercase tracking-wide">
                          Bank
                        </span>
                        <span className={`text-sm font-semibold ${selectedBank ? 'text-blue-900' : 'text-red-600'}`}>
                          {selectedBank?.bank_name || 'Belum dipilih'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-blue-700 font-semibold uppercase tracking-wide">
                          Nomor Kartu
                        </span>
                        <span className={`text-sm font-semibold ${cardNumber ? 'text-blue-900' : 'text-red-600'}`}>
                          {cardNumber || 'Belum diisi'}
                        </span>
                      </div>
                    </div>
                  )}
                  {voucherDiscount > 0 && (
                    <div className="flex justify-between items-start">
                      <div className="flex flex-col">
                        <span className="text-green-600">Diskon Voucher</span>
                        {promotionLabel && (
                          <span className="text-[11px] text-green-500 font-medium">{promotionLabel}</span>
                        )}
                      </div>
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
              {selectedPaymentMethod === 'cl' && (
                <div className={`rounded-xl p-4 ${isClInfoIncomplete ? 'bg-red-50 border-2 border-red-300 animate-pulse' : 'bg-gray-50 border border-gray-200'}`}>
                  <h3 className={`text-lg font-semibold mb-4 ${isClInfoIncomplete ? 'text-red-800' : 'text-gray-800'}`}>
                    Informasi City Ledger
                  </h3>
                  <div className="space-y-3">
                    <p className="text-sm text-gray-700">
                      Nama pelanggan yang kamu isi akan disimpan sebagai referensi City Ledger.
                    </p>
                    <div
                      className={`rounded-lg border border-dashed ${
                        trimmedCustomerName ? 'border-purple-300 bg-purple-50/60' : 'border-red-300 bg-red-50/70'
                      } p-3 text-xs`}
                    >
                      <p className="font-semibold text-gray-700">Nama pelanggan saat ini:</p>
                      <p
                        className={`mt-1 text-base font-bold ${
                          trimmedCustomerName ? 'text-purple-800' : 'text-red-600'
                        }`}
                      >
                        {trimmedCustomerName || 'Belum diisi'}
                      </p>
                    </div>
                    <p className="text-xs text-gray-600">
                      Pastikan pelanggan memahami bahwa transaksi ini dicatat sebagai hutang (City Ledger).
                    </p>
                    {isCustomerNameMissing && (
                      <p className="text-xs font-semibold text-red-600">
                        Silakan isi nama pelanggan untuk melanjutkan pembayaran City Ledger.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right Side - Keypad */}
            <div className="space-y-4">
              {/* Customer Name Input and Pickup Toggle */}
              {/* Payment Method Selection */}
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-2">Pilih Metode Pembayaran</h3>
                <div className="space-y-2">
                  {/* Show locked platform payment method for online orders */}
                  {isOnline && selectedOnlinePlatform && (
                    <div className="p-3 bg-blue-50 border-2 border-blue-300 rounded-lg">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-blue-800">Platform:</span>
                        <span className="text-sm font-bold text-blue-900 uppercase">
                          {selectedOnlinePlatform === 'qpon' ? 'Qpon' : 
                           selectedOnlinePlatform === 'gofood' ? 'GoFood' : 
                           selectedOnlinePlatform === 'grabfood' ? 'GrabFood' : 
                           selectedOnlinePlatform === 'shopeefood' ? 'ShopeeFood' : 
                           selectedOnlinePlatform === 'tiktok' ? 'TikTok' : selectedOnlinePlatform}
                        </span>
                      </div>
                    </div>
                  )}
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
                        // Pindahkan fokus ke input nama pelanggan karena wajib diisi
                        setActiveInput('customer');
                        // Clear promotion when CL is selected
                        if (promotionSelection !== 'none') {
                          setPromotionSelection('none');
                          setCustomVoucherAmount('');
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
                    </>
                    )}
                  </div>

                </div>
              </div>
              {!isOnline && (
                <div className={`space-y-2 ${promotionsDisabled ? 'opacity-60' : ''}`}>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {promotionOptions.map(option => (
                      <button
                        key={option.id}
                        onClick={() => !promotionsDisabled && handlePromotionSelect(option.id)}
                        disabled={promotionsDisabled}
                        className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                          promotionSelection === option.id && !promotionsDisabled
                            ? 'bg-green-100 border-green-400 text-green-800 shadow-sm'
                            : promotionsDisabled
                              ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                    {promotionSelection !== 'none' && (
                      <button
                        onClick={() => !promotionsDisabled && handlePromotionSelect('none')}
                        disabled={promotionsDisabled}
                        className={`px-3 py-2 rounded-lg border text-xs font-medium ${
                          promotionsDisabled
                            ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                            : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        Hapus Promo
                      </button>
                    )}
                  </div>
                  {promotionsDisabled && (
                    <p className="text-[11px] text-gray-500">
                      Promo tidak tersedia untuk pembayaran City Ledger.
                    </p>
                  )}
                  {!promotionsDisabled && promotionSelection === 'custom' && (
                    <div className="max-w-xs">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Nominal Voucher Custom
                      </label>
                      <input
                        type="text"
                        value={
                          promotionValue && promotionValue > 0
                            ? `Rp ${promotionValue.toLocaleString('id-ID')}`
                            : ''
                        }
                        readOnly
                        onClick={() => setActiveInput('voucher')}
                        className={`w-full px-3 py-2 text-sm font-semibold border-2 rounded-lg transition-all duration-300 ${
                          activeInput === 'voucher'
                            ? 'border-green-400 bg-green-50 shadow-lg shadow-green-200 animate-pulse text-gray-800 cursor-pointer'
                            : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-800 cursor-pointer'
                        }`}
                        placeholder="Rp 0"
                      />
                      <p className="text-[11px] text-gray-500 mt-1">
                        Gunakan keypad di kanan untuk memasukkan nominal voucher.
                      </p>
                    </div>
                  )}
                  {!promotionsDisabled && isPromotionApplied && promotionLabel && (
                    <p className="text-xs text-green-700 font-medium">
                      Promo terpilih: {promotionLabel}
                    </p>
                  )}
                </div>
              )}

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
                  <div className="relative">
                    <input
                      type="text"
                      value={amountReceived ? `Rp ${parseFloat(amountReceived).toLocaleString('id-ID')}` : ''}
                      readOnly
                      disabled={selectedPaymentMethod === 'cl'}
                      onClick={() => selectedPaymentMethod !== 'cl' && setActiveInput('amount')}
                      className={`w-full p-3 pr-12 text-base font-semibold border-2 rounded-lg transition-all duration-300 ${
                        selectedPaymentMethod === 'cl'
                          ? 'border-gray-300 bg-gray-100 text-gray-500 cursor-not-allowed opacity-50'
                          : activeInput === 'amount' 
                          ? 'border-blue-400 bg-blue-50 shadow-lg shadow-blue-200 animate-pulse text-gray-800 cursor-pointer' 
                          : 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-800 cursor-pointer'
                      }`}
                      placeholder="Rp 0"
                    />
                    {amountReceived && selectedPaymentMethod !== 'cl' && (
                      <button
                        type="button"
                        onClick={() => {
                          setAmountReceived('');
                          setActiveInput('amount');
                        }}
                        className="absolute inset-y-0 right-0 px-3 flex items-center text-xs font-semibold text-gray-500 hover:text-red-600 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  </div>

                {/* Quick Amount Buttons - Show for all except CL */}
                {selectedPaymentMethod !== 'cl' && (
                <div className="mb-4">
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => {
                        setAmountReceived(Math.ceil(finalTotal).toString());
                        setActiveInput('amount');
                      }}
                      className="p-2 bg-green-500 hover:bg-green-600 text-white rounded-md text-xs font-semibold transition-colors shadow-md"
                    >
                      💰 Uang Pas
                    </button>
                    <button
                      onClick={() => applyQuickIncrement(10000)}
                      className="p-2 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-md text-xs font-medium transition-colors"
                    >
                      +Rp 10.000
                    </button>
                    <button
                      onClick={() => applyQuickIncrement(50000)}
                      className="p-2 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-md text-xs font-medium transition-colors"
                    >
                      +Rp 50.000
                    </button>
                    <button
                      onClick={() => applyQuickIncrement(5000)}
                      className="p-2 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-md text-xs font-medium transition-colors"
                    >
                      +Rp 5.000
                    </button>
                    <button
                      onClick={() => applyQuickIncrement(20000)}
                      className="p-2 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-md text-xs font-medium transition-colors"
                    >
                      +Rp 20.000
                    </button>
                    <button
                      onClick={() => applyQuickIncrement(100000)}
                      className="p-2 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-md text-xs font-medium transition-colors"
                    >
                      +Rp 100.000
                    </button>
                  </div>
                </div>
                )}



                {/* Numeric Keypad */}
                <div className="grid grid-cols-4 gap-2">
                  {/* Row 1: 7, 8, 9, backspace */}
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
                    onClick={() => handleKeypadInput('backspace')}
                    className="p-3 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center"
                  >
                    <Delete size={16} />
                  </button>
                  
                  {/* Row 2: 4, 5, 6, Hapus Semua */}
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
                  
                  {/* Row 3: 1, 2, 3, Konfirmasi (spans 2 rows) */}
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
                    onClick={handleConfirmPayment}
                    disabled={isConfirmDisabled}
                    className={`row-span-2 p-2 rounded-lg font-medium text-xs transition-all duration-200 ${
                      isConfirmDisabled
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
      
      {showDebitModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
          onClick={handleDebitModalClose}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={handleDebitModalClose}
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
            >
              <X size={18} />
            </button>
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Lengkapi Informasi Debit</h3>
              <p className="text-sm text-gray-500 mt-1">
                Pilih bank dan masukkan nomor kartu debit pelanggan.
              </p>
            </div>
            <div className="space-y-4">
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
                      setActiveInput('amount');
                    }}
                    onBlur={() => {
                      setTimeout(() => setShowBankDropdown(false), 200);
                    }}
                    className={`w-full p-2 text-sm font-medium border rounded-md text-gray-800 bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 ${
                      bankError ? 'border-red-400' : 'border-gray-300'
                    }`}
                    placeholder="Cari bank... (BCA, BRI, Mandiri)"
                  />

                  {showBankDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
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
                            setBankId(bank.id.toString());
                            setBankSearchTerm(bank.bank_name);
                            setShowBankDropdown(false);
                            setBankError('');
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                          }}
                          className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-gray-900 text-sm">{bank.bank_name}</span>
                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">Popular</span>
                          </div>
                        </div>
                      ))}

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
                            setBankId(bank.id.toString());
                            setBankSearchTerm(bank.bank_name);
                            setShowBankDropdown(false);
                            setBankError('');
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault();
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
                {bankError && (
                  <p className="mt-2 text-xs text-red-600 font-medium">{bankError}</p>
                )}
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
                    setActiveInput('amount');
                  }}
                  className={`w-full p-2 text-sm border rounded-md bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 placeholder:text-gray-400 placeholder:opacity-70 ${
                    cardNumberError ? 'border-red-500 bg-red-50 text-red-800' : 'border-gray-300 text-gray-900'
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
                    Masukkan 16 digit nomor kartu debit.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={handleDebitModalClose}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleDebitModalSave}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

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
        promotionLabel={promotionLabel}
        promotionType={promotionType}
        promotionValue={promotionValue ?? null}
        finalTotal={finalTotal}
        isProcessing={isProcessing}
        customerName={customerName}
        isOnline={isOnline}
        selectedOnlinePlatform={selectedOnlinePlatform}
      />
    </>
  );
}

