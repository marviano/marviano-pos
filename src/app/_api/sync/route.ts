import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Hard-coded business_id = 14 (as per requirements)
const BUSINESS_ID = 14;

export async function GET() {
  try {
    console.log('🔄 Starting comprehensive sync for all POS tables...');
    
    const syncResults: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};

    // Sync Users
    try {
      const users = await query<unknown[]>(`
        SELECT id, email, password, name, googleId, createdAt, role_id, organization_id 
        FROM users 
        ORDER BY name ASC
      `);
      syncResults.users = users || [];
      counts.users = Array.isArray(users) ? users.length : 0;
      console.log(`✅ Synced ${counts.users} users`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync users:', error);
      syncResults.users = [];
      counts.users = 0;
    }

    // Sync Businesses
    try {
      const businesses = await query<unknown[]>(`
        SELECT id, name, permission_name, organization_id, management_group_id, image_url, created_at 
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

    // Sync Products using junction table
    try {
      const products = await query<unknown[]>(`
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

    // Sync Categories (all categories from category2 table, including empty ones)
    try {
      const categories = await query<unknown[]>(`
        SELECT c2.name as category2_name
        FROM category2 c2
        WHERE c2.business_id = ? AND c2.is_active = 1
        ORDER BY c2.display_order ASC, c2.name ASC
      `, [BUSINESS_ID] as (string | number)[]);
      interface CategoryRow {
        category2_name: string;
      }
      const categoryArray = Array.isArray(categories) ? categories as CategoryRow[] : [];
      syncResults.categories = categoryArray.map((cat) => ({ jenis: cat.category2_name }));
      counts.categories = categoryArray.length;
      console.log(`✅ Synced ${counts.categories} categories (including empty ones)`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync categories:', error);
      syncResults.categories = [];
      counts.categories = 0;
    }

    // Sync Ingredients
    try {
      const ingredients = await query<unknown[]>(`
        SELECT id, ingredient_code, nama, kategori, satuan_beli, isi_satuan_beli, satuan_keluar,
               harga_beli, stok_min, status, business_id, created_at
        FROM ingredients 
        WHERE business_id = ? AND status = 'active'
        ORDER BY nama ASC
      `, [BUSINESS_ID] as (string | number)[]);
      syncResults.ingredients = ingredients;
      counts.ingredients = ingredients.length;
      console.log(`✅ Synced ${ingredients.length} ingredients`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync ingredients:', error);
      syncResults.ingredients = [];
      counts.ingredients = 0;
    }

    // Sync COGS
    try {
      const cogs = await query<unknown[]>(`
        SELECT id, menu_code, ingredient_code, amount, created_at
        FROM cogs 
        ORDER BY menu_code ASC
      `);
      syncResults.cogs = cogs;
      counts.cogs = cogs.length;
      console.log(`✅ Synced ${cogs.length} COGS records`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync COGS:', error);
      syncResults.cogs = [];
      counts.cogs = 0;
    }

    // Sync Contacts
    try {
      const contacts = await query<unknown[]>(`
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
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync contacts:', error);
      syncResults.contacts = [];
      counts.contacts = 0;
    }

    // Sync Roles
    try {
      const roles = await query<unknown[]>(`
        SELECT id, name, description, organization_id, created_at, updated_at
        FROM roles
        ORDER BY name ASC
      `);
      syncResults.roles = roles;
      counts.roles = roles.length;
      console.log(`✅ Synced ${roles.length} roles`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync roles:', error);
      syncResults.roles = [];
      counts.roles = 0;
    }

    // Sync Permissions
    try {
      const permissions = await query<unknown[]>(`
        SELECT id, name, description, created_at, category_id, organization_id, status
        FROM permissions
        ORDER BY name ASC
      `);
      syncResults.permissions = permissions;
      counts.permissions = permissions.length;
      console.log(`✅ Synced ${permissions.length} permissions`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync permissions:', error);
      syncResults.permissions = [];
      counts.permissions = 0;
    }

    // Sync Role Permissions
    try {
      const rolePermissions = await query<unknown[]>(`
        SELECT role_id, permission_id
        FROM role_permissions
      `);
      syncResults.rolePermissions = rolePermissions;
      counts.rolePermissions = rolePermissions.length;
      console.log(`✅ Synced ${rolePermissions.length} role-permission mappings`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync role permissions:', error);
      syncResults.rolePermissions = [];
      counts.rolePermissions = 0;
    }

    // Sync Banks

    // Sync Payment Methods
    try {
      const paymentMethods = await query<unknown[]>(`
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
      const banks = await query<unknown[]>(`
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

    // Sync Management Groups
    try {
      const managementGroups = await query<unknown[]>(`
        SELECT id, name, permission_name, description, organization_id, manager_user_id, created_at
        FROM management_groups 
        ORDER BY name ASC
      `);
      syncResults.managementGroups = managementGroups;
      counts.managementGroups = managementGroups.length;
      console.log(`✅ Synced ${managementGroups.length} management groups`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync management groups:', error);
      syncResults.managementGroups = [];
      counts.managementGroups = 0;
    }

    // Sync Category1
    try {
      const category1 = await query<unknown[]>(`
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

    // Sync Category2
    try {
      const category2 = await query<unknown[]>(`
        SELECT id, name, business_id, description, display_order, is_active, created_at
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

    // Sync CL Accounts
    try {
      const clAccounts = await query<unknown[]>(`
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
      const customizationTypes = await query<unknown[]>(`
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
      const customizationOptions = await query<unknown[]>(`
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
      const productCustomizations = await query<unknown[]>(`
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
      const bundleItems = await query<unknown[]>(`
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

    // Sync Transactions
    try {
      const transactions = await query<unknown[]>(`
        SELECT 
          t.uuid_id as id, t.business_id, t.user_id, pm.code as payment_method, t.pickup_method,
          t.total_amount, t.voucher_discount, t.voucher_type, t.voucher_value, t.voucher_label, t.final_amount, t.amount_received, t.change_amount,
          t.status, t.created_at, t.contact_id, t.customer_name, t.customer_unit, t.note, t.bank_name,
          t.card_number, t.cl_account_id, t.cl_account_name, t.bank_id, t.receipt_number,
          t.transaction_type, t.payment_method_id
        FROM transactions t
        LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
        WHERE t.business_id = ? AND t.status != 'archived'
        ORDER BY t.created_at DESC
      `, [BUSINESS_ID] as (string | number)[]);
      syncResults.transactions = transactions;
      counts.transactions = transactions.length;
      console.log(`✅ Synced ${transactions.length} transactions`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync transactions:', error);
      syncResults.transactions = [];
      counts.transactions = 0;
    }

    // Sync Transaction Items
    try {
      const transactionItems = await query<unknown[]>(`
        SELECT 
          ti.uuid_id as id, ti.uuid_transaction_id as transaction_id, ti.product_id, ti.quantity,
          ti.unit_price, ti.total_price, ti.custom_note, ti.bundle_selections_json, ti.created_at
        FROM transaction_items ti
        INNER JOIN transactions t ON ti.uuid_transaction_id = t.uuid_id
        WHERE t.business_id = ?
        ORDER BY ti.created_at DESC
      `, [BUSINESS_ID] as (string | number)[]);
      syncResults.transactionItems = transactionItems;
      counts.transactionItems = transactionItems.length;
      console.log(`✅ Synced ${transactionItems.length} transaction items`);
    } catch (error: unknown) {
      console.warn('⚠️ Failed to sync transaction items:', error);
      syncResults.transactionItems = [];
      counts.transactionItems = 0;
    }

    // Helper utilities for optional tables
    const tableExists = async (tableName: string) => {
      const result = await query<Array<{ [key: string]: unknown }>>(`SHOW TABLES LIKE ?`, [tableName] as (string | number)[]);
      return Array.isArray(result) && result.length > 0;
    };

    const tableHasColumn = async (tableName: 'printer1_audit_log' | 'printer2_audit_log', columnName: string) => {
      const result = await query<Array<{ [key: string]: unknown }>>(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName] as (string | number)[]);
      return Array.isArray(result) && result.length > 0;
    };

    const getTransactionIdColumn = async (tableName: 'printer1_audit_log' | 'printer2_audit_log') => {
      if (await tableHasColumn(tableName, 'transaction_id')) return 'transaction_id';
      if (await tableHasColumn(tableName, 'uuid_transaction_id')) return 'uuid_transaction_id';
      return null;
    };

    const trySyncPrinterAudits = async (
      tableName: 'printer1_audit_log' | 'printer2_audit_log',
      targetKey: 'printer1Audits' | 'printer2Audits'
    ) => {
      try {
        if (!(await tableExists(tableName))) {
          console.info(`ℹ️ Skipping ${tableName}: table not found`);
          syncResults[targetKey] = [];
          counts[targetKey] = 0;
          return;
        }

        const transactionColumn = await getTransactionIdColumn(tableName);
        if (!transactionColumn) {
          console.info(`ℹ️ Skipping ${tableName}: transaction reference column missing`);
          syncResults[targetKey] = [];
          counts[targetKey] = 0;
          return;
        }

        const hasGlobalCounter = await tableHasColumn(tableName, 'global_counter');
        const hasIsReprint = await tableHasColumn(tableName, 'is_reprint');
        const hasReprintCount = await tableHasColumn(tableName, 'reprint_count');
        const selectFields: string[] = [
          `${transactionColumn} AS transaction_id`,
          tableName === 'printer1_audit_log' ? 'printer1_receipt_number' : 'printer2_receipt_number',
        ];
        if (tableName === 'printer2_audit_log') {
          selectFields.push('print_mode', 'cycle_number');
        }
        if (hasGlobalCounter) {
          selectFields.push('global_counter');
        }
        if (hasIsReprint) {
          selectFields.push('is_reprint');
        }
        if (hasReprintCount) {
          selectFields.push('reprint_count');
        }
        selectFields.push('printed_at', 'printed_at_epoch');

        const audits = await query<unknown[]>(`
          SELECT 
            ${selectFields.join(', ')}
          FROM ${tableName}
          WHERE ${transactionColumn} IN (
            SELECT uuid_id FROM transactions WHERE business_id = ?
          )
          ORDER BY printed_at_epoch DESC
          LIMIT 1000
        `, [BUSINESS_ID] as (string | number)[]);

        syncResults[targetKey] = audits;
        counts[targetKey] = audits.length;
        console.log(`✅ Synced ${audits.length} ${tableName.replace('_', ' ')} records`);
      } catch (error: unknown) {
        console.warn(`⚠️ Failed to sync ${tableName}:`, error);
        syncResults[targetKey] = [];
        counts[targetKey] = 0;
      }
    };

    await trySyncPrinterAudits('printer1_audit_log', 'printer1Audits');
    await trySyncPrinterAudits('printer2_audit_log', 'printer2Audits');

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
