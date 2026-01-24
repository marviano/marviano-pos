'use client';

import {
  Database,
  Clock,
  Heart,
  PieChart,
  Settings,
  Sliders,
  // Grid3X3,
  Wifi,
  Minimize2,
  Receipt,
  Table as TableIcon,
  ChefHat,
  Coffee,
  ChevronLeft
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { isSuperAdmin } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { useEffect, useMemo } from 'react';

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
  onToggleSidebar?: () => void;
  isKitchenOrBarista?: boolean;
}

export default function LeftSidebar({ menuItems, activeMenuItem, onMenuItemClick, onToggleSidebar, isKitchenOrBarista = false }: LeftSidebarProps) {
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions ?? [], [user?.permissions]);
  const isAdmin = isSuperAdmin(user);

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

  const getIcon = (name: string) => {
    switch (name) {
      case 'Kasir':
        return <Database className="w-5 h-5" />;
      case 'Daftar Transaksi':
        return <Receipt className="w-5 h-5" />;
      case 'Pesanan':
        return <Clock className="w-5 h-5" />;
      case 'Ganti Shift':
        return <Heart className="w-5 h-5" />;
      case 'Laporan':
        return <PieChart className="w-5 h-5" />;
      case 'Settings':
        return <Sliders className="w-5 h-5" />;
      case 'Setelan Global':
        return <Settings className="w-5 h-5" />;
      case 'Table':
        return <TableIcon className="w-5 h-5" />;
      case 'Kitchen':
        return <ChefHat className="w-5 h-5" />;
      case 'Barista':
        return <Coffee className="w-5 h-5" />;
      case 'Barista & Kitchen':
        return <ChefHat className="w-5 h-5" />;
      default:
        return <Database className="w-5 h-5" />;
    }
  };

  return (
    <div className="w-24 bg-blue-800 flex flex-col h-full min-h-0">
      {/* Logo */}
      <div className="pt-3 pb-3 flex justify-center flex-shrink-0">
        <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
          <span className="text-white font-bold text-base">E</span>
        </div>
      </div>

      {/* Menu Items - Scrollable */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 min-h-0">
        <div className="py-1">
          {menuItems.map((item) => {
            // Settings - requires permissions
            if (item.name === 'Settings') {
              const canAccessSync = isAdmin ||
                permissions.includes('setelan.sinkronisasi') ||
                permissions.includes('marviano-pos_setelan_sinkronisasi');
              const canAccessPrinter = isAdmin ||
                permissions.includes('setelan.printersetup') ||
                permissions.includes('marviano-pos_setelan_printer-setup');
              const canAccessSettings = canAccessSync || canAccessPrinter;
              
              /* console.log(`🔧 [SIDEBAR DEBUG] 'Settings' access:`, {
                isAdmin,
                hasSyncPerm: permissions.includes('setelan.sinkronisasi'),
                hasPrinterPerm: permissions.includes('setelan.printersetup'),
                access: canAccessSettings
              }); */

              if (!canAccessSettings) {
                return null;
              }
            }

            // Kitchen - requires access_kitchen permission
            if (item.name === 'Kitchen') {
              if (!isAdmin && !hasPermission(user, 'access_kitchen')) {
                return null;
              }
            }

            // Barista - requires access_barista permission
            if (item.name === 'Barista') {
              if (!isAdmin && !hasPermission(user, 'access_barista')) {
                return null;
              }
            }

            // Barista & Kitchen - requires access_baristaandkitchen permission
            if (item.name === 'Barista & Kitchen') {
              if (!isAdmin && !hasPermission(user, 'access_baristaandkitchen')) {
                return null;
              }
            }
            // Setelan Global - always accessible, but display as "Setelan"
            const displayName = item.name === 'Setelan Global' ? 'Setelan' : item.name;
            
            return (
              <button
                key={item.id}
                onClick={() => !item.disabled && onMenuItemClick(item.name)}
                disabled={item.disabled}
                className={`w-full flex flex-col items-center justify-center space-y-1 px-2 py-2 rounded-lg mb-1.5 transition-colors ${
                  item.disabled
                    ? 'text-gray-300 cursor-not-allowed opacity-50'
                    : activeMenuItem === item.name
                    ? 'bg-green-500 text-white'
                    : 'text-white hover:bg-blue-900'
                }`}
              >
                {getIcon(item.name)}
                <span className={`text-xs font-medium text-center leading-tight ${item.disabled ? 'line-through' : ''}`}>{displayName}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Status */}
      <div className="p-2 flex-shrink-0">
        <div className="flex flex-col items-center space-y-2">
          <Wifi className="w-5 h-5 text-white" />
          <div className="w-[30%] border-t border-blue-600"></div>
          {isKitchenOrBarista && onToggleSidebar ? (
            <button
              onClick={onToggleSidebar}
              onTouchEnd={(e) => {
                e.preventDefault();
                onToggleSidebar();
              }}
              className="p-2 text-white hover:bg-blue-900 rounded"
              title="Hide Sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
}
