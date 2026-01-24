import { NextResponse, NextRequest } from 'next/server';
import { queryVps } from '@/lib/db';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  try {
    // Get business_id from query parameter (required)
    const searchParams = request.nextUrl.searchParams;
    const businessIdParam = searchParams.get('business_id');
    if (!businessIdParam) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'business_id query parameter is required'
        },
        { status: 400 }
      );
    }
    const BUSINESS_ID = parseInt(businessIdParam, 10);
    if (isNaN(BUSINESS_ID)) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid business_id: must be a number'
        },
        { status: 400 }
      );
    }
    
    console.log(`🔄 Starting comprehensive sync for business ${BUSINESS_ID}...`);
    
    const syncResults: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};

    // Sync Products using junction table
    try {
      const products = await queryVps<unknown[]>(`
        SELECT 
          p.id, p.menu_code, p.nama, p.satuan, p.category1_id, p.category2_id,
          c1.name as category1_name, c2.name as category2_name,
          p.keterangan, p.harga_beli, p.ppn, p.harga_jual, p.harga_khusus,
          p.harga_gofood, p.harga_grabfood, p.harga_shopeefood, p.harga_tiktok, p.harga_qpon,
          p.fee_kerja, p.image_url, p.status, p.created_at, p.has_customization, p.is_bundle
        FROM products p
        INNER JOIN product_businesses pb ON p.id = pb.product_id
        LEFT JOIN category1 c1 ON p.category1_id = c1.id
        LEFT JOIN category2 c2 ON p.category2_id = c2.id
        WHERE pb.business_id = ? AND p.status = 'active'
        ORDER BY p.nama ASC
      `, [BUSINESS_ID] as (string | number)[]);
      
      // Use public API route for images (bypasses authentication)
      interface ProductRow {
        image_url: string | null;
        [key: string]: unknown;
      }
      const processedProducts = (products as ProductRow[]).map((product) => ({
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

    // Sync Product-Businesses Junction Table (for multi-business support)
    try {
      console.log(`🔄 [SYNC] Fetching product_businesses for business_id ${BUSINESS_ID}...`);
      const productBusinesses = await queryVps<unknown[]>(`
        SELECT product_id, business_id
        FROM product_businesses
        WHERE business_id = ?
        ORDER BY product_id ASC, business_id ASC
      `, [BUSINESS_ID] as (string | number)[]);
      const productBusinessesArray = Array.isArray(productBusinesses) ? productBusinesses as Record<string, unknown>[] : [];
      syncResults.productBusinesses = productBusinessesArray;
      counts.productBusinesses = productBusinessesArray.length;
      console.log(`✅ Synced ${productBusinessesArray.length} product-business relationships`);
      if (productBusinessesArray.length > 0) {
        const hasProduct298 = productBusinessesArray.some((pb) => pb?.product_id === 298);
        console.log(`   ${hasProduct298 ? '✅' : '❌'} Product 298 ${hasProduct298 ? 'found' : 'NOT found'} in product_businesses`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Failed to sync product_businesses:', errorMessage);
      console.error('   Full error:', error);
      syncResults.productBusinesses = [];
      counts.productBusinesses = 0;
    }

    // Skip Categories (legacy format) - not needed, category2 is used instead

    // Skip Ingredients - not needed in POS app
    // Skip COGS - not needed in POS app
    // Skip Source - not needed in POS app
    // Skip Teams - not needed in POS app
    // Skip Contacts - not needed in POS app
    // Skip Employees Position - not needed in POS app
    // Skip Employees - not needed in POS app
    // Skip Roles - not needed in POS app
    // Skip Permissions - not needed in POS app
    // Skip Permission Categories - not needed in POS app
    // Skip Role Permissions - not needed in POS app

    // Sync Payment Methods
    try {
      const paymentMethods = await queryVps<unknown[]>(`
        SELECT id, name, code, description, is_active, requires_additional_info, created_at
        FROM payment_methods 
        WHERE is_active = 1
        ORDER BY name ASC
      `);
      syncResults.paymentMethods = paymentMethods;
      counts.paymentMethods = paymentMethods.length;
      console.log(`✅ Synced ${paymentMethods.length} payment methods`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync payment methods:', error);
      syncResults.paymentMethods = [];
      counts.paymentMethods = 0;
    }

    // Sync Banks
    try {
      const banks = await queryVps<unknown[]>(`
        SELECT id, bank_code, bank_name, is_popular, is_active, created_at
        FROM banks 
        WHERE is_active = 1
        ORDER BY is_popular DESC, bank_name ASC
      `);
      syncResults.banks = banks;
      counts.banks = banks.length;
      console.log(`✅ Synced ${banks.length} banks`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync banks:', error);
      syncResults.banks = [];
      counts.banks = 0;
    }

    // Sync Organizations
    try {
      const organizations = await queryVps<unknown[]>(`
        SELECT id, name, slug, owner_user_id, subscription_status, subscription_plan, trial_ends_at, created_at, updated_at
        FROM organizations 
        ORDER BY name ASC
      `);
      syncResults.organizations = organizations;
      counts.organizations = organizations.length;
      console.log(`✅ Synced ${organizations.length} organizations`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync organizations:', error);
      syncResults.organizations = [];
      counts.organizations = 0;
    }

    // Sync Businesses
    try {
      const businesses = await queryVps<unknown[]>(`
        SELECT id, name, organization_id, permission_name, created_at, updated_at
        FROM businesses 
        ORDER BY name ASC
      `);
      syncResults.businesses = businesses;
      counts.businesses = businesses.length;
      console.log(`✅ Synced ${businesses.length} businesses`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync businesses:', error);
      syncResults.businesses = [];
      counts.businesses = 0;
    }

    // Skip Management Groups - not needed in POS app (CRM-only)

    // Sync Category1
    try {
      const category1 = await queryVps<unknown[]>(`
        SELECT id, name, description, display_order, is_active, created_at
        FROM category1 
        WHERE is_active = 1
        ORDER BY display_order ASC, name ASC
      `);
      syncResults.category1 = category1;
      counts.category1 = category1.length;
      console.log(`✅ Synced ${category1.length} category1 records`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync category1:', error);
      syncResults.category1 = [];
      counts.category1 = 0;
    }

    // Sync Category2 (ALL records, not filtered by business - junction table handles relationships)
    try {
      const category2 = await queryVps<unknown[]>(`
        SELECT id, name, description, display_order, is_active, created_at
        FROM category2 
        WHERE is_active = 1
        ORDER BY display_order ASC, name ASC
      `);
      syncResults.category2 = category2;
      counts.category2 = category2.length;
      console.log(`✅ Synced ${category2.length} category2 records`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync category2:', error);
      syncResults.category2 = [];
      counts.category2 = 0;
    }

    // Sync Category2-Businesses Junction Table (for multi-business support)
    try {
      const category2Businesses = await queryVps<unknown[]>(`
        SELECT category2_id, business_id, created_at
        FROM category2_businesses
        ORDER BY category2_id ASC, business_id ASC
      `);
      syncResults.category2Businesses = category2Businesses;
      counts.category2Businesses = category2Businesses.length;
      console.log(`✅ Synced ${category2Businesses.length} category2-business relationships`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync category2_businesses:', error);
      syncResults.category2Businesses = [];
      counts.category2Businesses = 0;
    }

    // Sync CL Accounts
    try {
      const clAccounts = await queryVps<unknown[]>(`
        SELECT id, account_code, account_name, contact_info, credit_limit, current_balance,
               is_active, created_at
        FROM cl_accounts 
        WHERE is_active = 1
        ORDER BY account_name ASC
      `);
      syncResults.clAccounts = clAccounts;
      counts.clAccounts = clAccounts.length;
      console.log(`✅ Synced ${clAccounts.length} CL accounts`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync CL accounts:', error);
      syncResults.clAccounts = [];
      counts.clAccounts = 0;
    }

    // Sync Customization Types
    try {
      const customizationTypes = await queryVps<unknown[]>(`
        SELECT id, name, selection_mode, display_order
        FROM product_customization_types
        ORDER BY display_order ASC, name ASC
      `);
      syncResults.customizationTypes = customizationTypes;
      counts.customizationTypes = customizationTypes.length;
      console.log(`✅ Synced ${customizationTypes.length} customization types`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync customization types:', error);
      syncResults.customizationTypes = [];
      counts.customizationTypes = 0;
    }

    // Sync Customization Options
    try {
      const customizationOptions = await queryVps<unknown[]>(`
        SELECT co.id, co.type_id, co.name, co.price_adjustment, co.display_order, co.status
        FROM product_customization_options co
        WHERE co.status = 'active'
        ORDER BY co.type_id, co.display_order ASC, co.name ASC
      `);
      syncResults.customizationOptions = customizationOptions;
      counts.customizationOptions = customizationOptions.length;
      console.log(`✅ Synced ${customizationOptions.length} customization options`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync customization options:', error);
      syncResults.customizationOptions = [];
      counts.customizationOptions = 0;
    }

    // Sync Product Customizations
    try {
      const productCustomizations = await queryVps<unknown[]>(`
        SELECT pc.id, pc.product_id, pc.customization_type_id
        FROM product_customizations pc
        ORDER BY pc.product_id, pc.customization_type_id ASC
      `);
      syncResults.productCustomizations = productCustomizations;
      counts.productCustomizations = productCustomizations.length;
      console.log(`✅ Synced ${productCustomizations.length} product customizations`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync product customizations:', error);
      syncResults.productCustomizations = [];
      counts.productCustomizations = 0;
    }

    // Sync Bundle Items
    try {
      const bundleItems = await queryVps<unknown[]>(`
        SELECT 
          bi.id, bi.bundle_product_id, bi.category2_id, bi.required_quantity, bi.display_order,
          bi.created_at, c2.name as category2_name
        FROM bundle_items bi
        LEFT JOIN category2 c2 ON bi.category2_id = c2.id
        INNER JOIN product_businesses pb ON bi.bundle_product_id = pb.product_id
        WHERE pb.business_id = ?
        ORDER BY bi.bundle_product_id, bi.display_order ASC
      `, [BUSINESS_ID] as (string | number)[]);
      syncResults.bundleItems = bundleItems;
      counts.bundleItems = bundleItems.length;
      console.log(`✅ Synced ${bundleItems.length} bundle items`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync bundle items:', error);
      syncResults.bundleItems = [];
      counts.bundleItems = 0;
    }

    // Sync Restaurant Rooms
    try {
      const restaurantRooms = await queryVps<unknown[]>(`
        SELECT id, business_id, name, canvas_width, canvas_height, font_size_multiplier, created_at, updated_at
        FROM restaurant_rooms 
        WHERE business_id = ?
        ORDER BY name ASC
      `, [BUSINESS_ID] as (string | number)[]);
      syncResults.restaurantRooms = restaurantRooms;
      counts.restaurantRooms = restaurantRooms.length;
      console.log(`✅ Synced ${restaurantRooms.length} restaurant rooms`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync restaurant rooms:', error);
      syncResults.restaurantRooms = [];
      counts.restaurantRooms = 0;
    }

    // Sync Restaurant Tables
    try {
      const restaurantTables = await queryVps<unknown[]>(`
        SELECT rt.id, rt.room_id, rt.table_number, rt.position_x, rt.position_y, 
               rt.width, rt.height, rt.capacity, rt.shape, rt.created_at, rt.updated_at
        FROM restaurant_tables rt
        INNER JOIN restaurant_rooms rr ON rt.room_id = rr.id
        WHERE rr.business_id = ?
        ORDER BY rt.room_id ASC, rt.table_number ASC
      `, [BUSINESS_ID] as (string | number)[]);
      syncResults.restaurantTables = restaurantTables;
      counts.restaurantTables = restaurantTables.length;
      console.log(`✅ Synced ${restaurantTables.length} restaurant tables`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync restaurant tables:', error);
      syncResults.restaurantTables = [];
      counts.restaurantTables = 0;
    }

    // Sync Restaurant Layout Elements
    try {
      const restaurantLayoutElements = await queryVps<unknown[]>(`
        SELECT rle.id, rle.room_id, rle.label, rle.position_x, rle.position_y,
               rle.width, rle.height, rle.element_type, rle.color, rle.text_color,
               rle.created_at, rle.updated_at
        FROM restaurant_layout_elements rle
        INNER JOIN restaurant_rooms rr ON rle.room_id = rr.id
        WHERE rr.business_id = ?
        ORDER BY rle.room_id ASC, rle.label ASC
      `, [BUSINESS_ID] as (string | number)[]);
      syncResults.restaurantLayoutElements = restaurantLayoutElements;
      counts.restaurantLayoutElements = restaurantLayoutElements.length;
      console.log(`✅ Synced ${restaurantLayoutElements.length} restaurant layout elements`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync restaurant layout elements:', error);
      syncResults.restaurantLayoutElements = [];
      counts.restaurantLayoutElements = 0;
    }

    // Sync Receipt Settings (business-specific and global)
    try {
      const receiptSettings = await queryVps<unknown[]>(`
        SELECT id, business_id, store_name, address, phone_number, contact_phone,
               logo_base64, footer_text, partnership_contact, is_active, created_at, updated_at
        FROM receipt_settings 
        WHERE is_active = 1 AND (business_id = ? OR business_id IS NULL)
        ORDER BY business_id ASC
      `, [BUSINESS_ID] as (string | number)[]);
      syncResults.receiptSettings = receiptSettings;
      counts.receiptSettings = receiptSettings.length;
      console.log(`✅ Synced ${receiptSettings.length} receipt settings`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync receipt settings:', error);
      syncResults.receiptSettings = [];
      counts.receiptSettings = 0;
    }

    // Sync Receipt Templates (business-specific and global)
    try {
      const receiptTemplates = await queryVps<unknown[]>(`
        SELECT id, template_type, template_name, business_id, template_code,
               is_active, is_default, version, created_at, updated_at
        FROM receipt_templates 
        WHERE is_active = 1 AND (business_id = ? OR business_id IS NULL)
        ORDER BY template_type ASC, business_id ASC, is_default DESC, template_name ASC
      `, [BUSINESS_ID] as (string | number)[]);
      syncResults.receiptTemplates = receiptTemplates;
      counts.receiptTemplates = receiptTemplates.length;
      console.log(`✅ Synced ${receiptTemplates.length} receipt templates`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync receipt templates:', error);
      syncResults.receiptTemplates = [];
      counts.receiptTemplates = 0;
    }

    // Skip Transactions - POS is source of truth (upload-only, not downloaded)
    // Skip Transaction Items - POS is source of truth (upload-only, not downloaded)
    // Skip Printer Audit Logs - POS is source of truth (upload-only, not downloaded)

    const totalRecords = Object.values(counts).reduce((sum, count) => sum + count, 0);
    console.log(`🎉 Comprehensive sync completed: ${totalRecords} total records synced`);

    // #region agent log - server side
    try {
      const logPath3 = path.join(process.cwd(), '.cursor', 'debug.log');
      fs.appendFileSync(logPath3, JSON.stringify({location:'sync/route.ts:683',message:'Returning sync response',data:{allKeys:Object.keys(syncResults)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n');
    } catch {
      // Silently ignore logging errors
    }
    // #endregion

    return NextResponse.json({
      success: true,
      data: syncResults,
      counts,
      businessId: BUSINESS_ID,
      timestamp: new Date().toISOString(),
      summary: `Synced ${totalRecords} records across ${Object.keys(counts).length} tables`
    });

  } catch (error: unknown) {
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
