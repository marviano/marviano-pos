# How database config works (Login settings)

The app uses **one** MySQL connection for templates, pengaturan konten, and all POS data. Where it connects is decided in this order:

## 1. Priority order

| Priority | Source | When it’s used |
|----------|--------|----------------|
| 1 | **Saved settings** (Login → Settings → Simpan) | Stored in `pos-config.json` (e.g. `%APPDATA%\marviano-pos\pos-config.json`). If **IP Database** (or other fields) were ever saved here, that value is used. |
| 2 | **.env** | If nothing was saved, the app uses `DB_HOST`, `DB_USER`, etc. from the project `.env` file. |
| 3 | **Default** | If `.env` doesn’t set `DB_HOST`, the app uses `localhost`. |

So: **it does NOT default to salespulse.**  
If you never click **Simpan** in Login settings, the app uses **.env**.  
If your `.env` has `DB_HOST=localhost`, the app connects to **localhost**, not salespulse.

## 2. “I left everything blank” — what actually happens?

- **Blank in the form** = what you see in the Login settings fields.
- **What the app uses** = saved file first, then .env, then default.

So:

- If you **never** clicked **Simpan**: there is no saved file (or it’s empty). The app uses **.env** → with `DB_HOST=localhost` it uses **localhost**.
- If you **once** clicked **Simpan** with e.g. salespulse host: that value is in `pos-config.json`. Even if the form later looks blank (e.g. after Reset not clicked), the app still uses that saved host until you click **Reset** or change and save again.

## 3. How to see what the app is using

On the **Login** screen, open the **settings** (gear).  
You’ll see a line like:

**Database yang dipakai saat ini: `host` / `database` (dari pengaturan tersimpan / dari .env / default localhost)**

That line shows the **actual** host and database in use, and whether they come from saved settings, .env, or default.

## 4. Dual-write (template struk tab: localhost + salespulse)

When you **save** pengaturan konten, template struk, or template bill (or set default template), the app writes to **both**:

1. **Primary** — the DB shown as “Database yang dipakai saat ini” (from Login settings / .env).
2. **Mirror** — the other DB: if primary is localhost, mirror is salespulse VPS; if primary is salespulse, mirror is localhost.

So you get the same data on **localhost** and on **salespulse** for those operations.

**To enable dual-write when primary is localhost:** set in `.env`:

- `DB_VPS_HOST` = your salespulse server (e.g. `salespulse.cc` or the VPS IP).
- Optional: `DB_VPS_USER`, `DB_VPS_PASSWORD`, `DB_VPS_NAME`, `DB_VPS_PORT` (defaults: same as `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`).

If `DB_VPS_HOST` is not set and primary is localhost, there is no mirror and saves go only to primary. If primary is salespulse (saved in Login), mirror is always localhost (from .env `DB_*`).

## 5. Summary

- **Default** (no saved config, no `DB_HOST` in .env) = **localhost**.
- **Salespulse** is only used if you saved it in Login settings (and didn’t Reset) or set `DB_HOST` (or equivalent) to salespulse in `.env`.
- **Dual-write:** Saves in the template struk tab go to primary and mirror (localhost + salespulse) when `DB_VPS_HOST` is set (primary localhost) or when primary is salespulse (mirror = localhost).
