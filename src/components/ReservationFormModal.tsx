'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { generateUUID } from '@/lib/uuid';
import { getTodayUTC7 } from '@/lib/dateUtils';
import { formatPhoneDisplay, formatNumberForInput, normalizePhoneForDb, parseNumberInput, isValidIndonesianPhone } from '@/lib/formatUtils';
import ContactBookPopover, { type ContactSuggestion } from './ContactBookPopover';
import { parseReservationItemsJson, computeTotalFromReservationItems } from '@/lib/reservationItems';
import { reservationRowSnapshot } from '@/lib/reservationActivityLog';
import { appAlert } from '@/components/AppDialog';
import { fetchFromVps, initApiUrlCache } from '@/lib/api';
import { saveReservationToLocalMySQL, syncReservationsToVpsInBackground } from '@/lib/reservationLocalFirst';
import { RESERVATION_STATUS_LABELS } from '@/lib/reservationStatus';
import { jamToDisplay, parseJamDotInput, sanitizeJamDotTyping } from '@/lib/reservationTimeFormat';
import ReservationTablePicker from './ReservationTablePicker';

export type ReservationSaveResult = {
  tanggal: string;
  saved: ReservationRow;
};


export type ReservationRow = {
  id?: number;
  uuid_id: string;
  business_id: number;
  nama: string;
  phone: string;
  tanggal: string;
  jam: string;
  pax: number;
  dp: number;
  total_price: number;
  table_ids_json: string | number[] | null;
  items_json?: string | unknown[] | null;
  penanggung_jawab_id: number | null;
  created_by_email?: string | null;
  note: string | null;
  status: string;
  payment_status?: 'none' | 'dp_only' | 'paid' | string;
  recorded_dp?: number;
  pelunasan_transaction_uuid?: string | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  deleted_reason?: string | null;
};

async function resolveContactByPhone(
  phoneForDb: string,
  businessId: number
): Promise<ContactSuggestion | null> {
  const api = window.electronAPI;
  if (!api || !isValidIndonesianPhone(phoneForDb)) return null;

  if (api.localDbSearchContacts) {
    const rows = await api.localDbSearchContacts(phoneForDb, businessId);
    const list = Array.isArray(rows) ? (rows as ContactSuggestion[]) : [];
    const exact = list.find((s) => normalizePhoneForDb(s.phone_number ?? '') === phoneForDb);
    if (exact) return exact;
  }

  const found = await api.localDbFindContactByPhone?.(phoneForDb);
  if (found?.id) {
    return {
      id: Number(found.id),
      nama: String(found.nama ?? ''),
      phone_number: String(found.phone_number ?? phoneForDb),
    };
  }
  return null;
}

function formatContactQueryDisplay(nama: string, phone: string): string {
  const n = nama.trim();
  const p = phone.trim();
  if (n && p) return `${n} · ${formatPhoneDisplay(p)}`;
  if (n) return n;
  if (p) return formatPhoneDisplay(p);
  return '';
}

function isQueryPhoneLike(query: string): boolean {
  const digits = query.replace(/\D/g, '');
  if (digits.length < 9) return false;
  return isValidIndonesianPhone(normalizePhoneForDb(digits));
}

function isQueryNameLike(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length < 2) return false;
  if (isQueryPhoneLike(trimmed)) return false;
  return trimmed.replace(/\D/g, '').length < 9;
}

type ContactRegistrationMode = 'search' | 'need_name' | 'need_phone';

function parseContactQuery(
  query: string,
  selectedContact: ContactSuggestion | null
): { nama: string; phone: string } | { error: string } {
  if (selectedContact) {
    const phone = normalizePhoneForDb(selectedContact.phone_number ?? '');
    return { nama: selectedContact.nama.trim(), phone };
  }

  const trimmed = query.trim();
  if (!trimmed) return { error: 'Nama atau no. HP wajib diisi.' };

  if (trimmed.includes('·')) {
    const sepIdx = trimmed.indexOf('·');
    const nama = trimmed.slice(0, sepIdx).trim();
    const phone = normalizePhoneForDb(trimmed.slice(sepIdx + 1).trim());
    if (nama.length >= 2 && isValidIndonesianPhone(phone)) {
      return { nama, phone };
    }
  }

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length >= 9) {
    const phone = normalizePhoneForDb(digitsOnly);
    if (isValidIndonesianPhone(phone)) {
      const nama = trimmed
        .replace(/[\d\s\-().+]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (nama.length >= 2) return { nama, phone };
      return { error: 'Tambahkan nama sebelum no. HP (contoh: Budi 082234662863).' };
    }
  }

  if (trimmed.length >= 2) {
    return { error: 'Lengkapi dengan no. HP (contoh: Budi 082234662863).' };
  }

  return { error: 'Format tidak valid. Contoh: Budi 082234662863' };
}

interface ReservationFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after save with the saved row for optimistic list update. */
  onSaved: (result: ReservationSaveResult) => void;
  businessId: number;
  reservation?: ReservationRow | null;
  userEmail?: string | null;
  /** Pre-fetched employees (PJ list) from VPS; if not provided, modal will fetch from VPS when open. */
  employees?: Record<string, unknown>[];
  onLogActivity?: (action: string, details: Record<string, unknown>) => Promise<void>;
  /** Called when user clicks "Pilih Produk dari Kasir" – parent should switch to Kasir and set pre-order mode with this reservation. */
  onPickProductsFromKasir?: (reservation: ReservationRow) => void;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export default function ReservationFormModal({
  isOpen,
  onClose,
  onSaved,
  businessId,
  reservation,
  userEmail,
  employees: employeesProp,
  onLogActivity,
  onPickProductsFromKasir
}: ReservationFormModalProps) {
  const isEdit = !!reservation?.uuid_id;
  const [contactQuery, setContactQuery] = useState('');
  const [nama, setNama] = useState('');
  const [phone, setPhone] = useState('');
  const [tanggal, setTanggal] = useState('');
  const [jamInput, setJamInput] = useState('');
  const [jamError, setJamError] = useState<string | null>(null);
  const [paxInput, setPaxInput] = useState('1');
  const [paxError, setPaxError] = useState<string | null>(null);
  const [status, setStatus] = useState<'upcoming' | 'attended' | 'cancelled'>('upcoming');
  const [dp, setDp] = useState(0);
  const [selectedTableIds, setSelectedTableIds] = useState<number[]>([]);
  const [penanggungJawabId, setPenanggungJawabId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState<Record<string, unknown>[]>([]);
  const [contactSuggestions, setContactSuggestions] = useState<ContactSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactSuggestion | null>(null);
  const [contactMode, setContactMode] = useState<ContactRegistrationMode>('search');
  const [pendingPhone, setPendingPhone] = useState('');
  const [pendingNama, setPendingNama] = useState('');
  const [regNama, setRegNama] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPhoneError, setRegPhoneError] = useState<string | null>(null);
  const [phoneConflictContact, setPhoneConflictContact] = useState<ContactSuggestion | null>(null);
  const [showContactBook, setShowContactBook] = useState(false);
  const [contactQueryError, setContactQueryError] = useState<string | null>(null);
  const [isConfirmingContact, setIsConfirmingContact] = useState(false);
  const [regNamaConfirmed, setRegNamaConfirmed] = useState(false);
  const [regPhoneConfirmed, setRegPhoneConfirmed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);
  const backdropMouseDownRef = useRef(false);

  // Normalize date to YYYY-MM-DD for type="date"
  const normalizeTanggal = (v: unknown): string => {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (s.includes('T')) return s.slice(0, 10);
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  };
  // Normalize time to HH:mm for storage
  const normalizeJam = (v: unknown): string => {
    const parsed = parseJamDotInput(String(v ?? '').trim());
    return parsed ?? '';
  };

  const parsePaxInput = (raw: string): number | null => {
    const digits = raw.trim();
    if (!digits) return null;
    const n = parseInt(digits, 10);
    if (!Number.isFinite(n)) return null;
    return n;
  };

  const commitPaxInput = (): number | null => {
    const n = parsePaxInput(paxInput);
    if (n == null || n <= 0) {
      setPaxError('Jumlah pax harus lebih dari 0');
      return null;
    }
    setPaxError(null);
    setPaxInput(String(n));
    return n;
  };

  const commitJamInput = (): string | null => {
    const parsed = parseJamDotInput(jamInput);
    if (!parsed) {
      setJamError('Format jam tidak valid (contoh: 19.30)');
      return null;
    }
    setJamError(null);
    setJamInput(jamToDisplay(parsed));
    return parsed;
  };

  useEffect(() => {
    if (!isOpen) {
      setSelectedContact(null);
      setShowContactBook(false);
      setContactMode('search');
      setPendingPhone('');
      setPendingNama('');
      setRegNama('');
      setRegPhone('');
      setRegPhoneError(null);
      setPhoneConflictContact(null);
      setContactQueryError(null);
      setRegNamaConfirmed(false);
      setRegPhoneConfirmed(false);
      return;
    }
    if (reservation) {
      const resNama = reservation.nama ?? '';
      const resPhone = normalizePhoneForDb(reservation.phone ?? '');
      setNama(resNama);
      setPhone(resPhone);
      setContactQuery(formatContactQueryDisplay(resNama, resPhone));
      setTanggal(normalizeTanggal(reservation.tanggal));
      setJamInput(jamToDisplay(normalizeJam(reservation.jam)));
      setPaxInput(String(Number(reservation.pax) || 1));
      setPaxError(null);
      setJamError(null);
      setStatus((reservation.status as 'upcoming' | 'attended' | 'cancelled') || 'upcoming');
      setDp(Number(reservation.dp) || 0);
      setNote(reservation.note ?? '');
      setPenanggungJawabId(reservation.penanggung_jawab_id ?? null);
      const raw = reservation.table_ids_json;
      if (Array.isArray(raw)) setSelectedTableIds(raw);
      else if (typeof raw === 'string') {
        try {
          const arr = JSON.parse(raw);
          setSelectedTableIds(Array.isArray(arr) ? arr : []);
        } catch {
          setSelectedTableIds([]);
        }
      } else setSelectedTableIds([]);
    } else {
      setContactQuery('');
      setNama('');
      setPhone('');
      setTanggal(getTodayUTC7());
      setJamInput('18.00');
      setPaxInput('1');
      setPaxError(null);
      setJamError(null);
      setStatus('upcoming');
      setDp(0);
      setSelectedTableIds([]);
      setPenanggungJawabId(null);
      setNote('');
      setSelectedContact(null);
      setContactMode('search');
      setPendingPhone('');
      setPendingNama('');
      setRegNama('');
      setRegPhone('');
      setRegPhoneError(null);
      setPhoneConflictContact(null);
      setContactQueryError(null);
      setRegNamaConfirmed(false);
      setRegPhoneConfirmed(false);
    }
  }, [isOpen, reservation]);

  useEffect(() => {
    if (!isOpen || !reservation?.phone) return;
    const phoneForDb = normalizePhoneForDb(reservation.phone ?? '');
    if (!isValidIndonesianPhone(phoneForDb)) return;
    let cancelled = false;
    void resolveContactByPhone(phoneForDb, businessId).then((contact) => {
      if (!cancelled && contact) {
        setSelectedContact(contact);
        setNama(contact.nama);
        setPhone(normalizePhoneForDb(contact.phone_number ?? ''));
        setContactQuery(formatContactQueryDisplay(contact.nama, contact.phone_number ?? ''));
      }
    });
    return () => { cancelled = true; };
  }, [isOpen, reservation?.phone, reservation?.uuid_id, businessId]);

  useEffect(() => {
    if (!isOpen) return;
    if (employeesProp !== undefined) {
      setEmployees(Array.isArray(employeesProp) ? employeesProp : []);
      return;
    }
    let cancelled = false;
    (async () => {
      const api = window.electronAPI;
      if (api?.localDbGetEmployees) {
        try {
          const list = await api.localDbGetEmployees();
          if (!cancelled) {
            setEmployees(Array.isArray(list) ? list : []);
            return;
          }
        } catch {
          // fall through to VPS
        }
      }
      try {
        const api = window.electronAPI;
        if (api?.localDbGetEmployees) {
          const all = await api.localDbGetEmployees();
          const list = (Array.isArray(all) ? all : []).filter(
            (e) => Number((e as Record<string, unknown>).business_id) === businessId || (e as Record<string, unknown>).business_id == null
          );
          if (!cancelled) setEmployees(list);
          return;
        }
        await initApiUrlCache();
        const list = await fetchFromVps<Record<string, unknown>[]>(`/api/employees?business_id=${businessId}`);
        if (!cancelled) setEmployees(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setEmployees([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, businessId, employeesProp]);

  const closeSuggestions = useCallback(() => {
    setShowSuggestions(false);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const resetContactSearch = useCallback(() => {
    setContactMode('search');
    setContactQuery('');
    setPendingPhone('');
    setPendingNama('');
    setRegNama('');
    setRegPhone('');
    setRegPhoneError(null);
    setPhoneConflictContact(null);
    setSelectedContact(null);
    setNama('');
    setPhone('');
    setContactQueryError(null);
    setRegNamaConfirmed(false);
    setRegPhoneConfirmed(false);
    closeSuggestions();
  }, [closeSuggestions]);

  const applySelectedContact = useCallback((contact: ContactSuggestion) => {
    const phoneForDb = normalizePhoneForDb(contact.phone_number ?? '');
    setNama(contact.nama);
    setPhone(phoneForDb);
    setSelectedContact(contact);
    setContactQuery(formatContactQueryDisplay(contact.nama, phoneForDb));
    setContactMode('search');
    setPendingPhone('');
    setPendingNama('');
    setRegNama('');
    setRegPhone('');
    setRegPhoneError(null);
    setPhoneConflictContact(null);
    setContactQueryError(null);
    setRegNamaConfirmed(false);
    setRegPhoneConfirmed(false);
    closeSuggestions();
  }, [closeSuggestions]);

  const enterNeedNameMode = useCallback((phoneForDb: string) => {
    setContactMode('need_name');
    setPendingPhone(phoneForDb);
    setContactQuery(formatPhoneDisplay(phoneForDb));
    setRegNama('');
    setPendingNama('');
    setRegPhone('');
    setRegPhoneError(null);
    setPhoneConflictContact(null);
    setContactQueryError(null);
    setRegNamaConfirmed(false);
    setRegPhoneConfirmed(false);
    closeSuggestions();
  }, [closeSuggestions]);

  const enterNeedPhoneMode = useCallback((namaValue: string) => {
    setContactMode('need_phone');
    setPendingNama(namaValue);
    setContactQuery(namaValue);
    setRegPhone('');
    setRegPhoneError(null);
    setPhoneConflictContact(null);
    setPendingPhone('');
    setRegNama('');
    setRegNamaConfirmed(false);
    setRegPhoneConfirmed(false);
    closeSuggestions();
  }, [closeSuggestions]);

  const confirmContactQuery = useCallback(async () => {
    if (selectedContact || contactMode !== 'search') return;
    const trimmed = contactQuery.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setContactQueryError(`Ketik minimal ${MIN_QUERY_LENGTH} karakter lalu klik Simpan.`);
      return;
    }

    setContactQueryError(null);
    setIsConfirmingContact(true);
    closeSuggestions();
    try {
      if (isQueryPhoneLike(trimmed)) {
        const phoneForDb = normalizePhoneForDb(trimmed.replace(/\D/g, ''));
        const contact = await resolveContactByPhone(phoneForDb, businessId);
        if (contact) {
          applySelectedContact(contact);
          return;
        }
        enterNeedNameMode(phoneForDb);
        return;
      }

      if (isQueryNameLike(trimmed)) {
        const api = window.electronAPI;
        if (api?.localDbSearchContacts) {
          const rows = await api.localDbSearchContacts(trimmed, businessId);
          const list = Array.isArray(rows) ? (rows as ContactSuggestion[]) : [];
          const exact = list.find(
            (s) => s.nama.trim().toLowerCase() === trimmed.toLowerCase()
          );
          if (exact) {
            applySelectedContact(exact);
            return;
          }
          if (list.length > 0) {
            setContactSuggestions(list);
            setShowSuggestions(true);
            setContactQueryError('Pilih kontak dari daftar, atau ketik nama yang belum terdaftar.');
            return;
          }
        }
        enterNeedPhoneMode(trimmed);
        return;
      }

      setContactQueryError('Ketik nama (min. 2 huruf) atau no. HP yang valid, lalu klik Simpan.');
    } finally {
      setIsConfirmingContact(false);
    }
  }, [
    selectedContact,
    contactMode,
    contactQuery,
    businessId,
    closeSuggestions,
    applySelectedContact,
    enterNeedNameMode,
    enterNeedPhoneMode,
  ]);

  const runSearch = useCallback((query: string) => {
    const api = window.electronAPI;
    if (!api?.localDbSearchContacts || query.length < MIN_QUERY_LENGTH) {
      setContactSuggestions([]);
      setIsSearching(false);
      return;
    }
    if (contactMode !== 'search') return;
    setShowSuggestions(true);
    setIsSearching(true);
    api.localDbSearchContacts(query, businessId).then((rows: unknown) => {
      const list = Array.isArray(rows) ? (rows as ContactSuggestion[]) : [];
      setContactSuggestions(list);
      setIsSearching(false);
    }).catch(() => {
      setContactSuggestions([]);
      setIsSearching(false);
    });
  }, [businessId, contactMode]);

  const scheduleSearch = useCallback((value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < MIN_QUERY_LENGTH) {
      setShowSuggestions(false);
      setContactSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(value.trim()), DEBOUNCE_MS);
  }, [runSearch]);

  const validateRegPhone = useCallback(async (): Promise<boolean> => {
    const phoneForDb = normalizePhoneForDb(regPhone);
    if (!regPhone.trim()) {
      setRegPhoneError('No. HP wajib diisi.');
      setPhoneConflictContact(null);
      return false;
    }
    if (!isValidIndonesianPhone(phoneForDb)) {
      setRegPhoneError('No. HP tidak valid (contoh: 082234662863).');
      setPhoneConflictContact(null);
      return false;
    }
    const existing = await resolveContactByPhone(phoneForDb, businessId);
    if (existing) {
      setPhoneConflictContact(existing);
      setRegPhoneError(`No. HP sudah terdaftar atas nama "${existing.nama}".`);
      return false;
    }
    setRegPhoneError(null);
    setPhoneConflictContact(null);
    return true;
  }, [regPhone, businessId]);

  const confirmRegNama = useCallback(() => {
    if (regNama.trim().length < 2) return;
    setRegNamaConfirmed(true);
  }, [regNama]);

  const confirmRegPhone = useCallback(async () => {
    const ok = await validateRegPhone();
    if (ok) setRegPhoneConfirmed(true);
  }, [validateRegPhone]);

  const handleSelectSuggestion = useCallback((s: ContactSuggestion) => {
    applySelectedContact(s);
  }, [applySelectedContact]);

  const handleSelectContact = useCallback((contact: ContactSuggestion) => {
    applySelectedContact(contact);
    setShowContactBook(false);
  }, [applySelectedContact]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSuggestions();
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-autocomplete-area]')) closeSuggestions();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [isOpen, closeSuggestions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    let namaFinal: string;
    let phoneForDb: string;

    if (selectedContact) {
      namaFinal = selectedContact.nama.trim();
      phoneForDb = normalizePhoneForDb(selectedContact.phone_number ?? '');
    } else if (contactMode === 'need_name') {
      if (!regNamaConfirmed) {
        await appAlert('Klik Simpan pada nama pemesan untuk konfirmasi.');
        return;
      }
      if (regNama.trim().length < 2) {
        await appAlert('Nama wajib diisi (minimal 2 karakter).');
        return;
      }
      namaFinal = regNama.trim();
      phoneForDb = pendingPhone;
      if (!isValidIndonesianPhone(phoneForDb)) {
        await appAlert('No. HP tidak valid.');
        return;
      }
    } else if (contactMode === 'need_phone') {
      if (!regPhoneConfirmed) {
        await appAlert('Klik Simpan pada no. HP untuk konfirmasi.');
        return;
      }
      namaFinal = pendingNama.trim();
      if (namaFinal.length < 2) {
        await appAlert('Nama tidak valid.');
        return;
      }
      phoneForDb = normalizePhoneForDb(regPhone);
      if (!isValidIndonesianPhone(phoneForDb)) {
        await appAlert('No. HP wajib diisi dengan format yang benar (contoh: 082234662863).');
        return;
      }
      if (phoneConflictContact) {
        await appAlert(`No. HP sudah terdaftar atas nama "${phoneConflictContact.nama}". Gunakan kontak yang ada atau nomor lain.`);
        return;
      }
      const existing = await resolveContactByPhone(phoneForDb, businessId);
      if (existing) {
        await appAlert(`No. HP sudah terdaftar atas nama "${existing.nama}". Gunakan kontak yang ada atau nomor lain.`);
        return;
      }
    } else {
      if (contactQuery.trim() && !selectedContact) {
        await appAlert('Klik Simpan pada pencarian kontak untuk konfirmasi.');
        return;
      }
      const parsed = parseContactQuery(contactQuery, null);
      if ('error' in parsed) {
        await appAlert(parsed.error);
        return;
      }
      namaFinal = parsed.nama;
      phoneForDb = parsed.phone;
    }

    if (!tanggal) return;

    const jamNorm = commitJamInput();
    if (!jamNorm) return;

    const paxValue = commitPaxInput();
    if (paxValue == null) return;

    setSaving(true);
    try {
      const tableIdsJson = selectedTableIds.length > 0 ? selectedTableIds : null;
      const itemsForTotal = parseReservationItemsJson(reservation?.items_json ?? null);
      const computedTotal = isEdit ? computeTotalFromReservationItems(itemsForTotal) : 0;

      const payload = {
        uuid_id: isEdit && reservation?.uuid_id ? reservation.uuid_id : generateUUID(),
        business_id: businessId,
        nama: namaFinal,
        phone: phoneForDb,
        tanggal,
        jam: jamNorm,
        pax: paxValue,
        status,
        dp: Number(dp) || 0,
        total_price: isEdit ? computedTotal : 0,
        table_ids_json: tableIdsJson,
        items_json: isEdit && reservation?.items_json != null ? reservation.items_json : null,
        penanggung_jawab_id: penanggungJawabId,
        created_by_email: userEmail ?? null,
        note: note.trim() || null,
      };

      const localSaved = await saveReservationToLocalMySQL(payload, isEdit);
      if (!localSaved.success) {
        throw new Error(localSaved.error || 'Gagal menyimpan reservasi.');
      }

      void syncReservationsToVpsInBackground(businessId);

      if (onLogActivity) {
        const snapshot = reservationRowSnapshot({
          uuid_id: payload.uuid_id,
          nama: payload.nama,
          phone: payload.phone,
          tanggal: payload.tanggal,
          jam: payload.jam,
          pax: payload.pax,
          status: payload.status,
          dp: payload.dp,
          total_price: payload.total_price,
          table_ids_json: payload.table_ids_json,
          penanggung_jawab_id: payload.penanggung_jawab_id,
          note: payload.note,
          created_by_email: payload.created_by_email,
        });
        await onLogActivity(isEdit ? 'reservation_update' : 'reservation_create', {
          ...snapshot,
          change_type: isEdit ? 'form_edit' : 'create',
          ...(isEdit && reservation
            ? { previous: reservationRowSnapshot(reservation) }
            : {}),
        });
      }
      const api = window.electronAPI;
      if (api?.localDbSaveContactForBusiness) {
        const contactResult = await api.localDbSaveContactForBusiness({
          nama: namaFinal,
          phone_number: phoneForDb,
          business_id: businessId,
          created_by_email: userEmail ?? null,
          tryVpsNow: true,
        });
        if (!contactResult?.success) {
          console.warn('[ReservationFormModal] contact upsert failed:', contactResult?.error);
        }
      } else if (userEmail && api?.vpsCreateContact) {
        api.vpsCreateContact({ nama: namaFinal, phone_number: phoneForDb, created_by_email: userEmail, business_id: businessId })
          .catch((err: unknown) => {
            console.warn('[ReservationFormModal] VPS contact insert failed (fire-and-forget):', err);
          });
      }
      onSaved({
        tanggal,
        saved: {
          uuid_id: payload.uuid_id,
          business_id: payload.business_id,
          nama: payload.nama,
          phone: payload.phone,
          tanggal: payload.tanggal,
          jam: payload.jam,
          pax: payload.pax,
          status: payload.status,
          dp: payload.dp,
          total_price: payload.total_price,
          table_ids_json: payload.table_ids_json,
          items_json: payload.items_json,
          penanggung_jawab_id: payload.penanggung_jawab_id,
          created_by_email: payload.created_by_email,
          note: payload.note,
        },
      });
      onClose();
    } catch (err) {
      await appAlert(err instanceof Error ? err.message : 'Gagal menyimpan reservasi.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const renderSuggestionsDropdown = () => {
    if (!showSuggestions || contactMode !== 'search' || contactSuggestions.length === 0) return null;
    return (
      <div className="absolute top-full left-0 right-0 z-[100] mt-0.5 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
        {isSearching ? (
          <div className="px-3 py-2.5 flex items-center gap-2 text-slate-500 text-sm">
            <span className="inline-block w-3.5 h-3.5 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin flex-shrink-0" />
            Mencari kontak...
          </div>
        ) : (
          contactSuggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelectSuggestion(s);
              }}
              className="w-full text-left px-3 py-2 border-b border-slate-100 last:border-b-0 hover:bg-sky-50 flex flex-col gap-0.5"
            >
              <span className="font-semibold text-slate-800 text-sm">{s.nama}</span>
              <span className="text-slate-500 text-xs">{formatPhoneDisplay(s.phone_number ?? '')}</span>
            </button>
          ))
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) backdropMouseDownRef.current = true;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropMouseDownRef.current) onClose();
        backdropMouseDownRef.current = false;
      }}
    >
      <div
        ref={modalContentRef}
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onMouseDown={() => { backdropMouseDownRef.current = false; }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-800">
            {isEdit ? 'Edit Reservasi' : 'Tambah Reservasi'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-700 rounded"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4 grid grid-cols-2 gap-3">
            <div className="col-span-2 flex flex-col gap-2 relative" data-autocomplete-area="contact">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {contactMode === 'need_name' ? 'No. HP' : contactMode === 'need_phone' ? 'Nama' : 'Cari kontak (nama atau no. HP)'}
              </label>
              <div className="relative" data-contact-book-root>
                <div
                  className={`flex items-stretch rounded-lg border overflow-hidden bg-white ${
                    contactMode !== 'search'
                      ? 'border-slate-200 bg-slate-50'
                      : contactQueryError
                        ? 'border-red-400'
                        : 'border-slate-300 focus-within:ring-2 focus-within:ring-amber-200 focus-within:border-amber-400'
                  }`}
                >
                  <input
                    type="text"
                    value={contactQuery}
                    readOnly={contactMode !== 'search'}
                    onChange={(e) => {
                      if (contactMode !== 'search') return;
                      setContactQuery(e.target.value);
                      setSelectedContact(null);
                      setNama('');
                      setPhone('');
                      setContactMode('search');
                      setPendingPhone('');
                      setPendingNama('');
                      setRegNama('');
                      setRegPhone('');
                      setRegPhoneError(null);
                      setPhoneConflictContact(null);
                      setContactQueryError(null);
                      scheduleSearch(e.target.value);
                    }}
                    onFocus={() => {
                      if (contactMode !== 'search') return;
                      const q = contactQuery.trim();
                      if (q.length >= MIN_QUERY_LENGTH) runSearch(q);
                    }}
                    placeholder="Ketik nama atau no. HP..."
                    className={`flex-1 min-w-0 border-0 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-0 ${
                      contactMode !== 'search'
                        ? 'text-slate-700 cursor-default'
                        : 'text-slate-900 placeholder:text-slate-500'
                    }`}
                    required={contactMode === 'search'}
                    autoComplete="off"
                  />
                  {(contactQuery.trim().length > 0 || selectedContact != null || contactMode !== 'search') && (
                    <button
                      type="button"
                      onClick={resetContactSearch}
                      className="flex-shrink-0 px-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                      title="Hapus"
                      aria-label="Hapus pencarian kontak"
                    >
                      ✕
                    </button>
                  )}
                  {contactMode === 'search' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowContactBook((prev) => !prev);
                      }}
                      className={`flex-shrink-0 px-2.5 border-l border-slate-200 transition-colors ${
                        showContactBook || selectedContact != null
                          ? 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                      }`}
                      title={selectedContact != null ? 'Member terpilih — klik untuk ubah' : 'Buku kontak'}
                    >
                      <span className="text-xs font-medium">👥</span>
                    </button>
                  )}
                  {contactMode === 'search' && !selectedContact && (
                    <button
                      type="button"
                      onClick={() => { void confirmContactQuery(); }}
                      disabled={isConfirmingContact || contactQuery.trim().length < MIN_QUERY_LENGTH}
                      className="flex-shrink-0 px-4 py-2 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 border-l border-amber-600 disabled:border-slate-300 transition-colors"
                    >
                      {isConfirmingContact ? '...' : 'Simpan'}
                    </button>
                  )}
                </div>
                <ContactBookPopover
                  isOpen={showContactBook}
                  onClose={() => setShowContactBook(false)}
                  onSelect={handleSelectContact}
                  initialQuery={contactQuery}
                  businessId={businessId}
                  userEmail={userEmail}
                />
              </div>
              {renderSuggestionsDropdown()}

              {contactMode === 'need_name' && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-900">Kontak baru — lengkapi nama pemesan</p>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-amber-900">Nama</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={regNama}
                        onChange={(e) => {
                          setRegNama(e.target.value);
                          setRegNamaConfirmed(false);
                        }}
                        placeholder="Nama pemesan"
                        className={`flex-1 border rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-500 ${
                          regNamaConfirmed ? 'border-green-500' : 'border-amber-400'
                        }`}
                        autoComplete="off"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={confirmRegNama}
                        disabled={regNama.trim().length < 2 || regNamaConfirmed}
                        className="flex-shrink-0 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-green-100 disabled:text-green-800 text-white text-sm font-semibold transition-colors"
                      >
                        {regNamaConfirmed ? '✓' : 'Simpan'}
                      </button>
                    </div>
                    {regNamaConfirmed && (
                      <p className="text-xs text-green-700">Nama dikonfirmasi.</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={resetContactSearch}
                    className="text-xs text-amber-800 underline hover:text-amber-950"
                  >
                    Ubah no. HP
                  </button>
                </div>
              )}

              {contactMode === 'need_phone' && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-900">Kontak baru — lengkapi no. HP</p>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-amber-900">No. HP (WhatsApp)</label>
                    <div className="flex gap-2">
                      <input
                        type="tel"
                        value={formatPhoneDisplay(regPhone)}
                        onChange={(e) => {
                          setRegPhone(normalizePhoneForDb(e.target.value));
                          setRegPhoneError(null);
                          setPhoneConflictContact(null);
                          setRegPhoneConfirmed(false);
                        }}
                        placeholder="0822-3466-2863"
                        className={`flex-1 border rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-500 ${
                          regPhoneError ? 'border-red-400' : regPhoneConfirmed ? 'border-green-500' : 'border-amber-400'
                        }`}
                        autoComplete="off"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => { void confirmRegPhone(); }}
                        disabled={!regPhone.trim() || regPhoneConfirmed}
                        className="flex-shrink-0 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-green-100 disabled:text-green-800 text-white text-sm font-semibold transition-colors"
                      >
                        {regPhoneConfirmed ? '✓' : 'Simpan'}
                      </button>
                    </div>
                    {regPhoneError && (
                      <p className="text-xs text-red-600">{regPhoneError}</p>
                    )}
                    {regPhoneConfirmed && !regPhoneError && (
                      <p className="text-xs text-green-700">No. HP dikonfirmasi.</p>
                    )}
                    {phoneConflictContact && (
                      <button
                        type="button"
                        onClick={() => applySelectedContact(phoneConflictContact)}
                        className="text-left text-xs font-semibold text-purple-700 underline hover:text-purple-900"
                      >
                        Gunakan kontak &quot;{phoneConflictContact.nama}&quot;
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={resetContactSearch}
                    className="text-xs text-amber-800 underline hover:text-amber-950"
                  >
                    Ubah nama
                  </button>
                </div>
              )}

              {contactMode === 'search' && (
                contactQueryError ? (
                  <p className="text-[11px] text-red-600">{contactQueryError}</p>
                ) : isConfirmingContact ? (
                  <span className="text-[11px] text-slate-400">Memeriksa kontak...</span>
                ) : selectedContact ? (
                  <span className="text-[11px] text-purple-700 font-medium">
                    Member terdaftar · kontak akan dipakai untuk reservasi ini
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400">
                    Ketik nama atau no. HP, lalu klik Simpan untuk konfirmasi.
                  </span>
                )
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Tanggal</label>
              <input
                type="date"
                value={tanggal}
                onChange={(e) => setTanggal(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-500"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Jam</label>
              <input
                type="text"
                inputMode="numeric"
                value={jamInput}
                onChange={(e) => {
                  setJamInput(sanitizeJamDotTyping(e.target.value));
                  setJamError(null);
                }}
                onBlur={commitJamInput}
                placeholder="19.30"
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-500"
                required
              />
              {jamError && <p className="text-xs text-red-600">{jamError}</p>}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pax</label>
              <input
                type="text"
                inputMode="numeric"
                value={paxInput}
                onChange={(e) => {
                  setPaxInput(e.target.value.replace(/\D/g, ''));
                  setPaxError(null);
                }}
                onBlur={commitPaxInput}
                placeholder="Jumlah tamu"
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-500"
                required
              />
              {paxError && <p className="text-xs text-red-600">{paxError}</p>}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'upcoming' | 'attended' | 'cancelled')}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900"
              >
                <option value="upcoming">{RESERVATION_STATUS_LABELS.upcoming}</option>
                <option value="attended">{RESERVATION_STATUS_LABELS.attended}</option>
                <option value="cancelled">{RESERVATION_STATUS_LABELS.cancelled}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Penanggung Jawab</label>
              <select
                value={penanggungJawabId ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setPenanggungJawabId(v ? Number(v) : null);
                }}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900"
              >
                <option value="">— Pilih —</option>
                {employees.map((emp) => {
                  const id = Number(emp.id);
                  const name = (emp.nama_karyawan ?? emp.name ?? '') as string;
                  return (
                    <option key={id} value={id}>
                      {name || `ID ${id}`}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">DP (Down Payment)</label>
              <input
                type="text"
                inputMode="numeric"
                value={formatNumberForInput(dp)}
                onChange={(e) => setDp(parseNumberInput(e.target.value))}
                placeholder="0"
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-500"
              />
            </div>

            {onPickProductsFromKasir && !isEdit && (
              <div className="col-span-2 border-2 border-violet-300 rounded-lg p-3 bg-violet-50 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-violet-900">Menu / Pre-Order</div>
                  <div className="text-xs text-violet-800 mt-0.5">
                    {(() => {
                      const raw = reservation?.items_json;
                      const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw?.trim() ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : []);
                      const count = Array.isArray(arr) ? arr.length : 0;
                      return count > 0 ? `${count} produk tersimpan` : 'Belum ada menu dipilih';
                    })()}
                  </div>
                  <p className="text-[11px] text-amber-800 mt-1">Simpan reservasi dulu, lalu pilih menu dari sini atau dari kartu.</p>
                </div>
                <span className="text-xs text-slate-500 italic">Tersedia setelah simpan</span>
              </div>
            )}

            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Catatan (Note)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Catatan tambahan..."
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm min-h-[60px] resize-y bg-white text-slate-900 placeholder:text-slate-500"
                rows={3}
              />
            </div>

            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Meja</label>
              <ReservationTablePicker
                businessId={businessId}
                selectedTableIds={selectedTableIds}
                onChange={setSelectedTableIds}
              />
            </div>

            <div className="col-span-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
              💡 Jika nomor HP tidak ditemukan di kontak, kontak baru akan otomatis dibuat saat klik <strong>Simpan</strong>.
            </div>
          </div>
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 font-medium"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
