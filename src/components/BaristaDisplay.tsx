'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { networkClient, OrderData, OrderItem, StatusUpdate } from '@/lib/networkClient';
import { getServerSettings, saveServerSettings } from '@/lib/serverSettings';

interface BaristaOrderItem extends OrderItem {
  transactionId: string;
  receiptNumber: number;
  customerName?: string;
  pickupMethod: 'dine-in' | 'take-away';
  startedAt: string; // When item first appeared (for timer)
  finishedAt?: string; // When item was marked finished (for timer stop)
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export default function BaristaDisplay() {
  const [orderItems, setOrderItems] = useState<BaristaOrderItem[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const initialSettings = getServerSettings();
  const [serverAddress, setServerAddress] = useState(initialSettings.address);
  const [serverPort, setServerPort] = useState(initialSettings.port);
  const [showSettings, setShowSettings] = useState(false);
  const [, setTimerTick] = useState(0); // Force re-render for timer updates
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Update timer every second for items in "preparing" status
  useEffect(() => {
    const interval = setInterval(() => {
      // Only update if there are items in preparing status
      const hasPreparingItems = orderItems.some(item => item.status === 'preparing');
      if (hasPreparingItems) {
        setTimerTick(prev => prev + 1);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [orderItems]);

  // Play notification sound
  const playNotificationSound = useCallback(() => {
    try {
      // Create a simple beep using Web Audio API
      const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
      console.error('Failed to play notification sound:', error);
    }
  }, []);

  // Use refs to store latest callbacks without triggering effect re-runs
  const playNotificationSoundRef = useRef(playNotificationSound);
  playNotificationSoundRef.current = playNotificationSound;

  // Setup WebSocket handlers - run only once on mount
  useEffect(() => {
    // Define all handlers inside effect to avoid dependency issues
    const onConnected = () => {
      console.log('[BaristaDisplay] ✅ Connected to server successfully!');
      setConnectionStatus('connected');
    };

    const onDisconnected = () => {
      console.log('[BaristaDisplay] Disconnected from server');
      setConnectionStatus('disconnected');
    };

    const onError = () => {
      setConnectionStatus('error');
    };

    const onNewOrder = (data: unknown) => {
      const order = data as OrderData;
      console.log('[BaristaDisplay] 📦 New order received:', order);
      console.log('[BaristaDisplay] Order items:', order.items);
      
      // Filter only barista items (category1_id = 2)
      const baristaItems = order.items.filter(item => item.category1_id === 2);
      
      if (baristaItems.length === 0) {
        console.log('[BaristaDisplay] No barista items in this order');
        return;
      }

      // Add order metadata to each item - set status to 'preparing' and start timer
      const now = new Date().toISOString();
      const newItems: BaristaOrderItem[] = baristaItems.map(item => ({
        ...item,
        status: 'preparing' as const, // Always start as preparing
        transactionId: order.transactionId,
        receiptNumber: order.receiptNumber,
        customerName: order.customerName,
        pickupMethod: order.pickupMethod,
        startedAt: now // Timer starts when item appears
      }));

      setOrderItems(prev => [...prev, ...newItems]);
      playNotificationSoundRef.current();
    };

    const onStatusUpdate = (data: unknown) => {
      const update = data as StatusUpdate;
      console.log('[BaristaDisplay] Status update received:', update);
      
      setOrderItems(prev => prev.map(item => {
        if (item.transactionId === update.transactionId && item.itemId === update.itemId) {
          // If status changed to finished, stop the timer
          if (update.status === 'finished' && item.status !== 'finished') {
            return { ...item, status: update.status, finishedAt: new Date().toISOString() };
          }
          return { ...item, status: update.status };
        }
        return item;
      }));
    };

    // Register handlers
    networkClient.on('connected', onConnected);
    networkClient.on('disconnected', onDisconnected);
    networkClient.on('error', onError);
    networkClient.on('new_order', onNewOrder);
    networkClient.on('status_update', onStatusUpdate);

    // Auto-connect on mount using stored settings
    const settings = getServerSettings();
    console.log('[BaristaDisplay] Connecting to server:', settings.address, ':', settings.port);
    setServerAddress(settings.address);
    setServerPort(settings.port);
    setConnectionStatus('connecting');
    networkClient.connect(settings.address, settings.port, 'barista').then(result => {
      if (!result.success) {
        setConnectionStatus('error');
        console.error('[BaristaDisplay] ❌ Connection failed:', result.error);
        console.error('[BaristaDisplay] Server settings:', settings);
      } else {
        console.log('[BaristaDisplay] ✅ Connection attempt successful, waiting for confirmation...');
      }
    });

    // Cleanup - remove all handlers
    return () => {
      networkClient.off('connected', onConnected);
      networkClient.off('disconnected', onDisconnected);
      networkClient.off('error', onError);
      networkClient.off('new_order', onNewOrder);
      networkClient.off('status_update', onStatusUpdate);
      networkClient.disconnect();
    };
  }, []); // Empty dependency array - run only once

  // Handle double-tap to toggle item status: preparing → finished
  const handleItemDoubleTap = useCallback((item: BaristaOrderItem) => {
    // Only toggle if currently preparing
    if (item.status !== 'preparing') return;

    const newStatus = 'finished' as const;
    const finishedAt = new Date().toISOString();

    // Update local state - stop timer when finished
    setOrderItems(prev => prev.map(i => {
      if (i.transactionId === item.transactionId && i.itemId === item.itemId) {
        return { ...i, status: newStatus, finishedAt };
      }
      return i;
    }));

    // Send status update to server
    networkClient.sendStatusUpdate({
      transactionId: item.transactionId,
      itemId: item.itemId,
      status: newStatus,
      preparedBy: 'barista'
    });
  }, []);

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-red-500';
      case 'preparing': return 'bg-yellow-500';
      case 'ready': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  // Get status text
  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return 'Menunggu';
      case 'preparing': return 'Diproses';
      case 'ready': return 'Siap';
      default: return status;
    }
  };

  // Format timer: MM:SS or HH:MM:SS if > 60 minutes
  const formatTimer = (startedAt: string, finishedAt?: string): string => {
    const start = new Date(startedAt).getTime();
    const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
    const elapsedMs = end - start;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${hours}:${mins.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 px-4 py-3 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-amber-600">☕ BARISTA</h1>
          <span className="text-gray-400">|</span>
          <span className="text-gray-300">{orderItems.filter(i => i.status === 'preparing').length} item diproses</span>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Connection Status */}
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              connectionStatus === 'connected' ? 'bg-green-500' :
              connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
              connectionStatus === 'error' ? 'bg-red-500' : 'bg-gray-500'
            }`} />
            <span className="text-sm text-gray-400">
              {connectionStatus === 'connected' ? 'Terhubung' :
               connectionStatus === 'connecting' ? 'Menghubungkan...' :
               connectionStatus === 'error' ? 'Error' : 'Terputus'}
            </span>
          </div>

          {/* Settings Button */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-gray-800 px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">Server:</label>
              <input
                type="text"
                value={serverAddress}
                onChange={(e) => setServerAddress(e.target.value)}
                className="bg-gray-700 px-3 py-1 rounded text-sm w-32"
                placeholder="localhost"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">Port:</label>
              <input
                type="number"
                value={serverPort}
                onChange={(e) => setServerPort(Number(e.target.value))}
                className="bg-gray-700 px-3 py-1 rounded text-sm w-24"
              />
            </div>
            <button
              onClick={() => {
                // Save settings before reconnecting
                saveServerSettings({ address: serverAddress, port: serverPort });
                networkClient.disconnect();
                setConnectionStatus('connecting');
                networkClient.connect(serverAddress, serverPort, 'barista').then(result => {
                  if (!result.success) {
                    setConnectionStatus('error');
                    console.error('[BaristaDisplay] Reconnection failed:', result.error);
                  }
                });
              }}
              className="px-4 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors"
            >
              Hubungkan Ulang
            </button>
          </div>
        </div>
      )}

      {/* 2-Column Layout: Proses (left) and Selesai (right) */}
      <div className="flex-1 flex gap-4 p-4 overflow-hidden">
        {/* Proses Column (Left) */}
        <div className="flex-1 flex flex-col border-r border-gray-700 pr-4">
          <h2 className="text-lg font-bold text-yellow-500 mb-3">PROSES</h2>
          <div className="flex-1 overflow-y-auto space-y-3">
            {orderItems
              .filter(item => item.status === 'preparing')
              .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()) // Oldest first
              .map((item) => (
                <div
                  key={`${item.transactionId}-${item.itemId}`}
                  onDoubleClick={() => handleItemDoubleTap(item)}
                  className={`
                    ${getStatusColor(item.status)} 
                    rounded-xl p-4 cursor-pointer select-none
                    transition-all duration-200 hover:scale-105 hover:shadow-lg
                  `}
                >
                  {/* Timer and Receipt Number */}
                  <div className="text-xs font-bold mb-2 opacity-80 flex justify-between items-center">
                    <span>#{item.receiptNumber}</span>
                    <span className="bg-black/20 px-2 py-1 rounded">⏱️ {formatTimer(item.startedAt)}</span>
                  </div>

                  {/* Product Name */}
                  <div className="text-xl font-bold mb-2 leading-tight">
                    {item.productName}
                  </div>

                  {/* Quantity */}
                  <div className="text-4xl font-black mb-2">
                    x{item.quantity}
                  </div>

                  {/* Customizations */}
                  {item.customizations && item.customizations.length > 0 && (
                    <div className="text-sm mb-2 opacity-90">
                      {item.customizations.map((c, idx) => (
                        <div key={idx}>
                          {c.selected_options.map(o => o.option_name).join(', ')}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Custom Note */}
                  {item.customNote && (
                    <div className="text-sm italic bg-black/20 rounded px-2 py-1 mb-2">
                      📝 {item.customNote}
                    </div>
                  )}

                  {/* Pickup Method */}
                  <div className="text-xs uppercase tracking-wide opacity-80">
                    {item.pickupMethod === 'dine-in' ? '🍽️ Makan di tempat' : '📦 Bawa pulang'}
                  </div>

                  {/* Status */}
                  <div className="mt-3 text-center">
                    <span className="text-xs font-bold uppercase bg-black/20 px-3 py-1 rounded-full">
                      {getStatusText(item.status)}
                    </span>
                  </div>
                </div>
              ))}
            {orderItems.filter(item => item.status === 'preparing').length === 0 && (
              <div className="text-center text-gray-500 py-8">
                <div className="text-4xl mb-2">☕</div>
                <div className="text-sm">Tidak ada item diproses</div>
              </div>
            )}
          </div>
        </div>

        {/* Selesai Column (Right) */}
        <div className="flex-1 flex flex-col pl-4">
          <h2 className="text-lg font-bold text-green-500 mb-3">SELESAI</h2>
          <div className="flex-1 overflow-y-auto space-y-3">
            {orderItems
              .filter(item => item.status === 'finished')
              .sort((a, b) => {
                // Sort by finishedAt if available, otherwise by startedAt
                const aTime = a.finishedAt ? new Date(a.finishedAt).getTime() : new Date(a.startedAt).getTime();
                const bTime = b.finishedAt ? new Date(b.finishedAt).getTime() : new Date(b.startedAt).getTime();
                return aTime - bTime; // Oldest first
              })
              .map((item) => (
                <div
                  key={`${item.transactionId}-${item.itemId}`}
                  className={`
                    ${getStatusColor(item.status)} 
                    rounded-xl p-4 select-none opacity-90
                  `}
                >
                  {/* Timer and Receipt Number */}
                  <div className="text-xs font-bold mb-2 opacity-80 flex justify-between items-center">
                    <span>#{item.receiptNumber}</span>
                    <span className="bg-black/20 px-2 py-1 rounded">⏱️ {formatTimer(item.startedAt, item.finishedAt)}</span>
                  </div>

                  {/* Product Name */}
                  <div className="text-xl font-bold mb-2 leading-tight">
                    {item.productName}
                  </div>

                  {/* Quantity */}
                  <div className="text-4xl font-black mb-2">
                    x{item.quantity}
                  </div>

                  {/* Customizations */}
                  {item.customizations && item.customizations.length > 0 && (
                    <div className="text-sm mb-2 opacity-90">
                      {item.customizations.map((c, idx) => (
                        <div key={idx}>
                          {c.selected_options.map(o => o.option_name).join(', ')}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Custom Note */}
                  {item.customNote && (
                    <div className="text-sm italic bg-black/20 rounded px-2 py-1 mb-2">
                      📝 {item.customNote}
                    </div>
                  )}

                  {/* Pickup Method */}
                  <div className="text-xs uppercase tracking-wide opacity-80">
                    {item.pickupMethod === 'dine-in' ? '🍽️ Makan di tempat' : '📦 Bawa pulang'}
                  </div>

                  {/* Status */}
                  <div className="mt-3 text-center">
                    <span className="text-xs font-bold uppercase bg-black/20 px-3 py-1 rounded-full">
                      {getStatusText(item.status)}
                    </span>
                  </div>
                </div>
              ))}
            {orderItems.filter(item => item.status === 'finished').length === 0 && (
              <div className="text-center text-gray-500 py-8">
                <div className="text-4xl mb-2">✅</div>
                <div className="text-sm">Tidak ada item selesai</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer Instructions */}
      <div className="bg-gray-800 px-4 py-2 text-center text-sm text-gray-500 border-t border-gray-700">
        💡 Double-tap item di kolom PROSES untuk memindahkan ke SELESAI
      </div>

      {/* Hidden audio element for notification */}
      <audio ref={audioRef} />
    </div>
  );
}



