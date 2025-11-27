type UnknownRecord = Record<string, unknown>;

type ElectronAPI = UnknownRecord;

const parseEpoch = (entry: UnknownRecord | null | undefined): number | null => {
  if (!entry) return null;
  const epoch = Number(entry.printed_at_epoch);
  if (Number.isFinite(epoch) && epoch > 0) {
    return epoch;
  }
  if (entry.printed_at && typeof entry.printed_at === 'string') {
    const parsed = Date.parse(entry.printed_at);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
};

const buildDailyCounters = (
  audits: UnknownRecord[],
  counterField: string,
  printerType: string,
  businessId: number
): Array<{ printer_type: string; business_id: number; date: string; counter: number }> => {
  if (!Array.isArray(audits) || audits.length === 0) return [];

  const map = new Map<string, number>();
  for (const audit of audits) {
    const counterValue = Number(audit?.[counterField]);
    if (!Number.isFinite(counterValue) || counterValue <= 0) continue;

    const epoch = parseEpoch(audit);
    if (!epoch) continue;

    // Convert epoch to GMT+7 date (not UTC) to match local business day
    const date = new Date(epoch);
    const utc7Time = new Date(date.getTime() + (7 * 60 * 60 * 1000));
    const dateKey = utc7Time.toISOString().split('T')[0];
    const current = map.get(dateKey);
    if (current == null || counterValue > current) {
      map.set(dateKey, counterValue);
    }
  }

  return Array.from(map.entries()).map(([date, counter]) => ({
    printer_type: printerType,
    business_id: businessId,
    date,
    counter,
  }));
};

/**
 * Restore local printer audit logs and daily counters from cloud sync payload.
 */
export const restorePrinterStateFromCloud = async (
  data: UnknownRecord,
  electronAPI: ElectronAPI,
  businessId: number
) => {
  if (!electronAPI) return;

  const printer1Audits: UnknownRecord[] = Array.isArray(data?.printer1Audits) ? data.printer1Audits as UnknownRecord[] : [];
  const printer2Audits: UnknownRecord[] = Array.isArray(data?.printer2Audits) ? data.printer2Audits as UnknownRecord[] : [];

  try {
    if (printer1Audits.length && electronAPI?.localDbUpsertPrinterAudits) {
      await (electronAPI.localDbUpsertPrinterAudits as (printerType: string, audits: unknown[]) => Promise<{ success: boolean }>)('receipt', printer1Audits);
    }
  } catch (error) {
    console.error('[SYNC] Failed to upsert printer1 audits:', error);
  }

  try {
    if (printer2Audits.length && electronAPI?.localDbUpsertPrinterAudits) {
      await (electronAPI.localDbUpsertPrinterAudits as (printerType: string, audits: unknown[]) => Promise<{ success: boolean }>)('receiptize', printer2Audits);
    }
  } catch (error) {
    console.error('[SYNC] Failed to upsert printer2 audits:', error);
  }

  const counters: Array<{ printer_type: string; business_id: number; date: string; counter: number }> = [];
  counters.push(
    ...buildDailyCounters(printer1Audits, 'printer1_receipt_number', 'receiptPrinter', businessId)
  );
  counters.push(
    ...buildDailyCounters(printer2Audits, 'printer2_receipt_number', 'receiptizePrinter', businessId)
  );
  counters.push(
    ...buildDailyCounters(
      [...printer1Audits, ...printer2Audits],
      'global_counter',
      'globalPrinter',
      businessId
    )
  );

  if (counters.length && electronAPI?.localDbUpsertPrinterDailyCounters) {
    try {
      await (electronAPI.localDbUpsertPrinterDailyCounters as (counters: unknown[]) => Promise<{ success: boolean }>)(counters);
    } catch (error) {
      console.error('[SYNC] Failed to upsert printer daily counters:', error);
    }
  }
};

