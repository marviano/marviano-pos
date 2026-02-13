'use client';

import { X, Minus, Maximize2, Volume2 } from 'lucide-react';

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function StandaloneDisplayFrame({
  title,
  showTestSound = true,
  children,
}: {
  title: string;
  showTestSound?: boolean;
  children: React.ReactNode;
}) {
  const handleClose = () => getElectronAPI()?.closeWindow?.();
  const handleMinimize = () => getElectronAPI()?.minimizeWindow?.();
  const handleMaximize = () => getElectronAPI()?.maximizeWindow?.();
  const playTestSound = () => {
    try {
      const audio = new Audio('/blacksmith_refine.mp3');
      audio.volume = 0.7;
      audio.play().catch((err) => console.warn('Test sound failed:', err));
    } catch (err) {
      console.warn('Test sound failed:', err);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <div
        className="bg-gray-800 text-white flex items-center justify-between px-2 py-1 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="text-xs font-medium px-2">{title}</div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {showTestSound && (
            <button
              type="button"
              onClick={playTestSound}
              className="p-1 hover:bg-gray-700 rounded transition-colors mr-2"
              title="Test sound"
            >
              <Volume2 className="w-4 h-4" />
            </button>
          )}
          <button onClick={handleMinimize} className="p-1 hover:bg-gray-700 rounded transition-colors" title="Minimize">
            <Minus className="w-4 h-4" />
          </button>
          <button onClick={handleMaximize} className="p-1 hover:bg-gray-700 rounded transition-colors" title="Maximize">
            <Maximize2 className="w-4 h-4" />
          </button>
          <button onClick={handleClose} className="p-1 hover:bg-red-600 rounded transition-colors" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
