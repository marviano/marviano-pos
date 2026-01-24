'use client';

import { useState, useEffect } from 'react';
import { authManager, AuthState } from '@/lib/auth';

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>(authManager.getAuthState());

  useEffect(() => {
    const unsubscribe = authManager.subscribe(setAuthState);
    return unsubscribe;
  }, []);

  const login = async (email: string, password: string) => {
    return authManager.login(email, password);
  };

  const loginOffline = async () => {
    return authManager.loginOffline();
  };

  const logout = (options?: { redirect?: boolean }) => {
    authManager.logout(options);
  };

  return {
    ...authState,
    login,
    loginOffline,
    logout,
  };
}
