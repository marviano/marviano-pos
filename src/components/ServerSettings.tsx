'use client';

import { useEffect, useState } from 'react';

interface ServerStatus {
  isRunning: boolean;
  port: number;
  clientCount: number;
  clients: Array<{ id: string; type: 'pos' | 'kitchen' | 'barista'; connectedAt: number }>;
}

export default function ServerSettings() {
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [port, setPort] = useState(19967);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch server status
  const fetchStatus = async () => {
    if (!window.electronAPI?.websocketServerStatus) return;
    
    try {
      const status = await window.electronAPI.websocketServerStatus();
      setServerStatus(status);
      if (status.port) {
        setPort(status.port);
      }
    } catch (err) {
      console.error('Failed to fetch server status:', err);
    }
  };

  // Auto-refresh status every 2 seconds
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  // Start server
  const handleStart = async () => {
    if (!window.electronAPI?.websocketServerStart) return;
    
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.websocketServerStart(port);
      if (result.success) {
        await fetchStatus();
      } else {
        setError(result.error || 'Failed to start server');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start server');
    } finally {
      setIsLoading(false);
    }
  };

  // Stop server
  const handleStop = async () => {
    if (!window.electronAPI?.websocketServerStop) return;
    
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.websocketServerStop();
      if (result.success) {
        await fetchStatus();
      } else {
        setError(result.error || 'Failed to stop server');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop server');
    } finally {
      setIsLoading(false);
    }
  };

  // Get client type label
  const getClientTypeLabel = (type: string) => {
    switch (type) {
      case 'pos': return 'POS';
      case 'kitchen': return 'Dapur';
      case 'barista': return 'Barista';
      default: return type;
    }
  };

  // Format connection time
  const formatConnectionTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('id-ID', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Server WebSocket</h2>

      {/* Server Control */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Status Server</h3>
            <p className="text-sm text-gray-600">Kelola server WebSocket untuk komunikasi multi-client</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`px-4 py-2 rounded-lg font-medium ${
              serverStatus?.isRunning 
                ? 'bg-green-100 text-green-800' 
                : 'bg-gray-100 text-gray-800'
            }`}>
              {serverStatus?.isRunning ? '🟢 Berjalan' : '⚫ Berhenti'}
            </div>
            {serverStatus?.isRunning && (
              <span className="text-sm text-gray-600">
                Port: {serverStatus.port}
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Port Server
            </label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              disabled={serverStatus?.isRunning || isLoading}
              min="1024"
              max="65535"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed text-gray-900"
            />
            <p className="mt-1 text-xs text-gray-500">
              Port yang digunakan untuk koneksi WebSocket (1024-65535)
            </p>
          </div>
          <div className="flex gap-2 pt-6">
            {!serverStatus?.isRunning ? (
              <button
                onClick={handleStart}
                disabled={isLoading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isLoading ? 'Memulai...' : 'Mulai Server'}
              </button>
            ) : (
              <button
                onClick={handleStop}
                disabled={isLoading}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isLoading ? 'Menghentikan...' : 'Hentikan Server'}
              </button>
            )}
            <button
              onClick={fetchStatus}
              disabled={isLoading}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              🔄 Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Connected Clients */}
      {serverStatus?.isRunning && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">
              Klien Terhubung ({serverStatus.clientCount})
            </h3>
          </div>

          {serverStatus.clientCount === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>Tidak ada klien yang terhubung</p>
            </div>
          ) : (
            <div className="space-y-2">
              {serverStatus.clients.map((client) => (
                <div
                  key={client.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${
                      client.type === 'pos' ? 'bg-blue-500' :
                      client.type === 'kitchen' ? 'bg-orange-500' :
                      'bg-amber-600'
                    }`} />
                    <div>
                      <div className="font-medium text-gray-800">
                        {getClientTypeLabel(client.type)}
                      </div>
                      <div className="text-xs text-gray-500">
                        ID: {client.id.substring(0, 20)}...
                      </div>
                    </div>
                  </div>
                  <div className="text-sm text-gray-600">
                    Terhubung: {formatConnectionTime(client.connectedAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Info Box */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-semibold text-blue-900 mb-2">ℹ️ Informasi</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Server WebSocket memungkinkan komunikasi real-time</li>
          <li>• Port default: 19967 (dapat diubah jika diperlukan)</li>
          <li>• Server otomatis dimulai saat aplikasi dibuka</li>
        </ul>
      </div>
    </div>
  );
}



