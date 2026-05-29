/**
 * Kitchen/Barista display audit trail — local POS MySQL only (not synced to VPS).
 */

export type KdsDisplayType = 'kitchen' | 'barista';

export type KdsAuditEventType =
  | 'active_shown'
  | 'finished_shown'
  | 'marked_finished'
  | 'excluded_cancelled'
  | 'excluded_category'
  | 'excluded_no_product';

export interface KdsAuditLogEntry {
  uuid_id: string;
  business_id: number;
  uuid_transaction_id: string;
  uuid_transaction_item_id: string;
  display_type: KdsDisplayType;
  event_type: KdsAuditEventType;
  product_id?: number | null;
  product_name?: string | null;
  customer_name?: string | null;
  table_number?: string | null;
  detail_json?: Record<string, unknown> | null;
  event_at: string;
}

function getElectronAPI() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

function newEventUuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `kds-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Append audit events (deduped per item+display+event_type on DB). Fire-and-forget. */
export function appendKdsAuditEvents(entries: Omit<KdsAuditLogEntry, 'uuid_id'>[]): void {
  const api = getElectronAPI() as { kdsAuditAppend?: (rows: KdsAuditLogEntry[]) => Promise<unknown> } | undefined;
  if (!api?.kdsAuditAppend || entries.length === 0) return;

  const rows: KdsAuditLogEntry[] = entries.map((e) => ({
    ...e,
    uuid_id: newEventUuid(),
    event_at: e.event_at || new Date().toISOString(),
  }));

  void api.kdsAuditAppend(rows).catch((err) => {
    console.warn('[KDS audit] append failed:', err);
  });
}

export function appendKdsAuditEvent(entry: Omit<KdsAuditLogEntry, 'uuid_id'>): void {
  appendKdsAuditEvents([entry]);
}

const loggedSessionKeys = new Set<string>();

/** Log once per session per item+display+event (DB also dedupes via UNIQUE). */
export function logKdsAuditOnce(entry: Omit<KdsAuditLogEntry, 'uuid_id'>): void {
  if (!entry.uuid_transaction_item_id || !entry.event_type) return;
  const key = `${entry.uuid_transaction_item_id}|${entry.display_type}|${entry.event_type}`;
  if (loggedSessionKeys.has(key)) return;
  loggedSessionKeys.add(key);
  appendKdsAuditEvent(entry);
}
