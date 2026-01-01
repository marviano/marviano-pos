/**
 * Sync Utility Functions
 * Shared utilities for data synchronization
 * Phase 2: Date conversion and validation helpers
 * Phase 2 Part 2: ENUM validation and field cleanup
 */

type UnknownRecord = Record<string, unknown>;

/**
 * ENUM value definitions for MySQL tables
 * Phase 2 Part 2: Maps table.column to valid ENUM values
 */
const ENUM_VALUES: Record<string, string[]> = {
  'businesses.status': ['active', 'inactive'],
  'transactions.pickup_method': ['dine-in', 'take-away'],
  'transactions.voucher_type': ['none', 'percent', 'nominal', 'free'],
  'transactions.status': ['pending', 'paid', 'cancelled', 'refunded'],
  'transactions.refund_status': ['none', 'partial', 'full'],
  'transactions.transaction_type': ['drinks', 'bakery'],
  'transaction_refunds.refund_type': ['full', 'partial'],
  'transaction_refunds.status': ['pending', 'completed', 'failed'],
  'shifts.kas_selisih_label': ['balanced', 'plus', 'minus'],
  'product_customization_options.status': ['active', 'inactive'],
  'product_customization_types.selection_mode': ['single', 'multiple'],
};

/**
 * Default values for ENUM fields when validation fails
 * Use null for nullable fields
 */
const ENUM_DEFAULTS: Record<string, string | null> = {
  'businesses.status': 'active',
  'transactions.pickup_method': 'dine-in',
  'transactions.voucher_type': 'none',
  'transactions.status': 'paid',
  'transactions.refund_status': 'none',
  'transactions.transaction_type': 'drinks',
  'transaction_refunds.refund_type': 'full',
  'transaction_refunds.status': 'completed',
  'shifts.kas_selisih_label': 'balanced',
  'product_customization_options.status': 'active',
  'product_customization_types.selection_mode': 'single',
};

/**
 * Validate and normalize ENUM value for MySQL
 * Phase 2 Part 2: Ensures ENUM values are valid before upload
 */
export function validateEnumValue(
  value: unknown,
  tableColumn: string,
  fieldName?: string
): string | null {
  if (value === null || value === undefined) {
    // Check if field is nullable
    const defaultValue = ENUM_DEFAULTS[tableColumn];
    if (defaultValue === null) {
      return null; // Field is nullable
    }
    // Return default if field is NOT NULL
    return defaultValue;
  }

  const stringValue = String(value).toLowerCase().trim();
  const validValues = ENUM_VALUES[tableColumn];

  if (!validValues) {
    // No ENUM validation defined for this field, return as-is
    return stringValue;
  }

  // Check if value is valid (case-insensitive)
  const isValid = validValues.some(v => v.toLowerCase() === stringValue);

  if (isValid) {
    // Return the canonical value (from ENUM_VALUES)
    return validValues.find(v => v.toLowerCase() === stringValue) || stringValue;
  }

  // Invalid value - use default
  const defaultValue = ENUM_DEFAULTS[tableColumn];
  const displayName = fieldName || tableColumn;
  
  console.warn(
    `⚠️ [ENUM VALIDATION] Invalid value "${value}" for ${displayName}. ` +
    `Valid values: ${validValues.join(', ')}. Using default: ${defaultValue || 'null'}`
  );

  return defaultValue || null;
}

/**
 * Convert date/timestamp to MySQL-compatible format
 * MySQL expects datetime/timestamp (ISO string) or bigint
 */
export function convertDateForMySQL(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  // If already a string (ISO format), convert to MySQL datetime format
  if (typeof value === 'string') {
    // Validate it's a valid date string
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toISOString().slice(0, 19).replace('T', ' '); // MySQL datetime format: 'YYYY-MM-DD HH:MM:SS'
    }
    // If it's already in MySQL format (YYYY-MM-DD HH:MM:SS), return as-is
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
      return value;
    }
    return value; // Return as-is if not a date string
  }

  // If it's a number (timestamp in milliseconds or seconds)
  if (typeof value === 'number') {
    // Check if it's in seconds (Unix timestamp) or milliseconds
    const timestamp = value < 10000000000 ? value * 1000 : value; // Convert seconds to milliseconds if needed
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) {
      return date.toISOString().slice(0, 19).replace('T', ' '); // MySQL datetime format
    }
  }

  // If it's a Date object
  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }

  console.warn(`⚠️ [DATE CONVERSION] Could not convert ${fieldName} value:`, value);
  return null;
}

/**
 * Validate NOT NULL constraints before uploading to MySQL
 * Returns array of missing required fields
 */
export function validateNotNullFields(data: UnknownRecord, requiredFields: string[]): string[] {
  const missingFields: string[] = [];

  for (const field of requiredFields) {
    if (data[field] === null || data[field] === undefined || data[field] === '') {
      missingFields.push(field);
    }
  }

  return missingFields;
}

/**
 * Remove fields that don't exist in MySQL table
 * Used to clean data before upload
 * Phase 2 Part 2: Prevents errors when uploading to tables without these fields
 */
export function removeFieldsNotInMySQL(data: UnknownRecord, fieldsToRemove: string[]): UnknownRecord {
  const cleaned = { ...data };
  for (const field of fieldsToRemove) {
    if (cleaned[field] !== undefined) {
      delete cleaned[field];
    }
  }
  return cleaned;
}

/**
 * Clean transaction data for MySQL upload
 * Phase 2 Part 2: Removes updated_at if table doesn't have it (transactions table has it, so this is for other cases)
 */
export function cleanTransactionForMySQL(transactionData: UnknownRecord): UnknownRecord {
  // Transactions table has updated_at, so we keep it
  // But we validate ENUMs and convert dates (already done in convertTransactionDatesForMySQL)
  return transactionData;
}

/**
 * Clean refund data for MySQL upload
 * Phase 2 Part 2: Validates ENUMs and ensures proper format
 */
export function cleanRefundForMySQL(refundData: UnknownRecord): UnknownRecord {
  const cleaned = { ...refundData };

  // Phase 2 Part 2: Validate ENUM fields
  if (cleaned.refund_type !== undefined) {
    cleaned.refund_type = validateEnumValue(cleaned.refund_type, 'transaction_refunds.refund_type', 'refund_type');
  }
  if (cleaned.status !== undefined) {
    cleaned.status = validateEnumValue(cleaned.status, 'transaction_refunds.status', 'refund.status');
  }

  // Convert dates
  if (cleaned.refunded_at) {
    const refundedAt = convertDateForMySQL(cleaned.refunded_at, 'refunded_at');
    if (refundedAt) {
      cleaned.refunded_at = refundedAt;
    }
  }
  if (cleaned.created_at) {
    const createdAt = convertDateForMySQL(cleaned.created_at, 'created_at');
    if (createdAt) {
      cleaned.created_at = createdAt;
    }
  }

  // transaction_refunds table has updated_at, so we keep it (MySQL will handle it)

  return cleaned;
}

/**
 * Convert transaction data dates to MySQL format and validate ENUMs
 * Phase 2 Part 2: Also validates ENUM values
 */
export function convertTransactionDatesForMySQL(transactionData: UnknownRecord): UnknownRecord {
  const converted = { ...transactionData };

  // Phase 2 Part 2: Validate ENUM fields
  if (converted.pickup_method !== undefined) {
    converted.pickup_method = validateEnumValue(converted.pickup_method, 'transactions.pickup_method', 'pickup_method');
  }
  if (converted.voucher_type !== undefined) {
    converted.voucher_type = validateEnumValue(converted.voucher_type, 'transactions.voucher_type', 'voucher_type');
  }
  if (converted.status !== undefined) {
    // Convert "completed" to "paid" for compatibility (local DB uses "completed", remote expects "paid")
    if (String(converted.status).toLowerCase() === 'completed') {
      converted.status = 'paid';
    }
    converted.status = validateEnumValue(converted.status, 'transactions.status', 'status');
  }
  if (converted.refund_status !== undefined) {
    converted.refund_status = validateEnumValue(converted.refund_status, 'transactions.refund_status', 'refund_status');
  }
  if (converted.transaction_type !== undefined) {
    converted.transaction_type = validateEnumValue(converted.transaction_type, 'transactions.transaction_type', 'transaction_type');
  }

  // Phase 2 Part 2: Remove updated_at if MySQL doesn't have it (transactions table has updated_at, so keep it)
  // But we'll remove it for other tables that don't have it

  // Convert main transaction date fields
  if (converted.created_at) {
    const convertedDate = convertDateForMySQL(converted.created_at, 'created_at');
    if (convertedDate) {
      converted.created_at = convertedDate;
    }
  }

  if (converted.updated_at !== undefined) {
    const convertedUpdatedAt = convertDateForMySQL(converted.updated_at, 'updated_at');
    if (convertedUpdatedAt) {
      converted.updated_at = convertedUpdatedAt;
    } else {
      // Remove if conversion failed (MySQL will set it automatically)
      delete converted.updated_at;
    }
  }

  if (converted.last_refunded_at !== undefined && converted.last_refunded_at !== null) {
    const convertedLastRefundedAt = convertDateForMySQL(converted.last_refunded_at, 'last_refunded_at');
    converted.last_refunded_at = convertedLastRefundedAt;
  }

  // Convert dates and validate ENUMs in transaction items
  if (Array.isArray(converted.items)) {
    converted.items = converted.items.map((item: UnknownRecord) => {
      if (item.created_at) {
        const itemDate = convertDateForMySQL(item.created_at, 'item.created_at');
        if (itemDate) {
          item.created_at = itemDate;
        }
      }
      return item;
    });
  }

  // Convert dates and validate ENUMs in refunds
  if (Array.isArray(converted.transaction_refunds)) {
    converted.transaction_refunds = converted.transaction_refunds.map((refund: UnknownRecord) => {
      if (refund.refunded_at) {
        const refundDate = convertDateForMySQL(refund.refunded_at, 'refund.refunded_at');
        if (refundDate) {
          refund.refunded_at = refundDate;
        }
      }
      if (refund.created_at) {
        const refundCreatedDate = convertDateForMySQL(refund.created_at, 'refund.created_at');
        if (refundCreatedDate) {
          refund.created_at = refundCreatedDate;
        }
      }
      // Phase 2 Part 2: Validate refund ENUMs
      if (refund.refund_type !== undefined) {
        refund.refund_type = validateEnumValue(refund.refund_type, 'transaction_refunds.refund_type', 'refund_type');
      }
      if (refund.status !== undefined) {
        refund.status = validateEnumValue(refund.status, 'transaction_refunds.status', 'refund.status');
      }
      return refund;
    });
  }

  return converted;
}

/**
 * Convert shift data dates to MySQL format and validate ENUMs
 * Phase 2 Part 2: Also validates ENUM values
 */
export function convertShiftDatesForMySQL(shiftData: UnknownRecord): UnknownRecord {
  const converted = { ...shiftData };

  // Phase 2 Part 2: Validate kas_selisih_label ENUM
  if (converted.kas_selisih_label !== undefined) {
    converted.kas_selisih_label = validateEnumValue(converted.kas_selisih_label, 'shifts.kas_selisih_label', 'kas_selisih_label');
  }

  if (converted.shift_start) {
    const convertedStart = convertDateForMySQL(converted.shift_start, 'shift_start');
    if (convertedStart) {
      converted.shift_start = convertedStart;
    }
  }

  if (converted.shift_end) {
    const convertedEnd = convertDateForMySQL(converted.shift_end, 'shift_end');
    converted.shift_end = convertedEnd;
  }

  if (converted.created_at) {
    const convertedCreated = convertDateForMySQL(converted.created_at, 'created_at');
    if (convertedCreated) {
      converted.created_at = convertedCreated;
    }
  }

  if (converted.closed_at) {
    const convertedClosed = convertDateForMySQL(converted.closed_at, 'closed_at');
    converted.closed_at = convertedClosed;
  }

  // MySQL shifts table has updated_at as bigint, so convert if present
  if (converted.updated_at !== undefined) {
    if (typeof converted.updated_at === 'number') {
      // Keep as number (bigint in MySQL)
      converted.updated_at = converted.updated_at;
    } else {
      // Convert to timestamp if it's a string/date
      const date = new Date(String(converted.updated_at));
      if (!isNaN(date.getTime())) {
        converted.updated_at = date.getTime();
      } else {
        delete converted.updated_at;
      }
    }
  }

  return converted;
}
