"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readConfig = readConfig;
exports.writeConfig = writeConfig;
exports.resetConfig = resetConfig;
exports.getConfigValue = getConfigValue;
exports.getServerHost = getServerHost;
exports.getApiUrl = getApiUrl;
exports.getDbConfig = getDbConfig;
exports.getLocalDbConfig = getLocalDbConfig;
exports.getVpsDbConfig = getVpsDbConfig;
exports.getMirrorDbConfig = getMirrorDbConfig;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const CONFIG_FILE_NAME = 'pos-config.json';
/**
 * Get the path to the config file in user data directory
 */
function getConfigPath() {
    return path.join(electron_1.app.getPath('userData'), CONFIG_FILE_NAME);
}
/**
 * Read configuration from file
 * Returns null if file doesn't exist or is invalid
 */
function readConfig() {
    try {
        const configPath = getConfigPath();
        if (!fs.existsSync(configPath)) {
            return null;
        }
        const fileContent = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(fileContent);
        return config;
    }
    catch (error) {
        console.error('❌ Failed to read config file:', error);
        return null;
    }
}
/**
 * Write configuration to file
 */
function writeConfig(config) {
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
    }
    catch (error) {
        console.error('❌ Failed to write config file:', error);
        return false;
    }
}
/**
 * Reset configuration (delete config file to use .env defaults)
 */
function resetConfig() {
    try {
        const configPath = getConfigPath();
        if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
            console.log('✅ Config file deleted, will use .env defaults');
        }
        return true;
    }
    catch (error) {
        console.error('❌ Failed to reset config file:', error);
        return false;
    }
}
/**
 * Get a config value with fallback to environment variable
 */
function getConfigValue(key, envFallback) {
    const config = readConfig();
    const value = config?.[key];
    if (value !== undefined && value !== null && value !== '') {
        return value;
    }
    // Fallback to environment variable if provided
    if (envFallback) {
        const envValue = process.env[envFallback];
        if (envValue) {
            return envValue;
        }
    }
    return undefined;
}
/**
 * Get server host (DB_HOST) with fallback
 */
function getServerHost() {
    return (getConfigValue('serverHost', 'DB_HOST') ||
        'localhost');
}
/**
 * Get API URL with fallback
 */
function getApiUrl() {
    return getConfigValue('apiUrl', 'NEXT_PUBLIC_API_URL');
}
/**
 * Get database configuration with fallbacks
 */
function getDbConfig() {
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
/** Local MySQL (localhost). Used for dual-write when primary is salespulse. */
function getLocalDbConfig() {
    return {
        host: 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'salespulse',
        port: parseInt(process.env.DB_PORT || '3306', 10),
    };
}
/** Salespulse VPS MySQL. Set DB_VPS_HOST (and optionally DB_VPS_USER, etc.) in .env for dual-write. */
function getVpsDbConfig() {
    const host = process.env.DB_VPS_HOST?.trim();
    if (!host)
        return null;
    return {
        host,
        user: process.env.DB_VPS_USER || process.env.DB_USER || 'root',
        password: process.env.DB_VPS_PASSWORD ?? process.env.DB_PASSWORD ?? '',
        database: process.env.DB_VPS_NAME || process.env.DB_NAME || 'salespulse',
        port: parseInt(process.env.DB_VPS_PORT || process.env.DB_PORT || '3306', 10),
    };
}
/** Mirror DB for dual-write: if primary is localhost, mirror = VPS; else mirror = localhost. Null if no mirror (e.g. DB_VPS_HOST not set when primary is localhost). */
function getMirrorDbConfig() {
    const primary = getDbConfig();
    const isPrimaryLocal = primary.host === 'localhost' || primary.host === '127.0.0.1';
    if (isPrimaryLocal) {
        return getVpsDbConfig();
    }
    return getLocalDbConfig();
}
