'use client';

import { useState } from 'react';
import { Clock, FileText, Receipt } from 'lucide-react';
import ShiftReport from './ShiftReport';
import TransactionsReport from './TransactionsReport';

export default function Laporan() {
  const [activeTab, setActiveTab] = useState('shift');

  const renderContent = () => {
    switch (activeTab) {
      case 'shift':
        return <ShiftReport />;
      case 'transactions':
        return <TransactionsReport />;
      default:
        return (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-gray-500">Feature coming soon</p>
          </div>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 overflow-hidden">
      {/* Header & Tabs */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Laporan</h1>
        <div className="flex space-x-4">
          <button
            onClick={() => setActiveTab('shift')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'shift'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Laporan Shift</span>
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'transactions'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>Semua Transaksi</span>
          </button>
          {/* Placeholder for future tabs */}
          <button
            disabled
            className="flex items-center space-x-2 px-4 py-2 rounded-lg font-medium bg-gray-100 text-gray-400 cursor-not-allowed"
          >
            <FileText className="w-4 h-4" />
            <span>Laporan Penjualan (Coming Soon)</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {renderContent()}
      </div>
    </div>
  );
}

