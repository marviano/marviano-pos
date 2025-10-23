'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LoginPage from '@/components/LoginPage';
import { useAuth } from '@/hooks/useAuth';

export default function Login() {
  const router = useRouter();
  const { isAuthenticated, login, loginOffline } = useAuth();
  const [isClient, setIsClient] = useState(false);

  // Ensure we're on the client side to prevent hydration mismatch
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Redirect to main page if already authenticated
  useEffect(() => {
    if (isClient && isAuthenticated) {
      console.log('🔍 Already authenticated, redirecting to POS');
      router.replace('/');
    }
  }, [isClient, isAuthenticated, router]);

  const handleLogin = async (email: string, password: string) => {
    try {
      await login(email, password);
      // Router will handle redirect via useEffect
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const handleOfflineLogin = async () => {
    try {
      await loginOffline();
      // Router will handle redirect via useEffect
    } catch (error) {
      console.error('Offline login failed:', error);
    }
  };

  const handleClose = () => {
    // Handle close action - exit the application
    console.log('Login closed');
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.closeWindow();
    }
  };

  // Don't render if already authenticated (will redirect) or during SSR
  if (!isClient || isAuthenticated) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center overflow-hidden">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-gray-900 overflow-hidden">
      <LoginPage
        onLogin={handleLogin}
        onOfflineLogin={handleOfflineLogin}
        onClose={handleClose}
      />
    </div>
  );
}

