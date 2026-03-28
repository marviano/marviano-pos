# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Marviano POS is a restaurant/café point-of-sale system built as an Electron desktop app wrapping a Next.js 15 (React 19) frontend, with local MySQL storage and bidirectional sync to a VPS.

## Commands

```bash
# Development
npm run dev                  # Next.js dev server on port 3000
npm run electron-dev         # Run with Electron (hot reload for renderer, not main process)

# Building
npm run build                # Compile Next.js static export
npm run build-electron       # Compile Electron TypeScript (tsc → dist/electron/)
npm run dist                 # Full production build: tsc → next build → fix paths → electron-builder

# Lint
npm run lint                 # ESLint
```

> After modifying anything in `electron/`, run `npm run build-electron` manually — there is no auto-rebuild in dev mode.

## Architecture

### Two-Process Model (Electron)

```
Renderer Process (Next.js / React)          Main Process (Electron)
src/app/**/*.tsx                            electron/main.ts
src/components/**/*.tsx          IPC        electron/mysqlDb.ts
src/lib/**/*.ts           ◄─────────────►  electron/printerManagement.ts
src/hooks/**/*.ts                           electron/receiptManagement.ts
                                            electron/mysqlSchema.ts
```

The renderer **cannot** access the filesystem or MySQL directly. All DB queries and printing go through IPC handlers defined in `electron/main.ts` and exposed to the renderer via `electron/preload.ts` as `window.electronAPI.*`.

Type definitions for `window.electronAPI` live in `src/types/electron.d.ts`.

### Database Layer

- **`electron/mysqlDb.ts`** — MySQL connection pool manager. Maintains three pools: `salespulse` (primary local), `system_pos` (verification, currently disabled), and a mirror pool for dual-write testing.
- **`electron/mysqlSchema.ts`** — All DDL statements to initialize/migrate the schema on startup.
- Two MySQL databases in use: `salespulse` (primary) and `system_pos` (verification). The `system_pos` pool is currently disabled.

### Sync Architecture

Three-tier sync system, all orchestrated from the renderer via `src/lib/`:

1. **SmartSync** (`src/lib/smartSync.ts`) — Primary bidirectional sync. Batches up to 10 pending transactions every 10 minutes and POSTs to the VPS API. Handles conflict resolution, retries with backoff, and payment method mapping.
2. **OfflineSync** (`src/lib/offlineSync.ts`) — Monitors connectivity. Triggers SmartSync when connection is restored.
3. **SystemPosSync** (`src/lib/systemPosSync.ts`) — Experimental; syncs to `system_pos` DB for receipt audit verification. Currently disabled.

### API Client

`src/lib/api.ts` provides `fetchFromVps(path, options)` — the single HTTP client for all VPS calls. It attaches `X-POS-API-Key`, normalizes the base URL (pulled via IPC from `electron/configManager.ts`), and caches the API URL.

### Next.js Configuration

Next.js is configured with `output: 'export'` (static HTML/CSS/JS) and `assetPrefix: './'` so the build works under Electron's `file://` protocol. Image optimization is disabled for the same reason. The `out/` directory is the static export consumed by Electron.

### Key Components

- **`src/components/POSLayout.tsx`** — Root UI shell: sidebar navigation, modal coordination.
- **`src/components/CenterContent.tsx`** — Order entry and product selection (largest component).
- **`src/components/PaymentModal.tsx`** — Payment processing; calls `window.electronAPI.printReceipt()`.
- **`src/components/KitchenDisplay.tsx` / `BaristaDisplay.tsx`** — Real-time order queues with timers.
- **`src/components/GantiShift.tsx`** — Shift change and cash reconciliation.
- **`electron/printerManagement.ts`** — ESC/POS thermal printer driver.
- **`electron/receiptManagement.ts`** — PDF receipt generation with jsPDF.

## Path Alias

`@/*` maps to `./src/*` in the frontend TypeScript config.

## Environment Variables

Required in `.env`:

```
DB_HOST / DB_USER / DB_PASSWORD / DB_NAME=salespulse
DB_VPS_HOST / DB_VPS_USER / DB_VPS_PASSWORD / DB_VPS_NAME=salespulse
NEXT_PUBLIC_POS_SYNC_API_KEY
NEXT_PUBLIC_POS_WRITE_API_KEY
NEXT_PUBLIC_API_URL
```

## Distribution

`npm run dist` produces a Windows NSIS installer in `dist-electron/`. The build sequence is: compile Electron TypeScript → Next.js static export → `scripts/fix-nested-html-paths.js` (adjusts asset paths) → electron-builder.
