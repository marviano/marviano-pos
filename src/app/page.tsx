'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import POSLayout from '@/components/POSLayout';
import OfflineStatus from '@/components/OfflineStatus';
import { LogOut, Minimize2, X } from 'lucide-react';
import { databaseHealthService } from '@/lib/databaseHealth';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, user, logout } = useAuth();
  const [isClient, setIsClient] = useState(false);
  const [databaseStatus, setDatabaseStatus] = useState<string>('Checking...');
  const [isSyncing, setIsSyncing] = useState(false);
  const [showUserDebug, setShowUserDebug] = useState(false);
  const userDebugButtonRef = useRef<HTMLButtonElement | null>(null);
  const userDebugPanelRef = useRef<HTMLDivElement | null>(null);

  const appPermissions = useMemo(() => {
    if (!user?.permissions || user.permissions.length === 0) {
      return [];
    }
    return user.permissions.map(permission => ({
      full: permission,
      label: permission.replace(/^marviano-pos_/, ''),
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
      router.replace('/login');
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
      <div className="h-10 bg-white border-b border-gray-200 flex items-center justify-between px-4 relative">
        <div className="flex items-center space-x-4">
          <h1 className="text-base font-semibold text-gray-800">MOMOYO MADIUN 1</h1>
          <div className="w-px h-6 bg-gray-300"></div>
          <button
            ref={userDebugButtonRef}
            type="button"
            onClick={() => setShowUserDebug(prev => !prev)}
            className="text-sm font-medium text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white rounded px-1 transition-colors"
            title="Klik untuk melihat detail pengguna"
          >
            {user?.name || 'Pengguna'}
          </button>
          <div className="w-px h-6 bg-gray-300"></div>
          <OfflineStatus />
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-px h-6 bg-gray-300"></div>
          <div className="flex items-center gap-2 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded">
            <span className="text-xs text-blue-700 font-medium">Database:</span>
            {isSyncing && (
              <span className="inline-block w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse"></span>
            )}
            <span className="text-xs text-blue-700">{databaseStatus}</span>
            <button
              onClick={async () => {
                setIsSyncing(true);
                setDatabaseStatus('Syncing...');
                try {
                  const success = await databaseHealthService.forceSync();
                  const newStatus = await databaseHealthService.getStatusMessage();
                  setDatabaseStatus(newStatus);
                  
                  // Trigger data refresh event for POSLayout
                  window.dispatchEvent(new CustomEvent('dataSynced'));
                } catch (error) {
                  console.error('❌ Sync failed:', error);
                  setDatabaseStatus('Sync failed');
                } finally {
                  setIsSyncing(false);
                }
              }}
              disabled={isSyncing}
              className="px-1.5 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Sync database"
            >
              Sync Now
            </button>
          </div>
          <div className="w-px h-6 bg-gray-300"></div>
          <button
            onClick={async () => {
              if (window.electronAPI) {
                const result = await window.electronAPI.createCustomerDisplay();
                console.log('Customer display result:', result);
                alert(result.message);
              }
            }}
            className="flex items-center space-x-1 bg-blue-500 hover:bg-blue-600 text-white px-2 py-1.5 rounded-lg transition-colors"
            title="Create Customer Display"
          >
            <span className="text-xs">Customer Display</span>
          </button>
          <div className="w-px h-6 bg-gray-300"></div>
          <button
            onClick={logout}
            className="flex items-center space-x-1 bg-red-500 hover:bg-red-600 text-white px-2 py-1.5 rounded-lg transition-colors"
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
            <span className="text-xs">Logout</span>
          </button>
          <div className="w-px h-6 bg-gray-300"></div>
          <button
            onClick={() => {
              if (window.electronAPI) {
                window.electronAPI.minimizeWindow();
              }
            }}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Minimize"
          >
            <Minimize2 className="w-4 h-4 text-gray-600" />
          </button>
          <div className="w-px h-6 bg-gray-300"></div>
          <button
            onClick={() => {
              if (window.electronAPI) {
                window.electronAPI.closeWindow();
              }
            }}
            className="p-2 hover:bg-red-100 rounded-lg transition-colors"
            title="Close"
          >
            <X className="w-4 h-4 text-red-600" />
          </button>
        </div>

        {showUserDebug && (
          <div
            ref={userDebugPanelRef}
            className="absolute top-full left-4 mt-2 w-72 rounded-lg border border-gray-200 bg-white shadow-xl p-4 z-50"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-800">User Debug Info</span>
              <button
                type="button"
                onClick={() => setShowUserDebug(false)}
                className="p-1 rounded hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Close user debug panel"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-gray-500">Nama:</span>
                <span className="ml-2 font-medium text-gray-800">{user?.name || 'Tidak diketahui'}</span>
              </div>
              <div>
                <span className="text-gray-500">Email:</span>
                <span className="ml-2 text-gray-800">{user?.email || 'Tidak diketahui'}</span>
              </div>
              <div>
                <span className="text-gray-500">Role:</span>
                <span className="ml-2 text-gray-800 font-medium">
                  {roleDisplayName}
                  {user?.role_id !== null && user?.role_id !== undefined ? ` (${user.role_id})` : ''}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Normalized Role:</span>
                <span className="ml-2 uppercase tracking-wide text-xs font-semibold text-blue-600">
                  {user?.role || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Role ID:</span>
                <span className="ml-2 text-gray-800">
                  {user?.role_id !== null && user?.role_id !== undefined ? user.role_id : 'N/A'}
                </span>
              </div>
              <div className="pt-2 border-t border-gray-100">
                <span className="text-gray-500">Permissions ({appPermissions.length}):</span>
                {appPermissions.length === 0 ? (
                  <p className="mt-1 text-gray-400 text-xs">Tidak ada permission dengan prefix marviano-pos_</p>
                ) : (
                  <ul className="mt-1 max-h-32 overflow-y-auto space-y-1 text-xs text-gray-700">
                    {appPermissions.map(permission => (
                      <li
                        key={permission.full}
                        className="px-2 py-1 bg-gray-50 border border-gray-200 rounded flex flex-col"
                      >
                        <span className="font-medium text-gray-800">{permission.label}</span>
                        <span className="text-[11px] text-gray-500">{permission.full}</span>
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