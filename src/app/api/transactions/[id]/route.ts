import { NextRequest, NextResponse } from 'next/server';
import { query } from '../../../../lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const transactionId = resolvedParams.id; // Keep as string for UUID
    
    if (!transactionId) {
      return NextResponse.json(
        { success: false, message: 'Invalid transaction ID' },
        { status: 400 }
      );
    }

    // Get transaction details with user and business names
    const transactionQuery = `
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
        COALESCE(u.name, 'Unknown User') as user_name,
        COALESCE(b.name, 'Unknown Business') as business_name,
        banks.bank_name,
        cl.account_name as cl_account_name,
        pm.code as payment_method,
        pm.name as payment_method_name
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      LEFT JOIN businesses b ON t.business_id = b.id
      LEFT JOIN banks ON t.bank_id = banks.id
      LEFT JOIN cl_accounts cl ON t.cl_account_id = cl.id
      LEFT JOIN payment_methods pm ON t.payment_method_id = pm.id
      WHERE t.uuid_id = ?
    `;

    const transactionResult = await query(transactionQuery, [transactionId]);
    
    if (!transactionResult || transactionResult.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Transaction not found' },
        { status: 404 }
      );
    }

    const transaction = transactionResult[0];

    // Get transaction items
    const itemsQuery = `
      SELECT 
        ti.uuid_id as id,
        ti.product_id,
        ti.quantity,
        ti.unit_price,
        ti.total_price,
        ti.customizations_json,
        ti.custom_note,
        p.nama as product_name
      FROM transaction_items ti
      LEFT JOIN products p ON ti.product_id = p.id
      WHERE ti.uuid_transaction_id = ?
      ORDER BY ti.uuid_id
    `;

    const itemsResult = await query(itemsQuery, [transactionId]);
    
    // Format the response
    const transactionData = {
      id: transaction.id,
      business_id: transaction.business_id,
      user_id: transaction.user_id,
      user_name: transaction.user_name,
      business_name: transaction.business_name,
      payment_method: transaction.payment_method,
      pickup_method: transaction.pickup_method,
      total_amount: parseFloat(transaction.total_amount),
      voucher_discount: parseFloat(transaction.voucher_discount || 0),
      final_amount: parseFloat(transaction.final_amount),
      amount_received: parseFloat(transaction.amount_received || 0),
      change_amount: parseFloat(transaction.change_amount || 0),
      contact_id: transaction.contact_id,
      customer_name: transaction.customer_name,
      bank_id: transaction.bank_id,
      bank_name: transaction.bank_name,
      card_number: transaction.card_number,
      cl_account_id: transaction.cl_account_id,
      cl_account_name: transaction.cl_account_name,
      created_at: transaction.created_at,
      items: itemsResult.map((item: any) => ({
        id: item.id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: parseFloat(item.unit_price),
        total_price: parseFloat(item.total_price),
        customizations_json: typeof item.customizations_json === 'string' ? item.customizations_json : JSON.stringify(item.customizations_json),
        custom_note: item.custom_note
      }))
    };

    return NextResponse.json({
      success: true,
      transaction: transactionData
    });

  } catch (error: any) {
    console.error('Error fetching transaction details:', error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
