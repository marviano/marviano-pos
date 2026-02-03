'use client';

import { useState } from 'react';
import { Clock, FileText, Receipt, XCircle, Scissors } from 'lucide-react';
import ShiftReport from './ShiftReport';
import TransactionsReport from './TransactionsReport';
import CancelledItemsReport from './CancelledItemsReport';
import SplitBillReport from './SplitBillReport';

export default function Laporan() {
  const [activeTab, setActiveTab] = useState('shift');

  const renderContent = () => {
    switch (activeTab) {
      case 'shift':
        return <ShiftReport />;
      case 'transactions':
        return <TransactionsReport />;
      case 'cancelled':
        return <CancelledItemsReport />;
      case 'splitbill':
        return <SplitBillReport />;
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
      <div className="bg-white border-b border-gray-200 px-6 pt-4">
        {/* Tab strip — tab-like appearance */}
        <div className="flex border-b border-gray-200 -mb-px gap-0">
          <button
            onClick={() => setActiveTab('shift')}
            className={`flex items-center space-x-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'shift'
                ? 'border-blue-600 text-blue-600 bg-white'
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Laporan Shift</span>
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`flex items-center space-x-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'transactions'
                ? 'border-blue-600 text-blue-600 bg-white'
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>Semua Transaksi</span>
          </button>
          <button
            onClick={() => setActiveTab('cancelled')}
            className={`flex items-center space-x-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'cancelled'
                ? 'border-blue-600 text-blue-600 bg-white'
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
            }`}
          >
            <XCircle className="w-4 h-4" />
            <span>Item Dibatalkan</span>
          </button>
          <button
            onClick={() => setActiveTab('splitbill')}
            className={`flex items-center space-x-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'splitbill'
                ? 'border-blue-600 text-blue-600 bg-white'
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
            }`}
          >
            <Scissors className="w-4 h-4" />
            <span>Split Bill/Pindah Meja</span>
          </button>
          <button
            disabled
            className="flex items-center space-x-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px border-transparent text-gray-400 cursor-not-allowed bg-gray-50/50"
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
