'use client';

import { useState, useEffect, useRef } from 'react';
import ReservationTableDetailPopover, { type ReservationRowForPopover } from './ReservationTableDetailPopover';

interface Room {
  id: number;
  business_id: number;
  name: string;
  canvas_width?: number | null;
  canvas_height?: number | null;
}

interface Table {
  id: number;
  room_id: number;
  table_number: string;
  position_x: number | string;
  position_y: number | string;
  width: number | string;
  height: number | string;
  shape: 'circle' | 'rectangle';
}

interface ReservationRowForHeatmap {
  uuid_id: string;
  nama: string;
  phone?: string;
  jam: string;
  pax: number;
  status: string;
  table_ids_json?: string | number[] | null;
  deleted_at?: string | null;
}

interface ReservationSeatHeatmapProps {
  businessId: number;
  selectedDate: string;
  dateLabel: string;
  reservations: ReservationRowForHeatmap[];
  onBackToCalendar: () => void;
  /** When true, canvas fills available height (e.g. inside calendar modal) instead of being capped */
  fillHeight?: boolean;
}

/** Coerce table_ids_json (DB may return string, number[], or string[]) to number[] for numeric comparison. */
function parseTableIds(raw: string | number[] | null | undefined): number[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((id) => Number(id)).filter((id) => !Number.isNaN(id));
  }
  if (typeof raw === 'string') {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map((id: unknown) => Number(id)).filter((id: number) => !Number.isNaN(id)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Get table_ids from a reservation row; DB/driver may use different key casing. */
function getTableIdsFromReservation(r: ReservationRowForHeatmap | Record<string, unknown>): number[] {
  const rec = r as Record<string, unknown>;
  const raw = rec['table_ids_json'] ?? rec['table_ids_JSON'] ?? (r as ReservationRowForHeatmap).table_ids_json;
  return parseTableIds(raw as string | number[] | null | undefined);
}

function getReservationsForTable(
  tableId: number,
  reservations: ReservationRowForHeatmap[]
): ReservationRowForPopover[] {
  const numId = Number(tableId);
  if (Number.isNaN(numId)) return [];
  return reservations.filter((r) => {
    const ids = getTableIdsFromReservation(r);
    return ids.some((id) => Number(id) === numId);
  });
}

function getActiveCount(reservations: ReservationRowForHeatmap[]): number {
  return reservations.filter(
    (r) => r.status !== 'cancelled' && !r.deleted_at
  ).length;
}

export default function ReservationSeatHeatmap({
  businessId,
  selectedDate,
  dateLabel,
  reservations,
  onBackToCalendar,
  fillHeight = false
}: ReservationSeatHeatmapProps) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tablesByRoom, setTablesByRoom] = useState<Record<number, Table[]>>({});
  const [layoutRoomId, setLayoutRoomId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [canvasSize, setCanvasSize] = useState({ width: 400, height: 280 });
  const [popover, setPopover] = useState<{
    tableId: number;
    tableNumber: string;
    list: ReservationRowForPopover[];
  } | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getRestaurantRooms || !businessId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const roomsData = await api.getRestaurantRooms?.(businessId);
        const roomsArray = Array.isArray(roomsData) ? roomsData : [];
        setRooms(roomsArray);
        if (roomsArray.length > 0 && !layoutRoomId) setLayoutRoomId(roomsArray[0].id);

        const tables: Record<number, Table[]> = {};
        for (const room of roomsArray) {
          if (cancelled) return;
          const tablesData = await api.getRestaurantTables?.(room.id);
          tables[room.id] = Array.isArray(tablesData) ? tablesData : [];
        }
        if (!cancelled) setTablesByRoom(tables);
      } catch (e) {
        console.error('ReservationSeatHeatmap fetch error:', e);
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

  // Canvas size: use exact room canvas_width x canvas_height (like kasir TableLayout), else fallback
  useEffect(() => {
    if (!layoutRoom) return;
    const cw = layoutRoom.canvas_width != null && layoutRoom.canvas_height != null
      ? Number(layoutRoom.canvas_width)
      : 1600;
    const ch = layoutRoom.canvas_width != null && layoutRoom.canvas_height != null
      ? Number(layoutRoom.canvas_height)
      : 900;
    // Kasir style: use stored dimensions as exact pixel size so layout matches table layout page
    if (layoutRoom.canvas_width != null && layoutRoom.canvas_height != null) {
      const w = Number(layoutRoom.canvas_width);
      const h = Number(layoutRoom.canvas_height);
      setCanvasSize((prev) => (prev.width !== w || prev.height !== h ? { width: w, height: h } : prev));
      return;
    }
    // Fallback when room has no stored dimensions
    const updateSize = () => {
      if (fillHeight && wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        const availableW = rect.width || 400;
        const availableH = rect.height || 300;
        const aspect = ch / cw;
        const w = availableH / aspect > availableW ? availableW : availableH / aspect;
        const h = (w / cw) * ch;
        setCanvasSize((prev) => (prev.width !== w || prev.height !== h ? { width: w, height: h } : prev));
      } else if (canvasContainerRef.current) {
        const w = canvasContainerRef.current.clientWidth || 400;
        const h = (w / cw) * ch;
        setCanvasSize((prev) => (prev.width !== w || prev.height !== h ? { width: w, height: Math.max(200, h) } : prev));
      }
    };
    if (fillHeight && wrapperRef.current) {
      const ro = new ResizeObserver(updateSize);
      ro.observe(wrapperRef.current);
      updateSize();
      return () => ro.disconnect();
    }
    updateSize();
  }, [layoutRoom, layoutRoom?.canvas_width, layoutRoom?.canvas_height, fillHeight]);

  const getTableCount = (tableId: number): number => {
    const list = getReservationsForTable(tableId, reservations);
    return getActiveCount(list);
  };

  const getTableClass = (count: number, hasOverlap: boolean): string => {
    const base = 'absolute flex items-center justify-center text-xs font-semibold border-2 cursor-pointer ';
    const shape = ''; // applied per-table via shape
    if (count === 0) return base + 'bg-slate-200 text-slate-700 border-slate-400 hover:bg-slate-300';
    const color =
      count >= 3
        ? 'bg-indigo-400 text-white border-indigo-600'
        : count === 2
          ? 'bg-blue-300 text-blue-900 border-blue-500'
          : 'bg-blue-100 text-blue-800 border-blue-300';
    const warn = hasOverlap ? ' ring-2 ring-orange-400 ring-offset-1 border-orange-500' : '';
    return base + color + warn;
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={onBackToCalendar}
            className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200"
          >
            ← Kalender
          </button>
          <h3 className="text-sm font-bold text-slate-800">Denah Meja</h3>
          <span className="rounded-full bg-blue-100 text-blue-700 px-2.5 py-0.5 text-xs font-semibold">
            {dateLabel}
          </span>
        </div>
        <div className="py-8 text-center text-slate-500 text-sm">Memuat denah...</div>
      </div>
    );
  }

  if (rooms.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={onBackToCalendar}
            className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200"
          >
            ← Kalender
          </button>
          <h3 className="text-sm font-bold text-slate-800">Denah Meja</h3>
          <span className="rounded-full bg-blue-100 text-blue-700 px-2.5 py-0.5 text-xs font-semibold">
            {dateLabel}
          </span>
        </div>
        <div className="py-8 text-center text-slate-500 text-sm">Tidak ada ruangan/meja.</div>
      </div>
    );
  }

  return (
    <div
      ref={fillHeight ? wrapperRef : undefined}
      className={`rounded-xl border border-slate-200 bg-white overflow-hidden ${fillHeight ? 'flex flex-col flex-1 min-h-0' : ''}`}
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 shrink-0">
        <button
          type="button"
          onClick={onBackToCalendar}
          className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200"
        >
          ← Kalender
        </button>
        <h3 className="text-sm font-bold text-slate-800">Denah Meja</h3>
        <span className="rounded-full bg-blue-100 text-blue-700 px-2.5 py-0.5 text-xs font-semibold">
          {dateLabel}
        </span>
      </div>

      {rooms.length > 1 && (
        <div className="flex flex-wrap gap-1 px-4 py-2 border-b border-slate-100 shrink-0">
          {rooms.map((room) => (
            <button
              key={room.id}
              type="button"
              onClick={() => setLayoutRoomId(room.id)}
              className={`px-2 py-1 rounded text-xs font-medium ${
                layoutRoomId === room.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {room.name}
            </button>
          ))}
        </div>
      )}

      {fillHeight ? (
        <div ref={wrapperRef} className="flex-1 min-h-[320px] m-3 overflow-auto">
          <div
            ref={canvasContainerRef}
            className="relative bg-slate-50 rounded-lg border border-slate-200 overflow-hidden shrink-0"
            style={{
              width: canvasSize.width > 0 ? canvasSize.width : '100%',
              height: canvasSize.height > 0 ? canvasSize.height : 400,
              minHeight: 400,
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
          const pixelW = Math.max(28, (wPct / 100) * canvasSize.width);
          const pixelH = Math.max(28, (hPct / 100) * canvasSize.height);
          const tableReservations = getReservationsForTable(table.id, reservations);
          const count = getActiveCount(tableReservations);
          const hasOverlap = count >= 2;
          return (
            <div
              key={table.id}
              role="button"
              tabIndex={0}
              onClick={() => setPopover({ tableId: table.id, tableNumber: table.table_number, list: tableReservations })}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setPopover({ tableId: table.id, tableNumber: table.table_number, list: tableReservations })}
              className={getTableClass(count, hasOverlap) + (table.shape === 'circle' ? ' rounded-full' : ' rounded')}
              style={{
                left: pixelX,
                top: pixelY,
                width: pixelW,
                height: pixelH,
                minWidth: 28,
                minHeight: 28
              }}
            >
              {hasOverlap && <span className="absolute -top-1 -left-1 text-xs" aria-hidden>⚠️</span>}
              <span>{table.table_number}</span>
              {count >= 1 && (
                <span className="absolute -top-1 -right-1 bg-blue-700 text-white rounded-full text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  ×{count}
                </span>
              )}
            </div>
          );
        })}
          </div>
        </div>
      ) : (
      <div className="m-3 overflow-auto min-h-[280px]" style={{ maxHeight: '400px' }}>
        <div
          ref={canvasContainerRef}
          className="relative bg-slate-50 rounded-lg border border-slate-200 overflow-hidden"
          style={{
            width: canvasSize.width > 0 ? canvasSize.width : '100%',
            height: canvasSize.height > 0 ? canvasSize.height : 280,
            minHeight: 280,
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
          const pixelW = Math.max(28, (wPct / 100) * canvasSize.width);
          const pixelH = Math.max(28, (hPct / 100) * canvasSize.height);
          const tableReservations = getReservationsForTable(table.id, reservations);
          const count = getActiveCount(tableReservations);
          const hasOverlap = count >= 2;
          return (
            <div
              key={table.id}
              role="button"
              tabIndex={0}
              onClick={() => setPopover({ tableId: table.id, tableNumber: table.table_number, list: tableReservations })}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setPopover({ tableId: table.id, tableNumber: table.table_number, list: tableReservations })}
              className={getTableClass(count, hasOverlap) + (table.shape === 'circle' ? ' rounded-full' : ' rounded')}
              style={{
                left: pixelX,
                top: pixelY,
                width: pixelW,
                height: pixelH,
                minWidth: 28,
                minHeight: 28
              }}
            >
              {hasOverlap && <span className="absolute -top-1 -left-1 text-xs" aria-hidden>⚠️</span>}
              <span>{table.table_number}</span>
              {count >= 1 && (
                <span className="absolute -top-1 -right-1 bg-blue-700 text-white rounded-full text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  ×{count}
                </span>
              )}
            </div>
          );
        })}
        </div>
      </div>
      )}

      <div className="flex flex-wrap gap-4 px-4 py-3 border-t border-slate-200 text-xs text-slate-600 shrink-0">
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded border border-slate-400 bg-slate-200" /> Kosong
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded border border-blue-300 bg-blue-100" /> ×1 reservasi
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded border border-blue-500 bg-blue-300" /> ×2 reservasi
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded border border-indigo-600 bg-indigo-400" /> ×3+ reservasi
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded border-2 border-orange-500 bg-white ring-2 ring-orange-200" /> ⚠️ Potensi overlap
        </span>
      </div>

      {popover && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setPopover(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm">
            <ReservationTableDetailPopover
              tableNumber={popover.tableNumber}
              dateLabel={dateLabel}
              reservations={popover.list}
              onClose={() => setPopover(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
