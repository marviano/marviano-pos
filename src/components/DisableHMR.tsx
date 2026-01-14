'use client';

import { useEffect } from 'react';

/**
 * Disables Next.js HMR (Hot Module Replacement) WebSocket connection
 * Since we're using static export (output: 'export'), HMR is not needed
 * and the WebSocket connection attempts cause errors in the console
 */
export default function DisableHMR() {
  useEffect(() => {
    // Suppress HMR WebSocket connection attempts
    if (typeof window !== 'undefined') {
      // Override WebSocket to prevent HMR connections
      const originalWebSocket = window.WebSocket;
      
      // Only intercept HMR-related WebSocket connections
      (window as Window & { WebSocket: typeof WebSocket }).WebSocket = class extends originalWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          const urlString = typeof url === 'string' ? url : url.toString();
          
          // Block HMR WebSocket connections
          if (urlString.includes('webpack-hmr') || urlString.includes('_next/webpack-hmr')) {
            // Create a dummy WebSocket that does nothing
            super('ws://localhost:0', protocols);
            // Immediately close it
            setTimeout(() => {
              try {
                this.close();
              } catch {
                // Ignore errors
              }
            }, 0);
            return;
          }
          
          // Allow all other WebSocket connections
          super(url, protocols);
        }
      };
      
      // Cleanup on unmount
      return () => {
        (window as Window & { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
      };
    }
  }, []);

  return null;
}
