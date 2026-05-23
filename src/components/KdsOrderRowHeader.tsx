'use client';

import type { ReactNode } from 'react';
import { MapPin } from 'lucide-react';
import KdsCallerBadge from './KdsCallerBadge';
import KdsMetaPill from './KdsMetaPill';

interface KdsOrderRowHeaderProps {
  productLine: ReactNode;
  pickupMethod?: 'dine-in' | 'take-away';
  tableNumber?: string | null;
  customerName?: string | null;
  callerNumber?: number | null;
  timer: ReactNode;
  className?: string;
  productClassName?: string;
}

/**
 * Compact header: product name flows inline with meta pills (table + caller + timer).
 * No stretched flex gap — pills sit next to the product when space allows.
 */
export default function KdsOrderRowHeader({
  productLine,
  pickupMethod,
  tableNumber,
  customerName,
  callerNumber,
  timer,
  className = '',
  productClassName = 'text-base font-bold text-black',
}: KdsOrderRowHeaderProps) {
  const tableLabel =
    pickupMethod === 'take-away' ? 'Take Away' : tableNumber?.trim() || null;
  const customer = customerName?.trim() || null;

  return (
    <div className={`min-w-0 space-y-0.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
        <span className={`min-w-0 break-words leading-snug ${productClassName}`}>
          {productLine}
        </span>
        {tableLabel ? (
          <KdsMetaPill
            label={tableLabel}
            title={pickupMethod === 'take-away' ? 'Take Away' : `Meja: ${tableLabel}`}
            icon={<MapPin className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />}
          />
        ) : null}
        <KdsCallerBadge callerNumber={callerNumber} variant="pill" />
        <span className="shrink-0 leading-none">{timer}</span>
      </div>
      {customer ? (
        <p
          className="text-[11px] text-gray-600 font-medium leading-tight truncate"
          title={customer}
        >
          {customer}
        </p>
      ) : null}
    </div>
  );
}
