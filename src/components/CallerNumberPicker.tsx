'use client';

import { useEffect, useRef, useState } from 'react';
import { Phone } from 'lucide-react';

const CALLER_NUMBERS = Array.from({ length: 50 }, (_, i) => i + 1);

export function parseCallerNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (Number.isNaN(n) || n < 1 || n > 50) return null;
  return n;
}

interface CallerNumberPickerProps {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  className?: string;
}

export default function CallerNumberPicker({ value, onChange, disabled = false, className = '' }: CallerNumberPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const selected = value != null && value >= 1 && value <= 50;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        title={disabled ? 'Nomor pemanggil tidak dapat diubah setelah dikirim ke dapur' : 'Pilih nomor pemanggil (1–50)'}
        className={`h-9 w-11 touch-manipulation rounded-lg border-2 flex items-center justify-center gap-0.5 transition-all box-border ${
          disabled
            ? 'border-gray-300 bg-gray-100 text-gray-500 cursor-not-allowed'
            : selected
              ? 'border-emerald-600 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
              : 'border-gray-400 bg-white text-gray-600 hover:border-emerald-500 hover:bg-emerald-50'
        }`}
      >
        <Phone className="w-4 h-4 shrink-0" />
        {selected && <span className="text-xs font-bold leading-none">{value}</span>}
      </button>
      {open && !disabled && (
        <div className="absolute left-0 top-full mt-1 z-[60] w-[min(12rem,calc(100vw-2rem))] rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
          <div className="text-xs font-semibold text-gray-500 px-1 pb-1.5">Nomor pemanggil</div>
          <div className="grid grid-cols-3 gap-1 max-h-48 overflow-y-auto">
            {CALLER_NUMBERS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  onChange(n);
                  setOpen(false);
                }}
                className={`h-8 rounded text-sm font-semibold transition-colors ${
                  value === n
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-100 text-gray-800 hover:bg-emerald-100'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          {selected && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="mt-2 w-full text-xs text-gray-500 hover:text-gray-800 py-1"
            >
              Hapus pilihan
            </button>
          )}
        </div>
      )}
    </div>
  );
}
