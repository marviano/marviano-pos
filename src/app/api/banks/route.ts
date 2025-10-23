import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    // Check if banks table exists
    const tableCheck = await query('SHOW TABLES LIKE "banks"');
    if (!tableCheck || (tableCheck as any[]).length === 0) {
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

  } catch (error: any) {
    console.error('Error fetching banks:', error);
    return NextResponse.json(
      { 
        success: false, 
        banks: [], 
        message: 'Failed to fetch banks',
        error: error.message 
      },
      { status: 500 }
    );
  }
}







