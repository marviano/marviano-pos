'use client';

import { ShoppingCart, LayoutGrid, Search, X } from 'lucide-react';
import { useState, useEffect, useMemo, useRef } from 'react';
import Image from 'next/image';
import ProductCustomizationModal from './ProductCustomizationModal';
import CustomNoteModal from './CustomNoteModal';
import EditItemModal from './EditItemModal';
import PaymentModal from './PaymentModal';
import BundleSelectionModal from './BundleSelectionModal';
import PackageSelectionModal, { type PackageSelection, type PackageItemForPos, getPackageBreakdownLines } from './PackageSelectionModal';
import TableSelectionModal from './TableSelectionModal';
import WaiterSelectionModal from './WaiterSelectionModal';
import { offlineSyncService } from '@/lib/offlineSync';
import { getApiUrl } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { generateUUID } from '@/lib/uuid';
import { hasPermission } from '@/lib/permissions';
import { isSuperAdmin } from '@/lib/auth';

interface BundleItem {
  id: number;
  bundle_product_id: number;
  category2_id: number;
  category2_name?: string;
  required_quantity: number;
  display_order: number;
}

interface Product {
  id: number;
  menu_code: string;
  nama: string;
  satuan: string;
  category1_id: number | null;
  category2_id: number | null;
  category1_name: string | null;
  category2_name: string | null;
  harga_jual: number | null;
  harga_qpon?: number | null;
  harga_gofood?: number | null;
  harga_grabfood?: number | null;
  harga_shopeefood?: number | null;
  harga_tiktok?: number | null;
  image_url: string | null;
  status: string;
  is_bundle?: number | boolean;
  is_package?: number | boolean;
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

interface BundleSelection {
  category2_id: number;
  category2_name: string;
  selectedProducts: {
    key?: string;
    product: {
      id: number;
      nama: string;
      image_url: string | null;
      category2_id: number | null;
      category2_name: string | null;
    };
    customizations?: SelectedCustomization[];
    customNote?: string;
  }[];
  requiredQuantity: number;
}

interface CartItem {
  id: number;
  product: Product;
  quantity: number;
  customizations?: SelectedCustomization[];
  customNote?: string;
  bundleSelections?: BundleSelection[];
  packageSelections?: PackageSelection[];
  isLocked?: boolean; // Item from pending transaction - requires password to remove
  transactionItemId?: number; // ID of the transaction_item in database (for logging)
  transactionId?: string; // UUID of the transaction (for logging)
  tableId?: number | null; // Table ID (for logging)
  /** Waiter who added this line item (for multi-waiter display in cart) */
  waiterId?: number | null;
  waiterName?: string | null;
  waiterColor?: string | null;
  /** True for newly added items - displayed as [NEW] in lihat mode, inserted below same product */
  isNewlyAdded?: boolean;
}

interface Employee {
  id: number;
  user_id: number | null;
  business_id: number | null;
  jabatan_id: number | null;
  no_ktp: string;
  phone: string | null;
  nama_karyawan: string;
  jenis_kelamin: string;
  alamat: string | null;
  tanggal_lahir: string | null;
  tanggal_bekerja: string;
  color: string | null;
  pin: string | null;
  created_at: string;
  updated_at: string;
}

const categoryEmoji = (categoryName?: string | null) => {
  switch (categoryName) {
    case 'Bakery':
      return '🥖';
    case 'Ice Cream Cone':
      return '🍦';
    case 'Sundae':
      return '🍨';
    case 'Milk Tea':
      return '🧋';
    default:
      return '🍦';
  }
};

function ProductCardImage({
  imageUrl,
  productName,
  categoryName,
  emojiSize = 'text-2xl',
}: {
  imageUrl: string | null;
  productName: string;
  categoryName?: string | null;
  emojiSize?: string;
}) {
  const [hasError, setHasError] = useState(false);

  if (!imageUrl || hasError) {
    return (
      <span className={`text-gray-400 ${emojiSize}`}>
        {categoryEmoji(categoryName)}
      </span>
    );
  }

  // Next.js Image doesn't support custom protocols like pos-image://
  // Use regular <img> for pos-image:// URLs, Next.js Image for others
  if (imageUrl.startsWith('pos-image://')) {
    return (
      <img
        src={imageUrl}
        alt={productName}
        className="object-contain rounded-lg w-full h-full"
        onError={() => {
          setHasError(true);
        }}
      />
    );
  }

  return (
    <Image
      src={imageUrl}
      alt={productName}
      fill
      sizes="(max-width: 768px) 45vw, 200px"
      className="object-contain rounded-lg"
      unoptimized
      onError={() => {
        setHasError(true);
      }}
    />
  );
}

interface CenterContentProps {
  products: Product[];
  cartItems: CartItem[];
  setCartItems: (items: CartItem[]) => void;
  transactionType: 'drinks' | 'bakery' | 'foods' | 'packages';
  isLoadingProducts?: boolean;
  isOnline?: boolean;
  selectedOnlinePlatform?: 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' | null;
  searchQuery?: string;
  setSearchQuery?: (query: string) => void;
  loadedTransactionInfo?: {
    transactionId: string;
    tableName: string | null;
    roomName: string | null;
    customerName: string | null;
    waiterId?: number | null;
    waiterName: string | null;
    waiterColor: string | null;
    /** All distinct waiter names (transaction + item-level) for header "+N" and popover */
    waiterNamesAll?: string[];
    pickupMethod?: 'dine-in' | 'take-away';
    voucher_discount?: number;
    voucher_type?: string;
    voucher_value?: number | null;
    voucher_label?: string | null;
    customer_unit?: number | null;
  } | null;
  onReloadTransaction?: (transactionId: string) => void;
  onClearLoadedTransaction?: () => void;
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
  /** When this value changes (e.g. on New click), reset nama pelanggan and pilih waiter */
  resetCustomerAndWaiterSignal?: number;
}

export default function CenterContent({ products, cartItems, setCartItems, transactionType, isLoadingProducts = false, isOnline = false, selectedOnlinePlatform = null, searchQuery = '', setSearchQuery, loadedTransactionInfo = null, onReloadTransaction, onClearLoadedTransaction, onUnsavedChangesChange, resetCustomerAndWaiterSignal }: CenterContentProps) {
  const { user } = useAuth();
  const canAccessBayarButton = isSuperAdmin(user) || hasPermission(user, 'access_kasir_bayar_button');
  const [showCustomizationModal, setShowCustomizationModal] = useState(false);
  const [showCustomNoteModal, setShowCustomNoteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showBundleModal, setShowBundleModal] = useState(false);
  const [showPackageModal, setShowPackageModal] = useState(false);
  const [packageItemsForModal, setPackageItemsForModal] = useState<PackageItemForPos[]>([]);

  const businessId = user?.selectedBusinessId;

  if (!businessId) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700">No business selected. Please log in and select a business.</p>
      </div>
    );
  }
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedCartItem, setSelectedCartItem] = useState<CartItem | null>(null);
  const [copiedUuid, setCopiedUuid] = useState<string | null>(null);
  const [loadingProductId, setLoadingProductId] = useState<number | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showTableSelectionModal, setShowTableSelectionModal] = useState(false);
  const [bundleItems, setBundleItems] = useState<BundleItem[]>([]);
  const [customerName, setCustomerName] = useState<string>('');
  const [cuValue, setCuValue] = useState<string>('1');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [pendingLockedItemAction, setPendingLockedItemAction] = useState<{ item: CartItem; action: 'reduce' | 'delete' } | null>(null);

  // Waiter selection state
  const [currentUserEmployee, setCurrentUserEmployee] = useState<Employee | null>(null);
  const [selectedWaiterId, setSelectedWaiterId] = useState<number | null>(null);
  const [selectedWaiterName, setSelectedWaiterName] = useState<string | null>(null);
  const [selectedWaiterColor, setSelectedWaiterColor] = useState<string | null>(null);
  const [showWaiterModal, setShowWaiterModal] = useState(false);
  const [showWaiterListPopover, setShowWaiterListPopover] = useState(false);
  const waiterListPopoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showWaiterListPopover) return;
    const close = (e: MouseEvent) => {
      if (waiterListPopoverRef.current && !waiterListPopoverRef.current.contains(e.target as Node)) setShowWaiterListPopover(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showWaiterListPopover]);

  // Take away / Dine in for Simpan Order (synced from loadedTransactionInfo when in lihat mode)
  const [orderPickupMethod, setOrderPickupMethod] = useState<'dine-in' | 'take-away'>('dine-in');

  // Column count state - load from localStorage, default to 5
  const [columnCount, setColumnCount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('product-grid-columns');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (parsed >= 3 && parsed <= 7) {
          return parsed;
        }
      }
    }
    return 5;
  });

  // Save column count to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('product-grid-columns', columnCount.toString());
    }
  }, [columnCount]);

  // Track unsaved changes in "lihat" mode (items that are not locked)
  const hasUnsavedChanges = useMemo(() => {
    if (!loadedTransactionInfo) return false;
    // Check if there are any items that are not locked (new items added but not saved)
    return cartItems.some(item => !item.isLocked);
  }, [cartItems, loadedTransactionInfo]);

  // Notify parent about unsaved changes
  useEffect(() => {
    if (onUnsavedChangesChange) {
      onUnsavedChangesChange(hasUnsavedChanges);
    }
  }, [hasUnsavedChanges, onUnsavedChangesChange]);

  // Populate customer name, waiter, CU, and pickup method when transaction is loaded
  useEffect(() => {
    if (loadedTransactionInfo) {
      setCustomerName(loadedTransactionInfo.customerName ?? '');
      const cu = loadedTransactionInfo.customer_unit;
      setCuValue(cu != null && cu >= 1 ? String(Math.min(999, cu)) : '1');
      setSelectedWaiterId(loadedTransactionInfo.waiterId ?? null);
      setSelectedWaiterName(loadedTransactionInfo.waiterName ?? null);
      setSelectedWaiterColor(loadedTransactionInfo.waiterColor ?? null);
      setOrderPickupMethod(loadedTransactionInfo.pickupMethod ?? 'dine-in');
    } else {
      setCustomerName('');
      setCuValue('1');
      setSelectedWaiterId(null);
      setSelectedWaiterName(null);
      setSelectedWaiterColor(null);
      // When no loaded transaction: platform tab -> take-away, offline -> dine-in
      setOrderPickupMethod(isOnline && selectedOnlinePlatform ? 'take-away' : 'dine-in');
    }
  }, [loadedTransactionInfo, isOnline, selectedOnlinePlatform]);

  // When switching to an online platform tab, automatically set pickup to take-away
  useEffect(() => {
    if (isOnline && selectedOnlinePlatform) {
      setOrderPickupMethod('take-away');
    }
  }, [isOnline, selectedOnlinePlatform]);

  // When parent triggers "New" (resetCustomerAndWaiterSignal increments), reset nama pelanggan, CU, and pilih waiter
  useEffect(() => {
    if (resetCustomerAndWaiterSignal !== undefined && resetCustomerAndWaiterSignal > 0) {
      setCustomerName('');
      setCuValue('1');
      setSelectedWaiterId(null);
      setSelectedWaiterName(null);
      setSelectedWaiterColor(null);
    }
  }, [resetCustomerAndWaiterSignal]);

  // Step 2: Access Control - Fetch current user's employee record
  useEffect(() => {
    if (user?.id && businessId) {
      const fetchCurrentUserEmployee = async () => {
        try {
          const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
          if (electronAPI?.localDbGetEmployees) {
            const allEmployees = await electronAPI.localDbGetEmployees();
            const employee = (allEmployees as unknown as Employee[]).find(
              (emp: Employee) =>
                emp.user_id === parseInt(String(user.id)) &&
                (emp.business_id === businessId || emp.business_id === null)
            );
            setCurrentUserEmployee(employee || null);
          }
        } catch (error) {
          console.error('Error fetching current user employee:', error);
          setCurrentUserEmployee(null);
        }
      };
      fetchCurrentUserEmployee();
    } else {
      setCurrentUserEmployee(null);
    }
  }, [user?.id, businessId]);

  // Check if user can select waiter (SPV, Cashier, or Waiter)
  const canSelectWaiter = currentUserEmployee?.jabatan_id === 1 ||
    currentUserEmployee?.jabatan_id === 2 ||
    currentUserEmployee?.jabatan_id === 6;

  // Calculate responsive sizes based on column count
  const gridStyles = useMemo(() => {
    const baseSizes = {
      3: {
        gridCols: 'grid-cols-3',
        colSpan: 'col-span-3',
        cardPadding: 'p-3',
        productNameSize: 'text-sm',
        priceLabelSize: 'text-xs',
        priceValueSize: 'text-sm',
        bundleBadgeSize: 'text-xs',
        bundleBadgePadding: 'px-2 py-1',
        emojiSize: 'text-3xl',
      },
      4: {
        gridCols: 'grid-cols-4',
        colSpan: 'col-span-4',
        cardPadding: 'p-4',
        productNameSize: 'text-[18.48px]',
        priceLabelSize: 'text-[15.4px]',
        priceValueSize: 'text-[18.48px]',
        bundleBadgeSize: 'text-[15.4px]',
        bundleBadgePadding: 'px-3 py-1',
        emojiSize: 'text-[36.96px]',
      },
      5: {
        gridCols: 'grid-cols-5',
        colSpan: 'col-span-5',
        cardPadding: 'p-2',
        productNameSize: 'text-[10.8px]',
        priceLabelSize: 'text-[10px]',
        priceValueSize: 'text-xs',
        bundleBadgeSize: 'text-[10px]',
        bundleBadgePadding: 'px-1.5 py-0.5',
        emojiSize: 'text-2xl',
      },
    };
    return baseSizes[columnCount as keyof typeof baseSizes] || baseSizes[5];
  }, [columnCount]);

  // Send cart updates to customer display
  const sendCartUpdate = (cartItems: CartItem[]) => {
    if (window.electronAPI && window.electronAPI.updateCustomerDisplay) {
      window.electronAPI.updateCustomerDisplay({
        cartItems: cartItems,
        tabInfo: {
          activeTab: transactionType + (isOnline ? ' (Online)' : ''),
          isOnline: isOnline,
          selectedPlatform: selectedOnlinePlatform
        }
      });
    }
  };

  const PLATFORM_LABELS: Record<'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok', string> = {
    qpon: 'Qpon',
    gofood: 'GoFood',
    grabfood: 'GrabFood',
    shopeefood: 'ShopeeFood',
    tiktok: 'TikTok'
  };

  const sumCustomizationPrice = (customizations?: SelectedCustomization[]) => {
    if (!customizations || customizations.length === 0) return 0;
    return customizations.reduce((sum, customization) => {
      const optionTotal = customization.selected_options.reduce((optionSum, option) => {
        const priceAdj = typeof option.price_adjustment === 'number' ? option.price_adjustment : (typeof option.price_adjustment === 'string' ? parseFloat(option.price_adjustment) || 0 : 0); return optionSum + priceAdj;
      }, 0);
      return sum + optionTotal;
    }, 0);
  };

  const calculateBundleCustomizationCharge = (bundleSelections?: BundleSelection[]) => {
    if (!bundleSelections || bundleSelections.length === 0) return 0;

    return bundleSelections.reduce((bundleSum, bundleSelection) => {
      const selectionTotal = bundleSelection.selectedProducts.reduce((productSum, selectedProduct) => {
        const perUnitAdjustment = sumCustomizationPrice(selectedProduct.customizations);
        return productSum + perUnitAdjustment;
      }, 0);
      return bundleSum + selectionTotal;
    }, 0);
  };

  const checkProductCustomizations = async (product: Product) => {
    try {
      // Always try offline first for UI responsiveness
      const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
      if (electronAPI?.localDbGetProductCustomizations) {
        const localData = await electronAPI.localDbGetProductCustomizations(product.id);
        if (Array.isArray(localData) && localData.length > 0) {
          return true;
        }
      }

      // Only try online if explicitly online mode and offline failed/empty
      if (isOnline && offlineSyncService.getStatus().isOnline) {
        try {
          const response = await fetch(getApiUrl(`/api/products/${product.id}/customizations`), {
            signal: AbortSignal.timeout(2000)
          });
          if (response.ok) {
            const data = await response.json();
            return data.customizations && data.customizations.length > 0;
          }
        } catch (e) {
          console.warn('Online check failed, ignoring:', e);
        }
      }

      return false;
    } catch (error) {
      console.error('Error checking customizations:', error);
    }
    return false;
  };

  const getOnlinePriceForPlatform = (product: Product): number | null => {
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

  const effectiveProductPrice = (product: Product): number | null => {
    if (isOnline && selectedOnlinePlatform) {
      const p = getOnlinePriceForPlatform(product);
      if (p === null) return null; // NULL price - don't show
      return p; // Return 0 if price is 0, or the actual price
    }
    // For offline mode, check if harga_jual is null
    if (product.harga_jual === null || product.harga_jual === undefined) {
      return null;
    }
    return product.harga_jual;
  };

  const handleProductClick = async (product: Product) => {
    if (isOnline && selectedOnlinePlatform) {
      const platformPrice = getOnlinePriceForPlatform(product);
      if (platformPrice === null) {
        return; // disabled in online mode for this platform (NULL price)
      }
      // Allow 0 prices - they should be clickable
    } else {
      // Offline mode - check if harga_jual is null
      const price = effectiveProductPrice(product);
      if (price === null) {
        return; // disabled if price is null
      }
    }
    setLoadingProductId(product.id);

    try {
      // Check if product is a bundle
      const isBundle = product.is_bundle === 1 || product.is_bundle === true;

      if (isBundle) {
        // Fetch bundle items
        try {
          console.log(`🔍 [BUNDLE] Fetching bundle items for product ${product.id} (${product.nama})`);

          // Always try offline first
          let finalItems: BundleItem[] = [];
          let foundLocally = false;

          const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
          if (electronAPI?.localDbGetBundleItems) {
            try {
              console.log(`🔄 [BUNDLE] Calling localDbGetBundleItems(${product.id})`);
              const localBundleItems = await electronAPI.localDbGetBundleItems(product.id);
              console.log(`📦 [BUNDLE] Offline fetch returned:`, localBundleItems);
              if (Array.isArray(localBundleItems) && localBundleItems.length > 0) {
                finalItems = localBundleItems as BundleItem[];
                foundLocally = true;
              }
            } catch (e) {
              console.warn('Local bundle fetch failed:', e);
            }
          }

          // Only try online if local failed/empty and we are online
          if (!foundLocally && offlineSyncService.getStatus().isOnline) {
            try {
              console.log(`🌐 [BUNDLE] Attempting online fetch for product ${product.id}`);
              const response = await fetch(getApiUrl(`/api/products/${product.id}/bundle-items`), {
                signal: AbortSignal.timeout(5000)
              });
              if (response.ok) {
                const data = await response.json();
                finalItems = data.bundleItems || [];
              }
            } catch (e) {
              console.warn('Online bundle fetch failed:', e);
            }
          }

          console.log(`📋 [BUNDLE] Final bundle items data:`, finalItems);
          console.log(`✅ [BUNDLE] Setting ${finalItems.length} bundle items and opening modal`);
          if (finalItems.length > 0) {
            console.log(`📦 [BUNDLE] First bundle item details:`, JSON.stringify(finalItems[0], null, 2));
            console.log(`📦 [BUNDLE] Bundle item has category2_name:`, finalItems[0].category2_name);
            console.log(`📦 [BUNDLE] Bundle item has category2_id:`, finalItems[0].category2_id);
          }
          setBundleItems(finalItems);
          setSelectedProduct(product);
          setShowBundleModal(true);
        } catch (error) {
          console.error('❌ [BUNDLE] Error fetching bundle items:', error);
          alert('Gagal memuat detail bundle. Silakan coba lagi.');
        }
      } else if (product.is_package === 1 || product.is_package === true) {
        // Package product: open package selection modal
        const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
        if (electronAPI?.localDbGetPackageItems) {
          try {
            const items = await electronAPI.localDbGetPackageItems(product.id) as PackageItemForPos[];
            if (items && items.length > 0) {
              setPackageItemsForModal(items);
              setSelectedProduct(product);
              setShowPackageModal(true);
            } else {
              alert('Paket ini belum memiliki item. Silakan atur di manage products.');
            }
          } catch (e) {
            console.error('Error fetching package items:', e);
            alert('Gagal memuat detail paket. Silakan coba lagi.');
          }
        } else {
          alert('Fitur paket tidak tersedia.');
        }
      } else {
        // Regular product flow
        const hasCustomizations = await checkProductCustomizations(product);

        if (hasCustomizations) {
          setSelectedProduct(product);
          setShowCustomizationModal(true);
        } else {
          // Show custom note modal for products without customizations
          setSelectedProduct(product);
          setShowCustomNoteModal(true);
        }
      }
    } finally {
      setLoadingProductId(null);
    }
  };

  /** Insert new item right after the last occurrence of the same product (product.id) */
  const insertAfterSameProduct = (items: CartItem[], newItem: CartItem): CartItem[] => {
    let insertIndex = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].product.id === newItem.product.id) {
        insertIndex = i + 1;
        break;
      }
    }
    if (insertIndex < 0) {
      return [...items, newItem];
    }
    return [...items.slice(0, insertIndex), newItem, ...items.slice(insertIndex)];
  };

  const addToCart = (product: Product, customizations?: SelectedCustomization[], quantity: number = 1, customNote?: string, bundleSelections?: BundleSelection[], packageSelections?: PackageSelection[]) => {
    const newItem: CartItem = {
      id: Date.now(),
      product,
      quantity,
      customizations: customizations || [],
      customNote: customNote || undefined,
      bundleSelections: bundleSelections || undefined,
      packageSelections: packageSelections || undefined,
      isNewlyAdded: true,
      ...(loadedTransactionInfo ? { isLocked: false } : {}),
    };

    // Both lihat mode and normal mode: insert new item below the last occurrence of same product
    const newCartItems = insertAfterSameProduct(cartItems, newItem);
    setCartItems(newCartItems);

    // Send cart update to customer display
    sendCartUpdate(newCartItems);
  };

  const handleCustomNoteConfirm = (note: string) => {
    if (selectedProduct) {
      addToCart(selectedProduct, undefined, 1, note);
    }
  };

  const handleBundleConfirm = (bundleSelections: BundleSelection[]) => {
    if (selectedProduct) {
      const sanitizedSelections = bundleSelections.map(selection => ({
        ...selection,
        selectedProducts: selection.selectedProducts.map(sp => ({
          product: sp.product,
          customizations: sp.customizations,
          customNote: sp.customNote
        }))
      }));
      addToCart(selectedProduct, undefined, 1, undefined, sanitizedSelections);
    }
  };

  const handlePackageConfirm = (selections: PackageSelection[], quantity: number) => {
    if (selectedProduct) {
      addToCart(selectedProduct, undefined, quantity, undefined, undefined, selections);
      setShowPackageModal(false);
      setSelectedProduct(null);
      setPackageItemsForModal([]);
    }
  };

  const handleEditItem = (cartItem: CartItem) => {
    setSelectedCartItem(cartItem);
    setShowEditModal(true);
  };

  const handleUpdateItem = (updatedItem: CartItem) => {
    const newCartItems = cartItems.map(item =>
      item.id === updatedItem.id ? { ...updatedItem, isNewlyAdded: false } : item
    );
    setCartItems(newCartItems);
    sendCartUpdate(newCartItems);
  };

  const handlePaymentComplete = () => {
    if (cartItems.length === 0) return;

    // Clear cart immediately after payment completion (receipt printed)
    setCartItems([]);
    sendCartUpdate([]);

    // Reset cart to new state: clear customer name and selected waiter
    setCustomerName('');
    setSelectedWaiterId(null);
    setSelectedWaiterName(null);
    setSelectedWaiterColor(null);

    // Clear loaded transaction info if in "lihat" mode
    // This removes the yellow "opening" indicator
    if (loadedTransactionInfo && onClearLoadedTransaction) {
      onClearLoadedTransaction();
    }
  };

  // Log activity to activity_logs
  const logActivity = async (action: string, details: string) => {
    try {
      const userId = user?.id ? parseInt(String(user.id)) : null;
      if (!userId) {
        console.warn('Cannot log activity: user ID not available');
        return;
      }

      // The API uses session auth, but we'll try to call it
      // If it fails due to auth, we'll log to console as fallback
      const response = await fetch(getApiUrl('/api/activity-logs'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies for session
        body: JSON.stringify({
          action,
          business_id: businessId,
          details,
        }),
      });

      if (!response.ok) {
        // If API call fails, log to console as fallback
        console.warn('Failed to log activity to server, logging locally:', {
          user_id: userId,
          action,
          business_id: businessId,
          details,
        });
      }
    } catch (error) {
      // Log to console as fallback if API is unavailable
      console.warn('Error logging activity (API unavailable), logging locally:', {
        user_id: user?.id,
        action,
        business_id: businessId,
        details,
      });
      // Don't throw - activity logging failure shouldn't block the action
    }
  };

  // Handle password verification for locked items
  const handlePasswordSubmit = async () => {
    if (passwordInput === 'KONFIRMASI') {
      setShowPasswordModal(false);

      if (pendingLockedItemAction) {
        const { item, action } = pendingLockedItemAction;
        const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;

        try {
          // Perform the action
          if (action === 'delete') {
            // For locked items, update production_status to 'cancelled' instead of hard delete
            if (item.transactionItemId && item.transactionId && electronAPI?.localDbGetTransactionItems && electronAPI?.localDbUpsertTransactionItems) {
              // Fetch the full transaction item data
              const transactionItems = await electronAPI.localDbGetTransactionItems(item.transactionId);
              const itemsArray = Array.isArray(transactionItems) ? transactionItems as Record<string, unknown>[] : [];
              const transactionItem = itemsArray.find((ti) => {
                const tiId = typeof ti.id === 'number' ? ti.id : (typeof ti.id === 'string' ? parseInt(ti.id, 10) : null);
                return tiId === item.transactionItemId;
              });

              if (transactionItem) {
                // Prepare the item data with production_status set to 'cancelled'
                const itemUuidId = typeof transactionItem.uuid_id === 'string' ? transactionItem.uuid_id : String(transactionItem.uuid_id || '');
                const transactionIntId = typeof transactionItem.transaction_id === 'number' ? transactionItem.transaction_id : (typeof transactionItem.transaction_id === 'string' ? parseInt(transactionItem.transaction_id, 10) : 0);
                const transactionUuidId = typeof transactionItem.uuid_transaction_id === 'string' ? transactionItem.uuid_transaction_id : String(transactionItem.uuid_transaction_id || '');
                const productId = typeof transactionItem.product_id === 'number' ? transactionItem.product_id : (typeof transactionItem.product_id === 'string' ? parseInt(transactionItem.product_id, 10) : 0);
                const quantity = typeof transactionItem.quantity === 'number' ? transactionItem.quantity : (typeof transactionItem.quantity === 'string' ? parseInt(transactionItem.quantity, 10) : 1);
                const unitPrice = typeof transactionItem.unit_price === 'number' ? transactionItem.unit_price : (typeof transactionItem.unit_price === 'string' ? parseFloat(String(transactionItem.unit_price)) : 0);
                const totalPrice = typeof transactionItem.total_price === 'number' ? transactionItem.total_price : (typeof transactionItem.total_price === 'string' ? parseFloat(String(transactionItem.total_price)) : 0);
                const customNote = typeof transactionItem.custom_note === 'string' ? transactionItem.custom_note : null;
                const bundleSelectionsJson = typeof transactionItem.bundle_selections_json === 'string' ? transactionItem.bundle_selections_json : (transactionItem.bundle_selections_json ? JSON.stringify(transactionItem.bundle_selections_json) : null);
                const waiterIdItem = typeof transactionItem.waiter_id === 'number' ? transactionItem.waiter_id : (typeof transactionItem.waiter_id === 'string' ? parseInt(String(transactionItem.waiter_id), 10) : null);

                // Get created_at - preserve original timestamp
                const createdAt = transactionItem.created_at ? String(transactionItem.created_at) : new Date().toISOString();

                // Set production_status to 'cancelled'
                const productionStatus = 'cancelled';
                const productionStartedAt = transactionItem.production_started_at ? String(transactionItem.production_started_at) : null;
                const productionFinishedAt = transactionItem.production_finished_at ? String(transactionItem.production_finished_at) : null;

                // Update the transaction item in database
                await electronAPI.localDbUpsertTransactionItems([{
                  id: item.transactionItemId,
                  uuid_id: itemUuidId,
                  transaction_id: transactionIntId,
                  uuid_transaction_id: transactionUuidId,
                  product_id: productId,
                  quantity: quantity,
                  unit_price: unitPrice,
                  total_price: totalPrice,
                  custom_note: customNote,
                  bundle_selections_json: bundleSelectionsJson,
                  created_at: createdAt,
                  waiter_id: waiterIdItem ?? null,
                  production_status: productionStatus,
                  production_started_at: productionStartedAt,
                  production_finished_at: productionFinishedAt,
                }]);
              } else {
                console.warn('Transaction item not found in database');
              }
            }

            // Check if transaction has any active (non-cancelled) items left
            // If all items are cancelled, update transaction status to 'cancelled'
            if (item.transactionId && electronAPI?.localDbGetTransactionItems && electronAPI?.localDbGetTransactions && electronAPI?.localDbUpsertTransactions) {
              try {
                // Fetch all items for this transaction
                const allTransactionItems = await electronAPI.localDbGetTransactionItems(item.transactionId);
                const allItemsArray = Array.isArray(allTransactionItems) ? allTransactionItems as Record<string, unknown>[] : [];

                // Check if there are any active (non-cancelled) items
                const hasActiveItems = allItemsArray.some((ti) => {
                  const status = typeof ti.production_status === 'string' ? ti.production_status : null;
                  return status !== 'cancelled';
                });

                // If no active items, update transaction status to 'cancelled'
                if (!hasActiveItems) {
                  // Fetch the transaction to get all its data
                  const allTransactions = await electronAPI.localDbGetTransactions(businessId, 10000);
                  const transactionsArray = Array.isArray(allTransactions) ? allTransactions : [];
                  const transaction = transactionsArray.find((tx: unknown) => {
                    if (tx && typeof tx === 'object' && 'uuid_id' in tx) {
                      const t = tx as { uuid_id?: string; id?: string };
                      return (t.uuid_id === item.transactionId) || (t.id === item.transactionId);
                    }
                    return false;
                  }) as Record<string, unknown> | undefined;

                  if (transaction) {
                    // Update transaction status to 'cancelled'
                    const updatedTransaction = {
                      ...transaction,
                      status: 'cancelled',
                      updated_at: new Date().toISOString(),
                    };

                    await electronAPI.localDbUpsertTransactions([updatedTransaction]);
                    console.log(`✅ Transaction ${item.transactionId} status updated to 'cancelled' (all items cancelled)`);
                  }
                }
              } catch (error) {
                console.error('Error checking/updating transaction status:', error);
                // Don't block the item removal if this check fails
              }
            }

            // Remove from cart UI
            const newCartItems = cartItems.filter(cartItem => cartItem.id !== item.id);
            setCartItems(newCartItems);
            sendCartUpdate(newCartItems);

            // Log activity
            await logActivity(
              'delete_locked_cart_item',
              JSON.stringify({
                product_name: item.product.nama,
                product_id: item.product.id,
                quantity: item.quantity,
                transaction_id: item.transactionId || null,
                transaction_item_id: item.transactionItemId || null,
              })
            );
          } else if (action === 'reduce') {
            // For reduce, create a separate cancelled record (Option B - production quality)
            if (item.transactionItemId && item.transactionId && electronAPI?.localDbGetTransactionItems && electronAPI?.localDbUpsertTransactionItems) {
              // Fetch the full transaction item data
              const transactionItems = await electronAPI.localDbGetTransactionItems(item.transactionId);
              const itemsArray = Array.isArray(transactionItems) ? transactionItems as Record<string, unknown>[] : [];
              const transactionItem = itemsArray.find((ti) => {
                const tiId = typeof ti.id === 'number' ? ti.id : (typeof ti.id === 'string' ? parseInt(ti.id, 10) : null);
                return tiId === item.transactionItemId;
              });

              if (transactionItem) {
                const cancelledQuantity = 1; // Always cancel 1 item when reducing
                const remainingQuantity = item.quantity - cancelledQuantity;

                // Extract common fields
                const transactionIntId = typeof transactionItem.transaction_id === 'number' ? transactionItem.transaction_id : (typeof transactionItem.transaction_id === 'string' ? parseInt(transactionItem.transaction_id, 10) : 0);
                const transactionUuidId = typeof transactionItem.uuid_transaction_id === 'string' ? transactionItem.uuid_transaction_id : String(transactionItem.uuid_transaction_id || '');
                const productId = typeof transactionItem.product_id === 'number' ? transactionItem.product_id : (typeof transactionItem.product_id === 'string' ? parseInt(transactionItem.product_id, 10) : 0);
                const unitPrice = typeof transactionItem.unit_price === 'number' ? transactionItem.unit_price : (typeof transactionItem.unit_price === 'string' ? parseFloat(String(transactionItem.unit_price)) : 0);
                const customNote = typeof transactionItem.custom_note === 'string' ? transactionItem.custom_note : null;
                const bundleSelectionsJson = typeof transactionItem.bundle_selections_json === 'string' ? transactionItem.bundle_selections_json : (transactionItem.bundle_selections_json ? JSON.stringify(transactionItem.bundle_selections_json) : null);
                const waiterIdItem = typeof transactionItem.waiter_id === 'number' ? transactionItem.waiter_id : (typeof transactionItem.waiter_id === 'string' ? parseInt(String(transactionItem.waiter_id), 10) : null);
                const createdAt = transactionItem.created_at ? String(transactionItem.created_at) : new Date().toISOString();

                // Preserve production_status for original record
                const productionStatus = typeof transactionItem.production_status === 'string' ? transactionItem.production_status : null;
                const productionStartedAt = transactionItem.production_started_at ? String(transactionItem.production_started_at) : null;
                const productionFinishedAt = transactionItem.production_finished_at ? String(transactionItem.production_finished_at) : null;

                // 1. Update original record: reduce quantity to remaining items, keep production_status
                const itemUuidId = typeof transactionItem.uuid_id === 'string' ? transactionItem.uuid_id : String(transactionItem.uuid_id || '');
                const remainingTotalPrice = unitPrice * remainingQuantity;

                await electronAPI.localDbUpsertTransactionItems([{
                  id: item.transactionItemId,
                  uuid_id: itemUuidId,
                  transaction_id: transactionIntId,
                  uuid_transaction_id: transactionUuidId,
                  product_id: productId,
                  quantity: remainingQuantity,
                  unit_price: unitPrice,
                  total_price: remainingTotalPrice,
                  custom_note: customNote,
                  bundle_selections_json: bundleSelectionsJson,
                  created_at: createdAt,
                  waiter_id: waiterIdItem ?? null,
                  production_status: productionStatus,
                  production_started_at: productionStartedAt,
                  production_finished_at: productionFinishedAt,
                }]);

                // 2. Create new cancelled record: quantity 1, production_status 'cancelled'
                const cancelledUuidId = generateUUID();
                const cancelledTotalPrice = unitPrice * cancelledQuantity;

                await electronAPI.localDbUpsertTransactionItems([{
                  uuid_id: cancelledUuidId,
                  transaction_id: transactionIntId,
                  uuid_transaction_id: transactionUuidId,
                  product_id: productId,
                  quantity: cancelledQuantity,
                  unit_price: unitPrice,
                  total_price: cancelledTotalPrice,
                  custom_note: customNote,
                  bundle_selections_json: bundleSelectionsJson,
                  created_at: new Date().toISOString(), // Current timestamp for cancelled record
                  waiter_id: waiterIdItem ?? null,
                  production_status: 'cancelled',
                  production_started_at: null,
                  production_finished_at: null,
                }]);
              } else {
                console.warn('Transaction item not found in database');
              }
            }

            // Check if transaction has any active (non-cancelled) items left
            // If all items are cancelled, update transaction status to 'cancelled'
            if (item.transactionId && electronAPI?.localDbGetTransactionItems && electronAPI?.localDbGetTransactions && electronAPI?.localDbUpsertTransactions) {
              try {
                // Fetch all items for this transaction
                const allTransactionItems = await electronAPI.localDbGetTransactionItems(item.transactionId);
                const allItemsArray = Array.isArray(allTransactionItems) ? allTransactionItems as Record<string, unknown>[] : [];

                // Check if there are any active (non-cancelled) items
                const hasActiveItems = allItemsArray.some((ti) => {
                  const status = typeof ti.production_status === 'string' ? ti.production_status : null;
                  return status !== 'cancelled';
                });

                // If no active items, update transaction status to 'cancelled'
                if (!hasActiveItems) {
                  // Fetch the transaction to get all its data
                  const allTransactions = await electronAPI.localDbGetTransactions(businessId, 10000);
                  const transactionsArray = Array.isArray(allTransactions) ? allTransactions : [];
                  const transaction = transactionsArray.find((tx: unknown) => {
                    if (tx && typeof tx === 'object' && 'uuid_id' in tx) {
                      const t = tx as { uuid_id?: string; id?: string };
                      return (t.uuid_id === item.transactionId) || (t.id === item.transactionId);
                    }
                    return false;
                  }) as Record<string, unknown> | undefined;

                  if (transaction) {
                    // Update transaction status to 'cancelled'
                    const updatedTransaction = {
                      ...transaction,
                      status: 'cancelled',
                      updated_at: new Date().toISOString(),
                    };

                    await electronAPI.localDbUpsertTransactions([updatedTransaction]);
                    console.log(`✅ Transaction ${item.transactionId} status updated to 'cancelled' (all items cancelled)`);
                  }
                }
              } catch (error) {
                console.error('Error checking/updating transaction status:', error);
                // Don't block the item removal if this check fails
              }
            }

            // Update cart UI
            const newCartItems = cartItems.map(cartItem =>
              cartItem.id === item.id
                ? { ...cartItem, quantity: cartItem.quantity - 1 }
                : cartItem
            );
            setCartItems(newCartItems);
            sendCartUpdate(newCartItems);

            // Log activity
            await logActivity(
              'reduce_locked_cart_item',
              JSON.stringify({
                product_name: item.product.nama,
                product_id: item.product.id,
                old_quantity: item.quantity,
                new_quantity: item.quantity - 1,
                transaction_id: item.transactionId || null,
                transaction_item_id: item.transactionItemId || null,
              })
            );
          }
        } catch (error) {
          console.error('Error updating transaction item:', error);
          alert('Gagal memperbarui item. Silakan coba lagi.');
        }

        setPendingLockedItemAction(null);
        setPasswordInput('');
      }
    } else {
      alert('Password salah. Silakan coba lagi.');
      setPasswordInput('');
    }
  };

  const formatPrice = (price: number) => {
    return `Rp ${price.toLocaleString('id-ID')}`;
  };

  const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = cartItems.reduce((sum, item) => {
    let itemPrice = effectiveProductPrice(item.product);

    // If price is null, skip this item (shouldn't happen if items are already in cart, but safety check)
    if (itemPrice === null) return sum;

    // Add customization prices
    if (item.customizations) {
      item.customizations.forEach(customization => {
        customization.selected_options.forEach(option => {
          itemPrice! += option.price_adjustment;
        });
      });
    }

    // Add bundle customization prices per bundle unit
    if (item.bundleSelections) {
      itemPrice! += calculateBundleCustomizationCharge(item.bundleSelections);
    }

    return sum + (itemPrice! * item.quantity);
  }, 0);

  return (
    <div className="flex-1 flex">
      {/* Left Side - Cart Area — distinct bg to separate from product area (indigo-50 ties to Offline tab; lihat mode keeps yellow) */}
      <div className={`w-[34%] flex flex-col relative ${loadedTransactionInfo ? 'bg-yellow-50' : 'bg-indigo-50'}`} style={{ height: 'calc(100vh - 80px)', maxHeight: 'calc(100vh - 80px)' }}>
        {/* Opening Transaction Header - Only show in lihat mode */}
        {loadedTransactionInfo && (
          <div className="bg-yellow-100 border-b-2 border-yellow-400 px-4 py-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-yellow-900 flex items-center gap-2 flex-wrap">
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      const textArea = document.createElement('textarea');
                      textArea.value = loadedTransactionInfo.transactionId;
                      textArea.style.position = 'fixed';
                      textArea.style.left = '-9999px';
                      textArea.style.top = '0';
                      textArea.style.opacity = '0';
                      textArea.setAttribute('readonly', '');
                      document.body.appendChild(textArea);
                      textArea.focus();
                      textArea.select();
                      textArea.setSelectionRange(0, loadedTransactionInfo.transactionId.length);

                      try {
                        if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
                          await navigator.clipboard.writeText(loadedTransactionInfo.transactionId);
                        } else {
                          const successful = document.execCommand('copy');
                          if (!successful) {
                            throw new Error('execCommand copy failed');
                          }
                        }
                      } catch {
                        const successful = document.execCommand('copy');
                        if (!successful) {
                          throw new Error('All copy methods failed');
                        }
                      }

                      document.body.removeChild(textArea);
                      setCopiedUuid(loadedTransactionInfo.transactionId);
                      setTimeout(() => {
                        setCopiedUuid(null);
                      }, 2000);
                    } catch (error) {
                      console.error('Failed to copy UUID:', error);
                      alert('Gagal menyalin UUID. Silakan salin manual: ' + loadedTransactionInfo.transactionId);
                    }
                  }}
                  className="px-2 py-1 text-xs text-gray-700 hover:bg-yellow-200 rounded transition-colors border border-yellow-300 hover:border-yellow-400"
                  title={`Copy UUID: ${loadedTransactionInfo.transactionId}`}
                >
                  {copiedUuid === loadedTransactionInfo.transactionId ? 'Copied!' : 'Copy UUID'}
                </button>
                {loadedTransactionInfo.waiterName || (loadedTransactionInfo.waiterNamesAll && loadedTransactionInfo.waiterNamesAll.length > 0) ? (
                  <>
                    <span className="text-yellow-700">|</span>
                    <span className="text-yellow-700">by</span>
                    <div className="relative inline-block" ref={waiterListPopoverRef}>
                      <button
                        type="button"
                        onClick={() => setShowWaiterListPopover((v) => !v)}
                        className={`min-h-8 px-2 py-1 transition-all hover:shadow-md cursor-pointer flex items-center justify-center rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-yellow-500`}
                        style={loadedTransactionInfo.waiterColor ? { borderLeftColor: loadedTransactionInfo.waiterColor, borderLeftWidth: '4px' } : undefined}
                        title={loadedTransactionInfo.waiterNamesAll && loadedTransactionInfo.waiterNamesAll.length > 1 ? loadedTransactionInfo.waiterNamesAll.join(', ') : undefined}
                      >
                        <span className="font-medium text-gray-800 text-xs">
                          {loadedTransactionInfo.waiterName ?? loadedTransactionInfo.waiterNamesAll?.[0]}
                          {loadedTransactionInfo.waiterNamesAll && loadedTransactionInfo.waiterNamesAll.length > 1 && (
                            <span className="text-gray-500 ml-0.5">(+{loadedTransactionInfo.waiterNamesAll.length - 1})</span>
                          )}
                        </span>
                      </button>
                      {showWaiterListPopover && loadedTransactionInfo.waiterNamesAll && loadedTransactionInfo.waiterNamesAll.length > 0 && (
                        <div className="absolute left-0 top-full mt-1 z-50 min-w-[120px] rounded-lg border border-gray-200 bg-white py-2 shadow-lg">
                          <div className="px-3 py-1 text-xs font-semibold text-gray-500 uppercase">Waiters</div>
                          {loadedTransactionInfo.waiterNamesAll.map((name, i) => (
                            <div key={i} className="px-3 py-1.5 text-sm text-gray-900">{name}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-yellow-700">|</span>
                    <button
                      type="button"
                      onClick={() => setShowWaiterModal(true)}
                      className="px-2 py-1 text-xs font-medium text-yellow-900 bg-amber-200 hover:bg-amber-300 border border-amber-400 rounded transition-colors"
                    >
                      Pilih Waiter
                    </button>
                  </>
                )}
                {(loadedTransactionInfo.tableName || loadedTransactionInfo.roomName || loadedTransactionInfo.customerName) && (
                  <>
                    <span className="text-yellow-700">|</span>
                    <span>
                      {loadedTransactionInfo.tableName && loadedTransactionInfo.roomName
                        ? `${loadedTransactionInfo.tableName}/${loadedTransactionInfo.roomName}`
                        : loadedTransactionInfo.tableName || loadedTransactionInfo.roomName || ''}
                      {loadedTransactionInfo.customerName && (
                        <span className="text-yellow-700">: {loadedTransactionInfo.customerName}</span>
                      )}
                    </span>
                  </>
                )}
              </span>
            </div>
          </div>
        )}
        <div className="flex-1 p-4 flex flex-col overflow-hidden">

          {/* When viewing existing order: show "Adding items as" waiter so user can set who gets credit for new items */}
          {loadedTransactionInfo && (
            <div className="mb-3 flex-shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-gray-600">Menambah item sebagai:</span>
                <button
                  type="button"
                  onClick={() => setShowWaiterModal(true)}
                  className={`min-h-8 px-3 py-1.5 transition-all hover:shadow-md cursor-pointer flex items-center justify-center rounded-lg border ${selectedWaiterName ? 'border-gray-300 bg-white' : 'border-amber-400 bg-amber-100'}`}
                  style={selectedWaiterColor ? { borderLeftColor: selectedWaiterColor, borderLeftWidth: '4px' } : undefined}
                  title="Klik untuk memilih waiter yang menambah item"
                >
                  {selectedWaiterName ? (
                    <span className="font-medium text-gray-800 text-sm">{selectedWaiterName}</span>
                  ) : (
                    <span className="text-amber-800 text-sm font-medium">Pilih Waiter</span>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Customer Name, CU, and Waiter Selection - hidden when viewing active order; header already shows waiter and customer */}
          {!loadedTransactionInfo && (
            <div className="mb-3 flex-shrink-0">
              <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Nama pelanggan"
                  className="h-9 touch-manipulation w-full min-w-0 rounded-lg px-2.5 py-1.5 border-2 border-blue-500 text-sm text-black placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 animate-pulse box-border"
                  style={{ animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite', fontSize: 'clamp(0.8125rem, 2.2vw, 1rem)' }}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={999}
                  value={cuValue}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '');
                    if (v === '') setCuValue('');
                    else {
                      const n = parseInt(v, 10);
                      if (!Number.isNaN(n) && n >= 1 && n <= 999) setCuValue(String(n));
                    }
                  }}
                  onBlur={() => {
                    const n = parseInt(cuValue, 10);
                    if (Number.isNaN(n) || n < 1) setCuValue('1');
                    else if (n > 999) setCuValue('999');
                  }}
                  placeholder="1"
                  title="CU"
                  className="h-9 w-14 touch-manipulation rounded-lg px-1 py-1.5 border-2 border-amber-500 text-sm text-black text-center placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400 box-border [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  style={{ fontSize: 'clamp(0.8125rem, 2.2vw, 1rem)' }}
                />
                <button
                  type="button"
                  onClick={() => setShowWaiterModal(true)}
                  className="h-9 touch-manipulation w-full min-w-0 rounded-lg transition-all hover:shadow-md active:scale-[0.98] cursor-pointer flex items-center justify-center overflow-hidden box-border px-2"
                  style={{ backgroundColor: selectedWaiterColor || '#3B82F6' }}
                >
                  {selectedWaiterName ? (
                    <span className="font-medium text-gray-800 text-sm truncate block bg-white rounded px-1.5 py-0.5 border border-black max-w-full" style={{ fontSize: 'clamp(0.8125rem, 2.2vw, 1rem)' }}>
                      {selectedWaiterName}
                    </span>
                  ) : (
                    <span className="text-white text-sm" style={{ fontSize: 'clamp(0.8125rem, 2.2vw, 1rem)' }}>Pilih Waiter</span>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Cart Items Area - Scrollable with Padding for Summary */}
          <div className="flex-1 overflow-y-auto mb-4" style={{ minHeight: 0, paddingBottom: '220px' }}>
            {/* Empty Cart Indicator */}
            {cartItems.length === 0 && (
              <div className="text-center py-12">
                <div className="w-24 h-24 mx-auto mb-4 text-gray-300">
                  <ShoppingCart className="w-full h-full" />
                </div>
                <p className="text-gray-400 text-base">Keranjang belanja kosong</p>
              </div>
            )}

            {/* Cart Items List */}
            {cartItems.length > 0 && (
              <div className="space-y-2">
                {cartItems.map((item) => {
                  const isLocked = item.isLocked === true;
                  return (
                    <div
                      key={item.id}
                      onClick={() => !isLocked && handleEditItem(item)}
                      className={`rounded-lg border p-3 transition-all duration-200 ${isLocked
                          ? 'bg-gray-100 border-gray-300 cursor-not-allowed'
                          : 'bg-white border-gray-200 cursor-pointer hover:border-blue-300 hover:shadow-sm'
                        }`}
                      title={isLocked ? 'Item terkunci - sudah dikirim ke kitchen/barista' : 'Click to edit item'}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h4 className={`font-medium text-sm ${isLocked ? 'text-gray-800' : 'text-gray-800'}`}>
                            {item.isNewlyAdded && loadedTransactionInfo && (
                              <span className="mr-1 text-blue-600 font-normal">[NEW]</span>
                            )}
                            {item.product.nama}
                          </h4>
                          {effectiveProductPrice(item.product) !== null && (
                            <p className="text-gray-600 text-xs flex items-center gap-1.5 flex-wrap">
                              <span>{formatPrice(effectiveProductPrice(item.product)!)} each</span>
                              {item.waiterName && (
                                <>
                                  <span className="text-gray-400">|</span>
                                  <span className="text-gray-500">by</span>
                                  <span
                                    className={`inline-flex min-h-6 items-center px-2 py-0.5 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-800`}
                                    style={item.waiterColor ? { borderLeftColor: item.waiterColor, borderLeftWidth: '4px' } : undefined}
                                  >
                                    {item.waiterName}
                                  </span>
                                </>
                              )}
                            </p>
                          )}

                          {/* Customizations */}
                          {item.customizations && item.customizations.length > 0 && (() => {
                            return (
                              <div className="mt-1 space-y-1">
                                {item.customizations.map((customization) => (
                                  <div key={customization.customization_id} className="text-xs">
                                    <span className="text-gray-500">{customization.customization_name}:</span>
                                    <div className="ml-2 space-y-0.5">
                                      {customization.selected_options && customization.selected_options.length > 0 ? (
                                        customization.selected_options.map((option) => (
                                          <div key={option.option_id} className="flex items-center justify-between">
                                            <span className="text-gray-600">• {option.option_name}</span>
                                            {option.price_adjustment !== 0 && (
                                              <span className={`text-xs ${option.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                {option.price_adjustment > 0 ? '+' : ''}{formatPrice(option.price_adjustment)}
                                              </span>
                                            )}
                                          </div>
                                        ))
                                      ) : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}

                          {/* Custom Note */}
                          {item.customNote && (
                            <div className="mt-1">
                              <div className="text-xs">
                                <span className="text-gray-500">Note:</span>
                                <span className="text-gray-700 ml-1 italic">&ldquo;{item.customNote}&rdquo;</span>
                              </div>
                            </div>
                          )}

                          {/* Bundle Selections */}
                          {item.bundleSelections && item.bundleSelections.length > 0 && (
                            <div className="mt-2 space-y-2">
                              <div className="text-xs font-semibold text-purple-700">Bundle Items:</div>
                              {item.bundleSelections.map((bundleSel, idx) => {
                                const totalQuantity = bundleSel.selectedProducts.length;
                                return (
                                  <div key={idx} className="ml-2 border-l-2 border-purple-300 pl-2">
                                    <div className="text-xs font-medium text-purple-600">
                                      {bundleSel.category2_name} ({totalQuantity}/{bundleSel.requiredQuantity}):
                                    </div>
                                    <div className="ml-2 mt-1 space-y-1">
                                      {bundleSel.selectedProducts.map((sp, spIdx) => (
                                        <div key={spIdx} className="text-xs text-gray-600 border border-gray-200 rounded px-2 py-1 bg-white space-y-1">
                                          <div className="font-medium text-gray-700">• {sp.product.nama}</div>
                                          {sp.customizations && sp.customizations.length > 0 && (
                                            <div className="ml-3 text-[11px] text-gray-500 space-y-0.5">
                                              {sp.customizations.map((customization) => (
                                                <div key={customization.customization_id}>
                                                  <div className="font-semibold text-gray-600">{customization.customization_name}</div>
                                                  <ul className="ml-3 list-disc">
                                                    {customization.selected_options.map(option => (
                                                      <li key={option.option_id}>
                                                        {option.option_name}
                                                        {option.price_adjustment !== 0 && (
                                                          <span className={`ml-1 ${option.price_adjustment > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                            ({option.price_adjustment > 0 ? '+' : ''}{formatPrice(option.price_adjustment)})
                                                          </span>
                                                        )}
                                                      </li>
                                                    ))}
                                                  </ul>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          {sp.customNote && (
                                            <div className="text-[11px] text-gray-500 italic">
                                              Note: &ldquo;{sp.customNote}&rdquo;
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Package breakdown (expanded by default, compact) */}
                          {item.packageSelections && item.packageSelections.length > 0 && (() => {
                            const lines = getPackageBreakdownLines(item.packageSelections, item.quantity);
                            if (lines.length === 0) return null;
                            return (
                              <div className="mt-1 py-0.5 space-y-0.5">
                                <div className="text-xs font-semibold text-amber-700">Paket:</div>
                                <div className="ml-2 border-l-2 border-amber-300 pl-1.5 space-y-0.5">
                                  {lines.map((line, idx) => (
                                    <div key={idx} className="text-xs text-gray-900 py-0">
                                      • {line.product_name} ×{line.quantity}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent opening edit modal
                              if (isLocked) {
                                // For locked items, show password modal
                                if (item.quantity > 1) {
                                  setPendingLockedItemAction({ item, action: 'reduce' });
                                } else {
                                  setPendingLockedItemAction({ item, action: 'delete' });
                                }
                                setShowPasswordModal(true);
                                return;
                              }

                              // Normal flow for unlocked items
                              if (item.quantity > 1) {
                                const newCartItems = cartItems.map(cartItem =>
                                  cartItem.id === item.id
                                    ? { ...cartItem, quantity: cartItem.quantity - 1 }
                                    : cartItem
                                );
                                setCartItems(newCartItems);
                                sendCartUpdate(newCartItems);
                              } else {
                                const newCartItems = cartItems.filter(cartItem => cartItem.id !== item.id);
                                setCartItems(newCartItems);
                                sendCartUpdate(newCartItems);
                              }
                            }}
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${isLocked
                                ? 'bg-red-500 hover:bg-red-600 text-white'
                                : 'bg-red-500 hover:bg-red-600 text-white'
                              }`}
                            title={isLocked ? 'Kurangi jumlah (memerlukan password)' : 'Kurangi jumlah'}
                          >
                            -
                          </button>
                          <span className={`text-sm font-medium w-8 text-center ${isLocked ? 'text-gray-500' : 'text-black'}`}>
                            {item.quantity}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent opening edit modal
                              if (isLocked) return; // Prevent action on locked items
                              const newCartItems = cartItems.map(cartItem =>
                                cartItem.id === item.id
                                  ? { ...cartItem, quantity: cartItem.quantity + 1 }
                                  : cartItem
                              );
                              setCartItems(newCartItems);
                              sendCartUpdate(newCartItems);
                            }}
                            disabled={isLocked}
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${isLocked
                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                : 'bg-green-500 hover:bg-green-600 text-white'
                              }`}
                            title={isLocked ? 'Item terkunci - tidak dapat diubah' : 'Tambah jumlah'}
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 flex justify-between items-center">
                        <span className="text-xs text-gray-500">Subtotal</span>
                        <span className="font-semibold text-green-600">
                          {(() => {
                            let itemPrice = effectiveProductPrice(item.product); if (itemPrice === null) return 'N/A';
                            if (item.customizations) {
                              const customizationPrice = sumCustomizationPrice(item.customizations); itemPrice += customizationPrice;
                            }
                            if (item.bundleSelections) {
                              const bundleCharge = calculateBundleCustomizationCharge(item.bundleSelections); itemPrice += bundleCharge;
                            }
                            const finalPrice = itemPrice * item.quantity; return formatPrice(finalPrice);
                          })()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cart Summary - Sticky at Bottom of Viewport */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 flex-shrink-0" style={{ position: 'sticky', bottom: '16px', zIndex: 10 }}>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-black">Harga produk asli</span>
                <span className="font-medium text-black">{formatPrice(totalPrice)}</span>
              </div>
              <hr className="border-gray-200" />
              <div className="flex justify-between items-center">
                <span className="text-gray-600">{totalItems} Barang</span>
                <div className="bg-blue-100 px-3 py-1 rounded">
                  <span className="font-semibold text-blue-800">Yang Diterima: {formatPrice(totalPrice)}</span>
                </div>
              </div>
            </div>

            {/* Take Away / Dine In selector - only when offline (Simpan Order flow) */}
            {!isOnline && (
              <div className="mt-2">
                <p className="text-xs text-gray-500 mb-1.5">Untuk Simpan Order:</p>
                <div className="relative flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                  <div
                    className={`absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-0.125rem)] bg-white rounded-md shadow-sm transition-transform duration-200 ease-out ${orderPickupMethod === 'dine-in' ? 'translate-x-0' : 'translate-x-full'}`}
                  />
                  <button
                    type="button"
                    onClick={() => setOrderPickupMethod('dine-in')}
                    className={`relative z-10 flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${orderPickupMethod === 'dine-in' ? 'text-blue-700' : 'text-gray-600'}`}
                  >
                    Dine In
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderPickupMethod('take-away')}
                    className={`relative z-10 flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${orderPickupMethod === 'take-away' ? 'text-green-700' : 'text-gray-600'}`}
                  >
                    Take Away
                  </button>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex space-x-2 mt-3">
              <button
                onClick={() => setShowTableSelectionModal(true)}
                disabled={cartItems.length === 0 || isOnline}
                className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white py-1.5 px-3 rounded-lg transition-colors text-sm"
                title={isOnline ? 'Simpan Order hanya tersedia di tab Offline' : undefined}
              >
                Simpan Order
              </button>
              <button
                onClick={() => setShowPaymentModal(true)}
                disabled={cartItems.length === 0 || hasUnsavedChanges || !canAccessBayarButton}
                className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white py-1.5 px-3 rounded-lg transition-colors text-sm"
                title={
                  !canAccessBayarButton
                    ? 'Anda tidak memiliki izin untuk mengakses tombol Bayar'
                    : hasUnsavedChanges
                      ? 'Simpan perubahan terlebih dahulu sebelum melakukan pembayaran'
                      : 'Bayar'
                }
              >
                Bayar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Product Grid — white bg contrasts with cart (indigo-50) for clear separation */}
      <div className="w-[66%] p-4 flex flex-col h-full relative bg-white">
        {/* Column Count Control and Search */}
        <div className="flex items-center justify-between mb-3 flex-shrink-0 gap-4">
          <div className="flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 text-gray-600" />
            <span className="text-xs text-gray-600">Columns:</span>
            <div className="flex items-center gap-1">
              {[3, 4, 5].map((cols) => (
                <button
                  key={cols}
                  onClick={() => setColumnCount(cols)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${columnCount === cols
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  title={`${cols} columns`}
                >
                  {cols}
                </button>
              ))}
            </div>
          </div>

          {/* Search Bar */}
          {setSearchQuery && (
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari produk atau harga..."
                className="pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm w-full text-black placeholder:text-gray-400"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Loading Overlay for Category Switching */}
        {isLoadingProducts && (
          <div className="absolute inset-0 bg-white/80 z-20 flex items-center justify-center rounded-lg">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-600 text-lg">Loading products...</p>
            </div>
          </div>
        )}

        {/* Product Grid - Scrollable with Fixed Height */}
        <div className="overflow-y-auto mb-4" style={{ height: 'calc(97vh)' }}>
          <div className={`grid ${gridStyles.gridCols} gap-2`}>
            {(() => {

              // Helper function to check if price is null/undefined
              // Note: 0 is handled separately in filtering logic (filtered out in offline mode)
              const isPriceNull = (price: number | null | undefined): boolean => {
                return price === null || price === undefined;
              };

              // First filter by platform/online status and null harga_jual
              let filteredProducts = products.filter((product) => {
                // ALWAYS filter out products with null/undefined/zero harga_jual in offline mode
                if (!isOnline) {
                  // Filter out NULL, undefined, or 0 (0 is used as fallback for products that only have platform prices)
                  if (isPriceNull(product.harga_jual) || product.harga_jual === 0) {
                    return false; // Don't show products with NULL or 0 harga_jual in offline mode
                  }
                  return true;
                }

                // Online mode
                if (!selectedOnlinePlatform) {
                  // Online mode but no platform selected - still check harga_jual
                  if (isPriceNull(product.harga_jual)) {
                    return false;
                  }
                  return true;
                }

                // Online mode with platform selected - check platform price
                const p = getOnlinePriceForPlatform(product);
                // Allow 0 prices, only filter out null prices
                return !isPriceNull(p);
              });


              // Then filter by search query if provided
              if (searchQuery.trim()) {
                const query = searchQuery.trim().toLowerCase();
                const numericQuery = query.replace(/[^\d]/g, ''); // Extract only digits
                const isNumericQuery = numericQuery.length > 0;

                filteredProducts = filteredProducts.filter((product) => {
                  // Check product name match (case-insensitive)
                  const nameMatch = product.nama.toLowerCase().includes(query);

                  // Check price match if query contains numbers
                  let priceMatch = false;
                  if (isNumericQuery) {
                    const productPrice = effectiveProductPrice(product);
                    // Only check price if it's not null
                    if (productPrice !== null) {
                      const priceString = productPrice.toString();
                      priceMatch = priceString.includes(numericQuery);
                    }
                  }

                  return nameMatch || priceMatch;
                });
              }

              if (filteredProducts.length === 0 && !isLoadingProducts) {
                return (
                  <div className={`${gridStyles.colSpan} flex items-center justify-center h-32`}>
                    <p className="text-gray-500">
                      {searchQuery.trim()
                        ? 'No products found matching your search'
                        : isOnline && selectedOnlinePlatform
                          ? `No products available for ${PLATFORM_LABELS[selectedOnlinePlatform]}`
                          : 'No products available'}
                    </p>
                  </div>
                );
              }

              return filteredProducts.map((product) => {
                const isDisabledOnline = false;
                const isBundle = product.is_bundle === 1 || product.is_bundle === true;
                const isPackage = product.is_package === 1 || product.is_package === true;
                const productPrice = effectiveProductPrice(product);

                // Debug: Log if productPrice is null or 0 for products that shouldn't show
                if (productPrice === null) {
                  console.log('⚠️ [CENTER CONTENT] Product with NULL effectivePrice still in filtered list:', {
                    id: product.id,
                    nama: product.nama,
                    harga_jual: product.harga_jual,
                    effectivePrice: productPrice,
                    isOnline: isOnline,
                    platform: selectedOnlinePlatform
                  });
                }

                return (
                  <button
                    key={product.id}
                    onClick={() => handleProductClick(product)}
                    disabled={loadingProductId === product.id || isDisabledOnline}
                    className={`rounded-xl border shadow-md transition-all duration-200 w-full text-left relative ${gridStyles.cardPadding} ${isPackage ? 'bg-amber-50 border-amber-200 hover:border-amber-300 hover:shadow-lg' : 'bg-white border-gray-200 hover:shadow-lg hover:border-gray-300'
                      } ${loadingProductId === product.id || isDisabledOnline ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {/* Loading Overlay */}
                    {loadingProductId === product.id && (
                      <div className="absolute inset-0 bg-white/80 rounded-xl flex items-center justify-center z-10">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                      </div>
                    )}

                    {/* Bundle Badge */}
                    {isBundle && (
                      <div className={`absolute top-1 right-1 bg-purple-500 text-white ${gridStyles.bundleBadgePadding} rounded-full ${gridStyles.bundleBadgeSize} font-semibold z-10`}>
                        Bundle
                      </div>
                    )}

                    {/* Package Badge */}
                    {isPackage && !isBundle && (
                      <div className={`absolute top-1 right-1 bg-amber-500 text-white ${gridStyles.bundleBadgePadding} rounded-full ${gridStyles.bundleBadgeSize} font-semibold z-10`}>
                        Paket
                      </div>
                    )}

                    {/* Product Image - 1st Row */}
                    <div className="relative w-full aspect-square bg-gray-50 rounded-lg mb-2 flex items-center justify-center overflow-hidden">
                      <ProductCardImage
                        imageUrl={product.image_url}
                        productName={product.nama}
                        categoryName={product.category2_name}
                        emojiSize={gridStyles.emojiSize}
                      />
                    </div>

                    {/* Product Info - 2nd Row */}
                    <div className="space-y-1">
                      {/* Product Name */}
                      <h3 className={`font-medium text-gray-800 ${gridStyles.productNameSize} leading-tight line-clamp-2`}>{product.nama}</h3>
                      {/* Price - Only show if price is not null */}
                      {productPrice !== null && (
                        <div className="flex items-baseline">
                          <span className={`text-gray-600 ${gridStyles.priceLabelSize}`}>RP</span>
                          <span className={`text-green-600 font-bold ${gridStyles.priceValueSize} ml-0.5`}>
                            {productPrice.toLocaleString('id-ID')}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              });
            })()}
          </div>
        </div>

        {/* Action Buttons - Fixed Footer */}
        <div className="py-2 mb-6 flex-shrink-0">
          <div className="flex justify-between items-center space-x-2">
            <button disabled className="flex-1 bg-gray-300 border border-gray-300 rounded px-2 py-2 text-gray-400 cursor-not-allowed opacity-50 flex items-center justify-center space-x-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span className="text-xs line-through">Ambil Pesanan</span>
            </button>

            <button disabled className="flex-1 bg-gray-300 border border-gray-300 rounded px-2 py-2 text-gray-400 cursor-not-allowed opacity-50 flex items-center justify-center space-x-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              <span className="text-xs line-through">Kupon</span>
            </button>

            <button disabled className="flex-1 bg-gray-300 border border-gray-300 rounded px-2 py-2 text-gray-400 cursor-not-allowed opacity-50 flex items-center justify-center space-x-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-xs line-through">Aktivitas</span>
            </button>

            <button disabled className="flex-1 bg-gray-300 border border-gray-300 rounded px-2 py-2 text-gray-400 cursor-not-allowed opacity-50 flex items-center justify-center space-x-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
              <span className="text-xs line-through">Menukarkan</span>
            </button>
          </div>
        </div>
      </div>

      {/* Product Customization Modal */}
      <ProductCustomizationModal
        isOpen={showCustomizationModal}
        onClose={() => {
          setShowCustomizationModal(false);
          setSelectedProduct(null);
        }}
        product={selectedProduct as unknown as { id: number; business_id: number; menu_code: string; nama: string; kategori: string; harga_jual: number; status: string } | null}
        effectivePrice={selectedProduct ? (effectiveProductPrice(selectedProduct) ?? undefined) : undefined}
        onAddToCart={(product, customizations, quantity, customNote) => {
          const centerProduct = product as unknown as Product;
          addToCart(centerProduct, customizations, quantity, customNote);
        }}
      />

      {/* Payment Modal */}
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        initialCustomerName={customerName}
        initialCustomerUnit={cuValue}
        loadedTransactionInfo={loadedTransactionInfo}
        pickupMethod={orderPickupMethod}
        cartItems={cartItems as unknown as Array<{
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
          bundleSelections?: BundleSelection[];
        }>}
        onPaymentComplete={handlePaymentComplete}
        transactionType={(transactionType === 'foods' || transactionType === 'packages') ? 'drinks' : transactionType}
        isOnline={isOnline}
        selectedOnlinePlatform={selectedOnlinePlatform}
        waiterId={selectedWaiterId}
      />

      {/* Table Selection Modal */}
      <TableSelectionModal
        isOpen={showTableSelectionModal}
        onClose={() => setShowTableSelectionModal(false)}
        customerName={customerName}
        customerUnit={cuValue}
        pickupMethod={orderPickupMethod}
        loadedTransactionInfo={loadedTransactionInfo}
        onItemsLocked={(itemIds) => {
          // Mark items as locked after saving
          const newCartItems = cartItems.map(item =>
            itemIds.includes(item.id) ? { ...item, isLocked: true } : item
          );
          setCartItems(newCartItems);
          sendCartUpdate(newCartItems);
          // After saving, unsaved changes flag will be cleared automatically
          // (hasUnsavedChanges checks for items with !isLocked, and now all items are locked)
        }}
        cartItems={cartItems as unknown as Array<{
          id: number;
          product: {
            id: number;
            harga_jual: number;
            harga_qpon?: number;
            harga_gofood?: number;
            harga_grabfood?: number;
            harga_shopeefood?: number;
            harga_tiktok?: number;
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
          bundleSelections?: Array<{
            selectedProducts: Array<{
              product: { id: number; nama: string };
              quantity?: number;
              customizations?: Array<{ selected_options: Array<{ option_name: string }> }>;
              customNote?: string;
            }>;
          }>;
        }>}
        transactionType={(transactionType === 'foods' || transactionType === 'packages') ? 'drinks' : transactionType}
        waiterId={selectedWaiterId}
        onSuccess={() => {
          console.log('🔍 [CENTER CONTENT] Transaction saved successfully with waiterId:', selectedWaiterId);
          // Only clear cart for new orders, not for "lihat" mode
          if (!loadedTransactionInfo) {
            // New order: clear cart, customer name, CU, and waiter after successful save
            setCartItems([]);
            sendCartUpdate([]);
            setCustomerName('');
            setCuValue('1');
            setSelectedWaiterId(null);
            setSelectedWaiterName(null);
            setSelectedWaiterColor(null);
          } else {
            // "Lihat" mode: reload transaction to get updated items with correct transactionItemId
            // After reload, all items will be locked, so unsaved changes flag will be cleared automatically
            if (onReloadTransaction && loadedTransactionInfo.transactionId) {
              onReloadTransaction(loadedTransactionInfo.transactionId);
            }
          }
        }}
      />

      {/* Custom Note Modal */}
      <CustomNoteModal
        isOpen={showCustomNoteModal}
        onClose={() => {
          setShowCustomNoteModal(false);
          setSelectedProduct(null);
        }}
        product={selectedProduct as unknown as { id: number; business_id: number; menu_code: string; nama: string; kategori: string; harga_jual: number; status: string } | null}
        effectivePrice={selectedProduct ? (effectiveProductPrice(selectedProduct) ?? undefined) : undefined}
        onConfirm={handleCustomNoteConfirm}
      />

      {/* Edit Item Modal */}
      <EditItemModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedCartItem(null);
        }}
        cartItem={selectedCartItem as unknown as {
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
        } | null}
        effectivePrice={selectedCartItem ? (effectiveProductPrice(selectedCartItem.product) ?? undefined) : undefined}
        onUpdate={(updatedItem) => {
          const centerCartItem = updatedItem as unknown as CartItem;
          handleUpdateItem(centerCartItem);
        }}
      />

      {/* Bundle Selection Modal */}
      {selectedProduct && (
        <BundleSelectionModal
          isOpen={showBundleModal}
          onClose={() => {
            setShowBundleModal(false);
            setSelectedProduct(null);
            setBundleItems([]);
          }}
          onConfirm={handleBundleConfirm}
          bundleProduct={{
            id: selectedProduct.id,
            nama: selectedProduct.nama,
            harga_jual: selectedProduct.harga_jual ?? 0
          }}
          bundleItems={bundleItems}
        />
      )}

      {/* Package Selection Modal */}
      {selectedProduct && (selectedProduct.is_package === 1 || selectedProduct.is_package === true) && (
        <PackageSelectionModal
          isOpen={showPackageModal}
          onClose={() => {
            setShowPackageModal(false);
            setSelectedProduct(null);
            setPackageItemsForModal([]);
          }}
          onConfirm={handlePackageConfirm}
          packageProduct={{
            id: selectedProduct.id,
            nama: selectedProduct.nama,
            harga_jual: selectedProduct.harga_jual ?? 0
          }}
          packageItems={packageItemsForModal}
        />
      )}

      {/* Password Modal for Locked Items */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Verifikasi Password</h2>
            <p className="text-sm text-gray-600 mb-4">
              Item ini sudah dikirim ke kitchen/barista. Masukkan password untuk melanjutkan.
            </p>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handlePasswordSubmit();
                }
              }}
              placeholder="ketik KONFIRMASI"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordInput('');
                  setPendingLockedItemAction(null);
                }}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handlePasswordSubmit}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Verifikasi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Waiter Selection Modal */}
      <WaiterSelectionModal
        isOpen={showWaiterModal}
        onClose={() => setShowWaiterModal(false)}
        onSelect={async (employeeId, employeeName, employeeColor) => {
          console.log('🔍 [CENTER CONTENT] Waiter selected:', { employeeId, employeeName, employeeColor });
          setSelectedWaiterId(employeeId);
          setSelectedWaiterName(employeeName);
          setSelectedWaiterColor(employeeColor);
          setShowWaiterModal(false);
          // When viewing existing order (lihat), do NOT update transaction-level waiter.
          // This selection is only for "who is adding new items" (item-level waiter_id).
        }}
        businessId={businessId}
      />
    </div>
  );
}
