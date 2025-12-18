'use client';

import React, { useState } from 'react';
import { Search, CheckCircle, XCircle, RefreshCw, Copy, Check } from 'lucide-react';

interface DebugResult {
  success: boolean;
  transaction: {
    id: string;
    business_id: number;
    user_id: number;
    created_at: string;
    synced_at: number | null;
  } | null;
  queue: {
    id: number;
    transaction_id: string;
    queued_at: number;
    synced_at: number | null;
    retry_count: number;
    last_error: string | null;
  } | null;
  existsInLocalDb: boolean;
  isQueued: boolean;
  isSynced: boolean;
  retryCount: number;
  lastError: string | null;
  error?: string;
}

export default function SystemPosDebugTool() {
  const [uuid, setUuid] = useState('');
  const [results, setResults] = useState<Record<string, DebugResult>>({});
  const [loading, setLoading] = useState(false);
  const [copiedUuid, setCopiedUuid] = useState<string | null>(null);

  const checkTransaction = async (transactionId: string) => {
    if (!transactionId.trim()) return;

    setLoading(true);
    try {
      const electronAPI = window.electronAPI;
      if (!electronAPI?.debugSystemPosTransaction) {
        alert('Debug API not available. Make sure you are running in Electron.');
        return;
      }

      const result = await electronAPI.debugSystemPosTransaction(transactionId);
      setResults(prev => ({ ...prev, [transactionId]: result }));
    } catch (error) {
      console.error('Error checking transaction:', error);
      setResults(prev => ({
        ...prev,
        [transactionId]: {
          success: false,
          transaction: null,
          queue: null,
          existsInLocalDb: false,
          isQueued: false,
          isSynced: false,
          retryCount: 0,
          lastError: null,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    } finally {
      setLoading(false);
    }
  };

  const queueTransaction = async (transactionId: string) => {
    try {
      const electronAPI = window.electronAPI;
      if (!electronAPI?.queueTransactionForSystemPos) {
        alert('Queue API not available.');
        return;
      }

      const result = await electronAPI.queueTransactionForSystemPos(transactionId);
      if (result.success) {
        alert(`Transaction ${transactionId} queued successfully!`);
        // Refresh the check
        await checkTransaction(transactionId);
      } else {
        alert(`Failed to queue: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      alert(`Error queueing transaction: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const resetRetryCount = async (transactionId: string) => {
    try {
      const electronAPI = window.electronAPI;
      if (!electronAPI?.resetSystemPosRetryCount) {
        alert('Reset API not available.');
        return;
      }

      const result = await electronAPI.resetSystemPosRetryCount([transactionId]);
      if (result.success) {
        alert(`Retry count reset for ${transactionId}`);
        // Refresh the check
        await checkTransaction(transactionId);
      } else {
        alert('Failed to reset retry count');
      }
    } catch (error) {
      alert(`Error resetting retry count: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUuid(id);
      setTimeout(() => setCopiedUuid(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const formatDate = (timestamp: number | null) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString();
  };

  const checkMultiple = async () => {
    const uuids = [
      '0142512141500300001',
      '0142512141437280001',
      '0142512141428390001',
    ];

    for (const uuid of uuids) {
      await checkTransaction(uuid);
      // Small delay between checks
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };

  const confirmResync = async (days: number) => {
    const period = days === 0 ? 'ALL TIME' : `last ${days} days`;
    if (!window.confirm(`Are you sure you want to FORCE RESYNC transactions from the ${period}? \n\nThis will scan all local transactions and queue them for System POS sync. This may take a while.`)) {
      return;
    }

    setLoading(true);
    try {
      const electronAPI = window.electronAPI;
      if (!electronAPI?.repopulateSystemPosQueue) {
        alert('Resync API not available.');
        return;
      }

      const result = await electronAPI.repopulateSystemPosQueue({ days });
      if (result.success) {
        alert(`Success! Queued ${result.count} transactions for sync.`);
      } else {
        alert(`Failed: ${result.error}`);
      }
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
          System-POS Sync Debug Tool
        </h2>

        <div className="mb-6 space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={uuid}
              onChange={(e) => setUuid(e.target.value)}
              placeholder="Enter transaction UUID"
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  checkTransaction(uuid);
                }
              }}
            />
            <button
              onClick={() => checkTransaction(uuid)}
              disabled={loading || !uuid.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Search className="w-4 h-4" />
              Check
            </button>
            <button
              onClick={checkMultiple}
              disabled={loading}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Check Sample UUIDs
            </button>
          </div>

          <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center mr-2">
              Force Resync:
            </div>
            <button
              onClick={() => confirmResync(7)}
              disabled={loading}
              className="px-3 py-1.5 bg-yellow-600 text-white rounded hover:bg-yellow-700 text-sm disabled:opacity-50"
            >
              Last 7 Days
            </button>
            <button
              onClick={() => confirmResync(30)}
              disabled={loading}
              className="px-3 py-1.5 bg-orange-600 text-white rounded hover:bg-orange-700 text-sm disabled:opacity-50"
            >
              Last 30 Days
            </button>
            <button
              onClick={() => confirmResync(0)}
              disabled={loading}
              className="px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 text-sm disabled:opacity-50"
            >
              All Time
            </button>
          </div>
        </div>

        {Object.entries(results).map(([transactionId, result]) => (
          <div
            key={transactionId}
            className="mb-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="font-mono font-semibold text-gray-900 dark:text-gray-100">
                  {transactionId}
                </h3>
                <button
                  onClick={() => copyToClipboard(transactionId, transactionId)}
                  className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                  title="Copy UUID"
                >
                  {copiedUuid === transactionId ? (
                    <Check className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4 text-gray-500" />
                  )}
                </button>
              </div>
              <div className="flex items-center gap-2">
                {result.existsInLocalDb ? (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-600" />
                )}
                {result.isSynced ? (
                  <span className="text-green-600 font-semibold">Synced</span>
                ) : result.isQueued ? (
                  <span className="text-yellow-600 font-semibold">Queued</span>
                ) : (
                  <span className="text-red-600 font-semibold">Not Queued</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-gray-600 dark:text-gray-400 mb-1">Local DB:</div>
                <div className="font-semibold">
                  {result.existsInLocalDb ? (
                    <span className="text-green-600">✓ Exists</span>
                  ) : (
                    <span className="text-red-600">✗ Not Found</span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-gray-600 dark:text-gray-400 mb-1">Queue Status:</div>
                <div className="font-semibold">
                  {result.isQueued ? (
                    <span className="text-yellow-600">✓ Queued</span>
                  ) : (
                    <span className="text-red-600">✗ Not Queued</span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-gray-600 dark:text-gray-400 mb-1">Sync Status:</div>
                <div className="font-semibold">
                  {result.isSynced ? (
                    <span className="text-green-600">✓ Synced</span>
                  ) : (
                    <span className="text-red-600">✗ Not Synced</span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-gray-600 dark:text-gray-400 mb-1">Retry Count:</div>
                <div className="font-semibold">{result.retryCount}</div>
              </div>

              {result.transaction && (
                <>
                  <div>
                    <div className="text-gray-600 dark:text-gray-400 mb-1">Created At:</div>
                    <div className="font-mono text-xs">
                      {new Date(result.transaction.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-600 dark:text-gray-400 mb-1">Business ID:</div>
                    <div>{result.transaction.business_id}</div>
                  </div>
                  <div>
                    <div className="text-gray-600 dark:text-gray-400 mb-1">User ID:</div>
                    <div>{result.transaction.user_id}</div>
                  </div>
                </>
              )}

              {result.queue && (
                <>
                  <div>
                    <div className="text-gray-600 dark:text-gray-400 mb-1">Queued At:</div>
                    <div className="font-mono text-xs">{formatDate(result.queue.queued_at)}</div>
                  </div>
                  {result.queue.synced_at && (
                    <div>
                      <div className="text-gray-600 dark:text-gray-400 mb-1">Synced At:</div>
                      <div className="font-mono text-xs">{formatDate(result.queue.synced_at)}</div>
                    </div>
                  )}
                </>
              )}

              {result.lastError && (
                <div className="col-span-2">
                  <div className="text-red-600 dark:text-red-400 mb-1 font-semibold">Last Error:</div>
                  <div className="text-xs font-mono bg-red-50 dark:bg-red-900/20 p-2 rounded">
                    {result.lastError}
                  </div>
                </div>
              )}

              {result.error && (
                <div className="col-span-2">
                  <div className="text-red-600 dark:text-red-400 mb-1 font-semibold">Debug Error:</div>
                  <div className="text-xs font-mono bg-red-50 dark:bg-red-900/20 p-2 rounded">
                    {result.error}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              {!result.isQueued && result.existsInLocalDb && (
                <button
                  onClick={() => queueTransaction(transactionId)}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                >
                  Queue for Sync
                </button>
              )}
              {result.isQueued && !result.isSynced && result.retryCount >= 5 && (
                <button
                  onClick={() => resetRetryCount(transactionId)}
                  className="px-3 py-1.5 bg-yellow-600 text-white rounded hover:bg-yellow-700 text-sm"
                >
                  Reset Retry Count
                </button>
              )}
              <button
                onClick={() => checkTransaction(transactionId)}
                className="px-3 py-1.5 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
              >
                Refresh
              </button>
            </div>
          </div>
        ))}

        {loading && (
          <div className="text-center py-4">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-blue-600" />
            <p className="mt-2 text-gray-600 dark:text-gray-400">Checking...</p>
          </div>
        )}
      </div>
    </div>
  );
}
