'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import POSLayout from '@/components/POSLayout';
import OfflineIndicator from '@/components/OfflineIndicator';
import ConnectionDebugPanel from '@/components/ConnectionDebugPanel';
import { LogOut, Minimize2, X } from 'lucide-react';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, user, logout } = useAuth();
  const [isClient, setIsClient] = useState(false);

  // Ensure we're on the client side to prevent hydration mismatch
  useEffect(() => {
    setIsClient(true);
  }, []);

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
          <h1 className="text-base font-semibold text-gray-800">Momoyo Bakery Kalimantan POS</h1>
          <span className="text-sm text-gray-500">Welcome, {user?.name}</span>
          <OfflineIndicator />
        </div>
        <div className="flex items-center space-x-2">
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
          <button
            onClick={logout}
            className="flex items-center space-x-1 bg-red-500 hover:bg-red-600 text-white px-2 py-1.5 rounded-lg transition-colors"
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
            <span className="text-xs">Logout</span>
          </button>
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
      
      {/* Debug Panel - Remove this after testing */}
      <ConnectionDebugPanel />
    </div>
  );
}