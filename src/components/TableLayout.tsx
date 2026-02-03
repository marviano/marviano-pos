'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';

interface Room {
  id: number;
  business_id: number;
  name: string;
  table_count?: number;
  canvas_width?: number | null;
  canvas_height?: number | null;
  font_size_multiplier?: number | null;
}

interface Table {
  id: number;
  room_id: number;
  table_number: string;
  position_x: number | string;
  position_y: number | string;
  width: number | string;
  height: number | string;
  capacity: number;
  shape: 'circle' | 'rectangle';
}

interface LayoutElement {
  id: number;
  room_id: number;
  label: string;
  position_x: number | string;
  position_y: number | string;
  width: number | string;
  height: number | string;
  element_type: string;
  color: string;
  text_color: string;
}

interface PendingTransaction {
  uuid_id: string;
  table_id: number | null;
  created_at: string;
  status: string;
}

interface TableLayoutProps {
  onLoadTransaction?: (transactionId: string) => void;
}

export default function TableLayout({ onLoadTransaction }: TableLayoutProps = {} as TableLayoutProps) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<number | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [layoutElements, setLayoutElements] = useState<LayoutElement[]>([]);
  
  const businessId = user?.selectedBusinessId;
  
  if (!businessId) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-700">No business selected. Please log in and select a business.</p>
      </div>
    );
  }
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransaction[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  // const [canvasScale, setCanvasScale] = useState(1);

  // Update canvas size
  const updateCanvasSize = useCallback(() => {
    if (canvasRef.current && canvasContainerRef.current) {
      const selectedRoomData = rooms.find(r => r.id === selectedRoom);
      let width: number;
      let height: number;
      let scale = 1;

      // Use stored canvas dimensions if available, otherwise calculate from container
      if (selectedRoomData?.canvas_width && selectedRoomData?.canvas_height) {
        // Use exact stored dimensions without scaling
        // The container will handle scrolling if canvas is larger than viewport
        width = selectedRoomData.canvas_width;
        height = selectedRoomData.canvas_height;
        scale = 1; // No scaling when using explicit dimensions
      } else {
        // Fallback to calculated 16:9 aspect ratio
        const containerWidth = canvasContainerRef.current.clientWidth;
        width = containerWidth;
        height = (containerWidth / 16) * 9;
        scale = 1;
      }

      setCanvasSize(prev => {
        if (prev.width !== width || prev.height !== height) {
          return { width, height };
        }
        return prev;
      });
    }
  }, [selectedRoom, rooms]);

  const fetchRooms = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('[TableLayout] Fetching rooms for businessId:', businessId);
      console.log('[TableLayout] User:', { id: user?.id, name: user?.name, selectedBusinessId: user?.selectedBusinessId });
      
      const electronAPI = window.electronAPI;
      if (!electronAPI?.getRestaurantRooms) {
        const errorMsg = 'getRestaurantRooms not available in Electron API';
        console.error('[TableLayout]', errorMsg);
        setError(errorMsg);
        setLoading(false);
        return;
      }

      const roomsData = await electronAPI.getRestaurantRooms(businessId);
      console.log('[TableLayout] Rooms data received:', roomsData);
      console.log('[TableLayout] Sample room data:', roomsData?.[0]);
      console.log('[TableLayout] Sample room font_size_multiplier:', roomsData?.[0]?.font_size_multiplier, 'type:', typeof roomsData?.[0]?.font_size_multiplier);
      
      const roomsArray = Array.isArray(roomsData) ? roomsData : [];
      setRooms(roomsArray);
      
      if (roomsArray.length === 0) {
        console.warn('[TableLayout] No rooms found for businessId:', businessId);
        setError(`No rooms found for business ID ${businessId}. Please create rooms in Salespulse first.`);
      }
      
      // Auto-select first room if available
      if (roomsArray.length > 0 && !selectedRoom) {
        setSelectedRoom(roomsArray[0].id);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error fetching rooms';
      console.error('[TableLayout] Error fetching rooms:', error);
      setError(`Failed to fetch rooms: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  }, [businessId, user, selectedRoom]);

  const fetchTables = useCallback(async () => {
    if (!selectedRoom) return;
    
    try {
      const electronAPI = window.electronAPI;
      if (!electronAPI?.getRestaurantTables) {
        console.error('getRestaurantTables not available');
        return;
      }

      const tablesData = await electronAPI.getRestaurantTables(selectedRoom);
      setTables(Array.isArray(tablesData) ? tablesData : []);
    } catch (error) {
      console.error('Error fetching tables:', error);
    }
  }, [selectedRoom]);

  const fetchLayoutElements = useCallback(async () => {
    if (!selectedRoom) {
      return;
    }
    
    try {
      const electronAPI = window.electronAPI;
      if (!electronAPI?.getRestaurantLayoutElements) {
        console.error('getRestaurantLayoutElements not available');
        return;
      }

      const elementsData = await electronAPI.getRestaurantLayoutElements(selectedRoom);
      const elementsArray = Array.isArray(elementsData) ? elementsData : [];
      console.log('[TableLayout] Layout elements fetched:', elementsArray.length, elementsArray);
      setLayoutElements(elementsArray);
    } catch (error) {
      console.error('Error fetching layout elements:', error);
    }
  }, [selectedRoom]);

  const fetchPendingTransactions = useCallback(async () => {
    if (!businessId) return;
    
    try {
      const electronAPI = window.electronAPI;
      if (!electronAPI?.localDbGetTransactions) {
        return;
      }

      const allTransactions = await electronAPI.localDbGetTransactions(businessId, 10000);
      const transactionsArray = Array.isArray(allTransactions) ? allTransactions : [];
      
      const pending = transactionsArray
        .filter((tx: unknown) => {
          if (tx && typeof tx === 'object' && 'status' in tx) {
            const transaction = tx as { status: string };
            return transaction.status === 'pending';
          }
          return false;
        })
        .map((tx: unknown) => {
          const t = tx as {
            uuid_id?: string;
            id?: string;
            table_id?: number | null;
            created_at?: string;
            status?: string;
          };
          return {
            uuid_id: t.uuid_id || t.id || '',
            table_id: t.table_id || null,
            created_at: t.created_at || new Date().toISOString(),
            status: t.status || 'pending',
          };
        });

      setPendingTransactions(pending);
    } catch (error) {
      console.error('Error fetching pending transactions:', error);
    }
  }, [businessId]);

  useEffect(() => {
    // Always observe container resize to recalculate scale when using stored dimensions
    if (canvasRef.current && canvasContainerRef.current) {
      updateCanvasSize();
      
      const resizeObserver = new ResizeObserver(() => {
        updateCanvasSize();
      });
      
      resizeObserver.observe(canvasContainerRef.current);
      
      window.addEventListener('resize', updateCanvasSize);
      
      return () => {
        if (canvasContainerRef.current) {
          resizeObserver.unobserve(canvasContainerRef.current);
        }
        window.removeEventListener('resize', updateCanvasSize);
      };
    }
  }, [updateCanvasSize]);

  // Fetch rooms when businessId is available
  useEffect(() => {
    if (businessId && businessId > 0) {
      fetchRooms();
    } else {
      setError('No business selected. Please log in and select a business first.');
      setLoading(false);
    }
  }, [businessId, fetchRooms]);

  // Fetch tables and elements when room is selected
  useEffect(() => {
    if (selectedRoom) {
      fetchTables();
      fetchLayoutElements();
      fetchPendingTransactions();
    } else {
      setTables([]);
      setLayoutElements([]);
      setPendingTransactions([]);
    }
  }, [selectedRoom, fetchTables, fetchLayoutElements, fetchPendingTransactions]);

  // Fetch pending transactions periodically
  useEffect(() => {
    if (selectedRoom && businessId) {
      fetchPendingTransactions();
      const interval = setInterval(fetchPendingTransactions, 5000);
      return () => clearInterval(interval);
    }
  }, [selectedRoom, businessId, fetchPendingTransactions]);

  // Update timer display every second
  useEffect(() => {
    if (pendingTransactions.length > 0) {
      const interval = setInterval(() => {
        setCurrentTime(new Date());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [pendingTransactions.length]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-600">Loading table layout...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 p-4 overflow-hidden">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Table Layout</h1>
        {businessId && (
          <p className="text-sm text-gray-600 mt-1">
            Business ID: {businessId} {user?.selectedBusinessId ? '(from user)' : '(fallback)'}
          </p>
        )}
      </div>
      
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Room Selector */}
      {rooms.length > 0 && (
        <div className="mb-4">
          <div className="flex flex-wrap gap-2">
            {rooms.map((room) => (
              <button
                key={room.id}
                onClick={() => setSelectedRoom(room.id)}
                className={`px-4 py-2 rounded-md transition-colors ${
                  selectedRoom === room.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                }`}
              >
                {room.name} ({room.table_count || 0})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Canvas */}
      {selectedRoom && (
        <div 
          ref={canvasContainerRef}
          className="flex-1 min-h-0"
          style={{
            ...(rooms.find(r => r.id === selectedRoom)?.canvas_width && rooms.find(r => r.id === selectedRoom)?.canvas_height
              ? {
                  // No constraints when explicit dimensions are set - let canvas be its natural size
                  minHeight: '400px',
                  overflow: 'visible'
                }
              : {
                  // Responsive constraints for auto-calculated dimensions
                  minHeight: '400px',
                  maxHeight: 'calc(100vh - 200px)',
                  overflow: 'auto'
                }
            )
          }}
        >
          <div
            ref={canvasRef}
            className="relative bg-gray-100 rounded-lg border-2 border-gray-300 overflow-hidden"
            style={{
              width: canvasSize.width > 0 ? `${canvasSize.width}px` : '100%',
              height: canvasSize.height || 400,
              minHeight: '400px',
              // Only apply maxWidth/maxHeight constraints when canvas dimensions are not explicitly set
              ...(rooms.find(r => r.id === selectedRoom)?.canvas_width && rooms.find(r => r.id === selectedRoom)?.canvas_height
                ? {} // No max constraints when explicit dimensions are set
                : { maxWidth: '100%', maxHeight: '100%' } // Apply constraints for auto-calculated dimensions
              ),
              margin: '0 auto',
              backgroundImage: `
                linear-gradient(to right, rgba(0,0,0,0.05) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(0,0,0,0.05) 1px, transparent 1px)
              `,
              backgroundSize: '20px 20px'
            }}
          >
            {/* Layout Elements */}
            {(() => {
              const selectedRoomData = rooms.find(r => r.id === selectedRoom);
              const fontSizeMultiplier = selectedRoomData?.font_size_multiplier ?? 1.0;
              const effectiveCanvasWidth = canvasSize.width || 800; // Fallback to 800 if not set
              const effectiveCanvasHeight = canvasSize.height || 600; // Fallback to 600 if not set
              
              console.log('[TableLayout] Rendering layout elements:', {
                count: layoutElements.length,
                room: selectedRoom,
                canvasSize,
                effectiveCanvasWidth,
                effectiveCanvasHeight,
                elements: layoutElements
              });
              
              
              if (layoutElements.length === 0) {
                console.log('[TableLayout] No layout elements to render');
                return null;
              }
              
              return layoutElements.map((element) => {
                const posX = typeof element.position_x === 'string' ? parseFloat(element.position_x) : element.position_x;
                const posY = typeof element.position_y === 'string' ? parseFloat(element.position_y) : element.position_y;
                const widthPercent = typeof element.width === 'string' ? parseFloat(element.width) : element.width;
                const heightPercent = typeof element.height === 'string' ? parseFloat(element.height) : element.height;
                
                const pixelX = (posX / 100) * effectiveCanvasWidth;
                const pixelY = (posY / 100) * effectiveCanvasHeight;
                const pixelWidth = (widthPercent / 100) * effectiveCanvasWidth;
                const pixelHeight = (heightPercent / 100) * effectiveCanvasHeight;

                const minDimension = Math.min(pixelWidth, pixelHeight);
                const baseFontSize = Math.max(10, Math.min(20, minDimension * 0.3));
                const fontSize = baseFontSize * fontSizeMultiplier;

                const MIN_SIZE_PERCENT = 3;
                const minPixelSize = Math.min(
                  (MIN_SIZE_PERCENT / 100) * effectiveCanvasWidth,
                  (MIN_SIZE_PERCENT / 100) * effectiveCanvasHeight
                );


                console.log('[TableLayout] Rendering element:', {
                  id: element.id,
                  label: element.label,
                  posX,
                  posY,
                  widthPercent,
                  heightPercent,
                  pixelX,
                  pixelY,
                  pixelWidth,
                  pixelHeight,
                  color: element.color
                });

                return (
                  <div
                    key={`element-${element.id}`}
                    style={{
                      position: 'absolute',
                      left: `${pixelX}px`,
                      top: `${pixelY}px`,
                      width: `${Math.max(pixelWidth, minPixelSize)}px`,
                      height: `${Math.max(pixelHeight, minPixelSize)}px`,
                      zIndex: 1, // Ensure elements are visible above background but below tables
                      pointerEvents: 'none', // Allow clicks to pass through to tables
                    }}
                    className="cursor-default"
                  >
                    <div
                      className="w-full h-full flex items-center justify-center relative shadow-lg overflow-hidden"
                      style={{
                        backgroundColor: element.color || '#9CA3AF',
                        color: element.text_color || '#000000',
                        minWidth: '30px',
                        minHeight: '30px',
                        border: '1px solid rgba(0,0,0,0.2)', // Add border to make it more visible
                      }}
                    >
                      <div
                        className="font-bold whitespace-nowrap text-center px-2"
                        style={{ fontSize: `${fontSize}px` }}
                      >
                        {element.label}
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
            
            {/* Tables */}
            {(() => {
              const selectedRoomData = rooms.find(r => r.id === selectedRoom);
              console.log('[TableLayout] Selected room data (tables):', selectedRoomData);
              console.log('[TableLayout] Selected room font_size_multiplier raw (tables):', selectedRoomData?.font_size_multiplier, 'type:', typeof selectedRoomData?.font_size_multiplier);
              const fontSizeMultiplier = selectedRoomData?.font_size_multiplier ?? 1.0;
              console.log('[TableLayout] Font size multiplier (tables):', fontSizeMultiplier, 'for room:', selectedRoom);
              return tables.map((table) => {
                // Convert percentage strings to numbers if needed
                const posX = typeof table.position_x === 'string' ? parseFloat(table.position_x) : table.position_x;
                const posY = typeof table.position_y === 'string' ? parseFloat(table.position_y) : table.position_y;
                const widthPercent = typeof table.width === 'string' ? parseFloat(table.width) : table.width;
                const heightPercent = typeof table.height === 'string' ? parseFloat(table.height) : table.height;
                
                const pixelX = (posX / 100) * canvasSize.width;
                const pixelY = (posY / 100) * canvasSize.height;
                const pixelWidth = (widthPercent / 100) * canvasSize.width;
                const pixelHeight = (heightPercent / 100) * canvasSize.height;

                // Calculate dynamic font size — scale down on small/square tables so layout stays neat
                const minDimension = Math.min(pixelWidth, pixelHeight);
                const baseFontSize = Math.max(7, Math.min(24, minDimension * 0.25)); // 25% of min, clamped 7–24px
                const fontSize = baseFontSize * fontSizeMultiplier;
                const smallFontSize = Math.max(6, fontSize * 0.7); // 70% of main, min 6px

              // Minimum size: 4% to ensure text is readable
              const MIN_SIZE_PERCENT = 4;
              const minPixelSize = Math.min(
                (MIN_SIZE_PERCENT / 100) * canvasSize.width,
                (MIN_SIZE_PERCENT / 100) * canvasSize.height
              );

              // Find pending transaction for this table
              const tableTransaction = pendingTransactions.find(
                tx => tx.table_id === table.id
              );

              return (
                <TableDisplay
                  key={table.id}
                  table={table}
                  pixelX={pixelX}
                  pixelY={pixelY}
                  pixelWidth={Math.max(pixelWidth, minPixelSize)}
                  pixelHeight={Math.max(pixelHeight, minPixelSize)}
                  fontSize={fontSize}
                  smallFontSize={smallFontSize}
                  transaction={tableTransaction}
                  currentTime={currentTime}
                  onLoadTransaction={onLoadTransaction}
                />
              );
              });
            })()}
          </div>
        </div>
      )}

      {!error && rooms.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-600">
            <p>No rooms found for this business.</p>
            <p className="text-sm mt-2">Create rooms in Salespulse first.</p>
            <p className="text-xs mt-1 text-gray-500">Business ID: {businessId}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Table Display Component — timer/content layout aligned with salespulse (no overlap on square, narrow padding)
function TableDisplay({
  table,
  pixelX,
  pixelY,
  pixelWidth,
  pixelHeight,
  fontSize,
  smallFontSize,
  transaction,
  currentTime,
  onLoadTransaction
}: {
  table: Table;
  pixelX: number;
  pixelY: number;
  pixelWidth: number;
  pixelHeight: number;
  fontSize: number;
  smallFontSize: number;
  transaction?: PendingTransaction;
  currentTime: Date;
  onLoadTransaction?: (transactionId: string) => void;
}) {
  const timerFontSize = Math.max(6, fontSize * 0.9);
  const timerPadV = Math.max(1, Math.round(timerFontSize * 0.12));
  const timerPadH = Math.max(1, Math.round(timerFontSize * 0.22));
  const timerTopPx = table.shape === 'circle' ? pixelHeight * 0.12 : 4;
  const timerBlockHeight = timerFontSize + 2 * timerPadV;

  const formatTimer = (createdAt: string): string => {
    const created = new Date(createdAt);
    const diffMs = currentTime.getTime() - created.getTime();
    const totalSeconds = Math.floor(diffMs / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes >= 60) {
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      const hr = hours === 1 ? 'hr' : 'hrs';
      const min = mins === 1 ? 'min' : 'mins';
      return `${hours} ${hr} ${mins} ${min}`;
    }
    return `${totalMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const timer = transaction ? formatTimer(transaction.created_at) : '--:--';
  const isOccupied = !!transaction;

  const handleTableClick = () => {
    if (isOccupied && transaction && onLoadTransaction) {
      onLoadTransaction(transaction.uuid_id);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: pixelX,
        top: pixelY,
        width: pixelWidth,
        height: pixelHeight,
        zIndex: 2, // Ensure tables are above layout elements
      }}
      className={isOccupied && onLoadTransaction ? "cursor-pointer" : "cursor-default"}
      onClick={handleTableClick}
    >
      <div
        className={`w-full h-full flex flex-col items-center justify-center relative overflow-hidden ${
          table.shape === 'circle' ? 'rounded-full' : 'rounded-lg'
        } ${isOccupied ? 'bg-orange-400' : 'bg-blue-400'} text-gray-900 border-2 border-gray-800 shadow-lg transition-colors ${
          isOccupied && onLoadTransaction ? 'hover:bg-orange-500' : ''
        }`}
        style={{
          minWidth: '40px',
          minHeight: '40px',
        }}
      >
        {/* Timer — scaled padding; top offset included in main content margin to avoid overlap on square */}
        <div
          className="absolute left-1/2 -translate-x-1/2 text-center"
          style={{
            fontSize: `${timerFontSize}px`,
            fontWeight: 'bold',
            top: table.shape === 'circle' ? '12%' : '4px',
            maxWidth: '90%',
            overflow: 'hidden'
          }}
        >
          <div
            className="bg-black/40 rounded text-white font-mono whitespace-nowrap"
            style={{
              padding: `${timerPadV}px ${timerPadH}px`,
              textShadow: '0 0 3px rgba(0, 0, 0, 0.6), 0 1px 2px rgba(0, 0, 0, 0.4)',
              letterSpacing: '0.5px'
            }}
          >
            {timer}
          </div>
        </div>

        {/* Main content: marginTop = timer top + timer height + buffer; narrow padding; leading-tight + gap-px */}
        <div
          className="flex flex-col items-center justify-center flex-1 w-full px-0.5 gap-px"
          style={{ marginTop: `${timerTopPx + timerBlockHeight + 2}px` }}
        >
          <div className="font-bold whitespace-nowrap leading-tight" style={{ fontSize: `${fontSize}px` }}>
            {table.table_number}
          </div>
          <div className="opacity-75 whitespace-nowrap leading-tight" style={{ fontSize: `${smallFontSize}px` }}>
            {table.capacity}p
          </div>
        </div>
      </div>
    </div>
  );
}

