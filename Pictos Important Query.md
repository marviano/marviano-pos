# Rata-rata persiapan produk (KDS / Barista)

```sql
SET @business_id = 4;
SET @date_from     = '2026-06-01';   -- awal periode (inklusif)
SET @date_to       = '2026-06-20';   -- akhir periode (inklusif)
SET @max_menit     = 90;             -- buang outlier: lupa tap selesai / antrian ekstrem (>90 menit)

WITH products_in_scope AS (
  SELECT p.id AS product_id
  FROM products p
  LEFT JOIN category2 c2 ON c2.id = p.category2_id
  WHERE UPPER(TRIM(COALESCE(c2.name, ''))) NOT IN ('BUFFET', 'ROTI')
),

item_raw AS (
  SELECT product_id, durasi_detik
  FROM (
    SELECT
      ti.product_id,
      TIMESTAMPDIFF(SECOND, ti.production_started_at, ti.production_finished_at) AS durasi_detik
    FROM transaction_items ti
    INNER JOIN transactions t ON ti.uuid_transaction_id = t.uuid_id
    INNER JOIN products_in_scope ps ON ps.product_id = ti.product_id
    WHERE t.business_id = @business_id
      AND t.status IN ('completed', 'paid')
      AND ti.production_status = 'finished'
      AND ti.production_started_at IS NOT NULL
      AND ti.production_finished_at IS NOT NULL
      AND ti.production_started_at <= ti.production_finished_at
      AND DATE(ti.production_finished_at) BETWEEN @date_from AND @date_to
      AND NOT EXISTS (
        SELECT 1 FROM transaction_item_package_lines tipl
        WHERE tipl.uuid_transaction_item_id = ti.uuid_id
      )

    UNION ALL

    SELECT
      tipl.product_id,
      TIMESTAMPDIFF(SECOND, ti.production_started_at, tipl.finished_at) AS durasi_detik
    FROM transaction_item_package_lines tipl
    INNER JOIN transaction_items ti ON ti.uuid_id = tipl.uuid_transaction_item_id
    INNER JOIN transactions t ON ti.uuid_transaction_id = t.uuid_id
    INNER JOIN products_in_scope ps ON ps.product_id = tipl.product_id
    WHERE t.business_id = @business_id
      AND t.status IN ('completed', 'paid')
      AND ti.production_started_at IS NOT NULL
      AND tipl.finished_at IS NOT NULL
      AND ti.production_started_at <= tipl.finished_at
      AND DATE(tipl.finished_at) BETWEEN @date_from AND @date_to
  ) x
),

item_valid AS (
  SELECT product_id, durasi_detik
  FROM item_raw
  WHERE durasi_detik >= 0
    AND durasi_detik <= @max_menit * 60
)

SELECT
  p.nama AS nama_product,
  c1.name AS category_1,
  c2.name AS category_2,
  CONCAT(
    FLOOR(AVG(iv.durasi_detik) / 60), ' menit ',
    MOD(FLOOR(AVG(iv.durasi_detik)), 60), ' detik'
  ) AS rata_rata_persiapan
FROM item_valid iv
INNER JOIN products p ON p.id = iv.product_id
LEFT JOIN category1 c1 ON c1.id = p.category1_id
LEFT JOIN category2 c2 ON c2.id = p.category2_id
GROUP BY p.id, p.nama, c1.name, c2.name
HAVING COUNT(*) >= 1
ORDER BY c1.name, c2.name, p.nama;
```

**Catatan zona waktu:** `production_started_at`, `production_finished_at`, dan `finished_at` line paket disimpan sebagai WIB (UTC+7) format `YYYY-MM-DD HH:MM:SS`. MySQL pool sudah `timezone: '+07:00'`.

- Hanya transaksi sudah bayar (`completed` / `paid`).
- Hanya item sudah tap selesai KDS (`finished` + `production_finished_at`).
- Durasi = `production_started_at` → selesai (bukan `created_at`).
- Buang durasi minus dan outlier di atas `@max_menit` (default 90 menit — atasi kasus lupa tap selesai ratusan menit).
- Tidak ada `@min_sample` — semua produk dengan ≥1 sampel valid ditampilkan.
- Filter tanggal menurut **tanggal selesai** (`production_finished_at` / `finished_at` line paket).

**Sesuaikan `@max_menit`** jika operasional butuh batas lain (mis. 60 untuk minuman, 120 untuk masakan berat — jalankan query terpisah per `@max_menit`).
