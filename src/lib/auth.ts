'use client';

export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  role: 'admin' | 'cashier' | 'manager';
  organization_id: number;
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
            this.authState = {
              isAuthenticated: parsedState.isAuthenticated,
              user: parsedState.user,
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

  async login(email: string, password: string): Promise<User> {
    console.log('🔍 [AUTH] Starting login process...');
    try {
      // Call the login API
      console.log('🔍 [AUTH] Calling login API...');
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      console.log('🔍 [AUTH] API response status:', response.status);
      const data = await response.json();
      console.log('🔍 [AUTH] API response data:', data);

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      if (data.success && data.user) {
        console.log('🔍 [AUTH] Login successful, setting user state...');
        const user: User = {
          id: data.user.id,
          email: data.user.email,
          username: data.user.username,
          name: data.user.name,
          role: data.user.role,
          organization_id: data.user.organization_id,
        };
        
        this.authState = {
          isAuthenticated: true,
          user,
          isOfflineMode: false,
        };
        
        console.log('🔍 [AUTH] Notifying listeners...');
        this.notifyListeners();
        
        // Notify Electron about successful login
        console.log('🔍 [AUTH] Checking Electron API...');
        console.log('🔍 [AUTH] window object:', typeof window);
        console.log('🔍 [AUTH] window.electronAPI:', typeof window !== 'undefined' ? !!window.electronAPI : 'undefined');
        
        if (typeof window !== 'undefined' && window.electronAPI) {
          console.log('🔍 [AUTH] Electron API available, calling notifyLoginSuccess...');
          console.log('🔍 [AUTH] notifyLoginSuccess method:', typeof window.electronAPI.notifyLoginSuccess);
          
          try {
            const result = await window.electronAPI.notifyLoginSuccess();
            console.log('🔍 [AUTH] Electron login success result:', result);
          } catch (error) {
            console.error('🔍 [AUTH] Failed to notify Electron:', error);
          }
        } else {
          console.log('🔍 [AUTH] Electron API not available');
          console.log('🔍 [AUTH] window:', typeof window);
          if (typeof window !== 'undefined') {
            console.log('🔍 [AUTH] electronAPI:', window.electronAPI);
          }
        }
        
        console.log('🔍 [AUTH] Login process completed successfully');
        return user;
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (error) {
      console.error('🔍 [AUTH] Login error:', error);
      throw error;
    }
  }

  async loginOffline(): Promise<User> {
    console.log('🔍 [AUTH] Starting offline login...');
    const user: User = {
      id: 'offline',
      email: 'offline@marviano.com',
      username: 'offline_user',
      name: 'Offline User',
      role: 'cashier',
      organization_id: 1,
    };

    this.authState = {
      isAuthenticated: true,
      user,
      isOfflineMode: true,
    };

    console.log('🔍 [AUTH] Offline login - notifying listeners...');
    this.notifyListeners();
    
    // Notify Electron about successful offline login
    console.log('🔍 [AUTH] Offline login - checking Electron API...');
    if (typeof window !== 'undefined' && window.electronAPI) {
      console.log('🔍 [AUTH] Offline login - Electron API available, calling notifyLoginSuccess...');
      try {
        const result = await window.electronAPI.notifyLoginSuccess();
        console.log('🔍 [AUTH] Offline login - Electron result:', result);
      } catch (error) {
        console.error('🔍 [AUTH] Offline login - Failed to notify Electron:', error);
      }
    } else {
      console.log('🔍 [AUTH] Offline login - Electron API not available');
    }
    
    console.log('🔍 [AUTH] Offline login completed');
    return user;
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
