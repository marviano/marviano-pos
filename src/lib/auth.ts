'use client';

import bcrypt from 'bcryptjs';
import { addSavedEmail } from '@/lib/savedLoginEmails';
import { getApiUrl } from '@/lib/api';

const KNOWN_ROLES = ['admin', 'cashier', 'manager', 'super admin'] as const;
type KnownRole = (typeof KNOWN_ROLES)[number];

export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  role: KnownRole;
  role_name?: string | null;
  organization_id: number;
  role_id?: number | null;
  permissions: string[];
  selectedBusinessId?: number | null;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  isOfflineMode: boolean;
}

class AuthManager {
  private static instance: AuthManager;
  private authState: AuthState = {
    isAuthenticated: false,
    user: null,
    isOfflineMode: false,
  };

  private listeners: ((state: AuthState) => void)[] = [];

  static getInstance(): AuthManager {
    if (!AuthManager.instance) {
      AuthManager.instance = new AuthManager();
      // Try to restore auth state from localStorage
      AuthManager.instance.loadAuthState();
    }
    return AuthManager.instance;
  }

  private loadAuthState(): void {
    // Always start with unauthenticated state to prevent hydration mismatch
    this.authState = {
      isAuthenticated: false,
      user: null,
      isOfflineMode: false,
    };

    // Only try to restore state on the client side
    if (typeof window !== 'undefined') {
      try {
        const savedState = localStorage.getItem('marviano_auth_state');
        if (savedState) {
          const parsedState = JSON.parse(savedState);
          // Only restore if it's recent (within 24 hours)
          if (parsedState.timestamp && Date.now() - parsedState.timestamp < 24 * 60 * 60 * 1000) {
            const restoredUser = this.sanitizeUser(parsedState.user);
            this.authState = {
              isAuthenticated: Boolean(parsedState.isAuthenticated && restoredUser),
              user: restoredUser,
              isOfflineMode: parsedState.isOfflineMode,
            };
            // Notify listeners after restoring state
            this.notifyListeners();
            // Tell Electron to set hasLoggedIn and maximize (returning user skips login form)
            void this.notifyElectronLoginSuccess();
          }
        }
      } catch (error) {
        console.error('Failed to load auth state:', error);
      }
    }
  }

  private saveAuthState(): void {
    try {
      // Check if we're in a browser environment
      if (typeof window !== 'undefined' && window.localStorage) {
        const stateToSave = {
          ...this.authState,
          timestamp: Date.now(),
        };
        localStorage.setItem('marviano_auth_state', JSON.stringify(stateToSave));
      }
    } catch (error) {
      console.error('Failed to save auth state:', error);
    }
  }

  subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(): void {
    this.saveAuthState();
    this.listeners.forEach(listener => listener(this.authState));
  }

  private filterAppPermissions(rawPermissions: unknown): string[] {
    if (!Array.isArray(rawPermissions)) {
      return [];
    }

    const legacyMap: Record<string, string> = {
      'marviano-pos_setelan_printer-setup': 'setelan.printersetup',
      'marviano-pos_setelan_sinkronisasi': 'setelan.sinkronisasi',
    };

    const normalizedPermissions = new Set<string>();

    for (const rawPermission of rawPermissions) {
      if (typeof rawPermission !== 'string') {
        continue;
      }

      const trimmed = rawPermission.trim();
      if (!trimmed) {
        continue;
      }

      const mapped = legacyMap[trimmed];
      if (mapped) {
        normalizedPermissions.add(mapped);
        continue;
      }

      if (trimmed.startsWith('marviano-pos_')) {
        normalizedPermissions.add(trimmed);
        continue;
      }

      if (/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i.test(trimmed)) {
        normalizedPermissions.add(trimmed);
      }
    }

    return Array.from(normalizedPermissions).sort((a, b) => a.localeCompare(b));
  }

  private normalizeRole(roleName?: string | null): KnownRole {
    const normalized = (roleName || 'cashier').toLowerCase();
    
    // Map super admin to admin for basic role checks if needed, 
    // or keep it as its own role if the app supports it.
    // For now, let's allow 'super admin' to pass through since we added it to KNOWN_ROLES
    
    if ((KNOWN_ROLES as readonly string[]).includes(normalized)) {
      return normalized as KnownRole;
    }
    return 'cashier';
  }

  private sanitizeUser(user: Record<string, unknown> | null | undefined): User | null {
    if (!user) {
      return null;
    }

    const organizationId = Number(user.organization_id ?? 0);
    const normalizedOrganizationId = Number.isFinite(organizationId) ? organizationId : 0;
    const roleIdValue =
      user.role_id !== null && user.role_id !== undefined && Number.isFinite(Number(user.role_id))
        ? Number(user.role_id)
        : null;

    return {
      id: String(user.id),
      email: String(user.email ?? ''),
      username: String(user.username ?? user.email ?? ''),
      name: String(user.name ?? user.email ?? ''),
      role: this.normalizeRole(typeof user.role === 'string' ? user.role : undefined),
      role_name: (typeof user.role_name === 'string' ? user.role_name : null) ?? (typeof user.role === 'string' ? user.role : null) ?? null,
      organization_id: normalizedOrganizationId,
      role_id: roleIdValue,
      permissions: this.filterAppPermissions(user.permissions),
      selectedBusinessId: user.selectedBusinessId !== undefined ? (user.selectedBusinessId !== null ? Number(user.selectedBusinessId) : null) : undefined,
    };
  }

  private setAuthenticatedUser(user: User, isOfflineMode: boolean): void {
    this.authState = {
      isAuthenticated: true,
      user,
      isOfflineMode,
    };

    this.notifyListeners();
  }

  private async notifyElectronLoginSuccess() {
    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        await window.electronAPI.notifyLoginSuccess();
      } catch (error) {
        console.error('🔍 [AUTH] Failed to notify Electron:', error);
      }
    }
  }

  /** Offline-first: try local MySQL first. Returns user + _businesses for selection flow, or null to fall back to online. */
  private async tryLocalFirstLogin(
    email: string,
    password: string
  ): Promise<(User & { _businesses?: unknown[]; _isSuperAdmin?: boolean; _isOfflineMode?: boolean }) | null> {
    if (typeof window === 'undefined' || !window.electronAPI?.localDbGetUserAuth) {
      return null;
    }

    const offlineUser = await window.electronAPI.localDbGetUserAuth(email);
    if (!offlineUser?.password) {
      return null;
    }

    const passwordMatches = await bcrypt.compare(password, offlineUser.password);
    if (!passwordMatches) {
      return null;
    }

    const sanitizedUser = this.sanitizeUser({
      id: offlineUser.id,
      email: offlineUser.email,
      username: offlineUser.email,
      name: offlineUser.name,
      role: offlineUser.role_name,
      role_name: offlineUser.role_name,
      organization_id: offlineUser.organization_id,
      role_id: offlineUser.role_id,
      permissions: offlineUser.permissions,
    });
    if (!sanitizedUser) {
      return null;
    }

    let businesses: unknown[] = [];
    if (window.electronAPI.localDbGetBusinesses) {
      const rows = await window.electronAPI.localDbGetBusinesses();
      type BusinessRow = { id?: number; name?: string; permission_name?: string };
      businesses = Array.isArray(rows)
        ? (rows as BusinessRow[]).map((r) => ({
            id: Number(r?.id ?? 0),
            name: String(r?.name ?? ''),
            permission_name: String(r?.permission_name ?? 'pos'),
          }))
        : [];
    }

    console.log('🔍 [AUTH] Local login successful, returning user + businesses for selection');
    return {
      ...sanitizedUser,
      _businesses: businesses,
      _isSuperAdmin: false,
      _isOfflineMode: true,
    };
  }

  private async tryOfflineLogin(email: string, password: string): Promise<User> {
    if (typeof window === 'undefined' || !window.electronAPI?.localDbGetUserAuth) {
      throw new Error('Offline login is not available on this platform');
    }

    console.log('🔍 [AUTH] Attempting offline login...');
    const offlineUser = await window.electronAPI.localDbGetUserAuth(email);

    if (!offlineUser) {
      throw new Error('Offline login unavailable for this user. Please sync while online.');
    }

    if (!offlineUser.password) {
      throw new Error('Offline login unavailable: password not cached. Please login online once.');
    }

    const passwordMatches = await bcrypt.compare(password, offlineUser.password);

    if (!passwordMatches) {
      throw new Error('Invalid email or password');
    }

    const sanitizedUser = this.sanitizeUser({
      id: offlineUser.id,
      email: offlineUser.email,
      username: offlineUser.email,
      name: offlineUser.name,
      role: offlineUser.role_name,
      role_name: offlineUser.role_name,
      organization_id: offlineUser.organization_id,
      role_id: offlineUser.role_id,
      permissions: offlineUser.permissions,
    });

    if (!sanitizedUser) {
      throw new Error('Offline user data is invalid. Please login online once.');
    }

    this.setAuthenticatedUser(sanitizedUser, true);
    addSavedEmail(sanitizedUser.email);
    await this.notifyElectronLoginSuccess();
    console.log('🔍 [AUTH] Offline login completed successfully');
    return sanitizedUser;
  }

  async login(email: string, password: string): Promise<User> {
    console.log('🔍 [AUTH] Starting login process (offline-first)...');
    try {
      // Offline-first: try local MySQL first; no network required when user is synced locally
      const localResult = await this.tryLocalFirstLogin(email, password);
      if (localResult != null) {
        return localResult;
      }

      // User not in local DB or password mismatch: fall back to online API
      const loginUrl = getApiUrl('/api/auth/login');
      console.log('🔍 [AUTH] Local user not found or password mismatch, trying online API...');

      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as Record<string, unknown>;

      if (!response.ok) {
        const errorMessage = typeof data?.error === 'string' ? data.error : 'Login failed';
        throw new Error(errorMessage);
      }

      if (data?.success && data.user) {
        console.log('🔍 [AUTH] Online login successful, returning user data...');
        const userData = data.user as Record<string, unknown>;
        const sanitizedUser = this.sanitizeUser({
          ...userData,
          role_name:
            (typeof userData.role_name === 'string' ? userData.role_name : null) ??
            (typeof userData.role === 'string' ? userData.role : null),
        });
        if (!sanitizedUser) {
          throw new Error('Invalid user payload received');
        }

        interface UserWithBusinesses extends User {
          _businesses?: unknown[];
          _isSuperAdmin?: boolean;
        }
        return {
          ...sanitizedUser,
          _businesses: (data.businesses as unknown[]) || [],
          _isSuperAdmin: (data.isSuperAdmin as boolean) || false,
        } as UserWithBusinesses;
      }

      throw new Error('Invalid response from server');
    } catch (error) {
      console.error('🔍 [AUTH] Login error:', error);
      throw error;
    }
  }

  async completeLogin(
    user: User & { _businesses?: unknown[]; _isSuperAdmin?: boolean; _isOfflineMode?: boolean },
    selectedBusinessId: number | null
  ): Promise<User> {
    console.log('🔍 [AUTH] Completing login with business selection...');

    // Remove temporary properties
    interface UserWithTempProps extends User {
      _businesses?: unknown[];
      _isSuperAdmin?: boolean;
      _isOfflineMode?: boolean;
    }
    const { _businesses, _isSuperAdmin, _isOfflineMode, ...cleanUser } = user as UserWithTempProps;
    void _businesses;
    void _isSuperAdmin;

    const userWithBusiness: User = {
      ...cleanUser,
      selectedBusinessId,
    };

    this.setAuthenticatedUser(userWithBusiness, _isOfflineMode ?? false);
    addSavedEmail(userWithBusiness.email);
    await this.notifyElectronLoginSuccess();
    console.log('🔍 [AUTH] Login process completed successfully');
    return userWithBusiness;
  }

  async loginOffline(): Promise<User> {
    console.log('🔍 [AUTH] Starting offline login...');
    const cachedUser = this.authState.user;

    if (!cachedUser) {
      throw new Error('Offline login unavailable. Please login online at least once.');
    }

    this.setAuthenticatedUser(cachedUser, true);
    if (cachedUser?.email) {
      addSavedEmail(cachedUser.email);
    }
    
    console.log('🔍 [AUTH] Offline login - checking Electron API...');
    await this.notifyElectronLoginSuccess();
    
    console.log('🔍 [AUTH] Offline login completed with cached credentials');
    return cachedUser;
  }

  logout(options?: { redirect?: boolean }): void {
    this.authState = {
      isAuthenticated: false,
      user: null,
      isOfflineMode: false,
    };
    
    // Clear localStorage
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem('marviano_auth_state');
      }
    } catch (error) {
      console.error('Failed to clear auth state:', error);
    }
    
    this.notifyListeners();
    
    // Notify Electron about logout
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.notifyLogout?.().catch(error => {
        console.error('Failed to notify Electron about logout:', error);
      });
    }

    const shouldRedirect = options?.redirect !== false;
    if (shouldRedirect && typeof window !== 'undefined') {
      try {
        // Use root relative path which works for both dev (localhost:3000/login)
        // and production if configured correctly with simple routing
        if (window.location.pathname !== '/login' && !window.location.pathname.endsWith('/login')) {
          window.location.href = '/login';
        }
      } catch (error) {
        console.error('Failed to redirect to login after logout:', error);
      }
    }
  }

  getAuthState(): AuthState {
    return { ...this.authState };
  }

  isAuthenticated(): boolean {
    return this.authState.isAuthenticated;
  }

  getCurrentUser(): User | null {
    return this.authState.user;
  }

  isOfflineMode(): boolean {
    return this.authState.isOfflineMode;
  }

  isSuperAdmin(): boolean {
    const user = this.authState.user;
    if (!user) {
      return false;
    }
    return isSuperAdminRole(user.role_name);
  }
}

export const authManager = AuthManager.getInstance();

/** Normalize role string and check for super admin (handles "super admin", "superadmin", "Super Admin", etc.) */
function isSuperAdminRole(roleName?: string | null): boolean {
  if (!roleName || typeof roleName !== 'string') return false;
  const normalized = roleName.toLowerCase().replace(/\s+/g, '');
  return normalized === 'superadmin';
}

// Utility function to check if a user is super admin
export function isSuperAdmin(user: User | null): boolean {
  if (!user) {
    return false;
  }
  return isSuperAdminRole(user.role_name) || isSuperAdminRole(String(user.role ?? ''));
}
