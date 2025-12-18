/**
 * Utility to get the full API URL based on environment variables.
 * Ensures consistent URL construction for Electron and Web environments.
 */
export const getApiUrl = (path: string): string => {
  // If path already starts with http, return it as is
  if (path.startsWith('http')) {
    return path;
  }

  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  // Get base URL from environment or use default
  let baseUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim();
  
  // If no base URL is set, use production default (salespulse.cc)
  // In development, you can set NEXT_PUBLIC_API_URL=http://localhost:3000
  if (!baseUrl) {
    // Check if we're in development mode (Next.js dev server)
    const isDevelopment = typeof window !== 'undefined' && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    
    baseUrl = isDevelopment 
      ? 'http://localhost:3000'  // Local development
      : 'https://salespulse.cc';  // Production (default for Electron)
  }

  // Remove trailing slash from base URL if present
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  return `${normalizedBaseUrl}${normalizedPath}`;
};



