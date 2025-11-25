/**
 * Utility to get the full API URL based on environment variables.
 * Ensures consistent URL construction for Electron and Web environments.
 */
export const getApiUrl = (path: string): string => {
  const baseUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim();
  
  // If path already starts with http, return it as is
  if (path.startsWith('http')) {
    return path;
  }

  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  // If no base URL is set (development), return relative path
  if (!baseUrl) {
    return normalizedPath;
  }

  // Remove trailing slash from base URL if present
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  return `${normalizedBaseUrl}${normalizedPath}`;
};



