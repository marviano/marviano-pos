import { query } from './db';

// Helper function to get payment method ID by code
export async function getPaymentMethodId(paymentMethodCode: string): Promise<number> {
  const result = await query<{id: number}[]>(
    'SELECT id FROM payment_methods WHERE code = ? AND is_active = 1',
    [paymentMethodCode]
  );
  
  if (result.length === 0) {
    throw new Error(`Payment method '${paymentMethodCode}' not found`);
  }
  
  return result[0].id;
}

// Helper function to get payment method code by ID
export async function getPaymentMethodCode(paymentMethodId: number): Promise<string> {
  const result = await query<{code: string}[]>(
    'SELECT code FROM payment_methods WHERE id = ? AND is_active = 1',
    [paymentMethodId]
  );
  
  if (result.length === 0) {
    throw new Error(`Payment method ID '${paymentMethodId}' not found`);
  }
  
  return result[0].code;
}
