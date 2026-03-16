'use client';

export type ReservationRowForPopover = {
  uuid_id: string;
  nama: string;
  phone?: string;
  jam: string;
  pax: number;
  status: string;
  table_ids_json?: string | number[] | null;
  deleted_at?: string | null;
};

interface ReservationTableDetailPopoverProps {
  tableNumber: string;
  dateLabel: string;
  reservations: ReservationRowForPopover[];
  onClose: () => void;
}

function parseTableIds(raw: string | number[] | null | undefined): number[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((id) => Number(id)).filter((id) => !Number.isNaN(id));
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

function formatTime(jam: string): string {
  if (typeof jam !== 'string' || !jam) return '-';
  if (jam.length >= 5 && /^\d{1,2}:\d{2}/.test(jam)) return jam.slice(0, 5);
  const d = new Date('1970-01-01T' + jam);
  if (Number.isNaN(d.getTime())) return jam;
  return d.toTimeString().slice(0, 5);
}

export default function ReservationTableDetailPopover({
  tableNumber,
  dateLabel,
  reservations,
  onClose
}: ReservationTableDetailPopoverProps) {
  const sorted = [...reservations].sort((a, b) => {
    const tA = formatTime(a.jam);
    const tB = formatTime(b.jam);
    return tA.localeCompare(tB);
  });

  const activeCount = sorted.filter(
    (r) => r.status !== 'cancelled' && !r.deleted_at
  ).length;
  const showOverlapWarning = activeCount >= 2;

  const statusBadge = (status: string) => {
    const s = (status || '').toLowerCase();
    const classes =
      s === 'upcoming'
        ? 'bg-blue-100 text-blue-800'
        : s === 'attended'
          ? 'bg-green-100 text-green-800'
          : 'bg-slate-100 text-slate-500';
    const label = s === 'upcoming' ? 'Upcoming' : s === 'attended' ? 'Attended' : 'Cancelled';
    return (
      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${classes}`}>
        {label}
      </span>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 w-full max-w-sm shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <div>
          <h4 className="text-sm font-bold text-slate-800">Meja {tableNumber}</h4>
          <small className="text-xs text-slate-500">{dateLabel} · {sorted.length} reservasi</small>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-600 rounded"
          aria-label="Tutup"
        >
          ✕
        </button>
      </div>

      {showOverlapWarning && (
        <div className="mx-3 mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3">
          <span className="text-base shrink-0" aria-hidden>⚠️</span>
          <p className="text-xs text-amber-800 leading-snug">
            <strong>Perhatian:</strong> Meja ini memiliki {activeCount} reservasi aktif pada hari yang sama. Karena tidak ada batas waktu duduk, pastikan jadwal ini sudah dikonfirmasi dengan tamu.
          </p>
        </div>
      )}

      <div className="max-h-64 overflow-auto">
        {sorted.map((r) => {
          const isCancelled = r.status === 'cancelled' || !!r.deleted_at;
          return (
            <div
              key={r.uuid_id}
              className={`px-4 py-3 border-b border-slate-100 last:border-b-0 ${isCancelled ? 'opacity-60' : ''}`}
            >
              <div className="font-semibold text-slate-800 text-sm">
                {r.nama} <span className="text-slate-500 font-normal">· {r.pax} pax</span>
              </div>
              <div className="text-xs text-slate-600 mt-0.5">Mulai {formatTime(r.jam)}</div>
              <div className="mt-1.5">{statusBadge(r.status)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
