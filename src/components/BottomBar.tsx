'use client';

import { FileText, Tag, BarChart3, Gift } from 'lucide-react';

export default function BottomBar() {
  const bottomActions = [
    { id: 1, name: 'Ambil Pesanan', icon: FileText },
    { id: 2, name: 'Kupon', icon: Tag },
    { id: 3, name: 'Aktivitas', icon: BarChart3 },
    { id: 4, name: 'Menukarkan', icon: Gift }
  ];

  return (
    <div className="h-16 bg-gray-200 border-t border-gray-300 flex items-center justify-center">
      <div className="flex space-x-8">
        {bottomActions.map((action) => (
          <button
            key={action.id}
            disabled
            className="flex flex-col items-center space-y-1 text-gray-400 cursor-not-allowed opacity-50"
          >
            <action.icon className="w-5 h-5" />
            <span className="text-xs font-medium line-through">{action.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
