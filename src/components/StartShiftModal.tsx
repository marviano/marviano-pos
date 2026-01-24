'use client';

import { useState, useEffect, useRef } from 'react';
import { generateUUID } from '@/lib/uuid';
import { useAuth } from '@/hooks/useAuth';

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

// Format number for input (remove dots, allow only digits)
const formatNumberInput = (value: string): string => {
  return value.replace(/[^\d]/g, '');
};

// Format number display with dots (for input field)
const formatNumberDisplay = (value: string): string => {
  const numValue = formatNumberInput(value);
  if (!numValue) return '';
  try {
    const num = parseInt(numValue, 10);
    if (isNaN(num)) return '';
    return num.toLocaleString('id-ID');
  } catch {
    return numValue;
  }
};

interface StartShiftModalProps {
  isOpen: boolean;
  userId: number;
  userName: string;
  onShiftStarted: () => void;
  businessId?: number;
}

export default function StartShiftModal({ isOpen, userId, userName, onShiftStarted, businessId }: StartShiftModalProps) {
  const { user } = useAuth();
  const [modalAwal, setModalAwal] = useState<string>('');
  const [isStartingShift, setIsStartingShift] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(96); // Default to 96px (w-24)
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Use businessId from props, or fallback to user's selectedBusinessId
  const effectiveBusinessId = businessId ?? user?.selectedBusinessId;
  
  if (!effectiveBusinessId) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md">
          <h2 className="text-xl font-bold text-red-600 mb-2">No Business Selected</h2>
          <p className="text-gray-700">Please log in and select a business to start a shift.</p>
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Focus input when modal opens
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Poll every 3s while modal is open: if another PC opened a shift, close modal and show kasir
  const onShiftStartedRef = useRef(onShiftStarted);
  onShiftStartedRef.current = onShiftStarted;
  useEffect(() => {
    if (!isOpen || !effectiveBusinessId || !userId) return;
    const electronAPI = getElectronAPI();
    if (!electronAPI?.localDbGetActiveShift) return;

    const poll = async () => {
      try {
        const res = await electronAPI?.localDbGetActiveShift?.(userId, effectiveBusinessId);
        if (res?.shift) {
          onShiftStartedRef.current();
        }
      } catch (e) {
        console.warn('[StartShiftModal] Poll error:', e);
      }
    };

    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [isOpen, effectiveBusinessId, userId]);

  // Dynamically calculate sidebar width
  useEffect(() => {
    if (!isOpen) return;

    const updateSidebarWidth = () => {
      // Find the left sidebar element by looking for the blue sidebar (bg-blue-800)
      // It should be the first child of the flex container
      const sidebar = document.querySelector('.bg-blue-800') as HTMLElement;
      if (sidebar) {
        const rect = sidebar.getBoundingClientRect();
        setSidebarWidth(rect.width);
      } else {
        // Fallback to default width if sidebar not found
        setSidebarWidth(96);
      }
    };

    // Update immediately
    updateSidebarWidth();

    // Update on window resize
    window.addEventListener('resize', updateSidebarWidth);

    // Use ResizeObserver to watch for sidebar size changes
    const sidebar = document.querySelector('.bg-blue-800') as HTMLElement;
    let resizeObserver: ResizeObserver | null = null;
    
    if (sidebar) {
      resizeObserver = new ResizeObserver(() => {
        updateSidebarWidth();
      });
      resizeObserver.observe(sidebar);
    }

    return () => {
      window.removeEventListener('resize', updateSidebarWidth);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [isOpen]);

  const handleStartShift = async () => {
    if (!userId || !userName) {
      setError('User tidak ditemukan. Silakan login ulang.');
      return;
    }

    const electronAPI = getElectronAPI();

    // Check if there's already an active shift (double-check)
    try {
      const existingResponse = await electronAPI?.localDbGetActiveShift?.(userId, effectiveBusinessId);
      const existingShift = existingResponse?.shift ?? null;
      if (existingShift) {
        const ownerName = existingShift.user_name || 'Kasir lain';
        setError(`Shift atas nama ${ownerName} masih aktif. Silakan tutup shift yang aktif terlebih dahulu.`);
        return;
      }
    } catch (error) {
      console.error('Error checking existing shift:', error);
    }

    const cleanValue = formatNumberInput(modalAwal);
    const amount = parseFloat(cleanValue);
    
    if (!cleanValue || isNaN(amount) || amount < 0) {
      setError('Modal awal harus berupa angka >= 0');
      return;
    }

    setIsStartingShift(true);
    setError(null);

    // Check Electron API availability
    if (!electronAPI) {
      setError('Aplikasi Electron tidak terdeteksi. Silakan restart aplikasi.');
      setIsStartingShift(false);
      return;
    }

    if (!electronAPI.localDbCreateShift) {
      setError('Fitur shift belum tersedia. Silakan restart aplikasi untuk memperbarui.');
      setIsStartingShift(false);
      return;
    }

    try {
      const uuid_id = generateUUID();
      const result = await electronAPI.localDbCreateShift({
        uuid_id,
        business_id: effectiveBusinessId,
        user_id: userId,
        user_name: userName,
        modal_awal: amount
      });

      if (result.success) {
        setModalAwal(''); // Clear input after successful start
        onShiftStarted();
      } else {
        if (result.error === 'ACTIVE_SHIFT_EXISTS' && result.activeShift) {
          const ownerName = result.activeShift.user_name || 'Kasir lain';
          throw new Error(`Shift atas nama ${ownerName} masih aktif. Silakan tutup shift yang aktif terlebih dahulu.`);
        }
        throw new Error(result.error || 'Gagal membuat shift');
      }
    } catch (error) {
      console.error('Error starting shift:', error);
      const message = error instanceof Error ? error.message : 'Gagal memulai shift. Silakan coba lagi.';
      setError(message);
    } finally {
      setIsStartingShift(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isStartingShift && modalAwal.trim()) {
      handleStartShift();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed top-[25.6px] right-0 bottom-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      style={{ left: `${sidebarWidth}px` }}
      onClick={(e) => {
        // Prevent closing on backdrop click - user must start shift
        e.stopPropagation();
      }}
    >
      <div 
        className="bg-white rounded-2xl w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="text-xl font-bold text-gray-900">Mulai Shift</h2>
        </div>

        {/* Content */}
        <div className="px-6 pb-6">
          {/* Modal Awal Input */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Modal Awal
            </label>
            <input
              ref={inputRef}
              type="text"
              value={formatNumberDisplay(modalAwal)}
              onChange={(e) => {
                const formatted = formatNumberDisplay(e.target.value);
                setModalAwal(formatted);
                setError(null);
              }}
              onKeyPress={handleKeyPress}
              placeholder="Masukkan modal awal"
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg text-gray-800 bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-200 focus:outline-none"
              disabled={isStartingShift}
            />
            {error && (
              <p className="text-sm text-red-600 mt-2">{error}</p>
            )}
          </div>

          {/* Action Button */}
          <button
            onClick={handleStartShift}
            disabled={isStartingShift || !modalAwal.trim()}
            className="w-full py-3 px-4 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
          >
            {isStartingShift ? 'Memulai...' : 'Mulai Shift'}
          </button>
        </div>
      </div>
    </div>
  );
}

