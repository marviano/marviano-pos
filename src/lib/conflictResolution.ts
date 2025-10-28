/**
 * Conflict Resolution Service
 * Handles data conflicts during sync operations
 * Implements last-write-wins with timestamp validation
 */

interface ConflictResolution {
  strategy: 'last-write-wins' | 'server-wins' | 'client-wins' | 'merge';
  timestampField: string;
  maxAge: number; // Maximum age in milliseconds for conflict resolution
}

interface ConflictData {
  localData: any;
  serverData: any;
  timestamp: number;
  conflictType: 'update' | 'delete' | 'create';
}

class ConflictResolutionService {
  private config: ConflictResolution = {
    strategy: 'last-write-wins',
    timestampField: 'updated_at',
    maxAge: 86400000, // 24 hours
  };

  /**
   * Resolve conflicts between local and server data
   */
  resolveConflict<T>(localData: T, serverData: T, conflictType: 'update' | 'delete' | 'create' = 'update'): T {
    const conflictData: ConflictData = {
      localData,
      serverData,
      timestamp: Date.now(),
      conflictType,
    };

    console.log(`🔄 [CONFLICT RESOLUTION] Resolving ${conflictType} conflict`);

    switch (this.config.strategy) {
      case 'last-write-wins':
        return this.lastWriteWins(conflictData);
      case 'server-wins':
        return this.serverWins(conflictData);
      case 'client-wins':
        return this.clientWins(conflictData);
      case 'merge':
        return this.mergeData(conflictData);
      default:
        return this.lastWriteWins(conflictData);
    }
  }

  /**
   * Last write wins strategy
   */
  private lastWriteWins<T>(conflictData: ConflictData): T {
    const localTimestamp = this.getTimestamp(conflictData.localData);
    const serverTimestamp = this.getTimestamp(conflictData.serverData);

    // If timestamps are equal or very close, prefer server data
    if (Math.abs(localTimestamp - serverTimestamp) < 1000) {
      console.log('🔄 [CONFLICT RESOLUTION] Timestamps too close, preferring server data');
      return conflictData.serverData;
    }

    // Choose the most recent data
    const winner = localTimestamp > serverTimestamp ? conflictData.localData : conflictData.serverData;
    const winnerType = localTimestamp > serverTimestamp ? 'local' : 'server';
    
    console.log(`🔄 [CONFLICT RESOLUTION] Last-write-wins: ${winnerType} data chosen`);
    return winner;
  }

  /**
   * Server wins strategy
   */
  private serverWins<T>(conflictData: ConflictData): T {
    console.log('🔄 [CONFLICT RESOLUTION] Server-wins: server data chosen');
    return conflictData.serverData;
  }

  /**
   * Client wins strategy
   */
  private clientWins<T>(conflictData: ConflictData): T {
    console.log('🔄 [CONFLICT RESOLUTION] Client-wins: local data chosen');
    return conflictData.localData;
  }

  /**
   * Merge data strategy (for specific data types)
   */
  private mergeData<T>(conflictData: ConflictData): T {
    console.log('🔄 [CONFLICT RESOLUTION] Merge strategy: merging data');
    
    // For now, use last-write-wins as fallback
    // In the future, this could implement sophisticated merging logic
    return this.lastWriteWins(conflictData);
  }

  /**
   * Get timestamp from data object
   */
  private getTimestamp(data: any): number {
    if (!data) return 0;
    
    // Try different timestamp fields
    const timestampFields = ['updated_at', 'created_at', 'last_modified', 'timestamp'];
    
    for (const field of timestampFields) {
      if (data[field]) {
        const timestamp = typeof data[field] === 'number' ? data[field] : new Date(data[field]).getTime();
        if (!isNaN(timestamp)) {
          return timestamp;
        }
      }
    }
    
    // Fallback to current time if no timestamp found
    return Date.now();
  }

  /**
   * Check if data is too old for conflict resolution
   */
  isDataTooOld(data: any): boolean {
    const timestamp = this.getTimestamp(data);
    const age = Date.now() - timestamp;
    return age > this.config.maxAge;
  }

  /**
   * Validate data integrity before sync
   */
  validateData(data: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!data) {
      errors.push('Data is null or undefined');
    }
    
    if (data && typeof data !== 'object') {
      errors.push('Data is not an object');
    }
    
    if (data && !this.getTimestamp(data)) {
      errors.push('No valid timestamp found');
    }
    
    if (this.isDataTooOld(data)) {
      errors.push('Data is too old for sync');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Handle transaction conflicts specifically
   */
  resolveTransactionConflict(localTransaction: any, serverTransaction: any): any {
    // For transactions, we typically want to preserve the original transaction
    // and only update metadata like sync status
    
    if (!serverTransaction) {
      // Server doesn't have this transaction, keep local
      return localTransaction;
    }
    
    if (!localTransaction) {
      // Local doesn't have this transaction, use server
      return serverTransaction;
    }
    
    // Both exist, use last-write-wins but preserve transaction integrity
    const resolved = this.lastWriteWins({
      localData: localTransaction,
      serverData: serverTransaction,
      timestamp: Date.now(),
      conflictType: 'update',
    });
    
    // Ensure transaction ID consistency
    if (localTransaction.id && serverTransaction.id && localTransaction.id !== serverTransaction.id) {
      console.warn('⚠️ [CONFLICT RESOLUTION] Transaction ID mismatch detected');
      // Keep the server ID as it's the authoritative source
      resolved.id = serverTransaction.id;
    }
    
    return resolved;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<ConflictResolution>) {
    this.config = { ...this.config, ...newConfig };
    console.log('🔄 [CONFLICT RESOLUTION] Configuration updated:', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): ConflictResolution {
    return { ...this.config };
  }
}

// Export singleton instance
export const conflictResolutionService = new ConflictResolutionService();
