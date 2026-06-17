export type ReservationFinancePaymentType = 'dp' | 'pelunasan' | 'refund' | 'refund_exc';

export interface ReservationFinanceEntry {
  id: string;
  source: 'payment' | 'refund_exc';
  direction: 'in' | 'out';
  payment_type: ReservationFinancePaymentType;
  amount: number;
  payment_method: string | null;
  reservation_uuid: string | null;
  reservation_nama: string | null;
  reservation_tanggal: string | null;
  reservation_jam: string | null;
  guest_nama: string | null;
  guest_phone: string | null;
  note: string | null;
  transaction_uuid: string | null;
  created_at: string;
  created_by_email: string | null;
}

export interface ReservationFinanceSummary {
  total_dp_in: number;
  total_pelunasan_in: number;
  total_refund_out: number;
  net_balance: number;
}

export interface ReservationFinanceResult {
  success: boolean;
  summary?: ReservationFinanceSummary;
  entries?: ReservationFinanceEntry[];
  error?: string;
}
