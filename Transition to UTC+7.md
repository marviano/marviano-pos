# Transition to UTC+7 (WIB)

<!-- AI / tooling metadata — keep in sync with body tables -->
<!--
status_summary:
  storage_transactions: wib_naive  # renderer wibNowSql + localDbUpsert toMySQLDateTime; historis DB bisa masih UTC-naive (Fase 5)
  storage_shift_printer_refund: wib_naive
  filter_daftar_transaksi_offline: wib_ok
  filter_daftar_transaksi_system_pos: wib_client_only
  filter_transaction_manager: wib_ok
  filter_system_pos_verifikasi: wib_ok
  filter_laporan_ganti_shift: wib_ok
  target_storage_format: "YYYY-MM-DD HH:MM:SS naive WIB (no Z)"
  ai_read_first: "three_axes_section"
last_verified_against_codebase: 2026-06-24
primary_helpers: electron/wibDateTime.ts, src/lib/wibDateTime.ts, src/lib/dateUtils.ts, electron/mysqlDb.ts (toMySQLDateTime)
out_of_scope: smart_sync_salespulse  # fingerprint/printer reconcile → smartSync.ts + salespulse APIs; not timezone doc
-->

## Tujuan dokumen

Peta migrasi timezone untuk **marviano-pos** — satu sumber kebenaran untuk tim dan **AI assistant**.

**Scope:** timezone penyimpanan, filter query, dan tampilan UI. **Bukan** dokumentasi smart sync / Salespulse (lihat `src/lib/smartSync.ts`).

**Target akhir penyimpanan:** `YYYY-MM-DD HH:MM:SS` naive **WIB** (tanpa suffix `Z`).

**Strategi Jun 2026:** kode aplikasi **sudah WIB** (`wibNowSql`, `wibDayStartSql`, `toMySQLDateTime`). **Sisa:** data historis di DB yang masih UTC-naive (Fase 5 opsional).

---

## Tiga sumbu — baca ini dulu (AI cheat sheet)

Jangan campurkan ketiga konsep ini. Bug “tanggal salah” hampir selalu salah satu sumbu.

| Sumbu | Arti | Contoh salah paham |
|-------|------|---------------------|
| **Recorded** (penyimpanan) | Nilai **ditulis** ke DB | “Shift WIB” ≠ “transaksi WIB” |
| **Fetched** (filter query) | Rentang tanggal **SQL/IPC** | Filter WIB pada kolom yang disimpan UTC → tepi hari bisa geser |
| **Displayed** (tampilan UI) | Jam yang **dilihat user** (`Asia/Jakarta`) | Tampilan benar tapi filter/record beda timezone |

### Recorded — apa yang disimpan WIB vs UTC

| Recorded WIB ✅ | Recorded UTC+0 / hybrid ⚠️ |
|----------------|------------------------------|
| `shifts.shift_start`, `shift_end`, `created_at` | `transactions.created_at` **historis** (sebelum upsert WIB) |
| `printer*_audit_log.printed_at` (+ `*_epoch`) | Payload renderer `created_at` / `updated_at` (ISO UTC, belum ditulis ke DB) |
| `printer_move_log.moved_at` (+ `*_epoch`) | Sync/API payload lama |
| Refund write path (Electron) | Debug log lines |
| KDS/Barista production timestamps | |
| Reservasi datetime fields | |
| `transactions.created_at` / `paid_at` **baru** via `localDbUpsertTransactions` → `toMySQLDateTime()` | |

**MySQL pool** `timezone: '+07:00'` (`electron/mysqlDb.ts`) — naive datetime dibaca sebagai WIB.

### Fetched — query/filter pakai kalender WIB?

| Fetched WIB ✅ | Fetched bukan WIB ❌ / ⚠️ |
|----------------|---------------------------|
| Daftar Transaksi offline (`wibDayStartSql`–`wibDayEndSql` on `created_at`) | DT → filter **Shift** (`T00:00:00.000Z`) |
| Transaction Manager pool + distribusi P2 (`printed_at` epoch) | Bind to Shift modal |
| `getPrinter1/2AuditLog`, `getPrinterMoveLog` | Ganti Shift **query** range (manual UTC+offset) |
| System POS verifikasi | Laporan (Transaksi, Produk, …) |
| KDS/Barista “hari ini” | System POS resync preview (timezone PC) |

### Displayed — UI ke user

| Displayed WIB ✅ | Catatan |
|----------------|---------|
| Daftar Transaksi, Transaction Manager | `Asia/Jakarta` / `getCalendarDateYMDInWib` |
| Ganti Shift **label** waktu | Tampilan WIB; **query** masih ⚠️ |

### Risiko utama saat ini (mixed model)

`transactions.created_at` = **hybrid** (baru ≈ WIB lewat upsert; historis bisa UTC-naive), tapi filter = **WIB calendar**. Shift `shift_start` = **WIB**. Perbandingan shift ↔ transaksi di SQL bisa aneh di **00:00–07:00 WIB** untuk baris historis UTC sampai Fase 5 selesai.

**Printer move:** `transactions.created_at` **tidak berubah**. P1→P2: audit P2 **menyalin** `printed_at` P1 (hari omset). `printer_move_log.moved_at` = waktu admin pindah (operasional).

---

## Legenda status

| Simbol | Arti |
|--------|------|
| ✅ | Sudah WIB / selaras helper standar |
| ⚠️ | Sebagian WIB, ada path UTC / timezone PC / hack manual |
| ❌ | Belum WIB |

---

## Helper & infra

| Helper / infra | Status | File |
|----------------|--------|------|
| `wibFilterBoundSql()` / `addWibCalendarDays()` | ✅ | `src/lib/wibDateTime.ts`, `electron/wibDateTime.ts` |
| MySQL pool `timezone: '+07:00'` (main + mirror + system_pos) | ✅ | `electron/mysqlDb.ts` |
| `formatDateTimeForWib()` / `wibNowSql()` | ✅ | `electron/wibDateTime.ts`, `src/lib/wibDateTime.ts` |
| `toMySQLDateTime()` | ✅ | `electron/mysqlDb.ts` (wraps `formatDateTimeForWib`) |
| `getTodayUTC7()` | ✅ `Asia/Jakarta` | `src/lib/dateUtils.ts` |
| `getCalendarDateYMDInWib()` | ✅ | `src/lib/wibDateTime.ts` |
| `wibDayStartSql()` / `wibDayEndSql()` | ✅ SQL boundary 00:00–23:59 WIB | `electron/wibDateTime.ts` |
| `wibDateRangeEpochBounds()` | ✅ epoch untuk kolom `*_epoch` | `electron/wibDateTime.ts`, `src/lib/wibDateTime.ts` |

---

## Penyimpanan ke DB (Recorded)

### Transaksi kasir — **WIB di kode** (historis DB bisa hybrid)

| Lapisan | `created_at` | Status |
|---------|--------------|--------|
| **Payload UI** | `wibNowSql()` | ✅ |
| **Simpan lokal** (`localDbUpsertTransactions`) | `toMySQLDateTime()` | ✅ |
| **Upload Salespulse** | `formatDateTimeForWib()` | ✅ |

**Catatan:** baris transaksi **lama** di MySQL bisa masih angka UTC-naive sampai Fase 5 dijalankan.

### Masih non-WIB (sengaja / minor)

| Area | Catatan |
|------|---------|
| Debug log lines | `toISOString()` di `main.ts` diag log — tidak ke DB transaksi |
| `normalizeDateInput` → API fingerprint | ISO UTC di wire (semantik hari WIB) — `verificationMatchCheck.ts` |

### Sudah naive WIB (`YYYY-MM-DD HH:MM:SS`)

| Area | Field |
|------|--------|
| Printer audit | `printer1_audit_log.printed_at`, `printer2_audit_log.printed_at` (+ `*_epoch`) |
| Printer move log | `printer_move_log.moved_at` (+ `moved_at_epoch`) |
| Shift & refund (write path Electron) | `shift_start`, `shift_end`, refund timestamps via `toMySQLDateTime()` |
| KDS / Barista | `production_started_at`, `production_finished_at`, `package_lines.finished_at` |
| Reservasi | tanggal/waktu modul reservasi |

---

## Filter & tampilan (Fetched + Displayed) — transaksi & printer

| Modul | Date picker | Field difilter (Fetched) | Tampilan (Displayed) | Status | Catatan |
|-------|-------------|--------------------------|----------------------|--------|---------|
| **Daftar Transaksi** (Offline) | ✅ WIB | `created_at` | `Asia/Jakarta` | ✅ | Backend: `wibDayStartSql`–`wibDayEndSql`; frontend: `getCalendarDateYMDInWib` |
| **Daftar Transaksi** (System POS mode) | ✅ WIB | `created_at` + filter P2 | `Asia/Jakarta` | ⚠️ | IPC tanpa `from/to`; filter WIB di **frontend** |
| **Daftar Transaksi** → Receipt / Receiptize counter | — | `printed_at_epoch` | — | ✅ | `getPrinter1/2AuditLog` + `wibDateRangeEpochBounds` |
| **Daftar Transaksi** → filter Shift | — | `shift_start` | — | ✅ | `wibDayStartSql` / `wibDayEndSql` |
| **Daftar Transaksi** → Bind to Shift modal | — | hari transaksi | — | ✅ | `addWibCalendarDays` + WIB bounds |
| **Daftar Transaksi** → tombol cepat tanggal | — | — | — | ✅ | `addWibCalendarDays` |
| **Transaction Manager** → pool P1/P2 | ✅ WIB | `created_at` | `Asia/Jakarta` | ✅ | debounce + stale-request guard |
| **Transaction Manager** → tab **P1** | — | audit P1 aktif (pool `created_at`) | — | ✅ | Tanpa filter `printed_at` |
| **Transaction Manager** → tab **P2** | — | audit P2 aktif (pool `created_at`) | — | ✅ | Badge jika `printed_at` di luar filter |
| **Transaction Manager** → distribusi omset | ✅ WIB | Total Net=`created_at`; P2 Net=`printed_at`; P1=Total−P2 | — | ✅ | Net = `final − refund (− refund exc)`; selaras Grand Total DT All/P2 |
| **Transaction Manager** → tab **Log** | — | *(UI tanpa filter tanggal)* | `Asia/Jakarta` | ⚠️ | Backend `getPrinterMoveLog` mendukung `moved_at` WIB |
| **Verifikasi System POS** | ✅ WIB | audit P2 `printed_at`; daftar P2 | — | ✅ | `systemPosVerifikasi.ts` |

---

## Filter & tampilan — laporan & operasional

| Modul | Fetched | Displayed | Status | Catatan |
|-------|---------|-----------|--------|---------|
| **Laporan Transaksi** | ✅ `parseWibTimestampToMs` | ✅ `formatWibTimeShort` | ✅ | |
| **Penjualan Produk** | ✅ `wibDayStartSql` | — | ✅ | |
| **Item Dibatalkan** | ✅ | — | ✅ | |
| **Ganti Shift** | ✅ `wibDayStartSql` | ✅ | ✅ | |
| **Split Bill Report** | ✅ | — | ✅ | |
| **Laporan Waiters** | ✅ | — | ✅ | |
| **Laporan Shift** | ✅ | — | ✅ | |
| **Sync Management** (umum) | ✅ `getTodayUTC7` | — | ✅ | Verifikasi System POS ✅ |

---

## Filter & tampilan — dapur, barista, reservasi

| Modul | Recorded | Fetched | Displayed |
|-------|----------|---------|-----------|
| Kitchen Display (KDS) | ✅ WIB | ✅ hari ini WIB | ✅ |
| Barista Display | ✅ WIB | ✅ | ✅ |
| Reservasi | ✅ WIB | ✅ | ✅ |
| KDS audit log page | ✅ WIB | ✅ | ✅ |

---

## Electron / backend (IPC) — Fetched

| Handler / path | Status | Catatan |
|----------------|--------|---------|
| `localdb-get-transactions` (`from`/`to`) | ✅ | `wibDayStartSql` / `wibDayEndSql` on `created_at` |
| `localdb-get-transactions` (`todayOnly` — KDS) | ⚠️ | `DATE(t.created_at) = CURDATE()` + session `+07:00` |
| `localdb-get-system-pos-transactions` | ❌ | Tanpa filter tanggal |
| `getPrinter1/2AuditLog` | ✅ | `wibDateRangeEpochBounds` on `printed_at_epoch` |
| `getPrinterMoveLog` | ✅ | `wibDateRangeEpochBounds` on `moved_at_epoch` |
| `get-system-pos-verifikasi-data` | ✅ | Audit epoch + `getCalendarDateYMDInWib` |
| `get-system-pos-resync-preview` / `run-system-pos-resync` | ✅ | `wibDateRangeEpochBounds` |
| `printer_daily_counters` “hari ini” | ✅ | `getCalendarDateYMDInWib` |

---

## Modul sudah selaras WIB (ringkas)

1. Infra MySQL + helper `wibDateTime` / `dateUtils` / `toMySQLDateTime`
2. KDS, Barista, `productionTiming.ts`
3. Reservasi
4. Printer audit (recorded + fetched epoch)
5. Printer move log (recorded; fetched di backend)
6. Shift **penyimpanan** (recorded WIB)
7. Daftar Transaksi Offline — fetched `created_at` WIB
8. Daftar Transaksi System POS mode — fetched client-side WIB + P2
9. Transaction Manager — fetched WIB; distribusi **Net** selaras Daftar Transaksi
10. Verifikasi System POS

---

## Backlog migrasi (urutan disarankan)

1. ~~Filter UI transaksi offline & Transaction Manager~~ — **selesai Jun 2026**
2. ~~Selaraskan System POS mode daftar + verifikasi dengan filter P2~~ — **selesai Jun 2026**
3. ~~Seragamkan halaman ke helper `wibDateTime`~~ — **selesai 24 Jun 2026**
4. Backend filter tanggal untuk `localdb-get-system-pos-transactions`
5. ~~**Migrasi tulis transaksi ke WIB** (`wibNowSql` di renderer)~~ — **selesai 24 Jun 2026**
6. (Opsional) Normalisasi data historis `created_at` (Fase 5)

**Saat selesai #5:** update metadata `storage_transactions: wib_naive`, tabel Penyimpanan, dan hapus/revisi “Risiko mixed model”.

---

## Rencana migrasi transaksi ke WIB (detail)

### Fase 0 — Audit data (1× sebelum ubah kode)

**Tidak ada kolom flag** (`timezone_version`, dll.) di schema `transactions` hari ini — deteksi pakai heuristik di bawah.

#### Cek manual (20 transaksi terakhir)

```sql
SELECT uuid_id, created_at, paid_at, receipt_number, status
FROM transactions
ORDER BY created_at DESC
LIMIT 20;
```

- Jika `created_at` ≈ jam WIB di struk / jam bayar → **kemungkinan WIB** (upsert path).
- Jika `created_at` ≈ jam UTC (selisih ~7 jam dari jam kasir) → **kemungkinan UTC-naive** → Fase 5.

#### Heuristik SQL — bayar langsung (completed, selisih created ↔ paid ≈ 7 jam)

Untuk transaksi yang dibuat dan dibayar dalam satu flow, `localDbUpsertTransactions` menulis **keduanya** lewat `toMySQLDateTime()` — selisih biasanya detik–menit, bukan jam.

```sql
-- Kemungkinan created_at masih UTC-naive (paid_at sudah WIB dari upsert)
SELECT
  t.uuid_id,
  t.receipt_number,
  t.created_at,
  t.paid_at,
  TIMESTAMPDIFF(MINUTE, t.created_at, t.paid_at) AS minutes_created_to_paid
FROM transactions t
WHERE t.status IN ('completed', 'paid')
  AND t.paid_at IS NOT NULL
  AND TIMESTAMPDIFF(HOUR, t.created_at, t.paid_at) BETWEEN 6 AND 8
  AND ABS(TIMESTAMPDIFF(MINUTE, t.created_at, t.paid_at) % 60) < 15
ORDER BY t.created_at DESC
LIMIT 100;
```

⚠️ **False positive:** order pending lama (created pagi, paid sore) — bandingkan dengan struk / audit printer.

#### Heuristik — bandingkan dengan `printer1_audit_log` (printed_at pasti WIB)

```sql
SELECT
  t.uuid_id,
  t.receipt_number,
  t.created_at,
  a.printed_at,
  TIMESTAMPDIFF(HOUR, t.created_at, a.printed_at) AS hours_created_to_printed
FROM transactions t
INNER JOIN printer1_audit_log a ON a.transaction_uuid = t.uuid_id
WHERE t.status IN ('completed', 'paid')
  AND ABS(TIMESTAMPDIFF(MINUTE, t.paid_at, a.printed_at)) < 5   -- cetak hampir bersamaan bayar
  AND TIMESTAMPDIFF(HOUR, t.created_at, a.printed_at) BETWEEN 6 AND 8
ORDER BY t.created_at DESC
LIMIT 100;
```

`hours_created_to_printed ≈ 7` + cetak ≈ bayar → `created_at` **mungkin** UTC-naive; `≈ 0` → **mungkin** WIB.

#### Ringkasan deteksi

| Sinyal | Arti likely |
|--------|-------------|
| `created_at` jam ≈ struk WIB | WIB ✅ |
| `created_at` + 7 jam ≈ `paid_at` / `printed_at` | UTC-naive ❌ |
| Transaksi baru setelah deploy `toMySQLDateTime` di upsert | WIB ✅ (asumsi path upsert) |
| Tepi 00:00–07:00 WIB hilang dari filter “hari ini” | Cek baris UTC-naive di rentang itu |
| Kolom berisi `T` atau suffix `Z` | Format salah (bukan naive DATETIME) |

**Opsional ke depan:** kolom `timezone_storage` atau script Fase 5 yang set flag setelah normalisasi — belum diimplementasi.

### Fase 1 — Satu helper tulis (renderer) ✅ sebagian

| Tindakan | File |
|----------|------|
| Ganti `new Date().toISOString()` → `wibNowSql()` untuk `created_at` | `PaymentModal.tsx`, `TableSelectionModal.tsx`, `SplitBillModal.tsx`, `CenterContent.tsx`, `ActiveOrdersTab.tsx` |
| Opsional: **hapus** `created_at` dari payload; biarkan `main.ts` set `toMySQLDateTime(new Date())` | `electron/main.ts` `localDbUpsertTransactions` (sudah ada) |

### Fase 2 — Sync upload ✅ (Jun 2026)

| Tindakan | File |
|----------|------|
| `convertDateForMySQL` pakai `formatDateTimeForWib` (bukan `toISOString().slice`) | `src/lib/syncUtils.ts` |
| Fallback `created_at` sync pakai `wibNowSql()` | `src/lib/smartSync.ts` |

### Fase 3 — `paid_at` / `updated_at`

| File | Catatan |
|------|---------|
| `PaymentModal.tsx` | `updated_at` saat update |
| `electron/main.ts` | handler yang masih `toISOString()` |

Semua lewat `toMySQLDateTime` / `wibNowSql`.

### Fase 4 — Filter ⚠️ (setelah tulis seragam)

| File | Tindakan |
|------|----------|
| `TransactionList.tsx` | filter Shift, Bind to Shift → `wibDayStartSql` / `getCalendarDateYMDInWib` |
| `GantiShift.tsx` | query range → `wibDateRangeEpochBounds` atau `wibDayStartSql` |
| Laporan (`*Report.tsx`) | ganti hack `+7 jam` → import `dateUtils` / `wibDateTime` |
| `electron/main.ts` | resync preview → WIB eksplisit |

### Fase 5 — Data historis (opsional)

- Script sekali jalan: baris `created_at` yang terdeteksi UTC → shift +7 jam ke WIB naive.
- Jalankan di maintenance window; backup DB dulu.
- Setelah itu: force re-sync / fingerprint diff ke Salespulse.

### Fase 6 — Salespulse & verifikasi

| Cek | |
|-----|---|
| `POST /api/transactions` | terima naive WIB |
| txs-master `DATE(created_at)` | session MySQL `+07:00` |
| `GET /api/transactions/fingerprint` | range ISO dari `normalizeDateInput` WIB |
| Sync Management verifikasi | match-check per hari |

### Fase 7 — Tutup migrasi

- Update metadata `storage_transactions: wib_naive`
- Revisi **Tiga sumbu** + hapus “Risiko mixed model”
- Bump `last_verified_against_codebase`

### Urutan testing setelah tiap fase

1. Buat transaksi test → cek `created_at` di MySQL = jam WIB
2. Daftar Transaksi filter hari ini → tx muncul
3. TM distribusi Net = Grand Total
4. Ganti Shift — tx masuk rentang shift
5. Force sync → txs-master tanggal & angka cocok
6. Tepi hari: transaksi 00:30 WIB & 23:50 WIB

---

## Debug checklist

Saat user melaporkan “tanggal salah”:

1. **Sumbu mana?** Recorded vs Fetched vs Displayed (lihat **Tiga sumbu**)
2. **Field mana yang difilter?** `created_at` vs `printed_at` vs `shift_start` vs `moved_at`
3. **Penyimpanan field itu WIB atau UTC?** (tabel Recorded) — lihat **Fase 0 — heuristik deteksi** jika perlu audit baris
4. **Backend atau frontend yang filter?** (System POS mode = frontend)
5. **Apakah tx pernah pindah printer?** `created_at` **tidak berubah**; `printed_at` audit P2 = salinan P1 (bagi hasil); `printer_move_log.moved_at` = waktu pindah
6. **Transaction Manager ganti tanggal:** debounce + generation guard (fix Jun 2026)

**Contoh kasus umum:**

| Gejala | Penyebab likely |
|--------|-----------------|
| Tx “beda hari” di malam hari | Data historis UTC atau payload ISO + filter WIB — tepi 00:00–07:00 WIB |
| TM P2 distribusi &lt; tab P2 | Distribusi pakai `printed_at` filter; tab pakai audit aktif di pool |
| Tx hilang dari P1, tidak di P2 tab | Pindah lintas hari — cek badge “P2 cetak hari lain” / filter tanggal cetak |
| Ganti Shift angka aneh | Query ⚠️; shift **recorded** WIB tapi bandingkan ke `created_at` UTC |
| System POS mode lambat | Fetch semua, filter client |
| Resync preview count aneh | Resync pakai timezone PC |

---

## Cara maintain dokumen ini

- Ubah timezone di kode → update **Tiga sumbu** + tabel terkait + metadata HTML comment.
- Hanya **Fetched** diperbaiki → jangan klaim **Recorded** sudah WIB.
- Hanya **Displayed** diperbaiki → catat terpisah.
- Verifikasi ulang terhadap kode sebelum mengubah status ✅.
- Bump `last_verified_against_codebase` setelah audit.

---

*Terakhir diverifikasi terhadap codebase: 24 Jun 2026 (migrasi WIB penuh di kode; Fase 5 data historis opsional)*
