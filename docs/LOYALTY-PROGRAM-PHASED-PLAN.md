# Loyalty Program — Phased Implementation Plan

**Status:** Planning (not implemented)  
**Last updated:** 2026-05-19  
**Repos:** `marviano-pos` (source of truth), `salespulse` (backup + CRM read)

---

## 1. Goals & non-goals

### Goals

- Cashier selects a **contact** at checkout; `transactions.contact_id` is stored (already wired).
- Customer earns **loyalty points** based on configurable rules (e.g. Rp 50.000 = 1 point on `final_amount`).
- Works **fully offline**; points and balance live in POS SQLite.
- **Smart Sync** uploads loyalty data to Salespulse VPS (backup), same pattern as transactions.
- New POS devices can **bootstrap** loyalty settings + history from VPS via master download.
- Production qualities: idempotent ledger (`uuid_id`), refund reversals, `contact_id` remap after contact sync.

### Non-goals (later phases)

- Cross-organization shared points (one wallet for all brands).
- Point expiry / FIFO batches (Phase 5+).
- Customer-facing app / WA notifications.
- Server-side earn calculation on VPS (VPS must **not** recalculate on upload).

---

## 2. Architecture principles

| Layer | Role |
|-------|------|
| **POS SQLite** | Authoritative: settings, ledger, balances, earn on pay |
| **Smart Sync** | Upload `sync_status IN ('pending','failed')` |
| **Salespulse MySQL** | Backup mirror: `INSERT … ON DUPLICATE KEY UPDATE` by `uuid_id` |
| **Salespulse UI** | Read-only CRM/reporting on backup (Phase 3); settings edit on web optional later |

### Sync order (mandatory)

1. Pending **contacts** (remap local `contact_id` → server id)  
2. Pending **transactions**  
3. Pending **loyalty ledger** (+ settings, balances)  

### Earn formula (default MVP)

```
points = floor(earn_basis_amount / rupiah_per_point)
```

- `earn_basis_amount` = `final_amount` (configurable later to `total_amount`).
- Skip if `!is_enabled`, `contact_id` null, `points < 1`, or below `min_earn_amount`.

---

## 3. Data model summary

### 3.1 POS SQLite (marviano-pos)

**`loyalty_program_settings`** — one row per `business_id`

| Column | Notes |
|--------|--------|
| `business_id` | PK |
| `is_enabled` | TINYINT |
| `rupiah_per_point` | INT, e.g. 50000 |
| `earn_basis` | `final_amount` \| `total_amount` |
| `min_earn_amount` | DECIMAL, default 0 |
| `rounding_mode` | `floor` (MVP only) |
| `updated_at` | |
| `sync_status` | pending \| synced \| failed |

**`loyalty_point_ledger`** — append-only

| Column | Notes |
|--------|--------|
| `uuid_id` | PK (CHAR 36) |
| `business_id`, `contact_id` | |
| `entry_type` | earn \| reverse_earn \| redeem \| adjust |
| `points_delta` | INT (+/-) |
| `balance_after` | INT snapshot |
| `source_type` | transaction \| refund \| manual |
| `source_id` | e.g. `transactions.uuid_id` |
| `rupiah_basis` | DECIMAL |
| `note` | TEXT nullable |
| `created_by_email` | VARCHAR |
| `created_at` | |
| `sync_status`, `sync_attempts`, `synced_at`, `last_sync_error` | same as transactions |

**Unique (local):** `(business_id, source_type, source_id, entry_type)` for earn / reverse_earn.

**`contact_loyalty_balances`** — cache for fast UI

| Column | Notes |
|--------|--------|
| `contact_id`, `business_id` | PK |
| `points_balance` | INT ≥ 0 |
| `lifetime_earned` | INT optional |
| `updated_at` | |
| `sync_status` | optional |

### 3.2 Salespulse VPS MySQL (backup)

Mirror tables with same logical columns + `synced_from_pos_at` (optional).  
No server-side earn on `POST` upload — store payload as sent.

### 3.3 Existing tables (unchanged)

- `contacts`, `contact_businesses` — member identity per outlet  
- `transactions.contact_id` — link payment → contact for earn  

---

## 4. Phase overview

| Phase | Name | Outcome |
|-------|------|---------|
| **0** | Contact UX + transaction link | Terpilih + phone; `contact_id` verified end-to-end |
| **1** | Local loyalty core | Offline earn + balance + settings (POS only) |
| **2** | Sync to VPS (backup) | Smart Sync + POS APIs + master download |
| **3** | CRM & reporting | Salespulse read backup; optional settings UI |
| **4** | Redeem at POS | Spend points on checkout |
| **5** | Hardening & ops | Multi-device, refunds edge cases, monitoring |

---

## Phase 0 — Contact UX & transaction link

**Goal:** Cashier workflow solid before points.

**Scope:** `marviano-pos` only.

### Deliverables

- [ ] Payment modal: state `selectedContact: { id, nama, phone_number } | null`
- [ ] Label **Terpilih** + display name + formatted phone (62…)
- [ ] 👥 button highlighted when contact selected
- [ ] Confirm new contact auto-selects after save (already via `onSelect`; verify UX)
- [ ] Smoke test: pay with contact → local `transactions.contact_id` populated
- [ ] Smoke test: Smart Sync → VPS `transactions.contact_id` populated

### Acceptance criteria

- Cashier sees who is selected without opening popover again.
- Transaction list / DB row shows correct `contact_id` after pay.

### Dependencies

- `contact_businesses` migrations on VPS (already planned).
- Contact sync + remap working.

### Estimate

1–2 days.

---

## Phase 1 — Local loyalty core (offline-first)

**Goal:** Points work with no internet.

**Scope:** `marviano-pos` (Electron + PaymentModal).

### Deliverables

#### 1.1 Schema

- [ ] Create tables in `electron/main.ts` (`ensureLoyaltyTables`) + `electron/mysqlSchema.ts` if used
- [ ] Default row `loyalty_program_settings` per business on first run (disabled, `rupiah_per_point = 50000`)

#### 1.2 Loyalty engine (main process)

- [ ] `loyaltyEarnForTransaction({ uuid_id, business_id, contact_id, final_amount, total_amount, created_by_email })`
  - Read settings; compute points; insert ledger + update balance in **one SQL transaction**
  - Idempotent: skip if earn row already exists for `source_id`
- [ ] `loyaltyReverseForRefund({ … })` — stub hook for Phase 5; optional no-op in Phase 1
- [ ] IPC: `localdb-get-loyalty-settings`, `localdb-upsert-loyalty-settings`
- [ ] IPC: `localdb-get-contact-loyalty-balance`, `localdb-get-loyalty-ledger` (paginated)
- [ ] Remap: extend `localdb-remap-contact-id` to update ledger + balances

#### 1.3 Payment integration

- [ ] After successful local transaction save, call `loyaltyEarnForTransaction` if `contact_id` set
- [ ] Payment modal: show balance when contact selected (“Saldo: N poin”)
- [ ] Types in `src/types/electron.d.ts` + `preload.ts`

#### 1.4 Settings UI (minimal)

- [ ] POS Settings screen section: enable/disable, Rp per point, earn basis
- [ ] Saves to SQLite; `sync_status = 'pending'` (upload in Phase 2)

### Acceptance criteria

- Outlet offline: pay Rp 100.000 with contact, settings 50k/point → balance +2 locally.
- Second pay same contact → balance +N cumulative.
- Pay without contact → no ledger row.
- Disabled program → no earn.
- Restart app → balance unchanged.

### Out of scope

- VPS upload, CRM, redeem.

### Estimate

4–6 days.

---

## Phase 2 — Sync to Salespulse (backup)

**Goal:** VPS holds copy of loyalty data; new POS can restore.

**Scope:** `marviano-pos` + `salespulse`.

### Deliverables

#### 2.1 VPS migrations (`salespulse/database_migrations/`)

- [ ] `loyalty_program_settings`
- [ ] `loyalty_point_ledger` (PK `uuid_id`)
- [ ] `contact_loyalty_balances`
- [ ] Update `salespulse_vps_db-schema.md` after deploy

#### 2.2 POS write APIs (`salespulse`)

- [ ] `POST /api/pos/loyalty/ledger` — batch upsert by `uuid_id`, `requirePosWriteAuth`
- [ ] `PUT /api/pos/loyalty/settings` — upsert per `business_id`
- [ ] `PUT /api/pos/loyalty/balances` — optional batch upsert (or CRM derives from ledger)

#### 2.3 Master download

- [ ] Extend `GET /api/sync` → `loyalty_program_settings`, `loyalty_point_ledger`, `contact_loyalty_balances` filtered by `business_id`
- [ ] `offlineSync.ts`: apply to SQLite (upsert, preserve local pending if newer — policy: **VPS rows only fill missing uuid** or full merge doc in SYNC-SCENARIOS.md)

#### 2.4 Smart Sync (`marviano-pos`)

- [ ] `syncPendingLoyaltySettings()`
- [ ] `syncPendingLoyaltyLedger()` — batches, mark synced/failed
- [ ] Run after contacts + transactions in sync loop
- [ ] `localdb-get-pending-loyalty-*`, mark synced/failed handlers

#### 2.5 Conflict policy (document & implement)

- **Ledger:** `uuid_id` wins; duplicate upload = no-op update (same values).
- **Settings:** POS `updated_at` newer → upload overwrites VPS; on download, only apply VPS settings if local row missing.
- **Balances:** Upload from POS; VPS may recompute for CRM display as `SUM(ledger)` validation job (optional).

### Acceptance criteria

- Pay offline → go online → Smart Sync → rows visible in VPS tables.
- Second POS login + master download → sees balances/ledger from backup.
- Re-upload same ledger uuid → no duplicate points on VPS.

### Estimate

5–7 days.

---

## Phase 3 — CRM & reporting (Salespulse)

**Goal:** HQ sees loyalty backup; no write that bypasses POS (MVP).

**Scope:** `salespulse`.

### Deliverables

- [ ] CRM contact detail: points balance + last 20 ledger entries (from backup tables)
- [ ] Members list: optional column “Poin” (per business)
- [ ] Settings page (read-only MVP): show synced settings per business
- [ ] Fix unrelated build blocker if needed (`crm/page.tsx` `FlattenedContact` type)

### Acceptance criteria

- After Phase 2 sync, CRM shows same balance as POS for that contact/outlet.

### Out of scope

- Editing points from web (use Phase 4 `adjust` from POS only, or Phase 5).

### Estimate

3–4 days.

---

## Phase 4 — Redeem at POS

**Goal:** Customer spends points on checkout.

**Scope:** `marviano-pos` + backup APIs.

### Deliverables

#### 4.1 Settings extension

- [ ] `points_per_rupiah_redeem` or `redeem_rupiah_per_point` (e.g. 1 poin = Rp 1.000 discount)
- [ ] `min_redeem_points`, `max_redeem_percent_of_order` (optional cap)

#### 4.2 Payment modal

- [ ] “Pakai poin” toggle + input points (max = min(balance, order cap))
- [ ] Apply as voucher-like discount on `final_amount` (document interaction with existing voucher)
- [ ] Ledger `redeem` entry linked to `transaction uuid`
- [ ] Sync redeem rows in Phase 2 pipeline

#### 4.3 VPS

- [ ] Backup redeem entries; CRM shows redemptions

### Acceptance criteria

- Balance decreases locally; transaction `final_amount` reflects discount; backup on VPS after sync.

### Estimate

5–8 days.

---

## Phase 5 — Hardening & operations

**Goal:** Production safety net.

### Deliverables

- [ ] **Refund:** full/partial → `reverse_earn` proportional to refunded amount; idempotent per refund uuid
- [ ] **Multi-POS:** document expected behavior (balances merge via ledger sum on VPS)
- [ ] **Monitoring:** count `loyalty_point_ledger` where `sync_status = failed`; POS sync UI indicator
- [ ] **Reconciliation job (optional):** VPS script compares `SUM(ledger)` vs `contact_loyalty_balances` for alerts
- [ ] **ImportantQuery.md:** sample SQL for support
- [ ] **Tests:** unit tests for point calculation; integration test earn + sync mock

### Acceptance criteria

- Full refund removes earned points for that transaction (within rounding rules).
- No duplicate earn on transaction re-sync.

### Estimate

4–6 days.

---

## 5. Product decisions (lock before Phase 1)

| # | Decision | Recommended default |
|---|----------|---------------------|
| 1 | Earn basis | `final_amount` after voucher |
| 2 | Points scope | Per `business_id` (outlet), not org-wide |
| 3 | Pay without contact | No points |
| 4 | Historical transactions | No backfill |
| 5 | Who edits settings | POS only in Phases 1–3 |
| 6 | VPS on upload | Store only; never recalculate earn |

---

## 6. Testing checklist (all phases)

### Offline

- [ ] Earn with contact, no network  
- [ ] Balance correct after app restart  
- [ ] Duplicate pay attempt same uuid → single earn  

### Online / sync

- [ ] Ledger appears on VPS  
- [ ] Contact remap updates ledger `contact_id`  
- [ ] Failed sync retries  

### UI

- [ ] Terpilih + phone  
- [ ] Balance visible when contact selected  
- [ ] Settings change affects next transaction only  

---

## 7. Rollout

1. Run VPS migrations (Phase 2) on staging → production.  
2. Deploy Salespulse API.  
3. Ship marviano-pos Phase 0 → 1 to pilot outlet (Momoyo).  
4. Enable loyalty in POS settings (`is_enabled = 1`).  
5. Enable Phase 2 sync; verify CRM (Phase 3).  
6. Redeem (Phase 4) when earn stable 2+ weeks.  

---

## 8. File touch map (reference)

| Area | marviano-pos | salespulse |
|------|----------------|------------|
| Schema | `electron/main.ts`, `mysqlSchema.ts` | `database_migrations/add_loyalty_*.sql` |
| Pay flow | `PaymentModal.tsx` | — |
| Sync | `smartSync.ts`, `offlineSync.ts` | `api/sync/route.ts` |
| APIs | `preload.ts`, `electron.d.ts` | `api/pos/loyalty/*` |
| Settings UI | POS settings page | CRM read (Phase 3) |
| Docs | this file, `SYNC-SCENARIOS.md` | `README` migrations |

---

## 9. Timeline (indicative)

| Phase | Duration | Cumulative |
|-------|----------|------------|
| 0 | 1–2 d | ~2 d |
| 1 | 4–6 d | ~8 d |
| 2 | 5–7 d | ~15 d |
| 3 | 3–4 d | ~19 d |
| 4 | 5–8 d | ~27 d |
| 5 | 4–6 d | ~33 d |

Parallel work possible: Phase 3 can start when Phase 2 APIs exist.

---

## 10. Open questions

1. Should redeem reduce earn basis for the same transaction (earn on pre-redeem amount vs post-redeem)?  
2. Include City Ledger / comp payment methods in earn?  
3. Show points on printed receipt?  
4. Organization admin: one settings template pushed to all outlets?

Resolve in Phase 0/1 planning meeting before coding Phase 1.
