'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { isSuperAdmin } from '@/lib/auth';
import POSLayout from '@/components/POSLayout';
import OfflineStatus from '@/components/OfflineStatus';
import { LogOut, Minimize2, X } from 'lucide-react';
import { databaseHealthService } from '@/lib/databaseHealth';
import { smartSyncService } from '@/lib/smartSync';
// import { systemPosSyncService } from '@/lib/systemPosSync';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, user, logout } = useAuth();
  const [isClient, setIsClient] = useState(false);
  const [databaseStatus, setDatabaseStatus] = useState<string>('Checking...');
  const [isSyncing, setIsSyncing] = useState(false);
  const [showUserDebug, setShowUserDebug] = useState(false);
  const userDebugButtonRef = useRef<HTMLButtonElement | null>(null);
  const userDebugPanelRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top Bar with User Info and Logout */}
      <div className="h-[25.6px] bg-white border-b border-gray-200 flex items-center justify-between px-[9.6px] relative">
        <div className="flex items-center space-x-[9.6px]">
          <h1 className="text-[11.2px] font-semibold text-gray-800">MOMOYO MADIUN 1</h1>
          <div className="w-px h-[16px] bg-gray-300"></div>
          <button
            ref={userDebugButtonRef}
            type="button"
            onClick={() => setShowUserDebug(prev => !prev)}
            className="text-[9.6px] font-medium text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white px-[3.2px] transition-colors"
            title="Klik untuk melihat detail pengguna"
          >
            {user?.name || 'Pengguna'}
          </button>
          <div className="w-px h-[16px] bg-gray-300"></div>
          <OfflineStatus />
        </div>
        <div className="flex items-center space-x-[4.8px]">
          <div className="w-px h-[16px] bg-gray-300"></div>
          <div className="flex items-center gap-[4.8px] px-[4.8px] py-[1.6px] bg-blue-100 border border-blue-200">
            <span className="text-[9.6px] text-blue-700 font-medium">Database:</span>
            {isSyncing && (
              <span className="inline-block w-[3.2px] h-[3.2px] bg-blue-600 animate-pulse"></span>
            )}
            <span className="text-[9.6px] text-blue-700">{databaseStatus}</span>
            <button
              onClick={async () => {setIsSyncing(true);
                setDatabaseStatus('Syncing...');
                try {
                  // Upload any pending local transactions to cloud
                  console.log('🔄 [SYNC] Starting upload sync...');const syncResult = await smartSyncService.forceSync();console.log('✅ [SYNC] Upload sync completed', syncResult);

                  // Show user-friendly status message
                  if (syncResult.success) {
                    if (syncResult.syncedCount === 0) {
                      setDatabaseStatus('No pending transactions');
                    } else {
                      setDatabaseStatus(`Synced ${syncResult.syncedCount} transaction(s)`);
                    }
                  } else {
                    setDatabaseStatus(syncResult.message || 'Sync failed');
                  }

                  // Trigger data refresh event for POSLayout
                  window.dispatchEvent(new CustomEvent('dataSynced'));
                } catch (error) {console.error('❌ Sync failed:', error);
                  setDatabaseStatus('Sync failed');
                } finally {
                  setIsSyncing(false);
                }
              }}
              disabled={isSyncing}
              className="px-[3.2px] py-[1.6px] text-[9.6px] bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Sync database"
            >
              Sync Tx
            </button>
          </div>
          <div className="w-px h-[16px] bg-gray-300"></div>
          <button
            onClick={async () => {
              if (window.electronAPI) {
                const result = await window.electronAPI.createCustomerDisplay() as { message?: string };
                console.log('Customer display result:', result);
                alert(result.message || 'Customer display created');
              }
            }}
            className="flex items-center space-x-[3.2px] bg-blue-500 hover:bg-blue-600 text-white px-[4.8px] py-[3.2px] transition-colors"
            title="Create Customer Display"
          >
            <span className="text-[9.6px]">Customer Display</span>
          </button>
          <div className="w-px h-[16px] bg-gray-300"></div>
          <button
            onClick={logout}
            className="flex items-center space-x-[3.2px] bg-red-500 hover:bg-red-600 text-white px-[4.8px] py-[3.2px] transition-colors"
            title="Logout"
          >
            <LogOut className="w-[9.6px] h-[9.6px]" />
            <span className="text-[9.6px]">Logout</span>
          </button>
          <div className="w-px h-[16px] bg-gray-300"></div>
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
            className="p-[4.8px] hover:bg-gray-100 transition-colors"
            style={{ touchAction: 'manipulation' }}
            title="Minimize"
          >
            <Minimize2 className="w-[9.6px] h-[9.6px] text-gray-600" />
          </button>
          <div className="w-px h-[16px] bg-gray-300"></div>
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
            className="p-[4.8px] hover:bg-red-100 transition-colors"
            style={{ touchAction: 'manipulation' }}
            title="Close"
          >
            <X className="w-[9.6px] h-[9.6px] text-red-600" />
          </button>
        </div>

        {showUserDebug && (
          <div
            ref={userDebugPanelRef}
            className="absolute top-full left-[12.8px] mt-[6.4px] w-[230.4px] border border-gray-200 bg-white shadow-xl p-[12.8px] z-50"
          >
            <div className="flex items-center justify-between mb-[6.4px]">
              <span className="text-[11.2px] font-semibold text-gray-800">User Debug Info</span>
              <button
                type="button"
                onClick={() => setShowUserDebug(false)}
                className="p-[3.2px] hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Close user debug panel"
              >
                <X className="w-[12.8px] h-[12.8px] text-gray-500" />
              </button>
            </div>
            <div className="space-y-[6.4px] text-[11.2px]">
              <div>
                <span className="text-gray-500">Nama:</span>
                <span className="ml-[6.4px] font-medium text-gray-800">{user?.name || 'Tidak diketahui'}</span>
              </div>
              <div>
                <span className="text-gray-500">Email:</span>
                <span className="ml-[6.4px] text-gray-800">{user?.email || 'Tidak diketahui'}</span>
              </div>
              <div>
                <span className="text-gray-500">Role:</span>
                <span className="ml-[6.4px] text-gray-800 font-medium">
                  {roleDisplayName}
                  {user?.role_id !== null && user?.role_id !== undefined ? ` (${user.role_id})` : ''}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Normalized Role:</span>
                <span className="ml-[6.4px] uppercase tracking-wide text-[9.6px] font-semibold text-blue-600">
                  {user?.role || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Role ID:</span>
                <span className="ml-[6.4px] text-gray-800">
                  {user?.role_id !== null && user?.role_id !== undefined ? user.role_id : 'N/A'}
                </span>
              </div>
              <div className="pt-[6.4px] border-t border-gray-100">
                <span className="text-gray-500">Permissions ({isSuperAdmin(user) ? 'ALL' : appPermissions.length}):</span>
                {isSuperAdmin(user) ? (
                  <p className="mt-[3.2px] text-green-600 text-[9.6px] font-medium">
                    ✨ Super Admin Access (All Permissions)
                  </p>
                ) : appPermissions.length === 0 ? (
                  <p className="mt-[3.2px] text-gray-400 text-[9.6px]">Tidak ada permission yang tersedia</p>
                ) : (
                  <ul className="mt-[3.2px] max-h-[102.4px] overflow-y-auto space-y-[3.2px] text-[9.6px] text-gray-700">
                    {appPermissions.map(permission => (
                      <li
                        key={permission.full}
                        className="px-[6.4px] py-[3.2px] bg-gray-100 border border-gray-200 flex flex-col"
                      >
                        <span className="font-medium text-gray-800">{permission.label}</span>
                        <span className="text-[8.8px] text-gray-500">{permission.full}</span>
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