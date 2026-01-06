'use client';

import { useState, useEffect, useRef } from 'react';
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

export default function TableLayout() {
  const { user } = useAuth();
  const businessId = user?.selectedBusinessId ?? 14;
  
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<number | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [layoutElements, setLayoutElements] = useState<LayoutElement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  // const [canvasScale, setCanvasScale] = useState(1);

  // Update canvas size
  useEffect(() => {
    const updateCanvasSize = () => {
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
    };

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
  }, [selectedRoom, rooms]);

  // Fetch rooms when businessId is available
  useEffect(() => {
    if (businessId && businessId > 0) {
      fetchRooms();
    } else {
      setError('No business selected. Please log in and select a business first.');
      setLoading(false);
    }
  }, [businessId]);

  // Fetch tables and elements when room is selected
  useEffect(() => {
    if (selectedRoom) {
      fetchTables();
      fetchLayoutElements();
    } else {
      setTables([]);
      setLayoutElements([]);
    }
  }, [selectedRoom]);

  const fetchRooms = async () => {
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
  };

  const fetchTables = async () => {
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
  };

  const fetchLayoutElements = async () => {
    if (!selectedRoom) return;
    
    try {
      const electronAPI = window.electronAPI;
      if (!electronAPI?.getRestaurantLayoutElements) {
        console.error('getRestaurantLayoutElements not available');
        return;
      }

      const elementsData = await electronAPI.getRestaurantLayoutElements(selectedRoom);
      setLayoutElements(Array.isArray(elementsData) ? elementsData : []);
    } catch (error) {
      console.error('Error fetching layout elements:', error);
    }
  };

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
              console.log('[TableLayout] Font size multiplier:', fontSizeMultiplier, 'for room:', selectedRoom);
              return layoutElements.map((element) => {
                const posX = typeof element.position_x === 'string' ? parseFloat(element.position_x) : element.position_x;
                const posY = typeof element.position_y === 'string' ? parseFloat(element.position_y) : element.position_y;
                const widthPercent = typeof element.width === 'string' ? parseFloat(element.width) : element.width;
                const heightPercent = typeof element.height === 'string' ? parseFloat(element.height) : element.height;
                
                const pixelX = (posX / 100) * canvasSize.width;
                const pixelY = (posY / 100) * canvasSize.height;
                const pixelWidth = (widthPercent / 100) * canvasSize.width;
                const pixelHeight = (heightPercent / 100) * canvasSize.height;

                const minDimension = Math.min(pixelWidth, pixelHeight);
                const baseFontSize = Math.max(10, Math.min(20, minDimension * 0.3));
                const fontSize = baseFontSize * fontSizeMultiplier;

              const MIN_SIZE_PERCENT = 3;
              const minPixelSize = Math.min(
                (MIN_SIZE_PERCENT / 100) * canvasSize.width,
                (MIN_SIZE_PERCENT / 100) * canvasSize.height
              );

              return (
                <div
                  key={`element-${element.id}`}
                  style={{
                    position: 'absolute',
                    left: pixelX,
                    top: pixelY,
                    width: Math.max(pixelWidth, minPixelSize),
                    height: Math.max(pixelHeight, minPixelSize),
                  }}
                  className="cursor-default"
                >
                  <div
                    className="w-full h-full flex items-center justify-center relative shadow-lg overflow-hidden"
                    style={{
                      backgroundColor: element.color,
                      color: element.text_color,
                      minWidth: '30px',
                      minHeight: '30px',
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

                // Calculate dynamic font size based on table dimensions
                // Base font size scales with the smaller dimension to ensure readability
                const minDimension = Math.min(pixelWidth, pixelHeight);
                const baseFontSize = Math.max(10, Math.min(24, minDimension * 0.25)); // 25% of min dimension, clamped between 10-24px
                const fontSize = baseFontSize * fontSizeMultiplier; // Apply global font size multiplier
                const smallFontSize = Math.max(8, fontSize * 0.7); // 70% of main font size, min 8px

              // Minimum size: 4% to ensure text is readable
              const MIN_SIZE_PERCENT = 4;
              const minPixelSize = Math.min(
                (MIN_SIZE_PERCENT / 100) * canvasSize.width,
                (MIN_SIZE_PERCENT / 100) * canvasSize.height
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

// Table Display Component with timer and auto-adjusting font size
function TableDisplay({
  table,
  pixelX,
  pixelY,
  pixelWidth,
  pixelHeight,
  fontSize,
  smallFontSize
}: {
  table: Table;
  pixelX: number;
  pixelY: number;
  pixelWidth: number;
  pixelHeight: number;
  fontSize: number;
  smallFontSize: number;
}) {
  const [timer, setTimer] = useState<string>('--:--');

  // Timer update effect
  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      setTimer(`${hours}:${minutes}`);
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        left: pixelX,
        top: pixelY,
        width: pixelWidth,
        height: pixelHeight,
      }}
      className="cursor-default"
    >
      <div
        className={`w-full h-full flex flex-col items-center justify-center relative overflow-hidden ${
          table.shape === 'circle' ? 'rounded-full' : 'rounded-lg'
        } bg-blue-400 text-gray-900 border-2 border-gray-800 shadow-lg`}
        style={{
          minWidth: '40px',
          minHeight: '40px',
        }}
      >
        {/* Timer area at the top */}
        <div 
          className="absolute left-1/2 -translate-x-1/2 text-center"
          style={{ 
            fontSize: `${Math.max(fontSize * 0.9, 12)}px`,
            fontWeight: 'bold',
            top: table.shape === 'circle' ? '12%' : '4px',
            maxWidth: '90%',
            overflow: 'hidden'
          }}
        >
          <div 
            className="bg-black/40 px-2 py-0.5 rounded text-white font-mono whitespace-nowrap"
            style={{
              WebkitTextStroke: '0.8px rgba(0, 0, 0, 0.9)',
              textShadow: '0 0 3px rgba(0, 0, 0, 0.6), 0 1px 2px rgba(0, 0, 0, 0.4)',
              letterSpacing: '0.5px'
            }}
          >
            {timer}
          </div>
        </div>

        {/* Main content area */}
        <div 
          className="flex flex-col items-center justify-center flex-1 w-full px-1" 
          style={{ marginTop: `${Math.max(fontSize * 0.9, 12) + 8}px` }}
        >
          {/* Table number */}
          <div
            className="font-bold whitespace-nowrap"
            style={{ fontSize: `${fontSize}px` }}
          >
            {table.table_number}
          </div>

          {/* Capacity */}
          <div
            className="opacity-75 whitespace-nowrap"
            style={{ fontSize: `${smallFontSize}px` }}
          >
            {table.capacity}p
          </div>
        </div>
      </div>
    </div>
  );
}

