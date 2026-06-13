export const RESERVATION_STATUS_LABELS = {
  upcoming: 'Akan datang',
  attended: 'Hadir',
  cancelled: 'Dibatalkan',
} as const;

export type ReservationStatusValue = keyof typeof RESERVATION_STATUS_LABELS;

export function reservationStatusLabel(status: string | null | undefined): string {
  const s = (status || 'upcoming').toLowerCase() as ReservationStatusValue;
  return RESERVATION_STATUS_LABELS[s] ?? status ?? 'Akan datang';
}
