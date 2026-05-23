# Membership, CRM & n8n — Detailed Implementation Plan

**Audience:** AI implementation agent (and human reviewer)  
**Repos:** `marviano-pos` (POS = source of truth for checkout & earn), `salespulse` (CRM + VPS backup + analytics)  
**Last updated:** 2026-05-21 (P0 + P1 code landed in `marviano-pos`)  
**Related docs:** `docs/LOYALTY-PROGRAM-PHASED-PLAN.md`, `salespulse/database_migrations/README_contact_businesses_junction.md`, `docs/SYNC-SCENARIOS.md`

---

## 0. Executive summary

### Business goals

1. Kasir memilih **member** saat bayar (nama + telepon); transaksi tersimpan dengan `contact_id`.
2. Member dapat **dapat poin** (loyalty) per outlet (`business_id`).
3. Identitas member **sinkron** ke Salespulse VPS (`contacts` + `contact_businesses`).
4. CRM + **n8n** dapat menjawab: *member X beli produk apa, di bisnis mana* — dari `transactions` + `transaction_items`, bukan dari `deals` (motor).
5. (Opsional) Status **verifikasi** staff terlihat di kasir / mempengaruhi earn.

### Architecture decisions (LOCKED — do not change without user approval)

| Topic | Decision |
|-------|----------|
| Member identity key | `contacts.id` (global) + `contact_businesses` (per `business_id`) |
| Phone format | Normalized `62XXXXXXXX` (8–12 digits after 62) |
| POS transaction → member link | `transactions.contact_id` (nullable) |
| Product favorites analytics | SQL join: `transactions` → `transaction_items` → `products` + `business_id` |
| Motor CRM | `deals` table — **out of scope** for F&B favorites |
| Loyalty earn authority | **POS local MySQL** calculates earn; VPS **stores mirror only** (no server-side recalc on upload) |
| Loyalty idempotency | `loyalty_point_ledger.uuid_id` + unique `(business_id, source_type, source_id, entry_type)` |
| Sync order | contacts → transactions → loyalty (settings, ledger, balances) |
| n8n primary integration | Read-only MySQL on VPS (scheduled SQL workflows) |

### Current state (audit 2026-05-21)

| Area | Status |
|------|--------|
| Payment modal + contact picker | Implemented (`PaymentModal`, `ContactBookPopover`) |
| Local contact save + VPS POST | Implemented (`localdb-save-contact-for-business`, `POST /api/pos/contacts`) |
| Smart Sync contacts | Implemented (`syncPendingContacts`) |
| `transactions.contact_id` on VPS | Column exists; Smart Sync sends it |
| Loyalty tables local | Implemented (`ensureLoyaltyTables`, `mysqlSchema.ts`) |
| Loyalty earn on pay | Implemented (`loyaltyEarnForTransaction` in `localdb-upsert-transactions`) |
| Loyalty settings UI (enable program) | **DONE (P1)** — `LoyaltySettingsPanel` + `localdb-upsert-loyalty-settings` |
| Loyalty default enabled | **NO** until user enables in Pengaturan (`is_enabled = 0` in DB by default) |
| Contact aux schema in `mysqlSchema` + startup init | **DONE (P0)** — `contact_businesses`, `pending_contact_sync`, `initializeMySQLSchema()` on boot |
| Orphan contact cleanup after ID remap | **DONE (P0)** — `deleteOrphanContactIfUnused` |
| Contact upsert verification columns | **DONE (P0)** — dynamic columns via `information_schema` |
| Earn `created_by_email` on ledger | **DONE (P1)** — from `user_id` → `users.email` at earn time |
| Loyalty VPS tables / sync | **NOT implemented** (P2) |
| Verification in POS UI | **NOT implemented** |
| n8n workflows | **NOT implemented** (design only) |
| CRM contact activities table | Migration exists; may need run on VPS |

---

## 1. Prerequisites (human + agent — before coding)

### 1.1 VPS MySQL migrations (run in order on database `salespulse`)

Agent must verify each table exists (`SHOW TABLES LIKE '...'`). If missing, run the file.

| # | File (`salespulse/database_migrations/`) | Purpose |
|---|------------------------------------------|---------|
| 1 | `add_contact_businesses_junction.sql` | `contact_businesses` |
| 2 | `add_nama_to_contact_businesses.sql` | `nama` per outlet |
| 3 | `add_linked_by_email_to_contact_businesses.sql` | `linked_by_email` |
| 4 | `add_created_by_email_to_contacts.sql` | if not already on `contacts` |
| 5 | `add_business_id_to_contacts.sql` | legacy column on `contacts` |
| 6 | `crm_contact_groups_and_tag_scope.sql` | groups (if CRM tags used) |
| 7 | `add_crm_contact_tags.sql` | tags |
| 8 | `crm_contact_activities.sql` | activity timeline — use **`created_by INT`** not UNSIGNED (match `users.id`) |

After migrations: refresh `marviano-pos/salespulse_vps_db-schema.md` via `node scripts/extract-mysql-schema.js` (see `scripts/SCHEMA_COMPARISON_README.md`).

### 1.2 Environment variables

**marviano-pos** (Electron / `.env`):

- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` — local MySQL
- API base URL for VPS (used by `getApiUrl()`)
- `POS_WRITE_API_KEY` / `NEXT_PUBLIC_POS_WRITE_API_KEY` — required for `POST /api/pos/contacts` and future loyalty APIs

**salespulse** (`.env`):

- Same DB credentials on VPS
- `POS_WRITE_API_KEY` — must match POS key (`src/lib/posWriteAuth.ts`, `middleware.ts` allows `/api/pos/contacts`)

### 1.3 Agent must read these files first (30 min)

**marviano-pos**

- `src/components/PaymentModal.tsx` — `selectedContact`, `contact_id` on pay
- `src/components/ContactBookPopover.tsx` — search + add member
- `electron/main.ts` — `ensurePosContactAuxTables`, `ensureLoyaltyTables`, `loyaltyEarnForTransaction`, IPC handlers ~3807–4475, ~5057–5298
- `electron/mysqlSchema.ts` — loyalty DDL ~913–955
- `electron/preload.ts` + `src/types/electron.d.ts` — IPC surface
- `src/lib/smartSync.ts` — `syncPendingContacts`, transaction upload ~563–708
- `src/lib/offlineSync.ts` — master download `contacts`, `contactBusinesses` ~583–589

**salespulse**

- `src/app/api/pos/contacts/route.ts`
- `src/app/api/transactions/route.ts` — upsert includes `contact_id`
- `src/app/api/sync/route.ts` — downloads contacts for business
- `src/lib/contactBusinesses.ts`

---

## 2. Phase map (execution order)

Execute phases **in order**. Do not start Phase 2 until Phase 1 acceptance tests pass.

| Phase | Name | Repos | Est. | Code status |
|-------|------|-------|------|-------------|
| **P0** | Harden identity & transaction link | pos + salespulse verify | 1–2 d | **Done** — manual smoke §P0.4 still required |
| **P1** | Complete local loyalty + POS settings | marviano-pos | 3–4 d | **Done** — manual tests §P1.4 still required |
| **P2** | Loyalty sync to VPS | both | 5–7 d | Not started |
| **P3** | Verification policy (POS + sync) | both | 2–3 d |
| **P4** | CRM read-only loyalty + member analytics API | salespulse | 3–4 d |
| **P5** | n8n workflows + SQL pack | ops + doc | 2–3 d |
| **P6** | Production hardening | both | 2 d |

---

## 3. Phase P0 — Harden identity & transaction link

**Goal:** Every new paid transaction *can* store a valid `contact_id`; contact IDs on POS match VPS after sync.

**Implementation (2026-05-21):** Landed in `electron/mysqlSchema.ts`, `electron/main.ts` (`createWindows` startup). Human: run §P0.4 smoke + §P0.5 coverage query on VPS.

### P0.1 — Schema parity local POS MySQL ✅

**Problem:** `contacts` / `contact_businesses` are created in `main.ts` (`ensurePosContactAuxTables`) but not in `mysqlSchema.ts` `initializeMySQLSchema()`.

**Tasks:**

1. ✅ Add to `electron/mysqlSchema.ts` (match `main.ts` exactly):
   - `contact_businesses` (columns: `contact_id`, `business_id`, `nama`, `linked_by_email`, `created_at`)
   - `pending_contact_sync`
   - Document: `contacts` table is assumed to exist (cloned from VPS or created by first sync). Optionally add minimal `CREATE TABLE IF NOT EXISTS contacts` with columns required by POS upsert + search only (do **not** duplicate full CRM schema if sync provides it).
2. ✅ Call `initializeMySQLSchema()` + `ensurePosContactAuxTables()` at app startup in `main.ts` `createWindows`.
3. ✅ Export `ensurePosContactAuxTables()` from `mysqlSchema.ts` (still called from IPC paths in `main.ts`).

**Acceptance:**

- Fresh DB: app starts, search contact works after one master sync.
- `SHOW TABLES` includes `contact_businesses`, `pending_contact_sync`.

### P0.2 — Contact ID remap cleanup ✅

**Problem:** After VPS returns `serverId !== localId`, FKs are updated but orphan `contacts` row may remain.

**Tasks:**

1. ✅ `deleteOrphanContactIfUnused()` in `localdb-save-contact-for-business` and `localdb-remap-contact-id` (`electron/main.ts`).
2. ✅ Debug log when `DEBUG_CONTACT_REMAP=1` (remap + orphan delete).

**Acceptance:**

- Create contact offline with local id 999, sync gets server id 5000 → only one logical contact for that phone in search.

### P0.3 — Upsert contacts from master download includes verification fields (for Phase 3) ✅

**Tasks:**

1. ✅ `localdb-upsert-contacts` — dynamic INSERT/UPDATE via `information_schema` for:
   - `public_form_staff_verified_at`
   - `public_form_followup_pending`
   - `created_by_email`, `business_id`
2. ✅ `mysqlSchema` one-time ALTERs for those columns when `contacts` exists.
3. Mirror VPS `GET /api/sync` — already returns `SELECT DISTINCT c.*` so extra columns flow when present.

**Acceptance:**

- After master sync, local row has `public_form_staff_verified_at` when set on VPS.

### P0.4 — Smoke test checklist (agent runs manually) ⏳

> Not automated — run on a real POS DB after deploy.

| # | Step | Expected |
|---|------|----------|
| 1 | Master sync outlet A | `contacts` + `contact_businesses` populated |
| 2 | Payment: select member, pay Rp 100k | Local `transactions.contact_id` = member id |
| 3 | Smart Sync | VPS `transactions.contact_id` same (after remap) |
| 4 | Payment without member | `contact_id` IS NULL |
| 5 | Add new member di modal | VPS `contacts` + `contact_businesses` row exists |

### P0.5 — Coverage query (document baseline for n8n)

Run on VPS, save result in PR description:

```sql
SELECT
  business_id,
  COUNT(*) AS tx_total,
  SUM(contact_id IS NOT NULL) AS tx_with_member,
  ROUND(100.0 * SUM(contact_id IS NOT NULL) / NULLIF(COUNT(*), 0), 2) AS pct_member
FROM transactions
WHERE status = 'completed'
  AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY business_id;
```

---

## 4. Phase P1 — Complete local loyalty + POS settings

**Goal:** Loyalty works end-to-end on one POS without VPS loyalty tables.

**Implementation (2026-05-21):** `LoyaltySettingsPanel.tsx`, `GlobalSettings.tsx`, IPC in `main.ts` / `preload.ts` / `electron.d.ts`, `PaymentModal.tsx` UX. Human: enable program in Pengaturan + run §P1.4.

### P1.1 — Settings UI (marviano-pos) ✅

**New/updated files:**

- ✅ `src/components/LoyaltySettingsPanel.tsx` — wired in `GlobalSettings.tsx` (Pengaturan)
- ✅ IPC `localdb-upsert-loyalty-settings` in `main.ts`

**IPC contract `localdb-upsert-loyalty-settings`:**

```ts
// Input
{ business_id: number; is_enabled: boolean; rupiah_per_point: number;
  earn_basis: 'final_amount' | 'total_amount'; min_earn_amount: number; rounding_mode: 'floor' }
// Output
{ success: boolean }
```

**SQL:** `UPDATE loyalty_program_settings SET ... sync_status = 'pending' WHERE business_id = ?` or INSERT.

**Expose in:** `preload.ts`, `src/types/electron.d.ts`.

**UI fields:**

- Toggle: Program aktif
- Number: Rp per poin (min 1)
- Select: Dasar hitung (`final_amount` / `total_amount`)
- Number: Minimum transaksi untuk earn

**Acceptance:**

- Enable program → Payment modal shows saldo + estimasi poin
- Disable → no earn, no saldo line

### P1.2 — Pass `created_by_email` into earn ✅

**File:** `electron/main.ts` — `loyaltyEarnForTransaction` call inside `localdb-upsert-transactions`

**Task:** ✅ Resolve cashier email via `user_id` → `users.email` when building `loyaltyEarnCandidates`.

### P1.3 — Payment modal UX (minor) ✅

**File:** `src/components/PaymentModal.tsx`

**Tasks:**

1. ✅ “Member” badge when contact selected.
2. ✅ Soft warning when loyalty enabled but no member selected.
3. ✅ Payment not blocked without member.

### P1.4 — Tests P1 ⏳

> Manual — confirm on device after enabling program in Pengaturan.

| # | Action | Expected |
|---|--------|----------|
| 1 | Enable 50k/point, pay 100k with member | `loyalty_point_ledger` +1 entry +2 points, balance 2 |
| 2 | Pay again same member 100k | balance 4 |
| 3 | Replay same transaction uuid upsert | No duplicate earn (idempotent) |
| 4 | Pay without member | No ledger row |
| 5 | Restart app | Balance unchanged |

---

## 5. Phase P2 — Loyalty sync to Salespulse (VPS backup)

**Goal:** Loyalty data on VPS mirrors POS; new POS can download history.

### P2.1 — VPS migrations

**Create:** `salespulse/database_migrations/add_loyalty_program.sql`

**Tables (mirror local — column names must match POS payload):**

```sql
-- loyalty_program_settings
-- PK: business_id
-- is_enabled TINYINT(1), rupiah_per_point INT, earn_basis VARCHAR(32),
-- min_earn_amount DECIMAL(15,2), rounding_mode VARCHAR(16),
-- updated_at DATETIME, synced_from_pos_at DATETIME NULL

-- loyalty_point_ledger
-- PK: uuid_id VARCHAR(36)
-- business_id, contact_id INT (signed, match users/contacts),
-- entry_type, points_delta, balance_after, source_type, source_id,
-- rupiah_basis, note, created_by_email, created_at,
-- synced_from_pos_at DATETIME NULL
-- UNIQUE (business_id, source_type, source_id, entry_type)

-- contact_loyalty_balances
-- PK (contact_id, business_id)
-- points_balance, lifetime_earned, updated_at, synced_from_pos_at
```

**FK policy:** Optional FK to `contacts(id)` and `businesses(id)` — if FK fails on existing data, use indexes only (same as `transactions.contact_id`).

**Agent:** Run migration on VPS; update `salespulse_vps_db-schema.md`.

### P2.2 — Salespulse POS write APIs

**Auth:** `requirePosWriteAuth` from `src/lib/posWriteAuth.ts` on all routes.

**Register in** `src/middleware.ts` if path-based allowlist exists (mirror `/api/pos/contacts`).

#### `POST /api/pos/loyalty/ledger`

- Body: `{ entries: Array<LoyaltyLedgerEntry> }` (batch max 50)
- Upsert by `uuid_id`: `INSERT ... ON DUPLICATE KEY UPDATE` (same values, no recalc)
- Validate: `contact_id` exists in `contacts` when provided
- **Do not** recompute `balance_after` on server

#### `PUT /api/pos/loyalty/settings`

- Body: `{ business_id, is_enabled, rupiah_per_point, earn_basis, min_earn_amount, rounding_mode, updated_at }`
- Upsert one row per `business_id`

#### `PUT /api/pos/loyalty/balances` (optional)

- Body: `{ balances: Array<{ contact_id, business_id, points_balance, lifetime_earned, updated_at }> }`
- Upsert PK `(contact_id, business_id)`

**Files to create:**

- `src/app/api/pos/loyalty/ledger/route.ts`
- `src/app/api/pos/loyalty/settings/route.ts`
- `src/app/api/pos/loyalty/balances/route.ts`

### P2.3 — Extend `GET /api/sync`

**File:** `src/app/api/sync/route.ts`

Add queries filtered by `business_id`:

- `loyalty_program_settings` — `WHERE business_id = ?`
- `loyalty_point_ledger` — `WHERE business_id = ? ORDER BY created_at DESC LIMIT 5000` (or since date)
- `contact_loyalty_balances` — `WHERE business_id = ?`

Add to response `data` and `counts` objects.

### P2.4 — marviano-pos master download

**File:** `src/lib/offlineSync.ts`

After contacts upsert:

1. If `data.loyalty_program_settings` → IPC `localDbUpsertLoyaltySettings`
2. If `data.loyalty_point_ledger` → IPC `localDbUpsertLoyaltyLedger` (upsert by uuid; **do not overwrite** local rows with `sync_status = 'pending'` — merge policy below)
3. If `data.contact_loyalty_balances` → IPC `localDbUpsertLoyaltyBalances`

**Merge policy (document in code comment):**

- Download fills **missing** `uuid_id` only OR VPS `updated_at` older than local pending
- Pending local ledger always wins until synced

**Implement IPC handlers in** `electron/main.ts` + `preload.ts` + `electron.d.ts`.

### P2.5 — Smart Sync upload

**File:** `src/lib/smartSync.ts`

Add methods (call after `syncPendingContacts`, before or after transactions — **after transactions** is OK if earn happens on upsert locally first):

1. `syncPendingLoyaltySettings()` — read local `loyalty_program_settings WHERE sync_status IN ('pending','failed')`
2. `syncPendingLoyaltyLedger()` — batch pending ledger
3. `syncPendingLoyaltyBalances()` — optional

**Local DB helpers:**

- `localdb-get-pending-loyalty-settings`
- `localdb-get-pending-loyalty-ledger` (LIMIT 50)
- `localdb-mark-loyalty-*-synced` / `failed`

**Hook:** In same sync loop as ~line 442 (`syncPendingContacts`).

### P2.6 — Tests P2

| # | Test | Expected |
|---|------|----------|
| 1 | Earn on POS → Smart Sync | VPS ledger row exists same `uuid_id` |
| 2 | Second POS master download | Sees balance |
| 3 | Duplicate POST ledger | No double points on VPS |
| 4 | Offline earn → online | Eventually appears on VPS |

---

## 6. Phase P3 — Verification policy (POS + CRM)

**Goal:** Align “member verification” with user expectation; prepare n8n/CRM filters.

**Product decision (agent must ask user if not specified — default in plan):**

- **Default recommended:** Show verification badge in POS; **do not block** earn unless user explicitly wants `require_verified_to_earn`.

### P3.1 — Extend local search payload

**Files:** `electron/main.ts` (`localdb-search-contacts`), `ContactBookPopover.tsx`, type `ContactSuggestion`

Add fields:

```ts
staff_verified: boolean; // from public_form_staff_verified_at IS NOT NULL
verified_at?: string | null;
```

**UI:** Icon/checkmark “Terverifikasi” in suggestion list and selected member chip.

### P3.2 — Optional earn gate

**File:** `loyaltyEarnForTransaction` in `main.ts`

If `loyalty_program_settings.require_verified = 1` (new column — migration local + VPS):

- Skip earn when `contacts.public_form_staff_verified_at IS NULL`

Requires migration `add_loyalty_require_verified.sql` (TINYINT default 0).

### P3.3 — Sync verification on contact download

Already in P0.3; verify end-to-end after VPS member list acknowledges contact.

### P3.4 — Tests P3

| # | Test | Expected |
|---|------|----------|
| 1 | Verified member on VPS → sync → POS search | Badge visible |
| 2 | Unverified member | Badge absent |
| 3 | If gate enabled | Unverified earns 0 points |

---

## 7. Phase P4 — CRM & analytics APIs (salespulse)

**Goal:** HQ sees points; n8n can call HTTP instead of raw SQL (optional); member product favorites query documented.

### P4.1 — CRM contact detail — loyalty section

**Files:** Find contact detail page under `src/app/contacts/[contactId]/` (already exists for activities).

Add component `CrmContactLoyaltyPanel.tsx`:

- GET internal API: `GET /api/crm/contacts/[contactId]/loyalty?business_id=`
- Shows: `points_balance`, last 20 ledger rows (from **VPS backup tables**)
- Read-only in MVP

**Create API:** `src/app/api/crm/contacts/[contactId]/loyalty/route.ts`

- Join `contact_loyalty_balances` + ledger for business
- Permission: same as `view_crm`

### P4.2 — Analytics API for n8n (recommended)

**Create:** `GET /api/analytics/member-product-favorites`

**Query params:**

- `business_id` (optional)
- `contact_id` (optional)
- `from`, `to` (ISO date)
- `limit` (default 100)

**Auth:** Service API key header `X-Analytics-Key` (new env `ANALYTICS_API_KEY`) — **not** public.

**SQL core (agent implement exactly):**

```sql
SELECT
  t.contact_id,
  c.phone_number,
  COALESCE(NULLIF(TRIM(cb.nama), ''), c.nama) AS member_name,
  t.business_id,
  b.name AS business_name,
  p.id AS product_id,
  p.nama AS product_name,
  SUM(ti.quantity) AS total_qty,
  SUM(ti.total_price) AS revenue
FROM transactions t
INNER JOIN transaction_items ti ON ti.uuid_transaction_id = t.uuid_id
INNER JOIN products p ON p.id = ti.product_id
INNER JOIN businesses b ON b.id = t.business_id
INNER JOIN contacts c ON c.id = t.contact_id
LEFT JOIN contact_businesses cb
  ON cb.contact_id = c.id AND cb.business_id = t.business_id
WHERE t.status = 'completed'
  AND t.contact_id IS NOT NULL
  AND t.created_at >= ? AND t.created_at < ?
  /* optional filters */
GROUP BY t.contact_id, t.business_id, p.id
ORDER BY revenue DESC
LIMIT ?;
```

**Note:** `products.nama` is correct column name per schema.

### P4.3 — Optional SQL view on VPS

**Migration:** `create_view_member_product_stats.sql`

```sql
CREATE OR REPLACE VIEW v_member_product_revenue AS
  -- same SELECT as above without date filter
;
```

n8n MySQL node can query view directly.

### P4.4 — Tests P4

- CRM page shows balance matching POS after P2 sync
- Analytics API returns rows only when `contact_id` set
- API returns 401 without key

---

## 8. Phase P5 — n8n workflows

**Goal:** Operational automation without modifying POS.

### P5.1 — Infrastructure

1. n8n instance with outbound access to VPS MySQL (VPN / allowlist IP).
2. Create MySQL credential **read-only** user:

```sql
CREATE USER 'n8n_readonly'@'%' IDENTIFIED BY '...';
GRANT SELECT ON salespulse.* TO 'n8n_readonly'@'%';
```

3. Store credential in n8n vault — never in repo.

### P5.2 — Workflow 1: Daily member coverage report

**Schedule:** 07:00 daily

**Nodes:** MySQL → Function → Email/Slack/Google Sheet

**SQL:** P0.5 coverage query + trend vs yesterday.

### P5.3 — Workflow 2: Top products per member (weekly)

**Schedule:** Monday 06:00

**SQL:** P4.2 query last 7 days, `limit` 5000

**Output:** CSV to Google Sheet or WhatsApp digest (via existing WA node).

### P5.4 — Workflow 3: New verified members (optional)

**Trigger:** Schedule  hourly

```sql
SELECT id, nama, phone_number, public_form_staff_verified_at
FROM contacts
WHERE public_form_staff_verified_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR);
```

### P5.5 — Workflow 4: Failed POS sync alert (optional)

Query `pending_contact_sync` is POS-local — **not on VPS**. Instead alert on:

- `transactions.sync_status = 'failed'` on VPS if column used
- Or POS health endpoint (future)

Document limitation in n8n README.

### P5.6 — Deliverable doc

**Create:** `salespulse/docs/n8n-member-analytics.md`

- Connection instructions
- SQL pack (copy from P4.2, P0.5)
- Sample n8n JSON export (optional)

---

## 9. Phase P6 — Production hardening

### P6.1 — Data quality

- [ ] Add FK or periodic job: orphan `transactions.contact_id` → NULL where contact missing
- [ ] Index check: `idx_transactions_contact`, `idx_lpl_contact_business`
- [ ] Monitor `% tx_with_member` weekly

### P6.2 — Security

- [ ] Rotate `POS_WRITE_API_KEY` procedure documented
- [ ] `ANALYTICS_API_KEY` only on server
- [ ] Rate limit `POST /api/pos/loyalty/ledger` (batch size cap)

### P6.3 — Observability

- [ ] Smart Sync log line counts: contacts, loyalty ledger synced, failed
- [ ] Salespulse: count `loyalty_point_ledger` by day

### P6.4 — Documentation sync

- [ ] Update `LOYALTY-PROGRAM-PHASED-PLAN.md` checkboxes to match completed work
- [ ] Update `docs/contacts-table-data-map.md` with `contact_id` on transactions

### P6.5 — Training SOP (short)

Cashier SOP: “Setiap transaksi member wajib pilih kontak di ikon buku telepon — jangan hanya ketik nama.”

---

## 10. File change index (quick reference for agent)

### marviano-pos — create

| File | Phase | Status |
|------|-------|--------|
| `src/components/LoyaltySettingsPanel.tsx` | P1 | ✅ Created |
| `docs/n8n-member-analytics.md` (or symlink) | P5 | Pending |

### marviano-pos — modify

| File | Phase | Status |
|------|-------|--------|
| `electron/mysqlSchema.ts` | P0, P1 | ✅ P0 |
| `electron/main.ts` | P0–P2 | ✅ P0–P1 |
| `electron/preload.ts` | P1–P2 | ✅ P1 |
| `src/types/electron.d.ts` | P1–P2 | ✅ P1 |
| `src/components/GlobalSettings.tsx` | P1 | ✅ Wired loyalty panel |
| `src/lib/smartSync.ts` | P2 | Pending |
| `src/lib/offlineSync.ts` | P2 | Pending |
| `src/components/PaymentModal.tsx` | P1, P3 | ✅ P1 |
| `src/components/ContactBookPopover.tsx` | P3 | Pending |

### salespulse — create

| File | Phase |
|------|-------|
| `database_migrations/add_loyalty_program.sql` | P2 |
| `database_migrations/create_view_member_product_stats.sql` | P4 |
| `src/app/api/pos/loyalty/ledger/route.ts` | P2 |
| `src/app/api/pos/loyalty/settings/route.ts` | P2 |
| `src/app/api/pos/loyalty/balances/route.ts` | P2 |
| `src/app/api/crm/contacts/[contactId]/loyalty/route.ts` | P4 |
| `src/app/api/analytics/member-product-favorites/route.ts` | P4 |
| `docs/n8n-member-analytics.md` | P5 |

### salespulse — modify

| File | Phase |
|------|-------|
| `src/app/api/sync/route.ts` | P2 |
| `src/middleware.ts` | P2, P4 |
| `src/app/contacts/[contactId]/ContactDetailClient.tsx` | P4 |

---

## 11. Strict agent workflow (step-by-step)

```
START
  → Run Prerequisites §1.1 on VPS (human confirms)
  → Read files §1.3
  → P0 code DONE — P0.4 tests PASS (human)
  → P1 code DONE — P1.4 tests PASS (human)
  → P2 migrations on VPS
  → P2 APIs + POS sync + P2.6 tests PASS
  → ASK USER: verification gate yes/no (P3)
  → P3 if approved
  → P4 CRM + analytics API
  → P5 n8n docs + workflows (user imports)
  → P6 hardening
  → Update schema doc + checkbox docs
END
```

**Stop conditions (escalate to user):**

- `contacts` table missing on local POS DB
- `users.id` type mismatch breaks FK (use signed `INT`)
- Coverage `pct_member` < 10% after 2 weeks — operational issue not code

---

## 12. Definition of Done (program level)

- [x] Kasir can select/add member; `transactions.contact_id` populated on VPS after sync *(pre-existing; P0 hardens remap)*
- [x] Loyalty earn works with settings UI; balances survive restart *(P1 code — verify §P1.4 on device)*
- [ ] Loyalty mirrored on VPS; second POS restores via master download
- [ ] CRM shows read-only points per contact per business
- [ ] n8n can query member product favorites (SQL or analytics API)
- [ ] Documentation and migrations committed in both repos
- [ ] No regression: Smart Sync transactions/refunds still pass existing tests

---

## 13. Out of scope (explicit)

- Point redemption at checkout (Phase 4 in old loyalty doc)
- Cross-org shared wallet
- Point expiry FIFO
- Replacing `deals` with POS items for motor
- Customer-facing mobile app
- Real-time webhook from POS to n8n (optional future; P5 uses poll/SQL)

---

## 14. Open questions for product owner (agent lists in PR)

1. Wajib pilih member di payment atau opsional?
2. Earn hanya untuk member **terverifikasi**?
3. n8n: MySQL langsung vs HTTP analytics API vs keduanya?
4. Loyalty settings: edit hanya di POS atau juga di Salespulse web?
5. Multi-business: satu saldo poin per outlet atau shared org-wide?

**Default if no answer:** optional member; earn without verification gate; both MySQL + API; settings POS-only; points per `(contact_id, business_id)`.

---

*End of implementation plan.*
