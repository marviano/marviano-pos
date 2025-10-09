'use client';

import { useState } from 'react';
import { X, Eye, EyeOff, ChevronDown } from 'lucide-react';
import Image from 'next/image';

interface LoginPageProps {
  onLogin?: (email: string, password: string) => void;
  onOfflineLogin?: () => void;
  onClose?: () => void;
}

export default function LoginPage({ onLogin, onOfflineLogin, onClose }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    
    try {
      if (onLogin) {
        await onLogin(email, password);
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
    <div className="w-full h-screen flex items-center justify-center bg-gray-900" style={{ WebkitAppRegion: 'drag' }}>
      <div className="bg-white rounded-2xl shadow-2xl overflow-hidden w-full h-[432px] flex" style={{ WebkitAppRegion: 'drag' }}>
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
                 src="/logo/Momoyo.png"
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
          {/* Close Button */}
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center transition-colors"
              style={{ WebkitAppRegion: 'no-drag' }}
            >
              <X className="w-4 h-4 text-gray-600" />
            </button>
          )}

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-4">
              {/* Username Field */}
              <div>
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
                    style={{ WebkitAppRegion: 'no-drag' }}
                    required
                  />
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  </div>
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
                    style={{ WebkitAppRegion: 'no-drag' }}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    style={{ WebkitAppRegion: 'no-drag' }}
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

            {/* Login Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-cyan-500 hover:bg-cyan-600 disabled:bg-cyan-300 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center transition-colors"
              style={{ WebkitAppRegion: 'no-drag' }}
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                'Masuk'
              )}
            </button>

            {/* Offline Login */}
            <button
              type="button"
              onClick={handleOfflineLogin}
              className="w-full text-gray-500 hover:text-gray-700 py-2 text-sm transition-colors"
              style={{ WebkitAppRegion: 'no-drag' }}
            >
              Masuk Offline
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

