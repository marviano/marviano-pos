'use client';

import { useOfflineSync } from '@/hooks/useOfflineSync';
import { Wifi, WifiOff, RefreshCw, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function OfflineIndicator() {
  const { 
    internetConnected, 
    databaseConnected, 
    lastSync, 
    syncInProgress, 
    triggerSync
  } = useOfflineSync();
  const [lastSyncText, setLastSyncText] = useState('Never');

  useEffect(() => {
    if (!lastSync) {
      setLastSyncText('Never');
      return;
    }

    const updateLastSyncText = () => {
      const now = Date.now();
      const diff = now - lastSync;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(minutes / 60);

      if (minutes < 1) {
        setLastSyncText('Just now');
      } else if (minutes < 60) {
        setLastSyncText(`${minutes}m ago`);
      } else if (hours < 24) {
        setLastSyncText(`${hours}h ago`);
      } else {
        setLastSyncText('> 24h ago');
      }
    };

    updateLastSyncText();
    const interval = setInterval(updateLastSyncText, 30000); // Update every 30s

    return () => clearInterval(interval);
  }, [lastSync]);

  // Determine status display based on connectivity
  const getStatusDisplay = () => {
    if (internetConnected && databaseConnected) {
      return { 
        text: 'Online', 
        color: 'bg-green-100 text-green-700 border-green-300',
        icon: Wifi,
        description: 'Internet & Database Connected'
      };
    } else if (!internetConnected && databaseConnected) {
      return { 
        text: 'Offline', 
        color: 'bg-orange-100 text-orange-700 border-orange-300',
        icon: WifiOff,
        description: 'Local Database Only'
      };
    } else if (internetConnected && !databaseConnected) {
      return { 
        text: 'Error', 
        color: 'bg-yellow-100 text-yellow-700 border-yellow-300',
        icon: Wifi,
        description: 'Internet OK, DB Error'
      };
    } else {
      return { 
        text: 'Offline', 
        color: 'bg-red-100 text-red-700 border-red-300',
        icon: WifiOff,
        description: 'No Connection'
      };
    }
  };

  const statusDisplay = getStatusDisplay();

  return (
    <div className="flex items-center space-x-2">
      {/* Status Badge */}
      <div
        className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${statusDisplay.color}`}
        title={statusDisplay.description}
      >
        <statusDisplay.icon className="w-3.5 h-3.5" />
        <span>{statusDisplay.text}</span>
      </div>

      {/* Last Sync Info */}
      {lastSync && (
        <div className="flex items-center space-x-1 text-xs text-gray-500">
          <Clock className="w-3 h-3" />
          <span>Synced {lastSyncText}</span>
        </div>
      )}

      {/* Sync Button */}
      {internetConnected && (
        <button
          onClick={triggerSync}
          disabled={syncInProgress}
          className={`p-1.5 rounded-lg transition-colors ${
            syncInProgress
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
          }`}
          title="Sync data now"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncInProgress ? 'animate-spin' : ''}`} />
        </button>
      )}

      {/* Status Warnings */}
      {!internetConnected && databaseConnected && (
        <div className="text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded border border-orange-200">
          Using local data
        </div>
      )}
      
      {!internetConnected && !databaseConnected && (
        <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">
          No connection
        </div>
      )}
      
      {internetConnected && !databaseConnected && (
        <div className="text-xs text-yellow-600 bg-yellow-50 px-2 py-1 rounded border border-yellow-200">
          Database error
        </div>
      )}
    </div>
  );
}


