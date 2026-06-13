'use client';

import { useState, useEffect, useCallback, useRef, type MouseEvent, type KeyboardEvent, type FocusEvent } from 'react';
import { Minus, Plus } from 'lucide-react';

export function clampQuantity(value: number, min: number, max?: number): number {
  let v = Math.floor(value);
  if (!Number.isFinite(v) || Number.isNaN(v)) v = min;
  v = Math.max(min, v);
  if (max != null && Number.isFinite(max)) v = Math.min(max, v);
  return v;
}

type Size = 'xs' | 'sm' | 'md' | 'lg';

const sizeStyles: Record<Size, { button: string; input: string; gap: string; iconSize: number }> = {
  xs: {
    button: 'w-6 h-6 rounded-full flex items-center justify-center text-xs',
    input: 'w-8 text-sm font-medium text-center',
    gap: 'space-x-2',
    iconSize: 12,
  },
  sm: {
    button: 'w-8 h-8 rounded-full flex items-center justify-center',
    input: 'w-10 text-lg font-bold text-center',
    gap: 'space-x-3',
    iconSize: 16,
  },
  md: {
    button: 'w-10 h-10 rounded-full flex items-center justify-center text-lg',
    input: 'w-12 text-2xl font-semibold text-center',
    gap: 'space-x-4',
    iconSize: 20,
  },
  lg: {
    button: 'w-10 h-10 flex items-center justify-center rounded-xl',
    input: 'min-w-[3rem] max-w-[5rem] text-center font-mono font-black text-2xl',
    gap: 'gap-1',
    iconSize: 20,
  },
};

interface QuantityStepperInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  inputDisabled?: boolean;
  size?: Size;
  showIcons?: boolean;
  minusClassName?: string;
  plusClassName?: string;
  inputClassName?: string;
  containerClassName?: string;
  onDecrement?: () => void;
  onIncrement?: () => void;
  decrementDisabled?: boolean;
  incrementDisabled?: boolean;
  onInputClick?: (e: MouseEvent) => void;
}

export default function QuantityStepperInput({
  value,
  onChange,
  min = 1,
  max,
  disabled = false,
  inputDisabled = false,
  size = 'md',
  showIcons = false,
  minusClassName,
  plusClassName,
  inputClassName,
  containerClassName,
  onDecrement,
  onIncrement,
  decrementDisabled = false,
  incrementDisabled = false,
  onInputClick,
}: QuantityStepperInputProps) {
  const styles = sizeStyles[size];
  const [textValue, setTextValue] = useState(String(value));
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setTextValue(String(value));
    }
  }, [value]);

  const commitValue = useCallback(
    (raw: string) => {
      const parsed = raw.trim() === '' ? min : parseInt(raw, 10);
      const clamped = clampQuantity(parsed, min, max);
      setTextValue(String(clamped));
      if (clamped !== value) onChange(clamped);
    },
    [min, max, onChange, value]
  );

  const applyLiveValue = useCallback(
    (digits: string) => {
      if (digits === '') return;
      const parsed = parseInt(digits, 10);
      if (!Number.isFinite(parsed) || parsed < min) return;
      const clamped = clampQuantity(parsed, min, max);
      if (clamped !== value) onChange(clamped);
      if (String(clamped) !== digits) setTextValue(String(clamped));
    },
    [min, max, onChange, value]
  );

  const handleDecrement = () => {
    if (disabled || decrementDisabled) return;
    if (onDecrement) {
      onDecrement();
      return;
    }
    onChange(clampQuantity(value - 1, min, max));
  };

  const handleIncrement = () => {
    if (disabled || incrementDisabled) return;
    if (onIncrement) {
      onIncrement();
      return;
    }
    onChange(clampQuantity(value + 1, min, max));
  };

  const handleInputChange = (raw: string) => {
    if (inputDisabled || disabled) return;
    const digits = raw.replace(/\D/g, '');
    setTextValue(digits);
    applyLiveValue(digits);
  };

  const handleFocus = (e: FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = true;
    e.target.select();
  };

  const handleBlur = () => {
    isFocusedRef.current = false;
    commitValue(textValue);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const defaultMinusClass =
    'bg-red-500 hover:bg-red-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const defaultPlusClass =
    'bg-green-500 hover:bg-green-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className={`flex items-center ${styles.gap} ${containerClassName ?? ''}`}>
      <button
        type="button"
        onClick={handleDecrement}
        disabled={disabled || decrementDisabled}
        className={minusClassName ?? `${styles.button} ${defaultMinusClass}`}
      >
        {showIcons ? <Minus size={styles.iconSize} /> : '-'}
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={textValue}
        onChange={(e) => handleInputChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onClick={onInputClick}
        disabled={disabled || inputDisabled}
        readOnly={inputDisabled}
        className={`${inputClassName ?? 'text-black'} ${styles.input} border border-gray-300 rounded-md bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none disabled:bg-gray-100 disabled:cursor-not-allowed`}
        aria-label="Quantity"
      />
      <button
        type="button"
        onClick={handleIncrement}
        disabled={disabled || incrementDisabled}
        className={plusClassName ?? `${styles.button} ${defaultPlusClass}`}
      >
        {showIcons ? <Plus size={styles.iconSize} /> : '+'}
      </button>
    </div>
  );
}
