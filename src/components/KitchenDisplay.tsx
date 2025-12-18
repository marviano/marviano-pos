'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { networkClient, OrderData, OrderItem, StatusUpdate } from '@/lib/networkClient';

interface KitchenOrderItem extends OrderItem {
  transactionId: string;
  receiptNumber: number;
  customerName?: string;
  pickupMethod: 'dine-in' | 'take-away';
  receivedAt: string;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export default function KitchenDisplay() {
  const [orderItems, setOrderItems] = useState<KitchenOrderItem[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [serverAddress, setServerAddress] = useState('localhost');
  const [serverPort, setServerPort] = useState(19967);
  const [showSettings, setShowSettings] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      console.log('[KitchenDisplay] Connected to server');
      setConnectionStatus('connected');
    };

    const onDisconnected = () => {
      console.log('[KitchenDisplay] Disconnected from server');
      setConnectionStatus('disconnected');
    };

    const onError = () => {
      setConnectionStatus('error');
    };

    const onNewOrder = (data: unknown) => {
      const order = data as OrderData;
      console.log('[KitchenDisplay] New order received:', order);
      
      // Filter only kitchen items (category1_id = 1)
      const kitchenItems = order.items.filter(item => item.category1_id === 1);
      
      if (kitchenItems.length === 0) {
        console.log('[KitchenDisplay] No kitchen items in this order');
        return;
      }

      // Add order metadata to each item
      const newItems: KitchenOrderItem[] = kitchenItems.map(item => ({
        ...item,
        transactionId: order.transactionId,
        receiptNumber: order.receiptNumber,
        customerName: order.customerName,
        pickupMethod: order.pickupMethod,
        receivedAt: new Date().toISOString()
      }));

      setOrderItems(prev => [...prev, ...newItems]);
      playNotificationSoundRef.current();
    };

    const onStatusUpdate = (data: unknown) => {
      const update = data as StatusUpdate;
      console.log('[KitchenDisplay] Status update received:', update);
      
      setOrderItems(prev => prev.map(item => {
        if (item.transactionId === update.transactionId && item.itemId === update.itemId) {
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

    // Auto-connect on mount
    setConnectionStatus('connecting');
    networkClient.connect('localhost', 19967, 'kitchen').then(result => {
      if (!result.success) {
        setConnectionStatus('error');
        console.error('[KitchenDisplay] Connection failed:', result.error);
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

  // Handle double-tap to mark item as ready
  const handleItemDoubleTap = useCallback((item: KitchenOrderItem) => {
    const newStatus = item.status === 'pending' ? 'preparing' : 
                      item.status === 'preparing' ? 'ready' : item.status;
    
    if (newStatus === item.status) return;

    // Update local state
    setOrderItems(prev => prev.map(i => {
      if (i.transactionId === item.transactionId && i.itemId === item.itemId) {
        return { ...i, status: newStatus };
      }
      return i;
    }));

    // Send status update to server
    networkClient.sendStatusUpdate({
      transactionId: item.transactionId,
      itemId: item.itemId,
      status: newStatus,
      preparedBy: 'kitchen'
    });

    // Remove ready items after 3 seconds
    if (newStatus === 'ready') {
      setTimeout(() => {
        setOrderItems(prev => prev.filter(i => 
          !(i.transactionId === item.transactionId && i.itemId === item.itemId)
        ));
      }, 3000);
    }
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

  // Format time
  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('id-ID', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 px-4 py-3 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-orange-500">🍳 DAPUR</h1>
          <span className="text-gray-400">|</span>
          <span className="text-gray-300">{orderItems.filter(i => i.status !== 'ready').length} item menunggu</span>
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
                networkClient.disconnect();
                setConnectionStatus('connecting');
                networkClient.connect(serverAddress, serverPort, 'kitchen').then(result => {
                  if (!result.success) {
                    setConnectionStatus('error');
                    console.error('[KitchenDisplay] Reconnection failed:', result.error);
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

      {/* Order Grid */}
      <div className="flex-1 p-4 overflow-auto">
        {orderItems.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-gray-500">
              <div className="text-6xl mb-4">🍳</div>
              <div className="text-xl">Tidak ada pesanan</div>
              <div className="text-sm mt-2">Pesanan makanan akan muncul di sini</div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {orderItems.map((item) => (
              <div
                key={`${item.transactionId}-${item.itemId}`}
                onDoubleClick={() => handleItemDoubleTap(item)}
                className={`
                  ${getStatusColor(item.status)} 
                  rounded-xl p-4 cursor-pointer select-none
                  transition-all duration-200 hover:scale-105 hover:shadow-lg
                  ${item.status === 'ready' ? 'opacity-60' : ''}
                `}
              >
                {/* Receipt Number */}
                <div className="text-xs font-bold mb-2 opacity-80">
                  #{item.receiptNumber} • {formatTime(item.receivedAt)}
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
          </div>
        )}
      </div>

      {/* Footer Instructions */}
      <div className="bg-gray-800 px-4 py-2 text-center text-sm text-gray-500 border-t border-gray-700">
        💡 Double-tap item: Menunggu → Diproses → Siap
      </div>

      {/* Hidden audio element for notification */}
      <audio ref={audioRef} />
    </div>
  );
}

