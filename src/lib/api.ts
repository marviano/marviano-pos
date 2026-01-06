// Cache for runtime config to avoid repeated IPC calls
let cachedApiUrl: string | null = null;
let configCachePromise: Promise<string | null> | null = null;

/**
 * Get API URL from runtime config (Electron) or environment variable
 */
async function getRuntimeApiUrl(): Promise<string | null> {
  // If we're in Electron, try to get config from IPC
  if (typeof window !== 'undefined' && window.electronAPI?.getAppConfig) {
    try {
      const result = await window.electronAPI.getAppConfig();
      if (result?.success && result.config?.apiUrl) {
        return result.config.apiUrl.trim();
      }
    } catch (error) {
      console.warn('Failed to get API URL from runtime config:', error);
    }
  }
  
  // Fallback to environment variable
  return (process.env.NEXT_PUBLIC_API_URL || '').trim() || null;
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
  
  // If no cached URL, try environment variable
  if (!baseUrl) {
    baseUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim();
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

  const finalUrl = `${normalizedBaseUrl}${normalizedPath}`;
  return finalUrl;
};



