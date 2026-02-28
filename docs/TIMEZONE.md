# Timezone behaviour (UTC+7 / WIB)

**Short answer:** The system does **not** use UTC+7 everywhere. Pictos local DB uses **WIB**; payloads to salespulse and API date ranges use **UTC**.

| Component | Timezone | Where / How |
|-----------|----------|-------------|
| **Pictos local DB (Electron)** | **UTC+7 (WIB)** | `electron/mysqlDb.ts` → `toMySQLDateTime()` adds 7 hours to UTC and formats as `YYYY-MM-DD HH:MM:SS`. All local reads/writes and date-range filters use this. |
| **Date picker → API range** | **UTC** (WIB day as UTC) | `SyncManagement` → `normalizeDateInput()` treats "Dari/Sampai" as **WIB** calendar day and converts to UTC ISO (`fromIso`/`toIso`) for match-check and local range. So the *meaning* is WIB; the *values* sent are UTC. |
| **Payload to salespulse (upsert)** | **UTC** | `src/lib/syncUtils.ts` → `convertDateForMySQL()` uses `date.toISOString().slice(0,19).replace('T',' ')`. So `created_at` / `updated_at` sent to salespulse are in **UTC**. |
| **salespulse MySQL** | Depends on DB | Server stores whatever is sent. If you send UTC strings and the session timezone is UTC, stored values are UTC. Check your MySQL `@@session.time_zone` on the VPS to be sure. |

## How to verify at runtime

1. Run **Verifikasi data** with a date range (Sinkronisasi page).
2. Check the debug log (e.g. `debug-0bbb61.log` or your session log). Look for:
   - **`Timezone audit`**: States `pictosLocalDb` = WIB, `payloadToSalespulse` = UTC, `dateRangeToApi` = UTC, and a `sampleSameInstant` (same moment in WIB vs UTC).
   - **`Local match-data date filter and result bounds`**: Includes `timezone: 'UTC+7 (WIB) - toMySQLDateTime used for query bounds'` and `mysqlStart` / `mysqlEnd` in WIB.

So: **only the Pictos local DB (Electron) is explicitly UTC+7**. The rest uses UTC (with date ranges representing WIB calendar days as UTC bounds).
