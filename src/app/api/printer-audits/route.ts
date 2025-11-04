import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface PrinterAuditLogP1 {
  transaction_id: string;
  printer1_receipt_number: number;
  printed_at: string;
  printed_at_epoch: number;
}

interface PrinterAuditLogP2 {
  transaction_id: string;
  printer2_receipt_number: number;
  print_mode: 'auto' | 'manual';
  cycle_number?: number;
  printed_at: string;
  printed_at_epoch: number;
}

export async function POST(request: NextRequest) {
  try {
    const { printer1Audits, printer2Audits } = await request.json();
    
    console.log('📥 [API] Received printer audits:', {
      printer1Count: printer1Audits?.length || 0,
      printer2Count: printer2Audits?.length || 0
    });

    if (!printer1Audits && !printer2Audits) {
      return NextResponse.json(
        { error: 'No audit data provided' },
        { status: 400 }
      );
    }

    // Start transaction
    await query('START TRANSACTION');
    
    try {
      // Insert Printer 1 audit logs
      if (printer1Audits && printer1Audits.length > 0) {
        for (const audit of printer1Audits) {
          await query(`
            INSERT INTO printer1_audit_log (
              transaction_id,
              printer1_receipt_number,
              printed_at,
              printed_at_epoch
            ) VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              printed_at = VALUES(printed_at),
              printed_at_epoch = VALUES(printed_at_epoch)
          `, [
            audit.transaction_id,
            audit.printer1_receipt_number,
            audit.printed_at,
            audit.printed_at_epoch
          ]);
        }
        console.log(`✅ Synced ${printer1Audits.length} Printer 1 audit logs`);
      }

      // Insert Printer 2 audit logs
      if (printer2Audits && printer2Audits.length > 0) {
        for (const audit of printer2Audits) {
          await query(`
            INSERT INTO printer2_audit_log (
              transaction_id,
              printer2_receipt_number,
              print_mode,
              cycle_number,
              printed_at,
              printed_at_epoch
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              printed_at = VALUES(printed_at),
              printed_at_epoch = VALUES(printed_at_epoch),
              print_mode = VALUES(print_mode),
              cycle_number = VALUES(cycle_number)
          `, [
            audit.transaction_id,
            audit.printer2_receipt_number,
            audit.print_mode,
            audit.cycle_number || null,
            audit.printed_at,
            audit.printed_at_epoch
          ]);
        }
        console.log(`✅ Synced ${printer2Audits.length} Printer 2 audit logs`);
      }

      // Commit transaction
      await query('COMMIT');

      return NextResponse.json({
        success: true,
        printer1Count: printer1Audits?.length || 0,
        printer2Count: printer2Audits?.length || 0,
        message: 'Printer audit logs synced successfully'
      });

    } catch (error) {
      // Rollback transaction on error
      await query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('❌ Error syncing printer audit logs:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { 
        error: 'Failed to sync printer audit logs',
        details: message || 'Unknown error'
      },
      { status: 500 }
    );
  }
}


