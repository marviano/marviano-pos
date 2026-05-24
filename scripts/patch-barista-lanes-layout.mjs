import fs from 'fs';

const p = 'c:/Code/marviano-pos/src/components/BaristaDisplay.tsx';
let s = fs.readFileSync(p, 'utf8');

const startOld = `    <div className="flex-1 flex h-full bg-gray-50" title="BaristaDisplay ROOT">
      {/* Column 1: Active Orders */}
      <div className="w-1/2 border-r border-gray-300 flex flex-col bg-indigo-50/50" title="BARISTA ACTIVE COLUMN">`;

const startNew = `    <motionless className="flex-1 flex h-full bg-gray-50 overflow-x-auto" title="BaristaDisplay ROOT">
      {lanesToRender.map((lane, laneIndex) => {
        const laneOrders =
          lane.id === 0 && visibleBaristaLanes.length === 0 && baristaLanesCatalog.length === 0
            ? activeOrders
            : getOrdersForBaristaLane(lane.id);
        return (
      <motionless key={\`barista-lane-\${lane.id}\`} className="flex-1 min-w-[280px] border-r border-gray-300 flex flex-col bg-indigo-50/50" title={\`BARISTA LANE \${lane.name}\`}>`.replaceAll('motionless', 'div');

if (!s.includes(startOld)) {
  console.error('start not found');
  process.exit(1);
}
s = s.replace(startOld, startNew);

s = s.replace(
  '<h2 className="text-2xl font-bold">Barista - Pesanan Aktif</h2>',
  '<h2 className="text-2xl font-bold">{lane.name}</h2>'
);
s = s.replace('{activeOrders.length === 0 ? (', '{laneOrders.length === 0 ? (');
s = s.replace('{activeOrders.map((item, index) => {', '{laneOrders.map((item, index) => {');

const closeOld = `        </div>
      </motionless>

      {/* Column 2: Finished Orders */}`.replaceAll('motionless', 'div');

const closeNew = `        </div>
      </div>
        );
      })}

      {/* Column 2: Finished Orders */}`;

if (!s.includes(closeOld)) {
  console.error('close not found');
  process.exit(1);
}
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

fs.writeFileSync(p, s);
console.log('patched BaristaDisplay');
