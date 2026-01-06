'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Eye, EyeOff, ChevronDown, Settings, Loader2, RefreshCw, ChevronLeft, CheckCircle2, XCircle } from 'lucide-react';
import Image from 'next/image';
import { getMostRecentEmail, getSavedEmails } from '@/lib/savedLoginEmails';

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
  const [appConfig, setAppConfig] = useState<{
    serverHost?: string;
    apiUrl?: string;
    dbUser?: string;
    dbPassword?: string;
    dbName?: string;
    dbPort?: number;
  }>({});
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);

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

  // Load app config when settings view opens
  useEffect(() => {
    if (isSettingsView && typeof window !== 'undefined' && window.electronAPI?.getAppConfig) {
      setIsLoadingConfig(true);
      window.electronAPI.getAppConfig().then((result) => {
        if (result?.success && result.config) {
          setAppConfig(result.config);
        }
        setIsLoadingConfig(false);
      }).catch((error) => {
        console.error('Failed to load app config:', error);
        setIsLoadingConfig(false);
      });
    }
  }, [isSettingsView]);

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
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center gap-1 transition-colors mr-2"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                title="Kembali ke Login"
                disabled={isSyncing}
              >
                <ChevronLeft className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-gray-600">Kembali</span>
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
            <div className="flex flex-col justify-between h-full space-y-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              <div className="space-y-3 overflow-y-auto pr-2">
                {/* Database & API Configuration */}
                <div className="space-y-2 pt-2">
                  <div>
                    <h3 className="text-xs font-semibold text-gray-700 mb-2">Database & API</h3>
                    
                    {isLoadingConfig ? (
                      <div className="text-center py-2 text-xs text-gray-500">Memuat konfigurasi...</div>
                    ) : (
                      <div className="space-y-2">
                        <div className="mb-4">
                          <label className="block text-[10px] font-medium text-gray-700 mb-0.5">
                            API URL
                          </label>
                          <input
                            type="text"
                            value={appConfig.apiUrl || ''}
                            onChange={(e) => setAppConfig(prev => ({ ...prev, apiUrl: e.target.value }))}
                            placeholder="http://192.168.1.100:3000 atau https://salespulse.cc"
                            className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:opacity-50"
                          />
                        </div>
                        
                        {/* Database Configuration Grid */}
                        <div className="relative border border-gray-300 rounded p-2.5 pt-3.5">
                          <div className="absolute -top-2 left-3 bg-white px-1.5">
                            <span className="text-[10px] font-medium text-gray-700">Setup DB MySQL</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {/* Row 1: IP Database */}
                            <div>
                              <label className="block text-[9px] font-medium text-gray-700 mb-0.5">
                                IP Database
                              </label>
                              <input
                                type="text"
                                value={appConfig.serverHost || ''}
                                onChange={(e) => {
                                  setAppConfig(prev => ({ ...prev, serverHost: e.target.value }));
                                  setConnectionTestResult(null);
                                }}
                                placeholder="192.168.1.100"
                                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:opacity-50"
                              />
                            </div>
                            
                            {/* Row 1: Nama Database */}
                            <div>
                              <label className="block text-[9px] font-medium text-gray-700 mb-0.5">
                                Nama Database
                              </label>
                              <input
                                type="text"
                                value={appConfig.dbName || ''}
                                onChange={(e) => {
                                  setAppConfig(prev => ({ ...prev, dbName: e.target.value }));
                                  setConnectionTestResult(null);
                                }}
                                placeholder="salespulse"
                                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:opacity-50"
                              />
                            </div>
                            
                            {/* Row 2: Username Database */}
                            <div>
                              <label className="block text-[9px] font-medium text-gray-700 mb-0.5">
                                Username Database
                              </label>
                              <input
                                type="text"
                                value={appConfig.dbUser || ''}
                                onChange={(e) => {
                                  setAppConfig(prev => ({ ...prev, dbUser: e.target.value }));
                                  setConnectionTestResult(null);
                                }}
                                placeholder="root"
                                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:opacity-50"
                              />
                            </div>
                            
                            {/* Row 2: Password Database */}
                            <div>
                              <label className="block text-[9px] font-medium text-gray-700 mb-0.5">
                                Password Database
                              </label>
                              <input
                                type="password"
                                value={appConfig.dbPassword || ''}
                                onChange={(e) => {
                                  setAppConfig(prev => ({ ...prev, dbPassword: e.target.value }));
                                  setConnectionTestResult(null);
                                }}
                                placeholder="Password MySQL"
                                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:opacity-50"
                              />
                            </div>
                          </div>
                        </div>
                        
                        {/* Connection Test Result */}
                        {connectionTestResult && (
                          <div className={`p-2 rounded text-[10px] flex items-start gap-1.5 ${
                            connectionTestResult.success 
                              ? 'bg-green-50 border border-green-200 text-green-700' 
                              : 'bg-red-50 border border-red-200 text-red-700'
                          }`}>
                            {connectionTestResult.success ? (
                              <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            ) : (
                              <XCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            )}
                            <div className="flex-1">
                              {connectionTestResult.success ? (
                                <div className="font-medium">{connectionTestResult.message}</div>
                              ) : (
                                <div>
                                  <div className="font-medium mb-0.5">Gagal terhubung</div>
                                  <div className="text-[9px] opacity-90">{connectionTestResult.error}</div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              // Check if we're in Electron and API is available
                              if (typeof window === 'undefined') {
                                alert('Fitur ini hanya tersedia di Electron');
                                return;
                              }
                              
                              if (!window.electronAPI) {
                                alert('Electron API tidak tersedia. Pastikan aplikasi berjalan di Electron.');
                                console.error('window.electronAPI is not defined');
                                return;
                              }
                              
                              if (!window.electronAPI.testDbConnection) {
                                alert('Fitur test koneksi database tidak tersedia. Pastikan aplikasi menggunakan versi terbaru.');
                                console.error('window.electronAPI.testDbConnection is not defined');
                                console.log('Available methods:', Object.keys(window.electronAPI || {}));
                                return;
                              }
                              
                              setIsTestingConnection(true);
                              setConnectionTestResult(null);
                              
                              try {
                                const result = await window.electronAPI.testDbConnection({
                                  serverHost: appConfig.serverHost,
                                  dbUser: appConfig.dbUser,
                                  dbPassword: appConfig.dbPassword,
                                  dbName: appConfig.dbName,
                                  dbPort: appConfig.dbPort,
                                });
                                
                                setConnectionTestResult(result);
                              } catch (error) {
                                console.error('Test connection error:', error);
                                setConnectionTestResult({
                                  success: false,
                                  error: error instanceof Error ? error.message : 'Gagal menguji koneksi'
                                });
                              } finally {
                                setIsTestingConnection(false);
                              }
                            }}
                            disabled={isTestingConnection || isSavingConfig}
                            className="flex-1 px-2 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-semibold rounded transition-colors disabled:bg-blue-300 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                          >
                            {isTestingConnection ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Menguji...
                              </>
                            ) : (
                              'Test Koneksi Database'
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (typeof window === 'undefined' || !window.electronAPI?.resetAppConfig) {
                                alert('Fitur ini hanya tersedia di Electron');
                                return;
                              }
                              
                              if (!confirm('Reset konfigurasi ke default (.env)? Semua pengaturan yang disimpan akan dihapus.')) {
                                return;
                              }
                              
                              setIsSavingConfig(true);
                              try {
                                const electronAPI = window.electronAPI;
                                if (!electronAPI?.resetAppConfig || !electronAPI?.getAppConfig) {
                                  alert('Electron API tidak tersedia');
                                  return;
                                }
                                const result = await electronAPI.resetAppConfig();
                                if (result?.success) {
                                  // Reload config to show .env defaults
                                  const configResult = await electronAPI.getAppConfig();
                                  if (configResult?.success) {
                                    setAppConfig(configResult.config || {});
                                  }
                                  alert('Konfigurasi berhasil direset ke default (.env). Aplikasi perlu dimulai ulang untuk menerapkan perubahan.');
                                } else {
                                  alert(`Gagal mereset konfigurasi: ${result?.error || 'Unknown error'}`);
                                }
                              } catch (error) {
                                console.error('Failed to reset app config:', error);
                                alert(`Gagal mereset konfigurasi: ${error instanceof Error ? error.message : 'Unknown error'}`);
                              } finally {
                                setIsSavingConfig(false);
                              }
                            }}
                            disabled={isSavingConfig}
                            className="px-2 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-[10px] font-semibold rounded transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                          >
                            Reset
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (typeof window === 'undefined' || !window.electronAPI?.saveAppConfig) {
                                alert('Fitur ini hanya tersedia di Electron');
                                return;
                              }
                              
                              setIsSavingConfig(true);
                              try {
                                const result = await window.electronAPI.saveAppConfig(appConfig);
                                if (result?.success) {
                                  alert('Pengaturan database dan API berhasil disimpan! Aplikasi perlu dimulai ulang untuk menerapkan perubahan.');
                                  // Clear cached API URL to force reload
                                  if (typeof window !== 'undefined' && 'localStorage' in window) {
                                    // Trigger API URL cache refresh
                                    const event = new Event('configUpdated');
                                    window.dispatchEvent(event);
                                  }
                                } else {
                                  alert(`Gagal menyimpan pengaturan: ${result?.error || 'Unknown error'}`);
                                }
                              } catch (error) {
                                console.error('Failed to save app config:', error);
                                alert(`Gagal menyimpan pengaturan: ${error instanceof Error ? error.message : 'Unknown error'}`);
                              } finally {
                                setIsSavingConfig(false);
                              }
                            }}
                            disabled={isSavingConfig}
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white text-[10px] font-semibold px-2 py-1.5 rounded transition-colors disabled:bg-green-300 disabled:cursor-not-allowed"
                          >
                            {isSavingConfig ? 'Menyimpan...' : 'Simpan'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Sync Settings */}
                <div className="space-y-2 border-t border-gray-200 pt-2">
                  <div>
                    <h3 className="text-xs font-semibold text-gray-700 mb-2">Sinkronisasi Data</h3>
                  </div>
                  {syncStatus && (
                    <p className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 rounded px-1.5 py-1.5">
                      {syncStatus}
                    </p>
                  )}
                  {syncError && (
                    <p className="text-[10px] text-red-600 bg-red-50 border border-red-100 rounded px-1.5 py-1.5">
                      {syncError}
                    </p>
                  )}
                  {typeof syncProgress === 'number' && (
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-[10px] text-gray-600">
                        <span>Progres Sinkronisasi</span>
                        <span>{Math.max(0, Math.min(100, Math.round(syncProgress)))}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
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
                    className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-semibold px-2 py-1.5 rounded transition-colors disabled:bg-blue-300"
                    style={{ WebkitAppRegion: 'no-drag', cursor: isSyncing ? 'not-allowed' : 'pointer' } as React.CSSProperties}
                    disabled={isSyncing}
                  >
                    {isSyncing ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Sedang Sinkronisasi
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3 h-3" />
                        Sinkronisasi Knowledge Base PoS
                      </>
                    )}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsView(false)}
                className="text-[10px] text-gray-500 hover:text-gray-700 transition-colors"
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

