'use client';

import { useEffect, useState } from 'react';
import StandaloneDisplayFrame from '@/components/StandaloneDisplayFrame';
import KitchenDisplay from '@/components/KitchenDisplay';

export default function KitchenDisplayPage() {
  const [isClient, setIsClient] = useState(false);
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
    <StandaloneDisplayFrame title="Kitchen Display (Dapur)" showTestSound={true}>
      <KitchenDisplay viewOnly={false} />
    </StandaloneDisplayFrame>
  );
}
