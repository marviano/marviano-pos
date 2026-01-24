import { query } from './db';

const FALLBACK_PAYMENT_METHODS: Record<string, { name: string; description?: string }> = {
  qpon: {
    name: 'Qpon',
    description: 'Qpon Online Order'
  }
};

async function ensurePaymentMethodExists(paymentMethodCode: string, businessId?: number) {
  const fallback = FALLBACK_PAYMENT_METHODS[paymentMethodCode];
  if (!fallback) {
    return;
  }

  const columns = await query<Array<{ Field: string; Null: 'YES' | 'NO'; Extra: string }>>('SHOW COLUMNS FROM payment_methods');
  const referenceRows = await query<Array<Record<string, unknown>>>('SELECT * FROM payment_methods LIMIT 1');
  const referenceRow = referenceRows.length > 0 ? referenceRows[0] : {} as Record<string, unknown>;

  const insertColumns: string[] = [];
  const insertValues: (string | number | null | Date)[] = [];

  const now = new Date();

  for (const column of columns) {
    const name = column.Field;

    if (column.Extra && column.Extra.includes('auto_increment')) {
      continue;
    }

    let value: string | number | null | Date;
    switch (name) {
      case 'code':
        value = paymentMethodCode;
        break;
      case 'name':
        value = fallback.name;
        break;
      case 'description':
        value = fallback.description ?? (referenceRow[name] as string | undefined) ?? null;
        break;
      case 'is_active':
        value = 1;
        break;
      case 'requires_additional_info':
        value = 0;
        break;
      case 'created_at':
      case 'updated_at':
        value = now;
        break;
      case 'business_id':
        value = (businessId ?? (referenceRow[name] as number | undefined)) ?? null;
        if (value === undefined || value === null) {
          throw new Error('Business ID is required for payment method');
        }
        break;
      case 'organization_id':
        value = (referenceRow[name] as number | undefined) ?? businessId ?? null;
        break;
      default:
        value = (referenceRow[name] as string | number | null | undefined) ?? (column.Null === 'YES' ? null : 0);
        break;
    }

    insertColumns.push(name);
    insertValues.push(value);
  }

  if (insertColumns.length === 0) {
    return;
  }

  const placeholders = insertColumns.map(() => '?').join(', ');

  try {
    await query(
      `INSERT INTO payment_methods (${insertColumns.join(', ')}) VALUES (${placeholders})`,
      insertValues as (string | number | null)[]
    );
  } catch (error: unknown) {
    const err = error as { message?: string };
    const message = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
    if (!message.includes('duplicate')) {
      throw error;
    }
  }
}

// Helper function to get payment method ID by code
export async function getPaymentMethodId(paymentMethodCode: string, businessId?: number): Promise<number> {
  let result = await query<{ id: number }[]>(
    'SELECT id FROM payment_methods WHERE code = ? AND is_active = 1',
    [paymentMethodCode] as (string | number)[]
  );

  if (result.length === 0) {
    await ensurePaymentMethodExists(paymentMethodCode, businessId);
    result = await query<{ id: number }[]>(
      'SELECT id FROM payment_methods WHERE code = ? AND is_active = 1',
      [paymentMethodCode] as (string | number)[]
    );
  }

  if (result.length === 0) {
    throw new Error(`Payment method '${paymentMethodCode}' not found`);
  }

  return result[0].id;
}

// Helper function to get payment method code by ID
export async function getPaymentMethodCode(paymentMethodId: number): Promise<string> {
  const result = await query<{ code: string }[]>(
    'SELECT code FROM payment_methods WHERE id = ? AND is_active = 1',
    [paymentMethodId] as (string | number)[]
  );

  if (result.length === 0) {
    throw new Error(`Payment method ID '${paymentMethodId}' not found`);
  }

  return result[0].code;
}
