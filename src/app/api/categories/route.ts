import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { NextRequest } from 'next/server';

// Hard-coded business_id = 14 (as per requirements)
const BUSINESS_ID = 14;

interface CategoryRow {
  category2_name: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const transactionType = searchParams.get('transaction_type') as 'drinks' | 'bakery' | null;
    const online = searchParams.get('online') === 'true';
    const platform = searchParams.get('platform') as 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' | null;

    // Query to get distinct category2 names from actual products in this business
    // This dynamically loads categories based on what products exist
    let sql = `
      SELECT DISTINCT c2.name as category2_name
      FROM products p
      INNER JOIN product_businesses pb ON p.id = pb.product_id
      LEFT JOIN category2 c2 ON p.category2_id = c2.id
      WHERE pb.business_id = ?
      AND p.status = 'active'
      AND c2.name IS NOT NULL
    `;
    
    const params: any[] = [BUSINESS_ID];
    
    // Filter by transaction type: bakery vs drinks based on category1
    if (transactionType) {
      if (transactionType === 'bakery') {
        // Include products with category1 = 'Bakery'
        sql += ` AND c1.name = 'Bakery'`;
      } else if (transactionType === 'drinks') {
        // For drinks, include category1 = 'Minuman' OR 'Dessert'
        sql += ` AND c1.name IN ('Minuman', 'Dessert')`;
      }
    }

    // Online/Platform filter: only include categories that have products with prices
    if (online && platform) {
      // Filter by platform-specific price columns
      if (platform === 'gofood') {
        sql += ` AND p.harga_gofood IS NOT NULL AND p.harga_gofood > 0`;
      } else if (platform === 'grabfood') {
        sql += ` AND p.harga_grabfood IS NOT NULL AND p.harga_grabfood > 0`;
      } else if (platform === 'shopeefood') {
        sql += ` AND p.harga_shopeefood IS NOT NULL AND p.harga_shopeefood > 0`;
      } else if (platform === 'tiktok') {
        sql += ` AND p.harga_tiktok IS NOT NULL AND p.harga_tiktok > 0`;
      }
    } else if (online) {
      // General online filter without platform
      sql += ` AND p.harga_online IS NOT NULL AND p.harga_online > 0`;
    }
    
    // Some databases may not have display_order; sort by name for safety
    sql += ' ORDER BY c2.name ASC';

    console.log('🔍 Fetching categories:', { business_id: BUSINESS_ID, transactionType, online });

    const categories = await query<CategoryRow[]>(sql, params);

    // Transform to match the expected format (add active: false by default)
    const formattedCategories = categories.map((cat, index) => ({
      jenis: cat.category2_name,
      active: index === 0 // First category is active by default
    }));

    console.log(`✅ Found ${categories.length} categories for ${transactionType || 'all'} ${online ? '(online)' : ''}`);

    return NextResponse.json({
      success: true,
      categories: formattedCategories,
      businessId: BUSINESS_ID,
      filters: { transactionType, online }
    });

  } catch (error) {
    console.error('❌ Error fetching categories:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch categories',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

