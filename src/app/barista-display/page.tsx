'use client';

import { useEffect, useState } from 'react';
import StandaloneDisplayFrame from '@/components/StandaloneDisplayFrame';
import BaristaDisplay from '@/components/BaristaDisplay';

export default function BaristaDisplayPage() {
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
    <StandaloneDisplayFrame title="Barista Display" showTestSound={true}>
      <BaristaDisplay viewOnly={false} />
    </StandaloneDisplayFrame>
  );
}
