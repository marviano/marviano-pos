// Cache for runtime config to avoid repeated IPC calls
let cachedApiUrl: string | null = null;
let configCachePromise: Promise<string | null> | null = null;

/**
 * Clean URL to remove any potential console output contamination
 * Electron console messages can sometimes be appended to URLs
 */
export function cleanUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    return url;
  }
  // Remove any [ELECTRON] prefixes and console error messages that might have been appended
  let cleaned = url.split('[ELECTRON]')[0].split('source: devtools://')[0].trim();
  // Remove any trailing error messages that might have been appended
  cleaned = cleaned.split('ERROR:CONSOLE')[0].trim();
  return cleaned;
}

/**
 * Get API URL from runtime config (Electron) or environment variable
 */
async function getRuntimeApiUrl(): Promise<string | null> {
  // If we're in Electron, try to get config from IPC
  if (typeof window !== 'undefined' && window.electronAPI?.getAppConfig) {
    try {
      const result = await window.electronAPI.getAppConfig();
      if (result?.success && result.config?.apiUrl) {
        // Clean the URL immediately when reading from Electron config
        return cleanUrl(result.config.apiUrl.trim());
      }
    } catch (error) {
      console.warn('Failed to get API URL from runtime config:', error);
    }
  }
  
  // Fallback to environment variable - clean it immediately
  const envUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim();
  return envUrl ? cleanUrl(envUrl) : null;
}

/**
 * Get cached API URL (synchronous fallback)
 */
function getCachedApiUrl(): string | null {
  return cachedApiUrl;
}

/**
 * Initialize API URL cache (call this early in app lifecycle)
 */
export async function initApiUrlCache(): Promise<void> {
  if (configCachePromise) {
    cachedApiUrl = await configCachePromise;
    return;
  }
  
  configCachePromise = getRuntimeApiUrl();
  cachedApiUrl = await configCachePromise;
}

/**
 * Utility to get the full API URL based on runtime config or environment variables.
 * Ensures consistent URL construction for Electron and Web environments.
 */
export const getApiUrl = (path: string): string => {
  // If path already starts with http, return it as is
  if (path.startsWith('http')) {
    return path;
  }

  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  // Try to get base URL from cache first (synchronous)
  let baseUrl = getCachedApiUrl();
  
  // If no cached URL, try environment variable - clean it immediately
  if (!baseUrl) {
    const envUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim();
    baseUrl = envUrl ? cleanUrl(envUrl) : null;
  } else {
    // Clean cached URL in case it was corrupted
    baseUrl = cleanUrl(baseUrl);
  }
  
  // If still no base URL, check if we're in development mode
  if (!baseUrl) {
    const isDevelopment = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    
    if (isDevelopment) {
      // Allow localhost fallback only in development
      baseUrl = 'http://localhost:3000';
    } else {
      // In production, try to load config asynchronously (this will use env fallback on next call)
      // For now, throw error to indicate config is required
      throw new Error(
        'API URL is not configured. Please set it in Settings or NEXT_PUBLIC_API_URL environment variable.'
      );
    }
  }

  // Remove trailing slash from base URL if present
  let normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  // Auto-add port 3000 if missing for HTTP URLs (common default)
  // HTTPS URLs default to port 443, so we don't need to add a port for those
  if (normalizedBaseUrl.startsWith('http://') && !normalizedBaseUrl.match(/:\d+(\/|$)/)) {
    console.warn('⚠️ [API URL] URL tidak memiliki port number. Menambahkan port default :3000. Pastikan format: http://IP:PORT (contoh: http://192.168.1.16:3000)');
    normalizedBaseUrl = `${normalizedBaseUrl}:3000`;
  }
  // Note: HTTPS URLs without explicit port will use default port 443, which is fine

  // Ensure the path is properly appended (don't let server strip it)
  const finalUrl = `${normalizedBaseUrl}${normalizedPath}`;
  return finalUrl;
};

/**
 * POS write API key for ingest routes (transactions, refunds).
 * Set NEXT_PUBLIC_POS_WRITE_API_KEY or POS_WRITE_API_KEY to match server POS_WRITE_API_KEY.
 */
export function getPosWriteApiKey(): string {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_POS_WRITE_API_KEY) return process.env.NEXT_PUBLIC_POS_WRITE_API_KEY;
  if (typeof process !== 'undefined' && process.env?.POS_WRITE_API_KEY) return process.env.POS_WRITE_API_KEY;
  return '';
}



