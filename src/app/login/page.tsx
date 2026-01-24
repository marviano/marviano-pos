'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import LoginPage from '@/components/LoginPage';
import { useAuth } from '@/hooks/useAuth';
import { offlineSyncService } from '@/lib/offlineSync';
import { authManager, type User } from '@/lib/auth';

interface Business {
  id: number;
  name: string;
  permission_name: string;
}

export default function Login() {
  const router = useRouter();
  const { isAuthenticated, user, login, loginOffline, logout } = useAuth();
  const [isClient, setIsClient] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<number | null>(null);
  interface LoginResult {
    _businesses?: Business[];
    _isSuperAdmin?: boolean;
    [key: string]: unknown;
  }
  const [pendingLogin, setPendingLogin] = useState<{
    user: User | LoginResult;
    businesses: Business[];
    isSuperAdmin: boolean;
  } | null>(null);

  // Ensure we're on the client side to prevent hydration mismatch
  useEffect(() => {
    setIsClient(true);
    
    // Initialize API URL cache
    if (typeof window !== 'undefined') {
      import('@/lib/api').then(({ initApiUrlCache }) => {
        initApiUrlCache().catch((error) => {
          console.warn('Failed to initialize API URL cache:', error);
        });
      });
    }
  }, []);

  // Redirect to main page if already authenticated (and has a business selected)
  // If authenticated but no selectedBusinessId (e.g. user with 0 businesses, or corrupted state), clear session to avoid redirect loop
  useEffect(() => {
    if (!isClient || !isAuthenticated) return;

    if (user?.selectedBusinessId != null) {
      if (process.env.NODE_ENV === 'development') {
        router.replace('/');
      } else {
        window.location.href = 'index.html';
      }
    } else {
      // Invalid: authenticated but no business (e.g. users with only reporting perms get businesses=[] from API)
      logout({ redirect: false });
    }
  }, [isClient, isAuthenticated, user?.selectedBusinessId, router, logout]);

  const handleFullSync = useCallback(
    async (reason: 'initial' | 'manual') => {
      if (isSyncing) {
        return false;
      }

      if (typeof window === 'undefined') {
        setSyncError('Sinkronisasi tidak tersedia di lingkungan ini.');
        return false;
      }

      if (!window.electronAPI) {
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

        setSyncStatus('Menjalankan download master data. Mohon tunggu...');
        setSyncProgress(0);

        if (typeof offlineSyncService.subscribeSyncProgress === 'function') {
          unsubscribe = offlineSyncService.subscribeSyncProgress(progress => {
            setSyncProgress(progress);
          });
        }

        await offlineSyncService.syncFromOnline();
        setSyncStatus('✅ Download master data selesai!');
        setSyncProgress(100);
        setSyncError(null); // Clear any previous errors

        if (reason === 'manual') {
          setTimeout(() => setSyncStatus(null), 4000);
        }
        return true;
      } catch (error) {
        let message = 'Sinkronisasi gagal dijalankan.';
        if (error instanceof Error) {
          message = error.message;
          // Add more context for common errors
          if (error.message.includes('API URL')) {
            message = error.message + '\n\nPastikan URL API sudah diisi dengan format: http://IP:PORT (contoh: http://192.168.1.16:3000)';
          } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            message = error.message + '\n\nPeriksa apakah API server berjalan dan dapat diakses.';
          }
        }
        console.error('❌ Download master data gagal:', error);
        setSyncError(message);
        setSyncStatus(null); // Clear status to show error
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

  const effectiveSyncStatus = useMemo(() => {
    if (isSyncing) {
      return syncStatus ?? 'Menjalankan sinkronisasi...';
    }
    return syncStatus;
  }, [isSyncing, syncStatus]);

  const handleLogin = async (email: string, password: string) => {
    if (isSyncing) {
      throw new Error('Tunggu hingga proses sinkronisasi selesai sebelum login.');
    }

    try {
      const loginResult = await login(email, password);

      // Check if we need business selection
      const loginResultTyped = loginResult as unknown as LoginResult;
      const businesses = loginResultTyped?._businesses || [];
      const isSuperAdmin = loginResultTyped?._isSuperAdmin || false;

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'login/page.tsx:handleLogin',message:'businesses from loginResult',data:{businessesLength:businesses.length,has_businesses:!!(loginResultTyped as any)?._businesses,isSuperAdmin},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion

      if (businesses.length === 0) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/7b565785-72b5-49f7-b2c0-57606ea0d0b5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'login/page.tsx:handleLogin',message:'throwing no businesses',data:{businessesLength:0},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H2'})}).catch(()=>{});
        // #endregion
        throw new Error('Anda tidak terdaftar di bisnis manapun. Hubungi administrator untuk mendapatkan akses POS.');
      }
      if (businesses.length > 1) {
        // Show business selection UI
        setPendingLogin({
          user: loginResult,
          businesses,
          isSuperAdmin,
        });
      } else {
        // Auto-select the single business
        const selectedBusinessId = businesses[0].id;
        await authManager.completeLogin(loginResult as User & { _businesses?: unknown[]; _isSuperAdmin?: boolean }, selectedBusinessId);
        // Router will handle redirect via useEffect
      }
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const handleBusinessSelection = async (businessId: number | null) => {
    if (!pendingLogin) {
      return;
    }

    try {
      await authManager.completeLogin(pendingLogin.user as User & { _businesses?: unknown[]; _isSuperAdmin?: boolean }, businessId);
      setPendingLogin(null);
      // Router will handle redirect via useEffect
    } catch (error) {
      console.error('Failed to complete login:', error);
      setSyncError('Gagal menyelesaikan login. Silakan coba lagi.');
      setPendingLogin(null);
    }
  };

  const handleOfflineLogin = async () => {
    if (isSyncing) {
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

  // Show business selection if needed
  if (pendingLogin) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-gray-900 overflow-hidden" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden w-full h-[432px] flex" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          {/* Left Panel - Branding (20% width) */}
          <div className="w-[20%] bg-gray-900 relative overflow-hidden">
            <div className="absolute inset-0 opacity-5">
              <div className="absolute inset-0" style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Ccircle cx='30' cy='30' r='4'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
              }}></div>
            </div>
            <div className="relative z-10 h-full flex flex-col items-center justify-center text-white p-8">
              <h1 className="text-lg font-semibold">Pilih PoS</h1>
            </div>
          </div>

          {/* Right Panel - Business Selection (80% width) */}
          <div className="w-[80%] bg-white p-6 flex flex-col justify-center relative overflow-hidden">
            {/* Close/Back Button */}
            <button
              onClick={() => setPendingLogin(null)}
              className="absolute top-4 right-4 w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center transition-colors"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title="Kembali ke Login"
            >
              <X className="w-4 h-4 text-gray-600" />
            </button>

            <div className="flex-1 flex flex-col justify-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              <div className="grid grid-cols-2 gap-3 max-h-[280px] overflow-y-auto pr-2">
                {pendingLogin.businesses.map((business) => (
                  <button
                    key={business.id}
                    onClick={() => handleBusinessSelection(business.id)}
                    className="text-left px-4 py-3 bg-gradient-to-br from-cyan-50 to-blue-50 hover:from-cyan-100 hover:to-blue-100 border-2 border-cyan-200 hover:border-cyan-400 rounded-lg transition-all duration-200 hover:shadow-md group"
                  >
                    <div className="font-semibold text-gray-800 group-hover:text-cyan-700 transition-colors text-sm">
                      {business.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-gray-900 overflow-hidden">
      <LoginPage
        onLogin={handleLogin}
        onOfflineLogin={handleOfflineLogin}
        onClose={handleClose}
        isSyncing={isSyncing}
        syncStatus={effectiveSyncStatus}
        syncError={syncError}
        onSyncRequest={async () => { await handleFullSync('manual'); }}
        hasOfflineDb={true}
        syncProgress={syncProgress}
      />
    </div>
  );
}

