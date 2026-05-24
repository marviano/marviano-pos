import fs from 'fs';

const p = 'c:/Code/marviano-pos/src/components/BaristaDisplay.tsx';
let s = fs.readFileSync(p, 'utf8');

if (!s.includes('kdsLaneUtils')) {
  s = s.replace(
    "import { appAlert } from '@/components/AppDialog';",
    `import { appAlert } from '@/components/AppDialog';
import {
  type KdsLaneRow,
  type KdsProductLike,
  getVisibleLanes,
  resolveBaristaLaneId,
  getDefaultLaneId,
} from '@/lib/kdsLaneUtils';`
  );
}

if (!s.includes('visibleBaristaLanes')) {
  s = s.replace(
    `  const [activeOrders, setActiveOrders] = useState<GroupedOrderItem[]>([]);
  const [finishedOrders, setFinishedOrders] = useState<GroupedOrderItem[]>([]);`,
    `  const [activeOrders, setActiveOrders] = useState<GroupedOrderItem[]>([]);
  const [finishedOrders, setFinishedOrders] = useState<GroupedOrderItem[]>([]);
  const [visibleBaristaLanes, setVisibleBaristaLanes] = useState<KdsLaneRow[]>([]);
  const [baristaLanesCatalog, setBaristaLanesCatalog] = useState<KdsLaneRow[]>([]);`
  );
}

if (!s.includes('lane_id?:')) {
  s = s.replace(
    `interface GroupedOrderItem extends OrderItem {
  total_quantity: number;
  display_text: string;
  timer: string;
}`,
    `interface GroupedOrderItem extends OrderItem {
  total_quantity: number;
  display_text: string;
  timer: string;
  lane_id?: number | null;
}`
  );
}

if (!s.includes('barista_lane_id')) {
  s = s.replace(
    'category1_name?: string; originalIdx?: number; finished_at?: string | null; note?: string }[];',
    'category1_name?: string; barista_lane_id?: number | null; originalIdx?: number; finished_at?: string | null; note?: string }[];'
  );
}

s = s.replace(
  'const allProducts = await electronAPI.localDbGetAllProducts?.();',
  'const allProducts = await electronAPI.localDbGetAllProducts?.(businessId);'
);

if (!s.includes('localDbGetBaristaCategories')) {
  s = s.replace(
    `        staticDataCacheRef.current = { productsMap, tablesMap, roomsMap, fetchedAt: now };
      }

      // Fetch transaction items for all relevant transactions`,
    `        staticDataCacheRef.current = { productsMap, tablesMap, roomsMap, fetchedAt: now };
      }

      const baristaCategoriesRaw = await electronAPI.localDbGetBaristaCategories?.(businessId);
      const baristaLanesList: KdsLaneRow[] = Array.isArray(baristaCategoriesRaw)
        ? (baristaCategoriesRaw as KdsLaneRow[])
        : [];
      const productsForBaristaLanes = Array.from(productsMap.values()) as KdsProductLike[];
      const visibleBarista = getVisibleLanes('barista', baristaLanesList, productsForBaristaLanes);
      setBaristaLanesCatalog(baristaLanesList);
      setVisibleBaristaLanes(visibleBarista.length > 0 ? visibleBarista : baristaLanesList.filter((l) => l.is_active === 1 || l.is_active === true));

      // Fetch transaction items for all relevant transactions`
  );
}

if (!s.includes('barista_lane_id = p ? resolveBaristaLaneId')) {
  s = s.replace(
    'return { ...line, id, category1_id, category1_name, finished_at, note };',
    'const barista_lane_id = p ? resolveBaristaLaneId(p as KdsProductLike, baristaLanesList) : getDefaultLaneId(baristaLanesList);\n              return { ...line, id, category1_id, category1_name, finished_at, note, barista_lane_id };'
  );
}

if (!s.includes('resolveBaristaLaneId(')) {
  s = s.replace(
    `        groupedMap.set(signature, {
          ...itemForGroup,
          total_quantity: itemForGroup.quantity,
          display_text: displayText,
          timer: '00:00', // Rendered by OrderTimer component
        });`,
    `        groupedMap.set(signature, {
          ...itemForGroup,
          total_quantity: itemForGroup.quantity,
          display_text: displayText,
          timer: '00:00', // Rendered by OrderTimer component
          lane_id: resolveBaristaLaneId(
            (productsMap.get(itemForGroup.product_id) || {}) as KdsProductLike,
            baristaLanesList
          ),
        });`
  );
}

if (!s.includes('getOrdersForBaristaLane')) {
  s = s.replace(
    `  const playTestSound = () => {`,
    `  const defaultBaristaLaneId = getDefaultLaneId(baristaLanesCatalog);

  const getOrdersForBaristaLane = (laneId: number): GroupedOrderItem[] => {
    return activeOrders
      .filter((item) => {
        if (item.packageBreakdownLines?.length) {
          return item.packageBreakdownLines.some(
            (line) => (line.barista_lane_id ?? defaultBaristaLaneId) === laneId
          );
        }
        return (item.lane_id ?? defaultBaristaLaneId) === laneId;
      })
      .map((item) => {
        if (!item.packageBreakdownLines?.length) return item;
        const lines = item.packageBreakdownLines.filter(
          (line) => (line.barista_lane_id ?? defaultBaristaLaneId) === laneId
        );
        return { ...item, packageBreakdownLines: lines };
      });
  };

  const baristaLanesToRender: KdsLaneRow[] =
    visibleBaristaLanes.length > 0
      ? visibleBaristaLanes
      : baristaLanesCatalog.length > 0
        ? baristaLanesCatalog
        : [{ id: 0, name: 'Normal', display_order: 1, is_active: 1, is_default: 1 }];

  const playTestSound = () => {`
  );
}

const startOld = [
  '    <div className="flex-1 flex h-full bg-gray-50" title="BaristaDisplay ROOT">',
  '      {/* Column 1: Active Orders */}',
  '      <div className="w-1/2 border-r border-gray-300 flex flex-col bg-indigo-50/50" title="BARISTA ACTIVE COLUMN">',
].join('\n');

const startNew = [
  '    <div className="flex-1 flex h-full bg-gray-50 overflow-x-auto" title="BaristaDisplay ROOT">',
  '      {baristaLanesToRender.map((lane, laneIndex) => {',
  '        const laneOrders =',
  '          lane.id === 0 && visibleBaristaLanes.length === 0 && baristaLanesCatalog.length === 0',
  '            ? activeOrders',
  '            : getOrdersForBaristaLane(lane.id);',
  '        return (',
  '      <motionless key={`barista-lane-${lane.id}`} className="flex-1 min-w-[280px] border-r border-gray-300 flex flex-col bg-indigo-50/50" title={`BARISTA LANE ${lane.name}`}>',
].join('\n').replaceAll('motionless', 'div');

if (s.includes(startOld)) {
  s = s.replace(startOld, startNew);
  s = s.replace(
    '<h2 className="text-2xl font-bold">Barista - Pesanan Aktif</h2>',
    '<h2 className="text-2xl font-bold">{lane.name}</h2>'
  );
  s = s.replace('{activeOrders.length === 0 ? (', '{laneOrders.length === 0 ? (');
  s = s.replace('{activeOrders.map((item, index) => {', '{laneOrders.map((item, index) => {');

  const closeOld = [
    '        </div>',
    '      </div>',
    '',
    '      {/* Column 2: Finished Orders */}',
  ].join('\n');

  const closeNew = [
    '        </div>',
    '      </div>',
    '        );',
    '      })}',
    '',
    '      {/* Column 2: Finished Orders */}',
  ].join('\n');

  s = s.replace(closeOld, closeNew);

  s = s.replace(
    'className="w-1/2 flex flex-col bg-indigo-50/30" title="BARISTA FINISHED COLUMN"',
    'className="flex-1 min-w-[280px] flex flex-col bg-indigo-50/30" title="BARISTA FINISHED COLUMN"'
  );

  s = s.replace(
    '<h2 className="text-2xl font-bold">Barista - Pesanan Selesai</h2>',
    '<h2 className="text-2xl font-bold">Pesanan Selesai</h2>'
  );

  s = s.replace(
    `<h2 className="text-2xl font-bold">{lane.name}</h2>
          <button`,
    `<h2 className="text-2xl font-bold">{lane.name}</h2>
          {laneIndex === 0 ? (
          <button`
  );

  s = s.replace(
    `<Volume2 className="w-5 h-5" />
          </button>`,
    `<Volume2 className="w-5 h-5" />
          </button>
          ) : null}`
  );
}

fs.writeFileSync(p, s);
console.log('patched BaristaDisplay');
