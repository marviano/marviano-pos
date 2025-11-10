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

    const { clause: updateClause, params: updateParams } = buildWhereClause();

    // Archive transactions by setting status to 'archived'
    const result = await query(`
      UPDATE transactions 
      SET status = 'archived', updated_at = NOW()
      WHERE ${updateClause} AND status != 'archived'
    `, updateParams);

    // Also delete printer audits for these transactions to purge test data (skip if table missing)
    try {
      const { clause: aliasClause, params: aliasParams } = buildWhereClause('t');
      await query(`
        DELETE pa FROM printer_audits pa
        INNER JOIN transactions t ON pa.transaction_uuid = t.uuid_id
        WHERE ${aliasClause} AND t.status = 'archived'
      `, aliasParams);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (!msg.includes("doesn't exist") && !msg.toLowerCase().includes('no such table')) {
        throw e;
      }
    }

    try {
      await query(RESET_PRINTER_COUNTERS_SQL, [business_id]);
    } catch (error) {
      console.warn('⚠️ Failed to reset printer daily counters for business', business_id, error);
    }

    const archivedCount = (result as any).affectedRows || 0;

    return NextResponse.json({
      success: true,
      archived: archivedCount,
      message: `Archived ${archivedCount} transactions`
    });

  } catch (error) {
    console.error('Error archiving transactions:', error);
    return NextResponse.json(
      { error: 'Failed to archive transactions' },
      { status: 500 }
    );
  }
}

