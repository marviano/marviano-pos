'use client';

import { useEffect, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { offlineSyncService } from '@/lib/offlineSync';
import { getApiUrl } from '@/lib/api';

interface Product {
  id: number;
  nama: string;
}

interface CustomizationOption {
  id: number;
  customization_type_id: number;
  name: string;
  price_adjustment: number;
}

interface Customization {
  id: number;
  name: string;
  selection_mode: 'single' | 'multiple';
  options: CustomizationOption[];
}

export interface SelectedCustomization {
  customization_id: number;
  customization_name: string;
  selected_options: {
    option_id: number;
    option_name: string;
    price_adjustment: number;
  }[];
}

interface BundleProductCustomizationModalProps {
  isOpen: boolean;
  product: Product | null;
  initialCustomizations?: SelectedCustomization[];
  onClose: () => void;
  onSave: (customizations: SelectedCustomization[]) => void;
}

export default function BundleProductCustomizationModal({
  isOpen,
  product,
  initialCustomizations = [],
  onClose,
  onSave
}: BundleProductCustomizationModalProps) {
  const [customizations, setCustomizations] = useState<Customization[]>([]);
  const [selectedCustomizations, setSelectedCustomizations] = useState<SelectedCustomization[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !product) {
      setCustomizations(prev => (prev.length === 0 ? prev : []));
      setSelectedCustomizations(prev => (prev.length === 0 ? prev : []));
      setError(prev => (prev === null ? prev : null));
      return;
    }

    const fetchCustomizations = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await offlineSyncService.fetchWithFallback(
          async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            try {
              const response = await fetch(getApiUrl(`/api/products/${product.id}/customizations`), {
                signal: controller.signal
              });
              clearTimeout(timeoutId);

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
              }

              const data = await response.json();
              return data.customizations || [];
            } catch (err) {
              clearTimeout(timeoutId);
              throw err;
            }
          },
          async () => {
            const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
            if (!electronAPI?.localDbGetProductCustomizations) {
              throw new Error('Offline database not available');
            }
            const offlineData = await electronAPI.localDbGetProductCustomizations(product.id);
            return offlineData || [];
          }
        );

        setCustomizations(Array.isArray(result) ? (result as Customization[]) : []);

        const nextSelections: SelectedCustomization[] = (Array.isArray(result) ? (result as Customization[]) : []).map((customization) => {
          const existing = initialCustomizations.find(
            (sel) => sel.customization_id === customization.id
          );

          return {
            customization_id: customization.id,
            customization_name: customization.name,
            selected_options: existing ? [...existing.selected_options] : []
          };
        });

        setSelectedCustomizations(nextSelections);

        if (result.length === 0) {
          setError('Produk ini tidak memiliki opsi kustomisasi.');
        }
      } catch (err) {
        console.error('Error fetching bundle customizations:', err);
        setError('Gagal memuat opsi kustomisasi.');
        setCustomizations([]);
        setSelectedCustomizations([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCustomizations();
  }, [isOpen, product, initialCustomizations]);

  const handleOptionToggle = (customizationId: number, option: CustomizationOption) => {
    setSelectedCustomizations((prev) => {
      return prev.map((selection) => {
        if (selection.customization_id !== customizationId) {
          return selection;
        }

        const customization = customizations.find((c) => c.id === customizationId);
        if (!customization) return selection;

        if (customization.selection_mode === 'single') {
          return {
            ...selection,
            selected_options: [
              {
                option_id: option.id,
                option_name: option.name,
                price_adjustment: option.price_adjustment
              }
            ]
          };
        }

        const existingIndex = selection.selected_options.findIndex(
          (opt) => opt.option_id === option.id
        );

        if (existingIndex >= 0) {
          return {
            ...selection,
            selected_options: selection.selected_options.filter(
              (opt) => opt.option_id !== option.id
            )
          };
        }

        return {
          ...selection,
          selected_options: [
            ...selection.selected_options,
            {
              option_id: option.id,
              option_name: option.name,
              price_adjustment: option.price_adjustment
            }
          ]
        };
      });
    });
  };

  const isOptionSelected = (customizationId: number, optionId: number) => {
    const selection = selectedCustomizations.find(
      (sel) => sel.customization_id === customizationId
    );
    return selection?.selected_options.some((opt) => opt.option_id === optionId) || false;
  };

  const handleReset = () => {
    setSelectedCustomizations((prev) =>
      prev.map((selection) => ({
        ...selection,
        selected_options: []
      }))
    );
  };

  const handleSave = () => {
    const filtered = selectedCustomizations.filter(
      (selection) => selection.selected_options.length > 0
    );
    onSave(filtered);
    onClose();
  };

  if (!isOpen || !product) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[90] p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Atur Kustomisasi</h2>
            <p className="text-sm text-gray-500">{product.nama}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              disabled={selectedCustomizations.every((sel) => sel.selected_options.length === 0)}
              className="flex items-center gap-1 px-3 py-2 text-sm text-blue-600 hover:text-blue-700 disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center"
            >
              <X className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="py-12 text-center text-gray-600">
              <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4"></div>
              Memuat opsi kustomisasi...
            </div>
          ) : error ? (
            <div className="py-12 text-center text-gray-500 text-sm">{error}</div>
          ) : customizations.length === 0 ? (
            <div className="py-12 text-center text-gray-500 text-sm">
              Tidak ada opsi kustomisasi untuk produk ini.
            </div>
          ) : (
            customizations.map((customization) => (
              <div key={customization.id} className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-800">{customization.name}</h3>
                    <p className="text-xs text-gray-500">
                      {customization.selection_mode === 'single'
                        ? 'Pilih salah satu opsi'
                        : 'Pilih satu atau lebih opsi'}
                    </p>
                  </div>
                </div>

                {customization.selection_mode === 'single' ? (
                  <div className="flex flex-wrap gap-2">
                    {customization.options.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => handleOptionToggle(customization.id, option)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 border-2 ${
                          isOptionSelected(customization.id, option.id)
                            ? 'bg-teal-100 border-teal-400 text-teal-800 shadow-sm'
                            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span>{option.name}</span>
                          {option.price_adjustment !== 0 && (
                            <span className="text-xs font-semibold text-gray-500">
                              {option.price_adjustment > 0 ? '+' : ''}Rp{' '}
                              {Math.abs(option.price_adjustment).toLocaleString('id-ID')}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {customization.options.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => handleOptionToggle(customization.id, option)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 border-2 text-left ${
                          isOptionSelected(customization.id, option.id)
                            ? 'bg-teal-100 border-teal-400 text-teal-800 shadow-sm'
                            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100 hover:border-gray-300'
                        }`}
                      >
                        <div className="font-medium">{option.name}</div>
                        {option.price_adjustment !== 0 && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {option.price_adjustment > 0 ? '+' : ''}Rp{' '}
                            {Math.abs(option.price_adjustment).toLocaleString('id-ID')}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="p-5 border-t border-gray-200 bg-white flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium"
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={loading || !!error}
            className={`px-5 py-2.5 rounded-xl font-medium transition-colors ${
              loading || !!error
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}

