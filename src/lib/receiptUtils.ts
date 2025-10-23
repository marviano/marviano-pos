import { query } from './db';

/**
 * Generate the next receipt number for a given business and date
 * Receipt numbers reset daily and are shared between drinks and bakery transactions
 * @param businessId - The business ID
 * @param transactionType - 'drinks' or 'bakery'
 * @returns Promise<number> - The next receipt number
 */
export async function generateReceiptNumber(businessId: number, transactionType: 'drinks' | 'bakery'): Promise<number> {
  try {
    // Get today's date range
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    
    // Find the highest receipt number for today
    const result = await query(`
      SELECT MAX(receipt_number) as max_receipt_number
      FROM transactions 
      WHERE business_id = ? 
        AND created_at >= ? 
        AND created_at < ?
    `, [businessId, startOfDay, endOfDay]);
    
    const maxReceiptNumber = result && result.length > 0 ? result[0].max_receipt_number : 0;
    
    // Return the next receipt number
    return (maxReceiptNumber || 0) + 1;
    
  } catch (error) {
    console.error('Error generating receipt number:', error);
    // Fallback: return timestamp-based number if database fails
    return Date.now() % 10000;
  }
}

/**
 * Get receipt number statistics for a business on a specific date
 * @param businessId - The business ID
 * @param date - The date to check (optional, defaults to today)
 * @returns Promise<object> - Receipt statistics
 */
export async function getReceiptStats(businessId: number, date?: Date): Promise<{
  totalReceipts: number;
  drinksReceipts: number;
  bakeryReceipts: number;
  lastReceiptNumber: number;
}> {
  try {
    const targetDate = date || new Date();
    const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 1);
    
    const result = await query(`
      SELECT 
        COUNT(*) as total_receipts,
        SUM(CASE WHEN transaction_type = 'drinks' THEN 1 ELSE 0 END) as drinks_receipts,
        SUM(CASE WHEN transaction_type = 'bakery' THEN 1 ELSE 0 END) as bakery_receipts,
        MAX(receipt_number) as last_receipt_number
      FROM transactions 
      WHERE business_id = ? 
        AND created_at >= ? 
        AND created_at < ?
    `, [businessId, startOfDay, endOfDay]);
    
    const stats = result && result.length > 0 ? result[0] : {
      total_receipts: 0,
      drinks_receipts: 0,
      bakery_receipts: 0,
      last_receipt_number: 0
    };
    
    return {
      totalReceipts: parseInt(stats.total_receipts) || 0,
      drinksReceipts: parseInt(stats.drinks_receipts) || 0,
      bakeryReceipts: parseInt(stats.bakery_receipts) || 0,
      lastReceiptNumber: parseInt(stats.last_receipt_number) || 0
    };
    
  } catch (error) {
    console.error('Error getting receipt stats:', error);
    return {
      totalReceipts: 0,
      drinksReceipts: 0,
      bakeryReceipts: 0,
      lastReceiptNumber: 0
    };
  }
}
