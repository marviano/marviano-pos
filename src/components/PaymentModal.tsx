'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Delete } from 'lucide-react';
import TransactionConfirmationDialog from './TransactionConfirmationDialog';
import { smartSyncService } from '@/lib/smartSync';
import { offlineSyncService } from '@/lib/offlineSync';
import { generateTransactionId, generateTransactionItemId } from '@/lib/uuid';
import { useAuth } from '@/hooks/useAuth';

interface BundleSelection {
  category2_id: number;
  category2_name: string;
  selectedProducts: {
    product: {
      id: number;
      nama: string;
    };
    quantity: number;
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

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  onPaymentComplete: () => void;
  transactionType: 'drinks' | 'bakery';
  isOnline?: boolean;
  selectedOnlinePlatform?: 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' | null;
}

type PaymentMethod = 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
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
  const [printTarget, setPrintTarget] = useState<'receipt' | 'receiptize' | 'both'>('receipt');
  
  // Check if current payment method is an online platform
  const isOnlinePayment = ['gofood', 'grabfood', 'shopeefood', 'tiktok'].includes(selectedPaymentMethod);
  const [cardNumberError, setCardNumberError] = useState<string>('');
  const cardNumberRef = useRef<HTMLInputElement>(null);

  // Debug bank selection
  useEffect(() => {
    console.log('Bank ID changed:', bankId);
    console.log('Bank search term:', bankSearchTerm);
  }, [bankId, bankSearchTerm]);

  // Auto-set pickup method for online orders
  useEffect(() => {
    if (isOnline) {
      setSelectedPickupMethod('take-away');
    }
  }, [isOnline]);

  // Auto-set payment method based on selected online platform
  useEffect(() => {
    if (isOnline && selectedOnlinePlatform) {
      console.log('🔧 Setting payment method to platform:', selectedOnlinePlatform);
      setSelectedPaymentMethod(selectedOnlinePlatform as PaymentMethod);
      setSelectedPickupMethod('take-away');
    } else if (!isOnline) {
      // Reset to default for non-online orders
      console.log('🔧 Resetting payment method to cash for non-online order');
      setSelectedPaymentMethod('cash');
    }
  }, [isOnline, selectedOnlinePlatform]);
  
  // Initialize payment method when modal opens for online orders
  useEffect(() => {
    if (isOpen && isOnline && selectedOnlinePlatform) {
      console.log('🔧 Modal opened - initializing payment method to:', selectedOnlinePlatform);
      setSelectedPaymentMethod(selectedOnlinePlatform as PaymentMethod);
      setSelectedPickupMethod('take-away');
    }
  }, [isOpen, isOnline, selectedOnlinePlatform]);

  // Calculate order totals
  const getOnlinePriceForPlatform = (product: any): number | null => {
    if (!isOnline || !selectedOnlinePlatform) return null;
    switch (selectedOnlinePlatform) {
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

  const effectiveProductPrice = (product: any): number => {
    if (isOnline && selectedOnlinePlatform) {
      const p = getOnlinePriceForPlatform(product);
      if (p && p > 0) return p;
      return 0; // No fallback in online mode when platform is selected
    }
    return product.harga_jual;
  };

  const calculateOrderTotal = () => {
    return cartItems.reduce((sum, item) => {
      let itemPrice = effectiveProductPrice(item.product as any);
      
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

    // Validate amount received for all payment methods EXCEPT CL
    if (selectedPaymentMethod !== 'cl' && (!amountReceived || parseFloat(amountReceived) <= 0)) {
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
      if (finalTotal > 0 && selectedPaymentMethod !== 'cl' && receivedAmount < finalTotal) {
        alert(`Jumlah yang diterima kurang. Kurang: ${formatPrice(finalTotal - receivedAmount)}`);
        return;
      }
    } else {
      // For payments without voucher, check received amount covers the full order total
      // EXCEPT for CL payments which don't require cash payment
      if (selectedPaymentMethod !== 'cl' && receivedAmount < orderTotal) {
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

      // For online orders, force pickup_method to 'take-away'
      const finalPickupMethod = isOnline ? 'take-away' : selectedPickupMethod;
      
      console.log('📝 Transaction data:', {
        isOnline,
        selectedOnlinePlatform,
        payment_method: selectedPaymentMethod,
        pickup_method: finalPickupMethod,
        transaction_type: transactionType
      });
      
      // Generate 19-digit numeric UUID instead of random UUID
      let transactionId = '';
      if (window.electronAPI?.generateNumericUuid) {
        const uuidResult = await window.electronAPI.generateNumericUuid(14); // business_id
        if (uuidResult?.success && uuidResult?.uuid) {
          transactionId = uuidResult.uuid;
          console.log('✅ Generated numeric UUID:', transactionId);
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
        final_amount: finalTotal,
        amount_received: receivedAmount,
        change_amount: receivedAmount - finalTotal,
        status: 'completed',
        created_at: new Date().toISOString(),
        contact_id: null, // Will be used when contact book is integrated
        customer_name: customerName || null,
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
        let offlineResult = null;
        
        // Step 1: Save to online database if connected
        if (isOnline) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
            
            const response = await fetch('/api/transactions', {
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
            console.log('✅ Transaction saved to online database:', onlineResult);
          } catch (error) {
            console.error('❌ Failed to save to online database:', error);
            // Continue to offline save even if online save fails
          }
        }
        
        // Step 2: Save to offline database (always, for redundancy and offline capability)
        if (typeof window !== 'undefined' && (window as any).electronAPI) {
          // Get payment method ID from local database
          let paymentMethodId = 1; // Default to cash
          try {
            const paymentMethods = await (window as any).electronAPI.localDbGetPaymentMethods();
            const paymentMethod = paymentMethods.find((pm: any) => pm.code === selectedPaymentMethod);
            if (paymentMethod) {
              paymentMethodId = paymentMethod.id;
              console.log('✅ Found payment method ID:', paymentMethodId, 'for code:', selectedPaymentMethod);
            } else {
              console.warn('⚠️ Payment method not found in local DB, defaulting to cash (ID: 1)');
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
            final_amount: transactionData.final_amount,
            amount_received: transactionData.amount_received,
            change_amount: transactionData.change_amount,
            status: transactionData.status,
            created_at: transactionData.created_at,
            note: null,
            bank_name: selectedPaymentMethod === 'debit' ? (banks.find(b => b.id.toString() === bankId)?.bank_name || null) : null,
            contact_id: transactionData.contact_id,
            customer_name: transactionData.customer_name,
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
            
            console.log(`📝 [OFFLINE] Saving item: ${item.product.nama}, customNote: "${item.customNote}"`);
            
            return {
              id: generateTransactionItemId(), // Generate UUID for transaction item
              transaction_id: transactionData.id,
              product_id: item.product.id,
              quantity: item.quantity,
              unit_price: itemPrice,
              total_price: itemPrice * item.quantity,
              customizations_json: item.customizations || null,
              custom_note: item.customNote || null,
              bundle_selections_json: item.bundleSelections ? JSON.stringify(item.bundleSelections) : null,
              created_at: transactionData.created_at
            };
          });
          
          // Save transaction and items to local database
          await (window as any).electronAPI.localDbUpsertTransactions([sqliteTransactionData]);
          await (window as any).electronAPI.localDbUpsertTransactionItems(transactionItems);
          
          console.log('✅ Transaction saved to offline database:', sqliteTransactionData);
          offlineResult = { success: true, transaction: sqliteTransactionData };
        } else {
          throw new Error('Offline database not available');
        }
        
        // Use online result if available, otherwise use offline result
        const result = onlineResult || offlineResult;
        
        // Close confirmation dialog first
        setShowConfirmation(false);
        
        // Determine user-selected print targets
        const shouldPrintReceipt = printTarget === 'receipt';
        const shouldPrintReceiptize = printTarget === 'receiptize';

        // Get Printer 1 counter and increment only if printing to receipt printer
        let printer1Counter = 1;
        if (shouldPrintReceipt && window.electronAPI?.getPrinterCounter) {
          const counterResult = await window.electronAPI.getPrinterCounter('receiptPrinter', 14, true); // true = increment
          if (counterResult?.success) {
            printer1Counter = counterResult.counter;
            console.log(`✅ Printer 1 counter: ${printer1Counter}`);
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
        let receiptItems: any[] = [];
        
        cartItems.forEach(item => {
          // For online orders, use platform-specific price, otherwise use harga_jual
          let basePrice = item.product.harga_jual;
          
          if (isOnline && selectedOnlinePlatform) {
            switch (selectedOnlinePlatform) {
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
                const totalQty = item.quantity * sp.quantity;
                receiptItems.push({
                  name: `  └ ${sp.product.nama}${sp.quantity > 1 ? ` (×${sp.quantity})` : ''}`,
                  quantity: totalQty,
                  price: 0,
                  total_price: 0
                });
              });
            });
          }
        });

        // Append voucher discount as a negative line on the receipt when applied
        if (voucherDiscount > 0) {
          receiptItems.push({
            name: 'Diskon Voucher',
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
          printer1Counter: printer1Counter // Store counter separately for reference
        };
        
        // Print to Printer 1 if selected
        if (shouldPrintReceipt) {
          try {
            console.log('📄 Printing to Printer 1, counter:', printer1Counter);
            const printResult = await window.electronAPI?.printReceipt?.(printData);
            if (printResult?.success) {
              console.log('✅ Printer 1 printed successfully');
              try {
                await window.electronAPI?.logPrinter1Print?.(transactionData.id, printer1Counter);
              } catch (e) {
                console.warn('⚠️ Failed to log Printer 1 audit:', e);
              }
            } else {
              console.error('❌ Printer 1 failed:', printResult?.error);
            }
          } catch (printError) {
            console.error('❌ Error printing to Printer 1:', printError);
          }
        }
        
        // Printer 2 manual print if selected via confirmation dialog
        if (shouldPrintReceiptize) {
          try {
            let printer2Counter = 1;
            if (window.electronAPI?.getPrinterCounter) {
              const counterResult = await window.electronAPI.getPrinterCounter('receiptizePrinter', 14, true);
              if (counterResult?.success) {
                printer2Counter = counterResult.counter;
                console.log(`✅ Printer 2 counter: ${printer2Counter}`);
              }
            }
            await window.electronAPI?.logPrinter2Print?.(transactionData.id, printer2Counter, 'manual');
            const printer2Data = { ...printData, printerType: 'receiptizePrinter', receiptNumber: transactionData.id, printer2Counter } as any;
            await new Promise(r => setTimeout(r, 500));
            console.log('📄 Printing to Printer 2, counter:', printer2Counter);
            const print2Result = await window.electronAPI?.printReceipt?.(printer2Data);
            if (print2Result?.success) {
              console.log('✅ Printer 2 printed successfully (manual)');
            } else {
              console.error('❌ Printer 2 failed:', print2Result?.error);
            }
          } catch (print2Error) {
            console.error('❌ Error printing to Printer 2:', print2Error);
          }
        }
        
        // Print labels for each order item
        try {
          // Get the counter to use (from the selected printer)
          let labelCounter = printer1Counter;
          if (!shouldPrintReceipt && shouldPrintReceiptize && window.electronAPI?.getPrinterCounter) {
            const counterResult = await window.electronAPI.getPrinterCounter('receiptizePrinter', 14, false); // Don't increment
            if (counterResult?.success) {
              labelCounter = counterResult.counter;
            }
          }
          
          // Calculate total items for numbering
          // For bundles: count each selected product × quantity
          // For regular products: count the item quantity
          const totalItems = cartItems.reduce((sum, item) => {
            if (item.bundleSelections && item.bundleSelections.length > 0) {
              // For bundles, count all selected products
              let bundleItemCount = 0;
              for (const bundleSel of item.bundleSelections) {
                for (const selectedProduct of bundleSel.selectedProducts) {
                  bundleItemCount += selectedProduct.quantity;
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
                  const totalQty = item.quantity * selectedProduct.quantity;
                  
                  // Print one label per unit of each selected product
                  for (let qty = 0; qty < totalQty; qty++) {
                    currentItemNumber++;
                    
                    // Prepare label data for bundle selected product
                    const labelData = {
                      printerType: 'labelPrinter',
                      counter: labelCounter,
                      itemNumber: currentItemNumber,
                      totalItems: totalItems,
                      pickupMethod: finalPickupMethod,
                      productName: selectedProduct.product.nama,
                      customizations: '', // Bundle selected products don't have customizations
                      customNote: '', 
                      orderTime: transactionData.created_at,
                      labelContinuation: undefined
                    };
                    
                    // Print label with delay between prints
                    await new Promise(resolve => setTimeout(resolve, 300));
                    const labelResult = await window.electronAPI?.printLabel?.(labelData);
                    if (labelResult?.success) {
                      console.log(`✅ Bundle label ${currentItemNumber}/${totalItems} for ${selectedProduct.product.nama} printed successfully`);
                    } else {
                      console.error(`❌ Bundle label print failed:`, labelResult?.error);
                    }
                  }
                }
              }
            } else {
              // For regular products (non-bundle), use existing logic
              // Build customization text - format as xxx/xxx/xxx
              let allOptions: string[] = [];
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
                  if (labelResult?.success) {
                    console.log(`✅ Label ${currentItemNumber}/${totalItems}${isMultiLabel ? ` (part ${labelNumber}/${totalLabels})` : ''} printed successfully`);
                  } else {
                    console.error(`❌ Label print failed:`, labelResult?.error);
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
              const response = await fetch('/api/banks', {
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
            if (typeof window !== 'undefined' && (window as any).electronAPI) {
              const banks = await (window as any).electronAPI.localDbGetBanks();
              console.log('📱 [OFFLINE] Fetched banks from local database:', banks.length);
              return banks;
            } else {
              throw new Error('Offline database not available');
        }
          }
        );
        
        setBanks(banksData);
        console.log('🏦 Banks loaded:', banksData.length);
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
                        const input = document.getElementById('customer-name-input') as HTMLInputElement;
                        input?.focus();
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
                          {selectedOnlinePlatform === 'gofood' ? 'GoFood' : 
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
                    
                    {/* Voucher Amount Input - Inline with payment buttons */}
                    <div className="flex-[1.5]">
                      <input
                        type="text"
                        value={voucherAmount ? `Rp ${parseFloat(voucherAmount).toLocaleString('id-ID')}` : ''}
                        readOnly
                        disabled={!isVoucherEnabled}
                        onClick={() => isVoucherEnabled && setActiveInput('voucher')}
                        className={`w-full h-[41px] px-2 text-xs font-semibold border rounded transition-all duration-300 ${
                          !isVoucherEnabled
                            ? 'border-gray-300 bg-gray-100 text-gray-500 cursor-not-allowed opacity-50'
                            : activeInput === 'voucher' 
                            ? 'border-green-400 bg-green-50 shadow-lg shadow-green-200 animate-pulse text-gray-800 cursor-pointer' 
                            : 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-800 cursor-pointer'
                        }`}
                        placeholder="Rp 0"
                      />
                    </div>
                    </>
                    )}
                  </div>

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
                    disabled={selectedPaymentMethod === 'cl'}
                    onClick={() => selectedPaymentMethod !== 'cl' && setActiveInput('amount')}
                    className={`w-full p-3 text-base font-semibold border-2 rounded-lg transition-all duration-300 ${
                      selectedPaymentMethod === 'cl'
                        ? 'border-gray-300 bg-gray-100 text-gray-500 cursor-not-allowed opacity-50'
                        : activeInput === 'amount' 
                        ? 'border-blue-400 bg-blue-50 shadow-lg shadow-blue-200 animate-pulse text-gray-800 cursor-pointer' 
                        : 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-800 cursor-pointer'
                    }`}
                    placeholder="Rp 0"
                  />
                  </div>

                {/* Quick Amount Buttons - Show for all except CL */}
                {selectedPaymentMethod !== 'cl' && (
                <div className="mb-4">
                  <div className="grid grid-cols-2 gap-2">
                    {/* Uang Pas button - Sets exact amount */}
                    <button
                        onClick={() => {
                          // Uang Pas - Set exact amount needed
                          setAmountReceived(Math.ceil(finalTotal).toString());
                          setActiveInput('amount');
                        }}
                      className="p-2 bg-green-500 hover:bg-green-600 text-white rounded-md text-xs font-semibold transition-colors shadow-md"
                    >
                      💰 Uang Pas
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
                      (selectedPaymentMethod !== 'cl' && (!amountReceived || parseFloat(amountReceived) <= 0 || receivedAmount < finalTotal)) ||
                      (selectedPaymentMethod === 'voucher' && (voucherDiscount <= 0 || voucherDiscount > orderTotal))
                    }
                    className={`row-span-2 p-2 rounded-lg font-medium text-xs transition-all duration-200 ${
                      isProcessing || 
                      (selectedPaymentMethod !== 'cl' && (!amountReceived || parseFloat(amountReceived) <= 0 || receivedAmount < finalTotal)) ||
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
        printTarget={printTarget}
        onChangePrintTarget={setPrintTarget}
        customerName={customerName}
      />
    </>
  );
}
