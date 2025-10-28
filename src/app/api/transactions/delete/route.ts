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

    // First delete transaction items
    await query(`
      DELETE ti FROM transaction_items ti
      INNER JOIN transactions t ON ti.uuid_transaction_id = t.uuid_id
      WHERE t.business_id = ?
    `, [business_id]);

    // Then delete transactions
    const result = await query(`
      DELETE FROM transactions 
      WHERE business_id = ?
    `, [business_id]);

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

