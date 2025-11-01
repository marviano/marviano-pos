import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { generateReceiptNumber } from '@/lib/receiptUtils';
import { getPaymentMethodId, getPaymentMethodCode } from '@/lib/paymentMethods';
import { randomUUID } from 'crypto';

interface TransactionItem {
  id?: string; // UUID for transaction item
  product_id: number;
  quantity: number;
  unit_price: number;
  total_price: number;
  customizations?: {
    customization_id: number;
    customization_name: string;
    selected_options: {
      option_id: number;
      option_name: string;
      price_adjustment: number;
    }[];
  }[];
  customNote?: string;
  bundleSelections?: any[];
}

interface TransactionData {
  id: string; // UUID for transaction
  business_id: number;
  user_id: number;
  payment_method: 'cash' | 'debit' | 'qr' | 'ewallet' | 'cl' | 'voucher' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok';
  pickup_method: 'dine-in' | 'take-away';
  total_amount: number;
  voucher_discount: number;
  final_amount: number;
  amount_received: number;
  change_amount: number;
  contact_id?: number | null;
  customer_name?: string | null;
  bank_id?: number | null;
  card_number?: string | null;
  cl_account_id?: number | null;
  cl_account_name?: string | null;
  transaction_type: 'drinks' | 'bakery';
  created_at?: string | number; // Optional - for offline sync to preserve timestamp
  items: TransactionItem[];
}

export async function POST(request: NextRequest) {
  try {
    const transactionData: TransactionData = await request.json();
    
    console.log('📥 [API] Received transaction:', {
      id: transactionData.id,
      business_id: transactionData.business_id,
      user_id: transactionData.user_id,
      payment_method: transactionData.payment_method,
      items_count: transactionData.items?.length
    });
    
    // Validate required fields
    if (!transactionData.business_id || !transactionData.user_id || !transactionData.items || transactionData.items.length === 0) {
      console.error('❌ [API] Missing required fields');
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Start transaction
    const connection = await query('START TRANSACTION');
    
    try {
      // Get payment method ID
      console.log('🔍 [API] Getting payment method ID for:', transactionData.payment_method);
      const paymentMethodId = await getPaymentMethodId(transactionData.payment_method);
      console.log('✅ [API] Payment method ID:', paymentMethodId);
      
      // Generate receipt number based on sale date (created_at if provided)
      let createdAtBasis: Date | undefined = undefined;
      if (transactionData.created_at) {
        const d = new Date(transactionData.created_at);
        if (!isNaN(d.getTime())) createdAtBasis = d;
      }
      const receiptNumber = await generateReceiptNumber(
        transactionData.business_id,
        transactionData.transaction_type,
        createdAtBasis
      );
      
      // Format created_at for MySQL (convert to MySQL datetime format)
      let createdAt;
      if (transactionData.created_at) {
        // Parse the timestamp and convert to MySQL datetime format
        const date = new Date(transactionData.created_at);
        // Format: YYYY-MM-DD HH:MM:SS
        createdAt = date.toISOString().slice(0, 19).replace('T', ' ');
        console.log('📅 [API] Using provided created_at:', createdAt);
      } else {
        createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
        console.log('📅 [API] Using current time:', createdAt);
      }
      
      // Insert main transaction record using UUID
      const transactionResult = await query(`
    INSERT INTO transactions (
      uuid_id,
      business_id, 
      user_id, 
      payment_method_id, 
      pickup_method, 
      total_amount, 
      voucher_discount,
      final_amount,
      amount_received, 
      change_amount,
      contact_id,
      customer_name,
      bank_id,
      card_number,
      cl_account_id,
      cl_account_name,
      receipt_number,
      transaction_type,
      status,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
      `, [
        transactionData.id, // Use UUID from client
        transactionData.business_id,
        transactionData.user_id,
        paymentMethodId,
        transactionData.pickup_method,
        transactionData.total_amount,
        transactionData.voucher_discount,
        transactionData.final_amount,
        transactionData.amount_received,
        transactionData.change_amount,
        transactionData.contact_id || null,
        transactionData.customer_name || null,
        transactionData.bank_id || null,
        transactionData.card_number || null,
        transactionData.cl_account_id || null,
        transactionData.cl_account_name || null,
        receiptNumber,
        transactionData.transaction_type,
        createdAt // Use provided or current timestamp
      ]);
      
      console.log('✅ [API] Transaction inserted successfully with ID:', transactionData.id);

      // Use the UUID for transaction items
      const transactionId = transactionData.id;

      // Insert transaction items
      for (const item of transactionData.items) {
        await query(`
          INSERT INTO transaction_items (
            uuid_id,
            transaction_id,
            uuid_transaction_id,
            product_id,
            quantity,
            unit_price,
            total_price,
            customizations_json,
            custom_note,
            bundle_selections_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
          item.id || randomUUID(), // Use item UUID or generate one
          Math.floor(Math.random() * 1000000) + 100000, // Generate integer ID for old transaction_id column
          transactionId, // UUID for uuid_transaction_id column
          item.product_id,
          item.quantity,
          item.unit_price,
          item.total_price,
          item.customizations ? JSON.stringify(item.customizations) : null,
          item.customNote || null,
          item.bundleSelections ? JSON.stringify(item.bundleSelections) : null
        ]);
      }

      // Update daily revenue in omset table (only for non-CL transactions)
      if (transactionData.payment_method !== 'cl') {
        const today = new Date().toISOString().split('T')[0];
        
        // Check if omset record exists for today
        const existingOmset = await query(`
          SELECT id, regular FROM omset 
          WHERE business_id = ? AND date = ?
        `, [transactionData.business_id, today]);

        if (existingOmset && (existingOmset as any[]).length > 0) {
          // Update existing record with final amount (after voucher discount)
          await query(`
            UPDATE omset 
            SET regular = regular + ?, updated_at = NOW()
            WHERE business_id = ? AND date = ?
          `, [transactionData.final_amount, transactionData.business_id, today]);
        } else {
          // Create new record with final amount (after voucher discount)
          await query(`
            INSERT INTO omset (
              business_id,
              date,
              regular,
              user_id,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, NOW(), NOW())
          `, [
            transactionData.business_id,
            today,
            transactionData.final_amount,
            transactionData.user_id
          ]);
        }
      }

      // Commit transaction
      await query('COMMIT');

      return NextResponse.json({
        success: true,
        transaction_id: transactionId,
        receipt_number: receiptNumber,
        transaction_type: transactionData.transaction_type,
        message: 'Transaction saved successfully'
      });

    } catch (error) {
      // Rollback transaction on error
      await query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('❌ Error saving transaction:', error);
    const message = error instanceof Error ? error.message : String(error);
    // Idempotency: if duplicate uuid_id, treat as success
    if (message && message.toLowerCase().includes('duplicate entry')) {
      console.warn('ℹ️ Duplicate uuid_id detected; treating as idempotent success');
      // Echo minimal success; client has the uuid and can fetch if needed
      return NextResponse.json({ success: true, message: 'Duplicate ignored (idempotent)' }, { status: 200 });
    }
    return NextResponse.json(
      { 
        error: 'Failed to save transaction',
        details: message || 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const date = searchParams.get('date');
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');
    const limit = searchParams.get('limit') || '50';

    // First, let's check if transactions table exists
    const tableCheck = await query('SHOW TABLES LIKE "transactions"');

    if (!tableCheck || (tableCheck as any[]).length === 0) {
      return NextResponse.json({
        success: true,
        transactions: [],
        message: 'Transactions table not found. Please run the migration first.'
      });
    }

    // Query with payment method join - exclude archived transactions
    let sql = `
      SELECT 
        t.uuid_id as id,
        t.business_id,
        t.user_id,
        t.pickup_method,
        t.total_amount,
        t.voucher_discount,
        t.final_amount,
        t.amount_received,
        t.change_amount,
        t.status,
        t.created_at,
        t.updated_at,
        t.contact_id,
        t.customer_name,
        t.note,
        t.bank_name,
        t.card_number,
        t.cl_account_id,
        t.cl_account_name,
        t.bank_id,
        t.receipt_number,
        t.transaction_type,
        pm.code as payment_method,
        pm.name as payment_method_name
      FROM transactions t
      LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
      WHERE t.status != 'archived'
    `;
    const params: any[] = [];

    // Add conditions
    const conditions: string[] = [];
    if (businessId) {
      conditions.push('t.business_id = ?');
      params.push(parseInt(businessId));
    }
    // Date filtering - support both single date and date range
    if (fromDate && toDate) {
      // Date range filtering
      const startDate = `${fromDate} 00:00:00`;
      const endDate = `${toDate} 23:59:59`;
      conditions.push('t.created_at >= ? AND t.created_at <= ?');
      params.push(startDate);
      params.push(endDate);
    } else if (date) {
      // Single date filtering (backward compatibility)
      const startDate = `${date} 00:00:00`;
      const endDate = `${date} 23:59:59`;
      conditions.push('t.created_at >= ? AND t.created_at <= ?');
      params.push(startDate);
      params.push(endDate);
    }

    if (conditions.length > 0) {
      sql += ' AND ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY t.created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    let transactions;
    try {
      transactions = await query(sql, params);
    } catch (preparedError) {
      // Silently fallback to direct query
      
      // Build direct query without prepared statement
      let directSql = 'SELECT * FROM transactions';
      const directConditions: string[] = [];
      
      if (businessId) {
        directConditions.push(`business_id = ${parseInt(businessId)}`);
      }
      if (date) {
        const startDate = `${date} 00:00:00`;
        const endDate = `${date} 23:59:59`;
        directConditions.push(`created_at >= '${startDate}' AND created_at <= '${endDate}'`);
      }
      
      if (directConditions.length > 0) {
        directSql += ' WHERE ' + directConditions.join(' AND ');
      }
      
      directSql += ` ORDER BY created_at DESC LIMIT ${parseInt(limit)}`;
      
      transactions = await query(directSql);
    }
    
    // Removed verbose logging for cleaner output

    // Add user and business names if available
    const enrichedTransactions = [];
    for (const transaction of transactions as any[]) {
      try {
        // Get user name
        let userName = 'Unknown';
        try {
          const userResult = await query('SELECT name FROM users WHERE id = ?', [transaction.user_id]);
          if (userResult && (userResult as any[]).length > 0) {
            userName = (userResult as any[])[0].name;
          }
        } catch (e) {
          console.log('Could not fetch user name:', e);
        }

        // Get business name
        let businessName = 'Unknown';
        try {
          const businessResult = await query('SELECT name FROM businesses WHERE id = ?', [transaction.business_id]);
          if (businessResult && (businessResult as any[]).length > 0) {
            businessName = (businessResult as any[])[0].name;
          }
        } catch (e) {
          console.log('Could not fetch business name:', e);
        }

        enrichedTransactions.push({
          ...transaction,
          user_name: userName,
          business_name: businessName
        });
      } catch (e) {
        // If we can't enrich, just add the basic transaction
        enrichedTransactions.push({
          ...transaction,
          user_name: 'Unknown',
          business_name: 'Unknown'
        });
      }
    }

    return NextResponse.json({
      success: true,
      transactions: enrichedTransactions
    });

  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transactions: ' + (error as Error).message },
      { status: 500 }
    );
  }
}
