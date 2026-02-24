'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Delete, Trash2 } from 'lucide-react';
import TransactionConfirmationDialog from './TransactionConfirmationDialog';
import { offlineSyncService } from '@/lib/offlineSync';
import { smartSyncService } from '@/lib/smartSync';
import { generateTransactionId, generateTransactionItemId } from '@/lib/uuid';
import { useAuth } from '@/hooks/useAuth';
import { getApiUrl } from '@/lib/api';
import { type PackageSelection, getPackageBreakdownLines, getPackageBreakdownLinesWithProductId, formatPackageLineDisplay } from './PackageSelectionModal';

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
  packageSelections?: PackageSelection[];
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
  /** Sent so backend can hide note for Nona Laras template */
  customNote?: string;
  /** Backend expects snake_case for print; used only when template show_notes is true */
  custom_note?: string;
  customizations?: unknown;
  /** category1_id for checker slip: 1 → itemsCategory1, 2 or other → itemsCategory2 */
  category1_id?: number | null;
  /** category1_name for checker section header (e.g. Makanan, Minuman) */
  category1_name?: string | null;
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
  initialCustomerName?: string;
  initialCustomerUnit?: string | number;
  loadedTransactionInfo?: {
    transactionId: string;
    tableName: string | null;
    roomName: string | null;
    customerName: string | null;
    waiterName: string | null;
    waiterColor: string | null;
    pickupMethod?: 'dine-in' | 'take-away';
    voucher_discount?: number;
    voucher_type?: string;
    voucher_value?: number | null;
    voucher_label?: string | null;
  } | null;
  /** Pickup method selected in cart (Take Away / Dine In) - carried over when opening payment */
  pickupMethod?: 'dine-in' | 'take-away';
  waiterId?: number | null;
}

type PaymentMethod = 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher' | 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
type PromotionSelection = 'none' | 'percent_10' | 'percent_15' | 'percent_20' | 'percent_25' | 'percent_30' | 'percent_35' | 'percent_50' | 'custom' | 'free';
type PickupMethod = 'dine-in' | 'take-away';

// Popular banks in debit selector: BCA (1), BNI (19), Mandiri (3)
const POPULAR_BANK_IDS = [1, 19, 3];
const POPULAR_BANK_LABELS: Record<number, string> = { 1: 'BCA', 19: 'BNI', 3: 'Mandiri' };

export default function PaymentModal({
  isOpen,
  onClose,
  cartItems,
  onPaymentComplete,
  transactionType,
  isOnline = false,
  selectedOnlinePlatform = null,
  initialCustomerName = '',
  initialCustomerUnit: initialCustomerUnitProp = undefined,
  waiterId = null,
  loadedTransactionInfo = null,
  pickupMethod: cartPickupMethod = 'dine-in'
}: PaymentModalProps) {
  const { user } = useAuth();
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>('cash');
  const [selectedPickupMethod, setSelectedPickupMethod] = useState<PickupMethod>('dine-in');
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [customVoucherAmount, setCustomVoucherAmount] = useState<string>('');
  
  // Get business ID from logged-in user
  const businessId = user?.selectedBusinessId;
  
  if (!businessId) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md">
          <h2 className="text-xl font-bold text-red-600 mb-2">No Business Selected</h2>
          <p className="text-gray-700">Please log in and select a business to proceed with payment.</p>
        </div>
      </div>
    );
  }
  const [customerName, setCustomerName] = useState<string>('');
  const [customerUnit, setCustomerUnit] = useState<string>('1');
  const [promotionSelection, setPromotionSelection] = useState<PromotionSelection>('none');
  const [activeInput, setActiveInput] = useState<'amount' | 'voucher' | 'customer' | 'customerUnit'>('amount');
  const [bankId, setBankId] = useState<string>('');
  const [cardNumber, setCardNumber] = useState<string>('');
  const [banks, setBanks] = useState<Array<{ id: number, bank_code: string, bank_name: string, is_popular: boolean }>>([]);
  const [bankSearchTerm, setBankSearchTerm] = useState<string>('');
  const [showBankDropdown, setShowBankDropdown] = useState<boolean>(false);
  const [showOtherBanks, setShowOtherBanks] = useState<boolean>(false);
  const [otherBankSearchTerm, setOtherBankSearchTerm] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showDebitModal, setShowDebitModal] = useState(false);
  const [bankError, setBankError] = useState<string>('');

  // Check if current payment method is an online platform
  const [cardNumberError, setCardNumberError] = useState<string>('');
  const cardNumberRef = useRef<HTMLInputElement>(null);
  const previousPaymentMethod = useRef<PaymentMethod>(selectedPaymentMethod);
  const percentDiscountOptions: Array<{ id: PromotionSelection; label: string }> = [
    { id: 'percent_10', label: '10%' },
    { id: 'percent_15', label: '15%' },
    { id: 'percent_20', label: '20%' },
    { id: 'percent_25', label: '25%' },
    { id: 'percent_30', label: '30%' },
    { id: 'percent_35', label: '35%' },
    { id: 'percent_50', label: '50%' },
  ];
  const otherPromotionOptions: Array<{ id: PromotionSelection; label: string }> = [
    { id: 'free', label: 'FREE' },
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

  // Initialize customer name and CU when modal opens or when props change
  useEffect(() => {
    if (isOpen) {
      // Always sync customerName and customerUnit with props when modal is open
      const timeoutId = setTimeout(() => {
        setCustomerName(initialCustomerName || '');
        const cu = initialCustomerUnitProp;
        if (cu !== undefined && cu !== null) {
          const s = typeof cu === 'number' ? String(Math.min(999, Math.max(1, cu))) : String(cu).replace(/\D/g, '') || '1';
          setCustomerUnit(s || '1');
        }
      }, 0);
      return () => clearTimeout(timeoutId);
    } else {
      // Reset when modal closes
      setCustomerName('');
      setCustomerUnit('1');
    }
  }, [isOpen, initialCustomerName, initialCustomerUnitProp]);

  // Pre-fill promotion from loaded transaction (runs after reset when opening with loaded tx that has voucher)
  useEffect(() => {
    if (!isOpen || !loadedTransactionInfo) return;
    const rawVd = loadedTransactionInfo.voucher_discount;
    const vd = typeof rawVd === 'number' && !Number.isNaN(rawVd) ? rawVd : (typeof rawVd === 'string' ? parseFloat(rawVd) : 0);
    const disc = Number.isNaN(vd) ? 0 : vd;
    const vt = (loadedTransactionInfo.voucher_type ?? '').toLowerCase();
    const rawVv = loadedTransactionInfo.voucher_value;
    const nvv = typeof rawVv === 'number' && !Number.isNaN(rawVv) ? rawVv : (typeof rawVv === 'string' ? parseFloat(rawVv) : NaN);
    const val = Number.isNaN(nvv) ? NaN : nvv;
    if (vt === 'free') {
      setPromotionSelection('free');
      setCustomVoucherAmount('');
      return;
    }
    if (vt === 'percent' && !Number.isNaN(val)) {
      const s = `percent_${Math.round(val)}` as PromotionSelection;
      if (['percent_10', 'percent_15', 'percent_20', 'percent_25', 'percent_30', 'percent_35', 'percent_50'].includes(s)) {
        setPromotionSelection(s);
        setCustomVoucherAmount('');
        return;
      }
    }
    if (vt === 'nominal' && (disc > 0 || (!Number.isNaN(val) && val > 0))) {
      const amt = disc > 0 ? disc : val;
      setPromotionSelection('custom');
      setCustomVoucherAmount(String(Math.round(amt)));
      return;
    }
  }, [isOpen, loadedTransactionInfo]);

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
      case 'percent_10':
        return { type: 'percent' as const, value: 10, label: '10%', discount: Math.round(orderTotal * 0.1) };
      case 'percent_15':
        return { type: 'percent' as const, value: 15, label: '15%', discount: Math.round(orderTotal * 0.15) };
      case 'percent_20':
        return { type: 'percent' as const, value: 20, label: '20%', discount: Math.round(orderTotal * 0.2) };
      case 'percent_25':
        return { type: 'percent' as const, value: 25, label: '25%', discount: Math.round(orderTotal * 0.25) };
      case 'percent_30':
        return { type: 'percent' as const, value: 30, label: '30%', discount: Math.round(orderTotal * 0.3) };
      case 'percent_35':
        return { type: 'percent' as const, value: 35, label: '35%', discount: Math.round(orderTotal * 0.35) };
      case 'percent_50':
        return { type: 'percent' as const, value: 50, label: '50%', discount: Math.round(orderTotal * 0.5) };
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
  const promotionsDisabled = false;
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

    if (activeInput === 'voucher' && promotionSelection === 'custom') {
      setCustomVoucherAmount(prev => updateAmountString(prev, value, orderTotal));
      return;
    }

    // Amount input, or voucher inactive (e.g. just switched) – route to amount
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

  const handleClose = async () => {
    if (loadedTransactionInfo?.transactionId && businessId) {
      const api = getElectronAPI();
      if (api?.localDbUpdateTransactionVoucher) {
        const voucherType = promotionSelection === 'none' ? 'none' : promotionDetails.type;
        const voucherValue = promotionDetails.type === 'percent' ? (promotionDetails.value ?? null)
          : promotionDetails.type === 'nominal' ? (promotionDetails.value ?? null)
            : promotionDetails.type === 'free' ? 100 : null;
        const voucherLabel = promotionDetails.label || null;
        try {
          await api.localDbUpdateTransactionVoucher(loadedTransactionInfo.transactionId, {
            voucher_discount: voucherDiscount,
            voucher_type: voucherType,
            voucher_value: voucherValue,
            voucher_label: voucherLabel,
            final_amount: finalTotal,
          });
        } catch (e) {
          console.warn('Failed to persist voucher on modal close:', e);
        }
      }
    }
    onClose();
  };

  const handleDebitModalClose = () => {
    setShowDebitModal(false);
    setBankError('');
    setCardNumberError('');
    setShowBankDropdown(false);
    setShowOtherBanks(false);
    setOtherBankSearchTerm('');
  };

  const handleDebitModalSave = () => {
    if (!bankId) {
      setBankError('Pilih bank terlebih dahulu');
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

    // Validate debit: only bank selection is required
    if (selectedPaymentMethod === 'debit') {
      if (!bankId) {
        setBankError('Pilih bank terlebih dahulu');
        setShowDebitModal(true);
        return;
      }
      setBankError('');
      setCardNumberError('');
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
      // Calculate received value
      const receivedVal = parseFloat(amountReceived.replace(/\./g, '').replace(',', '.')) || 0;
      const changeVal = Math.max(0, receivedVal - finalTotal);

      // Prepare transaction data
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

      // Use existing transaction ID if in "lihat" mode, otherwise generate new one
      let transactionId = '';
      if (loadedTransactionInfo?.transactionId) {
        // "Lihat" mode: use existing transaction ID
        transactionId = loadedTransactionInfo.transactionId;
        console.log('📝 [PAYMENT] Using existing transaction ID from "lihat" mode:', transactionId);
      } else {
        // New order: generate 19-digit numeric UUID
        if (window.electronAPI?.generateNumericUuid) {
          const uuidResult = await window.electronAPI.generateNumericUuid(businessId);
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
      }

      const transactionData = {
        id: transactionId,
        business_id: businessId,
        user_id: user?.id ? parseInt(user.id) : 1, // Get user ID from auth context
        waiter_id: waiterId || null,
        payment_method: selectedPaymentMethod,
        pickup_method: finalPickupMethod,
        total_amount: orderTotal,
        voucher_discount: voucherDiscount,
        voucher_type: voucherTypeForPayload,
        voucher_value: voucherValueForPayload,
        voucher_label: voucherLabelForPayload,
        final_amount: finalTotal,
        amount_received: receivedVal,
        change_amount: changeVal,
        status: 'paid',
        created_at: new Date().toISOString(),
        note: null, // Add fields to match full schema
        bank_name: selectedPaymentMethod === 'debit' ? (banks.find(b => b.id.toString() === bankId)?.bank_name || null) : null,
        contact_id: null, // Will be used when contact book is integrated
        customer_name: trimmedCustomerName || null,
        customer_unit: customerUnit ? parseInt(customerUnit) : (customerUnitNumber || null),
        bank_id: selectedPaymentMethod === 'debit' && bankId ? parseInt(bankId) : null,
        card_number: cardNumber || null,
        cl_account_id: null,
        cl_account_name: selectedPaymentMethod === 'cl' ? (trimmedCustomerName || null) : null,
        transaction_type: transactionType,
        payment_method_id: 1 // Will be updated from DB lookup
      };

      // 2. SAVE & QUEUE TO LOCAL DATABASE (SOURCE OF TRUTH)
      const electronAPI = getElectronAPI();

      if (electronAPI) {
        // Get payment method ID from local database
        try {
          const paymentMethods = await electronAPI.localDbGetPaymentMethods?.();
          if (Array.isArray(paymentMethods)) {
            const paymentMethod = (paymentMethods as PaymentMethodRow[]).find((pm) => pm.code === selectedPaymentMethod);
            if (paymentMethod) {
              transactionData.payment_method_id = paymentMethod.id;
            } else {
              console.warn('⚠️ Payment method not found in local DB, defaulting to cash (ID: 1)');
            }
          }
        } catch (error) {
          console.error('❌ Failed to get payment methods from local DB:', error);
        }

        // For existing transactions (lihat mode), fetch and update existing transaction
        let localTransactionData: Record<string, unknown>;
        if (loadedTransactionInfo?.transactionId) {
          // Fetch existing transaction to preserve existing data
          const allTransactions = await electronAPI.localDbGetTransactions?.(businessId, 10000);
          const transactionsArray = Array.isArray(allTransactions) ? allTransactions as Record<string, unknown>[] : [];
          const existingTransaction = transactionsArray.find((tx) => 
            tx.uuid_id === loadedTransactionInfo.transactionId || tx.id === loadedTransactionInfo.transactionId
          ) as Record<string, unknown> | undefined;

          if (existingTransaction) {
            // Update existing transaction with payment info
            // Preserve waiter_id from existing transaction when waiterId not provided (e.g. after Simpan Order
            // we clear selectedWaiterId; Lihat does not restore it, so transactionData.waiter_id would overwrite with null)
            // Always set sync_status: 'pending' so the completed transaction is queued for upload to salespulse;
            // we must not inherit existingTransaction.sync_status (e.g. 'synced') or the row would never show in
            // "Data offline yang akan diunggah" or getUnsynced.
            localTransactionData = {
              ...existingTransaction,
              ...transactionData,
              id: loadedTransactionInfo.transactionId, // Preserve original ID
              uuid_id: loadedTransactionInfo.transactionId, // Preserve original UUID
              status: 'completed', // Update status to completed (removes from active orders)
              updated_at: new Date().toISOString(),
              waiter_id: (waiterId != null && waiterId !== undefined) ? waiterId : (existingTransaction.waiter_id ?? null),
              sync_status: 'pending',
              shift_uuid: null, // Set below from current active shift (transaction saved to shift when paid)
            };
            try {
              if (electronAPI.localDbGetActiveShift && businessId) {
                const userId = user?.id ? parseInt(String(user.id)) : 0;
                const activeShiftRes = await electronAPI.localDbGetActiveShift(userId, businessId);
                const shiftUuid = (activeShiftRes as { shift?: { uuid_id?: string } })?.shift?.uuid_id;
                if (shiftUuid) {
                  localTransactionData.shift_uuid = shiftUuid;
                }
              }
            } catch (err) {
              console.warn('Failed to get active shift for existing transaction payment:', err);
            }
            console.log('📝 [PAYMENT] Updating existing transaction:', loadedTransactionInfo.transactionId);
          } else {
            // Fallback: create new transaction if existing not found - bind to current active shift
            localTransactionData = {
              ...transactionData,
              receipt_number: null,
              sync_status: 'pending',
            };
            try {
              if (electronAPI.localDbGetActiveShift && businessId) {
                const userId = user?.id ? parseInt(String(user.id)) : 0;
                const activeShiftRes = await electronAPI.localDbGetActiveShift(userId, businessId);
                const shiftUuid = (activeShiftRes as { shift?: { uuid_id?: string } })?.shift?.uuid_id;
                if (shiftUuid) {
                  localTransactionData.shift_uuid = shiftUuid;
                }
              }
            } catch (err) {
              console.warn('Failed to get active shift for payment fallback:', err);
            }
            console.warn('⚠️ [PAYMENT] Existing transaction not found, creating new one');
          }
        } else {
          // New transaction (direct Bayar) - bind to current active shift
          localTransactionData = {
            ...transactionData,
            receipt_number: null, // Initial local save has no receipt number yet
            sync_status: 'pending',
          };
          try {
            if (electronAPI.localDbGetActiveShift && businessId) {
              const userId = user?.id ? parseInt(String(user.id)) : 0;
              const activeShiftRes = await electronAPI.localDbGetActiveShift(userId, businessId);
              const shiftUuid = (activeShiftRes as { shift?: { uuid_id?: string } })?.shift?.uuid_id;
              if (shiftUuid) {
                localTransactionData.shift_uuid = shiftUuid;
              }
            }
          } catch (error) {
            console.warn('Failed to get active shift for payment:', error);
          }
        }

        // For existing transactions (lihat mode), fetch existing items to get their uuid_id, production_status, and waiter_id
        // This prevents duplicates when paying - we'll update existing items instead of creating new ones
        const existingItemsMap = new Map<number, string>(); // transactionItemId -> uuid_id
        const existingItemsProductionStatusMap = new Map<number, string | null>(); // transactionItemId -> production_status
        const existingItemsWaiterIdMap = new Map<number, number | null>(); // transactionItemId -> waiter_id (who added this item)
        if (loadedTransactionInfo?.transactionId) {
          try {
            const existingItems = await electronAPI.localDbGetTransactionItems?.(transactionId);
            const existingItemsArray = Array.isArray(existingItems) ? existingItems as Record<string, unknown>[] : [];
            existingItemsArray.forEach((item: Record<string, unknown>) => {
              const itemId = typeof item.id === 'number' ? item.id : (typeof item.id === 'string' ? parseInt(item.id, 10) : null);
              const itemUuidId = typeof item.uuid_id === 'string' ? item.uuid_id : (item.uuid_id ? String(item.uuid_id) : null);
              const productionStatus = typeof item.production_status === 'string' ? item.production_status : (item.production_status === null ? null : null);
              const waiterIdFromItem = typeof item.waiter_id === 'number' ? item.waiter_id : (typeof item.waiter_id === 'string' ? parseInt(String(item.waiter_id), 10) : null);
              if (itemId && itemUuidId) {
                existingItemsMap.set(itemId, itemUuidId);
                existingItemsProductionStatusMap.set(itemId, productionStatus);
                existingItemsWaiterIdMap.set(itemId, waiterIdFromItem ?? null);
              }
            });
            console.log('🔍 [PAYMENT] Found existing items:', existingItemsMap.size, 'items with uuid_id');
            console.log('🔍 [PAYMENT] Production statuses:', Array.from(existingItemsProductionStatusMap.entries()).map(([id, status]) => `Item ${id}: ${status || 'null'}`));
          } catch (error) {
            console.warn('⚠️ [PAYMENT] Failed to fetch existing items:', error);
          }
        }

        const transactionItems = cartItems.map(item => {
          // Determine base price depending on platform when online
          let basePrice = item.product.harga_jual;
          if (isOnline && selectedOnlinePlatform) {
            switch (selectedOnlinePlatform) {
              case 'qpon': basePrice = item.product.harga_qpon || basePrice; break;
              case 'gofood': basePrice = item.product.harga_gofood || basePrice; break;
              case 'grabfood': basePrice = item.product.harga_grabfood || basePrice; break;
              case 'shopeefood': basePrice = item.product.harga_shopeefood || basePrice; break;
              case 'tiktok': basePrice = item.product.harga_tiktok || basePrice; break;
            }
          }

          let itemPrice = basePrice;
          itemPrice += sumCustomizationPrice(item.customizations);
          itemPrice += calculateBundleCustomizationCharge(item.bundleSelections);

          // For existing items (from loaded transaction), use their existing uuid_id to prevent duplicates
          // For new items, generate a new UUID
          const itemTransactionIdRaw = (item as { transactionItemId?: number | string }).transactionItemId;
          const itemTransactionId = typeof itemTransactionIdRaw === 'number' ? itemTransactionIdRaw : (typeof itemTransactionIdRaw === 'string' ? parseInt(itemTransactionIdRaw, 10) : null);
          const itemUuidId = itemTransactionId !== null && !isNaN(itemTransactionId) && existingItemsMap.has(itemTransactionId)
            ? existingItemsMap.get(itemTransactionId)!
            : generateTransactionItemId();

          // For existing items, preserve their production_status (they may have already been sent to kitchen/barista)
          // For new items, set production_status to null (they need to be sent)
          const existingProductionStatus = itemTransactionId !== null && !isNaN(itemTransactionId) && existingItemsProductionStatusMap.has(itemTransactionId)
            ? existingItemsProductionStatusMap.get(itemTransactionId)!
            : null; // New items get null (will be sent to kitchen/barista)

          const effectiveWaiterId = itemTransactionId != null && !isNaN(itemTransactionId) && existingItemsWaiterIdMap.has(itemTransactionId)
            ? (existingItemsWaiterIdMap.get(itemTransactionId) ?? waiterId ?? (localTransactionData as { waiter_id?: number | null }).waiter_id ?? null)
            : (waiterId ?? (localTransactionData as { waiter_id?: number | null }).waiter_id ?? null);
          return {
            id: itemTransactionId || generateTransactionItemId(), // Use existing ID if available, otherwise generate
            uuid_id: itemUuidId, // Use existing UUID if item already exists, otherwise generate new one
            transaction_id: 0, // Will be set by database based on uuid_transaction_id
            uuid_transaction_id: transactionId, // Link to transaction by UUID
            product_id: item.product.id,
            quantity: item.quantity,
            unit_price: itemPrice,
            total_price: itemPrice * item.quantity,
            customizations: item.customizations || null,
            custom_note: item.customNote || null,
            bundle_selections_json: item.bundleSelections ? JSON.stringify(item.bundleSelections) : null,
            package_selections_json: item.packageSelections ? JSON.stringify(item.packageSelections) : null,
            created_at: transactionData.created_at,
            waiter_id: effectiveWaiterId,
            production_status: existingProductionStatus, // Preserve existing status for previously saved items, null for new items
            production_started_at: null,
            production_finished_at: null,
          };
        });

        // ============================================
        // DEBUG LOG: Payment Data Before Database Save
        // ============================================
        console.log('\n╔═══════════════════════════════════════════════════════════════════════════════════╗');
        console.log('║                    💳 PAYMENT DEBUG LOG - BEFORE DATABASE SAVE                    ║');
        console.log('╚═══════════════════════════════════════════════════════════════════════════════════╝\n');
        
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📝 TRANSACTION DATA (To be saved to database):');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(JSON.stringify(localTransactionData, null, 2));
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📋 TRANSACTION ITEMS (To be saved to database):');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Total Items: ${transactionItems.length}`);
        transactionItems.forEach((item, index) => {
          console.log(`\n[Item ${index + 1}]`);
          console.log(JSON.stringify(item, null, 2));
        });
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Save transaction to local database (Blocking but fast)
        await electronAPI.localDbUpsertTransactions?.([localTransactionData]);
        
        // Always save transaction items from cart to ensure all items (including newly added ones) are saved
        // This is important even in "lihat" mode because new items may have been added to the cart
        // The upsert will handle existing items and add new ones
        console.log('📝 [PAYMENT] Saving transaction items:', transactionItems.length, 'items');
        await electronAPI.localDbUpsertTransactionItems?.(transactionItems);

        // ============================================
        // DEBUG LOG: Confirmation After Database Save
        // ============================================
        console.log('╔═══════════════════════════════════════════════════════════════════════════════════╗');
        console.log('║                    ✅ PAYMENT DEBUG LOG - AFTER DATABASE SAVE                     ║');
        console.log('╚═══════════════════════════════════════════════════════════════════════════════════╝\n');
        console.log(`✅ Transaction ID: ${localTransactionData.id}`);
        console.log(`✅ Business ID: ${localTransactionData.business_id}`);
        console.log(`✅ User ID: ${localTransactionData.user_id}`);
        console.log(`✅ Payment Method: ${localTransactionData.payment_method} (ID: ${localTransactionData.payment_method_id})`);
        console.log(`✅ Pickup Method: ${localTransactionData.pickup_method}`);
        console.log(`✅ Total Amount: ${localTransactionData.total_amount}`);
        console.log(`✅ Final Amount: ${localTransactionData.final_amount}`);
        console.log(`✅ Amount Received: ${localTransactionData.amount_received}`);
        console.log(`✅ Change Amount: ${localTransactionData.change_amount}`);
        console.log(`✅ Voucher Discount: ${localTransactionData.voucher_discount}`);
        console.log(`✅ Voucher Type: ${localTransactionData.voucher_type || 'N/A'}`);
        console.log(`✅ Voucher Value: ${localTransactionData.voucher_value || 'N/A'}`);
        console.log(`✅ Customer Name: ${localTransactionData.customer_name || 'N/A'}`);
        console.log(`✅ Customer Unit: ${localTransactionData.customer_unit || 'N/A'}`);
        console.log(`✅ Bank Name: ${localTransactionData.bank_name || 'N/A'}`);
        console.log(`✅ Card Number: ${localTransactionData.card_number || 'N/A'}`);
        console.log(`✅ Transaction Type: ${localTransactionData.transaction_type}`);
        console.log(`✅ Created At: ${localTransactionData.created_at}`);
        console.log(`✅ Items Saved: ${transactionItems.length} item(s)`);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Check if we should send items to kitchen/barista
        // Only send items that haven't been sent before (production_status is null)
        // If transaction was previously saved with "Simpan Order", items may have already been sent
        const shouldSendToKitchen = !loadedTransactionInfo || 
          transactionItems.some(item => {
            // Check if this item was already sent (has production_status set)
            const itemTransactionId = typeof item.id === 'string' ? parseInt(item.id, 10) : (typeof item.id === 'number' ? item.id : null);
            if (itemTransactionId && existingItemsProductionStatusMap.has(itemTransactionId)) {
              const existingStatus = existingItemsProductionStatusMap.get(itemTransactionId);
              // If item has production_status set (not null), it was already sent
              return existingStatus === null;
            }
            // New items (not in existingItemsProductionStatusMap) should be sent
            return true;
          });

        // Broadcast order (Fire and forget, but keep promise for error logging)
        // Only create and send orderData if items haven't been sent before
        if (shouldSendToKitchen) {
          // Get all products to retrieve category1_id
          const allProducts = await electronAPI.localDbGetAllProducts?.();
          const productsMap = new Map<number, { id: number; category1_id?: number | null; category1_name?: string | null; kategori?: string | null; [key: string]: unknown }>();
          if (Array.isArray(allProducts)) {
            allProducts.forEach((p: unknown) => {
              if (p && typeof p === 'object' && 'id' in p && typeof (p as { id: unknown }).id === 'number') {
                const product = p as { id: number; category1_id?: number | null; category1_name?: string | null; kategori?: string | null; [key: string]: unknown };
                productsMap.set(product.id, product);
              }
            });
          }

          // Helper function to map category1_name to category1_id
          const mapCategoryNameToId = (categoryName: string | null | undefined): number | null => {
            if (!categoryName) return null;
            const name = categoryName.toLowerCase().trim();
            if (name === 'makanan' || name === 'food') return 1;
            if (name === 'minuman' || name === 'drinks' || name === 'drink') return 2;
            if (name === 'dessert') return 3;
            if (name === 'bakery') return 5;
            return null;
          };

          // Filter items to only include those that haven't been sent (production_status is null)
          const itemsToSend = transactionItems.filter(item => {
            const itemTransactionId = typeof item.id === 'string' ? parseInt(item.id, 10) : (typeof item.id === 'number' ? item.id : null);
            if (itemTransactionId && existingItemsProductionStatusMap.has(itemTransactionId)) {
              const existingStatus = existingItemsProductionStatusMap.get(itemTransactionId);
              // Only send items that haven't been sent before (production_status is null)
              return existingStatus === null;
            }
            // New items should be sent
            return true;
          });

          console.log(`📦 [PAYMENT] Sending ${itemsToSend.length} item(s) to kitchen/barista (${transactionItems.length - itemsToSend.length} already sent)`);

          const orderData = {
          transactionId: transactionData.id,
          receiptNumber: 0,
          businessId: businessId,
          items: itemsToSend.map(item => {
            const product = productsMap.get(item.product_id);
            const productName = cartItems.find(p => p.product.id === item.product_id)?.product.nama || 'Unknown Product';
            
            // Try to get category1_id, with fallback to category1_name/kategori mapping
            let category1_id: number | null = null;
            if (product) {
              // First try direct category1_id
              if (product.category1_id !== null && product.category1_id !== undefined && typeof product.category1_id === 'number') {
                category1_id = product.category1_id;
                console.log(`✅ [DEBUG] Product ID ${item.product_id} (${productName}) has direct category1_id: ${category1_id}`);
              } else {
                // Fallback: map from category1_name or kategori (local DB uses 'kategori' field)
                const categoryName = (product.category1_name || product.kategori) as string | null | undefined;
                console.log(`🔍 [DEBUG] Product ID ${item.product_id} (${productName}) - checking category fields:`, {
                  category1_id: product.category1_id,
                  category1_name: product.category1_name,
                  kategori: product.kategori,
                  resolvedName: categoryName
                });
                
                category1_id = mapCategoryNameToId(categoryName);
                
                if (category1_id === null) {
                  console.warn(`⚠️ [DEBUG] Product ID ${item.product_id} (${productName}) has no category1_id and category name "${categoryName}" could not be mapped. Available fields:`, {
                    id: product.id,
                    category1_id: product.category1_id,
                    category1_name: product.category1_name,
                    kategori: product.kategori,
                    allKeys: Object.keys(product)
                  });
                } else {
                  console.log(`✅ [DEBUG] Product ID ${item.product_id} (${productName}) mapped "${categoryName}" → category1_id: ${category1_id}`);
                }
              }
            } else {
              console.warn(`⚠️ [DEBUG] Product ID ${item.product_id} (${productName}) not found in productsMap`);
            }
            
            return {
              itemId: item.id,
              productId: item.product_id,
              productName: productName,
              category1_id: category1_id ?? 0, // Default to 0 if null (will be skipped in routing)
              quantity: item.quantity,
              unitPrice: item.unit_price,
              totalPrice: item.total_price,
              customNote: item.custom_note || undefined,
              bundleSelections: item.bundle_selections_json ? JSON.parse(item.bundle_selections_json) : undefined,
              packageSelections: item.package_selections_json ? JSON.parse(item.package_selections_json) : undefined,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              customizations: item.customizations as unknown as any, // Cast to any to bypass strict type mismatch in IPC
              status: 'preparing' as const
            };
          }),
          createdAt: transactionData.created_at,
          customerName: transactionData.customer_name || undefined,
          customerUnit: transactionData.customer_unit || undefined,
          pickupMethod: transactionData.pickup_method as 'dine-in' | 'take-away'
        };
        
        // Debug: Check productsMap size
        console.log(`🔍 [DEBUG] ProductsMap size: ${productsMap.size}, Transaction items: ${transactionItems.length}`);
        
        // Detailed logging for debugging
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📦 [TRANSACTION] Broadcasting order #${orderData.transactionId}`);
        console.log(`   Receipt: #${orderData.receiptNumber || 0} | Customer: ${orderData.customerName || 'N/A'} | Pickup: ${orderData.pickupMethod}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        // Check for items with invalid category1_id (valid: 1=Makanan, 2=Minuman, 3=Dessert, 5=Bakery)
        const itemsWithInvalidCategory = orderData.items.filter(item => 
          item.category1_id === 0 || 
          item.category1_id === null || 
          (item.category1_id !== 1 && item.category1_id !== 2 && item.category1_id !== 3 && item.category1_id !== 5)
        );
        if (itemsWithInvalidCategory.length > 0) {
          console.warn(`⚠️ [WARNING] ${itemsWithInvalidCategory.length} item(s) have invalid category1_id and will NOT be sent to any display:`);
          itemsWithInvalidCategory.forEach(item => {
            console.warn(`   - ${item.productName} (Product ID: ${item.productId}, category1_id: ${item.category1_id})`);
          });
        }
        
        orderData.items.forEach((item, index) => {
          let destination = '❓ UNKNOWN';
          let categoryInfo = '(Kategori tidak diketahui)';
          if (item.category1_id === 1) {
            destination = '🍳 DAPUR';
            categoryInfo = '(Makanan)';
          } else if (item.category1_id === 2) {
            destination = '☕ BARISTA';
            categoryInfo = '(Minuman)';
          } else if (item.category1_id === 3) {
            destination = '☕ BARISTA';
            categoryInfo = '(Dessert)';
          } else if (item.category1_id === 5) {
            destination = '🍳 DAPUR';
            categoryInfo = '(Bakery)';
          }
          
          console.log(`\n   [Item ${index + 1}] ${item.productName} x${item.quantity} → ${destination} ${categoryInfo}`);
          if (item.category1_id === 0 || item.category1_id === null) {
            console.warn(`      ⚠️  This item will NOT be sent to any display because category1_id is invalid!`);
          }
          
          // Log customizations
          if (item.customizations && Array.isArray(item.customizations) && item.customizations.length > 0) {
            console.log(`      🎨 Customizations:`);
            item.customizations.forEach((customization: unknown, custIdx: number) => {
              if (customization && typeof customization === 'object' && 'customization_name' in customization) {
                const cust = customization as { customization_name: string; selected_options?: Array<{ option_name: string; price_adjustment?: number }> };
                const options = cust.selected_options?.map(opt => {
                  const price = opt.price_adjustment && opt.price_adjustment !== 0 ? ` (+${opt.price_adjustment})` : '';
                  return `${opt.option_name}${price}`;
                }).join(', ') || 'N/A';
                console.log(`         ${custIdx + 1}. ${cust.customization_name}: ${options}`);
              }
            });
          }
          
          // Log custom note
          if (item.customNote && item.customNote.trim()) {
            console.log(`      📝 Custom Note: "${item.customNote}"`);
          }
          
          // Log bundle selections if any
          if (item.bundleSelections && Array.isArray(item.bundleSelections) && item.bundleSelections.length > 0) {
            console.log(`      📦 Bundle Selections:`);
            item.bundleSelections.forEach((bundle: unknown, bundleIdx: number) => {
              if (bundle && typeof bundle === 'object' && 'category2_name' in bundle) {
                const b = bundle as { category2_name: string; selectedProducts?: Array<{ product: { nama: string }; quantity?: number }> };
                const products = b.selectedProducts?.map(sp => `${sp.product.nama}${sp.quantity && sp.quantity > 1 ? ` x${sp.quantity}` : ''}`).join(', ') || 'N/A';
                console.log(`         ${bundleIdx + 1}. ${b.category2_name}: ${products}`);
              }
            });
          }
        });
        } else {
          console.log('📦 [PAYMENT] Skipping kitchen/barista broadcast - all items were already sent when transaction was saved with "Simpan Order"');
        }

        // 3. OPTIMISTIC UI UPDATE - CLOSE MODAL IMMEDIATELY
        setIsProcessing(false);
        onPaymentComplete();
        onClose();
        setShowConfirmation(false);

        // 4. TRIGGER BACKGROUND SYNC (FIRE AND FORGET)
        setTimeout(() => {
          const isOnline = offlineSyncService.getStatus().isOnline;
          if (isOnline) {
            smartSyncService.forceSync().catch(err => console.warn('Background sync trigger failed:', err));
          }
        }, 100);

        // 5. PRINTING LOGIC (Run after UI close)
        // Note: Using a timeout to ensure it runs out-of-band of the render cycle
        setTimeout(async () => {
          // Check for Single Printer Mode setting
          let singlePrinterModeEnabled = false;
          let printer2AuditLogChance: number | null = null;
          try {
            const configsRaw = await window.electronAPI?.localDbGetPrinterConfigs?.();
            if (Array.isArray(configsRaw)) {
              type PrinterConfig = { printer_type?: string; extra_settings?: string | Record<string, unknown> | null };
              (configsRaw as PrinterConfig[]).forEach((config) => {
                if (config?.printer_type === 'singlePrinterMode' && config?.extra_settings) {
                  try {
                    const extra = typeof config.extra_settings === 'string'
                      ? JSON.parse(config.extra_settings)
                      : config.extra_settings;
                    if (extra && typeof extra === 'object' && typeof extra.enabled === 'boolean') {
                      singlePrinterModeEnabled = extra.enabled;
                    }
                    // Load printer2AuditLogChance if present
                    if (extra && typeof extra === 'object' && 'printer2AuditLogChance' in extra) {
                      const chance = (extra as { printer2AuditLogChance?: number | null }).printer2AuditLogChance;
                      if (typeof chance === 'number' && chance >= 0 && chance <= 100) {
                        printer2AuditLogChance = chance;
                      }
                    }
                  } catch (parseError) {
                    console.warn('⚠️ Failed to parse singlePrinterMode extra_settings:', parseError);
                  }
                }
              });
            }
          } catch (configError) {
            console.warn('⚠️ Failed to load singlePrinterMode setting, checking localStorage:', configError);
            // Fallback to localStorage
            try {
              const savedMode = localStorage.getItem('single-printer-mode');
              singlePrinterModeEnabled = savedMode === 'true';
            } catch (localStorageError) {
              console.warn('⚠️ Failed to load singlePrinterMode from localStorage:', localStorageError);
            }
          }
          
          // Helper function to determine which audit log to use when Single Printer Mode + Randomization is enabled
          // This function is called once per transaction to ensure consistent randomization
          let randomizationResult: boolean | null = null;
          const shouldLogToPrinter2Audit = (): boolean => {
            if (!singlePrinterModeEnabled || printer2AuditLogChance === null || printer2AuditLogChance <= 0) {
              return false; // No randomization, use default behavior
            }
            // Only calculate once per transaction
            if (randomizationResult === null) {
              // Generate random number between 0-100 and check if it's less than the percentage
              const randomValue = Math.random() * 100;
              randomizationResult = randomValue < printer2AuditLogChance;
              console.log(`🎲 [RANDOMIZATION] Random value: ${randomValue.toFixed(2)}%, Threshold: ${printer2AuditLogChance}%, Result: ${randomizationResult ? 'Printer 2 audit log' : 'Printer 1 audit log'}`);
            }
            return randomizationResult;
          };

          // Online platform orders require 100% audit tracking on Printer 2 when Single Printer Mode is enabled
          // (see Epic: Platform-Based Printer Audit Log Routing).
          const ONLINE_PLATFORM_METHODS = new Set<PaymentMethod>(['gofood', 'grabfood', 'shopeefood', 'tiktok', 'qpon']);
          const isOnlinePlatformTransaction =
            ONLINE_PLATFORM_METHODS.has(selectedPaymentMethod) ||
            (isOnline && !!selectedOnlinePlatform);
          const forcePrinter2AuditForPlatform = singlePrinterModeEnabled && isOnlinePlatformTransaction;
          
          // Determine user-selected print targets (original target for database tracking)
          const originalTarget = target;
          const shouldPrintReceipt = target === 'receipt';
          const shouldPrintReceiptize = target === 'receiptize';
          
          // Override printing behavior if Single Printer Mode is enabled
          // Database will still track original printer assignment, but all printing goes to Printer 1
          let actualPrintReceipt = shouldPrintReceipt;
          let actualPrintReceiptize = shouldPrintReceiptize;
          
          if (singlePrinterModeEnabled) {
            // In single printer mode, always print to Printer 1
            // But keep original target for database tracking
            actualPrintReceipt = true; // Always print to Printer 1
            actualPrintReceiptize = false; // Never print to Printer 2
            console.log(`🖨️ [SINGLE PRINTER MODE] Enabled - All printing will go to Printer 1. Original target: ${originalTarget}`);
          }

          // Fetch global display counter (used to hide multiple printers)
          let globalCounter = 1;
          if (window.electronAPI?.getPrinterCounter) {
            try {
              const globalCounterResult = await window.electronAPI.getPrinterCounter('globalPrinter', businessId, true);
              if (isCounterResponse(globalCounterResult) && globalCounterResult.success === true && typeof globalCounterResult.counter === 'number' && globalCounterResult.counter > 0) {
                globalCounter = globalCounterResult.counter;
                console.log(`✅ Global printer counter retrieved: ${globalCounter}`);
              } else {
                console.warn('⚠️ Failed to retrieve global printer counter:', globalCounterResult);
              }
            } catch (counterError) {
              console.warn('⚠️ Failed to increment global printer counter:', counterError);
            }
          }

          // Prepare receipt data for printing
          const receiptNumber = transactionData.id; // Use transaction ID as receipt number
          // Fetch products for package breakdown category lookups
          const allProductsForReceipt = await electronAPI.localDbGetAllProducts?.();
          const productsMapForReceipt = new Map<number, { id: number; category1_id?: number | null; category1_name?: string | null; [key: string]: unknown }>();
          if (Array.isArray(allProductsForReceipt)) {
            allProductsForReceipt.forEach((p: unknown) => {
              if (p && typeof p === 'object' && 'id' in p && typeof (p as { id: unknown }).id === 'number') {
                const product = p as { id: number; category1_id?: number | null; category1_name?: string | null; [key: string]: unknown };
                productsMapForReceipt.set(product.id, product);
              }
            });
          }
          const getTableNumber = () => {
            // Extract table number from receipt number
            if (typeof receiptNumber === 'string') {
              // Assuming transactionId might contain a table number or can be mapped
              // For now, just use a default or part of the ID
              return receiptNumber.slice(-2); // Last two digits as a placeholder
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

            // Send plain product name only; note/customizations go in custom_note/customizations
            // so the backend can show them only when template "show note" is enabled.
            const itemName = item.product.nama;
            const productWithCat = item.product as { category1_id?: number | null; category1_name?: string | null };
            const category1Id = productWithCat.category1_id ?? null;
            let category1Name = productWithCat.category1_name ?? null;
            // Package main row: route to _other so it doesn't displace real categories from {{itemsCategory1}}/{{itemsCategory2}}
            const hasPackageSelections = item.packageSelections && item.packageSelections.length > 0;
            const rawPkgForMain = (item as { package_selections_json?: string }).package_selections_json;
            if (hasPackageSelections || (typeof rawPkgForMain === 'string' && rawPkgForMain.trim())) {
              category1Name = '';
            }

            // Add main bundle item (custom_note/customizations for backend; backend shows only when show_notes is true)
            receiptItems.push({
              name: itemName,
              quantity: item.quantity,
              price: itemPrice,
              total_price: itemPrice * item.quantity,
              customNote: item.customNote || undefined,
              custom_note: item.customNote || undefined,
              customizations: item.customizations,
              category1_id: category1Id,
              category1_name: category1Name,
            });

            // Add bundle selections as sub-items
            if (item.bundleSelections && item.bundleSelections.length > 0) {
              item.bundleSelections.forEach(bundleSel => {
                bundleSel.selectedProducts.forEach(sp => {
                  // Multiply by bundle quantity and selected product quantity
                  const selectionQty =
                    typeof sp.quantity === 'number' && !Number.isNaN(sp.quantity) ? sp.quantity : 1;
                  const totalQty = item.quantity * selectionQty;

                  // Plain name only; note/customizations sent separately so backend can hide when show_notes is false
                  const subItemName = `  └ ${sp.product.nama}${selectionQty > 1 ? ` (×${selectionQty})` : ''}`;
                  const subProductWithCat = sp.product as { category1_id?: number | null; category1_name?: string | null };
                  const subCategory1Id = subProductWithCat.category1_id ?? category1Id;
                  const subCategory1Name = subProductWithCat.category1_name ?? category1Name;

                  const perUnitAdjustment = sumCustomizationPrice(sp.customizations);
                  const perUnitTotal = perUnitAdjustment;

                  receiptItems.push({
                    name: subItemName,
                    quantity: totalQty,
                    price: perUnitTotal,
                    total_price: perUnitTotal * totalQty,
                    customNote: sp.customNote || undefined,
                    custom_note: sp.customNote || undefined,
                    customizations: sp.customizations,
                    category1_id: subCategory1Id,
                    category1_name: subCategory1Name,
                  });
                });
              });
            }

            // Add package breakdown as sub-items (main line already pushed above)
            // Derive package selections: use packageSelections or parse package_selections_json
            const rawPkgJson = (item as { package_selections_json?: string }).package_selections_json;
            const resolvedPackageSelections: typeof item.packageSelections =
              item.packageSelections && item.packageSelections.length > 0
                ? item.packageSelections
                : (typeof rawPkgJson === 'string' && rawPkgJson.trim()
                    ? (() => {
                        try {
                          const parsed = JSON.parse(rawPkgJson) as Array<Record<string, unknown> & { product_name?: string; quantity?: number; selection_type?: string; chosen?: unknown[] }>;
                          if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
                          // Normalize: getPackageBreakdownLines only outputs lines when selection_type === 'default'
                          // or when selection_type is flexible and chosen[].quantity. Parsed JSON may lack selection_type.
                          const normalized = parsed.map((sel, idx) => {
                            if (sel.selection_type === 'default') return sel as PackageSelection;
                            if (sel.selection_type === 'flexible' && Array.isArray(sel.chosen) && sel.chosen.length > 0) return sel as PackageSelection;
                            const name = (sel.product_name ?? (sel as { nama?: string }).nama ?? '') as string;
                            const qty = typeof sel.quantity === 'number' ? sel.quantity : 0;
                            if (name || qty > 0) {
                              return { package_item_id: idx, selection_type: 'default' as const, product_id: (sel.product_id as number) ?? 0, product_name: name, quantity: qty } as PackageSelection;
                            }
                            return sel as PackageSelection;
                          });
                          return normalized as typeof item.packageSelections;
                        } catch {
                          return undefined;
                        }
                      })()
                    : undefined);

            if (resolvedPackageSelections && resolvedPackageSelections.length > 0) {
              const pkgLines = getPackageBreakdownLinesWithProductId(resolvedPackageSelections, item.quantity);
              for (const line of pkgLines) {
                const lineProduct = productsMapForReceipt.get(line.product_id);
                const lineCategory1Id = (lineProduct as { category1_id?: number | null } | undefined)?.category1_id ?? null;
                const lineCategory1Name = (lineProduct as { category1_name?: string | null } | undefined)?.category1_name ?? null;
                const lineNote = (line as { note?: string }).note?.trim() || undefined;
                const lineName = `${line.quantity}x ${line.product_name} (${item.product.nama})${lineNote ? `\nnote: ${lineNote}` : ''}`;
                receiptItems.push({
                  name: lineName,
                  quantity: line.quantity,
                  price: 0,
                  total_price: 0,
                  customNote: lineNote,
                  custom_note: lineNote,
                  customizations: undefined,
                  category1_id: lineCategory1Id,
                  category1_name: lineCategory1Name,
                });
              }
            }
          });

          // Voucher discount is shown in the receipt summary block (Discount/Voucher, Grand Total), not as a product line
          // Use saved transaction (localTransactionData) as source of truth so receipt print matches DB
          const savedVoucherDiscount = typeof (localTransactionData as Record<string, unknown>).voucher_discount === 'number'
            ? (localTransactionData as Record<string, unknown>).voucher_discount as number
            : 0;
          const savedFinalAmount = typeof (localTransactionData as Record<string, unknown>).final_amount === 'number'
            ? (localTransactionData as Record<string, unknown>).final_amount as number
            : finalTotal;
          const savedTotal = typeof (localTransactionData as Record<string, unknown>).total_amount === 'number'
            ? (localTransactionData as Record<string, unknown>).total_amount as number
            : orderTotal;

          // Get user info from auth
          const cashierName = user?.name || 'Kasir';

          // Prepare receipt print data (total = subtotal before discount; final_amount = amount after discount for template)
          const printData = {
            type: 'transaction',
            printerType: 'receiptPrinter',
            printerName: '', // Will be auto-determined from saved printer config
            business_id: transactionData.business_id, // Include business_id for fetching business name
            items: receiptItems,
            total: savedTotal, // Subtotal (Total Harga) before discount
            final_amount: savedFinalAmount, // Amount after discount (Grand Total / Pembayaran Sebenarnya)
            voucherDiscount: savedVoucherDiscount > 0 ? savedVoucherDiscount : undefined,
            voucherLabel: savedVoucherDiscount > 0 ? (String((localTransactionData as Record<string, unknown>).voucher_label ?? '') || promotionLabel || 'Voucher') : undefined,
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
            change: Math.max(0, receivedVal - finalTotal),
            date: transactionData.created_at,
            receiptNumber: transactionData.id, // Use 19-digit transaction UUID as nomor pesanan
            tableNumber: getTableNumber(),
            cashier: cashierName,
            customerName: customerName.trim() || '',
            transactionType: transactionType,
            pickupMethod: finalPickupMethod,
            globalCounter
          };

          // Variables to store printer counters for label printing
          let printer1Counter: number | undefined = undefined;
          let printer2Counter: number | undefined = undefined;

          // Get printer configs to read copies setting (cash vs non-cash)
          const isCashPayment = selectedPaymentMethod === 'cash';
          let printer1Copies = 1;
          let printer2Copies = 1;
          try {
            const configsRaw = await window.electronAPI?.localDbGetPrinterConfigs?.();
            if (Array.isArray(configsRaw)) {
              type PrinterConfig = { printer_type?: string; extra_settings?: string | Record<string, unknown> | null };
              const resolveCopies = (extra: Record<string, unknown> | null): number => {
                if (!extra || typeof extra !== 'object') return 1;
                if (isCashPayment) {
                  const c = extra.copies;
                  return typeof c === 'number' && !Number.isNaN(c) && c > 0 ? Math.min(10, Math.floor(c)) : 1;
                }
                const nc = extra.nonCashCopies;
                if (typeof nc === 'number' && !Number.isNaN(nc) && nc > 0) return Math.min(10, Math.floor(nc));
                const c = extra.copies;
                return typeof c === 'number' && !Number.isNaN(c) && c > 0 ? Math.min(10, Math.floor(c)) : 1;
              };
              (configsRaw as PrinterConfig[]).forEach((config) => {
                if (config?.printer_type === 'receiptPrinter' && config?.extra_settings) {
                  try {
                    const extra = typeof config.extra_settings === 'string'
                      ? JSON.parse(config.extra_settings) as Record<string, unknown>
                      : config.extra_settings as Record<string, unknown>;
                    printer1Copies = resolveCopies(extra);
                  } catch (parseError) {
                    console.warn('⚠️ Failed to parse Printer 1 extra_settings:', parseError);
                  }
                }
                if (config?.printer_type === 'receiptizePrinter' && config?.extra_settings) {
                  try {
                    const extra = typeof config.extra_settings === 'string'
                      ? JSON.parse(config.extra_settings) as Record<string, unknown>
                      : config.extra_settings as Record<string, unknown>;
                    printer2Copies = resolveCopies(extra);
                  } catch (parseError) {
                    console.warn('⚠️ Failed to parse Printer 2 extra_settings:', parseError);
                  }
                }
              });
            }
          } catch (configError) {
            console.warn('⚠️ Failed to load printer configs for copies setting:', configError);
          }

          // Print to Printer 1 if selected (or if Single Printer Mode is enabled)
          if (actualPrintReceipt) {
            try {
              // Get Printer 1 counter and increment
              printer1Counter = 1;
              if (window.electronAPI?.getPrinterCounter) {
                try {
                  const counterResult = await window.electronAPI.getPrinterCounter('receiptPrinter', businessId, true); // true = increment
                  if (isCounterResponse(counterResult) && counterResult.success === true && typeof counterResult.counter === 'number' && counterResult.counter > 0) {
                    printer1Counter = counterResult.counter;
                    console.log(`✅ Printer 1 (receiptPrinter) counter retrieved: ${printer1Counter}`);
                  } else {
                    console.warn('⚠️ Failed to retrieve Printer 1 counter, using default (1):', counterResult);
                    // Keep default value of 1 if retrieval fails
                  }
                } catch (counterError) {
                  console.error('❌ Error retrieving Printer 1 counter:', counterError);
                  // Keep default value of 1 if error occurs
                }
              }

              // Create printer1Data with receiptPrinter counter
              const printer1Data = {
                ...printData,
                printerType: 'receiptPrinter',
                receiptNumber: transactionData.id,
                printer1Counter: printer1Counter, // Receipt printer daily counter (only for receiptPrinter)
                printer2Counter: undefined // Explicitly clear printer2Counter for Printer 1
              };
              console.log(`📋 [PRINT] Printer 1 data prepared with counter: ${printer1Counter} (transaction: ${transactionData.id})`);
              
              // Verify counter is actually set before printing
              if (typeof printer1Data.printer1Counter !== 'number' || printer1Data.printer1Counter <= 0) {
                console.error(`❌ [PRINT] ERROR: printer1Counter is invalid! Value: ${printer1Data.printer1Counter}, Type: ${typeof printer1Data.printer1Counter}`);
              }

              // Log to audit BEFORE printing (so reprint is possible even if print fails)
              // With Single Printer Mode + Randomization: randomly decide which audit log to use
              // Without randomization: use default behavior (original target determines audit log)
              try {
                let shouldLogToPrinter1 = true;
                
                if (forcePrinter2AuditForPlatform) {
                  // Platform orders must always be tracked in Printer 2 audit log for reconciliation
                  shouldLogToPrinter1 = false;
                  console.log('🖨️ [SINGLE PRINTER MODE] Online platform transaction detected → forcing Printer 2 audit log (skip Printer 1 audit log)');
                } else if (singlePrinterModeEnabled && printer2AuditLogChance !== null && printer2AuditLogChance > 0) {
                  // Randomization is enabled - randomly decide which audit log to use
                  const logToPrinter2 = shouldLogToPrinter2Audit();
                  if (logToPrinter2) {
                    // Randomization decided Printer 2 - skip logging here, will be handled in Single Printer Mode section
                    shouldLogToPrinter1 = false;
                    console.log(`🖨️ [SINGLE PRINTER MODE + RANDOMIZATION] Randomization decided Printer 2 audit log, skipping Printer 1 audit log (will log in Single Printer Mode section)`);
                  } else {
                    // Randomization decided Printer 1 - log here
                    shouldLogToPrinter1 = true;
                  }
                } else if (singlePrinterModeEnabled && originalTarget === 'receiptize') {
                  // Single Printer Mode without randomization: original target 'receiptize' → log to Printer 2 audit (handled in Single Printer Mode section)
                  shouldLogToPrinter1 = false;
                }
                
                if (shouldLogToPrinter1) {
                  // Log to Printer 1 audit
                  const logResult = await window.electronAPI?.logPrinter1Print?.(transactionData.id, printer1Counter, globalCounter);
                  if (isSuccessResponse(logResult) && !logResult.success) {
                    console.error('❌ Failed to log Printer 1 audit:', logResult?.error);
                    console.warn('⚠️ Transaction saved but audit log failed - receipt badge may not appear correctly');
                  } else if (!isSuccessResponse(logResult)) {
                    console.warn('⚠️ Failed to log Printer 1 audit: Invalid response', logResult);
                  } else {
                    console.log(`✅ [SINGLE PRINTER MODE${printer2AuditLogChance !== null && printer2AuditLogChance > 0 ? ' + RANDOMIZATION' : ''}] Logged to Printer 1 audit log`);
                  }
                } else {
                  // Skipping Printer 1 audit log - will be handled in Single Printer Mode section (for Printer 2 audit) or already handled
                  console.log(`🖨️ [SINGLE PRINTER MODE] Skipping Printer 1 audit log (will be handled in Single Printer Mode section)`);
                }
              } catch (logError) {
                console.error('❌ Error logging audit:', logError);
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

          // Printer 2 manual print if selected via confirmation dialog (only if Single Printer Mode is disabled)
          if (actualPrintReceiptize) {
            try {
              // Get Printer 2 counter and increment
              printer2Counter = 1;
              if (window.electronAPI?.getPrinterCounter) {
                try {
                  const counterResult = await window.electronAPI.getPrinterCounter('receiptizePrinter', businessId, true); // true = increment
                  if (isCounterResponse(counterResult) && counterResult.success === true && typeof counterResult.counter === 'number' && counterResult.counter > 0) {
                    printer2Counter = counterResult.counter;
                    console.log(`✅ Printer 2 (receiptizePrinter) counter retrieved: ${printer2Counter}`);
                  } else {
                    console.warn('⚠️ Failed to retrieve Printer 2 counter, using default (1):', counterResult);
                    // Keep default value of 1 if retrieval fails
                  }
                } catch (counterError) {
                  console.error('❌ Error retrieving Printer 2 counter:', counterError);
                  // Keep default value of 1 if error occurs
                }
              }

                // Create printer2Data with receiptizePrinter counter
                const printer2Data = {
                  ...printData,
                  printerType: 'receiptizePrinter',
                  receiptNumber: transactionData.id,
                  printer2Counter: printer2Counter, // Receiptize printer daily counter (only for receiptizePrinter)
                  printer1Counter: undefined // Explicitly clear printer1Counter for Printer 2
                };
                console.log(`📋 [PRINT] Printer 2 data prepared with counter: ${printer2Counter} (transaction: ${transactionData.id})`);
                console.log(`🔍 [DEBUG] printer2Data object:`, JSON.stringify({
                  printerType: printer2Data.printerType,
                  printer2Counter: printer2Data.printer2Counter,
                  printer1Counter: printer2Data.printer1Counter,
                  globalCounter: printer2Data.globalCounter,
                  tableNumber: printer2Data.tableNumber
                }, null, 2));
                
                // Verify counter is actually set before printing
                if (typeof printer2Data.printer2Counter !== 'number' || printer2Data.printer2Counter <= 0) {
                  console.error(`❌ [PRINT] ERROR: printer2Counter is invalid! Value: ${printer2Data.printer2Counter}, Type: ${typeof printer2Data.printer2Counter}`);
                }

                // Log to audit FIRST (before queueing) - System POS sync requires printer audit to exist
                // This ensures the audit is in local database before the transaction is queued
                let auditLogSuccess = false;
                try {
                  const logResult = await window.electronAPI?.logPrinter2Print?.(transactionData.id, printer2Counter, 'manual', undefined, globalCounter);
                  if (isSuccessResponse(logResult) && !logResult.success) {
                    console.error('❌ Failed to log Printer 2 audit:', logResult?.error);
                    console.warn('⚠️ Transaction saved but audit log failed - receiptize badge may not appear correctly');
                  } else if (!isSuccessResponse(logResult)) {
                    console.warn('⚠️ Failed to log Printer 2 audit: Invalid response', logResult);
                  } else {
                    auditLogSuccess = true;
                    // Small delay to ensure database commit is complete before queueing
                    await new Promise(resolve => setTimeout(resolve, 100));
                  }
                } catch (logError) {
                  console.error('❌ Error logging Printer 2 audit:', logError);
                  console.warn('⚠️ Transaction saved but audit log failed - receiptize badge may not appear correctly');
                }


                // Insert transaction into system_pos database AFTER audit is saved and committed
                // System POS database is on localhost MySQL for local transaction storage
                // This ensures the printer audit exists in local database before insertion
                if (auditLogSuccess) {
                  try {
                    const insertResult = await window.electronAPI?.queueTransactionForSystemPos?.(transactionData.id);
                    if (insertResult?.success) {
                      console.log(`✅ [SYSTEM POS] Inserted transaction ${transactionData.id} into system_pos database`);
                    } else if (insertResult?.alreadyQueued) {
                      console.log(`✅ [SYSTEM POS] Transaction ${transactionData.id} already exists in system_pos`);
                    } else {
                      console.warn(`⚠️ [SYSTEM POS] Failed to insert transaction ${transactionData.id}:`, insertResult?.error);
                    }
                  } catch (insertError) {
                    console.error('❌ [SYSTEM POS] Error inserting transaction into system_pos:', insertError);
                    // Don't fail the transaction if System POS insertion fails
                  }
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
          
          // Handle Single Printer Mode: Log to Printer 2 audit if original target was 'receiptize' (even though we printed to Printer 1)
          // OR if randomization decided to log to Printer 2 audit
          if (
            singlePrinterModeEnabled &&
            (forcePrinter2AuditForPlatform || originalTarget === 'receiptize' || (printer2AuditLogChance !== null && printer2AuditLogChance > 0))
          ) {
            // Check if we should log to Printer 2 audit
            let shouldLogToPrinter2 = false;
            
            if (forcePrinter2AuditForPlatform) {
              // Platform orders must always be tracked in Printer 2 audit log for reconciliation
              shouldLogToPrinter2 = true;
            } else if (printer2AuditLogChance !== null && printer2AuditLogChance > 0) {
              // Randomization is enabled - use randomization result
              shouldLogToPrinter2 = shouldLogToPrinter2Audit();
            } else {
              // No randomization - use original target behavior
              shouldLogToPrinter2 = originalTarget === 'receiptize';
            }
            
            if (shouldLogToPrinter2) {
              // Single Printer Mode: Don't print to Printer 2, but log to Printer 2 audit for database tracking.
              // Use Printer 1 daily counter (same as receipt) and do NOT increment Printer 2 — one physical
              // printer means one strictly ordered daily sequence. Audit log choice (P1 vs P2) is tracking only.
              try {
                const counterForP2Audit = typeof printer1Counter === 'number' && printer1Counter > 0
                  ? printer1Counter
                  : 1;
                if (typeof printer1Counter !== 'number' || printer1Counter <= 0) {
                  console.warn('⚠️ [SINGLE PRINTER MODE] Printer 1 counter missing for P2 audit, using 1');
                }

                // Log to Printer 2 audit using Printer 1 counter (no Printer 2 increment)
                let auditLogSuccess = false;
                try {
                  const logResult = await window.electronAPI?.logPrinter2Print?.(transactionData.id, counterForP2Audit, 'manual', undefined, globalCounter);
                  if (isSuccessResponse(logResult) && !logResult.success) {
                    console.error('❌ Failed to log Printer 2 audit (Single Printer Mode):', logResult?.error);
                  } else {
                    auditLogSuccess = true;
                    console.log(`✅ [SINGLE PRINTER MODE${printer2AuditLogChance !== null && printer2AuditLogChance > 0 ? ' + RANDOMIZATION' : ''}] Logged to Printer 2 audit (Printer 1 counter: ${counterForP2Audit}) for database tracking`);
                  }
                } catch (logError) {
                  console.error('❌ Error logging Printer 2 audit (Single Printer Mode):', logError);
                }

                // Insert transaction into system_pos database if audit was successful
                if (auditLogSuccess) {
                  try {
                    const insertResult = await window.electronAPI?.queueTransactionForSystemPos?.(transactionData.id);
                    if (insertResult?.success) {
                      console.log(`✅ [SYSTEM POS] Inserted transaction ${transactionData.id} into system_pos database`);
                    } else if (insertResult?.alreadyQueued) {
                      console.log(`✅ [SYSTEM POS] Transaction ${transactionData.id} already exists in system_pos`);
                    } else {
                      console.warn(`⚠️ [SYSTEM POS] Failed to insert transaction ${transactionData.id}:`, insertResult?.error);
                    }
                  } catch (insertError) {
                    console.error('❌ [SYSTEM POS] Error inserting transaction into system_pos:', insertError);
                  }
                }
              } catch (error) {
                console.error('❌ Error processing Printer 2 database tracking (Single Printer Mode):', error);
              }
            } else {
              // Randomization decided Printer 1, but we're in Single Printer Mode with original target 'receiptize'
              // The Printer 1 audit logging section should have already handled this, so we skip here
              console.log(`🖨️ [SINGLE PRINTER MODE + RANDOMIZATION] Randomization decided Printer 1 audit log, skipping Printer 2 audit log`);
            }
          }

          // Print labels only if not already printed (e.g. at Simpan Order or Tambah Order)
          const txRecord = transactionData as Record<string, unknown>;
          const transactionUuid = (txRecord.uuid_id != null ? String(txRecord.uuid_id) : String(transactionData.id)) as string;
          const checkerPrintedResult = await window.electronAPI?.localDbGetTransactionCheckerPrinted?.(transactionUuid);
          const skipLabelPrint = checkerPrintedResult?.success === true && checkerPrintedResult?.checker_printed === true;

          if (!skipLabelPrint) {
          // Print labels for each order item
          try {
            // Labels use the same daily counter as the receipt. In Single Printer Mode, always use
            // Printer 1 counter (same logic as receipt) so the sequence stays strictly ordered.
            let labelCounter: number = 1;
            if (singlePrinterModeEnabled && typeof printer1Counter === 'number') {
              // Single Printer Mode: always use Printer 1 counter (do not use P2)
              labelCounter = printer1Counter;
            } else if (actualPrintReceipt && typeof printer1Counter === 'number') {
              labelCounter = printer1Counter;
            } else if (actualPrintReceiptize && typeof printer2Counter === 'number') {
              labelCounter = printer2Counter;
            } else if (!actualPrintReceipt && actualPrintReceiptize && window.electronAPI?.getPrinterCounter) {
              try {
                const counterResult = await window.electronAPI.getPrinterCounter('receiptizePrinter', businessId, false); // Don't increment
                if (isCounterResponse(counterResult) && counterResult.success === true && typeof counterResult.counter === 'number' && counterResult.counter > 0) {
                  labelCounter = counterResult.counter;
                } else {
                  console.warn('⚠️ Failed to retrieve receiptizePrinter counter for labels, using default (1):', counterResult);
                }
              } catch (counterError) {
                console.error('❌ Error retrieving receiptizePrinter counter for labels:', counterError);
              }
            }

            // Calculate total items for numbering
            // For bundles: count each selected product × quantity
            // For packages: count all package sub-items via getPackageBreakdownLines
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
                // Package product detection: resolve packageSelections or parse package_selections_json
                const rawPkgJson = (item as { package_selections_json?: string }).package_selections_json;
                const resolvedPackageSelections: typeof item.packageSelections =
                  item.packageSelections && item.packageSelections.length > 0
                    ? item.packageSelections
                    : (typeof rawPkgJson === 'string' && rawPkgJson.trim()
                        ? (() => {
                            try {
                              const parsed = JSON.parse(rawPkgJson) as Array<{ product_name?: string; quantity?: number; selection_type?: string }>;
                              return Array.isArray(parsed) && parsed.length > 0 ? parsed as typeof item.packageSelections : undefined;
                            } catch {
                              return undefined;
                            }
                          })()
                        : undefined);
                if (resolvedPackageSelections && resolvedPackageSelections.length > 0) {
                  const breakdownLines = getPackageBreakdownLines(resolvedPackageSelections, item.quantity);
                  const packageCount = breakdownLines.reduce((acc, line) => acc + line.quantity, 0);
                  return sum + packageCount;
                }
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

            // Collect all labels first, then print in batch
            const allLabels: Array<{
              printerType: string;
              counter: number;
              itemNumber: number;
              totalItems: number;
              pickupMethod: string;
              productName: string;
              customizations: string;
              customNote: string;
              orderTime: string;
              labelContinuation?: string;
            }> = [];

            for (const item of cartItems) {
              // Check if this is a bundle product
              const isBundle = item.bundleSelections && item.bundleSelections.length > 0;
              // Derive package selections: use packageSelections or parse package_selections_json (e.g. from main process or serialized cart)
              const rawPkgJson = (item as { package_selections_json?: string }).package_selections_json;
              const resolvedPackageSelections: typeof item.packageSelections =
                item.packageSelections && item.packageSelections.length > 0
                  ? item.packageSelections
                  : (typeof rawPkgJson === 'string' && rawPkgJson.trim()
                      ? (() => {
                          try {
                            const parsed = JSON.parse(rawPkgJson) as Array<{ product_name?: string; quantity?: number; selection_type?: string }>;
                            return Array.isArray(parsed) && parsed.length > 0 ? parsed as typeof item.packageSelections : undefined;
                          } catch {
                            return undefined;
                          }
                        })()
                      : undefined);
              const isPackage = !isBundle && !!resolvedPackageSelections && resolvedPackageSelections.length > 0;

              if (isBundle) {
                // For bundle products, collect labels for each selected product
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

                    // Collect one label per unit of each selected product
                    for (let qty = 0; qty < totalQty; qty++) {
                      currentItemNumber++;

                      for (let chunkIndex = 0; chunkIndex < customizationChunks.length; chunkIndex++) {
                        const isMultiLabel = customizationChunks.length > 1;
                        const labelNumber = chunkIndex + 1;
                        const totalLabels = customizationChunks.length;

                        // Prepare label data for bundle selected product
                        allLabels.push({
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
                        });
                      }
                    }
                  }
                }
              } else if (isPackage) {
                // For package products: one label per selected package sub-item (like bundle)
                const pkgLines = getPackageBreakdownLines(resolvedPackageSelections!, item.quantity);
                for (const line of pkgLines) {
                  const packageLineLabel = `    ${formatPackageLineDisplay(line.product_name, line.quantity)}`;
                  for (let qty = 0; qty < line.quantity; qty++) {
                    currentItemNumber++;
                    allLabels.push({
                      printerType: 'labelPrinter',
                      counter: labelCounter,
                      itemNumber: currentItemNumber,
                      totalItems: totalItems,
                      pickupMethod: finalPickupMethod,
                      productName: packageLineLabel,
                      customizations: '',
                      customNote: '',
                      orderTime: transactionData.created_at,
                    });
                  }
                }
              } else {
                // For regular products (non-bundle, non-package), use existing logic
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

                // Collect one label per quantity, and if customizations are split, multiple labels per unit
                for (let qty = 0; qty < item.quantity; qty++) {
                  currentItemNumber++;

                  // Collect each chunk as a separate label
                  for (let chunkIndex = 0; chunkIndex < customizationChunks.length; chunkIndex++) {
                    const isMultiLabel = customizationChunks.length > 1;
                    const labelNumber = chunkIndex + 1;
                    const totalLabels = customizationChunks.length;

                    // Prepare label data
                    allLabels.push({
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
                    });
                  }
                }
              }
            }

            // Build orderContext for checker templates that use {{waiterName}}, {{customerName}}, {{tableName}}, {{orderTime}}, {{items}}
            const escapeHtmlForChecker = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            let waiterNameForChecker = loadedTransactionInfo?.waiterName ?? '';
            if (!waiterNameForChecker && (localTransactionData as Record<string, unknown>)?.waiter_id != null) {
              try {
                const employees = await window.electronAPI?.localDbGetEmployees?.();
                const arr = Array.isArray(employees) ? employees : [];
                const waiterId = (localTransactionData as Record<string, unknown>).waiter_id as number;
                const waiter = arr.find((e: Record<string, unknown>) => (e.id as number) === waiterId || Number(e.id) === waiterId);
                if (waiter && typeof waiter.nama_karyawan === 'string') {
                  waiterNameForChecker = waiter.nama_karyawan;
                }
              } catch (_) {
                // ignore
              }
            }
            const itemCellContent = (ri: ReceiptItem) => {
              let text = ri.name;
              // Skip appending note if name already contains "\nnote:" (e.g. package sub-rows) to avoid duplicate
              const alreadyHasNoteLine = /\nnote:\s*/.test(ri.name ?? '');
              if ((ri.customNote || ri.custom_note) && !alreadyHasNoteLine) {
                text += '\nnote: ' + (ri.customNote || ri.custom_note);
              }
              if (ri.customizations && Array.isArray(ri.customizations)) {
                const opts = (ri.customizations as Array<{ selected_options?: Array<{ option_name?: string }> }>).flatMap(
                  (c) => (c.selected_options || []).map((o) => o.option_name || '')
                ).filter(Boolean);
                if (opts.length) {
                  text += '\n' + opts.join(', ');
                }
              }
              return escapeHtmlForChecker(text).replace(/\n/g, '<br/>');
            };
            /**
             * Package sub-items: subtotal 0 and name in one of:
             * - legacy indented: "    Ayam Goreng ..."
             * - legacy prefix: "(Paket...) 6 Product..."
             * - current: "2x Ayam Goreng (Paket Ayam Sedih)" (match first line only so "\nnote: ..." does not break)
             * We skip the redundant "quantityx " prefix for these on the checker.
             */
            const isPackageSubRow = (ri: ReceiptItem) => {
              if (ri.total_price !== 0) return false;
              const name = (ri.name ?? '').trimStart();
              if ((ri.name ?? '').startsWith('    ')) return true;
              if (/^\([^)]*\)\s+\d+/.test(name)) return true;
              const firstLine = name.split('\n')[0].trim();
              return /^\d+x\s+.+\s+\([^)]+\)$/.test(firstLine);
            };
            const rowHtml = (ri: ReceiptItem) => {
              const trClass = isPackageSubRow(ri) ? ' class="package-subitem"' : '';
              const displayRi = isPackageSubRow(ri) ? { ...ri, name: ri.name.trim() } : ri;
              if (isPackageSubRow(ri)) {
                return `<tr${trClass}><td>${itemCellContent(displayRi)}</td><td style="text-align: right;"></td><td style="text-align: right;"></td><td style="text-align: right;"></td></tr>`;
              }
              return `<tr${trClass}><td>${itemCellContent(displayRi)}</td><td style="text-align: right;">${ri.price ?? ''}</td><td style="text-align: right;">${ri.quantity}</td><td style="text-align: right;">${ri.total_price}</td></tr>`;
            };
            // Group by actual category (category1_name) so Section 1 = one category (e.g. Makanan), Section 2 = other (e.g. Minuman)
            const key = (ri: ReceiptItem) => (ri.category1_name ?? '').trim() || `_id_${ri.category1_id ?? 'null'}`;
            const byCategory = new Map<string, ReceiptItem[]>();
            for (const ri of receiptItems) {
              const k = key(ri);
              if (!byCategory.has(k)) byCategory.set(k, []);
              byCategory.get(k)!.push(ri);
            }
            const sortedKeys = Array.from(byCategory.keys()).filter(k => !k.startsWith('_id_')).sort();
            const otherKeys = Array.from(byCategory.keys()).filter(k => k.startsWith('_id_'));
            const allCategoryKeys = [...sortedKeys, ...otherKeys].filter((k) => {
              const items = byCategory.get(k) ?? [];
              if (items.length === 0) return false;
              const allPackageMain = items.every((ri) => ((ri.category1_name ?? '').trim() === ''));
              return !allPackageMain;
            });
            const lineHtml = (ri: ReceiptItem) =>
              isPackageSubRow(ri)
                ? `<div class="item-line package-subitem">${itemCellContent({ ...ri, name: ri.name.trim() })}</div>`
                : `<div class="item-line">${ri.quantity}x ${itemCellContent(ri)}</div>`;
            const categories = allCategoryKeys.map((catKey) => {
              const items = byCategory.get(catKey) ?? [];
              const categoryName = ((items[0]?.category1_name ?? catKey.replace(/^_id_/, '')) || 'Kategori').trim() || 'Kategori';
              const itemsHtml = items.map(lineHtml).join('');
              return { categoryName, itemsHtml };
            });
            const category1Name = categories[0]?.categoryName ?? 'Kategori 1';
            const category2Name = (categories[1]?.categoryName ?? '').trim() || '';
            const itemsCategory1 = categories[0]?.itemsHtml ?? '';
            const itemsCategory2 = categories[1]?.itemsHtml ?? '';
            const orderContextForChecker = {
              waiterName: waiterNameForChecker,
              customerName: String(loadedTransactionInfo?.customerName ?? (localTransactionData as Record<string, unknown>)?.customer_name ?? ''),
              tableName: loadedTransactionInfo?.tableName ?? '',
              orderTime: String((localTransactionData as Record<string, unknown>)?.created_at ?? transactionData.created_at ?? new Date().toISOString()),
              itemsHtml: receiptItems.map(rowHtml).join(''),
              itemsHtmlCategory1: itemsCategory1,
              itemsHtmlCategory2: itemsCategory2,
              category1Name,
              category2Name,
              categories,
            };

            // Print all labels in a single batch (use checker template when set in Settings → Template Struk → Template Label/Checker)
            // Use current logged-in business (businessId) so the template matches what the user selected for this business; not the transaction's business.
            // When checker template uses {{items}}, backend prints one order-summary slip using orderContext; otherwise prints per-item labels.
            if (allLabels.length > 0 || (orderContextForChecker.itemsHtml && orderContextForChecker.orderTime)) {
              const batchResult = await window.electronAPI?.printLabelsBatch?.({
                labels: allLabels,
                printerType: 'labelPrinter',
                business_id: businessId ?? transactionData.business_id,
                orderContext: orderContextForChecker,
                isOnlineOrder: isOnline && !!selectedOnlinePlatform
              });

              if (!isSuccessResponse(batchResult) || !batchResult.success) {
                const errorMessage = isSuccessResponse(batchResult) ? batchResult.error : undefined;
                console.error(`❌ Batch label print failed:`, errorMessage);
              } else {
                // console.log(`✅ Successfully printed ${allLabels.length} labels in batch`);
                await window.electronAPI?.localDbSetTransactionCheckerPrinted?.(transactionUuid);
              }
            }
          } catch (labelError) {
            console.error('❌ Error printing labels:', labelError);
            // Don't fail the transaction if label printing fails
          }
          }
        }, 10); // Small delay to ensure UI updates first
      } else {
        alert('Electron API not available');
        setIsProcessing(false);
        return;
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
      setShowOtherBanks(false);
      setOtherBankSearchTerm('');
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
      !bankId
    ) {
      setBankError('');
      setCardNumberError('');
      setShowDebitModal(true);
    }
    previousPaymentMethod.current = selectedPaymentMethod;
  }, [selectedPaymentMethod, bankId]);

  // Auto-set "Jumlah yang diterima" to uang pas when selecting Debit, QR, E-Wallet, or CL
  // Uses finalTotal so discount / custom nominal voucher / free are already applied
  useEffect(() => {
    if (['debit', 'qr', 'ewallet', 'cl'].includes(selectedPaymentMethod)) {
      setAmountReceived(Math.ceil(finalTotal).toString());
    }
  }, [selectedPaymentMethod, finalTotal]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setAmountReceived('');
      setCustomerName('');
      setCustomerUnit('1');
      setBankId('');
      setCardNumber('');
      setBankSearchTerm('');
      setShowBankDropdown(false);
      setShowOtherBanks(false);
      setOtherBankSearchTerm('');
      const vt = (loadedTransactionInfo?.voucher_type ?? '').toLowerCase();
      const vd = typeof loadedTransactionInfo?.voucher_discount === 'number' ? loadedTransactionInfo.voucher_discount : (typeof loadedTransactionInfo?.voucher_discount === 'string' ? parseFloat(loadedTransactionInfo.voucher_discount) : 0);
      const hasLoadedVoucher = vt === 'free' || (vt === 'percent' && (vd > 0 || loadedTransactionInfo?.voucher_value != null)) || (vt === 'nominal' && (vd > 0 || loadedTransactionInfo?.voucher_value != null));
      if (!hasLoadedVoucher) {
        setCustomVoucherAmount('');
        setPromotionSelection('none');
      }
      // Don't reset payment method if it's an online order with a selected platform
      if (!isOnline || !selectedOnlinePlatform) {
        setSelectedPaymentMethod('cash');
      }
      // Set pickup method: from loaded transaction (lihat mode), or keep take-away for online, or use cart selection
      if (isOnline) {
        setSelectedPickupMethod('take-away');
      } else if (loadedTransactionInfo?.pickupMethod) {
        setSelectedPickupMethod(loadedTransactionInfo.pickupMethod);
      } else {
        setSelectedPickupMethod(cartPickupMethod);
      }
      setActiveInput('amount');
      setIsProcessing(false);
      setShowConfirmation(false);
      setCardNumberError('');
    }
  }, [isOpen, isOnline, selectedOnlinePlatform, loadedTransactionInfo, cartPickupMethod]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-2">
        <div className="bg-white rounded-2xl w-[98vw] max-w-[1650px] h-[94vh] max-h-[900px] overflow-y-auto shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between p-6 pb-4">
            <h2 className="text-xl font-bold text-gray-900">Payment</h2>
            <button
              onClick={() => handleClose()}
              className="w-10 h-10 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
            >
              <X size={20} className="text-gray-600" />
            </button>
          </div>

          <div className="px-6 pb-6 h-full">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full min-h-0">
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
                        className={`w-full p-3 pr-10 text-base font-semibold border-2 rounded-lg text-gray-800 transition-all duration-300 cursor-text ${isCustomerNameMissing
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
                          className={`absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-0.125rem)] bg-green-100 rounded-lg shadow-sm transition-transform duration-300 ease-in-out ${selectedPickupMethod === 'dine-in' ? 'translate-x-0' : 'translate-x-full'
                            }`}
                        ></div>

                        <button
                          onClick={() => setSelectedPickupMethod('dine-in')}
                          className={`relative z-10 flex-1 py-1 px-3 rounded-md font-medium text-xs transition-colors duration-300 ${selectedPickupMethod === 'dine-in'
                            ? 'text-teal-600'
                            : 'text-gray-600 hover:text-gray-800'
                            }`}
                        >
                          DINE IN
                        </button>

                        <button
                          onClick={() => setSelectedPickupMethod('take-away')}
                          className={`relative z-10 flex-1 py-1 px-3 rounded-md font-medium text-xs transition-colors duration-300 ${selectedPickupMethod === 'take-away'
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
                        className={`w-10 h-10 rounded-lg border text-lg font-bold transition-colors ${customerUnitNumber <= 1
                          ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                          }`}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveInput('customerUnit')}
                        className={`flex-1 px-4 py-2 rounded-lg border-2 text-base font-semibold transition-all duration-300 ${activeInput === 'customerUnit'
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
                          className={`w-full px-3 py-1 rounded-full border text-xs font-medium transition-colors ${customerUnitNumber === value
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
                      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-blue-700 font-semibold uppercase tracking-wide">
                            Bank
                          </span>
                          <span className={`text-sm font-semibold ${selectedBank ? 'text-blue-900' : 'text-red-600'}`}>
                            {selectedBank?.bank_name || 'Belum dipilih'}
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
                        className={`rounded-lg border border-dashed ${trimmedCustomerName ? 'border-purple-300 bg-purple-50/60' : 'border-red-300 bg-red-50/70'
                          } p-3 text-xs`}
                      >
                        <p className="font-semibold text-gray-700">Nama pelanggan saat ini:</p>
                        <p
                          className={`mt-1 text-base font-bold ${trimmedCustomerName ? 'text-purple-800' : 'text-red-600'
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
              <div className="flex flex-col h-full min-h-0">
                <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
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
                            className={`flex-1 py-2 rounded border transition-all duration-200 ${selectedPaymentMethod === 'cash'
                              ? 'bg-teal-100 border-teal-400 text-teal-800'
                              : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                              }`}
                          >
                            <span className="font-medium text-xs">Cash</span>
                          </button>

                          <button
                            onClick={() => setSelectedPaymentMethod('debit')}
                            className={`flex-1 py-2 rounded border transition-all duration-200 ${selectedPaymentMethod === 'debit'
                              ? 'bg-teal-100 border-teal-400 text-teal-800'
                              : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                              }`}
                          >
                            <span className="font-medium text-xs">Debit</span>
                          </button>

                          <button
                            onClick={() => setSelectedPaymentMethod('qr')}
                            className={`flex-1 py-2 rounded border transition-all duration-200 ${selectedPaymentMethod === 'qr'
                              ? 'bg-teal-100 border-teal-400 text-teal-800'
                              : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                              }`}
                          >
                            <span className="font-medium text-xs">QR</span>
                          </button>

                          <button
                            onClick={() => setSelectedPaymentMethod('ewallet')}
                            className={`flex-1 py-2 rounded border transition-all duration-200 ${selectedPaymentMethod === 'ewallet'
                              ? 'bg-teal-100 border-teal-400 text-teal-800'
                              : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                              }`}
                          >
                            <span className="font-medium text-xs">E-Wallet</span>
                          </button>

                          <button
                            onClick={() => {
                              setSelectedPaymentMethod('cl');
                              // Pindahkan fokus ke input nama pelanggan karena wajib diisi
                              setActiveInput('customer');
                              // Clear promotion when CL is selected
                              if (promotionSelection !== 'none') {
                                setPromotionSelection('none');
                                setCustomVoucherAmount('');
                              }
                            }}
                            className={`flex-1 py-2 rounded border transition-all duration-200 ${selectedPaymentMethod === 'cl'
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
                    {/* Diskon & Potongan group */}
                    <div className="mt-3">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">
                          Diskon &amp; Potongan
                        </span>
                        <div className="flex-1 h-px bg-gray-300" />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {percentDiscountOptions.map(option => (
                          <button
                            key={option.id}
                            onClick={() => !promotionsDisabled && handlePromotionSelect(option.id)}
                            disabled={promotionsDisabled}
                            className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${promotionSelection === option.id && !promotionsDisabled
                              ? 'bg-green-100 border-green-400 text-green-800 shadow-sm'
                              : promotionsDisabled
                                ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'
                              }`}
                          >
                            {option.label}
                          </button>
                        ))}
                        {otherPromotionOptions.map(option => (
                          <button
                            key={option.id}
                            onClick={() => !promotionsDisabled && handlePromotionSelect(option.id)}
                            disabled={promotionsDisabled}
                            className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${promotionSelection === option.id && !promotionsDisabled
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
                            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium ${promotionsDisabled
                              ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                              : 'bg-white border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400'
                              }`}
                          >
                            <Trash2 size={14} />
                            Hapus Promo
                          </button>
                        )}
                      </div>
                      {/* Row 2: Custom Nominal + textbox blended as one control (always shown, input disabled when inactive) */}
                      <div
                        className={`flex mt-2 w-full max-w-sm overflow-hidden rounded-lg border-2 transition-colors ${
                          promotionSelection === 'custom' && activeInput === 'voucher'
                            ? 'border-green-400 ring-2 ring-green-200 ring-offset-0'
                            : promotionSelection === 'custom'
                              ? 'border-gray-300'
                              : 'border-gray-200'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => !promotionsDisabled && handlePromotionSelect('custom')}
                          disabled={promotionsDisabled}
                          className={`shrink-0 px-3 py-2.5 border-r-2 text-xs font-medium transition-colors ${
                            promotionSelection === 'custom' && !promotionsDisabled
                              ? 'bg-green-100 border-green-300 text-green-800'
                              : promotionsDisabled
                                ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                                : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          Custom Nominal
                        </button>
                        <input
                          type="text"
                          value={
                            promotionSelection === 'custom' && promotionValue && promotionValue > 0
                              ? `Rp ${promotionValue.toLocaleString('id-ID')}`
                              : ''
                          }
                          readOnly
                          disabled={promotionSelection !== 'custom'}
                          onClick={() => {
                            if (promotionSelection === 'custom' && !promotionsDisabled) {
                              setActiveInput('voucher');
                            }
                          }}
                          className={`flex-1 min-w-0 px-3 py-2.5 text-sm font-semibold bg-transparent outline-none transition-colors placeholder:text-gray-400 ${
                            promotionSelection !== 'custom'
                              ? 'text-gray-400 cursor-not-allowed bg-gray-50'
                              : activeInput === 'voucher'
                                ? 'bg-green-50 text-gray-800 cursor-pointer'
                                : 'bg-white text-gray-800 cursor-pointer hover:bg-gray-50'
                          }`}
                          placeholder="Rp 0"
                        />
                      </div>
                    </div>
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
                        className={`w-full p-3 pr-12 text-base font-semibold border-2 rounded-lg transition-all duration-300 ${selectedPaymentMethod === 'cl'
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

                </div>
                {/* Numeric Keypad - fixed position */}
                <div className="flex-shrink-0 grid grid-cols-4 gap-2 mt-4">
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
                      className={`row-span-2 p-2 rounded-lg font-medium text-xs transition-all duration-200 ${isConfirmDisabled
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
                Pilih bank untuk pembayaran debit.
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  Pilih Bank
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {POPULAR_BANK_IDS.map((id) => {
                    const bank = banks.find((b) => b.id === id);
                    const label = bank?.bank_name ?? POPULAR_BANK_LABELS[id];
                    const isSelected = bankId === id.toString();
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setBankId(id.toString());
                          setBankSearchTerm(bank?.bank_name ?? label);
                          setBankError('');
                          setShowOtherBanks(false);
                        }}
                        className={`w-full min-w-0 px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-colors ${
                          isSelected
                            ? 'border-blue-600 bg-blue-50 text-blue-800'
                            : 'border-gray-200 bg-white text-gray-800 hover:border-blue-300 hover:bg-blue-50/50'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setShowOtherBanks(!showOtherBanks)}
                    className={`w-full min-w-0 px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-colors ${
                      showOtherBanks
                        ? 'border-blue-600 bg-blue-50 text-blue-800'
                        : 'border-gray-200 bg-white text-gray-800 hover:border-blue-300 hover:bg-blue-50/50'
                    }`}
                  >
                    Lainnya
                  </button>
                </div>

                {showOtherBanks && (
                  <div className="mt-3 relative bank-dropdown">
                    <input
                      type="text"
                      value={otherBankSearchTerm}
                      onChange={(e) => {
                        setOtherBankSearchTerm(e.target.value);
                        setShowBankDropdown(true);
                      }}
                      onFocus={() => setShowBankDropdown(true)}
                      onBlur={() => setTimeout(() => setShowBankDropdown(false), 200)}
                      className={`w-full p-2 text-sm font-medium border rounded-md text-gray-800 bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-100 ${bankError ? 'border-red-400' : 'border-gray-300'}`}
                      placeholder="Cari bank..."
                    />
                    {showBankDropdown && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                        {banks
                          .filter(
                            (bank) =>
                              !POPULAR_BANK_IDS.includes(bank.id) &&
                              (bank.bank_name.toLowerCase().includes(otherBankSearchTerm.toLowerCase()) ||
                                bank.bank_code.toLowerCase().includes(otherBankSearchTerm.toLowerCase()))
                          )
                          .map((bank) => {
                            const isSelected = bankId === bank.id.toString();
                            return (
                              <div
                                key={bank.id}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setBankId(bank.id.toString());
                                  setBankSearchTerm(bank.bank_name);
                                  setBankError('');
                                }}
                                onMouseDown={(e) => e.preventDefault()}
                                className={`px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 ${isSelected ? 'bg-blue-50' : ''}`}
                              >
                                <span className="font-medium text-gray-900 text-sm">{bank.bank_name}</span>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                )}

                {bankError && (
                  <p className="mt-2 text-xs text-red-600 font-medium">{bankError}</p>
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

