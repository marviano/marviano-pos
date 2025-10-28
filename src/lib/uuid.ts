/**
 * UUID Generation Utilities
 * Generates RFC 4122 compliant UUIDs for transaction IDs
 */

/**
 * Generate a random UUID v4
 * @returns {string} A UUID string in format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 */
export function generateUUID(): string {
  // Use crypto.randomUUID if available (Node.js 14.17.0+)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Generate a UUID for transaction ID
 * @returns {string} A UUID string
 */
export function generateTransactionId(): string {
  return generateUUID();
}

/**
 * Generate a UUID for transaction item ID
 * @returns {string} A UUID string
 */
export function generateTransactionItemId(): string {
  return generateUUID();
}

/**
 * Validate if a string is a valid UUID
 * @param {string} uuid - The string to validate
 * @returns {boolean} True if valid UUID, false otherwise
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Generate a short UUID (8 characters) for display purposes
 * @returns {string} A short UUID string
 */
export function generateShortUUID(): string {
  return Math.random().toString(36).substr(2, 8);
}
