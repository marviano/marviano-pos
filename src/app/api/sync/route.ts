import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Hard-coded business_id = 14 (as per requirements)
const BUSINESS_ID = 14;

interface SyncResponse {
  success: boolean;
  data?: any;
  error?: string;
  counts?: Record<string, number>;
}

export async function GET() {
  try {
    console.log('🔄 Starting comprehensive sync for all POS tables...');
    
    const syncResults: Record<string, any[]> = {};
    const counts: Record<string, number> = {};

    // Sync Users
    try {
      const users = await query(`
        SELECT id, email, password, name, googleId, createdAt, role_id, organization_id 
        FROM users 
        ORDER BY name ASC
      `);
      syncResults.users = users;
      counts.users = users.length;
      console.log(`✅ Synced ${users.length} users`);
    } catch (error) {
      console.warn('⚠️ Failed to sync users:', error);
      syncResults.users = [];
      counts.users = 0;
    }

    // Sync Businesses
    try {
      const businesses = await query(`
        SELECT id, name, permission_name, organization_id, management_group_id, image_url, created_at 
        FROM businesses 
        ORDER BY name ASC
      `);
      syncResults.businesses = businesses;
      counts.businesses = businesses.length;
      console.log(`✅ Synced ${businesses.length} businesses`);
    } catch (error) {
      console.warn('⚠️ Failed to sync businesses:', error);
      syncResults.businesses = [];
      counts.businesses = 0;
    }

    // Sync Products using junction table
    try {
      const products = await query(`
        SELECT 
          p.id, p.menu_code, p.nama, p.satuan, p.category1_id, p.category2_id,
          c1.name as category1_name, c2.name as category2_name,
          p.keterangan, p.harga_beli, p.ppn, p.harga_jual, p.harga_khusus,
          p.harga_online, p.fee_kerja, p.image_url, p.status, p.created_at, p.has_customization
        FROM products p
        INNER JOIN product_businesses pb ON p.id = pb.product_id
        LEFT JOIN category1 c1 ON p.category1_id = c1.id
        LEFT JOIN category2 c2 ON p.category2_id = c2.id
        WHERE pb.business_id = ? AND p.status = 'active'
        ORDER BY p.nama ASC
      `, [BUSINESS_ID]);
      
      // Use public API route for images (bypasses authentication)
      const processedProducts = products.map((product: any) => ({
        ...product,
        image_url: product.image_url ? 
          (product.image_url.startsWith('http') ? 
            product.image_url : 
            `http://217.217.252.95:3000/api/public/images${product.image_url}`) : 
          null
      }));
      
      syncResults.products = processedProducts;
      counts.products = processedProducts.length;
      console.log(`✅ Synced ${processedProducts.length} products`);
    } catch (error) {
      console.warn('⚠️ Failed to sync products:', error);
      syncResults.products = [];
      counts.products = 0;
    }

    // Sync Categories (derived from category2 table)
    try {
      const categories = await query(`
        SELECT DISTINCT c2.name as jenis
        FROM products p
        INNER JOIN product_businesses pb ON p.id = pb.product_id
        LEFT JOIN category2 c2 ON p.category2_id = c2.id
        WHERE pb.business_id = ? AND p.status = 'active' AND c2.name IS NOT NULL
        ORDER BY c2.name ASC
      `, [BUSINESS_ID]);
      syncResults.categories = categories.map((cat: any) => ({ jenis: cat.jenis }));
      counts.categories = categories.length;
      console.log(`✅ Synced ${categories.length} categories`);
    } catch (error) {
      console.warn('⚠️ Failed to sync categories:', error);
      syncResults.categories = [];
      counts.categories = 0;
    }

    // Sync Ingredients
    try {
      const ingredients = await query(`
        SELECT id, ingredient_code, nama, kategori, satuan_beli, isi_satuan_beli, satuan_keluar,
               harga_beli, stok_min, status, business_id, created_at
        FROM ingredients 
        WHERE business_id = ? AND status = 'active'
        ORDER BY nama ASC
      `, [BUSINESS_ID]);
      syncResults.ingredients = ingredients;
      counts.ingredients = ingredients.length;
      console.log(`✅ Synced ${ingredients.length} ingredients`);
    } catch (error) {
      console.warn('⚠️ Failed to sync ingredients:', error);
      syncResults.ingredients = [];
      counts.ingredients = 0;
    }

    // Sync COGS
    try {
      const cogs = await query(`
        SELECT id, menu_code, ingredient_code, amount, created_at
        FROM cogs 
        ORDER BY menu_code ASC
      `);
      syncResults.cogs = cogs;
      counts.cogs = cogs.length;
      console.log(`✅ Synced ${cogs.length} COGS records`);
    } catch (error) {
      console.warn('⚠️ Failed to sync COGS:', error);
      syncResults.cogs = [];
      counts.cogs = 0;
    }

    // Sync Contacts
    try {
      const contacts = await query(`
        SELECT id, no_ktp, nama, phone_number, tgl_lahir, no_kk, created_at, updated_at,
               is_active, jenis_kelamin, kota, kecamatan, source_id, pekerjaan_id,
               source_lainnya, alamat, team_id
        FROM contacts 
        WHERE is_active = 1
        ORDER BY nama ASC
      `);
      syncResults.contacts = contacts;
      counts.contacts = contacts.length;
      console.log(`✅ Synced ${contacts.length} contacts`);
    } catch (error) {
      console.warn('⚠️ Failed to sync contacts:', error);
      syncResults.contacts = [];
      counts.contacts = 0;
    }

    // Sync Teams
    try {
      const teams = await query(`
        SELECT id, name, description, organization_id, team_lead_id, business_id, color, is_active, created_at
        FROM teams 
        WHERE is_active = 1
        ORDER BY name ASC
      `);
      syncResults.teams = teams;
      counts.teams = teams.length;
      console.log(`✅ Synced ${teams.length} teams`);
    } catch (error) {
      console.warn('⚠️ Failed to sync teams:', error);
      syncResults.teams = [];
      counts.teams = 0;
    }

    // Sync Source
    try {
      const source = await query(`
        SELECT id, source_name, created_at
        FROM source 
        ORDER BY source_name ASC
      `);
      syncResults.source = source;
      counts.source = source.length;
      console.log(`✅ Synced ${source.length} source records`);
    } catch (error) {
      console.warn('⚠️ Failed to sync source:', error);
      syncResults.source = [];
      counts.source = 0;
    }

    // Sync Pekerjaan
    try {
      const pekerjaan = await query(`
        SELECT id, nama_pekerjaan, created_at
        FROM pekerjaan 
        ORDER BY nama_pekerjaan ASC
      `);
      syncResults.pekerjaan = pekerjaan;
      counts.pekerjaan = pekerjaan.length;
      console.log(`✅ Synced ${pekerjaan.length} pekerjaan records`);
    } catch (error) {
      console.warn('⚠️ Failed to sync pekerjaan:', error);
      syncResults.pekerjaan = [];
      counts.pekerjaan = 0;
    }

    const totalRecords = Object.values(counts).reduce((sum, count) => sum + count, 0);
    console.log(`🎉 Comprehensive sync completed: ${totalRecords} total records synced`);

    return NextResponse.json({
      success: true,
      data: syncResults,
      counts,
      businessId: BUSINESS_ID,
      timestamp: new Date().toISOString(),
      summary: `Synced ${totalRecords} records across ${Object.keys(counts).length} tables`
    });

  } catch (error) {
    console.error('❌ Comprehensive sync failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to sync data',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
