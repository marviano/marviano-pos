'use client';

import { useEffect, useState } from 'react';
import BaristaDisplay from '@/components/BaristaDisplay';

export default function BaristaPage() {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-lg">Loading Barista Display...</div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden">
      <BaristaDisplay />
    </div>
  );
}



