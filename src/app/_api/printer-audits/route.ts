import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface PrinterAuditLogP1 {
  transaction_id: string;
  printer1_receipt_number: number;
  global_counter?: number | null;
  printed_at: string;
  printed_at_epoch: number;
  is_reprint?: number;
  reprint_count?: number;
}

interface PrinterAuditLogP2 {
  transaction_id: string;
  printer2_receipt_number: number;
  print_mode: 'auto' | 'manual';
  cycle_number?: number;
  global_counter?: number | null;
  printed_at: string;
  printed_at_epoch: number;
  is_reprint?: number;
  reprint_count?: number;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');
    const limit = searchParams.get('limit') || '50000';

    console.log('📥 [API] GET /api/printer-audits called with:', { fromDate, toDate, limit });

    const params: (string | number)[] = [];
    const conditions: string[] = [];

    // Build date filter for printer1_audit_log (optional)
    if (fromDate && toDate) {
      const startDate = `${fromDate} 00:00:00`;
      const endDate = `${toDate} 23:59:59`;
      conditions.push('printed_at >= ? AND printed_at <= ?');
      params.push(startDate, endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Fetch Printer 1 audit logs
    const printer1Sql = `
      SELECT 
        transaction_id,
        printer1_receipt_number,
        global_counter,
        printed_at,
        printed_at_epoch,
        is_reprint,
        reprint_count
      FROM printer1_audit_log
      ${whereClause}
      ORDER BY printed_at_epoch DESC
      LIMIT ?
    `;
    const printer1Params = [...params, parseInt(limit)];
    
    console.log('🔍 [API] Executing printer1 query:', { sql: printer1Sql, params: printer1Params });
    
    let printer1Results: Array<Record<string, unknown>> = [];
    try {
      printer1Results = await query<Array<Record<string, unknown>>>(printer1Sql, printer1Params as (string | number)[]);
      console.log(`✅ [API] Fetched ${printer1Results?.length || 0} printer1 audit logs`);
    } catch (error) {
      console.error('❌ [API] Error fetching printer1 audit logs:', error);
      // If table doesn't exist, return empty array instead of failing
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('doesn\'t exist') || errorMsg.includes('Unknown table')) {
        console.warn('⚠️ [API] printer1_audit_log table not found, returning empty array');
        printer1Results = [];
      } else {
        throw error;
      }
    }

    // Fetch Printer 2 audit logs
    const printer2Conditions: string[] = [];
    const printer2Params: (string | number)[] = [];
    if (fromDate && toDate) {
      const startDate = `${fromDate} 00:00:00`;
      const endDate = `${toDate} 23:59:59`;
      printer2Conditions.push('printed_at >= ? AND printed_at <= ?');
      printer2Params.push(startDate, endDate);
    }
    const printer2WhereClause = printer2Conditions.length > 0 ? `WHERE ${printer2Conditions.join(' AND ')}` : '';

    const printer2Sql = `
      SELECT 
        transaction_id,
        printer2_receipt_number,
        print_mode,
        cycle_number,
        global_counter,
        printed_at,
        printed_at_epoch,
        is_reprint,
        reprint_count
      FROM printer2_audit_log
      ${printer2WhereClause}
      ORDER BY printed_at_epoch DESC
      LIMIT ?
    `;
    const printer2ParamsFinal = [...printer2Params, parseInt(limit)];
    
    console.log('🔍 [API] Executing printer2 query:', { sql: printer2Sql, params: printer2ParamsFinal });
    
    let printer2Results: Array<Record<string, unknown>> = [];
    try {
      printer2Results = await query<Array<Record<string, unknown>>>(printer2Sql, printer2ParamsFinal as (string | number)[]);
      console.log(`✅ [API] Fetched ${printer2Results?.length || 0} printer2 audit logs`);
    } catch (error) {
      console.error('❌ [API] Error fetching printer2 audit logs:', error);
      // If table doesn't exist, return empty array instead of failing
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('doesn\'t exist') || errorMsg.includes('Unknown table')) {
        console.warn('⚠️ [API] printer2_audit_log table not found, returning empty array');
        printer2Results = [];
      } else {
        throw error;
      }
    }

    // Format results
    const printer1Audits = (printer1Results || []).map((row): PrinterAuditLogP1 => ({
      transaction_id: String(row.transaction_id || ''),
      printer1_receipt_number: Number(row.printer1_receipt_number || 0),
      global_counter: row.global_counter !== null && row.global_counter !== undefined ? Number(row.global_counter) : null,
      printed_at: row.printed_at ? String(row.printed_at) : new Date().toISOString(),
      printed_at_epoch: Number(row.printed_at_epoch || 0),
      is_reprint: row.is_reprint !== null && row.is_reprint !== undefined ? Number(row.is_reprint) : undefined,
      reprint_count: row.reprint_count !== null && row.reprint_count !== undefined ? Number(row.reprint_count) : undefined,
    }));

    const printer2Audits = (printer2Results || []).map((row): PrinterAuditLogP2 => ({
      transaction_id: String(row.transaction_id || ''),
      printer2_receipt_number: Number(row.printer2_receipt_number || 0),
      print_mode: (row.print_mode as 'auto' | 'manual') || 'auto',
      cycle_number: row.cycle_number !== null && row.cycle_number !== undefined ? Number(row.cycle_number) : undefined,
      global_counter: row.global_counter !== null && row.global_counter !== undefined ? Number(row.global_counter) : null,
      printed_at: row.printed_at ? String(row.printed_at) : new Date().toISOString(),
      printed_at_epoch: Number(row.printed_at_epoch || 0),
      is_reprint: row.is_reprint !== null && row.is_reprint !== undefined ? Number(row.is_reprint) : undefined,
      reprint_count: row.reprint_count !== null && row.reprint_count !== undefined ? Number(row.reprint_count) : undefined,
    }));

    const response = {
      success: true,
      entries: {
        printer1: printer1Audits,
        printer2: printer2Audits,
      },
      printer1Count: printer1Audits.length,
      printer2Count: printer2Audits.length,
    };
    
    console.log('✅ [API] Returning printer audit logs:', {
      printer1Count: printer1Audits.length,
      printer2Count: printer2Audits.length,
    });

    return NextResponse.json(response);

  } catch (error) {
    console.error('❌ [API] Error fetching printer audit logs:', error);
    const message = error instanceof Error ? error.message : String(error);
    const errorResponse = {
      error: 'Failed to fetch printer audit logs',
      details: message || 'Unknown error'
    };
    console.error('❌ [API] Error response:', errorResponse);
    return NextResponse.json(errorResponse, { status: 500 });
  }
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
        for (const audit of printer1Audits as PrinterAuditLogP1[]) {
          await query(`
            INSERT INTO printer1_audit_log (
              transaction_id,
              printer1_receipt_number,
              global_counter,
              printed_at,
              printed_at_epoch,
              is_reprint,
              reprint_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              printed_at = VALUES(printed_at),
              printed_at_epoch = VALUES(printed_at_epoch),
              global_counter = VALUES(global_counter),
              is_reprint = VALUES(is_reprint),
              reprint_count = VALUES(reprint_count)
          `, [
            audit.transaction_id,
            audit.printer1_receipt_number,
            audit.global_counter ?? null,
            audit.printed_at,
            audit.printed_at_epoch,
            audit.is_reprint ?? 0,
            audit.reprint_count ?? 0
          ]);
        }
        console.log(`✅ Synced ${printer1Audits.length} Printer 1 audit logs`);
      }

      // Insert Printer 2 audit logs
      if (printer2Audits && printer2Audits.length > 0) {
        for (const audit of printer2Audits as PrinterAuditLogP2[]) {
          await query(`
            INSERT INTO printer2_audit_log (
              transaction_id,
              printer2_receipt_number,
              print_mode,
              cycle_number,
              global_counter,
              printed_at,
              printed_at_epoch,
              is_reprint,
              reprint_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              printed_at = VALUES(printed_at),
              printed_at_epoch = VALUES(printed_at_epoch),
              print_mode = VALUES(print_mode),
              cycle_number = VALUES(cycle_number),
              global_counter = VALUES(global_counter),
              is_reprint = VALUES(is_reprint),
              reprint_count = VALUES(reprint_count)
          `, [
            audit.transaction_id,
            audit.printer2_receipt_number,
            audit.print_mode,
            audit.cycle_number || null,
            audit.global_counter ?? null,
            audit.printed_at,
            audit.printed_at_epoch,
            audit.is_reprint ?? 0,
            audit.reprint_count ?? 0
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







