'use client';

import {
  ShoppingCart,
  Clock,
  Mail,
  Heart,
  BarChart3,
  Settings,
  Grid3X3,
  Wifi,
  Minimize2,
  Receipt
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { isSuperAdmin } from '@/lib/auth';

interface MenuItem {
  id: number;
  name: string;
  active: boolean;
  disabled?: boolean; // Add disabled property
}

interface LeftSidebarProps {
  menuItems: MenuItem[];
  activeMenuItem: string;
  onMenuItemClick: (item: string) => void;
}

export default function LeftSidebar({ menuItems, activeMenuItem, onMenuItemClick }: LeftSidebarProps) {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const isAdmin = isSuperAdmin(user);
  const getIcon = (name: string) => {
    switch (name) {
      case 'Kasir':
        return <ShoppingCart className="w-5 h-5" />;
      case 'Daftar Transaksi':
        return <Receipt className="w-5 h-5" />;
      case 'Pesanan':
        return <Clock className="w-5 h-5" />;
      case 'Pesan Antar':
        return <Mail className="w-5 h-5" />;
      case 'Ganti Shift':
        return <Heart className="w-5 h-5" />;
      case 'Laporan':
        return <BarChart3 className="w-5 h-5" />;
      case 'Setelan':
        return <Settings className="w-5 h-5" />;
      case 'Lainnya':
        return <Grid3X3 className="w-5 h-5" />;
      default:
        return <ShoppingCart className="w-5 h-5" />;
    }
  };

  return (
    <div className="w-40 bg-blue-900 flex flex-col h-full">
      {/* Logo */}
      <div className="p-6">
        <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
          <span className="text-white font-bold text-lg">E</span>
        </div>
      </div>

      {/* Menu Items */}
      <div className="flex-1 px-4">
        {menuItems.map((item) => {
          if (item.name === 'Setelan') {
            const canAccessSync = isAdmin ||
              permissions.includes('setelan.sinkronisasi') ||
              permissions.includes('marviano-pos_setelan_sinkronisasi');
            const canAccessPrinter = isAdmin ||
              permissions.includes('setelan.printersetup') ||
              permissions.includes('marviano-pos_setelan_printer-setup');
            const canAccessSettings = canAccessSync || canAccessPrinter;
            if (!canAccessSettings) {
              return null;
            }
          }
          return (
            <button
              key={item.id}
              onClick={() => !item.disabled && onMenuItemClick(item.name)}
              disabled={item.disabled}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg mb-2 transition-colors ${
                item.disabled
                  ? 'text-gray-400 cursor-not-allowed opacity-50'
                  : activeMenuItem === item.name
                  ? 'bg-green-500 text-white'
                  : 'text-white hover:bg-blue-800'
              }`}
            >
              {getIcon(item.name)}
              <span className={`font-medium ${item.disabled ? 'line-through' : ''}`}>{item.name}</span>
            </button>
          );
        })}
      </div>

      {/* Bottom Status */}
      <div className="p-4 border-t border-blue-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Wifi className="w-5 h-5 text-white" />
            <span className="text-white text-sm">Online</span>
          </div>
          <button className="p-2 text-white hover:bg-blue-800 rounded">
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
