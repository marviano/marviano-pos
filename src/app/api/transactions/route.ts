import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { generateReceiptNumber } from '@/lib/receiptUtils';
import { getPaymentMethodId, getPaymentMethodCode } from '@/lib/paymentMethods';

interface TransactionItem {
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
}

interface TransactionData {
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
  items: TransactionItem[];
}

export async function POST(request: NextRequest) {
  try {
    const transactionData: TransactionData = await request.json();
    
    // Validate required fields
    if (!transactionData.business_id || !transactionData.user_id || !transactionData.items || transactionData.items.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Start transaction
    const connection = await query('START TRANSACTION');
    
    try {
      // Get payment method ID
      const paymentMethodId = await getPaymentMethodId(transactionData.payment_method);
      
      // Generate receipt number
      const receiptNumber = await generateReceiptNumber(transactionData.business_id, transactionData.transaction_type);
      
      // Insert main transaction record
      const transactionResult = await query(`
    INSERT INTO transactions (
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', NOW())
      `, [
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
        transactionData.transaction_type
      ]);

      const transactionId = (transactionResult as any).insertId;

      // Insert transaction items
      for (const item of transactionData.items) {
        await query(`
          INSERT INTO transaction_items (
            transaction_id,
            product_id,
            quantity,
            unit_price,
            total_price,
            customizations_json,
            custom_note,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
          transactionId,
          item.product_id,
          item.quantity,
          item.unit_price,
          item.total_price,
          item.customizations ? JSON.stringify(item.customizations) : null,
          item.customNote || null
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
    console.error('Error saving transaction:', error);
    return NextResponse.json(
      { error: 'Failed to save transaction' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const date = searchParams.get('date');
    const limit = searchParams.get('limit') || '50';

    // First, let's check if transactions table exists
    const tableCheck = await query('SHOW TABLES LIKE "transactions"');
    console.log('Table check result:', tableCheck);

    if (!tableCheck || (tableCheck as any[]).length === 0) {
      return NextResponse.json({
        success: true,
        transactions: [],
        message: 'Transactions table not found. Please run the migration first.'
      });
    }

    // Query with payment method join
    let sql = `
      SELECT 
        t.id,
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
    `;
    const params: any[] = [];

    // Add conditions
    const conditions: string[] = [];
    if (businessId) {
      conditions.push('t.business_id = ?');
      params.push(parseInt(businessId));
    }
    if (date) {
      // Use date range instead of DATE() function for better prepared statement compatibility
      const startDate = `${date} 00:00:00`;
      const endDate = `${date} 23:59:59`;
      conditions.push('t.created_at >= ? AND t.created_at <= ?');
      params.push(startDate);
      params.push(endDate);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY t.created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    console.log('Simple SQL Query:', sql);
    console.log('Parameters:', params);

    let transactions;
    try {
      transactions = await query(sql, params);
    } catch (preparedError) {
      console.log('Prepared statement failed, trying direct query...');
      console.log('Error:', preparedError);
      
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
      
      console.log('Direct SQL:', directSql);
      transactions = await query(directSql);
    }
    
    console.log('Raw transactions result:', transactions);
    console.log('Number of transactions found:', (transactions as any[]).length);

    // Let's also check what transactions exist without any filters
    const allTransactions = await query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 5');
    console.log('Last 5 transactions (any business):', allTransactions);

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
