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

    // Intercept console errors/warns from service workers.
    // Optimization: only do string serialization when the first arg is a string containing 'sw.js'
    // or an Error, avoiding the overhead on every unrelated console call.
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;

    const isSwRelated = (args: unknown[]): boolean => {
      const first = args[0];
      if (typeof first === 'string' && first.includes('sw.js')) return true;
      if (first instanceof Error && first.stack?.includes('sw.js')) return true;
      return false;
    };

    const isCachePostError = (args: unknown[]): boolean => {
      const s = String(args[0]);
      return (
        s.includes('Failed to execute \'put\' on \'Cache\'') ||
        s.includes('Request method \'POST\' is unsupported') ||
        (s.includes('Cache') && s.includes('POST'))
      );
    };

    console.error = (...args: unknown[]) => {
      if (isSwRelated(args) && isCachePostError(args)) return;
      originalConsoleError.apply(console, args);
    };

    console.warn = (...args: unknown[]) => {
      if (isSwRelated(args) && isCachePostError(args)) return;
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

















