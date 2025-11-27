'use client';

import { useEffect } from 'react';

/**
 * WindowFocusHandler
 * 
 * Fixes Windows 11 frameless window focus issues where clicking on inputs
 * doesn't activate the window, preventing typing.
 * 
 * This component adds a global mousedown listener that ensures the Electron
 * window is focused whenever the user interacts with any part of the app.
 */
export default function WindowFocusHandler() {
  useEffect(() => {
    // Only run in Electron environment
    if (typeof window === 'undefined' || !window.electronAPI?.focusWindow) {
      return;
    }

    let isWindowFocused = true;
    let focusTimeout: NodeJS.Timeout | null = null;

    // Handle window blur/focus to track focus state
    const handleBlur = () => {
      isWindowFocused = false;
    };

    const handleFocus = () => {
      isWindowFocused = true;
    };

    // Handle mousedown events to ensure window is focused
    const handleMouseDown = async (e: MouseEvent) => {
      // If window is already focused, no need to do anything
      if (isWindowFocused) {
        return;
      }

      // Debounce focus calls to avoid excessive IPC calls
      if (focusTimeout) {
        return;
      }

      focusTimeout = setTimeout(() => {
        focusTimeout = null;
      }, 100);

      try {
        // Request focus from Electron main process
        await window.electronAPI.focusWindow();
        
        // Special handling for input elements
        const target = e.target as HTMLElement;
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable
        ) {
          // Give the window a moment to activate, then refocus the input
          setTimeout(() => {
            if (target && typeof (target as HTMLInputElement).focus === 'function') {
              (target as HTMLInputElement).focus();
            }
          }, 50);
        }
      } catch (error) {
        console.error('Error focusing window:', error);
      }
    };

    // Add event listeners
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('mousedown', handleMouseDown, true);

    // Cleanup
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('mousedown', handleMouseDown, true);
      if (focusTimeout) {
        clearTimeout(focusTimeout);
      }
    };
  }, []);

  // This component doesn't render anything
  return null;
}

