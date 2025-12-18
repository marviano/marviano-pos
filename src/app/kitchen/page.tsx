'use client';

import { useEffect, useState } from 'react';
import KitchenDisplay from '@/components/KitchenDisplay';

export default function KitchenPage() {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-lg">Loading Kitchen Display...</div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden">
      <KitchenDisplay />
    </div>
  );
}

