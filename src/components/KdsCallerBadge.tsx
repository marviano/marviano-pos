'use client';

import { Phone } from 'lucide-react';
import KdsMetaPill from './KdsMetaPill';

interface KdsCallerBadgeProps {
  callerNumber: number | null | undefined;
  className?: string;
  iconClassName?: string;
  variant?: 'inline' | 'pill';
}

export default function KdsCallerBadge({
  callerNumber,
  className = '',
  iconClassName = 'w-3.5 h-3.5',
  variant = 'inline',
}: KdsCallerBadgeProps) {
  if (callerNumber == null || callerNumber < 1 || callerNumber > 50) return null;

  if (variant === 'pill') {
    return (
      <KdsMetaPill
        label={String(callerNumber)}
        title={`Nomor pemanggil ${callerNumber}`}
        icon={<Phone className={iconClassName} strokeWidth={2.5} />}
        className={`tabular-nums max-w-[4rem] ${className}`}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-0.5 font-bold text-gray-800 ${className}`}
      title={`Nomor pemanggil ${callerNumber}`}
    >
      <Phone className={`shrink-0 ${iconClassName}`} />
      <span>{callerNumber}</span>
    </span>
  );
}
