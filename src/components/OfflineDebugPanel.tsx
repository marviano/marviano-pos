'use client';

import { useState, useEffect } from 'react';
import { databaseHealthService, type DatabaseHealth } from '@/lib/databaseHealth';
import { fetchProducts, fetchCategories, type Product, type Category } from '@/lib/offlineDataFetcher';
import { checkElectronAPI, getRestartInstructions, type RestartInstructions } from '@/lib/electronRestartHelper';

export default function OfflineDebugPanel() {
  const [health, setHealth] = useState<DatabaseHealth | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState<boolean | null>(null);
  const [restartInstructions, setRestartInstructions] = useState<RestartInstructions | null>(null);

  const checkHealth = async () => {
    setIsLoading(true);
    try {
      console.log('🔍 [DEBUG PANEL] Starting health check...');
      
      // Check Electron API first
      const apiOk = checkElectronAPI();
      console.log('🔍 [DEBUG PANEL] API check result:', apiOk);
      setApiStatus(apiOk);
      
      if (!apiOk) {
        console.log('⚠️ [DEBUG PANEL] API not complete, showing restart instructions');
        setRestartInstructions(getRestartInstructions());
        return;
      }

      console.log('🔍 [DEBUG PANEL] Checking database health...');
      const healthData = await databaseHealthService.checkDatabaseHealth();
      console.log('🔍 [DEBUG PANEL] Health data:', healthData);
      setHealth(healthData);
      
      // Test fetching products and categories
      console.log('🔍 [DEBUG PANEL] Testing offline data fetching...');
      const productsData = await fetchProducts('Ice Cream Cone', 'drinks');
      const categoriesData = await fetchCategories('drinks');
      
      console.log('🔍 [DEBUG PANEL] Products found:', productsData.length);
      console.log('🔍 [DEBUG PANEL] Categories found:', categoriesData.length);
      
      setProducts(productsData);
      setCategories(categoriesData);
    } catch (error) {
      console.error('❌ [DEBUG PANEL] Debug check failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const forceSync = async () => {
    setIsLoading(true);
    try {
      await databaseHealthService.forceSync();
      await checkHealth();
    } catch (error) {
      console.error('Force sync failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <div className="p-4 bg-gray-100 rounded-lg">
      <h3 className="text-lg font-semibold mb-4 text-gray-900">Offline Debug Panel</h3>
      
      <div className="space-y-4">
        {/* Health Status */}
        <div className="bg-white p-3 rounded border">
          <h4 className="font-medium mb-2 text-gray-900">Database Health</h4>
          {health ? (
            <div className="text-sm space-y-1">
              <div className="text-gray-900">Products: {health.productCount} ({health.hasProducts ? '✅' : '❌'})</div>
              <div className="text-gray-900">Categories: {health.categoryCount} ({health.hasCategories ? '✅' : '❌'})</div>
              <div className="text-gray-900">Last Sync: {health.lastSync ? new Date(health.lastSync).toLocaleString() : 'Never'}</div>
              <div className="text-gray-900">Needs Sync: {health.needsSync ? '❌ Yes' : '✅ No'}</div>
            </div>
          ) : (
            <div className="text-gray-900">Loading...</div>
          )}
        </div>

        {/* Test Results */}
        <div className="bg-white p-3 rounded border">
          <h4 className="font-medium mb-2 text-gray-900">Test Results</h4>
          <div className="text-sm space-y-1">
            <div className="text-gray-900">Categories Found: {categories.length}</div>
            <div className="text-gray-900">Products Found: {products.length}</div>
            {categories.length > 0 && (
              <div className="text-gray-900">Categories: {categories.map(c => c.jenis).join(', ')}</div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex space-x-2">
          <button
            onClick={checkHealth}
            disabled={isLoading}
            className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? 'Checking...' : 'Check Health'}
          </button>
          <button
            onClick={forceSync}
            disabled={isLoading}
            className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {isLoading ? 'Syncing...' : 'Force Sync'}
          </button>
        </div>

        {/* Electron API Status */}
        <div className="bg-white p-3 rounded border">
          <h4 className="font-medium mb-2 text-gray-900">Electron API Status</h4>
          <div className="text-sm">
            <div className="text-gray-900">Available: {typeof window !== 'undefined' && window.electronAPI ? '✅ Yes' : '❌ No'}</div>
            <div className="text-gray-900">API Complete: {apiStatus ? '✅ Yes' : '❌ No'}</div>
            <div className="text-gray-900">Local DB Methods: {typeof window !== 'undefined' && window.electronAPI?.localDbGetAllProducts ? '✅ Yes' : '❌ No'}</div>
          </div>
        </div>

        {/* Restart Instructions */}
        {restartInstructions && (
          <div className="bg-yellow-50 border border-yellow-200 p-3 rounded">
            <h4 className="font-medium text-yellow-800 mb-2">{restartInstructions.title}</h4>
            <p className="text-sm text-yellow-700 mb-2">{restartInstructions.message}</p>
            <ul className="text-sm text-yellow-700 space-y-1">
              {restartInstructions.steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
