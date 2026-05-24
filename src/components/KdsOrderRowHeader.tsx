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
  /** Column 1 row 2: customizations + note */
  detailLine?: ReactNode;
  className?: string;
  productClassName?: string;
}

/**
 * Two main columns:
 * - Col 1: product (row 1), detail/note (row 2)
 * - Col 2: nested — table + caller (stacked) | timer (centered)
 */
export default function KdsOrderRowHeader({
  productLine,
  pickupMethod,
  tableNumber,
  customerName,
  callerNumber,
  timer,
  detailLine,
  className = '',
  productClassName = 'text-base font-bold text-black',
}: KdsOrderRowHeaderProps) {
  const tableLabel =
    pickupMethod === 'take-away' ? 'Take Away' : tableNumber?.trim() || null;
  const customer = customerName?.trim() || null;
  const hasDetail = !!detailLine || !!customer;
  const hasMetaPills = !!tableLabel || (callerNumber != null && callerNumber >= 1);

  return (
    <div
      className={`grid min-w-0 gap-x-2 gap-y-0.5 items-stretch ${
        hasMetaPills ? 'grid-cols-[minmax(0,1fr)_auto_auto]' : 'grid-cols-[minmax(0,1fr)_auto]'
      } ${hasDetail ? 'grid-rows-[auto_auto]' : 'grid-rows-[auto]'} ${className}`}
    >
      {/* Column 1 — row 1: product */}
      <div className="col-start-1 row-start-1 min-w-0 self-center">
        <div className={`break-words leading-snug ${productClassName}`}>{productLine}</div>
      </div>

      {/* Column 1 — row 2: note / customizations (+ optional customer) */}
      {hasDetail ? (
        <div className="col-start-1 row-start-2 min-w-0 space-y-0.5">
          {detailLine}
          {customer ? (
            <p
              className="text-[11px] text-gray-600 font-medium leading-tight truncate"
              title={customer}
            >
              {customer}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Column 2 — table + caller (stacked) */}
      {hasMetaPills ? (
        <div
          className={`col-start-2 flex flex-col justify-center gap-1 ${
            hasDetail ? 'row-start-1 row-span-2' : 'row-start-1'
          }`}
        >
          {tableLabel ? (
            <KdsMetaPill
              label={tableLabel}
              title={pickupMethod === 'take-away' ? 'Take Away' : `Meja: ${tableLabel}`}
              icon={<MapPin className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />}
            />
          ) : null}
          <KdsCallerBadge callerNumber={callerNumber} variant="pill" />
        </div>
      ) : null}

      {/* Column 3 — timer */}
      <div
        className={`${hasMetaPills ? 'col-start-3' : 'col-start-2'} flex items-center justify-center self-stretch ${
          hasDetail ? 'row-start-1 row-span-2' : 'row-start-1'
        }`}
      >
        {timer}
      </div>
    </div>
  );
}
