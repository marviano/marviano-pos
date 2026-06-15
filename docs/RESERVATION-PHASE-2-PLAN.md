# Reservasi — Rencana Fase 2 (Hari-H, Pelunasan, DP)

**Status:** Phase 2A + offline-first + **Phase 2B/C implemented** (2026-06-15).  
**Last updated:** 2026-06-15  
**Repo utama:** `marviano-pos`  
**Repo sync:** `salespulse` (API `/api/reservations`, `/api/refund_exc` jika ada)

Dokumen ini untuk handoff ke Claude Code / developer. Berdasarkan diskusi produk + audit kode existing.

---

## 1. Konteks: apa yang sudah ada hari ini

### 1.1 UI Reservasi (sudah diubah ke card)

- File: `src/components/ReservationPage.tsx`
- Layout: grid kartu (bukan tabel), warna kartu per status (`upcoming` biru, `attended` hijau, `cancelled` merah, arsip abu)
- Tombol aksi per kartu (hari-H aware):
  - **Sebelum hari-H** (`isReservationFuture`): **Pilih / Ubah menu reservasi** → `onPickProductsFromKasir`
  - **Hari-H atau terlambat** (`canSendReservationToKasir`): **Pindahkan menu ke Simpan Order Kasir** → `onSendToKasir`
  - Baris 2–3: **Refund Exc. + Edit** | **Hapus**

### 1.1b Offline-first (implemented)

- **Baca:** `localDbGetReservations` dulu → UI langsung; background `pullReservationsFromVps` + `localDbMergeReservationsFromVps`
- **Tulis:** create/edit/status/archive → lokal dulu (`reservationSync.ts`) → `smartSyncService.forceSync()` di background
- **Karyawan & meja:** `localDbGetEmployees`, `getRestaurantRooms` / `getRestaurantTables` (sama seperti kasir)
- **Kalender:** `localDbGetReservationCountsByMonth` + fallback VPS
- File baru: `src/lib/reservationSync.ts`, `src/lib/reservationDateUtils.ts`
- IPC baru: `localdb-merge-reservations-from-vps`
- Field tampilan: tanggal/jam, nama, HP (WA), pax, meja, produk, **DP**, total, PJ, ditambah oleh, status dropdown

### 1.2 Alur reservasi → kasir (existing)

| Langkah | Perilaku sekarang |
|---------|-------------------|
| **Pilih Produk dari Kasir** | Di `ReservationFormModal.tsx` — buka Kasir mode pre-order, simpan `items_json` ke reservasi (`onPickProductsFromKasir` di `POSLayout.tsx`) |
| **Pilih / Ubah menu reservasi** (kartu, sebelum hari-H) | `onPickProductsFromKasir` → Kasir pre-order, simpan `items_json` |
| **Pindahkan menu ke Simpan Order Kasir** (hari-H+) | `onSendToKasir` → isi keranjang + meja → Kasir → **Simpan Order** |
| Status → **Hadir** | Set saat Simpan Order dari reservasi (`onTableOrderSaved` → `localDbUpdateReservation` status `attended`) |
| **Bayar** di kasir | Transaksi `completed` → masuk **Total Omset** Ganti Shift |

### 1.3 DP & pelunasan (gap utama)

- `dp` dan `total_price` di tabel `reservations` = **field catatan saja**
- **Tidak ada** fitur pelunasan, sisa bayar, atau pengurangan DP otomatis di kasir
- **Tidak ada** pencatatan DP sebagai transaksi / penerimaan kas
- **Refund Exc.** (`RefundExcModal.tsx`, tabel `refund_exc`) = catat pengembalian uang manual; mengurangi Grand Total Ganti Shift; **bukan** pelunasan

### 1.4 Omset Ganti Shift

- Omset = agregat `transactions` status `completed` (bukan dari reservasi)
- Buat/batal reservasi **tidak** mengubah omset kecuali ada transaksi kasir atau Refund Exc. manual

---

## 2. Goals & non-goals

### Goals (fase ini)

1. **Tombol kartu reservasi berbeda** antara fase perencanaan (sebelum hari-H) vs eksekusi (hari-H).
2. **Pelunasan terintegrasi**: DP tercatat sebagai uang masuk; sisa bayar jelas; kasir mengurangi DP saat bayar.
3. Label UI lebih jelas (mis. ganti "Refund Exc." → "Refund Eksepsi" — opsional, fase kecil).

### Non-goals (fase ini)

- Notifikasi WA otomatis ke customer
- Pelunasan parsial multi-kali (bisa fase 3)
- Laporan reservasi terpisah di Salespulse web (kecuali sync kolom baru)
- Ubah ulang layout card (sudah OK)

---

## 3. Keputusan produk (HARUS dikonfirmasi sebelum coding)

Tandai pilihan final di kolom **Decision** saat mulai implementasi.

| # | Pertanyaan | Opsi A (disarankan) | Opsi B | Decision |
|---|------------|---------------------|--------|----------|
| D1 | Kapan tombol "kirim ke kasir" aktif? | Hanya jika `tanggal reservasi == hari ini` (UTC+7 via `getTodayUTC7()`) | Juga aktif H-1 | |
| D2 | Sebelum hari-H, tombol utama kartu? | **"Pilih / ubah menu reservasi"** → `onPickProductsFromKasir` atau buka Edit | Sembunyikan tombol hijau; hanya Edit | |
| D3 | Reservasi lewat tanggal tapi masih `upcoming`? | Tetap tampilkan tombol kirim ke kasir (anggap terlambat) | Warna peringatan + label "Terlambat" | |
| D4 | DP dicatat sebagai apa? | **Transaksi khusus / penerimaan DP** terikat `reservation_uuid` | Hanya field + modal "Catat DP" tanpa transaksi | |
| D5 | Pelunasan di kasir? | `final_amount` transaksi = total order − DP sudah dicatat | Staff input manual diskon "DP reservasi" | |
| D6 | DP melebihi total order? | Block / warning; sisa DP tidak auto-refund | Izinkan (credit note — fase 3) | |

**Rekomendasi implementer:** D1=A, D2=A, D3=A, D4=A, D5=A, D6=warning.

---

## 4. Fitur A — Tombol kartu berdasarkan tanggal (Hari-H UX)

### 4.1 Perilaku yang diinginkan

```
SEBELUM hari-H (tanggal > today UTC+7):
  Tombol utama: "Pilih menu ke reservasi" / "Ubah menu reservasi" (jika items_json ada)
  Aksi: onPickProductsFromKasir(reservation)
  Tombol kirim ke kasir: TIDAK tampil (atau disabled + tooltip "Tersedia pada hari reservasi")

HARI-H (tanggal == today):
  Tombol utama: "Pindahkan menu ke Simpan Order Kasir" (atau label disepakati)
  Aksi: onSendToKasir(reservation) — sama seperti sekarang
  Syarat: minimal ada items_json ATAU tetap boleh kirim kosong (konfirmasi D2)

SETELAH dikirim ke kasir / sudah attended:
  Sembunyikan tombol hijau atau ganti "Sudah di kasir" (non-clickable)

Status cancelled / archived:
  Tidak ada tombol kirim
```

### 4.2 Helper baru

File: `src/lib/reservationDateUtils.ts` (baru)

```ts
// normalizeTanggalToYmd(reservation.tanggal) → 'YYYY-MM-DD'
// isReservationToday(tanggal, today = getTodayUTC7()) → boolean
// isReservationFuture(tanggal, today) → boolean
// isReservationPast(tanggal, today) → boolean
```

Gunakan **string compare** `YYYY-MM-DD` (bukan `new Date()` mentah) — konsisten dengan `ReservationPage` / timezone doc `docs/TIMEZONE.md`.

### 4.3 File yang diubah

| File | Perubahan |
|------|-----------|
| `src/components/ReservationPage.tsx` | Logic tombol kartu + label dinamis |
| `src/components/ReservationFormModal.tsx` | Opsional: samakan label tombol "Pilih Produk dari Kasir" |
| `src/components/POSLayout.tsx` | Tidak wajib ubah (callback sudah ada) |

### 4.4 Acceptance criteria

- [ ] Reservasi besok: tidak ada tombol hijau kirim ke kasir (atau disabled sesuai D1)
- [ ] Reservasi hari ini + status upcoming: tombol hijau dengan label hari-H
- [ ] Klik tombol sebelum H → masuk Kasir pre-order mode, bukan kirim order
- [ ] Klik tombol hari-H → perilaku identik dengan `onSendToKasir` sekarang
- [ ] Timezone: pakai `getTodayUTC7()` dari `@/lib/dateUtils`

---

## 5. Fitur B — Pelunasan & DP terintegrasi

### 5.1 Masalah bisnis

1. Staff mencatat DP di reservasi tapi uang tidak masuk laporan kas/shift.
2. Saat hari-H bayar di kasir, staff harus ingat kurangi DP manual.
3. Tidak ada field **sisa bayar** di kartu.

### 5.2 Model data (usulan)

#### Opsi disarankan: perluas `reservations` + tabel pembayaran DP

**Alter `reservations`** (SQLite lokal + migrasi `electron/mysqlSchema.ts` + Salespulse API):

| Kolom baru | Tipe | Keterangan |
|------------|------|------------|
| `dp_recorded_at` | DATETIME NULL | Kapan DP dicatat sebagai uang masuk |
| `dp_payment_method` | VARCHAR(32) NULL | `cash`, `qris`, dll. |
| `dp_shift_uuid` | CHAR(36) NULL | Shift saat DP diterima |
| `dp_recorded_by_user_id` | INT NULL | User yang mencatat |
| `pelunasan_transaction_uuid` | CHAR(36) NULL | Tx kasir saat lunas (hari-H) |
| `payment_status` | ENUM | `none`, `dp_only`, `paid` — default `none` |

**Atau** tabel terpisah `reservation_payments` (lebih fleksibel untuk multi-payment fase 3):

```sql
reservation_payments (
  uuid_id CHAR(36) PK,
  reservation_uuid CHAR(36) NOT NULL,
  business_id INT NOT NULL,
  payment_type ENUM('dp','pelunasan','refund') NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  payment_method VARCHAR(32),
  shift_uuid CHAR(36),
  transaction_uuid CHAR(36) NULL,  -- FK ke transactions jika ada
  created_by_user_id INT,
  created_at DATETIME,
  sync_status ENUM('pending','synced','failed')
)
```

**Rekomendasi fase 2:** tabel `reservation_payments` + kolom `payment_status` di `reservations` (denormalized untuk UI cepat).

### 5.3 UI: Catat DP

**Lokasi:** `ReservationFormModal.tsx` dan/atau tombol di kartu **"Catat DP"**

**Flow:**

1. User isi nominal DP (pre-fill dari field `dp` existing).
2. Pilih metode bayar (sama enum dengan kasir jika memungkinkan).
3. Simpan → insert `reservation_payments` type `dp` + update `reservations.payment_status = 'dp_only'`.
4. **Tambah ke kas shift:** DP tunai masuk perhitungan kas (lihat §5.5).

**Validasi:**

- DP > 0
- User login
- Tidak boleh catat DP dua kali kecuali ada flow "ubah DP" (fase 2: block double; edit lewat void + re-record)

### 5.4 UI: Sisa bayar di kartu

Tampilkan di `ReservationPage.tsx`:

```
Total:     Rp X
DP:        Rp Y  (✓ tercatat / belum tercatat)
Sisa:      Rp max(0, X - Y)
```

- `X` = `computeTotalFromReservationItems(items_json)` atau `total_price`
- `Y` = sum `reservation_payments` type `dp` minus refund terkait

### 5.5 Integrasi Kasir (pelunasan hari-H)

**Extend `reservationCartInfo`** di `POSLayout.tsx` / `CenterContent.tsx`:

```ts
reservationCartInfo?: {
  tableIds: number[];
  tableName: string;
  customerName: string;
  reservationUuid: string;
  pickupMethod: string;
  dpAmount: number;           // NEW
  reservationTotal: number;   // NEW
}
```

**Saat Bayar / checkout:**

1. Hitung `orderTotal` dari cart (existing).
2. `amountDue = max(0, orderTotal - dpAmount)` — tampilkan banner: *"DP reservasi Rp Y — sisa bayar Rp Z"*.
3. Transaksi `completed` dengan `final_amount = amountDue` (bukan full order) **ATAU** full order + line item diskon "DP Reservasi" — **pilih satu pola** (disarankan: diskon/voucher line agar `total_amount` item tetap utuh untuk laporan produk).

**Rekomendasi akuntansi:**

- `total_amount` transaksi = nilai menu penuh (laporan barang terjual benar)
- `voucher_discount` atau field `reservation_dp_applied` = DP
- `final_amount` = total − DP − voucher lain

4. Simpan `pelunasan_transaction_uuid` + `payment_status = 'paid'` di reservasi.
5. Insert `reservation_payments` type `pelunasan`.

### 5.6 Integrasi Ganti Shift

| Event | Dampak omset |
|-------|----------------|
| Catat DP (tunai) | Tambah **penjualan tunai** atau bucket terpisah "Penerimaan DP Reservasi" di ringkasan |
| Pelunasan hari-H | Masuk omset seperti transaksi normal (`final_amount` setelah DP) |
| Refund Exc. DP | Tetap pakai `refund_exc` existing |

**File:** `src/components/GantiShift.tsx`, `electron/main.ts` handlers `localdb-get-cash-summary`, `localdb-get-shift-statistics`

**Usulan ringkasan baru di Ganti Shift:**

```
↳ DP Reservasi (tunai):     + Rp ...
↳ Pelunasan reservasi:      (sudah termasuk di Total Omset)
```

Keputusan: apakah DP dihitung sebagai omset hari DP dicatat, atau hanya pelunasan sisa di hari-H? **Disarankan:** DP = penerimaan kas hari DP; pelunasan sisa = omset menu hari-H (hindari double count total kontrak).

### 5.7 Sync & API

| Layer | Tindakan |
|-------|----------|
| `electron/mysqlSchema.ts` | CREATE + migrasi ALTER |
| `electron/main.ts` | IPC: `localDbRecordReservationDp`, `localDbGetReservationPayments`, update upsert reservation |
| `electron/preload.ts` + `src/types/electron.d.ts` | Expose IPC |
| `src/lib/smartSync.ts` | Upload `reservation_payments` ke VPS |
| `salespulse/src/app/api/reservations/route.ts` | Terima kolom baru di upsert |
| `salespulse` | API baru `POST /api/reservation-payments` (mirror `refund_exc` pattern) |

### 5.8 Acceptance criteria

- [ ] Catat DP → `payment_status = dp_only`, muncul di kartu "DP tercatat"
- [ ] Sisa bayar = Total − DP tercatat
- [ ] Hari-H kirim ke kasir → kasir menampilkan info DP + sisa
- [ ] Bayar di kasir → `final_amount` benar (tidak double charge)
- [ ] Reservasi `payment_status = paid` setelah lunas
- [ ] DP tunai mempengaruhi ringkasan kas shift (sesuai keputusan §5.6)
- [ ] Data sync ke VPS
- [ ] Offline: tetap jalan di SQLite lokal

---

## 6. Fitur C — Perbaikan kecil (opsional, bisa paralel)

| Item | Detail |
|------|--------|
| Rename **Refund Exc.** → **Refund Eksepsi** | `ReservationPage.tsx`, `GantiShift.tsx`, `TransactionList.tsx`, `RefundExcModal.tsx` |
| Tooltip Refund Eksepsi | "Catat pengembalian uang di luar refund transaksi kasir" |
| Kalender reservasi | Tampilkan total DP tercatat vs DP field (jika beda) |

---

## 7. Urutan implementasi (phased)

### Phase 2A — Hari-H tombol (1–2 hari)

1. `reservationDateUtils.ts`
2. Update tombol di `ReservationPage.tsx`
3. Manual test: reservasi kemarin / hari ini / besok

### Phase 2B — Schema & catat DP (2–3 hari)

1. Migrasi DB + IPC
2. Modal / flow Catat DP
3. Tampilan sisa bayar di kartu
4. Ganti Shift: bucket DP tunai

### Phase 2C — Pelunasan kasir (2–3 hari)

1. Extend `reservationCartInfo`
2. Banner sisa bayar di `CenterContent.tsx`
3. Apply DP saat payment
4. Link `pelunasan_transaction_uuid`

### Phase 2D — Sync Salespulse (1–2 hari)

1. API + smartSync
2. Verifikasi multi-device

---

## 8. File reference (audit kode)

```
src/components/ReservationPage.tsx      # Kartu reservasi, tombol aksi
src/components/ReservationFormModal.tsx # Form CRUD, Pilih Produk dari Kasir
src/components/RefundExcModal.tsx       # Refund eksepsi
src/components/POSLayout.tsx            # onPickProductsFromKasir, onSendToKasir, reservationCartInfo
src/components/CenterContent.tsx        # Kasir, Simpan Order, Bayar
src/components/GantiShift.tsx           # Omset, refund, refund exc
src/lib/reservationItems.ts             # items_json ↔ cart
src/lib/reservationStatus.ts          # Label status ID
src/lib/dateUtils.ts                  # getTodayUTC7()
electron/mysqlSchema.ts                 # reservations, refund_exc
electron/main.ts                        # localDb*, shift stats
src/lib/smartSync.ts                    # Upload ke VPS
salespulse/src/app/api/reservations/route.ts
```

---

## 9. Skenario uji manual

### Skenario 1 — Pre-order jauh hari

1. Buat reservasi tanggal +7 hari, pilih menu dari kasir, isi DP 500rb (field).
2. Kartu: tombol **bukan** kirim ke kasir; ada tombol pilih/ubah menu.
3. Omset Ganti Shift: tidak berubah.

### Skenario 2 — Catat DP

1. Klik Catat DP 500rb tunai.
2. Kartu: DP tercatat, sisa = total − 500rb.
3. Ganti Shift: kas tunai +500rb (bucket DP).

### Skenario 3 — Hari-H pelunasan

1. Ubah tanggal sistem / tunggu hari-H.
2. Tombol: "Pindahkan menu ke Simpan Order Kasir".
3. Simpan Order → Bayar: sisa bayar otomatis.
4. Omset: nilai menu; DP tidak double-count.
5. Status reservasi: Hadir + payment_status paid.

### Skenario 4 — Batal + refund DP

1. Batalkan reservasi yang sudah catat DP.
2. Refund Eksepsi 500rb.
3. Grand Total Ganti Shift berkurang.

---

## 10. Risiko & catatan teknis

1. **Timezone:** Semua compare tanggal reservasi pakai `getTodayUTC7()` + string `YYYY-MM-DD`.
2. **Double count omset:** Pisahkan "penerimaan DP" vs "penjualan menu" di desain laporan.
3. **items_json vs total_price:** Satu sumber kebenaran untuk Total di UI (utamakan `items_json` jika ada).
4. **Pending tx dari reservasi:** Cek `localDbGetPendingTransactionsByTableIds` tetap jalan sebelum kirim ke kasir.
5. **Backward compatibility:** Reservasi lama tanpa `payment_status` → treat as `none`; DP field lama = angka rencana, belum tercatat.

---

## 11. Checklist handoff untuk Claude Code

- [x] Implement Phase 2A (hari-H buttons + `reservationDateUtils.ts`)
- [x] Offline-first alignment (local read/write + VPS merge/sync)
- [ ] Baca keputusan §3 dengan product owner; isi kolom Decision
- [x] Setelah D4/D5 fix, implement schema + Phase 2B/2C
- [ ] Jangan ubah perilaku Refund Exc. existing kecuali rename label
- [ ] Ikuti pola existing: IPC di `main.ts`, sync seperti `refund_exc`
- [ ] Minimalkan scope — jangan refactor card layout yang sudah jadi

---

*Dibuat dari sesi diskusi Cursor — layout card, refund exc, omset ganti shift, hari-H UX, dan kebutuhan pelunasan.*
