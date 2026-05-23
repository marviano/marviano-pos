'use client';

import type { ReactNode } from 'react';

/** Shared high-contrast pill for table/room, caller, take-away on KDS rows. */
export default function KdsMetaPill({
  label,
  icon,
  title,
  className = '',
}: {
  label: string;
  icon?: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md bg-emerald-600 text-white px-1.5 py-0.5 text-sm font-bold leading-none shadow-sm min-w-0 max-w-[10rem] ${className}`}
      title={title ?? label}
    >
      {icon ? <span className="shrink-0 flex items-center">{icon}</span> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}
