'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { X, Lock } from 'lucide-react';

interface Employee {
  id: number;
  user_id: number | null;
  business_id: number | null;
  jabatan_id: number | null;
  no_ktp: string;
  phone: string | null;
  nama_karyawan: string;
  jenis_kelamin: string;
  alamat: string | null;
  tanggal_lahir: string | null;
  tanggal_bekerja: string;
  color: string | null;
  pin: string | null;
  created_at: string;
  updated_at: string;
}

interface WaiterSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (employeeId: number, employeeName: string, employeeColor: string | null) => void;
  businessId: number;
}

const getElectronAPI = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);

export default function WaiterSelectionModal({
  isOpen,
  onClose,
  onSelect,
  businessId,
}: WaiterSelectionModalProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingWaiter, setPendingWaiter] = useState<Employee | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const pinInputRef = useRef<HTMLInputElement>(null);

  // Fetch employees when modal opens
  useEffect(() => {
    if (isOpen) {
      const fetchEmployees = async () => {
        setIsLoading(true);
        try {
          const electronAPI = getElectronAPI();
          if (electronAPI?.localDbGetEmployees) {
            const allEmployees = await electronAPI.localDbGetEmployees();
            // Filter employees for this business and filter waiters (jabatan_id = 1)
            // Include employees with matching business_id OR business_id = null (shared/global employees)
            const filteredEmployees = (allEmployees as unknown as Employee[]).filter(
              (emp: Employee) => {
                const businessMatch = emp.business_id === businessId || emp.business_id === null;
                const jabatanMatch = emp.jabatan_id === 1 || emp.jabatan_id === 2 || emp.jabatan_id === 6;
                return businessMatch && jabatanMatch;
              }
            );
            setEmployees(filteredEmployees);
          } else {
            setEmployees([]);
          }
        } catch (error) {
          console.error('Error fetching employees:', error);
          setEmployees([]);
        } finally {
          setIsLoading(false);
        }
      };
      fetchEmployees();
    } else {
      // Clear employees when modal closes
      setEmployees([]);
    }
  }, [isOpen, businessId]);

  // Sort employees: Waiters first, then SPV and Cashier at end
  const sortedEmployees = useMemo(() => {
    const waiters = employees
      .filter(emp => emp.jabatan_id === 1)
      .sort((a, b) => a.nama_karyawan.localeCompare(b.nama_karyawan));
    
    const spvCashier = employees
      .filter(emp => emp.jabatan_id === 2 || emp.jabatan_id === 6)
      .sort((a, b) => a.nama_karyawan.localeCompare(b.nama_karyawan));
    
    const result = [...waiters, ...spvCashier];
    return result;
  }, [employees]);

  // Focus PIN input when pending waiter is set
  useEffect(() => {
    if (pendingWaiter && pinInputRef.current) {
      pinInputRef.current.focus();
    }
  }, [pendingWaiter]);

  // Auto-validate PIN when it reaches 6 digits
  useEffect(() => {
    if (pendingWaiter && pinInput.length === 6) {
      // Validate PIN (case-sensitive)
      if (pinInput.trim() !== pendingWaiter.pin) {
        setPinError('PIN salah');
        setPinInput('');
        return;
      }

      // PIN is correct, select the waiter
      onSelect(pendingWaiter.id, pendingWaiter.nama_karyawan, pendingWaiter.color);
      setPendingWaiter(null);
      setPinInput('');
      setPinError('');
      onClose();
    }
  }, [pinInput, pendingWaiter, onSelect, onClose]);

  // Clear PIN input and error when modal closes
  useEffect(() => {
    if (!isOpen) {
      setPendingWaiter(null);
      setPinInput('');
      setPinError('');
    }
  }, [isOpen]);

  const handleWaiterClick = (employee: Employee) => {
    // Check if employee has a PIN
    if (!employee.pin || employee.pin.trim() === '') {
      // If no PIN, select immediately
      onSelect(employee.id, employee.nama_karyawan, employee.color);
      onClose();
      return;
    }
    
    // Show PIN input
    setPendingWaiter(employee);
    setPinInput('');
    setPinError('');
  };

  const handlePinConfirm = () => {
    if (!pendingWaiter) return;
    
    if (pinInput.trim() === '') {
      setPinError('PIN tidak boleh kosong');
      return;
    }

    // Validate PIN (case-sensitive)
    if (pinInput.trim() !== pendingWaiter.pin) {
      setPinError('PIN salah');
      setPinInput('');
      return;
    }

    // PIN is correct, select the waiter
    onSelect(pendingWaiter.id, pendingWaiter.nama_karyawan, pendingWaiter.color);
    setPendingWaiter(null);
    setPinInput('');
    setPinError('');
    onClose();
  };

  const handlePinCancel = () => {
    setPendingWaiter(null);
    setPinInput('');
    setPinError('');
  };

  const handlePinClear = () => {
    setPinInput('');
    setPinError('');
    if (pinInputRef.current) {
      pinInputRef.current.focus();
    }
  };

  const handlePinKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handlePinCancel();
    }
  };

  if (!isOpen) return null;

  // Calculate grid columns based on number of employees
  const getGridCols = () => {
    if (sortedEmployees.length <= 2) return 'grid-cols-2';
    if (sortedEmployees.length <= 4) return 'grid-cols-3';
    if (sortedEmployees.length <= 6) return 'grid-cols-3';
    return 'grid-cols-4';
  };

  return (
    <div 
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
      onClick={onClose}
      style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
    >
      <div 
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Pilih Waiter</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-600">Memuat data waiter...</span>
            </div>
          ) : sortedEmployees.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 text-lg">No waiter on this business, please add some first</p>
            </div>
          ) : (
            <div className={`grid ${getGridCols()} gap-4`}>
              {sortedEmployees.map((employee) => (
                <div
                  key={employee.id}
                  onClick={() => handleWaiterClick(employee)}
                  className="cursor-pointer rounded-lg p-4 transition-all hover:shadow-lg hover:scale-105"
                  style={{ backgroundColor: employee.color || '#9CA3AF' }}
                >
                  <div className="bg-white rounded px-3 py-2 text-center">
                    <span className="font-medium text-gray-800">{employee.nama_karyawan}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* PIN Input Overlay */}
      {pendingWaiter && (
        <div 
          className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center rounded-lg z-10"
          onClick={(e) => e.stopPropagation()}
        >
          <div 
            className="bg-white rounded-2xl w-full max-w-md mx-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 pb-4">
              <div className="flex items-center gap-3">
                <div 
                  className="w-10 h-10 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: pendingWaiter.color || '#9CA3AF' }}
                >
                  <Lock className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Verifikasi PIN</h2>
                  <p className="text-sm text-gray-600">{pendingWaiter.nama_karyawan}</p>
                </div>
              </div>
              <button
                onClick={handlePinCancel}
                className="w-10 h-10 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-colors"
              >
                <X size={20} className="text-gray-600" />
              </button>
            </div>

            {/* Content */}
            <div className="px-6 pb-6">
              <div className="mb-4">
                <div className="relative">
                  <input
                    ref={pinInputRef}
                    type="password"
                    value={pinInput}
                    onChange={(e) => {
                      // Limit to 6 digits
                      const value = e.target.value.slice(0, 6);
                      setPinInput(value);
                      setPinError(''); // Clear error when typing
                    }}
                    onKeyDown={handlePinKeyDown}
                    className={`w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg text-center tracking-widest placeholder:text-gray-400 ${pinInput.length > 0 ? 'text-black' : ''}`}
                    placeholder="••••••"
                    autoFocus
                    maxLength={6}
                  />
                  {pinInput.length > 0 && (
                    <button
                      onClick={handlePinClear}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      type="button"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
                {pinError && pinError.trim() !== '' && (
                  <p className="mt-2 text-sm text-red-600 text-center">{pinError}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
