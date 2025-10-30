import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { business_id } = await request.json();
    
    if (!business_id) {
      return NextResponse.json(
        { error: 'Business ID is required' },
        { status: 400 }
      );
    }

    // Archive transactions by setting status to 'archived'
    const result = await query(`
      UPDATE transactions 
      SET status = 'archived', updated_at = NOW()
      WHERE business_id = ? AND status != 'archived'
    `, [business_id]);

    // Also delete printer audits for these transactions to purge test data (skip if table missing)
    try {
      await query(`
        DELETE pa FROM printer_audits pa
        INNER JOIN transactions t ON pa.transaction_uuid = t.uuid_id
        WHERE t.business_id = ? AND t.status = 'archived'
      `, [business_id]);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (!msg.includes("doesn't exist") && !msg.toLowerCase().includes('no such table')) {
        throw e;
      }
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

