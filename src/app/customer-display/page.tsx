'use client';

import { useEffect, useState } from 'react';
import CustomerDisplay from '@/components/CustomerDisplay';

export default function CustomerDisplayPage() {
  const [isClient, setIsClient] = useState(false);

  // Ensure we're on the client side to prevent hydration mismatch
  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden">
      <CustomerDisplay />
    </div>
  );
}
