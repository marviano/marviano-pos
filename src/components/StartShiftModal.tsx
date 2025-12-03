'use client';

import { useState, useEffect, useRef } from 'react';
import { generateUUID } from '@/lib/uuid';

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

export default function StartShiftModal({ isOpen, userId, userName, onShiftStarted, businessId = 14 }: StartShiftModalProps) {
  const [modalAwal, setModalAwal] = useState<string>('');
  const [isStartingShift, setIsStartingShift] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Focus input when modal opens
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  const handleStartShift = async () => {
    if (!userId || !userName) {
      setError('User tidak ditemukan. Silakan login ulang.');
      return;
    }

    const electronAPI = getElectronAPI();

    // Check if there's already an active shift (double-check)
    try {
      const existingResponse = await electronAPI?.localDbGetActiveShift?.(userId, businessId);
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
        business_id: businessId,
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
      className="fixed top-[25.6px] left-40 right-0 bottom-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
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

