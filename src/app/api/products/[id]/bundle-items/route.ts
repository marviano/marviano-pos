import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const productId = parseInt(id);
    
    if (isNaN(productId)) {
      return NextResponse.json(
        { success: false, message: 'Invalid product ID' },
        { status: 400 }
      );
    }

    // Fetch bundle items with category2 information
    const bundleItems = await query<any[]>(`
      SELECT 
        bi.id,
        bi.bundle_product_id,
        bi.category2_id,
        bi.required_quantity,
        bi.display_order,
        c2.name AS category2_name
      FROM bundle_items bi
      LEFT JOIN category2 c2 ON bi.category2_id = c2.id
      WHERE bi.bundle_product_id = ?
      ORDER BY bi.display_order ASC
    `, [productId]);

    return NextResponse.json({
      success: true,
      bundleItems: bundleItems
    });
  } catch (error: any) {
    console.error('Error fetching bundle items:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to fetch bundle items' },
      { status: 500 }
    );
  }
}

