'use client';

import { useSyncExternalStore } from 'react';

// Shared timer store - only components that subscribe (OrderTimer) re-render on tick
let currentTime = new Date();
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  return currentTime.getTime();
}

function getServerSnapshot() {
  return Date.now();
}

// Start the tick loop once (runs for app lifetime)
if (typeof window !== 'undefined') {
  setInterval(() => {
    currentTime = new Date();
    listeners.forEach((cb) => cb());
  }, 1000);
}

function useDisplayTimer() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Lightweight component - only this re-renders when timer ticks, not the parent card.
 * Pass createdAt (order time) or startedAt (production_started_at) - startedAt takes precedence for barista display. */
export function OrderTimer({ createdAt, startedAt, className }: { createdAt?: string | null; startedAt?: string | null; className?: string }) {
  const timeToUse = startedAt || createdAt;
  useDisplayTimer(); // Subscribe - re-renders only this component on tick

  if (!timeToUse) {
    return <span className={className}>00:00</span>;
  }

  const created = new Date(timeToUse);
  if (isNaN(created.getTime())) {
    return <span className={className}>00:00</span>;
  }

  const diffMs = Date.now() - created.getTime();
  if (diffMs < 0) {
    return <span className={className}>00:00</span>;
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const result = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  return <span className={className}>{result}</span>;
}
