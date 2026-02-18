'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Volume2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { isSuperAdmin } from '@/lib/auth';
import { OrderTimer } from '@/contexts/DisplayTimerContext';
import { getPackageBreakdownLines, getPackageBreakdownLinesWithProductId } from './PackageSelectionModal';

interface OrderItem {
  id: number;
  uuid_id: string;
  transaction_id: string;
  product_id: number;
  product_name: string;
  quantity: number;
  custom_note: string | null;
  production_status: string | null;
  production_started_at: string | null;
  production_finished_at: string | null;
  table_number: string | null;
  room_name: string | null;
  customer_name: string | null;
  pickup_method?: 'dine-in' | 'take-away';
  created_at: string;
  platform_label: string;
  customizations: Array<{
    customization_name: string;
    options: Array<{
      option_name: string;
      price_adjustment: number;
    }>;
  }>;
  /** Package breakdown lines (from DB: id, finished_at; or from JSON fallback). Filtered lines include originalIdx. */
  packageBreakdownLines?: { id?: number; product_id: number; product_name: string; quantity: number; category1_id?: number; category1_name?: string; originalIdx?: number; finished_at?: string | null; note?: string }[];
  /** Full unfiltered package breakdown (all lines) for completion tracking. */
  originalPackageBreakdownLines?: { id?: number; product_id: number; product_name: string; quantity: number; category1_id?: number; category1_name?: string; finished_at?: string | null; note?: string }[];
  /** Legacy: per-line completion (JSON). Prefer line.finished_at from DB when available. */
  package_line_finished_at?: Record<string, string>;
}

const OFFLINE_PAYMENT_CODES = new Set(['cash', 'debit', 'qr', 'ewallet', 'cl', 'voucher', 'offline', 'tunai', 'edc']);

function getPlatformLabel(paymentMethod: string | null | undefined): string {
  const code = (paymentMethod || '').toString().trim().toLowerCase();
  if (!code || OFFLINE_PAYMENT_CODES.has(code)) return 'Offline';
  switch (code) {
    case 'gofood': return 'GoFood';
    case 'grabfood': return 'GrabFood';
    case 'shopeefood': return 'ShopeeFood';
    case 'qpon': return 'Qpon';
    case 'tiktok': return 'TikTok';
    default: return code.charAt(0).toUpperCase() + code.slice(1);
  }
}

interface GroupedOrderItem extends OrderItem {
  total_quantity: number;
  display_text: string;
  timer: string;
}

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

/** Cache TTL for static data (products, tables, rooms) - refresh every 5 minutes */
const STATIC_DATA_CACHE_TTL_MS = 5 * 60 * 1000;

/** Limit for today's transactions (kitchen display - only needs today's active orders) */
const TODAY_TRANSACTIONS_LIMIT = 200;

export default function KitchenDisplay({ viewOnly = false, legacyCardLayout = false, enableSound }: { viewOnly?: boolean; legacyCardLayout?: boolean; enableSound?: boolean; }) {
  const { user } = useAuth();
  const [activeOrders, setActiveOrders] = useState<GroupedOrderItem[]>([]);
  const [finishedOrders, setFinishedOrders] = useState<GroupedOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const previousOrderIdsRef = useRef<Set<string>>(new Set());
  const hasCompletedInitialFetchRef = useRef(false);
  const soundRef = useRef<HTMLAudioElement | null>(null);
  const optimisticFinishedRef = useRef<Map<string, GroupedOrderItem>>(new Map());
  const persistingIdsRef = useRef<Set<string>>(new Set());
  /** Last finished list we displayed; used so a stale fetch never moves an item back to active. */
  const lastFinishedMapRef = useRef<Map<string, GroupedOrderItem>>(new Map());
  /** Cache for products, tables, rooms - reduces DB load during polling */
  const staticDataCacheRef = useRef<{
    productsMap: Map<number, Record<string, unknown>>;
    tablesMap: Map<number, { table_number: string; room_id: number }>;
    roomsMap: Map<number, string>;
    fetchedAt: number;
  } | null>(null);

  const businessId = user?.selectedBusinessId;

  /** For package items: which sub-item indices are checked (double-click). Used for legacy lines without DB id; DB lines use line.finished_at. */
  const [packageCheckedSubItems, setPackageCheckedSubItems] = useState<Map<string, Set<number>>>(() => new Map());
  /** Optimistic finished_at per package line so "X Menit" shows immediately without waiting for fetch (avoids timer flicker). */
  const [optimisticPackageLineFinishedAt, setOptimisticPackageLineFinishedAt] = useState<Map<string, Map<number, string>>>(() => new Map());
  /** DB persist status for finished cards: processing | success | error (shown at bottom right). */
  const [persistStatusMap, setPersistStatusMap] = useState<Map<string, { status: 'processing' | 'success' | 'error'; message?: string }>>(() => new Map());

  if (!businessId) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center p-8 bg-white rounded-lg shadow-lg">
          <h2 className="text-xl font-bold text-red-600 mb-2">No Business Selected</h2>
          <p className="text-gray-700">Please log in and select a business to access the Kitchen Display.</p>
        </div>
      </div>
    );
  }

  // Check permission - if viewOnly, also check for access_baristaandkitchen
  const hasKitchenPermission = user?.permissions?.includes('access_kitchen') || false;
  const hasBaristaKitchenPermission = user?.permissions?.includes('access_baristaandkitchen') || false;
  const hasPermission = hasKitchenPermission || (viewOnly && hasBaristaKitchenPermission);

  if (!isSuperAdmin(user) && !hasPermission) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center p-8 bg-white rounded-lg shadow-lg">
          <h2 className="text-xl font-bold text-red-600 mb-2">Access Denied</h2>
          <p className="text-gray-700">You do not have permission to access the Kitchen Display.</p>
        </div>
      </div>
    );
  }

  // Fetch orders from database
  const fetchOrders = useCallback(async () => {
    try {
      const electronAPI = getElectronAPI();
      if (!electronAPI) {
        console.error('Electron API not available');
        return;
      }

      // Fetch only today's transactions (pending, paid, completed) - optimized for display performance
      const transactions = await electronAPI.localDbGetTransactions?.(businessId, TODAY_TRANSACTIONS_LIMIT, { todayOnly: true });
      const transactionsArray = Array.isArray(transactions) ? transactions as Record<string, unknown>[] : [];
      const relevantTransactions = transactionsArray;

      // Use cached products/tables/rooms when fresh to reduce DB load
      const now = Date.now();
      let productsMap: Map<number, Record<string, unknown>>;
      let tablesMap: Map<number, { table_number: string; room_id: number }>;
      let roomsMap: Map<number, string>;
      if (staticDataCacheRef.current && (now - staticDataCacheRef.current.fetchedAt) < STATIC_DATA_CACHE_TTL_MS) {
        productsMap = staticDataCacheRef.current.productsMap;
        tablesMap = staticDataCacheRef.current.tablesMap;
        roomsMap = staticDataCacheRef.current.roomsMap;
      } else {
        const allProducts = await electronAPI.localDbGetAllProducts?.();
        const productsArray = Array.isArray(allProducts) ? allProducts as Record<string, unknown>[] : [];
        productsMap = new Map<number, Record<string, unknown>>();
        productsArray.forEach((p) => {
          const id = typeof p.id === 'number' ? p.id : (typeof p.id === 'string' ? parseInt(p.id, 10) : null);
          if (id) {
            productsMap.set(id, p);
          }
        });
        tablesMap = new Map<number, { table_number: string; room_id: number }>();
        roomsMap = new Map<number, string>();
        if (electronAPI.getRestaurantRooms) {
          const rooms = await electronAPI.getRestaurantRooms(businessId);
          const roomsArray = Array.isArray(rooms) ? rooms as { id: number; name: string }[] : [];
          roomsArray.forEach((room) => {
            if (room.id) {
              roomsMap.set(room.id, room.name);
            }
          });
          for (const room of roomsArray) {
            if (room.id && electronAPI.getRestaurantTables) {
              const tables = await electronAPI.getRestaurantTables(room.id);
              const tablesArray = Array.isArray(tables) ? tables as { id: number; table_number: string; room_id: number }[] : [];
              tablesArray.forEach((table) => {
                tablesMap.set(table.id, { table_number: table.table_number, room_id: table.room_id });
              });
            }
          }
        }
        staticDataCacheRef.current = { productsMap, tablesMap, roomsMap, fetchedAt: now };
      }

      // Fetch transaction items for all relevant transactions
      const allOrderItems: OrderItem[] = [];

      for (const tx of relevantTransactions) {
        const transactionId = (typeof tx.uuid_id === 'string' ? tx.uuid_id : null) ||
          (typeof tx.id === 'string' ? tx.id : (typeof tx.id === 'number' ? tx.id.toString() : null)) ||
          '';
        const items = await electronAPI.localDbGetTransactionItems?.(transactionId);
        const itemsArray = Array.isArray(items) ? items as Record<string, unknown>[] : [];

        // Fetch customizations
        const customizationsData = await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(transactionId);
        const customizations = Array.isArray(customizationsData?.customizations) ? customizationsData.customizations as Record<string, unknown>[] : [];
        const customizationOptions = Array.isArray(customizationsData?.options) ? customizationsData.options as Record<string, unknown>[] : [];

        // Create customizations map
        const customizationsMap = new Map<number, Array<{
          customization_name: string;
          options: Array<{ option_name: string; price_adjustment: number }>;
        }>>();

        customizations.forEach((cust) => {
          const itemId = typeof cust.transaction_item_id === 'string'
            ? parseInt(cust.transaction_item_id, 10)
            : (typeof cust.transaction_item_id === 'number' ? cust.transaction_item_id : 0);

          if (!customizationsMap.has(itemId)) {
            customizationsMap.set(itemId, []);
          }

          const options = customizationOptions
            .filter((opt) => opt.transaction_item_customization_id === cust.id)
            .map((opt) => ({
              option_name: typeof opt.option_name === 'string' ? opt.option_name : String(opt.option_name || ''),
              price_adjustment: typeof opt.price_adjustment === 'number'
                ? opt.price_adjustment
                : (typeof opt.price_adjustment === 'string' ? parseFloat(opt.price_adjustment) || 0 : 0),
            }));

          const customizationName = typeof cust.customization_type_name === 'string' ? cust.customization_type_name : null;
          const customizationTypeId = typeof cust.customization_type_id === 'number' ? cust.customization_type_id : (typeof cust.customization_type_id === 'string' ? parseInt(cust.customization_type_id, 10) : null);
          const existingCust = customizationsMap.get(itemId)!.find(c =>
            c.customization_name === customizationName
          );

          if (existingCust) {
            existingCust.options.push(...options);
          } else {
            customizationsMap.get(itemId)!.push({
              customization_name: customizationName || `Customization ${customizationTypeId || ''}`,
              options,
            });
          }
        });

        // Process items
        for (const item of itemsArray) {
          const productId = typeof item.product_id === 'number' ? item.product_id : (typeof item.product_id === 'string' ? parseInt(item.product_id, 10) : null);
          if (!productId) continue;

          const product = productsMap.get(productId);
          if (!product) continue;

          // Filter by category: makanan and bakery for kitchen; also include package products (category1_id 14) so we show their breakdown by line category
          const categoryName = typeof product.category1_name === 'string' ? product.category1_name.toLowerCase() : null;
          const category1Id = typeof product.category1_id === 'number' ? product.category1_id : (typeof product.category1_id === 'string' ? parseInt(String(product.category1_id), 10) : null);
          const isPackageProduct = category1Id === 14 || (product as { is_package?: number }).is_package === 1;
          if (!isPackageProduct && categoryName !== 'makanan' && categoryName !== 'bakery') {
            continue;
          }

          const tableId = typeof tx.table_id === 'number' ? tx.table_id : (typeof tx.table_id === 'string' ? parseInt(tx.table_id, 10) : null);
          const tableInfo = tableId && tablesMap.has(tableId) ? tablesMap.get(tableId)! : null;
          const tableNumber = tableInfo ? tableInfo.table_number : null;
          const roomId = tableInfo ? tableInfo.room_id : null;
          const roomName = roomId && roomsMap.has(roomId) ? roomsMap.get(roomId)! : null;
          const customerName = typeof tx.customer_name === 'string' ? tx.customer_name : null;

          const itemId = typeof item.id === 'number' ? item.id : (typeof item.id === 'string' ? parseInt(item.id, 10) : null);
          const itemCustomizations = itemId ? customizationsMap.get(itemId) || [] : [];

          const itemUuidId = typeof item.uuid_id === 'string' ? item.uuid_id : (itemId ? itemId.toString() : '');
          const itemQuantity = typeof item.quantity === 'number' ? item.quantity : (typeof item.quantity === 'string' ? parseInt(item.quantity, 10) : 1);
          const itemCustomNote = typeof item.custom_note === 'string' ? item.custom_note : null;
          const itemProductionStatus = typeof item.production_status === 'string' ? item.production_status : null;

          // Filter out cancelled items - they should not appear on kitchen display
          if (itemProductionStatus === 'cancelled') {
            continue;
          }

          const itemProductionStartedAt = typeof item.production_started_at === 'string' ? item.production_started_at : (item.production_started_at instanceof Date ? item.production_started_at.toISOString() : null);
          const itemProductionFinishedAt = typeof item.production_finished_at === 'string' ? item.production_finished_at : (item.production_finished_at instanceof Date ? item.production_finished_at.toISOString() : null);
          const itemCreatedAt = typeof item.created_at === 'string' ? item.created_at : (item.created_at instanceof Date ? item.created_at.toISOString() : null);
          const txCreatedAt = typeof tx.created_at === 'string' ? tx.created_at : (tx.created_at instanceof Date ? tx.created_at.toISOString() : null);
          const productNama = typeof product.nama === 'string' ? product.nama : 'Unknown';

          // Prefer packageBreakdownLines from DB (id + finished_at); fallback to package_selections_json
          let packageBreakdownLines: { id?: number; product_id: number; product_name: string; quantity: number; category1_id?: number; category1_name?: string; finished_at?: string | null; note?: string }[] | undefined;
          const dbLines = (item as Record<string, unknown>).packageBreakdownLines;
          if (Array.isArray(dbLines) && dbLines.length > 0) {
            // DB stores per-package quantity; show as-is (header "Paket: 2x ..." indicates package count)
            packageBreakdownLines = dbLines.map((l: Record<string, unknown>) => ({
              id: typeof l.id === 'number' ? l.id : undefined,
              product_id: l.product_id as number,
              product_name: (l.product_name as string) || '',
              quantity: (l.quantity as number) || 1,
              category1_id: l.category1_id != null ? (typeof l.category1_id === 'number' ? l.category1_id : parseInt(String(l.category1_id), 10)) : undefined,
              category1_name: l.category1_name != null ? String(l.category1_name) : undefined,
              finished_at: l.finished_at != null ? String(l.finished_at) : null,
              note: l.note != null ? String(l.note) : undefined,
            }));
          } else {
            try {
              const raw = (item as Record<string, unknown>).package_selections_json;
              if (raw) {
                const sel = typeof raw === 'string' ? JSON.parse(raw) : raw;
                const withId = getPackageBreakdownLinesWithProductId(Array.isArray(sel) ? sel : [], itemQuantity);
                if (withId.length > 0) {
                  packageBreakdownLines = withId.map((line) => {
                    const p = productsMap.get(line.product_id) as Record<string, unknown> | undefined;
                    const category1_id = p && (typeof p.category1_id === 'number' || typeof p.category1_id === 'string') ? (typeof p.category1_id === 'number' ? p.category1_id : parseInt(String(p.category1_id), 10)) : undefined;
                    const category1_name = p && typeof p.category1_name === 'string' ? p.category1_name : undefined;
                    return { ...line, category1_id, category1_name };
                  });
                }
              }
            } catch (e) {
              if (isPackageProduct && process.env.NODE_ENV !== 'production') {
                console.warn('[KitchenDisplay] Failed to parse package_selections_json:', productNama, e);
              }
            }
          }

          // CRITICAL FIX: Use transaction created_at as the source of truth for timer
          // If item.created_at is null, use transaction.created_at (when item was ordered)
          // Only fall back to current time if BOTH are null (should never happen in normal operation)
          let finalCreatedAt: string;
          if (itemCreatedAt) {
            finalCreatedAt = itemCreatedAt;
          } else if (txCreatedAt) {
            // Use transaction created_at as fallback - this is when the order was placed
            finalCreatedAt = txCreatedAt;
          } else {
            // Last resort: use current time (but log warning)
            console.warn('Both item.created_at and tx.created_at are null, using current time (this should not happen):', { itemId, transactionId, productId });
            finalCreatedAt = new Date().toISOString();
          }

          // Validate the date string
          const testDate = new Date(finalCreatedAt);

          if (isNaN(testDate.getTime())) {
            console.warn('Invalid created_at date detected, using current time:', { txCreatedAt, itemCreatedAt, finalCreatedAt });
            finalCreatedAt = new Date().toISOString();
          }

          allOrderItems.push({
            id: itemId || 0,
            uuid_id: itemUuidId,
            transaction_id: transactionId,
            product_id: productId,
            product_name: productNama,
            quantity: itemQuantity,
            custom_note: itemCustomNote,
            production_status: itemProductionStatus,
            production_started_at: itemProductionStartedAt,
            production_finished_at: itemProductionFinishedAt,
            table_number: tableNumber || null,
            room_name: roomName || null,
            customer_name: customerName || null,
            pickup_method: (() => {
              const paymentCode = (typeof tx.payment_method === 'string' ? tx.payment_method : (tx.payment_method != null ? String(tx.payment_method) : '')).trim().toLowerCase();
              const isPlatformOrder = !!paymentCode && !OFFLINE_PAYMENT_CODES.has(paymentCode);
              if (isPlatformOrder) return 'take-away' as const;
              return (typeof tx.pickup_method === 'string' && (tx.pickup_method === 'take-away' || tx.pickup_method === 'dine-in')) ? tx.pickup_method as 'dine-in' | 'take-away' : 'dine-in';
            })(),
            platform_label: getPlatformLabel(typeof tx.payment_method === 'string' ? tx.payment_method : (tx.payment_method != null ? String(tx.payment_method) : undefined)),
            created_at: finalCreatedAt,
            customizations: itemCustomizations,
            packageBreakdownLines: packageBreakdownLines?.length ? packageBreakdownLines : undefined,
          });
        }
      }

      // Group items by product_id + customization signature
      // Track all items in each group to check if all are finished
      const groupedMap = new Map<string, GroupedOrderItem>();
      const groupItemsMap = new Map<string, OrderItem[]>();

      // Kitchen: Makanan (1), Bakery (5) - match by id or name
      const KITCHEN_CATEGORY_IDS = [1, 5];
      const KITCHEN_CATEGORY_NAMES = ['makanan', 'bakery'];
      const lineBelongsToKitchen = (line: { category1_id?: number; category1_name?: string }) => {
        const id = line.category1_id;
        const name = (line.category1_name || '').toString().trim().toLowerCase();
        if (id != null && KITCHEN_CATEGORY_IDS.includes(id)) return true;
        if (name && KITCHEN_CATEGORY_NAMES.includes(name)) return true;
        return false;
      };

      allOrderItems.forEach(item => {
        // For package items: show only breakdown lines that belong to Kitchen (makanan/bakery); skip package on this display if none match
        let itemForGroup = item;
        if (item.packageBreakdownLines && item.packageBreakdownLines.length > 0) {
          const originalLines = item.packageBreakdownLines;
          const filteredWithIndices = originalLines
            .map((line, originalIdx) => ({ ...line, originalIdx }))
            .filter(line => lineBelongsToKitchen(line));
          if (filteredWithIndices.length === 0) return; // Do not show this package on Kitchen
          itemForGroup = {
            ...item,
            packageBreakdownLines: filteredWithIndices,
            originalPackageBreakdownLines: originalLines,
          };
        }

        // Create customization signature
        const allOptionIds: number[] = [];
        itemForGroup.customizations.forEach(customization => {
          customization.options.forEach(option => {
            // Use option name for signature (since we don't have option_id here)
            allOptionIds.push(option.option_name.charCodeAt(0)); // Simple hash
          });
        });
        const sortedOptionIds = allOptionIds.sort((a, b) => a - b).join(',');
        const customNote = itemForGroup.custom_note || '';
        // Include table_number in signature to prevent grouping items from different tables
        const tableNumber = itemForGroup.table_number || '';
        // Include uuid_id to ensure each item is unique (one line per item, no grouping)
        const itemUuid = itemForGroup.uuid_id || itemForGroup.id?.toString() || '';
        const signature = `${itemForGroup.product_id}_${sortedOptionIds}_${customNote}_${tableNumber}_${itemUuid}`;

        // Track all items in this group (each item has unique signature now, so groups will be size 1)
        if (!groupItemsMap.has(signature)) {
          groupItemsMap.set(signature, []);
        }
        groupItemsMap.get(signature)!.push(itemForGroup);

        // Since each item has unique signature (includes uuid_id), this will always be a new entry
        // Build display text: 1x [platform name] [product name] for online; 1x [product name] for offline
        const platformPrefix = itemForGroup.platform_label === 'Offline' ? '' : `[${itemForGroup.platform_label}] `;
        let displayText = `${itemForGroup.quantity}x ${platformPrefix}${itemForGroup.product_name}`;

        // Add customizations
        const customizationTexts: string[] = [];
        itemForGroup.customizations.forEach(customization => {
          customization.options.forEach(option => {
            const priceText = option.price_adjustment !== 0
              ? ` (+${option.price_adjustment})`
              : '';
            customizationTexts.push(`+${option.option_name}${priceText}`);
          });
        });
        if (customizationTexts.length > 0) {
          displayText += ` ${customizationTexts.join(', ')}`;
        }

        // Add custom note
        if (itemForGroup.custom_note) {
          displayText += ` note: ${itemForGroup.custom_note}`;
        }

        groupedMap.set(signature, {
          ...itemForGroup,
          total_quantity: itemForGroup.quantity,
          display_text: displayText,
          timer: '00:00', // Rendered by OrderTimer component
        });
      });

      // Separate active and finished orders
      const active: GroupedOrderItem[] = [];
      const finished: GroupedOrderItem[] = [];
      const finishedUuids = new Set<string>();

      groupedMap.forEach((item, signature) => {
        const groupedItem = {
          ...item,
          timer: '00:00', // Rendered by OrderTimer component
        };

        const itemsInGroup = groupItemsMap.get(signature) || [];
        const isPackage = groupedItem.packageBreakdownLines && groupedItem.packageBreakdownLines.length > 0;
        let shouldBeFinished: boolean;
        if (isPackage) {
          // Packages: finished when all visible (kitchen) lines have finished_at set
          shouldBeFinished = groupedItem.packageBreakdownLines!.every((line) => line.finished_at != null);
        } else {
          // Non-packages: finished when all items have production_status === 'finished'
          shouldBeFinished = itemsInGroup.length > 0 && itemsInGroup.every(i => i.production_status === 'finished');
        }
        if (shouldBeFinished) {
          if (!finishedUuids.has(groupedItem.uuid_id)) {
            finishedUuids.add(groupedItem.uuid_id);
            groupedItem.production_status = 'finished';
            if (isPackage && groupedItem.packageBreakdownLines?.length) {
              // Packages: production_finished_at from line times (display/filter only, not persisted)
              const lineTimes = groupedItem.packageBreakdownLines
                .map((l) => l.finished_at ? new Date(l.finished_at).getTime() : 0)
                .filter((t) => t > 0);
              groupedItem.production_finished_at = lineTimes.length > 0
                ? new Date(Math.max(...lineTimes)).toISOString()
                : new Date().toISOString();
            } else {
              // Non-packages: production_finished_at from transaction item
              const finishedTimes = itemsInGroup
                .map(i => i.production_finished_at)
                .filter((t): t is string => t !== null)
                .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
              if (finishedTimes.length > 0) {
                groupedItem.production_finished_at = finishedTimes[0];
              } else {
                const itemFinishedAt = itemsInGroup[0]?.production_finished_at;
                if (itemFinishedAt) groupedItem.production_finished_at = itemFinishedAt;
              }
            }
            finished.push(groupedItem);
          }
        } else {
          active.push(groupedItem);
        }
      });

      // Sort active by created_at (oldest first)
      active.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      // Sort finished by finished_at (most recent first)
      finished.sort((a, b) => {
        const aTime = a.production_finished_at ? new Date(a.production_finished_at).getTime() : 0;
        const bTime = b.production_finished_at ? new Date(b.production_finished_at).getTime() : 0;
        return bTime - aTime;
      });

      // Merge with optimistically finished items; keep packages in finished until DB reflects them
      const optMap = optimisticFinishedRef.current;
      for (const f of finished) {
        optMap.delete(f.uuid_id);
      }
      const lastFinished = lastFinishedMapRef.current;
      // Keep in finished if we previously had them finished (avoids package items reappearing in active after payment when fetch is stale)
      const keptAsFinished = active
        .filter((x) => lastFinished.has(x.uuid_id))
        .map((x) => lastFinished.get(x.uuid_id)!);
      const activeFiltered = active.filter((x) => !optMap.has(x.uuid_id) && !lastFinished.has(x.uuid_id));
      const finishedByUuid = new Map<string, GroupedOrderItem>();
      for (const x of [...finished, ...optMap.values(), ...keptAsFinished]) {
        if (!finishedByUuid.has(x.uuid_id)) finishedByUuid.set(x.uuid_id, x);
      }
      let finishedMerged = Array.from(finishedByUuid.values());
      finishedMerged.sort((a, b) => {
        const aTime = a.production_finished_at ? new Date(a.production_finished_at).getTime() : 0;
        const bTime = b.production_finished_at ? new Date(b.production_finished_at).getTime() : 0;
        return bTime - aTime;
      });

      // Only show Pesanan Selesai from today to avoid unbounded list and keep relevance
      const nowDate = new Date();
      const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), 0, 0, 0, 0).getTime();
      const todayEnd = todayStart + 24 * 60 * 60 * 1000 - 1;
      finishedMerged = finishedMerged.filter((item) => {
        let finishedAt: number;
        if (item.packageBreakdownLines && item.packageBreakdownLines.length > 0) {
          // Packages: use line times (transaction item production_finished_at may be unset)
          const lineTimes = item.packageBreakdownLines
            .map((l) => l.finished_at ? new Date(l.finished_at).getTime() : 0)
            .filter((t) => t > 0);
          finishedAt = lineTimes.length > 0 ? Math.max(...lineTimes) : 0;
        } else {
          // Non-packages: use production_finished_at from transaction item
          finishedAt = item.production_finished_at ? new Date(item.production_finished_at).getTime() : 0;
        }
        return finishedAt >= todayStart && finishedAt <= todayEnd;
      });
      // Cap finished list to avoid performance degradation with many items
      const FINISHED_CAP = 150;
      if (finishedMerged.length > FINISHED_CAP) {
        finishedMerged = finishedMerged.slice(0, FINISHED_CAP);
      }

      // Include both package and non-package items so completed package items stay in "pesanan selesai" after payment
      lastFinishedMapRef.current = new Map(finishedMerged.map((x) => [x.uuid_id, x]));
      // Clear optimistic strikethrough and line finished_at for items now in finished (polling confirmed)
      setPackageCheckedSubItems((prev) => {
        const next = new Map(prev);
        finishedMerged.forEach((order) => next.delete(order.uuid_id));
        return next;
      });
      setOptimisticPackageLineFinishedAt((prev) => {
        const next = new Map(prev);
        finishedMerged.forEach((order) => next.delete(order.uuid_id));
        return next;
      });
      setActiveOrders(activeFiltered);
      setFinishedOrders(finishedMerged);

      // Check for new orders and play sound (only on standalone Kitchen display, not in Barista & Kitchen combined view)
      // Use hasCompletedInitialFetchRef so we don't play on very first page load; do NOT use loading here because
      // fetchOrders runs from setInterval and the callback closes over stale loading (stays true), so sound would never play.
      const shouldPlaySound = enableSound ?? !viewOnly;
      if (shouldPlaySound && hasCompletedInitialFetchRef.current) {
        const currentOrderIds = new Set(activeFiltered.map(order => order.uuid_id));
        const newOrderIds = [...currentOrderIds].filter(id => !previousOrderIdsRef.current.has(id));
        if (newOrderIds.length > 0) {
          try {
            // #region agent log
            const isFileProtocol = typeof window !== 'undefined' && window.location?.protocol === 'file:';
            const soundPath = isFileProtocol ? './blacksmith_refine.mp3' : '/blacksmith_refine.mp3';
            const resolvedUrl = typeof window !== 'undefined' ? new URL(soundPath, window.location.href).href : soundPath;
            fetch('http://127.0.0.1:7245/ingest/519de021-d49d-473f-a8a1-4215977c867a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'KitchenDisplay.tsx:sound',message:'New order sound attempt',data:{protocol:window?.location?.protocol,soundPath,resolvedUrl,newOrderCount:newOrderIds.length},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            if (!soundRef.current) {
              soundRef.current = new Audio(soundPath);
              soundRef.current.volume = 0.7;
            }
            soundRef.current.pause();
            soundRef.current.currentTime = 0;
            soundRef.current.play().catch(error => {
              // #region agent log
              fetch('http://127.0.0.1:7245/ingest/519de021-d49d-473f-a8a1-4215977c867a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'KitchenDisplay.tsx:play',message:'Sound play failed',data:{error:String(error),name:(error as Error)?.name},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
              // #endregion
              console.warn('Failed to play sound:', error);
            });
          } catch (error) {
            console.warn('Error playing sound:', error);
          }
        }
      }

      hasCompletedInitialFetchRef.current = true;
      // Update previous order IDs
      previousOrderIdsRef.current = new Set(activeFiltered.map(order => order.uuid_id));

      setLoading(false);
    } catch (error) {
      console.error('Error fetching orders:', error);
      setLoading(false);
    }
  }, [businessId]);

  const formatTimeHHmm = (dateTime: string | null | undefined): string => {
    if (!dateTime) return '-';
    const date = new Date(dateTime);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const formatDurationMinutes = (startTime: string | null | undefined, endTime: string | null | undefined): string => {
    if (!startTime || !endTime) return '-';
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return '-';
    const diffMs = end.getTime() - start.getTime();
    if (diffMs < 0) return '-';
    const minutes = Math.round(diffMs / 60000);
    return `${minutes} Menit`;
  };

  // Poll database every 2 seconds (optimized for faster order visibility)
  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 2000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  // Cleanup audio only on unmount (not when polling effect re-runs, so sound can finish playing)
  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.pause();
        soundRef.current = null;
      }
    };
  }, []);

  const handleMarkFinished = (item: GroupedOrderItem) => {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbGetTransactionItems || !electronAPI?.localDbUpsertTransactionItems) {
      alert('Function not available');
      return;
    }
    // Avoid double-submit (e.g. double-click): skip if already persisting this item
    if (persistingIdsRef.current.has(item.uuid_id)) return;

    // 1. Optimistic update: move to right immediately
    persistingIdsRef.current.add(item.uuid_id);
    setPersistStatusMap((prev) => new Map(prev).set(item.uuid_id, { status: 'processing' }));
    const finishedItem: GroupedOrderItem = {
      ...item,
      production_status: 'finished',
      production_finished_at: new Date().toISOString(),
    };
    optimisticFinishedRef.current.set(item.uuid_id, finishedItem);
    lastFinishedMapRef.current.set(item.uuid_id, finishedItem);
    setActiveOrders((prev) => prev.filter((x) => x.uuid_id !== item.uuid_id));
    setFinishedOrders((prev) => {
      const merged = [...prev, finishedItem];
      const byUuid = new Map<string, GroupedOrderItem>();
      merged.forEach((x) => { if (!byUuid.has(x.uuid_id)) byUuid.set(x.uuid_id, x); });
      return Array.from(byUuid.values()).sort((a, b) => {
        const aTime = a.production_finished_at ? new Date(a.production_finished_at).getTime() : 0;
        const bTime = b.production_finished_at ? new Date(b.production_finished_at).getTime() : 0;
        return bTime - aTime;
      });
    });

    // 2. Persist in background with retry until success
    const persistWithRetry = async (delayMs = 2000) => {
      try {
        const items = await electronAPI.localDbGetTransactionItems?.(item.transaction_id);
        const itemsArray = Array.isArray(items) ? items as Record<string, unknown>[] : [];
        const customizationsData = await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(item.transaction_id);
        const customizations = Array.isArray(customizationsData?.customizations) ? customizationsData.customizations as Record<string, unknown>[] : [];
        const customizationOptions = Array.isArray(customizationsData?.options) ? customizationsData.options as Record<string, unknown>[] : [];
        const customizationsMap = new Map<number, Array<{
          customization_name: string;
          options: Array<{ option_name: string; price_adjustment: number }>;
        }>>();

        customizations.forEach((cust) => {
          const itemId = typeof cust.transaction_item_id === 'string'
            ? parseInt(cust.transaction_item_id, 10)
            : (typeof cust.transaction_item_id === 'number' ? cust.transaction_item_id : 0);

          if (!customizationsMap.has(itemId)) {
            customizationsMap.set(itemId, []);
          }

          const options = customizationOptions
            .filter((opt) => opt.transaction_item_customization_id === cust.id)
            .map((opt) => ({
              option_name: typeof opt.option_name === 'string' ? opt.option_name : String(opt.option_name || ''),
              price_adjustment: typeof opt.price_adjustment === 'number'
                ? opt.price_adjustment
                : (typeof opt.price_adjustment === 'string' ? parseFloat(opt.price_adjustment) || 0 : 0),
            }));

          const customizationName = typeof cust.customization_type_name === 'string' ? cust.customization_type_name : null;
          const customizationTypeId = typeof cust.customization_type_id === 'number' ? cust.customization_type_id : (typeof cust.customization_type_id === 'string' ? parseInt(cust.customization_type_id, 10) : null);
          const existingCust = customizationsMap.get(itemId)!.find(c =>
            c.customization_name === customizationName
          );

          if (existingCust) {
            existingCust.options.push(...options);
          } else {
            customizationsMap.get(itemId)!.push({
              customization_name: customizationName || `Customization ${customizationTypeId || ''}`,
              options,
            });
          }
        });

        // Find all items that match this signature (same product_id + same customizations + same note)
        const itemsToUpdate: Array<Record<string, unknown>> = [];
        const finishedAt = new Date().toISOString();

        // Prefer exact match by transaction item uuid_id so package items always persist (signature can fail when transaction_id is receipt_number etc.)
        if (item.uuid_id) {
          const tiByUuid = itemsArray.find((ti) => {
            const tiId = ti.uuid_id ?? ti.id;
            if (tiId == null) return false;
            return String(tiId).trim() === String(item.uuid_id).trim();
          });
          if (tiByUuid && tiByUuid.production_status !== 'finished') {
            const startedAt = tiByUuid.production_started_at || tiByUuid.created_at || finishedAt;
            itemsToUpdate.push({
              id: tiByUuid.id,
              uuid_id: tiByUuid.uuid_id || tiByUuid.id?.toString(),
              transaction_id: tiByUuid.transaction_id || 0,
              uuid_transaction_id: tiByUuid.uuid_transaction_id || item.transaction_id,
              product_id: tiByUuid.product_id,
              quantity: tiByUuid.quantity,
              unit_price: tiByUuid.unit_price,
              total_price: tiByUuid.total_price,
              custom_note: tiByUuid.custom_note,
              bundle_selections_json: tiByUuid.bundle_selections_json,
              package_selections_json: tiByUuid.package_selections_json ?? undefined,
              created_at: tiByUuid.created_at,
              production_status: 'finished',
              production_started_at: startedAt,
              production_finished_at: finishedAt,
            });
          }
        }

        if (itemsToUpdate.length === 0) {
          itemsArray.forEach((transactionItem) => {
            // Check if product_id matches
            if (transactionItem.product_id !== item.product_id) {
              return;
            }

            // Check if custom note matches
            const itemNote = transactionItem.custom_note || '';
            if (itemNote !== (item.custom_note || '')) {
              return;
            }

            // Check if customizations match
            // Normalize ID type for lookup
            const itemIdForLookup = typeof transactionItem.id === 'number'
              ? transactionItem.id
              : (typeof transactionItem.id === 'string' ? parseInt(transactionItem.id, 10) : null);
            const itemCustomizations = itemIdForLookup ? customizationsMap.get(itemIdForLookup) || [] : [];

            // Create signature for this item
            const allOptionIds: number[] = [];
            itemCustomizations.forEach((customization: { options: Array<{ option_name: string }> }) => {
              customization.options.forEach((option: { option_name: string }) => {
                allOptionIds.push(option.option_name.charCodeAt(0));
              });
            });
            const sortedOptionIds = allOptionIds.sort((a, b) => a - b).join(',');
            // Get table_number from transaction (we need to fetch it)
            // For now, use item.table_number as fallback since all items in same transaction have same table
            const transactionTableNumber = item.table_number || '';
            const itemSignature = `${transactionItem.product_id}_${sortedOptionIds}_${itemNote}_${transactionTableNumber}`;

            // Create signature for the grouped item (must match grouping signature including table_number)
            const groupedOptionIds: number[] = [];
            item.customizations.forEach(customization => {
              customization.options.forEach(option => {
                groupedOptionIds.push(option.option_name.charCodeAt(0));
              });
            });
            const groupedSortedOptionIds = groupedOptionIds.sort((a, b) => a - b).join(',');
            const groupedTableNumber = item.table_number || '';
            const groupedSignature = `${item.product_id}_${groupedSortedOptionIds}_${itemNote}_${groupedTableNumber}`;

            // If signatures match, add to update list (only if not already finished)
            if (itemSignature === groupedSignature) {
              if (transactionItem.production_status === 'finished') return;
              const itemToUpdate: Record<string, unknown> = {
                id: transactionItem.id,
                uuid_id: transactionItem.uuid_id || transactionItem.id?.toString(),
                transaction_id: transactionItem.transaction_id || 0,
                uuid_transaction_id: transactionItem.uuid_transaction_id || item.transaction_id,
                product_id: transactionItem.product_id,
                quantity: transactionItem.quantity,
                unit_price: transactionItem.unit_price,
                total_price: transactionItem.total_price,
                custom_note: transactionItem.custom_note,
                bundle_selections_json: transactionItem.bundle_selections_json,
                package_selections_json: transactionItem.package_selections_json ?? undefined,
                created_at: transactionItem.created_at,
                production_status: 'finished',
                production_started_at: transactionItem.production_started_at || transactionItem.created_at || finishedAt,
                production_finished_at: finishedAt,
              };
              itemsToUpdate.push(itemToUpdate);
            }
          });
        }

        if (itemsToUpdate.length === 0) {
          const fallbackItems = itemsArray.filter((ti) =>
            ti.product_id === item.product_id && (ti.custom_note || '') === (item.custom_note || '') && ti.production_status !== 'finished'
          );
          if (fallbackItems.length > 0) {
            fallbackItems.forEach((ti) => itemsToUpdate.push({ ...ti, production_status: 'finished', production_finished_at: finishedAt }));
          }
        }
        // Final fallback: match by uuid_id so we always persist when marking finished
        if (itemsToUpdate.length === 0) {
          const byUuid = itemsArray.find((ti) => (ti.uuid_id || ti.id?.toString()) === item.uuid_id);
          if (byUuid && byUuid.production_status !== 'finished') {
            const startedAt = byUuid.production_started_at || byUuid.created_at || finishedAt;
            itemsToUpdate.push({
              ...byUuid,
              production_status: 'finished',
              production_started_at: startedAt,
              production_finished_at: finishedAt,
            });
          }
        }

        if (itemsToUpdate.length === 0) {
          setPersistStatusMap((prev) => new Map(prev).set(item.uuid_id, {
            status: 'error',
            message: 'Item tidak ditemukan'
          }));

          // For package items, completion is tracked via individual lines, not transaction item status
          // Keep in optimisticFinishedRef so it stays in "Pesanan Selesai" on refresh
          if (!(item.packageBreakdownLines && item.packageBreakdownLines.length > 0)) {
            // Non-package items: remove from optimistic and re-fetch
            optimisticFinishedRef.current.delete(item.uuid_id);
            persistingIdsRef.current.delete(item.uuid_id);
            fetchOrders();
          } else {
            // Package items: keep in optimistic finished, just clear persisting flag
            persistingIdsRef.current.delete(item.uuid_id);
            // Clear error status after 5 seconds (user feedback)
            setTimeout(() => {
              setPersistStatusMap((p) => {
                const next = new Map(p);
                next.delete(item.uuid_id);
                return next;
              });
            }, 5000);
          }
          return;
        }

        const result = await electronAPI.localDbUpsertTransactionItems?.(itemsToUpdate);
        if (result && typeof result === 'object' && (result as { success?: boolean }).success === false) {
          throw new Error((result as { error?: string }).error || 'Gagal menyimpan');
        }
        persistingIdsRef.current.delete(item.uuid_id);
        setPersistStatusMap((prev) => new Map(prev).set(item.uuid_id, { status: 'success' }));
        setTimeout(() => setPersistStatusMap((p) => { const next = new Map(p); next.delete(item.uuid_id); return next; }), 3000);
        // Do NOT clear optimisticFinishedRef here: a fetch (e.g. 5s poll) may complete before the
        // write is visible and overwrite the UI with stale "item still active". Keeping the item
        // in the ref ensures the next fetch keeps it on the right; fetchOrders clears the ref when
        // it sees the item in finished from DB.
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        setPersistStatusMap((prev) => new Map(prev).set(item.uuid_id, { status: 'error', message: errMsg }));
        console.warn('Retrying mark finished:', error);
        setTimeout(() => persistWithRetry(Math.min(delayMs * 1.5, 30000)), delayMs);
      }
    };

    persistWithRetry(500);
  };

  const handlePackageSubItemDoubleClick = async (item: GroupedOrderItem, idx: number) => {
    if (viewOnly || !item.packageBreakdownLines?.length) return;
    const line = item.packageBreakdownLines[idx];
    const electronAPI = getElectronAPI();
    if (typeof line.id !== 'number') {
      console.warn('[KitchenDisplay] Package line has no DB id (legacy?), cannot update');
      return;
    }
    if (!electronAPI?.localDbUpdatePackageLine) {
      alert('Function not available');
      return;
    }
    const newFinishedAt = line.finished_at ? null : new Date().toISOString();

    // 1. Optimistic UI: strikethrough + "X Menit" immediately (and store finished_at so it survives fetch)
    line.finished_at = newFinishedAt;
    setPackageCheckedSubItems((prev) => {
      const next = new Map(prev);
      const s = new Set(next.get(item.uuid_id) || []);
      if (newFinishedAt === null) s.delete(idx);
      else s.add(idx);
      next.set(item.uuid_id, s);
      return next;
    });
    setOptimisticPackageLineFinishedAt((prev) => {
      const next = new Map(prev);
      const inner = new Map(next.get(item.uuid_id) || []);
      if (newFinishedAt) inner.set(idx, newFinishedAt);
      else inner.delete(idx);
      next.set(item.uuid_id, inner);
      return next;
    });

    const visibleIndices = new Set((item.packageBreakdownLines ?? []).map((_, i) => i));
    const checkedSet = new Set(packageCheckedSubItems.get(item.uuid_id) || []);
    if (newFinishedAt) checkedSet.add(idx);
    else checkedSet.delete(idx);
    const allVisibleDone = visibleIndices.size > 0 && [...visibleIndices].every((i) => {
      const lineDone = (item.packageBreakdownLines?.[i]?.finished_at != null) || checkedSet.has(i);
      return lineDone;
    });

    if (allVisibleDone) {
      const lineTimes = (item.packageBreakdownLines ?? []).map((l, i) => (i === idx ? newFinishedAt : l.finished_at)).filter(Boolean) as string[];
      const production_finished_at = lineTimes.length > 0
        ? new Date(Math.max(...lineTimes.map((t) => new Date(t).getTime()))).toISOString()
        : new Date().toISOString();
      const updatedLines = (item.packageBreakdownLines ?? []).map((l, i) => (i === idx ? { ...l, finished_at: newFinishedAt } : l));
      const finishedItem: GroupedOrderItem = {
        ...item,
        production_status: 'finished',
        production_finished_at,
        packageBreakdownLines: updatedLines,
      };
      optimisticFinishedRef.current.set(item.uuid_id, finishedItem);
      setActiveOrders((prev) => prev.filter((x) => x.uuid_id !== item.uuid_id));
      setFinishedOrders((prev) => {
        const merged = [...prev, finishedItem];
        const byUuid = new Map<string, GroupedOrderItem>();
        merged.forEach((x) => { if (!byUuid.has(x.uuid_id)) byUuid.set(x.uuid_id, x); });
        return Array.from(byUuid.values()).sort((a, b) => {
          const aTime = a.production_finished_at ? new Date(a.production_finished_at).getTime() : 0;
          const bTime = b.production_finished_at ? new Date(b.production_finished_at).getTime() : 0;
          return bTime - aTime;
        });
      });
      setPersistStatusMap((prev) => new Map(prev).set(item.uuid_id, { status: 'processing' }));
    }

    try {
      await electronAPI.localDbUpdatePackageLine({ id: line.id, finished_at: newFinishedAt });
      if (allVisibleDone) {
        setPersistStatusMap((prev) => new Map(prev).set(item.uuid_id, { status: 'success' }));
        setTimeout(() => setPersistStatusMap((p) => { const next = new Map(p); next.delete(item.uuid_id); return next; }), 3000);
        fetchOrders();
      }
    } catch (error) {
      if (allVisibleDone) {
        optimisticFinishedRef.current.delete(item.uuid_id);
        setFinishedOrders((prev) => prev.filter((x) => x.uuid_id !== item.uuid_id));
        setActiveOrders((prev) =>
          [...prev, item].sort((a, b) =>
            (a.created_at ? new Date(a.created_at).getTime() : 0) - (b.created_at ? new Date(b.created_at).getTime() : 0)
          )
        );
      }
      const errMsg = error instanceof Error ? error.message : String(error);
      setPersistStatusMap((prev) => new Map(prev).set(item.uuid_id, { status: 'error', message: errMsg }));
      console.error('Failed to update package line:', error);
      alert('Failed to update package line');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-600">Memuat data...</div>
      </div>
    );
  }

  const playTestSound = () => {
    try {
      const isFile = typeof window !== 'undefined' && window.location?.protocol === 'file:';
      const soundPath = isFile ? './blacksmith_refine.mp3' : '/blacksmith_refine.mp3';
      const audio = new Audio(soundPath);
      audio.volume = 0.7;
      audio.play().catch((err) => console.warn('Test sound failed:', err));
    } catch (err) {
      console.warn('Test sound failed:', err);
    }
  };

  return (
    <div className="flex-1 flex h-full bg-gray-50" title="KitchenDisplay ROOT">
      {/* Column 1: Active Orders */}
      <div className="w-1/2 border-r border-gray-300 flex flex-col bg-violet-50/50" title="KITCHEN ACTIVE COLUMN">
        <div className="bg-blue-500 text-white px-6 py-4 flex-shrink-0 flex items-center justify-between">
          <h2 className="text-2xl font-bold">Dapur - Pesanan Aktif</h2>
          <button
            type="button"
            onClick={playTestSound}
            className="p-1.5 rounded hover:bg-blue-600 transition-colors"
            title="Test sound"
          >
            <Volume2 className="w-5 h-5" />
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto px-0.5 py-3 ${legacyCardLayout ? 'bg-yellow-50' : 'bg-white'}`} title="SCROLL CONTAINER (active)">
          {activeOrders.length === 0 ? (
            <div className="text-center text-gray-500 mt-8">
              <p>Tidak ada pesanan aktif</p>
            </div>
          ) : (
            <div className={`space-y-2 ${legacyCardLayout ? 'bg-lime-50' : ''}`} title="LIST WRAPPER">
              {activeOrders.map((item) => {
                const isPackage = item.packageBreakdownLines && item.packageBreakdownLines.length > 0;
                return (
                  <div
                    key={item.uuid_id}
                    onDoubleClick={viewOnly || isPackage ? undefined : () => handleMarkFinished(item)}
                    className={legacyCardLayout
                      ? `w-full min-w-0 border-2 border-orange-300 rounded-lg p-2 transition-all flex relative bg-amber-100 ${viewOnly || isPackage ? '' : 'cursor-pointer hover:border-orange-500 hover:shadow-md'} ${isPackage ? 'border-amber-500' : ''}`
                      : `w-full min-w-0 border-2 border-gray-800 rounded-lg p-2.5 transition-all flex flex-col relative bg-white shadow-sm ${viewOnly || isPackage ? '' : 'cursor-pointer hover:border-orange-700 hover:shadow-md'} ${isPackage ? 'border-amber-600' : ''}`
                    }
                    style={{ minHeight: legacyCardLayout ? '100px' : '60px' }}
                    title="CARD"
                  >
                    {isPackage ? (
                      <>
                        <div className="flex-1 flex flex-col gap-0.5 min-w-0 overflow-visible">
                          <div className="text-base font-bold text-amber-900">
                            Paket: {item.total_quantity}x {item.product_name}
                          </div>
                          <div className="text-black font-semibold truncate" title={item.pickup_method === 'take-away' ? 'Take Away' : (item.table_number || '-')}>
                            {item.pickup_method === 'take-away' ? 'Take Away' : (item.table_number || '-')}
                          </div>
                          {item.custom_note && (
                            <div className="text-purple-700 font-bold text-base break-words">note: {item.custom_note}</div>
                          )}
                          <div className="border-l-2 border-amber-400 pl-2 mt-1 space-y-1">
                            {item.packageBreakdownLines!.map((line, idx) => {
                              // Optimistic state first so UI updates instantly (no timer flicker)
                              const lineChecked = packageCheckedSubItems.get(item.uuid_id)?.has(idx) ?? (line.finished_at != null);
                              const lineFinishedAt = line.finished_at ?? optimisticPackageLineFinishedAt.get(item.uuid_id)?.get(idx);
                              const lineStart = item.production_started_at || item.created_at;
                              const lineDurationMinutes = lineChecked && lineFinishedAt && lineStart
                                ? Math.max(0, Math.round((new Date(lineFinishedAt).getTime() - new Date(lineStart).getTime()) / 60000))
                                : null;
                              return (
                                <div
                                  key={idx}
                                  onDoubleClick={viewOnly ? undefined : () => handlePackageSubItemDoubleClick(item, idx)}
                                  className={`py-0.5 px-1 rounded min-h-[44px] flex flex-col justify-center gap-0.5 text-gray-900 font-medium ${viewOnly ? '' : 'cursor-pointer hover:bg-amber-100'} ${lineChecked ? 'line-through opacity-75 bg-amber-50' : ''}`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span>{line.quantity}x {line.product_name}</span>
                                    <span className="text-base font-mono font-bold text-blue-700 shrink-0" title={lineChecked ? 'Waktu penyelesaian per item' : 'Timer per item'}>
                                      {lineChecked && lineDurationMinutes != null
                                        ? `${lineDurationMinutes} Menit`
                                        : <OrderTimer startedAt={item.production_started_at} createdAt={item.created_at} />}
                                    </span>
                                  </div>
                                  {line.note && <div className="text-purple-700 font-bold text-sm break-words">note: {line.note}</div>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <span className="text-xl font-mono font-bold text-blue-700 shrink-0 self-end"><OrderTimer startedAt={item.production_started_at} createdAt={item.created_at} /></span>
                      </>
                    ) : legacyCardLayout ? (
                      <>
                        <div className="flex-1 flex flex-col gap-0.5 min-w-0 basis-0 overflow-visible">
                          <div className="text-lg font-semibold text-gray-900 break-all">
                            {item.total_quantity}x {item.platform_label === 'Offline' ? '' : `[${item.platform_label}] `}{item.product_name}
                          </div>
                          {item.customizations && item.customizations.length > 0 && (
                            <div className="text-blue-700 font-bold text-base flex flex-wrap break-words">
                              {item.customizations.map((customization, idx) => (
                                <span key={idx}>
                                  {customization.options.map((option, optIdx) => (
                                    <span key={optIdx}>
                                      +{option.option_name}
                                      {option.price_adjustment !== 0 && ` (+${option.price_adjustment})`}
                                      {optIdx < customization.options.length - 1 && ', '}
                                    </span>
                                  ))}
                                  {idx < item.customizations.length - 1 && ', '}
                                </span>
                              ))}
                            </div>
                          )}
                          {item.custom_note && (
                            <div className="text-purple-700 font-bold text-base break-words">note: {item.custom_note}</div>
                          )}
                        </div>
                        <div className="flex-shrink-0 w-[100px] flex flex-col items-center justify-center p-1.5 bg-orange-200" style={{ minHeight: '100%' }}>
                          <div className="text-2xl font-mono font-bold text-blue-600"><OrderTimer createdAt={item.created_at} /></div>
                          {item.customer_name && (
                            <div className="text-base text-gray-600 font-semibold text-center mt-1 truncate max-w-full" title={item.customer_name}>{item.customer_name}</div>
                          )}
                          {item.pickup_method === 'take-away' ? (
                            <div className="text-sm font-bold text-green-700 text-center mt-0.5 uppercase">Take Away</div>
                          ) : item.table_number ? (
                            <div className="text-base text-gray-600 font-semibold text-center mt-0.5">{item.table_number}</div>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col gap-0.5 min-w-0 overflow-visible" title="TEXT WRAPPER">
                        <div
                          className="text-base font-bold text-black grid gap-x-2 items-center"
                          style={{ gridTemplateColumns: '1fr 6rem 7rem 5rem' }}
                          title={`${item.total_quantity}x ${item.product_name}`}
                        >
                          <span className="min-w-0 break-words">{item.total_quantity}x {item.product_name}</span>
                          <span className="text-black font-semibold truncate" title={item.pickup_method === 'take-away' ? 'Take Away' : (item.table_number || '-')}>{item.pickup_method === 'take-away' ? 'Take Away' : (item.table_number || '-')}</span>
                          <span className="text-black font-semibold truncate" title={item.customer_name || '-'}>{item.customer_name || '-'}</span>
                          <span className="text-xl font-mono font-bold text-blue-700 shrink-0"><OrderTimer createdAt={item.created_at} /></span>
                        </div>
                        {(item.custom_note || (item.customizations && item.customizations.length > 0)) && (
                          <div className="text-sm text-black break-words flex flex-wrap gap-x-1 font-medium">
                            {item.customizations && item.customizations.length > 0 && (
                              <span className="text-blue-900">
                                {item.customizations.map((customization, idx) => (
                                  <span key={idx}>
                                    {customization.options.map((option, optIdx) => (
                                      <span key={optIdx}>
                                        +{option.option_name}
                                        {option.price_adjustment !== 0 && ` (+${option.price_adjustment})`}
                                        {optIdx < customization.options.length - 1 && ', '}
                                      </span>
                                    ))}
                                    {idx < item.customizations.length - 1 && ', '}
                                  </span>
                                ))}
                              </span>
                            )}
                            {item.custom_note && (
                              <span className="text-purple-900">
                                {item.customizations && item.customizations.length > 0 && ' | '}
                                note: {item.custom_note}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Column 2: Finished Orders */}
      <div className="w-1/2 flex flex-col bg-violet-50/30" title="KITCHEN FINISHED COLUMN">
        <div className="bg-green-500 text-white px-6 py-4 flex-shrink-0">
          <h2 className="text-2xl font-bold">Dapur - Pesanan Selesai</h2>
        </div>
        <div className={`flex-1 overflow-y-auto px-0.5 py-3 ${legacyCardLayout ? 'bg-yellow-50' : 'bg-white'}`} title="SCROLL CONTAINER (finished)">
          {finishedOrders.length === 0 ? (
            <div className="text-center text-gray-500 mt-8">
              <p>Tidak ada pesanan selesai</p>
            </div>
          ) : (
            <div className={`space-y-2 ${legacyCardLayout ? 'bg-lime-50' : ''}`} title="LIST WRAPPER (finished)">
              {finishedOrders.map((item) => {
                if (legacyCardLayout) {
                  const persistStatus = persistStatusMap.get(item.uuid_id);
                  return (
                    <div key={item.uuid_id} className="border-2 border-gray-300 rounded-lg p-2 opacity-75 bg-amber-100 relative" title="FINISHED CARD">
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="text-lg font-semibold text-gray-600 line-through break-all">
                          {item.total_quantity}x {item.platform_label === 'Offline' ? '' : `[${item.platform_label}] `}{item.product_name}
                        </div>
                        {item.customizations && item.customizations.length > 0 && (
                          <div className="text-blue-700 font-bold text-base line-through flex flex-wrap break-words">
                            {item.customizations.map((customization, idx) => (
                              <span key={idx}>
                                {customization.options.map((option, optIdx) => (
                                  <span key={optIdx}>
                                    +{option.option_name}
                                    {option.price_adjustment !== 0 && ` (+${option.price_adjustment})`}
                                    {optIdx < customization.options.length - 1 && ', '}
                                  </span>
                                ))}
                                {idx < item.customizations.length - 1 && ', '}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.custom_note && (
                          <div className="text-purple-700 font-bold text-base line-through break-words">note: {item.custom_note}</div>
                        )}
                      </div>
                      {(item.table_number || item.pickup_method === 'take-away' || item.production_started_at || item.production_finished_at) && (
                        <div className="text-xs text-gray-500 mt-1">
                          {(() => {
                            const tableText = item.pickup_method === 'take-away' ? 'Take Away | ' : (item.table_number ? `${item.table_number} | ` : '');
                            const startTimeSource = item.production_started_at || item.created_at;
                            const startTime = startTimeSource ? new Date(startTimeSource).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
                            const endTime = item.production_finished_at ? new Date(item.production_finished_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
                            let durationText = '';
                            if (startTimeSource && item.production_finished_at) {
                              const start = new Date(startTimeSource);
                              const end = new Date(item.production_finished_at);
                              const diffMinutes = Math.floor((end.getTime() - start.getTime()) / (1000 * 60));
                              durationText = ` | Waktu penyelesaian: ${diffMinutes} Menit`;
                            }
                            return `${tableText}${startTime ? `Mulai: ${startTime}` : ''}${startTime && endTime ? ' | ' : ''}${endTime ? `Selesai: ${endTime}` : ''}${durationText}`;
                          })()}
                        </div>
                      )}
                      {persistStatus && (
                        <div className="absolute bottom-1 right-1 text-[10px] font-medium tabular-nums">
                          {persistStatus.status === 'processing' && <span className="text-amber-700">Memproses...</span>}
                          {persistStatus.status === 'success' && <span className="text-green-700">Tersimpan</span>}
                          {persistStatus.status === 'error' && <span className="text-red-700 truncate max-w-[120px]" title={persistStatus.message}>Gagal: {persistStatus.message}</span>}
                        </div>
                      )}
                    </div>
                  );
                }
                const durationMinutes = (() => {
                  const start = item.production_started_at || item.created_at;
                  const end = item.production_finished_at;
                  if (!start || !end) return null;
                  const diffMs = new Date(end).getTime() - new Date(start).getTime();
                  return diffMs >= 0 ? Math.round(diffMs / 60000) : null;
                })();
                const isPackageFinished = item.packageBreakdownLines && item.packageBreakdownLines.length > 0;
                const persistStatus = persistStatusMap.get(item.uuid_id);
                return (
                  <div
                    key={item.uuid_id}
                    className="border-2 border-gray-700 rounded-lg p-2.5 bg-white relative"
                    title="FINISHED CARD"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      {isPackageFinished ? (
                        <>
                          <div className="text-base font-bold text-gray-900 line-through grid gap-x-2 items-center" style={{ gridTemplateColumns: '1fr 6rem 7rem 9rem' }}>
                            <span className="min-w-0 break-words">Paket: {item.total_quantity}x {item.product_name}</span>
                            <span className="text-gray-900 font-semibold truncate">{item.pickup_method === 'take-away' ? 'Take Away' : (item.table_number || '-')}</span>
                            <span className="text-gray-900 font-semibold truncate">{item.customer_name || '-'}</span>
                            <span className="font-mono text-gray-800 text-sm shrink-0">{durationMinutes != null ? `${durationMinutes} Menit` : '-'}</span>
                          </div>
                          <div className="border-l-2 border-amber-400 pl-2 mt-1 space-y-0.5">
                            {item.packageBreakdownLines!.map((line, idx) => {
                              const lineFinishedAt = line.finished_at ?? undefined;
                              const lineStart = item.production_started_at || item.created_at;
                              const lineDurationMinutes = lineFinishedAt && lineStart
                                ? Math.max(0, Math.round((new Date(lineFinishedAt).getTime() - new Date(lineStart).getTime()) / 60000))
                                : durationMinutes;
                              return (
                                <div key={idx} className="flex flex-col gap-0.5 text-gray-700 text-sm">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="line-through">{line.quantity}x {line.product_name}</span>
                                    {lineDurationMinutes != null && <span className="font-mono text-gray-600 shrink-0">{lineDurationMinutes} Menit</span>}
                                  </div>
                                  {line.note && <div className="text-purple-900 text-xs line-through">note: {line.note}</div>}
                                </div>
                              );
                            })}
                          </div>
                          {item.custom_note && (
                            <div className="text-sm text-purple-900 break-words font-medium line-through mt-1">note: {item.custom_note}</div>
                          )}
                        </>
                      ) : (
                        <>
                          <div
                            className="text-base font-bold text-gray-900 line-through grid gap-x-2 items-center"
                            style={{ gridTemplateColumns: '1fr 6rem 7rem 9rem' }}
                          >
                            <span className="min-w-0 break-words">{item.total_quantity}x {item.product_name}</span>
                            <span className="text-gray-900 font-semibold truncate">{item.pickup_method === 'take-away' ? 'Take Away' : (item.table_number || '-')}</span>
                            <span className="text-gray-900 font-semibold truncate">{item.customer_name || '-'}</span>
                            {(() => {
                              const startTimeSource = item.production_started_at || item.created_at;
                              const startTime = startTimeSource ? new Date(startTimeSource).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
                              const endTime = item.production_finished_at ? new Date(item.production_finished_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
                              return (
                                <span className="font-mono text-gray-800 text-sm shrink-0">
                                  {startTime && endTime ? `${startTime} - ${endTime}` : (startTime || '-')}
                                  {durationMinutes != null && ` · ${durationMinutes} Menit`}
                                </span>
                              );
                            })()}
                          </div>
                          {(item.custom_note || (item.customizations && item.customizations.length > 0)) && (
                            <div className="text-sm text-gray-900 break-words flex flex-wrap gap-x-1 font-medium line-through">
                              {item.customizations && item.customizations.length > 0 && (
                                <span className="text-blue-900">
                                  {item.customizations.map((customization, idx) => (
                                    <span key={idx}>
                                      {customization.options.map((option, optIdx) => (
                                        <span key={optIdx}>
                                          +{option.option_name}
                                          {option.price_adjustment !== 0 && ` (+${option.price_adjustment})`}
                                          {optIdx < customization.options.length - 1 && ', '}
                                        </span>
                                      ))}
                                      {idx < item.customizations.length - 1 && ', '}
                                    </span>
                                  ))}
                                </span>
                              )}
                              {item.custom_note && (
                                <span className="text-purple-900">
                                  {item.customizations && item.customizations.length > 0 && ' | '}
                                  note: {item.custom_note}
                                </span>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {persistStatus && (
                      <div className="absolute bottom-1 right-1 text-[10px] font-medium tabular-nums">
                        {persistStatus.status === 'processing' && <span className="text-amber-700">Memproses...</span>}
                        {persistStatus.status === 'success' && <span className="text-green-700">Tersimpan</span>}
                        {persistStatus.status === 'error' && <span className="text-red-700 truncate max-w-[140px]" title={persistStatus.message}>Gagal: {persistStatus.message}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

