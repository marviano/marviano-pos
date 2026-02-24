import { NextResponse, NextRequest } from 'next/server';
import { queryVps } from '@/lib/db';

/**
 * GET /api/sync/receipt-settings?business_id=<id>
 * Returns only receipt_settings from VPS for explicit "Download Receipt Settings" in Template Struk.
 * Does not run as part of Download Master Data.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const businessIdParam = searchParams.get('business_id');
    if (!businessIdParam) {
      return NextResponse.json(
        { success: false, error: 'business_id query parameter is required' },
        { status: 400 }
      );
    }
    const BUSINESS_ID = parseInt(businessIdParam, 10);
    if (isNaN(BUSINESS_ID)) {
      return NextResponse.json(
        { success: false, error: 'Invalid business_id: must be a number' },
        { status: 400 }
      );
    }

    const receiptSettings = await queryVps<unknown[]>(
      `SELECT id, business_id, store_name, address, phone_number, contact_phone,
              logo_base64, footer_text, partnership_contact, is_active, created_at, updated_at
       FROM receipt_settings
       WHERE is_active = 1 AND (business_id = ? OR business_id IS NULL)
       ORDER BY business_id ASC`,
      [BUSINESS_ID] as (string | number)[]
    );

    return NextResponse.json({
      success: true,
      data: receiptSettings,
      count: Array.isArray(receiptSettings) ? receiptSettings.length : 0,
    });
  } catch (error: unknown) {
    console.error('Receipt settings sync failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch receipt settings',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
