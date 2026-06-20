import {
  belongsOnBaristaDisplay,
  belongsOnKitchenDisplay,
  type KdsProductLike,
} from '@/lib/kdsLaneUtils';
import { formatDateTimeForWib, parseWibTimestampToMs, wibNowSql } from '@/lib/wibDateTime';

/** Current time as MySQL DATETIME in WIB (UTC+7), e.g. `2026-06-20 16:22:50`. */
export function productionNowWib(): string {
  return wibNowSql();
}

/** Latest timestamp among WIB/ISO values; returns WIB MySQL DATETIME string. */
export function maxWibSqlTimestamps(
  timestamps: Array<string | null | undefined>
): string {
  const msValues = timestamps
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map(parseWibTimestampToMs)
    .filter(Number.isFinite);
  if (msValues.length === 0) return productionNowWib();
  return formatDateTimeForWib(new Date(Math.max(...msValues))) ?? productionNowWib();
}

export type ProductionStatus = 'preparing' | 'finished' | 'cancelled' | null;

export function isProductionTerminal(status: unknown): boolean {
  return status === 'finished' || status === 'cancelled';
}

export function isProductionActive(status: unknown): boolean {
  return status === null || status === 'preparing';
}

export function toIsoTimestamp(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return formatDateTimeForWib(value);
  }
  if (typeof value === 'string') {
    return formatDateTimeForWib(value);
  }
  return null;
}

/** Prefer existing started_at; else item created_at; else now. */
export function productionStartedAtIso(
  existingStartedAt?: unknown,
  fallbackCreatedAt?: unknown
): string {
  return (
    toIsoTimestamp(existingStartedAt)
    ?? toIsoTimestamp(fallbackCreatedAt)
    ?? productionNowWib()
  );
}

/** Prevent negative durations when started_at was overwritten after KDS finish (e.g. at payment). */
export function ensureStartedNotAfterFinished(
  startedAt: string,
  finishedAt: string | null,
  itemCreatedAt?: unknown
): string {
  if (!finishedAt) return startedAt;
  const finishMs = parseWibTimestampToMs(finishedAt);
  const startMs = parseWibTimestampToMs(startedAt);
  if (!Number.isFinite(finishMs) || !Number.isFinite(startMs) || startMs <= finishMs) {
    return startedAt;
  }
  const created = toIsoTimestamp(itemCreatedAt);
  if (created) {
    const createdMs = parseWibTimestampToMs(created);
    if (Number.isFinite(createdMs) && createdMs <= finishMs) {
      return created;
    }
  }
  return finishedAt;
}

function finalizeProductionTimestamps(
  fields: {
    production_status: ProductionStatus;
    production_started_at: string | null;
    production_finished_at: string | null;
  },
  itemCreatedAt?: unknown
): {
  production_status: ProductionStatus;
  production_started_at: string | null;
  production_finished_at: string | null;
} {
  if (!fields.production_started_at || !fields.production_finished_at) {
    return fields;
  }
  return {
    ...fields,
    production_started_at: ensureStartedNotAfterFinished(
      fields.production_started_at,
      fields.production_finished_at,
      itemCreatedAt
    ),
  };
}

export function belongsOnAnyProductionDisplay(product: KdsProductLike): boolean {
  return belongsOnKitchenDisplay(product) || belongsOnBaristaDisplay(product);
}

/** When item first appears on KDS / broadcast from kasir. */
export function markSentToProductionDisplay(existing: {
  production_status?: unknown;
  production_started_at?: unknown;
  production_finished_at?: unknown;
  created_at?: unknown;
}): {
  production_status: ProductionStatus;
  production_started_at: string | null;
  production_finished_at: string | null;
} {
  if (isProductionTerminal(existing.production_status)) {
    return {
      production_status: existing.production_status as ProductionStatus,
      production_started_at: productionStartedAtIso(
        existing.production_started_at,
        existing.created_at
      ),
      production_finished_at: toIsoTimestamp(existing.production_finished_at),
    };
  }

  if (existing.production_status === 'preparing') {
    return {
      production_status: 'preparing',
      production_started_at: productionStartedAtIso(
        existing.production_started_at,
        existing.created_at
      ),
      production_finished_at: null,
    };
  }

  return {
    production_status: 'preparing',
    production_started_at: productionStartedAtIso(null, existing.created_at),
    production_finished_at: null,
  };
}

/** Preserve DB production fields when re-saving cart/payment lines. */
export function resolveProductionFieldsForSave(
  existing: {
    production_status?: unknown;
    production_started_at?: unknown;
    production_finished_at?: unknown;
  },
  options: {
    created_at?: unknown;
    item_created_at?: unknown;
    trackOnProductionDisplay: boolean;
    markPreparingIfUnset?: boolean;
  }
): {
  production_status: ProductionStatus;
  production_started_at: string | null;
  production_finished_at: string | null;
} {
  const itemCreatedAt = options.item_created_at ?? options.created_at;
  const status = (typeof existing.production_status === 'string'
    ? existing.production_status
    : null) as ProductionStatus;

  if (isProductionTerminal(status)) {
    return finalizeProductionTimestamps(
      {
        production_status: status,
        production_started_at: productionStartedAtIso(
          existing.production_started_at,
          itemCreatedAt
        ),
        production_finished_at: toIsoTimestamp(existing.production_finished_at),
      },
      itemCreatedAt
    );
  }

  if (status === 'preparing') {
    const finishedAt = toIsoTimestamp(existing.production_finished_at);
    return finalizeProductionTimestamps(
      {
        production_status: 'preparing',
        production_started_at: productionStartedAtIso(
          existing.production_started_at,
          itemCreatedAt
        ),
        production_finished_at: finishedAt,
      },
      itemCreatedAt
    );
  }

  if (options.markPreparingIfUnset && options.trackOnProductionDisplay) {
    return markSentToProductionDisplay({
      production_status: null,
      production_started_at: null,
      created_at: options.created_at,
    });
  }

  return {
    production_status: null,
    production_started_at: null,
    production_finished_at: null,
  };
}

/** New line on Simpan Order / Tambah Order — start timer when routed to KDS. */
export function productionFieldsForNewKdsItem(
  product: KdsProductLike,
  createdAt?: unknown
): {
  production_status: ProductionStatus;
  production_started_at: string | null;
  production_finished_at: string | null;
} {
  const trackOnProductionDisplay = belongsOnAnyProductionDisplay(product);
  return resolveProductionFieldsForSave(
    {},
    {
      created_at: createdAt,
      trackOnProductionDisplay,
      markPreparingIfUnset: trackOnProductionDisplay,
    }
  );
}

/** When staff taps selesai on KDS / barista. */
export function markProductionFinished(existing: {
  production_started_at?: unknown;
  created_at?: unknown;
}): {
  production_status: 'finished';
  production_started_at: string;
  production_finished_at: string;
} {
  const finishedAt = productionNowWib();
  const startedAt = ensureStartedNotAfterFinished(
    productionStartedAtIso(existing.production_started_at, existing.created_at),
    finishedAt,
    existing.created_at
  );
  return {
    production_status: 'finished',
    production_started_at: startedAt,
    production_finished_at: finishedAt,
  };
}

export type TransactionItemUpsertRow = Record<string, unknown>;

/** Backfill started_at for active KDS rows that still have NULL (legacy / missed paths). */
export function buildProductionStartBackfillRow(
  item: Record<string, unknown>
): TransactionItemUpsertRow | null {
  const status = typeof item.production_status === 'string' ? item.production_status : null;
  if (isProductionTerminal(status)) return null;
  if (toIsoTimestamp(item.production_started_at)) return null;

  const marked = markSentToProductionDisplay({
    production_status: status,
    production_started_at: item.production_started_at,
    created_at: item.created_at,
  });

  return {
    id: item.id,
    uuid_id: item.uuid_id ?? item.id,
    transaction_id: item.transaction_id ?? 0,
    uuid_transaction_id: item.uuid_transaction_id,
    product_id: item.product_id,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.total_price,
    custom_note: item.custom_note ?? null,
    bundle_selections_json: item.bundle_selections_json ?? null,
    package_selections_json: item.package_selections_json ?? null,
    created_at: item.created_at,
    waiter_id: item.waiter_id ?? null,
    production_status: marked.production_status,
    production_started_at: marked.production_started_at,
    production_finished_at: marked.production_finished_at,
  };
}

/** Persist parent line when all package sub-lines are finished. */
export async function persistPackageParentFinished(
  electronAPI: {
    localDbGetTransactionItems?: (txId: string) => Promise<unknown>;
    localDbUpsertTransactionItems?: (rows: unknown[]) => Promise<unknown>;
  },
  transactionUuid: string,
  parentItemUuid: string,
  productionFinishedAt: string
): Promise<void> {
  if (!electronAPI.localDbGetTransactionItems || !electronAPI.localDbUpsertTransactionItems) {
    return;
  }

  const items = await electronAPI.localDbGetTransactionItems(transactionUuid);
  const itemsArray = Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
  const parent = itemsArray.find((ti) => {
    const id = ti.uuid_id ?? ti.id;
    return id != null && String(id).trim() === String(parentItemUuid).trim();
  });
  if (!parent || parent.production_status === 'finished') return;

  const finished = markProductionFinished({
    production_started_at: parent.production_started_at,
    created_at: parent.created_at,
  });

  await electronAPI.localDbUpsertTransactionItems([{
    id: parent.id,
    uuid_id: parent.uuid_id ?? parent.id,
    transaction_id: parent.transaction_id ?? 0,
    uuid_transaction_id: parent.uuid_transaction_id ?? transactionUuid,
    product_id: parent.product_id,
    quantity: parent.quantity,
    unit_price: parent.unit_price,
    total_price: parent.total_price,
    custom_note: parent.custom_note ?? null,
    bundle_selections_json: parent.bundle_selections_json ?? null,
    package_selections_json: parent.package_selections_json ?? null,
    created_at: parent.created_at,
    waiter_id: parent.waiter_id ?? null,
    production_status: 'finished',
    production_started_at: finished.production_started_at,
    production_finished_at: productionFinishedAt || finished.production_finished_at,
  }]);
}

/** Re-apply authoritative production fields from DB before payment upsert (avoids stale cart snapshot). */
export function mergeProductionFieldsFromDb(
  transactionItems: Array<Record<string, unknown>>,
  freshDbItems: Record<string, unknown>[]
): void {
  const byUuid = new Map<string, Record<string, unknown>>();
  for (const row of freshDbItems) {
    const uid = row.uuid_id ?? row.id;
    if (uid != null) byUuid.set(String(uid).trim(), row);
  }

  for (const ti of transactionItems) {
    const uid = ti.uuid_id ?? ti.id;
    if (uid == null) continue;
    const fresh = byUuid.get(String(uid).trim());
    if (!fresh) continue;

    const freshStatus = typeof fresh.production_status === 'string' ? fresh.production_status : null;
    const freshFinished = toIsoTimestamp(fresh.production_finished_at);
    const freshStarted = toIsoTimestamp(fresh.production_started_at);
    const itemCreated = fresh.created_at ?? ti.created_at;

    if (freshFinished || isProductionTerminal(freshStatus)) {
      ti.production_status = freshStatus ?? 'finished';
      ti.production_started_at = ensureStartedNotAfterFinished(
        productionStartedAtIso(freshStarted, itemCreated),
        freshFinished,
        itemCreated
      );
      ti.production_finished_at = freshFinished;
      continue;
    }

    if (freshStatus === 'preparing' && freshStarted) {
      ti.production_status = 'preparing';
      ti.production_started_at = freshStarted;
      ti.production_finished_at = null;
    }
  }
}
