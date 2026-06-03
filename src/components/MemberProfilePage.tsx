'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Gift, Loader2, MessageCircle, Search, ShoppingBag, User } from 'lucide-react';
import { formatPhoneDisplay, formatRupiah } from '@/lib/formatUtils';

type MemberSortBy = 'nama' | 'last_transaction' | 'points';

type MemberListItem = {
  id: number;
  nama: string;
  phone_number: string | null;
  points_balance: number;
  last_transaction_at: string | null;
};

type MemberProfileData = NonNullable<
  Awaited<
    ReturnType<
      NonNullable<NonNullable<Window['electronAPI']>['localDbGetMemberProfile']>
    >
  >['profile']
>;

interface MemberProfilePageProps {
  businessId: number;
  initialContactId?: number | null;
}

const DEBOUNCE_MS = 300;

function normalizePhoneForWa(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (!digits.startsWith('62')) return '62' + digits;
  return digits;
}

function formatLastTransactionShort(raw: string | null): string {
  if (!raw) return 'Belum ada';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function openWhatsApp(phone: string) {
  const url = `https://wa.me/${normalizePhoneForWa(phone)}`;
  if (window.electronAPI?.openExternal) {
    void window.electronAPI.openExternal(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function formatDateTime(raw: unknown): string {
  if (raw == null) return '—';
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateOnly(raw: unknown): string {
  if (raw == null) return '';
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

function displayContactName(contact: Record<string, unknown>): string {
  const display = contact.display_nama;
  if (typeof display === 'string' && display.trim()) return display.trim();
  const nama = contact.nama;
  return typeof nama === 'string' ? nama : '—';
}

export default function MemberProfilePage({ businessId, initialContactId }: MemberProfilePageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<MemberSortBy>('nama');
  const [members, setMembers] = useState<MemberListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(initialContactId ?? null);
  const [profile, setProfile] = useState<MemberProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadMembers = useCallback(
    async (query?: string, sort?: MemberSortBy) => {
      const api = window.electronAPI;
      if (!api?.localDbListContactsForBusiness || businessId <= 0) {
        setMembers([]);
        setListLoading(false);
        return;
      }
      setListLoading(true);
      try {
        const res = await api.localDbListContactsForBusiness(businessId, query, sort ?? sortBy);
        setMembers(res?.success && Array.isArray(res.members) ? res.members : []);
      } catch {
        setMembers([]);
      } finally {
        setListLoading(false);
      }
    },
    [businessId, sortBy]
  );

  const loadProfile = useCallback(
    async (contactId: number) => {
      const api = window.electronAPI;
      if (!api?.localDbGetMemberProfile) {
        setProfileError('Fitur profil member tidak tersedia.');
        return;
      }
      setProfileLoading(true);
      setProfileError(null);
      try {
        const res = await api.localDbGetMemberProfile(contactId, businessId);
        if (res?.success && res.profile) {
          setProfile(res.profile);
        } else {
          setProfile(null);
          setProfileError(res?.error === 'not_found' ? 'Member tidak ditemukan.' : 'Gagal memuat profil.');
        }
      } catch {
        setProfile(null);
        setProfileError('Gagal memuat profil member.');
      } finally {
        setProfileLoading(false);
      }
    },
    [businessId]
  );

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (initialContactId != null && initialContactId > 0) {
      setSelectedId(initialContactId);
    }
  }, [initialContactId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void loadMembers(searchQuery.trim() || undefined, sortBy);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, sortBy, loadMembers]);

  useEffect(() => {
    if (selectedId == null || selectedId <= 0) {
      setProfile(null);
      setProfileError(null);
      return;
    }
    void loadProfile(selectedId);
  }, [selectedId, loadProfile]);

  const favoritesGrouped = useMemo(() => {
    if (!profile?.favorites_by_category?.length) return [];
    const map = new Map<string, MemberProfileData['favorites_by_category']>();
    for (const row of profile.favorites_by_category) {
      const key = row.category1_name || 'Tanpa Kategori';
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'id'));
  }, [profile?.favorites_by_category]);

  const contact = profile?.contact ?? null;

  return (
    <div className="flex-1 flex min-h-0 bg-gray-50">
      {/* Member list panel */}
      <div className="w-96 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col min-h-0">
        <div className="p-4 border-b border-gray-100 space-y-3">
          <h1 className="text-lg font-bold text-gray-900">Member</h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama atau nomor HP..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
            />
          </div>
          <div>
            <label htmlFor="member-sort" className="block text-xs font-medium text-gray-500 mb-1">
              Urutkan
            </label>
            <select
              id="member-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as MemberSortBy)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
            >
              <option value="nama">Nama (A–Z)</option>
              <option value="last_transaction">Transaksi terakhir</option>
              <option value="points">Poin terbanyak</option>
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-hide p-2 space-y-2">
          {listLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Memuat...</span>
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-12 px-4">
              {searchQuery.trim().length >= 2 ? 'Tidak ada member ditemukan.' : 'Belum ada member terdaftar di outlet ini.'}
            </p>
          ) : (
            members.map((m) => {
              const active = selectedId === m.id;
              const hasPhone = !!m.phone_number?.trim();
              return (
                <div
                  key={m.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(m.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(m.id);
                    }
                  }}
                  className={`relative rounded-lg border transition-colors cursor-pointer ${
                    active
                      ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200'
                      : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <span className="absolute top-2 left-2 text-[10px] font-mono text-gray-400 leading-none">
                    #{m.id}
                  </span>
                  {hasPhone ? (
                    <button
                      type="button"
                      title="Buka WhatsApp"
                      onClick={(e) => {
                        e.stopPropagation();
                        openWhatsApp(m.phone_number!);
                      }}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-green-500 hover:bg-green-600 text-white transition-colors z-10"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </button>
                  ) : null}
                  <div className="pt-6 pb-3 px-3 pr-12">
                    <p className="font-medium text-gray-900 text-sm truncate">{m.nama}</p>
                    {hasPhone ? (
                      <p className="text-xs text-gray-500 mt-0.5">{formatPhoneDisplay(m.phone_number!)}</p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-0.5 italic">Tanpa nomor HP</p>
                    )}
                    <div className="mt-2 flex flex-col gap-0.5 text-xs text-gray-600">
                      <span className="flex items-center gap-1">
                        <Gift className="w-3 h-3 text-amber-600" />
                        <span className="font-medium text-amber-800 tabular-nums">
                          {m.points_balance.toLocaleString('id-ID')} poin
                        </span>
                      </span>
                      <span className="text-gray-500">
                        Terakhir: {formatLastTransactionShort(m.last_transaction_at)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Profile detail panel */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {selectedId == null ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 px-6">
            <User className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm">Pilih member dari daftar untuk melihat profil.</p>
          </div>
        ) : profileLoading ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            <span>Memuat profil...</span>
          </div>
        ) : profileError ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 px-6">
            <p>{profileError}</p>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="mt-4 text-sm text-blue-600 hover:underline flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" />
              Kembali
            </button>
          </div>
        ) : profile && contact ? (
          <div className="max-w-4xl mx-auto p-6 space-y-6">
            {/* Header card */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <User className="w-7 h-7 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold text-gray-900">{displayContactName(contact)}</h2>
                  {typeof contact.phone_number === 'string' && contact.phone_number ? (
                    <p className="text-gray-600 mt-1">{formatPhoneDisplay(contact.phone_number)}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-500">
                    {contact.tgl_lahir ? (
                      <span>Lahir: {formatDateOnly(contact.tgl_lahir)}</span>
                    ) : null}
                    {typeof contact.jenis_kelamin === 'string' && contact.jenis_kelamin ? (
                      <span>{contact.jenis_kelamin}</span>
                    ) : null}
                    {typeof contact.kota === 'string' && contact.kota ? <span>{contact.kota}</span> : null}
                    {typeof contact.kecamatan === 'string' && contact.kecamatan ? (
                      <span>{contact.kecamatan}</span>
                    ) : null}
                  </div>
                  {typeof contact.alamat === 'string' && contact.alamat.trim() ? (
                    <p className="text-sm text-gray-500 mt-2">{contact.alamat}</p>
                  ) : null}
                  {contact.created_at ? (
                    <p className="text-xs text-gray-400 mt-2">Terdaftar: {formatDateTime(contact.created_at)}</p>
                  ) : null}
                </div>
                {profile.loyalty.is_enabled ? (
                  <div className="text-right flex-shrink-0 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                    <div className="flex items-center justify-end gap-1 text-amber-700 mb-1">
                      <Gift className="w-4 h-4" />
                      <span className="text-xs font-medium uppercase tracking-wide">Poin</span>
                    </div>
                    <p className="text-2xl font-bold text-amber-800">
                      {profile.loyalty.points_balance.toLocaleString('id-ID')}
                    </p>
                    <p className="text-xs text-amber-600 mt-0.5">
                      Total pernah dapat: {profile.loyalty.lifetime_earned.toLocaleString('id-ID')}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Favorites by Category I */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <ShoppingBag className="w-5 h-5 text-gray-600" />
                <h3 className="text-base font-semibold text-gray-900">Favorit per Kategori I</h3>
              </div>
              {favoritesGrouped.length === 0 ? (
                <p className="text-sm text-gray-500">Belum ada riwayat pembelian dengan member terpilih.</p>
              ) : (
                <div className="space-y-5">
                  {favoritesGrouped.map(([catName, items]) => (
                    <div key={catName}>
                      <h4 className="text-sm font-semibold text-blue-800 mb-2">{catName}</h4>
                      <ol className="space-y-1.5">
                        {items.map((item) => (
                          <li
                            key={`${item.category1_id}-${item.product_id}`}
                            className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-gray-50"
                          >
                            <span className="text-gray-800">
                              <span className="text-gray-400 mr-2">{item.rank_in_category}.</span>
                              {item.product_name}
                            </span>
                            <span className="text-gray-500 tabular-nums">
                              {Number(item.total_qty)}× · {formatRupiah(Number(item.total_revenue))}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Transaction history */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <h3 className="text-base font-semibold text-gray-900 mb-1">Riwayat Transaksi</h3>
              <p className="text-xs text-gray-500 mb-4">{profile.transaction_count} transaksi selesai</p>
              {profile.transactions.length === 0 ? (
                <p className="text-sm text-gray-500">Belum ada transaksi.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-gray-500">
                        <th className="pb-2 pr-4 font-medium">Waktu</th>
                        <th className="pb-2 pr-4 font-medium">No. Struk</th>
                        <th className="pb-2 pr-4 font-medium">Metode</th>
                        <th className="pb-2 font-medium text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.transactions.map((tx) => {
                        const uuid = String(tx.uuid_id ?? '');
                        return (
                          <tr key={uuid || String(tx.created_at)} className="border-b border-gray-50">
                            <td className="py-2.5 pr-4 text-gray-700 whitespace-nowrap">
                              {formatDateTime(tx.created_at)}
                            </td>
                            <td className="py-2.5 pr-4 text-gray-600 font-mono text-xs">
                              {tx.receipt_number != null ? String(tx.receipt_number) : '—'}
                            </td>
                            <td className="py-2.5 pr-4 text-gray-600 capitalize">
                              {tx.payment_method != null ? String(tx.payment_method) : '—'}
                            </td>
                            <td className="py-2.5 text-right font-medium text-gray-900 tabular-nums">
                              {formatRupiah(Number(tx.final_amount ?? tx.total_amount ?? 0))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Point ledger */}
            {profile.loyalty.is_enabled && profile.point_ledger.length > 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <h3 className="text-base font-semibold text-gray-900 mb-4">Riwayat Poin</h3>
                <div className="space-y-2">
                  {profile.point_ledger.map((entry) => {
                    const delta = Number(entry.points_delta ?? 0);
                    return (
                      <div
                        key={String(entry.uuid_id)}
                        className="flex items-center justify-between text-sm py-2 px-3 rounded-lg bg-gray-50"
                      >
                        <div>
                          <span className="text-gray-800 capitalize">{String(entry.entry_type ?? 'earn')}</span>
                          <span className="text-gray-400 mx-2">·</span>
                          <span className="text-gray-500">{formatDateTime(entry.created_at)}</span>
                        </div>
                        <span className={`font-semibold tabular-nums ${delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {delta >= 0 ? '+' : ''}
                          {delta.toLocaleString('id-ID')} poin
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
