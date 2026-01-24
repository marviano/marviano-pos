'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { isSuperAdmin } from '@/lib/auth';
import BaristaDisplay from './BaristaDisplay';
import KitchenDisplay from './KitchenDisplay';
import { X, Minus, Maximize2 } from 'lucide-react';

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function BaristaKitchenDisplay() {
  const { user } = useAuth();
  const [view, setView] = useState<'split' | 'barista' | 'kitchen'>('split');
  
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

  // Check permissions
  const hasPermission = user?.permissions?.includes('access_baristaandkitchen') || false;
  
  if (!isSuperAdmin(user) && !hasPermission) {
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
          <div className="flex gap-1 mr-2">
            <button
              onClick={() => setView('split')}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                view === 'split' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              Split
            </button>
            <button
              onClick={() => setView('barista')}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                view === 'barista' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              Barista
            </button>
            <button
              onClick={() => setView('kitchen')}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                view === 'kitchen' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              Kitchen
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
              <BaristaDisplay viewOnly={true} />
            </div>
            <div className="w-1/2">
              <KitchenDisplay viewOnly={true} />
            </div>
          </div>
        )}
        {view === 'barista' && <BaristaDisplay viewOnly={true} />}
        {view === 'kitchen' && <KitchenDisplay viewOnly={true} />}
      </div>
    </div>
  );
}
