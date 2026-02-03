import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface AppConfig {
  serverHost?: string;
  apiUrl?: string;
  dbUser?: string;
  dbPassword?: string;
  dbName?: string;
  dbPort?: number;
}

const CONFIG_FILE_NAME = 'pos-config.json';

/**
 * Get the path to the config file in user data directory
 */
function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE_NAME);
}

/**
 * Read configuration from file
 * Returns null if file doesn't exist or is invalid
 */
export function readConfig(): AppConfig | null {
  try {
    const configPath = getConfigPath();
    
    if (!fs.existsSync(configPath)) {
      return null;
    }

    const fileContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(fileContent) as AppConfig;
    
    return config;
  } catch (error) {
    console.error('❌ Failed to read config file:', error);
    return null;
  }
}

/**
 * Write configuration to file
 */
export function writeConfig(config: AppConfig): boolean {
  try {
    const configPath = getConfigPath();
    const configDir = path.dirname(configPath);
    
    // Ensure directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Write config file
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    
    return true;
  } catch (error) {
    console.error('❌ Failed to write config file:', error);
    return false;
  }
}

/**
 * Reset configuration (delete config file to use .env defaults)
 */
export function resetConfig(): boolean {
  try {
    const configPath = getConfigPath();
    
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
      console.log('✅ Config file deleted, will use .env defaults');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Failed to reset config file:', error);
    return false;
  }
}

/**
 * Get a config value with fallback to environment variable
 */
export function getConfigValue<K extends keyof AppConfig>(
  key: K,
  envFallback?: string
): AppConfig[K] | undefined {
  const config = readConfig();
  const value = config?.[key];
  
  if (value !== undefined && value !== null && value !== '') {
    return value;
  }
  
  // Fallback to environment variable if provided
  if (envFallback) {
    const envValue = process.env[envFallback];
    if (envValue) {
      return envValue as AppConfig[K];
    }
  }
  
  return undefined;
}

/**
 * Get server host (DB_HOST) with fallback
 */
export function getServerHost(): string {
  return (
    getConfigValue('serverHost', 'DB_HOST') || 
    'localhost'
  );
}

/**
 * Get API URL with fallback
 */
export function getApiUrl(): string | undefined {
  return getConfigValue('apiUrl', 'NEXT_PUBLIC_API_URL');
}

/**
 * Get database configuration with fallbacks
 */
export function getDbConfig(): {
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
} {
  const rawUser = getConfigValue('dbUser', 'DB_USER') || 'root';
  const user = (typeof rawUser === 'string' ? rawUser : String(rawUser)).trim() || 'root';
  return {
    host: getServerHost(),
    user,
    password: getConfigValue('dbPassword', 'DB_PASSWORD') || '',
    database: getConfigValue('dbName', 'DB_NAME') || 'salespulse',
    port: getConfigValue('dbPort') || parseInt(process.env.DB_PORT || '3306', 10),
  };
}

export type DbConfig = { host: string; user: string; password: string; database: string; port: number };

/** Local MySQL (localhost). Used for dual-write when primary is salespulse. */
export function getLocalDbConfig(): DbConfig {
  return {
    host: 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'salespulse',
    port: parseInt(process.env.DB_PORT || '3306', 10),
  };
}

/** Salespulse VPS MySQL. Set DB_VPS_HOST (and optionally DB_VPS_USER, etc.) in .env for dual-write. */
export function getVpsDbConfig(): DbConfig | null {
  const host = process.env.DB_VPS_HOST?.trim();
  if (!host) return null;
  return {
    host,
    user: process.env.DB_VPS_USER || process.env.DB_USER || 'root',
    password: process.env.DB_VPS_PASSWORD ?? process.env.DB_PASSWORD ?? '',
    database: process.env.DB_VPS_NAME || process.env.DB_NAME || 'salespulse',
    port: parseInt(process.env.DB_VPS_PORT || process.env.DB_PORT || '3306', 10),
  };
}

/** Mirror DB for dual-write: if primary is localhost, mirror = VPS; else mirror = localhost. Null if no mirror (e.g. DB_VPS_HOST not set when primary is localhost). */
export function getMirrorDbConfig(): DbConfig | null {
  const primary = getDbConfig();
  const isPrimaryLocal = primary.host === 'localhost' || primary.host === '127.0.0.1';
  if (isPrimaryLocal) {
    return getVpsDbConfig();
  }
  return getLocalDbConfig();
}

