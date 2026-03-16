'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useAppDialog } from '@/components/AppDialog';
import { isSuperAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import POSLayout from '@/components/POSLayout';
import OfflineStatus from '@/components/OfflineStatus';
import { LogOut, X, RefreshCw, Monitor, Download, Loader2 } from 'lucide-react';
import { databaseHealthService } from '@/lib/databaseHealth';
import { smartSyncService } from '@/lib/smartSync';
import { offlineSyncService } from '@/lib/offlineSync';
// import { systemPosSyncService } from '@/lib/systemPosSync';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, user, logout } = useAuth();
  const { showAlert } = useAppDialog();
  const [isClient, setIsClient] = useState(false);
  const [databaseStatus, setDatabaseStatus] = useState<string>('Checking...');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showUserDebug, setShowUserDebug] = useState(false);
  const userDebugButtonRef = useRef<HTMLButtonElement | null>(null);
  const userDebugPanelRef = useRef<HTMLDivElement | null>(null);
  const [businessName, setBusinessName] = useState<string>('Loading...');

  // Get business ID from logged-in user (fallback to 14 for backward compatibility)
  // const businessId = user?.selectedBusinessId ?? 14;
  // const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

  const appPermissions = useMemo(() => {
    if (!user?.permissions || user.permissions.length === 0) {
      return [];
    }

    const formatPermissionLabel = (permission: string) => {
      if (permission.startsWith('marviano-pos_')) {
        return permission.replace(/^marviano-pos_/, '');
      }
      return permission;
    };

    return user.permissions.map(permission => ({
      full: permission,
      label: formatPermissionLabel(permission),
    }));
  }, [user?.permissions]);

  const roleDisplayName = useMemo(() => {
    if (!user) {
      return 'Tidak diketahui';
    }
    if (user.role_name && user.role_name.trim().length > 0) {
      return user.role_name;
    }
    return user.role ?? 'Tidak diketahui';
  }, [user]);

  // Ensure we're on the client side to prevent hydration mismatch
  useEffect(() => {
    setIsClient(true);

    // Explicitly initialize System POS Sync Service
    // This ensures the service starts even if the module is lazy-loaded
    if (typeof window !== 'undefined') {
      // Service is already initialized when imported, but we can trigger it explicitly
      // Just accessing it ensures the module is loaded
      // console.log('🔍 [PAGE] System POS Sync Service:', systemPosSyncService);

      // DISABLED: system_pos database has been dropped, sync service is disabled
      // Trigger initial sync check
      // if (systemPosSyncService) {
      //   // Service should auto-start, but we can manually trigger if needed
      //   setTimeout(() => {
      //     systemPosSyncService.triggerSync().catch(err => {
      //       console.error('❌ [PAGE] Failed to trigger System POS sync:', err);
      //     });
      //   }, 2000); // Wait 2 seconds after page load
      // }
    }
  }, []);

  // Gate smart sync: only allow when user has Daftar Transaksi + Bayar button access; set business for auto verifikasi hari ini
  useEffect(() => {
    const allowed =
      user != null &&
      (isSuperAdmin(user) ||
        (hasPermission(user, 'access_daftartransaksi') && hasPermission(user, 'access_kasir_bayar_button')));
    smartSyncService.setSmartSyncAllowedByPermission(allowed);
    smartSyncService.setVerificationBusinessId(user?.selectedBusinessId ?? null);
  }, [user]);

  // Check database health on mount
  useEffect(() => {
    if (isClient && isAuthenticated) {
      const checkDatabaseHealth = async () => {
        try {
          const status = await databaseHealthService.getStatusMessage();
          setDatabaseStatus(status);
        } catch (error) {
          console.error('❌ Error checking database health:', error);
          setDatabaseStatus('Database health check failed');
        }
      };
      checkDatabaseHealth();
    }
  }, [isClient, isAuthenticated]);

  // Fetch business name when business ID changes
  useEffect(() => {
    if (!isClient || !isAuthenticated || user?.selectedBusinessId == null) {
      setBusinessName('No business selected');
      return;
    }

    const fetchBusinessName = async () => {
      try {
        const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
        if (electronAPI?.localDbGetBusinesses) {
          const businesses = await electronAPI.localDbGetBusinesses();
          const businessesArray = (Array.isArray(businesses) ? businesses : []) as Array<{ id?: number; name?: string }>;
          const business = businessesArray.find((b) => b.id === user.selectedBusinessId);
          if (business?.name) {
            setBusinessName(business.name);
          } else {
            setBusinessName(`Business ID: ${user.selectedBusinessId}`);
          }
        } else {
          setBusinessName(`Business ID: ${user.selectedBusinessId}`);
        }
      } catch (error) {
        console.error('❌ Error fetching business name:', error);
        setBusinessName(`Business ID: ${user.selectedBusinessId}`);
      }
    };

    fetchBusinessName();
  }, [isClient, isAuthenticated, user?.selectedBusinessId]);


  // Redirect to login if not authenticated
  useEffect(() => {
    if (isClient && !isAuthenticated) {
      console.log('🔍 Not authenticated, redirecting to login');

      if (process.env.NODE_ENV === 'development') {
        // In development, use Next.js router for reliable navigation
        router.replace('/login');
      } else {
        // In production (Electron file://), use window.location
        window.location.href = 'login.html';
      }
    }
  }, [isClient, isAuthenticated, router]);

  // Redirect to login if no business is selected
  useEffect(() => {
    if (!isClient || !isAuthenticated || !user) return;
    if (user.selectedBusinessId == null) {
      console.log('🔍 No business selected, redirecting to login');
      // Use setTimeout to avoid potential race conditions
      setTimeout(() => {
        if (process.env.NODE_ENV === 'development') {
          router.replace('/login');
        } else {
          window.location.href = 'login.html';
        }
      }, 100);
    }
  }, [isClient, isAuthenticated, user, router]);

  useEffect(() => {
    if (!showUserDebug) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        userDebugPanelRef.current?.contains(target) ||
        userDebugButtonRef.current?.contains(target)
      ) {
        return;
      }
      setShowUserDebug(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowUserDebug(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showUserDebug]);

  // Show loading while checking authentication or during SSR
  if (!isClient || !isAuthenticated) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center overflow-hidden">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  // Show loading if user data is not yet loaded
  if (!user) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center overflow-hidden">
        <div className="text-white text-lg">Loading user data...</div>
      </div>
    );
  }

  // Redirect if no business is selected (client-side redirect)
  // Use == null to allow selectedBusinessId 0 (e.g. super admin synthetic business)
  if (user.selectedBusinessId == null) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center overflow-hidden">
        <div className="text-white text-lg">Redirecting to login...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top Bar with User Info and Logout - Windows XP Style */}
      <div
        className="h-[30px] flex items-center justify-between relative border-b-2 border-[#245edb]"
        style={{
          background: 'linear-gradient(to bottom, #3a6ea5 0%, #245edb 50%, #1e4a8f 100%)',
          fontFamily: 'Tahoma, "MS Sans Serif", sans-serif',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)'
        }}
      >
        <div className="flex items-center space-x-[8px] px-[8px]">
          <h1 className="text-[11px] font-bold text-white" style={{ textShadow: '0 1px 1px rgba(0,0,0,0.5)' }}>
            {businessName}
          </h1>
          <div className="w-[1px] h-[20px] bg-[#1e4a8f]" style={{ boxShadow: '1px 0 0 rgba(255,255,255,0.1)' }}></div>
          <button
            ref={userDebugButtonRef}
            type="button"
            onClick={() => setShowUserDebug(prev => !prev)}
            className="text-[10px] font-normal text-white hover:text-yellow-200 px-[4px] py-[2px] transition-colors"
            style={{ textShadow: '0 1px 1px rgba(0,0,0,0.5)' }}
            title="Klik untuk melihat detail pengguna"
          >
            {user?.name || 'Pengguna'}
          </button>
          <div className="w-[1px] h-[20px] bg-[#1e4a8f]" style={{ boxShadow: '1px 0 0 rgba(255,255,255,0.1)' }}></div>
          <OfflineStatus />
        </div>
        <div className="flex items-center space-x-[6px] px-[4px]">
          <div className="w-[1px] h-[20px] bg-[#1e4a8f]" style={{ boxShadow: '1px 0 0 rgba(255,255,255,0.1)' }}></div>
          <span className="text-[10px] text-white font-medium" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>Database:</span>
          {isSyncing && (
            <span className="inline-block w-[6px] h-[6px] bg-white rounded-full animate-pulse" style={{ boxShadow: '0 0 4px rgba(255,255,255,0.8)' }}></span>
          )}
          <span className="text-[10px] text-white" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>{databaseStatus}</span>
          <button
            onClick={async () => {
              setIsSyncing(true);
              setDatabaseStatus('Syncing...');
              try {
                console.log('🔄 [SYNC] Starting upload sync...');
                const syncResult = await smartSyncService.forceSync();
                console.log('✅ [SYNC] Upload sync completed', syncResult);
                if (syncResult.success) {
                  if (syncResult.syncedCount === 0) {
                    setDatabaseStatus('No pending transactions');
                  } else {
                    setDatabaseStatus(`Synced ${syncResult.syncedCount} transaction(s)`);
                  }
                } else {
                  setDatabaseStatus(syncResult.message || 'Sync failed');
                }
                window.dispatchEvent(new CustomEvent('dataSynced'));
              } catch (error) {
                console.error('❌ Sync failed:', error);
                setDatabaseStatus('Sync failed');
              } finally {
                setIsSyncing(false);
              }
            }}
            disabled={isSyncing}
            className="flex items-center justify-center w-[22px] h-[22px] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(to bottom, #ece9d8 0%, #d4d0c8 100%)',
              border: '1px solid #808080',
              borderTopColor: '#ffffff',
              borderLeftColor: '#ffffff',
              borderRightColor: '#404040',
              borderBottomColor: '#404040',
              boxShadow: '1px 1px 0 rgba(0,0,0,0.1)',
              color: '#000000',
              fontFamily: 'Tahoma, "MS Sans Serif", sans-serif'
            }}
            onMouseEnter={(e) => {
              if (!isSyncing) {
                e.currentTarget.style.background = 'linear-gradient(to bottom, #f5f3e8 0%, #e0dcc8 100%)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isSyncing) {
                e.currentTarget.style.background = 'linear-gradient(to bottom, #ece9d8 0%, #d4d0c8 100%)';
                e.currentTarget.style.boxShadow = '1px 1px 0 rgba(0,0,0,0.1)';
                e.currentTarget.style.borderTopColor = '#ffffff';
                e.currentTarget.style.borderLeftColor = '#ffffff';
                e.currentTarget.style.borderRightColor = '#404040';
                e.currentTarget.style.borderBottomColor = '#404040';
              }
            }}
            onMouseDown={(e) => {
              if (!isSyncing) {
                e.currentTarget.style.boxShadow = 'inset 1px 1px 2px rgba(0,0,0,0.2)';
                e.currentTarget.style.borderTopColor = '#404040';
                e.currentTarget.style.borderLeftColor = '#404040';
                e.currentTarget.style.borderRightColor = '#ffffff';
                e.currentTarget.style.borderBottomColor = '#ffffff';
              }
            }}
            onMouseUp={(e) => {
              if (!isSyncing) {
                e.currentTarget.style.boxShadow = '1px 1px 0 rgba(0,0,0,0.1)';
                e.currentTarget.style.borderTopColor = '#ffffff';
                e.currentTarget.style.borderLeftColor = '#ffffff';
                e.currentTarget.style.borderRightColor = '#404040';
                e.currentTarget.style.borderBottomColor = '#404040';
              }
            }}
            title="Sync database"
          >
            <RefreshCw className={`w-[10px] h-[10px] ${isSyncing ? 'animate-spin' : ''}`} style={{ color: '#000000' }} strokeWidth={2.5} />
          </button>
          {typeof window !== 'undefined' && window.electronAPI && (
            <button
              onClick={async () => {
                setIsDownloading(true);
                setDatabaseStatus('Downloading...');
                try {
                  await offlineSyncService.forceConnectionCheck();
                  const status = offlineSyncService.getStatus();
                  if (!status.isOnline) {
                    setDatabaseStatus('Offline');
                    return;
                  }
                  await offlineSyncService.syncFromOnline(user?.selectedBusinessId ?? undefined);
                  setDatabaseStatus('Master data downloaded');
                  // Brief delay so main process DB writes from sync are committed before UI refetches
                  await new Promise(r => setTimeout(r, 200));
                  window.dispatchEvent(new CustomEvent('dataSynced'));
                } catch (error) {
                  console.error('Download master data failed:', error);
                  setDatabaseStatus(error instanceof Error ? error.message : 'Download failed');
                } finally {
                  setIsDownloading(false);
                }
              }}
              disabled={isDownloading}
              className="flex items-center justify-center w-[22px] h-[22px] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(to bottom, #ece9d8 0%, #d4d0c8 100%)',
                border: '1px solid #808080',
                borderTopColor: '#ffffff',
                borderLeftColor: '#ffffff',
                borderRightColor: '#404040',
                borderBottomColor: '#404040',
                boxShadow: '1px 1px 0 rgba(0,0,0,0.1)',
                color: '#000000',
                fontFamily: 'Tahoma, "MS Sans Serif", sans-serif'
              }}
              onMouseEnter={(e) => {
                if (!isDownloading) {
                  e.currentTarget.style.background = 'linear-gradient(to bottom, #f5f3e8 0%, #e0dcc8 100%)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isDownloading) {
                  e.currentTarget.style.background = 'linear-gradient(to bottom, #ece9d8 0%, #d4d0c8 100%)';
                  e.currentTarget.style.boxShadow = '1px 1px 0 rgba(0,0,0,0.1)';
                  e.currentTarget.style.borderTopColor = '#ffffff';
                  e.currentTarget.style.borderLeftColor = '#ffffff';
                  e.currentTarget.style.borderRightColor = '#404040';
                  e.currentTarget.style.borderBottomColor = '#404040';
                }
              }}
              onMouseDown={(e) => {
                if (!isDownloading) {
                  e.currentTarget.style.boxShadow = 'inset 1px 1px 2px rgba(0,0,0,0.2)';
                  e.currentTarget.style.borderTopColor = '#404040';
                  e.currentTarget.style.borderLeftColor = '#404040';
                  e.currentTarget.style.borderRightColor = '#ffffff';
                  e.currentTarget.style.borderBottomColor = '#404040';
                }
              }}
              onMouseUp={(e) => {
                if (!isDownloading) {
                  e.currentTarget.style.boxShadow = '1px 1px 0 rgba(0,0,0,0.1)';
                  e.currentTarget.style.borderTopColor = '#ffffff';
                  e.currentTarget.style.borderLeftColor = '#ffffff';
                  e.currentTarget.style.borderRightColor = '#404040';
                  e.currentTarget.style.borderBottomColor = '#404040';
                }
              }}
              title="Download master data"
            >
              {isDownloading ? (
                <Loader2 className="w-[10px] h-[10px] animate-spin" style={{ color: '#000000' }} strokeWidth={2.5} />
              ) : (
                <Download className="w-[10px] h-[10px]" style={{ color: '#000000' }} strokeWidth={2.5} />
              )}
            </button>
          )}
          <div className="w-[1px] h-[20px] bg-[#1e4a8f]" style={{ boxShadow: '1px 0 0 rgba(255,255,255,0.1)' }}></div>
          <button
            onClick={async () => {
              if (window.electronAPI) {
                const result = await window.electronAPI.createCustomerDisplay() as { message?: string };
                console.log('Customer display result:', result);
                showAlert(result.message || 'Customer display created');
              }
            }}
            className="flex items-center justify-center w-[22px] h-[22px]"
            style={{
              background: 'linear-gradient(to bottom, #ece9d8 0%, #d4d0c8 100%)',
              border: '1px solid #808080',
              borderTopColor: '#ffffff',
              borderLeftColor: '#ffffff',
              borderRightColor: '#404040',
              borderBottomColor: '#404040',
              boxShadow: '1px 1px 0 rgba(0,0,0,0.1)',
              color: '#000000',
              fontFamily: 'Tahoma, "MS Sans Serif", sans-serif'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(to bottom, #f5f3e8 0%, #e0dcc8 100%)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(to bottom, #ece9d8 0%, #d4d0c8 100%)';
              e.currentTarget.style.boxShadow = '1px 1px 0 rgba(0,0,0,0.1)';
              e.currentTarget.style.borderTopColor = '#ffffff';
              e.currentTarget.style.borderLeftColor = '#ffffff';
              e.currentTarget.style.borderRightColor = '#404040';
              e.currentTarget.style.borderBottomColor = '#404040';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.boxShadow = 'inset 1px 1px 2px rgba(0,0,0,0.2)';
              e.currentTarget.style.borderTopColor = '#404040';
              e.currentTarget.style.borderLeftColor = '#404040';
              e.currentTarget.style.borderRightColor = '#ffffff';
              e.currentTarget.style.borderBottomColor = '#ffffff';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.boxShadow = '1px 1px 0 rgba(0,0,0,0.1)';
              e.currentTarget.style.borderTopColor = '#ffffff';
              e.currentTarget.style.borderLeftColor = '#ffffff';
              e.currentTarget.style.borderRightColor = '#404040';
              e.currentTarget.style.borderBottomColor = '#404040';
            }}
            title="Create Customer Display"
          >
            <Monitor className="w-[10px] h-[10px]" style={{ color: '#000000' }} strokeWidth={2.5} />
          </button>
          <div className="w-[1px] h-[20px] bg-[#1e4a8f]" style={{ boxShadow: '1px 0 0 rgba(255,255,255,0.1)' }}></div>
          <button
            onClick={() => logout()}
            className="flex items-center justify-center w-[22px] h-[22px]"
            style={{
              background: 'linear-gradient(to bottom, #ece9d8 0%, #d4d0c8 100%)',
              border: '1px solid #808080',
              borderTopColor: '#ffffff',
              borderLeftColor: '#ffffff',
              borderRightColor: '#404040',
              borderBottomColor: '#404040',
              boxShadow: '1px 1px 0 rgba(0,0,0,0.1)',
              color: '#000000',
              fontFamily: 'Tahoma, "MS Sans Serif", sans-serif'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(to bottom, #f5f3e8 0%, #e0dcc8 100%)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(to bottom, #ece9d8 0%, #d4d0c8 100%)';
              e.currentTarget.style.boxShadow = '1px 1px 0 rgba(0,0,0,0.1)';
              e.currentTarget.style.borderTopColor = '#ffffff';
              e.currentTarget.style.borderLeftColor = '#ffffff';
              e.currentTarget.style.borderRightColor = '#404040';
              e.currentTarget.style.borderBottomColor = '#404040';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.boxShadow = 'inset 1px 1px 2px rgba(0,0,0,0.2)';
              e.currentTarget.style.borderTopColor = '#404040';
              e.currentTarget.style.borderLeftColor = '#404040';
              e.currentTarget.style.borderRightColor = '#ffffff';
              e.currentTarget.style.borderBottomColor = '#ffffff';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.boxShadow = '1px 1px 0 rgba(0,0,0,0.1)';
              e.currentTarget.style.borderTopColor = '#ffffff';
              e.currentTarget.style.borderLeftColor = '#ffffff';
              e.currentTarget.style.borderRightColor = '#404040';
              e.currentTarget.style.borderBottomColor = '#404040';
            }}
            title="Logout"
          >
            <LogOut className="w-[10px] h-[10px]" style={{ color: '#000000' }} strokeWidth={2.5} />
          </button>
          <div className="w-[1px] h-[20px] bg-[#1e4a8f]" style={{ boxShadow: '1px 0 0 rgba(255,255,255,0.1)' }}></div>
          <button
            onClick={() => {
              if (window.electronAPI) {
                window.electronAPI.minimizeWindow();
              }
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              if (window.electronAPI) {
                window.electronAPI.minimizeWindow();
              }
            }}
            className="w-[22px] h-[22px] flex items-end justify-center pb-[5px]"
            style={{
              background: 'linear-gradient(to bottom, #ece9d8 0%, #d4d0c8 100%)',
              border: '1px solid #808080',
              borderTopColor: '#ffffff',
              borderLeftColor: '#ffffff',
              borderRightColor: '#404040',
              borderBottomColor: '#404040',
              boxShadow: '1px 1px 0 rgba(0,0,0,0.1)',
              touchAction: 'manipulation',
              fontFamily: 'Tahoma, "MS Sans Serif", sans-serif'
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.boxShadow = 'inset 1px 1px 2px rgba(0,0,0,0.2)';
              e.currentTarget.style.borderTopColor = '#404040';
              e.currentTarget.style.borderLeftColor = '#404040';
              e.currentTarget.style.borderRightColor = '#ffffff';
              e.currentTarget.style.borderBottomColor = '#ffffff';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.boxShadow = '1px 1px 0 rgba(0,0,0,0.1)';
              e.currentTarget.style.borderTopColor = '#ffffff';
              e.currentTarget.style.borderLeftColor = '#ffffff';
              e.currentTarget.style.borderRightColor = '#404040';
              e.currentTarget.style.borderBottomColor = '#404040';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '1px 1px 0 rgba(0,0,0,0.1)';
              e.currentTarget.style.borderTopColor = '#ffffff';
              e.currentTarget.style.borderLeftColor = '#ffffff';
              e.currentTarget.style.borderRightColor = '#404040';
              e.currentTarget.style.borderBottomColor = '#404040';
            }}
            title="Minimize"
          >
            <div style={{ width: '10px', height: '1px', backgroundColor: '#000000' }} aria-hidden />
          </button>
          <div className="w-[1px] h-[20px] bg-[#1e4a8f]" style={{ boxShadow: '1px 0 0 rgba(255,255,255,0.1)' }}></div>
          <button
            onClick={() => {
              if (window.electronAPI) {
                window.electronAPI.closeWindow();
              }
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              if (window.electronAPI) {
                window.electronAPI.closeWindow();
              }
            }}
            className="w-[22px] h-[22px] flex items-center justify-center"
            style={{
              background: 'linear-gradient(to bottom, #ece9d8 0%, #d4d0c8 100%)',
              border: '1px solid #808080',
              borderTopColor: '#ffffff',
              borderLeftColor: '#ffffff',
              borderRightColor: '#404040',
              borderBottomColor: '#404040',
              boxShadow: '1px 1px 0 rgba(0,0,0,0.1)',
              touchAction: 'manipulation',
              fontFamily: 'Tahoma, "MS Sans Serif", sans-serif'
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.boxShadow = 'inset 1px 1px 2px rgba(0,0,0,0.2)';
              e.currentTarget.style.borderTopColor = '#404040';
              e.currentTarget.style.borderLeftColor = '#404040';
              e.currentTarget.style.borderRightColor = '#ffffff';
              e.currentTarget.style.borderBottomColor = '#ffffff';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.boxShadow = '1px 1px 0 rgba(0,0,0,0.1)';
              e.currentTarget.style.borderTopColor = '#ffffff';
              e.currentTarget.style.borderLeftColor = '#ffffff';
              e.currentTarget.style.borderRightColor = '#404040';
              e.currentTarget.style.borderBottomColor = '#404040';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '1px 1px 0 rgba(0,0,0,0.1)';
              e.currentTarget.style.borderTopColor = '#ffffff';
              e.currentTarget.style.borderLeftColor = '#ffffff';
              e.currentTarget.style.borderRightColor = '#404040';
              e.currentTarget.style.borderBottomColor = '#404040';
            }}
            title="Close"
          >
            <X className="w-[10px] h-[10px]" style={{ color: '#000000' }} strokeWidth={2.5} />
          </button>
        </div>

        {showUserDebug && (
          <div
            ref={userDebugPanelRef}
            className="absolute top-full left-[12px] mt-[4px] w-[240px] p-[12px] z-50"
            style={{
              background: 'linear-gradient(to bottom, #ece9d8 0%, #d4d0c8 100%)',
              border: '2px solid #808080',
              borderTopColor: '#ffffff',
              borderLeftColor: '#ffffff',
              borderRightColor: '#404040',
              borderBottomColor: '#404040',
              boxShadow: '2px 2px 4px rgba(0,0,0,0.3)',
              fontFamily: 'Tahoma, "MS Sans Serif", sans-serif'
            }}
          >
            <div className="flex items-center justify-between mb-[8px]">
              <span className="text-[11px] font-bold text-[#000080]">User Debug Info</span>
              <button
                type="button"
                onClick={() => setShowUserDebug(false)}
                className="w-[18px] h-[18px] flex items-center justify-center"
                style={{
                  background: 'linear-gradient(to bottom, #ece9d8 0%, #d4d0c8 100%)',
                  border: '1px solid #808080',
                  borderTopColor: '#ffffff',
                  borderLeftColor: '#ffffff',
                  borderRightColor: '#404040',
                  borderBottomColor: '#404040',
                  boxShadow: '1px 1px 0 rgba(0,0,0,0.1)'
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.boxShadow = 'inset 1px 1px 2px rgba(0,0,0,0.2)';
                  e.currentTarget.style.borderTopColor = '#404040';
                  e.currentTarget.style.borderLeftColor = '#404040';
                  e.currentTarget.style.borderRightColor = '#ffffff';
                  e.currentTarget.style.borderBottomColor = '#ffffff';
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.boxShadow = '1px 1px 0 rgba(0,0,0,0.1)';
                  e.currentTarget.style.borderTopColor = '#ffffff';
                  e.currentTarget.style.borderLeftColor = '#ffffff';
                  e.currentTarget.style.borderRightColor = '#404040';
                  e.currentTarget.style.borderBottomColor = '#404040';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '1px 1px 0 rgba(0,0,0,0.1)';
                  e.currentTarget.style.borderTopColor = '#ffffff';
                  e.currentTarget.style.borderLeftColor = '#ffffff';
                  e.currentTarget.style.borderRightColor = '#404040';
                  e.currentTarget.style.borderBottomColor = '#404040';
                }}
                aria-label="Close user debug panel"
              >
                <X className="w-[12px] h-[12px]" style={{ color: '#000080' }} />
              </button>
            </div>
            <div className="space-y-[6px] text-[11px] text-[#000080]">
              <div>
                <span className="text-[#000080]">Nama:</span>
                <span className="ml-[6px] font-bold">{user?.name || 'Tidak diketahui'}</span>
              </div>
              <div>
                <span className="text-[#000080]">Email:</span>
                <span className="ml-[6px]">{user?.email || 'Tidak diketahui'}</span>
              </div>
              <div>
                <span className="text-[#000080]">Role:</span>
                <span className="ml-[6px] font-bold">
                  {roleDisplayName}
                  {user?.role_id !== null && user?.role_id !== undefined ? ` (${user.role_id})` : ''}
                </span>
              </div>
              <div>
                <span className="text-[#000080]">Normalized Role:</span>
                <span className="ml-[6px] uppercase tracking-wide text-[10px] font-bold text-[#000080]">
                  {user?.role || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-[#000080]">Role ID:</span>
                <span className="ml-[6px]">
                  {user?.role_id !== null && user?.role_id !== undefined ? user.role_id : 'N/A'}
                </span>
              </div>
              <div className="pt-[6px] border-t-2 border-[#808080]">
                <span className="text-[#000080] font-bold">Selected Business:</span>
                <div className="mt-[4px]">
                  <div>
                    <span className="text-[#000080]">Business ID:</span>
                    <span className="ml-[6px] font-bold text-[#008000]">
                      {user?.selectedBusinessId !== null && user?.selectedBusinessId !== undefined ? user.selectedBusinessId : 'N/A'}
                    </span>
                  </div>
                  <div className="mt-[2px]">
                    <span className="text-[#000080]">Business Name:</span>
                    <span className="ml-[6px] font-bold">
                      {businessName}
                    </span>
                  </div>
                </div>
              </div>
              <div className="pt-[6px] border-t-2 border-[#808080]">
                <span className="text-[#000080] font-bold">Permissions ({isSuperAdmin(user) ? 'ALL' : appPermissions.length}):</span>
                {isSuperAdmin(user) ? (
                  <p className="mt-[4px] text-[#008000] text-[10px] font-bold">
                    ✨ Super Admin Access (All Permissions)
                  </p>
                ) : appPermissions.length === 0 ? (
                  <p className="mt-[4px] text-[#808080] text-[10px]">Tidak ada permission yang tersedia</p>
                ) : (
                  <ul className="mt-[4px] max-h-[120px] overflow-y-auto space-y-[3px] text-[10px]">
                    {appPermissions.map(permission => (
                      <li
                        key={permission.full}
                        className="px-[6px] py-[3px] flex flex-col"
                        style={{
                          background: 'linear-gradient(to bottom, #ffffff 0%, #f0f0f0 100%)',
                          border: '1px solid #808080',
                          borderTopColor: '#ffffff',
                          borderLeftColor: '#ffffff',
                          borderRightColor: '#c0c0c0',
                          borderBottomColor: '#c0c0c0'
                        }}
                      >
                        <span className="font-bold text-[#000080]">{permission.label}</span>
                        <span className="text-[9px] text-[#404040]">{permission.full}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* POS Interface */}
      <POSLayout />
    </div>
  );
}