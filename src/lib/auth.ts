'use client';

import bcrypt from 'bcryptjs';
import { addSavedEmail } from '@/lib/savedLoginEmails';

const KNOWN_ROLES = ['admin', 'cashier', 'manager'] as const;
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

  private filterAppPermissions(rawPermissions: any): string[] {
    if (!Array.isArray(rawPermissions)) {
      return [];
    }

    return rawPermissions
      .filter((perm): perm is string => typeof perm === 'string' && perm.startsWith('marviano-pos_'))
      .sort((a, b) => a.localeCompare(b));
  }

  private normalizeRole(roleName?: string | null): KnownRole {
    const normalized = (roleName || 'cashier').toLowerCase();
    if ((KNOWN_ROLES as readonly string[]).includes(normalized)) {
      return normalized as KnownRole;
    }
    return 'cashier';
  }

  private sanitizeUser(user: any): User | null {
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
      email: user.email,
      username: user.username ?? user.email,
      name: user.name ?? user.email,
      role: this.normalizeRole(user.role),
      role_name: user.role_name ?? user.role ?? null,
      organization_id: normalizedOrganizationId,
      role_id: roleIdValue,
      permissions: this.filterAppPermissions(user.permissions),
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
    console.log('🔍 [AUTH] Starting login process...');
    try {
      // Call the login API
      console.log('🔍 [AUTH] Calling login API...');
      let response: Response | null = null;
      let data: any = null;

      try {
        response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });
        console.log('🔍 [AUTH] API response status:', response.status);
        data = await response.json();
        console.log('🔍 [AUTH] API response data:', data);
      } catch (networkError: any) {
        console.warn('⚠️ [AUTH] Online login failed, attempting offline fallback...', networkError);
        return this.tryOfflineLogin(email, password);
      }

      if (!response.ok) {
        const errorMessage = data?.error || 'Login failed';

        if (response.status >= 500) {
          console.warn('⚠️ [AUTH] Server error during login, attempting offline fallback...');
          try {
            return await this.tryOfflineLogin(email, password);
          } catch (offlineError) {
            console.error('❌ [AUTH] Offline fallback failed:', offlineError);
            throw new Error(errorMessage);
          }
        }

        throw new Error(errorMessage);
      }

      if (data?.success && data.user) {
        console.log('🔍 [AUTH] Login successful, setting user state...');
        const sanitizedUser = this.sanitizeUser({
          ...data.user,
          role_name: data.user.role_name ?? data.user.role,
        });
        if (!sanitizedUser) {
          throw new Error('Invalid user payload received');
        }

        this.setAuthenticatedUser(sanitizedUser, false);
        addSavedEmail(sanitizedUser.email);
        await this.notifyElectronLoginSuccess();
        console.log('🔍 [AUTH] Login process completed successfully');
        return sanitizedUser;
      }

      throw new Error('Invalid response from server');
    } catch (error) {
      console.error('🔍 [AUTH] Login error:', error);
      throw error;
    }
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

  logout(): void {
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
      window.electronAPI.notifyLogout();
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
}

export const authManager = AuthManager.getInstance();
