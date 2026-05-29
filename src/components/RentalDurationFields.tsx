'use client';

import {
  RENTAL_DURATION_UNITS,
  RENTAL_DURATION_UNIT_LABELS,
  type RentalDurationUnit,
} from '@/lib/rentalTransaction';

export interface RentalDurationFieldsProps {
  valueInput: string;
  unit: RentalDurationUnit;
  onValueChange: (value: string) => void;
  onUnitChange: (unit: RentalDurationUnit) => void;
  error?: string | null;
  disabled?: boolean;
}

export default function RentalDurationFields({
  valueInput,
  unit,
  onValueChange,
  onUnitChange,
  error,
  disabled = false,
}: RentalDurationFieldsProps) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Durasi sewa <span className="text-red-500">*</span>
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={valueInput}
          disabled={disabled}
          onChange={(e) => onValueChange(e.target.value.replace(/[^\d.,]/g, ''))}
          className="flex-1 min-w-0 p-3 border-2 border-gray-300 rounded-lg text-lg font-semibold text-gray-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-200 disabled:bg-gray-100"
          aria-label="Durasi sewa nilai"
        />
        <select
          value={unit}
          disabled={disabled}
          onChange={(e) => onUnitChange(e.target.value as RentalDurationUnit)}
          className="w-28 shrink-0 p-3 border-2 border-gray-300 rounded-lg text-gray-900 font-medium focus:border-blue-500 disabled:bg-gray-100"
          aria-label="Satuan durasi sewa"
        >
          {RENTAL_DURATION_UNITS.map((u) => (
            <option key={u} value={u}>
              {RENTAL_DURATION_UNIT_LABELS[u]}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        Wajib untuk laporan pemakaian ruangan (jam / hari / bulan).
      </p>
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
    </div>
  );
}
