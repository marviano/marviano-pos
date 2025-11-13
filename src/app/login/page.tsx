'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import LoginPage from '@/components/LoginPage';
import { useAuth } from '@/hooks/useAuth';
import { offlineSyncService } from '@/lib/offlineSync';

export default function Login() {
  const router = useRouter();
  const { isAuthenticated, login, loginOffline } = useAuth();
  const [isClient, setIsClient] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [hasOfflineDb, setHasOfflineDb] = useState<boolean | null>(null);
  const hasCheckedOfflineDb = useRef(false);
  const [syncProgress, setSyncProgress] = useState<number | null>(null);

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

  const handleFullSync = useCallback(
    async (reason: 'initial' | 'manual') => {
      if (isSyncing) {
        return false;
      }

      if (typeof window === 'undefined') {
        setSyncError('Sinkronisasi tidak tersedia di lingkungan ini.');
        return false;
      }

      if (!window.electronAPI?.checkOfflineDbExists) {
        setSyncError('Fitur sinkronisasi offline tidak tersedia.');
        return false;
      }

      setSyncError(null);
      setIsSyncing(true);
      setSyncStatus('Memeriksa koneksi internet...');
      setSyncProgress(null);

      let unsubscribe: (() => void) | undefined;

      try {
        await offlineSyncService.forceConnectionCheck();
        const status = offlineSyncService.getStatus();

        if (!status.isOnline) {
          throw new Error('Perangkat belum terhubung ke internet. Harap sambungkan terlebih dahulu.');
        }

        setSyncStatus('Menjalankan Sinkronisasi Lengkap. Mohon tunggu...');
        setSyncProgress(0);

        if (typeof offlineSyncService.subscribeSyncProgress === 'function') {
          unsubscribe = offlineSyncService.subscribeSyncProgress(progress => {
            setSyncProgress(progress);
          });
        }

        await offlineSyncService.syncFromOnline();
        setSyncStatus('Sinkronisasi lengkap selesai.');
        setSyncProgress(100);
        setHasOfflineDb(true);

        // Re-check to confirm DB now exists
        try {
          const result = await window.electronAPI.checkOfflineDbExists();
          setHasOfflineDb(result.exists);
        } catch (error) {
          console.warn('Gagal memeriksa ulang database offline:', error);
        }

        if (reason === 'manual') {
          setTimeout(() => setSyncStatus(null), 4000);
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Sinkronisasi gagal dijalankan.';
        console.error('Sinkronisasi lengkap gagal:', error);
        setSyncError(message);
        return false;
      } finally {
        if (unsubscribe) {
          try {
            unsubscribe();
          } catch (error) {
            console.warn('Gagal unsubscribe dari progress sync:', error);
          }
        }
        setIsSyncing(false);
        setTimeout(() => setSyncProgress(null), 1500);
      }
    },
    [isSyncing]
  );

  useEffect(() => {
    if (!isClient || hasCheckedOfflineDb.current) {
      return;
    }

    hasCheckedOfflineDb.current = true;

    const bootstrapOfflineDb = async () => {
      if (typeof window === 'undefined' || !window.electronAPI?.checkOfflineDbExists) {
        setHasOfflineDb(true);
        return;
      }

      try {
        setSyncStatus('Memeriksa database offline...');
        const result = await window.electronAPI.checkOfflineDbExists();
        setHasOfflineDb(result.exists);

        if (!result.exists) {
          await handleFullSync('initial');
        } else {
          setSyncStatus(null);
        }
      } catch (error) {
        console.error('Gagal memeriksa keberadaan database offline:', error);
        setSyncError('Gagal memeriksa database offline.');
      }
    };

    bootstrapOfflineDb();
  }, [isClient, handleFullSync]);

  const effectiveSyncStatus = useMemo(() => {
    if (isSyncing) {
      return syncStatus ?? 'Menjalankan sinkronisasi...';
    }
    if (hasOfflineDb === null) {
      return 'Memeriksa database offline...';
    }
    return syncStatus;
  }, [isSyncing, syncStatus, hasOfflineDb]);

  const handleLogin = async (email: string, password: string) => {
    if (isSyncing || hasOfflineDb === null) {
      throw new Error('Tunggu hingga proses sinkronisasi selesai sebelum login.');
    }

    try {
      await login(email, password);
      // Router will handle redirect via useEffect
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const handleOfflineLogin = async () => {
    if (isSyncing || hasOfflineDb === null) {
      console.warn('Offline login diblokir saat sinkronisasi berjalan.');
      return;
    }

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
        isSyncing={isSyncing || hasOfflineDb === null}
        syncStatus={effectiveSyncStatus}
        syncError={syncError}
        onSyncRequest={() => handleFullSync('manual')}
        hasOfflineDb={hasOfflineDb ?? false}
        syncProgress={syncProgress}
      />
    </div>
  );
}

