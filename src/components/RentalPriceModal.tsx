'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { parseRupiahInput } from '@/lib/cartPricing';
import {
  rentalDurationFromInputs,
  type RentalDuration,
  type RentalDurationUnit,
} from '@/lib/rentalTransaction';
import RentalDurationFields from './RentalDurationFields';

interface RentalPriceModalProps {
  isOpen: boolean;
  onClose: () => void;
  productName: string;
  /** Suggested price from master data (optional). */
  suggestedPrice?: number | null;
  onConfirm: (unitPrice: number, note: string, rentalDuration: RentalDuration) => void;
}

export default function RentalPriceModal({
  isOpen,
  onClose,
  productName,
  suggestedPrice,
  onConfirm,
}: RentalPriceModalProps) {
  const [priceInput, setPriceInput] = useState('');
  const [customNote, setCustomNote] = useState('');
  const [durationValueInput, setDurationValueInput] = useState('');
  const [durationUnit, setDurationUnit] = useState<RentalDurationUnit>('hour');
  const [error, setError] = useState<string | null>(null);
  const [durationError, setDurationError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const suggested =
      suggestedPrice != null && Number.isFinite(suggestedPrice) && suggestedPrice > 0
        ? String(Math.round(suggestedPrice))
        : '';
    setPriceInput(suggested);
    setCustomNote('');
    setDurationValueInput('');
    setDurationUnit('hour');
    setError(null);
    setDurationError(null);
  }, [isOpen, suggestedPrice, productName]);

  const handleConfirm = () => {
    const price = parseRupiahInput(priceInput);
    if (price == null || price <= 0) {
      setError('Masukkan harga lebih dari 0');
      return;
    }
    const rentalDuration = rentalDurationFromInputs(durationValueInput, durationUnit);
    if (!rentalDuration) {
      setDurationError('Masukkan durasi sewa lebih dari 0');
      return;
    }
    onConfirm(price, customNote.trim(), rentalDuration);
    onClose();
  };

  const handleClose = () => {
    setPriceInput('');
    setCustomNote('');
    setDurationValueInput('');
    setDurationUnit('hour');
    setError(null);
    setDurationError(null);
    onClose();
  };

  if (!isOpen) return null;

  const preview = parseRupiahInput(priceInput);

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="text-xl font-bold text-gray-900">Harga Sewa Ruangan</h2>
          <button
            type="button"
            onClick={handleClose}
            className="w-10 h-10 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
          >
            <X size={20} className="text-gray-600" />
          </button>
        </div>

        <div className="px-6 pb-6">
          <div className="bg-gray-50 rounded-xl p-4 mb-4">
            <h3 className="font-semibold text-gray-800">{productName}</h3>
            <p className="text-sm text-gray-500 mt-1">Masukkan harga sesuai kesepakatan (bebas).</p>
          </div>

          <RentalDurationFields
            valueInput={durationValueInput}
            unit={durationUnit}
            onValueChange={(v) => {
              setDurationValueInput(v);
              setDurationError(null);
            }}
            onUnitChange={setDurationUnit}
            error={durationError}
          />

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Harga (Rp) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={priceInput}
              onChange={(e) => {
                setPriceInput(e.target.value.replace(/\D/g, ''));
                setError(null);
              }}
              className="w-full p-3 border-2 border-gray-300 rounded-lg text-lg font-semibold text-gray-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-200"
              autoFocus
            />
            {preview != null && preview > 0 && (
              <p className="text-sm text-green-700 mt-1 font-medium">
                Rp {preview.toLocaleString('id-ID')}
              </p>
            )}
            {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Catatan (opsional)
            </label>
            <textarea
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              className="w-full p-3 border-2 border-gray-300 rounded-lg text-gray-800 resize-none"
              placeholder="Nama tamu, acara, dll."
              rows={2}
              maxLength={200}
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 py-3 px-4 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-medium"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="flex-1 py-3 px-4 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium"
            >
              Tambahkan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
