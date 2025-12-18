'use client';

import {
  Database,
  Clock,
  Mail,
  Heart,
  PieChart,
  Settings,
  Grid3X3,
  Wifi,
  Minimize2,
  Receipt,
  ChefHat,
  Coffee
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { isSuperAdmin } from '@/lib/auth';
import { useEffect, useMemo, useState, useRef } from 'react';

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
  const permissions = useMemo(() => user?.permissions ?? [], [user?.permissions]);
  const isAdmin = isSuperAdmin(user);
  const [showProduksiMenu, setShowProduksiMenu] = useState(false);
  const produksiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) {
      // Reduced log noise
      /* console.log('👤 [SIDEBAR DEBUG] User:', {
        name: user.name,
        role: user.role,
        role_name: user.role_name,
        isAdmin,
        permissions
      }); */
    }
  }, [user, isAdmin, permissions]);

  // Close produksi menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (produksiRef.current && !produksiRef.current.contains(event.target as Node)) {
        setShowProduksiMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openProductionDisplay = (type: 'kitchen' | 'barista') => {
    setShowProduksiMenu(false);
    if (window.electronAPI?.openProductionDisplay) {
      window.electronAPI.openProductionDisplay(type);
    } else {
      window.open(`/${type}`, '_blank');
    }
  };

  const getIcon = (name: string) => {
    switch (name) {
      case 'Kasir':
        return <Database className="w-5 h-5" />;
      case 'Daftar Transaksi':
        return <Receipt className="w-5 h-5" />;
      case 'Pesanan':
        return <Clock className="w-5 h-5" />;
      case 'Produksi':
        return <Grid3X3 className="w-5 h-5" />;
      case 'Ganti Shift':
        return <Heart className="w-5 h-5" />;
      case 'Laporan':
        return <PieChart className="w-5 h-5" />;
      case 'Setelan':
      case 'Setelan Global':
        return <Settings className="w-5 h-5" />;
      case 'Lainnya':
        return <Grid3X3 className="w-5 h-5" />;
      default:
        return <Database className="w-5 h-5" />;
    }
  };

  return (
    <div className="w-24 bg-blue-800 flex flex-col h-full">
      {/* Logo */}
      <div className="pt-5 pb-5 flex justify-center">
        <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
          <span className="text-white font-bold text-base">E</span>
        </div>
      </div>

      {/* Menu Items */}
      <div className="flex-1 px-2">
        {menuItems.map((item) => {
          // Old Setelan - requires permissions
          if (item.name === 'Setelan') {
            const canAccessSync = isAdmin ||
              permissions.includes('setelan.sinkronisasi') ||
              permissions.includes('marviano-pos_setelan_sinkronisasi');
            const canAccessPrinter = isAdmin ||
              permissions.includes('setelan.printersetup') ||
              permissions.includes('marviano-pos_setelan_printer-setup');
            const canAccessSettings = canAccessSync || canAccessPrinter;
            
            /* console.log(`🔧 [SIDEBAR DEBUG] 'Setelan' access:`, {
              isAdmin,
              hasSyncPerm: permissions.includes('setelan.sinkronisasi'),
              hasPrinterPerm: permissions.includes('setelan.printersetup'),
              access: canAccessSettings
            }); */

            if (!canAccessSettings) {
              return null;
            }
          }
          // Setelan Global - always accessible, but display as "Setelan"
          const displayName = item.name === 'Setelan Global' ? 'Setelan' : item.name;
          
          // Special handling for Produksi menu - show balloon popup
          if (item.name === 'Produksi') {
            return (
              <div key={item.id} className="relative" ref={produksiRef}>
                <button
                  onClick={() => setShowProduksiMenu(!showProduksiMenu)}
                  className={`w-full flex flex-col items-center justify-center space-y-1 px-2 py-3 rounded-lg mb-2 transition-colors ${
                    showProduksiMenu
                      ? 'bg-green-500 text-white'
                      : 'text-white hover:bg-blue-900'
                  }`}
                >
                  {getIcon(item.name)}
                  <span className="text-xs font-medium text-center">{displayName}</span>
                </button>
                
                {/* Balloon Popup Menu */}
                {showProduksiMenu && (
                  <div className="absolute left-full top-0 ml-2 z-50">
                    {/* Arrow */}
                    <div className="absolute left-0 top-4 -ml-2 w-0 h-0 border-t-8 border-b-8 border-r-8 border-transparent border-r-white" />
                    
                    {/* Menu Content */}
                    <div className="bg-white rounded-lg shadow-2xl ring-1 ring-black/10 overflow-hidden min-w-[140px]" style={{ boxShadow: '0 10px 40px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.2)' }}>
                      <button
                        onClick={() => openProductionDisplay('kitchen')}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors text-gray-800"
                      >
                        <span className="text-xl">🍳</span>
                        <span className="font-semibold">Dapur</span>
                      </button>
                      <div className="border-t border-gray-100" />
                      <button
                        onClick={() => openProductionDisplay('barista')}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors text-gray-800"
                      >
                        <span className="text-xl">☕</span>
                        <span className="font-semibold">Barista</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          }
          
          return (
            <button
              key={item.id}
              onClick={() => !item.disabled && onMenuItemClick(item.name)}
              disabled={item.disabled}
              className={`w-full flex flex-col items-center justify-center space-y-1 px-2 py-3 rounded-lg mb-2 transition-colors ${
                item.disabled
                  ? 'text-gray-300 cursor-not-allowed opacity-50'
                  : activeMenuItem === item.name
                  ? 'bg-green-500 text-white'
                  : 'text-white hover:bg-blue-900'
              }`}
            >
              {getIcon(item.name)}
              <span className={`text-xs font-medium text-center ${item.disabled ? 'line-through' : ''}`}>{displayName}</span>
            </button>
          );
        })}
      </div>

      {/* Bottom Status */}
      <div className="p-3">
        <div className="flex flex-col items-center space-y-3">
          <Wifi className="w-5 h-5 text-white" />
          <div className="w-[30%] border-t border-blue-600"></div>
          <button
            onClick={() => {
              if (window.electronAPI) {
                window.electronAPI.minimizeWindow();
              }
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              if (window.electronAPI) {
                window.electronAPI.minimizeWindow();
              }
            }}
            className="p-2 text-white hover:bg-blue-900 rounded"
            title="Minimize"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
