# Transition to UTC+7 (WIB)

Catatan fitur yang **sudah** memakai UTC+7. Update file ini setiap ada modul baru dimigrasi.

Format simpan di DB (kalau relevan): `YYYY-MM-DD HH:MM:SS` (naive WIB).

---

## Sudah UTC+7

1. **Infra MySQL lokal** — koneksi pool `timezone: '+07:00'` + helper `toMySQLDateTime()` / `formatDateTimeForWib()` (`electron/mysqlDb.ts`, `electron/wibDateTime.ts`, `src/lib/wibDateTime.ts`).

2. **Monitoring dapur (Kitchen Display / KDS)** — `production_started_at`, `production_finished_at`, timer, durasi, filter hari ini, audit log terkait produksi.

3. **Monitoring barista (Barista Display)** — sama seperti dapur + `finished_at` line paket.

4. **Alur timing produksi** — `productionTiming.ts` (Simpan Order, Tambah Order, payment upsert, tap selesai, backfill KDS).

5. **Timer order di layar KDS** — `OrderTimer` (`DisplayTimerContext`) parse timestamp WIB.

6. **Reservasi** — sync & format tanggal/waktu WIB (`reservationSyncFormat`, `reservationDateUtils`, `smartSync` reservasi).

7. **Filter "hari ini" (tanggal kalender UTC+7)** — helper `getTodayUTC7()` dipakai di: Daftar Transaksi, Laporan Transaksi, Split Bill, Ganti Shift (tampilan), Printer 1→2 Manager, Sync Management (danger range), verifikasi match check.

8. **Shift & refund (Electron write path)** — timestamp shift/refund lewat `toMySQLDateTime()` di `main.ts`.

9. **Printer audit / printer management** — `printed_at` & timestamp terkait lewat `toMySQLDateTime()`.

11. **Sync waktu persiapan ke Salespulse (remote)** — Smart Sync mengirim `production_status`, `production_started_at`, `production_finished_at`, dan `package_lines.finished_at` ke `/api/transactions`. Fingerprint sync ikut hitung item selesai agar re-upload otomatis setelah tap selesai. Lihat dashboard Salespulse → **Waktu Persiapan**.

---

## Belum / sebagian (masih `toISOString()` atau timezone PC)

- Transaksi baru di kasir (`created_at` order — PaymentModal, TableSelectionModal, dll.)
- Beberapa path di `electron/main.ts` masih fallback `new Date().toISOString()`
- Modul lain di luar daftar di atas — perlu dicek satu per satu

---

*Terakhir diupdate: 20 Jun 2026*
