/**
 * Server settings management for WebSocket connections
 * Stores server address and port in localStorage
 */

const SERVER_ADDRESS_KEY = 'websocket_server_address';
const SERVER_PORT_KEY = 'websocket_server_port';

const DEFAULT_ADDRESS = 'localhost';
const DEFAULT_PORT = 19967;

export interface ServerSettings {
  address: string;
  port: number;
}

/**
 * Get server settings from localStorage
 */
export function getServerSettings(): ServerSettings {
  if (typeof window === 'undefined') {
    return { address: DEFAULT_ADDRESS, port: DEFAULT_PORT };
  }

  try {
    const address = localStorage.getItem(SERVER_ADDRESS_KEY) || DEFAULT_ADDRESS;
    const portStr = localStorage.getItem(SERVER_PORT_KEY);
    const port = portStr ? parseInt(portStr, 10) : DEFAULT_PORT;
    
    return {
      address,
      port: isNaN(port) ? DEFAULT_PORT : port
    };
  } catch (error) {
    console.error('Failed to get server settings:', error);
    return { address: DEFAULT_ADDRESS, port: DEFAULT_PORT };
  }
}

/**
 * Save server settings to localStorage
 */
export function saveServerSettings(settings: ServerSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(SERVER_ADDRESS_KEY, settings.address);
    localStorage.setItem(SERVER_PORT_KEY, settings.port.toString());
  } catch (error) {
    console.error('Failed to save server settings:', error);
  }
}

/**
 * Reset server settings to defaults
 */
export function resetServerSettings(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(SERVER_ADDRESS_KEY);
    localStorage.removeItem(SERVER_PORT_KEY);
  } catch (error) {
    console.error('Failed to reset server settings:', error);
  }
}
