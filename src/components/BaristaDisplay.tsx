'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { MapPin, Volume2 } from 'lucide-react';
import KdsCallerBadge from './KdsCallerBadge';
import KdsMetaPill from './KdsMetaPill';
import KdsOrderDetailLine from './KdsOrderDetailLine';
import KdsOrderRowHeader from './KdsOrderRowHeader';
import { parseCallerNumber } from './CallerNumberPicker';
import { useAuth } from '@/hooks/useAuth';
import { isSuperAdmin } from '@/lib/auth';
import { OrderTimer } from '@/contexts/DisplayTimerContext';
import { getPackageBreakdownLines, getPackageBreakdownLinesWithProductId } from './PackageSelectionModal';
import { appAlert } from '@/components/AppDialog';
import {
  type KdsLaneRow,
  type KdsProductLike,
  belongsOnBaristaDisplay,
  isKdsPackageProduct,
  bucketKdsLaneId,
  getVisibleLanes,
  resolveBaristaLaneId,
  getDefaultLaneId,
} from '@/lib/kdsLaneUtils';
import {
  buildProductionStartBackfillRow,
  markProductionFinished,
  maxWibSqlTimestamps,
  persistPackageParentFinished,
  productionNowWib,
  toIsoTimestamp,
  type TransactionItemUpsertRow,
} from '@/lib/productionTiming';
import { formatWibTimeShort, parseWibTimestampToMs } from '@/lib/wibDateTime';

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
  caller_number: number | null;
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
  packageBreakdownLines?: { id?: number; product_id: number; product_name: string; quantity: number; category1_id?: number; category1_name?: string; barista_lane_id?: number | null; originalIdx?: number; finished_at?: string | null; note?: string }[];
  /** Full unfiltered package breakdown (all lines) for completion tracking. */
  originalPackageBreakdownLines?: { id?: number; product_id: number; product_name: string; quantity: number; category1_id?: number; category1_name?: string; finished_at?: string | null; note?: string }[];
  /** Legacy: per-line completion (JSON). Prefer line.finished_at from DB when available. */
  package_line_finished_at?: Record<string, string>;
}

const OFFLINE_PAYMENT_CODES = new Set(['cash', 'debit', 'qr', 'ewallet', 'cl', 'room_charge', 'voucher', 'offline', 'tunai', 'edc']);

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
  lane_id?: number | null;
}

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

/** Cache TTL for static data (products, tables, rooms) - refresh every 5 minutes */
const STATIC_DATA_CACHE_TTL_MS = 5 * 60 * 1000;

const MAX_FINISHED_MAP_SIZE = 50;

function trimFinishedMap(map: Map<string, GroupedOrderItem>, maxSize: number) {
  if (map.size <= maxSize) return;
  const sorted = Array.from(map.entries()).sort((a, b) => {
    const aTime = parseWibTimestampToMs(a[1].production_finished_at) || 0;
    const bTime = parseWibTimestampToMs(b[1].production_finished_at) || 0;
    return bTime - aTime;
  });
  map.clear();
  for (let i = 0; i < maxSize && i < sorted.length; i++) {
    map.set(sorted[i][0], sorted[i][1]);
  }
}

/** Limit for today's transactions (barista display - only needs today's active orders) */
const TODAY_TRANSACTIONS_LIMIT = 200;

export default function BaristaDisplay({ viewOnly = false, legacyCardLayout = false, enableSound, pollingIntervalMs, pollingDelayMs }: { viewOnly?: boolean; legacyCardLayout?: boolean; enableSound?: boolean; pollingIntervalMs?: number; pollingDelayMs?: number; }) {
  const { user } = useAuth();
  const [activeOrders, setActiveOrders] = useState<GroupedOrderItem[]>([]);
  const [finishedOrders, setFinishedOrders] = useState<GroupedOrderItem[]>([]);
  const [visibleBaristaLanes, setVisibleBaristaLanes] = useState<KdsLaneRow[]>([]);
  const [baristaLanesCatalog, setBaristaLanesCatalog] = useState<KdsLaneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const previousOrderIdsRef = useRef<Set<string>>(new Set());
  const hasCompletedInitialFetchRef = useRef(false);
  const soundRef = useRef<HTMLAudioElement | null>(null);
  const optimisticFinishedRef = useRef<Map<string, GroupedOrderItem>>(new Map());
  const persistingIdsRef = useRef<Set<string>>(new Set());
  const isFetchingRef = useRef(false);
  /** Last finished list we displayed; used so a stale fetch never moves an item back to active. */
  const lastFinishedMapRef = useRef<Map<string, GroupedOrderItem>>(new Map());
  /** Cache for products, tables, rooms - reduces DB load during polling */
  const staticDataCacheRef = useRef<{
    productsMap: Map<number, Record<string, unknown>>;
    tablesMap: Map<number, { table_number: string; room_id: number }>;
    roomsMap: Map<number, string>;
    fetchedAt: number;
  } | null>(null);
  const firstTextWrapperRef = useRef<HTMLDivElement | null>(null);
  const firstProductNameRef = useRef<HTMLDivElement | null>(null);
  const firstCardRef = useRef<HTMLDivElement | null>(null);

  const businessId = user?.selectedBusinessId;

  const [packageCheckedSubItems, setPackageCheckedSubItems] = useState<Map<string, Set<number>>>(() => new Map());
  const [optimisticPackageLineFinishedAt, setOptimisticPackageLineFinishedAt] = useState<Map<string, Map<number, string>>>(() => new Map());
  const [persistStatusMap, setPersistStatusMap] = useState<Map<string, { status: 'processing' | 'success' | 'error'; message?: string }>>(() => new Map());

  if (!businessId) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center p-8 bg-white rounded-lg shadow-lg">
          <h2 className="text-xl font-bold text-red-600 mb-2">No Business Selected</h2>
          <p className="text-gray-700">Please log in and select a business to access the Barista Display.</p>
        </div>
      </div>
    );
  }

  // Check permission - if viewOnly, also check for access_baristaandkitchen
  const hasBaristaPermission = user?.permissions?.includes('access_barista') || false;
  const hasBaristaKitchenPermission = user?.permissions?.includes('access_baristaandkitchen') || false;
  const hasPermission = hasBaristaPermission || (viewOnly && hasBaristaKitchenPermission);

  if (!isSuperAdmin(user) && !hasPermission) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center p-8 bg-white rounded-lg shadow-lg">
          <h2 className="text-xl font-bold text-red-600 mb-2">Access Denied</h2>
          <p className="text-gray-700">You do not have permission to access the Barista Display.</p>
        </div>
      </div>
    );
  }

  // Fetch orders from database
  const fetchOrders = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
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
        const allProducts = await electronAPI.localDbGetAllProducts?.(businessId);
        const productsArray = Array.isArray(allProducts) ? allProducts as Record<string, unknown>[] : [];
        productsMap = new Map<number, Record<string, unknown>>();
        productsArray.forEach((p) => {
          if (p.id) {
            const productId = typeof p.id === 'number' ? p.id : Number(p.id);
            if (!isNaN(productId)) {
              productsMap.set(productId, p);
            }
          }
        });
        tablesMap = new Map<number, { table_number: string; room_id: number }>();
        roomsMap = new Map<number, string>();
        if (electronAPI.getRestaurantRooms) {
          const rooms = await electronAPI.getRestaurantRooms(businessId);
          const roomsArray = Array.isArray(rooms) ? rooms : [];
          roomsArray.forEach((room: { id: number; name: string }) => {
            if (room.id) {
              roomsMap.set(room.id, room.name);
            }
          });
          for (const room of roomsArray) {
            if (room.id && electronAPI.getRestaurantTables) {
              const tables = await electronAPI.getRestaurantTables(room.id);
              const tablesArray = Array.isArray(tables) ? tables : [];
              tablesArray.forEach((table: { id: number; table_number: string; room_id: number }) => {
                tablesMap.set(table.id, { table_number: table.table_number, room_id: table.room_id });
              });
            }
          }
        }
        staticDataCacheRef.current = { productsMap, tablesMap, roomsMap, fetchedAt: now };
      }

      const baristaCategoriesRaw = await electronAPI.localDbGetBaristaCategories?.(businessId);
      const baristaLanesList: KdsLaneRow[] = Array.isArray(baristaCategoriesRaw)
        ? (baristaCategoriesRaw as KdsLaneRow[])
        : [];
      const productsForLanes = Array.from(productsMap.values()) as KdsProductLike[];
      const visibleLanes = getVisibleLanes('barista', baristaLanesList, productsForLanes);
      setBaristaLanesCatalog(baristaLanesList);
      setVisibleBaristaLanes(visibleLanes.length > 0 ? visibleLanes : baristaLanesList.filter((l) => l.is_active === 1 || l.is_active === true));

      // Fetch transaction items for all relevant transactions
      const allOrderItems: OrderItem[] = [];
      const productionBackfillRows: TransactionItemUpsertRow[] = [];

      for (const tx of relevantTransactions) {
        const transactionId = (tx.uuid_id || tx.id) as string | number | undefined;
        const items = await electronAPI.localDbGetTransactionItems?.(transactionId);
        const itemsArray = Array.isArray(items) ? items as Record<string, unknown>[] : [];

        // Fetch customizations
        const transactionIdStr = transactionId ? String(transactionId) : '';
        const customizationsData = transactionIdStr ? await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(transactionIdStr) : undefined;
        const customizations = customizationsData?.customizations || [];
        const customizationOptions = customizationsData?.options || [];

        // Create customizations map
        const customizationsMap = new Map<number, Array<{
          customization_name: string;
          options: Array<{ option_name: string; price_adjustment: number }>;
        }>>();

        customizations.forEach((cust: Record<string, unknown>) => {
          const itemId = typeof cust.transaction_item_id === 'string'
            ? parseInt(cust.transaction_item_id, 10)
            : (typeof cust.transaction_item_id === 'number' ? cust.transaction_item_id : 0);

          if (!customizationsMap.has(itemId)) {
            customizationsMap.set(itemId, []);
          }

          const options = customizationOptions
            .filter((opt: Record<string, unknown>) => opt.transaction_item_customization_id === cust.id)
            .map((opt: Record<string, unknown>) => ({
              option_name: String(opt.option_name || ''),
              price_adjustment: typeof opt.price_adjustment === 'number'
                ? opt.price_adjustment
                : (typeof opt.price_adjustment === 'string' ? parseFloat(opt.price_adjustment) || 0 : 0),
            }));

          const existingCust = customizationsMap.get(itemId)!.find(c =>
            c.customization_name === cust.customization_type_name
          );

          if (existingCust) {
            existingCust.options.push(...options);
          } else {
            const customizationTypeName = typeof cust.customization_type_name === 'string'
              ? cust.customization_type_name
              : `Customization ${cust.customization_type_id || ''}`;
            customizationsMap.get(itemId)!.push({
              customization_name: customizationTypeName,
              options,
            });
          }
        });

        // Process items
        for (const item of itemsArray) {
          const productId = typeof item.product_id === 'number' ? item.product_id : (typeof item.product_id === 'string' ? parseInt(item.product_id, 10) : 0);
          const product = productId ? productsMap.get(productId) : undefined;
          if (!product) continue;

          const productForKds = product as KdsProductLike;
          if (!belongsOnBaristaDisplay(productForKds)) {
            continue;
          }
          const isPackageProduct = isKdsPackageProduct(productForKds);

          // Multi-table: use table_ids when present, else table_id
          const rawTableIds = (tx as Record<string, unknown>).table_ids;
          const idsToUse = Array.isArray(rawTableIds) && rawTableIds.length > 0
            ? rawTableIds.map((id: unknown) => typeof id === 'number' ? id : parseInt(String(id), 10)).filter((n: number) => !Number.isNaN(n))
            : (tx.table_id != null ? [typeof tx.table_id === 'number' ? tx.table_id : parseInt(String(tx.table_id), 10)] : []);
          const tableNumbers: string[] = [];
          for (const tid of idsToUse) {
            const tableInfo = tablesMap.has(tid) ? tablesMap.get(tid)! : null;
            if (tableInfo) {
              tableNumbers.push(tableInfo.table_number);
            }
          }
          const tableNumber = tableNumbers.length > 0 ? tableNumbers.join(', ') : null;
          const customerName = typeof tx.customer_name === 'string' ? tx.customer_name : null;
          const callerNumber = parseCallerNumber((tx as Record<string, unknown>).caller_number);

          const itemId = typeof item.id === 'number' ? item.id : (typeof item.id === 'string' ? parseInt(item.id, 10) : 0);
          const itemCustomizations = itemId ? customizationsMap.get(itemId) || [] : [];

          // Filter out cancelled items - they should not appear on barista display
          const itemProductionStatus = typeof item.production_status === 'string' ? item.production_status : null;
          if (itemProductionStatus === 'cancelled') {
            continue;
          }

          if (itemProductionStatus !== 'finished') {
            const backfillRow = buildProductionStartBackfillRow({
              ...item,
              uuid_transaction_id: transactionIdStr || transactionId,
            });
            if (backfillRow) {
              productionBackfillRows.push(backfillRow);
            }
          }

          const itemQuantity = typeof item.quantity === 'number' ? item.quantity : (typeof item.quantity === 'string' ? parseInt(item.quantity, 10) : 1);
          let packageBreakdownLines: { id?: number; product_id: number; product_name: string; quantity: number; category1_id?: number; category1_name?: string; finished_at?: string | null; note?: string }[] | undefined;
          const dbLines = (item as Record<string, unknown>).packageBreakdownLines as Array<Record<string, unknown>> | undefined;
          const rawJson = (item as Record<string, unknown>).package_selections_json;
          let fromJson: { product_id: number; product_name: string; quantity: number; note?: string }[] = [];
          try {
            if (rawJson) {
              const sel = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
              fromJson = getPackageBreakdownLinesWithProductId(Array.isArray(sel) ? sel : [], itemQuantity);
            }
          } catch (e) {
            if (isPackageProduct && process.env.NODE_ENV !== 'production') {
              console.warn('[BaristaDisplay] Failed to parse package_selections_json:', typeof product.nama === 'string' ? product.nama : 'Unknown', e);
            }
          }
          if (fromJson.length > 0) {
            const dbByProduct = new Map<number, Record<string, unknown>>();
            if (Array.isArray(dbLines)) {
              for (const l of dbLines) {
                const pid = l.product_id as number;
                if (pid != null && !dbByProduct.has(pid)) dbByProduct.set(pid, l);
              }
            }
            packageBreakdownLines = fromJson.map((line) => {
              const p = productsMap.get(line.product_id) as Record<string, unknown> | undefined;
              const category1_id = p && (typeof p.category1_id === 'number' || typeof p.category1_id === 'string') ? (typeof p.category1_id === 'number' ? p.category1_id : parseInt(String(p.category1_id), 10)) : undefined;
              const category1_name = p && typeof p.category1_name === 'string' ? p.category1_name : undefined;
              const db = dbByProduct.get(line.product_id);
              const id = db && typeof db.id === 'number' ? db.id : undefined;
              const finished_at = db && db.finished_at != null ? String(db.finished_at) : null;
              const note = (db && db.note != null && String(db.note).trim() !== '') ? String(db.note) : line.note;
              const barista_lane_id = p ? resolveBaristaLaneId(p as KdsProductLike, baristaLanesList) : getDefaultLaneId(baristaLanesList);
              return { ...line, id, category1_id, category1_name, finished_at, note, barista_lane_id };
            });
          } else if (Array.isArray(dbLines) && dbLines.length > 0) {
            const perPkgMultiplier = itemQuantity;
            packageBreakdownLines = dbLines.map((l: Record<string, unknown>) => {
              const perPkg = (l.quantity as number) || 1;
              return {
                id: typeof l.id === 'number' ? l.id : undefined,
                product_id: l.product_id as number,
                product_name: (l.product_name as string) || '',
                quantity: perPkg * perPkgMultiplier,
                category1_id: l.category1_id != null ? (typeof l.category1_id === 'number' ? l.category1_id : parseInt(String(l.category1_id), 10)) : undefined,
                category1_name: l.category1_name != null ? String(l.category1_name) : undefined,
                finished_at: l.finished_at != null ? String(l.finished_at) : null,
                note: l.note != null ? String(l.note) : undefined,
                barista_lane_id: (() => {
                  const p = productsMap.get(l.product_id as number);
                  return p ? resolveBaristaLaneId(p as KdsProductLike, baristaLanesList) : getDefaultLaneId(baristaLanesList);
                })(),
              };
            });
          }

          const orderItem = {
            id: itemId,
            uuid_id: typeof item.uuid_id === 'string' ? item.uuid_id : (itemId ? String(itemId) : ''),
            transaction_id: transactionIdStr || (transactionId ? String(transactionId) : ''),
            product_id: productId,
            product_name: typeof product.nama === 'string' ? product.nama : 'Unknown',
            quantity: itemQuantity,
            custom_note: typeof item.custom_note === 'string' ? item.custom_note : null,
            production_status: itemProductionStatus,
            production_started_at: toIsoTimestamp(item.production_started_at),
            production_finished_at: toIsoTimestamp(item.production_finished_at),
            table_number: tableNumber || null,
            room_name: null,
            customer_name: customerName || null,
            caller_number: callerNumber,
            pickup_method: (() => {
              const paymentCode = (typeof tx.payment_method === 'string' ? tx.payment_method : (tx.payment_method != null ? String(tx.payment_method) : '')).trim().toLowerCase();
              const isPlatformOrder = !!paymentCode && !OFFLINE_PAYMENT_CODES.has(paymentCode);
              if (isPlatformOrder) return 'take-away' as const;
              return (typeof tx.pickup_method === 'string' && (tx.pickup_method === 'take-away' || tx.pickup_method === 'dine-in')) ? tx.pickup_method as 'dine-in' | 'take-away' : 'dine-in';
            })(),
            platform_label: getPlatformLabel(typeof tx.payment_method === 'string' ? tx.payment_method : (tx.payment_method != null ? String(tx.payment_method) : undefined)),
            created_at: (() => {
              const txCreatedAt = typeof tx.created_at === 'string' ? tx.created_at : (tx.created_at instanceof Date ? tx.created_at.toISOString() : null);
              const itemCreatedAt = typeof item.created_at === 'string' ? item.created_at : (item.created_at instanceof Date ? item.created_at.toISOString() : null);

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
              return finalCreatedAt;
            })(),
            customizations: itemCustomizations,
            packageBreakdownLines: packageBreakdownLines?.length ? packageBreakdownLines : undefined,
          };

          allOrderItems.push(orderItem);
        }
      }

      // Group items by product_id + customization signature
      // Track all items in each group to check if all are finished
      const groupedMap = new Map<string, GroupedOrderItem>();
      const groupItemsMap = new Map<string, OrderItem[]>();

      const lineBelongsToBarista = (line: KdsProductLike) => belongsOnBaristaDisplay(line);

      allOrderItems.forEach(item => {
        // For package items: show only breakdown lines that belong to Barista (minuman/dessert); skip package on this display if none match
        let itemForGroup = item;
        if (item.packageBreakdownLines && item.packageBreakdownLines.length > 0) {
          const originalLines = item.packageBreakdownLines;
          const filteredWithIndices = originalLines
            .map((line, originalIdx) => ({ ...line, originalIdx }))
            .filter(line => lineBelongsToBarista(line));
          if (filteredWithIndices.length === 0) return; // Do not show this package on Barista
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
            customizationTexts.push(`+${option.option_name}`);
          });
        });
        if (customizationTexts.length > 0) {
          displayText += ` ${customizationTexts.join(', ')}`;
        }

        // Add custom note
        if (itemForGroup.custom_note) {
          displayText += ` note: ${itemForGroup.custom_note}`;
        }

        // Use production_started_at if available, otherwise created_at
        const startTime = itemForGroup.production_started_at || itemForGroup.created_at;

        groupedMap.set(signature, {
          ...itemForGroup,
          total_quantity: itemForGroup.quantity,
          display_text: displayText,
          timer: '00:00', // Rendered by OrderTimer component
          production_started_at: startTime,
          lane_id: resolveBaristaLaneId(
            (productsMap.get(itemForGroup.product_id) || {}) as KdsProductLike,
            baristaLanesList
          ),
        });
      });

      // Separate active and finished orders
      const active: GroupedOrderItem[] = [];
      const finished: GroupedOrderItem[] = [];
      const finishedUuids = new Set<string>();

      groupedMap.forEach((item, signature) => {
        const itemsInGroup = groupItemsMap.get(signature) || [];
        const startTimes = itemsInGroup
          .map(i => i.production_started_at || i.created_at)
          .filter((t): t is string => t !== null)
          .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        const earliestStartTime = startTimes.length > 0 ? startTimes[0] : item.created_at;
        const groupedItem = {
          ...item,
          production_started_at: earliestStartTime,
          timer: '00:00', // Rendered by OrderTimer component
        };

        const isPackage = groupedItem.packageBreakdownLines && groupedItem.packageBreakdownLines.length > 0;
        let shouldBeFinished: boolean;
        if (isPackage) {
          // Packages: finished when all visible (barista) lines have finished_at set
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
              groupedItem.production_finished_at = maxWibSqlTimestamps(
                groupedItem.packageBreakdownLines
                  .map((l) => l.finished_at)
                  .filter((t): t is string => t != null)
              );
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
        const aTime = parseWibTimestampToMs(a.production_finished_at) || 0;
        const bTime = parseWibTimestampToMs(b.production_finished_at) || 0;
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
        const aTime = parseWibTimestampToMs(a.production_finished_at) || 0;
        const bTime = parseWibTimestampToMs(b.production_finished_at) || 0;
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
            .map((l) => (l.finished_at ? parseWibTimestampToMs(l.finished_at) : 0))
            .filter((t) => t > 0);
          finishedAt = lineTimes.length > 0 ? Math.max(...lineTimes) : 0;
        } else {
          // Non-packages: use production_finished_at from transaction item
          finishedAt = parseWibTimestampToMs(item.production_finished_at) || 0;
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
      trimFinishedMap(lastFinishedMapRef.current, MAX_FINISHED_MAP_SIZE);
      trimFinishedMap(optimisticFinishedRef.current, MAX_FINISHED_MAP_SIZE);
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

      if (productionBackfillRows.length > 0 && electronAPI.localDbUpsertTransactionItems) {
        const backfillByUuid = new Map<string, TransactionItemUpsertRow>();
        for (const row of productionBackfillRows) {
          const uid = row.uuid_id != null ? String(row.uuid_id) : '';
          if (uid) backfillByUuid.set(uid, row);
        }
        if (backfillByUuid.size > 0) {
          void electronAPI.localDbUpsertTransactionItems(Array.from(backfillByUuid.values())).catch((err) => {
            console.warn('[BaristaDisplay] production_started_at backfill failed:', err);
          });
        }
      }

      // Check for new orders and play sound
      // Use hasCompletedInitialFetchRef so we don't play on very first page load; do NOT use loading here because
      // fetchOrders runs from setInterval and the callback closes over stale loading (stays true), so sound would never play.
      const shouldPlaySound = enableSound ?? !viewOnly;
      if (shouldPlaySound && hasCompletedInitialFetchRef.current) {
        const currentOrderIds = new Set(activeFiltered.map(order => order.uuid_id));
        const newOrderIds = [...currentOrderIds].filter(id => !previousOrderIdsRef.current.has(id));
        if (newOrderIds.length > 0) {
          try {
            const isFileProtocol = typeof window !== 'undefined' && window.location?.protocol === 'file:';
            const soundPath = isFileProtocol ? './blacksmith_refine.mp3' : '/blacksmith_refine.mp3';
            if (!soundRef.current) {
              soundRef.current = new Audio(soundPath);
              soundRef.current.volume = 0.7;
            }
            soundRef.current.pause();
            soundRef.current.currentTime = 0;
            soundRef.current.play().catch(error => {
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
    } finally {
      isFetchingRef.current = false;
    }
  }, [businessId]);

  const formatDuration = (startTime: string | null, endTime: string | null): string => {
    if (!startTime || !endTime) return '00:00';
    const start = parseWibTimestampToMs(startTime);
    const end = parseWibTimestampToMs(endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return '00:00';
    const diffMs = end - start;
    const totalSeconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatTime = (dateTime: string | null): string => {
    return formatWibTimeShort(dateTime) ?? '';
  };

  // Poll database with setTimeout-based scheduling: next poll starts only after current one completes.
  // This prevents overlapping fetches that cause cascading CPU spikes over prolonged use.
  useEffect(() => {
    let cancelled = false;
    const POLL_INTERVAL_MS = pollingIntervalMs ?? 5000;
    const poll = async () => {
      await fetchOrders();
      if (!cancelled) {
        timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };
    let timeoutId: ReturnType<typeof setTimeout>;
    let delayId: ReturnType<typeof setTimeout> | undefined;
    if (pollingDelayMs && pollingDelayMs > 0) {
      delayId = setTimeout(() => { if (!cancelled) poll(); }, pollingDelayMs);
    } else {
      poll();
    }
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      if (delayId) clearTimeout(delayId);
    };
  }, [fetchOrders, pollingIntervalMs, pollingDelayMs]);

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
      appAlert('Function not available');
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
      production_finished_at: productionNowWib(),
    };
    optimisticFinishedRef.current.set(item.uuid_id, finishedItem);
    lastFinishedMapRef.current.set(item.uuid_id, finishedItem);
    setActiveOrders((prev) => prev.filter((x) => x.uuid_id !== item.uuid_id));
    setFinishedOrders((prev) => {
      const merged = [...prev, finishedItem];
      const byUuid = new Map<string, GroupedOrderItem>();
      merged.forEach((x) => { if (!byUuid.has(x.uuid_id)) byUuid.set(x.uuid_id, x); });
      return Array.from(byUuid.values()).sort((a, b) => {
        const aTime = parseWibTimestampToMs(a.production_finished_at) || 0;
        const bTime = parseWibTimestampToMs(b.production_finished_at) || 0;
        return bTime - aTime;
      });
    });

    // 2. Persist in background with retry until success
    const persistWithRetry = async (delayMs = 2000) => {
      try {
        const items = await electronAPI.localDbGetTransactionItems?.(item.transaction_id);
        const itemsArray = Array.isArray(items) ? items as Record<string, unknown>[] : [];
        const transactions = await electronAPI.localDbGetTransactions?.(businessId, TODAY_TRANSACTIONS_LIMIT, { todayOnly: true });
        const transactionsArray = Array.isArray(transactions) ? transactions as Record<string, unknown>[] : [];
        const currentTransaction = transactionsArray.find((tx) =>
          tx.uuid_id === item.transaction_id || tx.id === item.transaction_id
        ) as Record<string, unknown> | undefined;

        // Get table info if available — support multi-table (table_ids)
        let transactionTableNumber = '';
        if (currentTransaction && electronAPI.getRestaurantRooms && electronAPI.getRestaurantTables) {
          const rawIds = (currentTransaction as Record<string, unknown>).table_ids;
          const idsToResolve = Array.isArray(rawIds) && rawIds.length > 0
            ? rawIds.map((id: unknown) => typeof id === 'number' ? id : parseInt(String(id), 10)).filter((n: number) => !Number.isNaN(n))
            : (currentTransaction.table_id != null ? [typeof currentTransaction.table_id === 'number' ? currentTransaction.table_id : parseInt(String(currentTransaction.table_id), 10)] : []);
          if (idsToResolve.length > 0) {
            const rooms = await electronAPI.getRestaurantRooms(businessId);
            const roomsArray = Array.isArray(rooms) ? rooms : [];
            const numbers: string[] = [];
            for (const room of roomsArray) {
              if (room.id && electronAPI.getRestaurantTables) {
                const tables = await electronAPI.getRestaurantTables(room.id);
                const tablesArray = Array.isArray(tables) ? tables : [];
                for (const tid of idsToResolve) {
                  const table = tablesArray.find((t: { id: number }) => t.id === tid);
                  if (table) numbers.push(table.table_number || '');
                }
              }
            }
            if (numbers.length > 0) transactionTableNumber = numbers.join(', ');
          }
        }

        // Fetch customizations to match items by signature
        const customizationsData = await electronAPI.localDbGetTransactionItemCustomizationsNormalized?.(item.transaction_id);
        const customizations = customizationsData?.customizations || [];
        const customizationOptions = customizationsData?.options || [];

        // Create customizations map
        const customizationsMap = new Map<number, Array<{
          customization_name: string;
          options: Array<{ option_name: string; price_adjustment: number }>;
        }>>();

        customizations.forEach((cust: Record<string, unknown>) => {
          const itemId = typeof cust.transaction_item_id === 'string'
            ? parseInt(cust.transaction_item_id, 10)
            : (typeof cust.transaction_item_id === 'number' ? cust.transaction_item_id : 0);

          if (!customizationsMap.has(itemId)) {
            customizationsMap.set(itemId, []);
          }

          const options = customizationOptions
            .filter((opt: Record<string, unknown>) => opt.transaction_item_customization_id === cust.id)
            .map((opt: Record<string, unknown>) => ({
              option_name: String(opt.option_name || ''),
              price_adjustment: typeof opt.price_adjustment === 'number'
                ? opt.price_adjustment
                : (typeof opt.price_adjustment === 'string' ? parseFloat(opt.price_adjustment) || 0 : 0),
            }));

          const existingCust = customizationsMap.get(itemId)!.find(c =>
            c.customization_name === cust.customization_type_name
          );

          if (existingCust) {
            existingCust.options.push(...options);
          } else {
            const customizationTypeName = typeof cust.customization_type_name === 'string'
              ? cust.customization_type_name
              : `Customization ${cust.customization_type_id || ''}`;
            customizationsMap.get(itemId)!.push({
              customization_name: customizationTypeName,
              options,
            });
          }
        });

        // Find all items that match this signature (same product_id + same customizations + same note)
        const itemsToUpdate: Array<Record<string, unknown>> = [];

        // Prefer exact match by transaction item uuid_id
        if (item.uuid_id) {
          const tiByUuid = itemsArray.find((ti: Record<string, unknown>) => {
            const tiId = ti.uuid_id ?? ti.id;
            if (tiId == null) return false;
            return String(tiId).trim() === String(item.uuid_id).trim();
          });
          if (tiByUuid && tiByUuid.production_status !== 'finished') {
            const finishedFields = markProductionFinished({
              production_started_at: tiByUuid.production_started_at,
              created_at: tiByUuid.created_at,
            });
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
              production_status: finishedFields.production_status,
              production_started_at: finishedFields.production_started_at,
              production_finished_at: finishedFields.production_finished_at,
            });
          }
        }

        if (itemsToUpdate.length === 0) {
          itemsArray.forEach((transactionItem: Record<string, unknown>) => {
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
            const itemIdForLookup = typeof transactionItem.id === 'string'
              ? parseInt(transactionItem.id, 10)
              : (typeof transactionItem.id === 'number' ? transactionItem.id : 0);
            const itemCustomizations = itemIdForLookup ? customizationsMap.get(itemIdForLookup) || [] : [];

            // Create signature for this item (must match grouping signature including table_number)
            const allOptionIds: number[] = [];
            itemCustomizations.forEach((customization: { options: Array<{ option_name: string }> }) => {
              customization.options.forEach((option: { option_name: string }) => {
                allOptionIds.push(option.option_name.charCodeAt(0));
              });
            });
            const sortedOptionIds = allOptionIds.sort((a, b) => a - b).join(',');
            // Use the table_number we fetched from the transaction (all items in same transaction have same table)
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
              const finishedFields = markProductionFinished({
                production_started_at: transactionItem.production_started_at,
                created_at: transactionItem.created_at,
              });
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
                production_status: finishedFields.production_status,
                production_started_at: finishedFields.production_started_at,
                production_finished_at: finishedFields.production_finished_at,
              };
              itemsToUpdate.push(itemToUpdate);
            }
          });
        }

        if (itemsToUpdate.length === 0) {
          const fallbackItems = itemsArray.filter((ti: Record<string, unknown>) =>
            ti.product_id === item.product_id && (ti.custom_note || '') === (item.custom_note || '') && ti.production_status !== 'finished'
          );
          if (fallbackItems.length > 0) {
            fallbackItems.forEach((ti: Record<string, unknown>) => {
              const finishedFields = markProductionFinished({
                production_started_at: ti.production_started_at,
                created_at: ti.created_at,
              });
              itemsToUpdate.push({
                ...ti,
                production_status: finishedFields.production_status,
                production_started_at: finishedFields.production_started_at,
                production_finished_at: finishedFields.production_finished_at,
              });
            });
          }
        }
        // Final fallback: match by uuid_id so we always persist when marking finished
        if (itemsToUpdate.length === 0) {
          const byUuid = itemsArray.find((ti: Record<string, unknown>) => (ti.uuid_id || ti.id?.toString()) === item.uuid_id);
          if (byUuid && byUuid.production_status !== 'finished') {
            const finishedFields = markProductionFinished({
              production_started_at: byUuid.production_started_at,
              created_at: byUuid.created_at,
            });
            itemsToUpdate.push({
              ...byUuid,
              production_status: finishedFields.production_status,
              production_started_at: finishedFields.production_started_at,
              production_finished_at: finishedFields.production_finished_at,
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
      console.warn('[BaristaDisplay] Package line has no DB id (legacy?), cannot update');
      return;
    }
    if (!electronAPI?.localDbUpdatePackageLine) {
      appAlert('Function not available');
      return;
    }
    const newFinishedAt = line.finished_at ? null : productionNowWib();

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

    let packageParentFinishedAt: string | null = null;
    if (allVisibleDone) {
      const lineTimes = (item.packageBreakdownLines ?? []).map((l, i) => (i === idx ? newFinishedAt : l.finished_at)).filter(Boolean) as string[];
      packageParentFinishedAt = maxWibSqlTimestamps(lineTimes);
      const updatedLines = (item.packageBreakdownLines ?? []).map((l, i) => (i === idx ? { ...l, finished_at: newFinishedAt } : l));
      const finishedItem: GroupedOrderItem = {
        ...item,
        production_status: 'finished',
        production_finished_at: packageParentFinishedAt,
        packageBreakdownLines: updatedLines,
      };
      optimisticFinishedRef.current.set(item.uuid_id, finishedItem);
      setActiveOrders((prev) => prev.filter((x) => x.uuid_id !== item.uuid_id));
      setFinishedOrders((prev) => {
        const merged = [...prev, finishedItem];
        const byUuid = new Map<string, GroupedOrderItem>();
        merged.forEach((x) => { if (!byUuid.has(x.uuid_id)) byUuid.set(x.uuid_id, x); });
        return Array.from(byUuid.values()).sort((a, b) => {
          const aTime = parseWibTimestampToMs(a.production_finished_at) || 0;
          const bTime = parseWibTimestampToMs(b.production_finished_at) || 0;
          return bTime - aTime;
        });
      });
      setPersistStatusMap((prev) => new Map(prev).set(item.uuid_id, { status: 'processing' }));
    }

    try {
      await electronAPI.localDbUpdatePackageLine({ id: line.id, finished_at: newFinishedAt });
      if (allVisibleDone && newFinishedAt && packageParentFinishedAt) {
        await persistPackageParentFinished(
          electronAPI,
          item.transaction_id,
          item.uuid_id,
          packageParentFinishedAt
        );
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
      appAlert('Failed to update package line');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-600">Memuat data...</div>
      </div>
    );
  }

  const defaultBaristaLaneId = getDefaultLaneId(baristaLanesCatalog);

  const lanesToRender: KdsLaneRow[] =
    visibleBaristaLanes.length > 0
      ? visibleBaristaLanes
      : baristaLanesCatalog.length > 0
        ? baristaLanesCatalog
        : [{ id: 0, name: 'Normal', display_order: 1, is_active: 1, is_default: 1 }];

  const visibleBaristaLaneIds = lanesToRender.map((l) => l.id).filter((id) => id !== 0);
  const useSingleLaneFallback =
    visibleBaristaLaneIds.length === 0 &&
    visibleBaristaLanes.length === 0 &&
    baristaLanesCatalog.length === 0;

  const getOrdersForBaristaLane = (laneId: number): GroupedOrderItem[] => {
    return activeOrders
      .filter((item) => {
        if (item.packageBreakdownLines?.length) {
          return item.packageBreakdownLines.some(
            (line) => bucketKdsLaneId(line.barista_lane_id, defaultBaristaLaneId, visibleBaristaLaneIds) === laneId
          );
        }
        return bucketKdsLaneId(item.lane_id, defaultBaristaLaneId, visibleBaristaLaneIds) === laneId;
      })
      .map((item) => {
        if (!item.packageBreakdownLines?.length) return item;
        const lines = item.packageBreakdownLines.filter(
          (line) => bucketKdsLaneId(line.barista_lane_id, defaultBaristaLaneId, visibleBaristaLaneIds) === laneId
        );
        return { ...item, packageBreakdownLines: lines };
      });
  };

  const anyBaristaLaneHasOrders =
    useSingleLaneFallback ||
    lanesToRender.some((lane) => lane.id !== 0 && getOrdersForBaristaLane(lane.id).length > 0);

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
    <div className="flex-1 flex h-full bg-gray-50 overflow-x-auto" title="BaristaDisplay ROOT">
      {lanesToRender.map((lane, laneIndex) => {
        const laneOrders = useSingleLaneFallback
          ? activeOrders
          : !anyBaristaLaneHasOrders && laneIndex === 0 && activeOrders.length > 0
            ? activeOrders
            : getOrdersForBaristaLane(lane.id);
        return (
      <div key={`barista-lane-${lane.id}`} className="flex-1 min-w-[280px] border-r border-gray-300 flex flex-col bg-indigo-50/50" title={`BARISTA LANE ${lane.name}`}>
        <div className="bg-blue-500 text-white px-6 py-4 flex-shrink-0 flex items-center justify-between">
          <h2 className="text-2xl font-bold">{lane.name}</h2>
          {laneIndex === 0 ? (
          <button
            type="button"
            onClick={playTestSound}
            className="p-1.5 rounded hover:bg-blue-600 transition-colors"
            title="Test sound"
          >
            <Volume2 className="w-5 h-5" />
          </button>
          ) : null}
        </div>
        <div className={`flex-1 overflow-y-auto px-0.5 py-3 ${legacyCardLayout ? 'bg-yellow-50' : 'bg-white'}`} title="SCROLL CONTAINER (active)">
          {laneOrders.length === 0 ? (
            <div className="text-center text-gray-500 mt-8">
              <p>Tidak ada pesanan aktif</p>
            </div>
          ) : (
            <div className={`space-y-2 ${legacyCardLayout ? 'bg-lime-50' : ''}`} title="LIST WRAPPER">
              {laneOrders.map((item, index) => {
                const isPackage = item.packageBreakdownLines && item.packageBreakdownLines.length > 0;
                return (
                  <div
                    key={item.uuid_id}
                    ref={index === 0 ? firstCardRef : undefined}
                    onDoubleClick={viewOnly || isPackage ? undefined : () => handleMarkFinished(item)}
                    className={legacyCardLayout
                      ? `w-full min-w-0 border-2 border-blue-300 rounded-lg p-2 transition-all flex relative bg-amber-100 ${viewOnly || isPackage ? '' : 'cursor-pointer hover:border-blue-500 hover:shadow-md'} ${isPackage ? 'border-amber-500' : ''}`
                      : `w-full min-w-0 border-2 border-gray-800 rounded-lg p-2.5 transition-all flex flex-col relative bg-white shadow-sm ${viewOnly || isPackage ? '' : 'cursor-pointer hover:border-blue-700 hover:shadow-md'} ${isPackage ? 'border-amber-600' : ''}`
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
                              const lineChecked = packageCheckedSubItems.get(item.uuid_id)?.has(idx) ?? (line.finished_at != null);
                              const lineFinishedAt = line.finished_at ?? optimisticPackageLineFinishedAt.get(item.uuid_id)?.get(idx);
                              const lineStart = item.production_started_at || item.created_at;
                              const lineDurationMinutes = lineChecked && lineFinishedAt && lineStart
                                ? Math.max(0, Math.round((parseWibTimestampToMs(lineFinishedAt) - parseWibTimestampToMs(lineStart)) / 60000))
                                : null;
                              return (
                                <div
                                  key={idx}
                                  onDoubleClick={viewOnly ? undefined : () => handlePackageSubItemDoubleClick(item, idx)}
                                  className={`py-0.5 px-1 rounded min-h-[44px] flex flex-col justify-center gap-0.5 text-gray-900 font-medium ${viewOnly ? '' : 'cursor-pointer hover:bg-amber-100'} ${lineChecked ? 'line-through opacity-75 bg-amber-50' : ''}`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span>{line.quantity}x {line.product_name}</span>
                                    {lineChecked && lineDurationMinutes != null ? (
                                      <span className="text-base font-mono font-bold text-blue-700 shrink-0">{lineDurationMinutes} Menit</span>
                                    ) : (
                                      <OrderTimer startedAt={item.production_started_at} createdAt={item.created_at} />
                                    )}
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
                        <div ref={index === 0 ? firstTextWrapperRef : undefined} className="flex-1 flex flex-col gap-0.5 min-w-0 basis-0 overflow-visible">
                          <div ref={index === 0 ? firstProductNameRef : undefined} className="text-lg font-semibold text-gray-900 break-all">
                            {item.total_quantity}x [{item.platform_label}] {item.product_name}
                          </div>
                          {item.customizations && item.customizations.length > 0 && (
                            <div className="text-blue-700 font-bold text-base flex flex-wrap break-words">
                              {item.customizations.map((customization, idx) => (
                                <span key={idx}>
                                  {customization.options.map((option, optIdx) => (
                                    <span key={optIdx}>
                                      +{option.option_name}
                                      {optIdx < customization.options.length - 1 && ', '}
                                    </span>
                                  ))}
                                  {idx < item.customizations.length - 1 && ', '}
                                </span>
                              ))}
                            </div>
                          )}
                          {item.custom_note && (
                            <div className="text-purple-700 font-bold text-base break-words">
                              note: {item.custom_note}
                            </div>
                          )}
                        </div>
                        <div className="flex-shrink-0 w-[6.5rem] flex flex-col items-center justify-center gap-1 p-1 bg-orange-200" style={{ minHeight: '100%' }}>
                          <div className="text-2xl font-mono font-bold text-blue-600 leading-none"><OrderTimer startedAt={item.production_started_at} createdAt={item.created_at} /></div>
                          {item.pickup_method === 'take-away' ? (
                            <KdsMetaPill label="Take Away" title="Take Away" icon={<MapPin className="w-3.5 h-3.5" strokeWidth={2.5} />} className="max-w-full" />
                          ) : item.table_number ? (
                            <KdsMetaPill label={item.table_number} title={`Meja: ${item.table_number}`} icon={<MapPin className="w-3.5 h-3.5" strokeWidth={2.5} />} className="max-w-full" />
                          ) : null}
                          <KdsCallerBadge callerNumber={item.caller_number} variant="pill" iconClassName="w-3.5 h-3.5" />
                          {item.customer_name ? (
                            <div className="text-[10px] text-gray-700 font-medium text-center leading-tight line-clamp-2 max-w-full px-0.5" title={item.customer_name}>{item.customer_name}</div>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div ref={index === 0 ? firstTextWrapperRef : undefined} className="flex flex-col gap-0.5 min-w-0 overflow-visible" title="TEXT WRAPPER">
                        <KdsOrderRowHeader
                          productLine={<>{item.total_quantity}x {item.product_name}</>}
                          pickupMethod={item.pickup_method}
                          tableNumber={item.table_number}
                          customerName={item.customer_name}
                          callerNumber={item.caller_number}
                          detailLine={
                            <KdsOrderDetailLine
                              customNote={item.custom_note}
                              customizations={item.customizations}
                            />
                          }
                          timer={
                            <span className="text-lg font-mono font-bold text-blue-700 tabular-nums">
                              <OrderTimer startedAt={item.production_started_at} createdAt={item.created_at} />
                            </span>
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
        );
      })}

      {/* Column 2: Finished Orders */}
      <div className="flex-1 min-w-[280px] flex flex-col bg-indigo-50/30" title="BARISTA FINISHED COLUMN">
        <div className="bg-green-500 text-white px-6 py-4 flex-shrink-0">
          <h2 className="text-2xl font-bold">Pesanan Selesai</h2>
        </div>
        <div className={`flex-1 overflow-y-auto px-0.5 py-3 ${legacyCardLayout ? 'bg-yellow-50' : 'bg-white'}`} title="SCROLL CONTAINER (finished)">
          {finishedOrders.length === 0 ? (
            <div className="text-center text-gray-500 mt-8">
              <p>Tidak ada pesanan selesai</p>
            </div>
          ) : (
            <div className={`space-y-2 ${legacyCardLayout ? 'bg-lime-50' : ''}`} title="LIST WRAPPER (finished)">
              {finishedOrders.map((item) => {
                const durationMinutes = (() => {
                  const start = item.production_started_at || item.created_at;
                  const end = item.production_finished_at;
                  if (!start || !end) return null;
                  const diffMs = parseWibTimestampToMs(end) - parseWibTimestampToMs(start);
                  return Number.isFinite(diffMs) && diffMs >= 0 ? Math.round(diffMs / 60000) : null;
                })();
                const isPackageFinished = item.packageBreakdownLines && item.packageBreakdownLines.length > 0;
                const persistStatus = persistStatusMap.get(item.uuid_id);
                if (legacyCardLayout) {
                  return (
                    <div key={item.uuid_id} className="border-2 border-gray-300 rounded-lg p-2 opacity-75 bg-amber-100 relative" title="FINISHED CARD">
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="text-lg font-semibold text-gray-600 break-all">
                          {isPackageFinished ? `Paket: ${item.total_quantity}x ${item.product_name}` : `${item.total_quantity}x ${item.platform_label === 'Offline' ? '' : `[${item.platform_label}] `}${item.product_name}`}
                        </div>
                        {isPackageFinished && (
                          <div className="border-l-2 border-amber-400 pl-2 mt-0.5 space-y-0.5">
                            {item.packageBreakdownLines!.map((line, idx) => {
                              const lineFinishedAt = line.finished_at ?? undefined;
                              const lineStart = item.production_started_at || item.created_at;
                              const lineDurationMinutes = lineFinishedAt && lineStart
                                ? Math.max(0, Math.round((parseWibTimestampToMs(lineFinishedAt) - parseWibTimestampToMs(lineStart)) / 60000))
                                : durationMinutes;
                              return (
                                <div key={idx} className="text-gray-600 text-sm line-through">
                                  <div>{line.quantity}x {line.product_name}{lineDurationMinutes != null ? ` · ${lineDurationMinutes} Menit` : ''}</div>
                                  {line.note && <div className="text-purple-700 text-xs">note: {line.note}</div>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {item.customizations && item.customizations.length > 0 && (
                          <div className="text-blue-700 font-bold text-base flex flex-wrap break-words">
                            {item.customizations.map((customization, idx) => (
                              <span key={idx}>
                                {customization.options.map((option, optIdx) => (
                                  <span key={optIdx}>
                                    +{option.option_name}
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
                      {(item.table_number || item.pickup_method === 'take-away' || item.production_started_at || item.production_finished_at) && (
                        <div className="text-xs text-gray-500 mt-1">
                          {(() => {
                            const tableText = item.pickup_method === 'take-away' ? 'Take Away | ' : (item.table_number ? `${item.table_number} | ` : '');
                            const startTimeSource = item.production_started_at || item.created_at;
                            const startTime = formatWibTimeShort(startTimeSource);
                            const endTime = formatWibTimeShort(item.production_finished_at);
                            const durationText = durationMinutes != null ? ` | Selesai dalam ${durationMinutes} Menit` : '';
                            return `${tableText}${startTime ? `Mulai: ${startTime}` : ''}${startTime && endTime ? ' | ' : ''}${endTime ? `Selesai: ${endTime}` : ''}${durationText}`;
                          })()}
                        </div>
                      )}
                      {persistStatus && (
                        <div className="absolute bottom-1 right-1 text-[10px] text-right">
                          {persistStatus.status === 'processing' && <span className="text-amber-700">Memproses...</span>}
                          {persistStatus.status === 'success' && <span className="text-green-700">Tersimpan</span>}
                          {persistStatus.status === 'error' && <span className="text-red-700 truncate max-w-[120px]" title={persistStatus.message}>Gagal: {persistStatus.message}</span>}
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <div
                    key={item.uuid_id}
                    className="border-2 border-gray-700 rounded-lg p-2.5 bg-white relative"
                    title="FINISHED CARD"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      {isPackageFinished ? (
                        <>
                          <KdsOrderRowHeader
                            className="line-through"
                            productClassName="text-base font-bold text-gray-900 line-through"
                            productLine={<>Paket: {item.total_quantity}x {item.product_name}</>}
                            pickupMethod={item.pickup_method}
                            tableNumber={item.table_number}
                            customerName={item.customer_name}
                            callerNumber={item.caller_number}
                            detailLine={
                              <KdsOrderDetailLine
                                className="line-through"
                                customNote={item.custom_note}
                                customizations={item.customizations}
                              />
                            }
                            timer={
                              <span className="text-sm font-mono font-semibold text-gray-800 tabular-nums">
                                {durationMinutes != null ? `${durationMinutes} Menit` : '-'}
                              </span>
                            }
                          />
                          <div className="border-l-2 border-amber-400 pl-2 mt-1 space-y-0.5">
                            {item.packageBreakdownLines!.map((line, idx) => {
                              const lineFinishedAt = line.finished_at ?? undefined;
                              const lineStart = item.production_started_at || item.created_at;
                              const lineDurationMinutes = lineFinishedAt && lineStart
                                ? Math.max(0, Math.round((parseWibTimestampToMs(lineFinishedAt) - parseWibTimestampToMs(lineStart)) / 60000))
                                : durationMinutes;
                              return (
                                <div key={idx} className="flex flex-col gap-0.5 text-gray-700 text-sm line-through">
                                  <div className="flex items-center justify-between gap-2">
                                    <span>{line.quantity}x {line.product_name}</span>
                                    {lineDurationMinutes != null && <span className="font-mono text-gray-600 shrink-0">{lineDurationMinutes} Menit</span>}
                                  </div>
                                  {line.note && <div className="text-purple-900 text-xs">note: {line.note}</div>}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <>
                          <KdsOrderRowHeader
                            className="line-through"
                            productClassName="text-base font-bold text-gray-900 line-through"
                            productLine={<>{item.total_quantity}x {item.product_name}</>}
                            pickupMethod={item.pickup_method}
                            tableNumber={item.table_number}
                            customerName={item.customer_name}
                            callerNumber={item.caller_number}
                            detailLine={
                              <KdsOrderDetailLine
                                className="line-through"
                                customNote={item.custom_note}
                                customizations={item.customizations}
                              />
                            }
                            timer={(() => {
                              const startTimeSource = item.production_started_at || item.created_at;
                              const startTime = formatWibTimeShort(startTimeSource);
                              const endTime = formatWibTimeShort(item.production_finished_at);
                              return (
                                <span className="text-xs font-mono font-semibold text-gray-800 tabular-nums text-right leading-tight">
                                  {startTime && endTime ? `${startTime}–${endTime}` : (startTime || '-')}
                                  {durationMinutes != null && (
                                    <span className="block">{durationMinutes} mnt</span>
                                  )}
                                </span>
                              );
                            })()}
                          />
                        </>
                      )}
                      {persistStatus && (
                        <div className="absolute bottom-1 right-1 text-[10px] text-right">
                          {persistStatus.status === 'processing' && <span className="text-amber-700">Memproses...</span>}
                          {persistStatus.status === 'success' && <span className="text-green-700">Tersimpan</span>}
                          {persistStatus.status === 'error' && <span className="text-red-700 truncate max-w-[140px]" title={persistStatus.message}>Gagal: {persistStatus.message}</span>}
                        </div>
                      )}
                    </div>
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

