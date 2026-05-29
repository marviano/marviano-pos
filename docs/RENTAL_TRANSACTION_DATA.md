# Room rental (Sewa Ruangan) — data model & queries

This document describes how **borrowed/rented room** usage is stored and how to query it (POS, local MySQL, Salespulse).

## Identifying rental products

- **Category I** name: `Sewa Ruangan` (case-insensitive trim).
- Code constant: `RENTAL_CATEGORY1_NAMES` in `src/lib/posCategory1Filters.ts`.
- Example product: VIP room (`products.id`, business-specific).

Rental lines must **not** be inferred from `custom_note` or price alone.

## Table columns (`transaction_items`)

| Column | Type | Purpose |
|--------|------|---------|
| `rental_duration_value` | `DECIMAL(10,2)` | Amount of time rented (e.g. `2`, `0.5`) |
| `rental_duration_unit` | `ENUM('hour','day','month')` | Unit for `rental_duration_value` |
| `unit_price` / `total_price` | existing | Revenue (harga bebas or customization tiers) |
| `product_id` | existing | Which room (join `products.nama`) |
| `custom_note` | existing | Free text only; **not** used for analytics |

Both duration columns are **NULL** for non-rental lines.

Migrations:

- `marviano-pos/migrations/add_transaction_items_rental_duration.sql`
- `salespulse/migrations/add_transaction_items_rental_duration.sql`

POS applies lazy migration on first item upsert (`electron/main.ts`).

## Normalizing duration to hours

| Unit | Hours |
|------|-------|
| `hour` | `value` |
| `day` | `value × 24` |
| `month` | `value × 720` (30-day month) |

Helpers: `rentalDurationToHours()`, `SQL_RENTAL_DURATION_HOURS_EXPR` in `src/lib/rentalTransaction.ts`.

## Example SQL (monthly total hours)

```sql
SELECT
  SUM(CASE ti.rental_duration_unit
    WHEN 'hour'  THEN ti.rental_duration_value
    WHEN 'day'   THEN ti.rental_duration_value * 24
    WHEN 'month' THEN ti.rental_duration_value * 720
    ELSE 0
  END) AS total_hours,
  SUM(ti.total_price) AS total_revenue
FROM transaction_items ti
INNER JOIN transactions t ON t.uuid_id = ti.uuid_transaction_id
INNER JOIN products p ON p.id = ti.product_id
INNER JOIN category1 c1 ON c1.id = p.category1_id
WHERE t.business_id = ?
  AND t.status = 'completed'
  AND (ti.production_status IS NULL OR ti.production_status != 'cancelled')
  AND ti.rental_duration_value IS NOT NULL
  AND ti.rental_duration_unit IS NOT NULL
  AND LOWER(TRIM(c1.name)) = 'sewa ruangan'
  AND COALESCE(t.paid_at, t.created_at) >= ?
  AND COALESCE(t.paid_at, t.created_at) < ?;
```

## Salespulse HTTP API

`GET /api/reports/room-rentals?businessId=4&from=2026-05-01&to=2026-05-31&productId=1179`

Returns `summary`, `by_product`, and `lines` (max 500).

Requires authenticated session.

## POS capture flow

1. Cashier adds a **Sewa Ruangan** product.
2. **Package mode** (default when harga bebas disabled): pick customization option (e.g. 1 Jam) — duration + price from option metadata.
3. **Harga bebas** (when enabled on product in Manage Products): manual price + manual duration via `RentalPriceModal`.
4. Payment writes `rental_duration_*` on `transaction_items`; sync uploads to Salespulse.

## Manage Products configuration (Salespulse)

| Setting | Location | Effect |
|---------|----------|--------|
| **Izinkan harga bebas di POS** | Product edit → Category = Sewa Ruangan | OFF = cashier must pick customization packages only |
| **Billing based** | Kustomisasi tab or product Customization → toggle **Billing based** | ON = sets price/duration package; OFF = optional add-on |
| **Harga paket** | Customization option `price_adjustment` | Line price on POS |

Run migrations:

- `salespulse/migrations/add_rental_product_settings.sql`
- `salespulse/migrations/add_product_customizations_is_billing.sql`
- `salespulse/migrations/add_customization_types_is_billing.sql`

Then sync POS master data.

### Billing vs add-on groups (`product_customizations.is_billing`)

| `is_billing` | Manage Products label | POS behavior |
|--------------|----------------------|--------------|
| `1` (default) | **Billing based** ON | Shown under billing section; option sets line price + rental duration |
| `0` | **Billing based** OFF | Shown under add-ons; price add-on only, no duration |

## Reading a line in TypeScript

```ts
import { rentalDurationFromRow } from '@/lib/rentalTransaction';

const duration = rentalDurationFromRow(dbRow);
```
