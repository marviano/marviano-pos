export type KdsLaneType = 'kitchen' | 'barista';

export interface KdsLaneRow {
  id: number;
  name: string;
  display_order: number;
  is_active: number | boolean;
  is_default: number | boolean;
}

export interface KdsProductLike {
  id?: number;
  status?: string;
  category1_id?: number | null;
  category1_name?: string | null;
  is_package?: number | boolean;
  kitchen_category_id?: number | null;
  barista_category_id?: number | null;
}

const KITCHEN_CATEGORY_NAMES = ['makanan', 'bakery'];
const KITCHEN_CATEGORY_IDS = [1, 5];
const BARISTA_CATEGORY_NAMES = ['minuman', 'dessert'];
const BARISTA_CATEGORY_IDS = [2, 3];

export function belongsOnKitchenDisplay(product: KdsProductLike): boolean {
  const categoryName = (product.category1_name || '').toString().trim().toLowerCase();
  const category1Id = product.category1_id != null ? Number(product.category1_id) : null;
  const isPackageProduct = category1Id === 14 || product.is_package === 1 || product.is_package === true;
  if (isPackageProduct) return true;
  if (category1Id != null && KITCHEN_CATEGORY_IDS.includes(category1Id)) return true;
  return KITCHEN_CATEGORY_NAMES.includes(categoryName);
}

export function belongsOnBaristaDisplay(product: KdsProductLike): boolean {
  const categoryName = (product.category1_name || '').toString().trim().toLowerCase();
  const category1Id = product.category1_id != null ? Number(product.category1_id) : null;
  const isPackageProduct = category1Id === 14 || product.is_package === 1 || product.is_package === true;
  if (isPackageProduct) return true;
  if (category1Id != null && BARISTA_CATEGORY_IDS.includes(category1Id)) return true;
  return BARISTA_CATEGORY_NAMES.includes(categoryName);
}

export function getDefaultLaneId(lanes: KdsLaneRow[]): number | null {
  const def = lanes.find((l) => l.is_default === 1 || l.is_default === true);
  if (def) return def.id;
  return lanes.length > 0 ? lanes[0].id : null;
}

export function resolveKitchenLaneId(product: KdsProductLike, lanes: KdsLaneRow[]): number | null {
  const defaultId = getDefaultLaneId(lanes);
  const raw = product.kitchen_category_id;
  if (raw == null) return defaultId;
  const lane = lanes.find((l) => l.id === raw);
  if (!lane || !(lane.is_active === 1 || lane.is_active === true)) return defaultId;
  return raw;
}

export function resolveBaristaLaneId(product: KdsProductLike, lanes: KdsLaneRow[]): number | null {
  const defaultId = getDefaultLaneId(lanes);
  const raw = product.barista_category_id;
  if (raw == null) return defaultId;
  const lane = lanes.find((l) => l.id === raw);
  if (!lane || !(lane.is_active === 1 || lane.is_active === true)) return defaultId;
  return raw;
}

/** Lanes that should show as columns: active lane with at least one active product on that display. */
export function getVisibleLanes(
  laneType: KdsLaneType,
  lanes: KdsLaneRow[],
  products: KdsProductLike[]
): KdsLaneRow[] {
  const belongs = laneType === 'kitchen' ? belongsOnKitchenDisplay : belongsOnBaristaDisplay;
  const resolve = laneType === 'kitchen' ? resolveKitchenLaneId : resolveBaristaLaneId;

  const activeProducts = products.filter((p) => {
    if (p.status && p.status !== 'active') return false;
    if (!belongs(p)) return false;
    return true;
  });

  const laneIdsInUse = new Set<number>();
  for (const p of activeProducts) {
    const laneId = resolve(p, lanes);
    if (laneId != null) laneIdsInUse.add(laneId);
  }

  return lanes
    .filter((l) => (l.is_active === 1 || l.is_active === true) && laneIdsInUse.has(l.id))
    .sort((a, b) => (a.display_order ?? 99) - (b.display_order ?? 99) || a.name.localeCompare(b.name));
}

export function bucketActiveOrdersByLane<T extends { lane_id?: number | null }>(
  orders: T[],
  visibleLanes: KdsLaneRow[],
  defaultLaneId: number | null
): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const lane of visibleLanes) {
    map.set(lane.id, []);
  }
  for (const item of orders) {
    const laneId = item.lane_id ?? defaultLaneId;
    if (laneId == null) continue;
    if (!map.has(laneId)) map.set(laneId, []);
    map.get(laneId)!.push(item);
  }
  return map;
}
