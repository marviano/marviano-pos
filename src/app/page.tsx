'use client';

import { useEffect, useState } from 'react';
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

  // Show loading while checking authentication or during SSR
  if (!isClient || !isAuthenticated) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center overflow-hidden">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden">
      {/* Top Bar with User Info and Logout */}
      <div className="h-10 bg-white border-b border-gray-200 flex items-center justify-between px-4">
        <div className="flex items-center space-x-4">
          <h1 className="text-base font-semibold text-gray-800">MOMOYO MADIUN 1</h1>
          <div className="w-px h-6 bg-gray-300"></div>
          <span className="text-sm text-gray-500">{user?.name}</span>
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
      </div>
      
      {/* POS Interface */}
      <POSLayout />
    </div>
  );
}