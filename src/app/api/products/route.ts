import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { NextRequest } from 'next/server';

// Hard-coded business_id = 14 (as per requirements)
const BUSINESS_ID = 14;

interface ProductRow {
  id: number;
  menu_code: string;
  nama: string;
  satuan: string;
  category1_id: number | null;
  category2_id: number | null;
  category1_name: string | null;
  category2_name: string | null;
  keterangan: string | null;
  harga_beli: number | null;
  ppn: number | null;
  harga_jual: number;
  harga_khusus: number | null;
  harga_online: number | null;
  harga_gofood: number | null;
  harga_grabfood: number | null;
  harga_shopeefood: number | null;
  harga_tiktok: number | null;
  fee_kerja: number | null;
  image_url: string | null;
  status: 'active' | 'inactive';
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category2Name = searchParams.get('category2_name');
    const transactionType = searchParams.get('transaction_type') as 'drinks' | 'bakery' | null;
    const online = searchParams.get('online') === 'true';
    const platform = searchParams.get('platform') as 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' | null;

    // Base query using junction table and normalized categories
    let sql = `
      SELECT 
        p.id, p.menu_code, p.nama, p.satuan, p.category1_id, p.category2_id,
        c1.name as category1_name, c2.name as category2_name,
        p.keterangan, p.harga_beli, p.ppn, p.harga_jual, p.harga_khusus,
        p.harga_online, p.harga_gofood, p.harga_grabfood, p.harga_shopeefood, p.harga_tiktok,
        p.fee_kerja, p.image_url, p.status
      FROM products p
      INNER JOIN product_businesses pb ON p.id = pb.product_id
      LEFT JOIN category1 c1 ON p.category1_id = c1.id
      LEFT JOIN category2 c2 ON p.category2_id = c2.id
      WHERE pb.business_id = ? 
      AND p.status = 'active'
    `;
    
    const params: any[] = [BUSINESS_ID];

    // Filter by category2_name if provided
    if (category2Name) {
      sql += ' AND c2.name = ?';
      params.push(category2Name);
    }
    
    // Filter by transaction type using category2 names
    if (transactionType) {
      if (transactionType === 'drinks') {
        sql += ` AND c2.name IN ('Ice Cream Cone', 'Sundae', 'Milk Tea', 'Iced Coffee')`;
      } else if (transactionType === 'bakery') {
        sql += ` AND c2.name = 'Bakery'`;
      }
    }

    // Platform filter: when specified, only include products with respective platform price > 0
    if (platform) {
      if (platform === 'gofood') {
        sql += ' AND p.harga_gofood IS NOT NULL AND p.harga_gofood > 0';
      } else if (platform === 'grabfood') {
        sql += ' AND p.harga_grabfood IS NOT NULL AND p.harga_grabfood > 0';
      } else if (platform === 'shopeefood') {
        sql += ' AND p.harga_shopeefood IS NOT NULL AND p.harga_shopeefood > 0';
      } else if (platform === 'tiktok') {
        sql += ' AND p.harga_tiktok IS NOT NULL AND p.harga_tiktok > 0';
      }
    }

    sql += ' ORDER BY p.nama ASC';

    console.log('🔍 Fetching products:', { business_id: BUSINESS_ID, category2Name, transactionType, online, platform });

    const products = await query<ProductRow[]>(sql, params);

    // Ensure numeric fields are properly converted and image URLs are full VPS URLs
    const processedProducts = products.map(product => ({
      ...product,
      harga_jual: Number(product.harga_jual) || 0,
      harga_beli: product.harga_beli ? Number(product.harga_beli) : null,
      harga_khusus: product.harga_khusus ? Number(product.harga_khusus) : null,
      harga_online: product.harga_online ? Number(product.harga_online) : null,
      harga_gofood: product.harga_gofood ? Number(product.harga_gofood) : null,
      harga_grabfood: product.harga_grabfood ? Number(product.harga_grabfood) : null,
      harga_shopeefood: product.harga_shopeefood ? Number(product.harga_shopeefood) : null,
      harga_tiktok: product.harga_tiktok ? Number(product.harga_tiktok) : null,
      ppn: product.ppn ? Number(product.ppn) : null,
      fee_kerja: product.fee_kerja ? Number(product.fee_kerja) : null,
      // Use public API route for images (bypasses authentication)
      image_url: product.image_url ? 
        (product.image_url.startsWith('http') ? 
          product.image_url : 
          `http://217.217.252.95:3000/api/public${product.image_url}`) : 
        null
    }));

    console.log(`✅ Found ${products.length} products`);
    if (processedProducts.length > 0) {
      console.log('Sample product:', JSON.stringify(processedProducts[0], null, 2));
    }

    return NextResponse.json({
      success: true,
      products: processedProducts,
      businessId: BUSINESS_ID,
      filters: { category2Name, transactionType, online }
    });

  } catch (error) {
    console.error('❌ Error fetching products:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch products',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}


