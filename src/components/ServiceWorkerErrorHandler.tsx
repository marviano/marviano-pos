'use client';

import { useEffect } from 'react';

/**
 * ServiceWorkerErrorHandler
 * 
 * Suppresses non-critical service worker cache errors in Electron.
 * 
 * The error occurs because:
 * - Service workers try to cache POST requests using the Cache API
 * - The Cache API only supports GET requests
 * - This is non-critical because Electron doesn't need service workers for offline functionality
 * 
 * This component intercepts and suppresses these specific errors to keep the console clean.
 */
export default function ServiceWorkerErrorHandler() {
  useEffect(() => {
    // Only run in browser environment
    if (typeof window === 'undefined') {
      return;
    }

    // Intercept unhandled promise rejections (service worker errors are often unhandled)
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason;
      const errorMessage = error?.message || String(error);
      
      // Check if this is the service worker cache error we want to suppress
      if (
        errorMessage.includes('Failed to execute \'put\' on \'Cache\'') ||
        errorMessage.includes('Request method \'POST\' is unsupported') ||
        (errorMessage.includes('Cache') && errorMessage.includes('POST'))
      ) {
        // Suppress this error - it's non-critical
        event.preventDefault();
        // Optionally log it at debug level (commented out to keep console clean)
        // console.debug('[Service Worker] Suppressed cache error (non-critical):', errorMessage);
        return;
      }
      
      // Let other errors through normally
    };

    // Intercept console errors from service workers
    // Note: We use a more targeted approach by checking error stack traces
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    
    console.error = (...args: unknown[]) => {
      const errorString = args.map(arg => String(arg)).join(' ');
      const stackString = args.find(arg => arg instanceof Error && arg.stack) 
        ? (args.find(arg => arg instanceof Error) as Error).stack || ''
        : '';
      
      // Check if this is the service worker cache error
      if (
        (errorString.includes('sw.js') || stackString.includes('sw.js')) &&
        (errorString.includes('Failed to execute \'put\' on \'Cache\'') ||
         errorString.includes('Request method \'POST\' is unsupported') ||
         errorString.includes('Cache') && errorString.includes('POST'))
      ) {
        // Suppress this specific error - it's non-critical in Electron
        return;
      }
      
      // Call original console.error for other errors
      originalConsoleError.apply(console, args);
    };
    
    // Also intercept console.warn for similar messages
    console.warn = (...args: unknown[]) => {
      const errorString = args.map(arg => String(arg)).join(' ');
      
      // Check if this is the service worker cache warning
      if (
        errorString.includes('sw.js') &&
        (errorString.includes('Cache') && errorString.includes('POST'))
      ) {
        // Suppress this specific warning
        return;
      }
      
      // Call original console.warn for other warnings
      originalConsoleWarn.apply(console, args);
    };

    // Add event listener for unhandled promise rejections
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    // Cleanup
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      // Restore original console methods
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
    };
  }, []);

  // This component doesn't render anything
  return null;
}

















