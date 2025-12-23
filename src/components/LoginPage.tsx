'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Eye, EyeOff, ChevronDown, Settings, Loader2, RefreshCw, ChevronLeft } from 'lucide-react';
import Image from 'next/image';
import { getMostRecentEmail, getSavedEmails } from '@/lib/savedLoginEmails';
import { getServerSettings, saveServerSettings, type ServerSettings } from '@/lib/serverSettings';

interface LoginPageProps {
  onLogin?: (email: string, password: string) => void;
  onOfflineLogin?: () => void;
  onClose?: () => void;
  onSyncRequest?: () => Promise<void> | void;
  isSyncing?: boolean;
  syncStatus?: string | null;
  syncError?: string | null;
  hasOfflineDb?: boolean;
  syncProgress?: number | null;
}

export default function LoginPage({
  onLogin,
  onOfflineLogin,
  onClose,
  onSyncRequest,
  isSyncing = false,
  syncStatus = null,
  syncError = null,
  hasOfflineDb = true,
  syncProgress = null,
}: LoginPageProps) {
  const [email, setEmail] = useState(() => getMostRecentEmail() ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSettingsView, setIsSettingsView] = useState(false);
  const [savedEmails, setSavedEmails] = useState<string[]>(() => getSavedEmails());
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const emailFieldRef = useRef<HTMLDivElement | null>(null);
  const [serverSettings, setServerSettings] = useState<ServerSettings>(() => getServerSettings());

  useEffect(() => {
    const emails = getSavedEmails();
    setSavedEmails(emails);
    setEmail((prev) => {
      if (prev && prev.trim().length > 0) {
        return prev;
      }
      return emails[0] ?? '';
    });
  }, []);

  useEffect(() => {
    if (!isDropdownOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (emailFieldRef.current && !emailFieldRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSyncing) {
      return;
    }
    setIsLoading(true);
    setError('');
    
    try {
      if (onLogin) {
        await onLogin(email, password);
        setSavedEmails(getSavedEmails());
      }
    } catch (error) {
      console.error('Login failed:', error);
      setError(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOfflineLogin = () => {
    if (onOfflineLogin) {
      onOfflineLogin();
    }
  };

  return (
    <div className="w-full h-screen flex items-center justify-center bg-gray-900 overflow-hidden" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="bg-white rounded-2xl shadow-2xl overflow-hidden w-full h-[432px] flex" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        {/* Left Panel - Branding */}
        <div className="w-1/2 bg-gray-900 relative overflow-hidden">
          {/* Background Pattern */}
          <div className="absolute inset-0 opacity-5">
            <div className="absolute inset-0" style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Ccircle cx='30' cy='30' r='4'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}></div>
          </div>
          
          {/* Content */}
          <div className="relative z-10 h-full flex flex-col items-center justify-center text-white p-8">
            {/* Logo */}
            <div className="mb-8">
              <Image
                src="images/momoyo-logo.png"
                alt="Momoyo Logo"
                width={120}
                 height={120}
                 className="w-30 h-30 object-contain"
               />
             </div>
            
            
            {/* App Details */}
            <div className="text-left space-y-2 text-sm">
              <div>ID: SN1744799170972_84956</div>
              <div>Versi: V 2.5.10.8</div>
            </div>
          </div>
        </div>

        {/* Right Panel - Login Form */}
        <div className="w-1/2 bg-white p-8 flex flex-col justify-center relative">
          {/* Settings Toggle */}
          <div className="absolute top-4 right-12">
            {isSettingsView ? (
              <button
                type="button"
                onClick={() => setIsSettingsView(false)}
                className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center transition-colors"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                title="Kembali ke Login"
                disabled={isSyncing}
              >
                <ChevronLeft className="w-4 h-4 text-gray-600" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsSettingsView(true)}
                className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center transition-colors"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                title="Pengaturan"
                disabled={isSyncing}
              >
                <Settings className="w-4 h-4 text-gray-600" />
              </button>
            )}
          </div>

          {/* Close Button */}
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center transition-colors"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <X className="w-4 h-4 text-gray-600" />
            </button>
          )}

          {isSettingsView ? (
            <div className="flex flex-col justify-between h-full space-y-6" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              <div className="space-y-6 overflow-y-auto pr-2">
                <div>
                  <h2 className="text-xl font-semibold text-gray-800">Pengaturan</h2>
                  <p className="text-sm text-gray-500">Kelola sinkronisasi data offline dan server WebSocket.</p>
                </div>
                
                {/* Server Settings */}
                <div className="space-y-4 border-t border-gray-200 pt-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Server WebSocket</h3>
                    <p className="text-xs text-gray-500 mb-3">Konfigurasi server untuk komunikasi dengan Dapur dan Barista.</p>
                    
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Alamat Server
                        </label>
                        <input
                          type="text"
                          value={serverSettings.address}
                          onChange={(e) => setServerSettings(prev => ({ ...prev, address: e.target.value }))}
                          placeholder="localhost atau IP address"
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Contoh: localhost, 192.168.1.16
                        </p>
                      </div>
                      
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Port Server
                        </label>
                        <input
                          type="number"
                          value={serverSettings.port}
                          onChange={(e) => setServerSettings(prev => ({ ...prev, port: parseInt(e.target.value) || 19967 }))}
                          min="1024"
                          max="65535"
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Port default: 19967 (1024-65535)
                        </p>
                      </div>
                      
                      <button
                        type="button"
                        onClick={() => {
                          saveServerSettings(serverSettings);
                          alert('Pengaturan server berhasil disimpan!');
                        }}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                      >
                        Simpan Pengaturan Server
                      </button>
                    </div>
                  </div>
                </div>
                
                {/* Sync Settings */}
                <div className="space-y-4 border-t border-gray-200 pt-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Sinkronisasi Data</h3>
                  </div>
                  {syncStatus && (
                    <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded px-2 py-2">
                      {syncStatus}
                    </p>
                  )}
                  {syncError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-2">
                      {syncError}
                    </p>
                  )}
                  {typeof syncProgress === 'number' && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-gray-600">
                        <span>Progres Sinkronisasi</span>
                        <span>{Math.max(0, Math.min(100, Math.round(syncProgress)))}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-300 ease-out"
                          style={{ width: `${Math.max(0, Math.min(100, syncProgress))}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      if (onSyncRequest) {
                        await onSyncRequest();
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-3 rounded-lg transition-colors disabled:bg-blue-300"
                    style={{ WebkitAppRegion: 'no-drag', cursor: isSyncing ? 'not-allowed' : 'pointer' } as React.CSSProperties}
                    disabled={isSyncing}
                  >
                    {isSyncing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sedang Sinkronisasi
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        Sinkronisasi Knowledge Base PoS
                      </>
                    )}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsView(false)}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                disabled={isSyncing}
              >
                Kembali ke Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleLogin} className="space-y-6">
              <div className="space-y-4">
                {/* Username Field */}
                <div ref={emailFieldRef}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Akun
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Silakan masukkan nama pengguna"
                      className="w-full px-4 py-3 border-2 border-cyan-300 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-700 placeholder-gray-400"
                      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      required
                      onFocus={() => {
                        if (savedEmails.length > 0) {
                          setIsDropdownOpen(true);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      onClick={() => {
                        if (savedEmails.length > 0) {
                          setIsDropdownOpen(prev => !prev);
                        }
                      }}
                      tabIndex={-1}
                      aria-label="Pilih email tersimpan"
                      disabled={savedEmails.length === 0}
                    >
                      <ChevronDown className={`w-5 h-5 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isDropdownOpen && savedEmails.length > 0 && (
                      <div
                        className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto z-10"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      >
                        {savedEmails.map(savedEmail => (
                          <button
                            type="button"
                            key={savedEmail}
                            onMouseDown={event => {
                              event.preventDefault();
                              setEmail(savedEmail);
                              setIsDropdownOpen(false);
                            }}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-cyan-50"
                          >
                            {savedEmail}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Password Field */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Kata Sandi
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Silakan masukkan kata sandi"
                      className="w-full px-4 py-3 border-2 border-cyan-300 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-700 placeholder-gray-400 pr-12"
                      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}
              {syncError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {syncError}
                </div>
              )}

              {/* Login Button */}
              <button
                type="submit"
                disabled={isLoading || isSyncing}
                className="w-full bg-cyan-500 hover:bg-cyan-600 disabled:bg-cyan-300 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center transition-colors"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  'Masuk'
                )}
              </button>

              {hasOfflineDb && onOfflineLogin && (
                <button
                  type="button"
                  onClick={handleOfflineLogin}
                  disabled={isLoading || isSyncing}
                  className="w-full border border-gray-300 text-gray-700 hover:bg-gray-50 font-semibold py-3 px-4 rounded-lg transition-colors"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                  Masuk Offline
                </button>
              )}

            </form>
          )}
        </div>
      </div>
    </div>
  );
}

