'use client';

import { useEffect, useState } from 'react';
import BaristaKitchenDisplay from '@/components/BaristaKitchenDisplay';

export default function BaristaKitchenDisplayPage() {
  const [isClient, setIsClient] = useState(false);

  // Ensure we're on the client side to prevent hydration mismatch
  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <div className="h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600 text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden">
      <BaristaKitchenDisplay />
    </div>
  );
}
