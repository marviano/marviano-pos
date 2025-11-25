import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    // Check if banks table exists
    const tableCheck = await query('SHOW TABLES LIKE "banks"') as Array<{ [key: string]: unknown }> | null;
    if (!tableCheck || tableCheck.length === 0) {
      return NextResponse.json({
        success: false,
        banks: [],
        message: 'Banks table not found. Please run the migration first.'
      });
    }

    // Fetch all active banks, ordered by popularity first, then by name
    const banks = await query(`
      SELECT id, bank_code, bank_name, is_popular 
      FROM banks 
      WHERE is_active = 1 
      ORDER BY is_popular DESC, bank_name ASC
    `);

    return NextResponse.json({
      success: true,
      banks: banks || []
    });

  } catch (error) {
    console.error('Error fetching banks:', error);
    return NextResponse.json(
      { 
        success: false, 
        banks: [], 
        message: 'Failed to fetch banks',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}







