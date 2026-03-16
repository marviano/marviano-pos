'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchFromVps, initApiUrlCache } from '@/lib/api';

interface Room {
  id: number;
  business_id: number;
  name: string;
  canvas_width?: number | null;
  canvas_height?: number | null;
  font_size_multiplier?: number | null;
}

interface Table {
  id: number;
  room_id: number;
  table_number: string;
  position_x: number | string;
  position_y: number | string;
  width: number | string;
  height: number | string;
  capacity: number;
  shape: 'circle' | 'rectangle';
  section_id?: number | null;
}

interface Section {
  id: number;
  room_id: number;
  name: string;
  color: string;
}

interface ReservationTablePickerProps {
  businessId: number;
  selectedTableIds: number[];
  onChange: (ids: number[]) => void;
  /** When true, only show layout view (for viewing assigned tables in a modal). */
  readOnly?: boolean;
  /** Called with room canvas_width and canvas_height from DB when layout is ready (for modal sizing). */
  onLayoutSizeReady?: (canvasWidth: number, canvasHeight: number) => void;
}

export default function ReservationTablePicker({ businessId, selectedTableIds, onChange, readOnly = false, onLayoutSizeReady }: ReservationTablePickerProps) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tablesByRoom, setTablesByRoom] = useState<Record<number, Table[]>>({});
  const [sectionsByRoom, setSectionsByRoom] = useState<Record<number, Section[]>>({});
  const [tabMode, setTabMode] = useState<'all' | number | 'layout'>(readOnly ? 'layout' : 'all');
  const [layoutRoomId, setLayoutRoomId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 400, height: 280 });

  const allTables: Table[] = rooms.flatMap((r) => tablesByRoom[r.id] ?? []);
  const allSections: { section: Section; room: Room }[] = rooms.flatMap((room) =>
    (sectionsByRoom[room.id] ?? []).map((section) => ({ section, room }))
  );

  const toggleTable = useCallback(
    (tableId: number) => {
      if (selectedTableIds.includes(tableId)) {
        onChange(selectedTableIds.filter((id) => id !== tableId));
      } else {
        onChange([...selectedTableIds, tableId]);
      }
    },
    [selectedTableIds, onChange]
  );

  const toggleSection = useCallback(
    (sectionId: number) => {
      const tablesInSection = allTables.filter((t) => t.section_id === sectionId);
      const idsInSection = new Set(tablesInSection.map((t) => t.id));
      const allSelected = tablesInSection.every((t) => selectedTableIds.includes(t.id));
      if (allSelected) {
        onChange(selectedTableIds.filter((id) => !idsInSection.has(id)));
      } else {
        const added = new Set(selectedTableIds);
        tablesInSection.forEach((t) => added.add(t.id));
        onChange(Array.from(added));
      }
    },
    [allTables, selectedTableIds, onChange]
  );

  /** Tables for the current tab (all tables, or tables in selected section) */
  const tablesForActiveTab =
    tabMode === 'all' || tabMode === 'layout'
      ? allTables
      : allTables.filter((t) => t.section_id === tabMode);

  const selectAllActive = useCallback(() => {
    const ids = new Set(selectedTableIds);
    tablesForActiveTab.forEach((t) => ids.add(t.id));
    onChange(Array.from(ids));
  }, [selectedTableIds, tablesForActiveTab, onChange]);

  const deselectAllActive = useCallback(() => {
    const idsInActive = new Set(tablesForActiveTab.map((t) => t.id));
    onChange(selectedTableIds.filter((id) => !idsInActive.has(id)));
  }, [selectedTableIds, tablesForActiveTab, onChange]);

  const allActiveSelected =
    tablesForActiveTab.length > 0 && tablesForActiveTab.every((t) => selectedTableIds.includes(t.id));
  const someActiveSelected = tablesForActiveTab.some((t) => selectedTableIds.includes(t.id));

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await initApiUrlCache();
        const roomsData = await fetchFromVps<Room[]>(`/api/restaurant-rooms?business_id=${businessId}`);
        const roomsArray = Array.isArray(roomsData) ? roomsData : [];
        setRooms(roomsArray);
        if (roomsArray.length > 0 && !layoutRoomId) setLayoutRoomId(roomsArray[0].id);

        const tables: Record<number, Table[]> = {};
        const sections: Record<number, Section[]> = {};
        const api = window.electronAPI;
        for (const room of roomsArray) {
          if (cancelled) return;
          const [tablesData, sectionsData] = await Promise.all([
            fetchFromVps<Table[]>(`/api/restaurant-tables?room_id=${room.id}`),
            api?.getRestaurantSections?.(room.id) ?? Promise.resolve([])
          ]);
          tables[room.id] = Array.isArray(tablesData) ? tablesData : [];
          sections[room.id] = Array.isArray(sectionsData) ? sectionsData : [];
        }
        if (!cancelled) {
          setTablesByRoom(tables);
          setSectionsByRoom(sections);
        }
      } catch (e) {
        console.error('ReservationTablePicker fetch error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const layoutRoom = layoutRoomId ? rooms.find((r) => r.id === layoutRoomId) ?? rooms[0] : rooms[0];
  const layoutTables = layoutRoom ? tablesByRoom[layoutRoom.id] ?? [] : [];
  const layoutSections = layoutRoom ? sectionsByRoom[layoutRoom.id] ?? [] : [];

  // Canvas size: use exact room canvas_width x canvas_height (like kasir TableLayout), else fit container
  useEffect(() => {
    if (tabMode !== 'layout' || !layoutRoom) return;
    if (layoutRoom.canvas_width != null && layoutRoom.canvas_height != null) {
      const w = Number(layoutRoom.canvas_width);
      const h = Number(layoutRoom.canvas_height);
      setCanvasSize((prev) => (prev.width !== w || prev.height !== h ? { width: w, height: h } : prev));
      return;
    }
    if (!canvasContainerRef.current) return;
    const w = canvasContainerRef.current.clientWidth || 400;
    const h = (w / 16) * 9;
    setCanvasSize((prev) => (prev.width !== w || prev.height !== h ? { width: w, height: Math.max(200, h) } : prev));
  }, [tabMode, layoutRoom, layoutRoom?.canvas_width, layoutRoom?.canvas_height]);

  // Report DB canvas size to parent for modal sizing (readOnly mode)
  useEffect(() => {
    if (!readOnly || !onLayoutSizeReady || !layoutRoom) return;
    const cw = layoutRoom.canvas_width ?? 1600;
    const ch = layoutRoom.canvas_height ?? 900;
    onLayoutSizeReady(Number(cw), Number(ch));
  }, [readOnly, onLayoutSizeReady, layoutRoom, layoutRoom?.canvas_width, layoutRoom?.canvas_height]);

  const selectedTableNumbers = allTables
    .filter((t) => selectedTableIds.includes(t.id))
    .map((t) => t.table_number)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (loading) {
    return (
      <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 min-h-[120px] flex items-center justify-center text-slate-500">
        Memuat meja...
      </div>
    );
  }

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50 min-h-[120px]">
      {!readOnly ? (
        <div className="flex gap-3 min-h-[140px]">
          {/* Vertical section tabs */}
          <div className="flex flex-col gap-0.5 border border-slate-200 rounded-lg bg-white p-1 shrink-0 w-[140px]">
            <button
              type="button"
              onClick={() => setTabMode('all')}
              className={`px-2 py-2 rounded text-left text-sm font-medium transition-colors ${
                tabMode === 'all' ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              Semua Meja
            </button>
            {allSections.map(({ section }) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setTabMode(section.id)}
                className={`px-2 py-2 rounded text-left text-sm font-medium transition-colors ${
                  tabMode === section.id ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {section.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTabMode('layout')}
              className={`px-2 py-2 rounded text-left text-sm font-medium transition-colors ${
                tabMode === 'layout' ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              Layout
            </button>
          </div>

          {/* Content: table list with select all / deselect all, or layout */}
          {tabMode !== 'layout' ? (
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={selectAllActive}
                  disabled={tablesForActiveTab.length === 0 || allActiveSelected}
                  className="px-2 py-1 rounded text-xs font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Pilih semua
                </button>
                <button
                  type="button"
                  onClick={deselectAllActive}
                  disabled={tablesForActiveTab.length === 0 || !someActiveSelected}
                  className="px-2 py-1 rounded text-xs font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Hapus semua
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {tablesForActiveTab.map((table) => {
                  const selected = selectedTableIds.includes(table.id);
                  return (
                    <button
                      key={table.id}
                      type="button"
                      onClick={() => toggleTable(table.id)}
                      className={`px-3 py-1.5 rounded text-sm border ${
                        selected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-400 text-slate-800 hover:bg-slate-100'
                      }`}
                    >
                      {table.table_number}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : layoutRoom ? (
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              {rooms.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {rooms.map((room) => (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => setLayoutRoomId(room.id)}
                      className={`px-2 py-1 rounded text-xs ${
                        layoutRoomId === room.id ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300 text-slate-600'
                      }`}
                    >
                      {room.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex-1 min-h-[200px] overflow-auto">
              <div
                ref={canvasContainerRef}
                className="relative bg-slate-100 rounded border border-slate-300 overflow-hidden shrink-0"
                style={{
                  width: layoutRoom.canvas_width != null && layoutRoom.canvas_height != null
                    ? canvasSize.width
                    : '100%',
                  height: layoutRoom.canvas_width != null && layoutRoom.canvas_height != null
                    ? canvasSize.height
                    : canvasSize.height,
                  minHeight: 200,
                  backgroundImage: `
                    linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px),
                    linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)
                  `,
                  backgroundSize: '16px 16px'
                }}
              >
                {layoutTables.map((table) => {
                  const posX = typeof table.position_x === 'string' ? parseFloat(table.position_x) : table.position_x;
                  const posY = typeof table.position_y === 'string' ? parseFloat(table.position_y) : table.position_y;
                  const wPct = typeof table.width === 'string' ? parseFloat(table.width) : table.width;
                  const hPct = typeof table.height === 'string' ? parseFloat(table.height) : table.height;
                  const pixelX = (posX / 100) * canvasSize.width;
                  const pixelY = (posY / 100) * canvasSize.height;
                  const pixelW = Math.max(24, (wPct / 100) * canvasSize.width);
                  const pixelH = Math.max(24, (hPct / 100) * canvasSize.height);
                  const selected = selectedTableIds.includes(table.id);
                  return (
                    <div
                      key={table.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleTable(table.id)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggleTable(table.id)}
                      className={`absolute flex items-center justify-center text-xs font-semibold border-2 cursor-pointer ${
                        table.shape === 'circle' ? 'rounded-full' : 'rounded'
                      } ${
                        selected ? 'bg-blue-600 text-white border-blue-700' : 'bg-slate-200 text-slate-800 border-slate-400 hover:bg-slate-300'
                      }`}
                      style={{
                        left: pixelX,
                        top: pixelY,
                        width: pixelW,
                        height: pixelH,
                        minWidth: 28,
                        minHeight: 28
                      }}
                    >
                      {table.table_number}
                    </div>
                  );
                })}
              </div>
            </div>
            </div>
          ) : (
            <div className="flex-1 min-w-0" />
          )}
        </div>
      ) : null}

      {tabMode === 'layout' && readOnly && layoutRoom && (
        <div className="space-y-2">
          {rooms.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {rooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setLayoutRoomId(room.id)}
                  className={`px-2 py-1 rounded text-xs ${
                    layoutRoomId === room.id ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300 text-slate-600'
                  }`}
                >
                  {room.name}
                </button>
              ))}
            </div>
          )}
          <div className="overflow-auto min-h-[200px]">
            <div
              ref={canvasContainerRef}
              className="relative bg-slate-100 rounded border border-slate-300 overflow-hidden shrink-0"
              style={{
                width: layoutRoom.canvas_width != null && layoutRoom.canvas_height != null ? canvasSize.width : '100%',
                height: layoutRoom.canvas_width != null && layoutRoom.canvas_height != null ? canvasSize.height : canvasSize.height,
                minHeight: 200,
                backgroundImage: `
                  linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px),
                  linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)
                `,
                backgroundSize: '16px 16px'
              }}
            >
            {layoutTables.map((table) => {
              const posX = typeof table.position_x === 'string' ? parseFloat(table.position_x) : table.position_x;
              const posY = typeof table.position_y === 'string' ? parseFloat(table.position_y) : table.position_y;
              const wPct = typeof table.width === 'string' ? parseFloat(table.width) : table.width;
              const hPct = typeof table.height === 'string' ? parseFloat(table.height) : table.height;
              const pixelX = (posX / 100) * canvasSize.width;
              const pixelY = (posY / 100) * canvasSize.height;
              const pixelW = Math.max(24, (wPct / 100) * canvasSize.width);
              const pixelH = Math.max(24, (hPct / 100) * canvasSize.height);
              const selected = selectedTableIds.includes(table.id);
              return (
                <div
                  key={table.id}
                  className={`absolute flex items-center justify-center text-xs font-semibold border-2 cursor-default ${table.shape === 'circle' ? 'rounded-full' : 'rounded'} ${
                    selected ? 'bg-blue-600 text-white border-blue-700' : 'bg-slate-200 text-slate-800 border-slate-400'
                  }`}
                  style={{
                    left: pixelX,
                    top: pixelY,
                    width: pixelW,
                    height: pixelH,
                    minWidth: 28,
                    minHeight: 28
                  }}
                >
                  {table.table_number}
                </div>
              );
            })}
            </div>
          </div>
        </div>
      )}

      {selectedTableNumbers.length > 0 && !readOnly && (
        <p className="text-xs text-slate-600 mt-2">
          Dipilih: {selectedTableNumbers.join(', ')}
        </p>
      )}
    </div>
  );
}
