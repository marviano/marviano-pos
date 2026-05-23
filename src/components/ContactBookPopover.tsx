'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  combinePhoneParts,
  formatPhoneDisplay,
  isValidIndonesianPhone,
  normalizePhoneForDb,
} from '@/lib/formatUtils';
import { appAlert, appConfirm } from '@/components/AppDialog';

export type ContactSuggestion = { id: number; nama: string; phone_number: string };

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

type ContactBookPopoverProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (contact: ContactSuggestion) => void;
  initialQuery?: string;
  businessId?: number;
  userEmail?: string | null;
};

type Tab = 'search' | 'add';

export default function ContactBookPopover({
  isOpen,
  onClose,
  onSelect,
  initialQuery = '',
  businessId,
  userEmail,
}: ContactBookPopoverProps) {
  const [tab, setTab] = useState<Tab>('search');
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addNama, setAddNama] = useState('');
  const [phoneCountry, setPhoneCountry] = useState('62');
  const [phoneNational, setPhoneNational] = useState('');
  const [editingPhoneCountry, setEditingPhoneCountry] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const runSearch = useCallback((value: string) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    const trimmed = value.trim();
    if (!api?.localDbSearchContacts || trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }
    if (businessId == null || businessId <= 0) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    api
      .localDbSearchContacts(trimmed, businessId)
      .then((rows: unknown) => {
        setSuggestions(Array.isArray(rows) ? (rows as ContactSuggestion[]) : []);
        setIsSearching(false);
      })
      .catch(() => {
        setSuggestions([]);
        setIsSearching(false);
      });
  }, [businessId]);

  useEffect(() => {
    if (!isOpen) return;
    setTab('search');
    setQuery(initialQuery);
    setAddNama(initialQuery.trim());
    setPhoneCountry('62');
    setPhoneNational('');
    setEditingPhoneCountry(false);
    if (initialQuery.trim().length >= MIN_QUERY_LENGTH && businessId) {
      runSearch(initialQuery.trim());
    } else {
      setSuggestions([]);
    }
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [isOpen, initialQuery, runSearch, businessId]);

  useEffect(() => {
    if (!isOpen || tab !== 'search') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(trimmed), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, isOpen, tab, runSearch]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const handleSaveNew = async () => {
    const api = window.electronAPI;
    if (!api?.localDbSaveContactForBusiness) {
      await appAlert('Fitur kontak tidak tersedia di lingkungan ini.');
      return;
    }
    if (businessId == null || businessId <= 0) {
      await appAlert('Pilih bisnis terlebih dahulu.');
      return;
    }
    const nama = addNama.trim();
    const phone = combinePhoneParts(phoneCountry, phoneNational);
    if (nama.length < 2) {
      await appAlert('Nama minimal 2 karakter.');
      return;
    }
    if (!isValidIndonesianPhone(phone)) {
      await appAlert('Nomor harus format Indonesia (contoh: 62 82234662863).');
      return;
    }

    const existing = await api.localDbFindContactByPhone?.(phone);
    if (existing?.id) {
      const displayPhone = formatPhoneDisplay(existing.phone_number ?? phone);
      const useExisting = await appConfirm(
        `Nomor ${displayPhone} sudah terdaftar atas nama "${existing.nama}".\n\nGunakan kontak yang sudah ada?`
      );
      if (!useExisting) return;
      setSaving(true);
      try {
        const linkResult = await api.localDbSaveContactForBusiness({
          nama,
          phone_number: normalizePhoneForDb(existing.phone_number ?? phone),
          business_id: businessId,
          created_by_email: userEmail ?? null,
          tryVpsNow: true,
        });
        if (!linkResult?.success) {
          await appAlert(linkResult?.error ?? 'Gagal menghubungkan kontak ke outlet.');
          return;
        }
        onSelect({
          id: Number(linkResult.id ?? existing.id),
          nama: String(linkResult.nama ?? nama),
          phone_number: String(linkResult.phone_number ?? phone),
        });
        onClose();
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      const result = await api.localDbSaveContactForBusiness({
        nama,
        phone_number: phone,
        business_id: businessId,
        created_by_email: userEmail ?? null,
        tryVpsNow: true,
      });
      if (!result?.success) {
        const err = result?.error ?? 'unknown';
        if (err === 'invalid_phone') {
          await appAlert('Nomor harus format Indonesia (62…).');
        } else if (err === 'nama_min_length') {
          await appAlert('Nama minimal 2 karakter.');
        } else {
          await appAlert(`Gagal menyimpan kontak: ${err}`);
        }
        return;
      }
      const contact: ContactSuggestion = {
        id: Number(result.id),
        nama: String(result.nama ?? nama),
        phone_number: String(result.phone_number ?? phone),
      };
      onSelect(contact);
      onClose();
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : 'Gagal menyimpan kontak.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  if (businessId == null || businessId <= 0) {
    return (
      <div className="absolute top-full left-0 right-0 z-[200] mt-1 bg-white border border-amber-200 rounded-lg shadow-xl p-3 text-xs text-amber-800">
        Pilih bisnis untuk melihat kontak outlet ini.
      </div>
    );
  }

  return (
    <div className="absolute top-full left-0 right-0 z-[200] mt-1 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden w-[min(100%,320px)]">
      <div className="flex border-b border-gray-100">
        <button
          type="button"
          onClick={() => setTab('search')}
          className={`flex-1 py-2 text-xs font-semibold ${tab === 'search' ? 'text-purple-700 border-b-2 border-purple-500' : 'text-gray-500'}`}
        >
          Cari
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('add');
            setAddNama(query.trim() || addNama);
          }}
          className={`flex-1 py-2 text-xs font-semibold ${tab === 'add' ? 'text-purple-700 border-b-2 border-purple-500' : 'text-gray-500'}`}
        >
          Tambah baru
        </button>
      </div>

      {tab === 'search' ? (
        <>
          <div className="p-2 border-b border-gray-100">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama atau telepon..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-purple-400 placeholder:text-gray-400/50"
              autoComplete="off"
            />
            <p className="mt-1 text-[10px] text-gray-400 px-1">
              Hanya kontak terdaftar di outlet ini (min. 2 karakter).
            </p>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {isSearching ? (
              <div className="px-3 py-2.5 flex items-center gap-2 text-sm text-gray-500">
                <span className="inline-block w-3.5 h-3.5 border-2 border-gray-200 border-t-purple-500 rounded-full animate-spin flex-shrink-0" />
                Mencari...
              </div>
            ) : query.trim().length < MIN_QUERY_LENGTH ? (
              <div className="px-3 py-2.5 text-sm text-gray-400">Ketik untuk mencari</div>
            ) : suggestions.length === 0 ? (
              <div className="px-3 py-2.5 text-sm text-gray-500">
                Tidak ada kontak di outlet ini.{' '}
                <button type="button" className="text-purple-600 font-medium underline" onClick={() => setTab('add')}>
                  Tambah baru
                </button>
              </div>
            ) : (
              suggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelect(s)}
                  className="w-full text-left px-3 py-2.5 border-b border-gray-50 last:border-b-0 hover:bg-purple-50"
                >
                  <span className="block font-semibold text-gray-800 text-sm">{s.nama}</span>
                  <span className="block text-gray-500 text-xs mt-0.5">
                    {formatPhoneDisplay(s.phone_number ?? '')}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      ) : (
        <div className="p-3 space-y-2">
          <p className="text-[10px] text-gray-500 leading-snug">
            Nomor yang sudah ada di Salespulse akan dihubungkan ke outlet ini. Nama bisa berbeda per outlet.
          </p>
          <input
            type="text"
            value={addNama}
            onChange={(e) => setAddNama(e.target.value)}
            placeholder="Nama pelanggan"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg placeholder:text-gray-400/50"
            autoComplete="off"
          />
          <div className="flex gap-1.5 items-stretch">
            {editingPhoneCountry ? (
              <input
                type="tel"
                value={phoneCountry}
                onChange={(e) => setPhoneCountry(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onBlur={() => setEditingPhoneCountry(false)}
                className="w-14 px-2 py-2 text-sm border border-purple-300 rounded-lg text-center font-semibold"
                autoComplete="off"
                aria-label="Kode negara"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingPhoneCountry(true)}
                className="shrink-0 px-2.5 py-2 text-sm font-semibold border border-gray-200 rounded-lg bg-gray-50 hover:bg-purple-50 text-gray-800"
                title="Klik untuk ubah kode negara"
              >
                +{phoneCountry || '62'}
              </button>
            )}
            <input
              type="tel"
              value={phoneNational}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '');
                setPhoneNational(digits);
              }}
              placeholder="82234662863 atau 082234662863"
              className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 rounded-lg placeholder:text-gray-400/50"
              autoComplete="off"
            />
          </div>
          <p className="text-[10px] text-gray-400">
            Disimpan sebagai 62… (tanpa 0 di depan). Kode +62 bisa diubah dengan mengetuk +62.
          </p>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSaveNew()}
            className="w-full py-2 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Simpan & pilih'}
          </button>
        </div>
      )}
    </div>
  );
}
