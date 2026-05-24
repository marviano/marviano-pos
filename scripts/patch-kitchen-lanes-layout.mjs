import fs from 'fs';

const p = 'c:/Code/marviano-pos/src/components/KitchenDisplay.tsx';
let s = fs.readFileSync(p, 'utf8');

const startOld = [
  '    <div className="flex-1 flex h-full bg-gray-50" title="KitchenDisplay ROOT">',
  '      {/* Column 1: Active Orders */}',
  '      <div className="w-1/2 border-r border-gray-300 flex flex-col bg-violet-50/50" title="KITCHEN ACTIVE COLUMN">',
].join('\n');

const startNew = [
  '    <div className="flex-1 flex h-full bg-gray-50 overflow-x-auto" title="KitchenDisplay ROOT">',
  '      {lanesToRender.map((lane, laneIndex) => {',
  '        const laneOrders =',
  '          lane.id === 0 && visibleKitchenLanes.length === 0 && kitchenLanesCatalog.length === 0',
  '            ? activeOrders',
  '            : getOrdersForKitchenLane(lane.id);',
  '        return (',
  '      <div key={`kitchen-lane-${lane.id}`} className="flex-1 min-w-[280px] border-r border-gray-300 flex flex-col bg-violet-50/50" title={`KITCHEN LANE ${lane.name}`}>',
].join('\n');

if (!s.includes(startOld)) {
  console.error('start block not found');
  process.exit(1);
}

s = s.replace(startOld, startNew);

s = s.replace(
  '<h2 className="text-2xl font-bold">Dapur - Pesanan Aktif</h2>',
  '<h2 className="text-2xl font-bold">{lane.name}</h2>'
);

s = s.replace('{activeOrders.length === 0 ? (', '{laneOrders.length === 0 ? (');
s = s.replace('{activeOrders.map((item) => {', '{laneOrders.map((item) => {');

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

if (!s.includes(closeOld)) {
  console.error('close block not found');
  process.exit(1);
}
s = s.replace(closeOld, closeNew);

s = s.replace(
  'className="w-1/2 flex flex-col bg-violet-50/30" title="KITCHEN FINISHED COLUMN"',
  'className="flex-1 min-w-[280px] flex flex-col bg-violet-50/30" title="KITCHEN FINISHED COLUMN"'
);

s = s.replace(
  '<h2 className="text-2xl font-bold">Dapur - Pesanan Selesai</h2>',
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

fs.writeFileSync(p, s);
console.log('patched KitchenDisplay layout');
