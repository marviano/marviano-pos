'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { isSuperAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import BaristaDisplay from './BaristaDisplay';
import KitchenDisplay from './KitchenDisplay';
import { X, Minus, Maximize2, Volume2 } from 'lucide-react';

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function BaristaKitchenDisplay() {
  const { user } = useAuth();
  const [view, setView] = useState<'split' | 'barista' | 'kitchen'>('split');
  
  // Wait for user to load
  if (!user) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center p-8 bg-white rounded-lg shadow-lg">
          <h2 className="text-xl font-bold text-gray-600 mb-2">Loading...</h2>
          <p className="text-gray-700">Loading user data...</p>
        </div>
      </div>
    );
  }
  
  const businessId = user?.selectedBusinessId;
  
  if (!businessId) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center p-8 bg-white rounded-lg shadow-lg">
          <h2 className="text-xl font-bold text-red-600 mb-2">No Business Selected</h2>
          <p className="text-gray-700">Please log in and select a business to access the Barista & Kitchen Display.</p>
        </div>
      </div>
    );
  }

  // Check permissions - use the same logic as LeftSidebar
  const perm1 = hasPermission(user, 'access_baristaandkitchen');
  const perm2 = hasPermission(user, 'access_barista_and_kitchen');
  const hasDirectPerm = user?.permissions?.includes('access_baristaandkitchen') || false;
  const hasDirectPermWithUnderscores = user?.permissions?.includes('access_barista_and_kitchen') || false;
  const isAdmin = isSuperAdmin(user);
  const hasAccess = isAdmin || perm1 || perm2 || hasDirectPerm || hasDirectPermWithUnderscores;
  
  if (!hasAccess) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center p-8 bg-white rounded-lg shadow-lg">
          <h2 className="text-xl font-bold text-red-600 mb-2">Access Denied</h2>
          <p className="text-gray-700">You need access_baristaandkitchen permission to access this display.</p>
        </div>
      </div>
    );
  }

  const handleClose = () => {
    const electronAPI = getElectronAPI();
    if (electronAPI?.closeWindow) {
      electronAPI.closeWindow();
    }
  };

  const handleMinimize = () => {
    const electronAPI = getElectronAPI();
    if (electronAPI?.minimizeWindow) {
      electronAPI.minimizeWindow();
    }
  };

  const handleMaximize = () => {
    const electronAPI = getElectronAPI();
    if (electronAPI?.maximizeWindow) {
      electronAPI.maximizeWindow();
    }
  };

  const playTestSound = () => {
    try {
      const audio = new Audio('./blacksmith_refine.mp3');
      audio.volume = 0.7;
      audio.play().catch((err) => console.warn('Test sound failed:', err));
    } catch (err) {
      console.warn('Test sound failed:', err);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Custom Title Bar - Draggable */}
      <div 
        className="bg-gray-800 text-white flex items-center justify-between px-2 py-1 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="text-xs font-medium px-2">Barista & Kitchen Display</div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* View Toggle Buttons */}
          <div className="flex gap-1 mr-2 items-center">
            <button
              type="button"
              onClick={playTestSound}
              className="p-1 hover:bg-gray-700 rounded transition-colors"
              title="Test sound"
            >
              <Volume2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setView('split')}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                view === 'split' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              View Semua
            </button>
            <button
              onClick={() => setView('barista')}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                view === 'barista' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              View barista
            </button>
            <button
              onClick={() => setView('kitchen')}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                view === 'kitchen' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              View Kitchen
            </button>
          </div>
          {/* Window Controls */}
          <button
            onClick={handleMinimize}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
            title="Minimize"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={handleMaximize}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
            title="Maximize"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-red-600 rounded transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Display Content */}
      <div className="flex-1 overflow-hidden">
        {view === 'split' && (
          <div className="h-full flex">
            <div className="w-1/2 border-r border-gray-300">
              <BaristaDisplay viewOnly={true} legacyCardLayout={true} />
            </div>
            <div className="w-1/2">
              <KitchenDisplay viewOnly={true} legacyCardLayout={true} />
            </div>
          </div>
        )}
        {view === 'barista' && <BaristaDisplay viewOnly={true} />}
        {view === 'kitchen' && <KitchenDisplay viewOnly={true} />}
      </div>
    </div>
  );
}
