import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

const toMysqlDateTime = (iso?: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

const RESET_PRINTER_COUNTERS_SQL = `
  DELETE FROM printer_daily_counters
  WHERE business_id = ?
`;

export async function POST(request: NextRequest) {
  try {
    const { business_id, from, to } = await request.json();
    
    if (!business_id) {
      return NextResponse.json(
        { error: 'Business ID is required' },
        { status: 400 }
      );
    }

    const startMysql = toMysqlDateTime(from);
    const endMysql = toMysqlDateTime(to);

    const buildWhereClause = (alias?: string) => {
      const prefix = alias ? `${alias}.` : '';
      const clauseParts = [`${prefix}business_id = ?`];
      const params: any[] = [business_id];

      if (startMysql) {
        clauseParts.push(`${prefix}created_at >= ?`);
        params.push(startMysql);
      }
      if (endMysql) {
        clauseParts.push(`${prefix}created_at <= ?`);
        params.push(endMysql);
      }

      return { clause: clauseParts.join(' AND '), params };
    };

    const { clause: aliasClause, params: aliasParams } = buildWhereClause('t');

    // First delete transaction items
    await query(`
      DELETE ti FROM transaction_items ti
      INNER JOIN transactions t ON ti.uuid_transaction_id = t.uuid_id
      WHERE ${aliasClause}
    `, aliasParams);

  // Then delete printer audits (skip if table doesn't exist)
  try {
    await query(`
      DELETE pa FROM printer_audits pa
      INNER JOIN transactions t ON pa.transaction_uuid = t.uuid_id
      WHERE ${aliasClause}
    `, aliasParams);
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (!msg.includes("doesn't exist") && !msg.toLowerCase().includes('no such table')) {
      throw e;
    }
  }

    const { clause: baseClause, params } = buildWhereClause();

    // Then delete transactions
    const result = await query(`
      DELETE FROM transactions 
      WHERE ${baseClause}
    `, params);

    try {
      await query(RESET_PRINTER_COUNTERS_SQL, [business_id]);
    } catch (error) {
      console.warn('⚠️ Failed to reset printer daily counters for business', business_id, error);
    }

    const deletedCount = (result as any).affectedRows || 0;

    return NextResponse.json({
      success: true,
      deleted: deletedCount,
      message: `Deleted ${deletedCount} transactions permanently`
    });

  } catch (error) {
    console.error('Error deleting transactions:', error);
    return NextResponse.json(
      { error: 'Failed to delete transactions' },
      { status: 500 }
    );
  }
}

