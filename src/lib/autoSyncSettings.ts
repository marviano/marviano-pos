/**
 * Auto Sync Settings Management
 * Manages the auto-sync toggle state in localStorage
 */

const STORAGE_KEY = 'marviano_auto_sync_enabled';

/**
 * Get the current auto-sync enabled state
 * Defaults to true (enabled) if not set
 */
export function getAutoSyncEnabled(): boolean {
  if (typeof window === 'undefined') {
    return true; // Default to enabled for SSR
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      // Not set yet, default to true
      return true;
    }
    return stored === 'true';
  } catch (error) {
    console.warn('⚠️ Failed to read auto-sync setting from localStorage:', error);
    return true; // Default to enabled on error
  }
}

/**
 * Set the auto-sync enabled state
 */
export function setAutoSyncEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
    // Dispatch custom event so components can react to changes
    window.dispatchEvent(new CustomEvent('autoSyncSettingChanged', { detail: { enabled } }));
  } catch (error) {
    console.error('❌ Failed to save auto-sync setting to localStorage:', error);
  }
}

/**
 * Listen to auto-sync setting changes
 */
export function onAutoSyncSettingChanged(callback: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}; // No-op for SSR
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<{ enabled: boolean }>;
    callback(customEvent.detail.enabled);
  };

  window.addEventListener('autoSyncSettingChanged', handler);
  
  // Return cleanup function
  return () => {
    window.removeEventListener('autoSyncSettingChanged', handler);
  };
}
















