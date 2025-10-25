import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export async function GET() {
  try {
    // Try to get a connection from the pool with timeout
    const pool = getPool();
    
    // Use Promise.race to implement timeout
    const connectionPromise = pool.getConnection();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Connection timeout')), 5000) // 5 second timeout
    );
    
    const connection = await Promise.race([connectionPromise, timeoutPromise]) as any;
    
    // Test the connection with a simple query
    const queryPromise = connection.query('SELECT 1 as test');
    const queryTimeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Query timeout')), 3000) // 3 second timeout
    );
    
    await Promise.race([queryPromise, queryTimeoutPromise]);
    connection.release();
    
    return NextResponse.json({
      success: true,
      status: 'online',
      timestamp: Date.now(),
      database: 'connected'
    });
  } catch (error) {
    console.error('❌ Health check failed:', error);
    return NextResponse.json(
      {
        success: false,
        status: 'offline',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      },
      { status: 503 }
    );
  }
}


