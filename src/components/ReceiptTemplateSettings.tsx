'use client';

import { useState, useEffect } from 'react';
import { Save, FileText, Settings, Image, Phone, MapPin, Building2, Printer } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface ReceiptSettings {
  id?: number;
  business_id?: number | null;
  store_name?: string | null;
  address?: string | null;
  phone_number?: string | null;
  contact_phone?: string | null;
  logo_base64?: string | null;
  footer_text?: string | null;
  partnership_contact?: string | null;
  is_active?: number;
  created_at?: string;
  updated_at?: string;
}

export default function ReceiptTemplateSettings() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'settings' | 'receipt' | 'bill'>('settings');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Settings state
  const [settings, setSettings] = useState<ReceiptSettings>({
    store_name: '',
    address: '',
    phone_number: '',
    contact_phone: '',
    logo_base64: '',
    footer_text: '',
    partnership_contact: '',
  });

  // Template selection state
  const [selectedReceiptTemplate, setSelectedReceiptTemplate] = useState<string | null>(null);
  const [selectedBillTemplate, setSelectedBillTemplate] = useState<string | null>(null);
  const [availableTemplates, setAvailableTemplates] = useState<{
    receipt: Array<{ id: number; name: string; is_default: boolean }>;
    bill: Array<{ id: number; name: string; is_default: boolean }>;
  }>({ receipt: [], bill: [] });

  const businessId = user?.selectedBusinessId ?? undefined;

  // Load settings
  useEffect(() => {
    loadSettings();
    loadAvailableTemplates();
  }, [businessId]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const result = await window.electronAPI?.getReceiptSettings?.(businessId);
      if (result?.success && result.settings) {
        setSettings({
          store_name: result.settings.store_name || '',
          address: result.settings.address || '',
          phone_number: result.settings.phone_number || '',
          contact_phone: result.settings.contact_phone || '',
          logo_base64: result.settings.logo_base64 || '',
          footer_text: result.settings.footer_text || '',
          partnership_contact: result.settings.partnership_contact || '',
        });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      setMessage({ type: 'error', text: 'Gagal memuat pengaturan' });
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableTemplates = async () => {
    try {
      setLoading(true);
      // Load templates for each type
      const [receiptResult, billResult] = await Promise.all([
        window.electronAPI?.getReceiptTemplates?.('receipt', businessId),
        window.electronAPI?.getReceiptTemplates?.('bill', businessId),
      ]);

      if (receiptResult?.success) {
        setAvailableTemplates(prev => ({ ...prev, receipt: receiptResult.templates || [] }));
        const defaultTemplate = receiptResult.templates?.find(t => t.is_default);
        if (defaultTemplate) {
          setSelectedReceiptTemplate(defaultTemplate.name);
        }
      }
      if (billResult?.success) {
        setAvailableTemplates(prev => ({ ...prev, bill: billResult.templates || [] }));
        const defaultTemplate = billResult.templates?.find(t => t.is_default);
        if (defaultTemplate) {
          setSelectedBillTemplate(defaultTemplate.name);
        }
      }
    } catch (error) {
      console.error('Error loading templates:', error);
      setMessage({ type: 'error', text: 'Gagal memuat daftar template' });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      setSaving(true);
      setMessage(null);
      const result = await window.electronAPI?.saveReceiptSettings?.(settings, businessId);
      if (result?.success) {
        setMessage({ type: 'success', text: 'Pengaturan berhasil disimpan' });
      } else {
        setMessage({ type: 'error', text: result?.error || 'Gagal menyimpan pengaturan' });
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      setMessage({ type: 'error', text: 'Gagal menyimpan pengaturan' });
    } finally {
      setSaving(false);
    }
  };

  const handleSelectTemplate = async (type: 'receipt' | 'bill', templateName: string) => {
    try {
      setSaving(true);
      setMessage(null);
      const result = await window.electronAPI?.setDefaultReceiptTemplate?.(type, templateName, businessId);
      if (result?.success) {
        if (type === 'receipt') {
          setSelectedReceiptTemplate(templateName);
        } else if (type === 'bill') {
          setSelectedBillTemplate(templateName);
        }
        setMessage({ type: 'success', text: `Template ${templateName} dipilih sebagai default` });
        // Reload templates to update is_default flags
        await loadAvailableTemplates();
      } else {
        setMessage({ type: 'error', text: result?.error || `Gagal memilih template` });
      }
    } catch (error) {
      console.error(`Error selecting template:`, error);
      setMessage({ type: 'error', text: `Gagal memilih template` });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setSettings({ ...settings, logo_base64: base64String });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleTestPrint = async (templateType: 'receipt' | 'bill') => {
    try {
      setSaving(true);
      setMessage(null);

      // Create test data - always use printer 1 (receiptPrinter)
      const testData = {
        type: 'test' as const,
        printerType: 'receiptPrinter', // Always use printer 1
        business_id: businessId || undefined,
        items: [
          {
            name: 'Test Item 1',
            quantity: 2,
            price: 15000,
            total_price: 30000,
          },
          {
            name: 'Test Item 2',
            quantity: 1,
            price: 25000,
            total_price: 25000,
          },
        ],
        total: 55000,
        final_amount: 55000,
        paymentMethod: templateType === 'bill' ? undefined : 'Cash',
        amountReceived: templateType === 'bill' ? undefined : 60000,
        change: templateType === 'bill' ? undefined : 5000,
        date: new Date().toISOString(),
        receiptNumber: 'TEST001',
        cashier: 'Test Print',
        pickupMethod: 'dine-in',
        printer1Counter: 1,
        printer2Counter: 1,
        globalCounter: 1,
        isBill: templateType === 'bill',
        id: 'test-print-' + Date.now(),
      };

      const printResult = await window.electronAPI?.printReceipt?.(testData);
      
      if (printResult && typeof printResult === 'object' && 'success' in printResult) {
        const result = printResult as { success: boolean; error?: string };
        if (result.success) {
          setMessage({ type: 'success', text: 'Test print berhasil dikirim ke printer' });
        } else {
          setMessage({ type: 'error', text: result.error || 'Gagal mencetak test print' });
        }
      } else {
        setMessage({ type: 'success', text: 'Test print berhasil dikirim ke printer' });
      }
    } catch (error) {
      console.error('Error in test print:', error);
      setMessage({ type: 'error', text: 'Gagal mencetak test print' });
    } finally {
      setSaving(false);
    }
  };

  if (loading && !settings.store_name && activeTab === 'settings') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Memuat...</div>
      </div>
    );
  }

  return (
    <div className="px-6 pb-6 pt-6 max-w-6xl mx-auto">
      {message && (
        <div
          className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 p-4 rounded-lg shadow-lg max-w-md w-full mx-4 ${
            message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span>{message.text}</span>
            <button
              onClick={() => setMessage(null)}
              className="ml-4 text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('settings')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
              activeTab === 'settings'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Settings className="w-4 h-4" />
            Pengaturan Konten
          </button>
          <button
            onClick={() => setActiveTab('receipt')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
              activeTab === 'receipt'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <FileText className="w-4 h-4" />
            Template Struk
          </button>
          <button
            onClick={() => setActiveTab('bill')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
              activeTab === 'bill'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <FileText className="w-4 h-4" />
            Template Bill
          </button>
        </nav>
      </div>

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              Informasi Toko
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nama Toko
                </label>
                <input
                  type="text"
                  value={settings.store_name || ''}
                  onChange={(e) => setSettings({ ...settings, store_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder:text-gray-500"
                  placeholder="Contoh: MOMOYO"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Alamat
                </label>
                <textarea
                  value={settings.address || ''}
                  onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder:text-gray-500"
                  placeholder="Jl. Kalimantan no. 21, Kartoharjo&#10;Kec. Kartoharjo, Kota Madiun"
                />
                <p className="text-xs text-gray-500 mt-1">Gunakan &lt;br&gt; untuk baris baru</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Phone className="w-5 h-5" />
              Kontak
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nomor Telepon
                </label>
                <input
                  type="text"
                  value={settings.phone_number || ''}
                  onChange={(e) => setSettings({ ...settings, phone_number: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder:text-gray-500"
                  placeholder="0812-1822-2666"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Kontak (Teks di Header)
                </label>
                <input
                  type="text"
                  value={settings.contact_phone || ''}
                  onChange={(e) => setSettings({ ...settings, contact_phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder:text-gray-500"
                  placeholder="silahkan hubungi: 0813-9888-8568"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Kontak Partnership
                </label>
                <input
                  type="text"
                  value={settings.partnership_contact || ''}
                  onChange={(e) => setSettings({ ...settings, partnership_contact: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder:text-gray-500"
                  placeholder="Untuk layanan kemitraan dan partnership"
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Image className="w-5 h-5" />
              Logo
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Upload Logo
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {settings.logo_base64 && (
                  <div className="mt-4">
                    <p className="text-sm text-gray-600 mb-2">Preview:</p>
                    <img
                      src={settings.logo_base64}
                      alt="Logo preview"
                      className="max-h-32 border border-gray-300 rounded"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Footer Text</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Teks Footer
              </label>
              <textarea
                value={settings.footer_text || ''}
                onChange={(e) => setSettings({ ...settings, footer_text: e.target.value })}
                rows={5}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm text-gray-900 placeholder:text-gray-500"
                placeholder="Pendapat Anda sangat penting bagi kami.&#10;Untuk kritik dan saran silahkan hubungi :&#10;0812-1822-2666"
              />
              <p className="text-xs text-gray-500 mt-1">Gunakan &lt;p&gt; untuk paragraf baru</p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
            </button>
          </div>
        </div>
      )}

      {/* Template Selection Tab */}
      {activeTab === 'receipt' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Pilih Template Struk (Receipt)</h3>
              <button
                onClick={handleTestPrint.bind(null, 'receipt')}
                disabled={saving || !selectedReceiptTemplate}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Printer className="w-4 h-4" />
                Test Print
              </button>
            </div>
            {loading ? (
              <div className="text-center py-8 text-gray-500">Memuat template...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {availableTemplates.receipt.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => handleSelectTemplate('receipt', template.name)}
                    disabled={saving}
                    className={`p-4 border-2 rounded-lg text-left transition-all ${
                      selectedReceiptTemplate === template.name
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-gray-900">{template.name}</span>
                      {template.is_default && (
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Default</span>
                      )}
                    </div>
                    {selectedReceiptTemplate === template.name && (
                      <div className="text-sm text-blue-600 mt-2">✓ Dipilih</div>
                    )}
                  </button>
                ))}
                {availableTemplates.receipt.length === 0 && (
                  <div className="col-span-full text-center py-8 text-gray-500">
                    Tidak ada template tersedia. Jalankan insert_default_templates.sql untuk menambahkan template default.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bill Template Selection Tab */}
      {activeTab === 'bill' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Pilih Template Bill</h3>
              <button
                onClick={handleTestPrint.bind(null, 'bill')}
                disabled={saving || !selectedBillTemplate}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Printer className="w-4 h-4" />
                Test Print
              </button>
            </div>
            {loading ? (
              <div className="text-center py-8 text-gray-500">Memuat template...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {availableTemplates.bill.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => handleSelectTemplate('bill', template.name)}
                    disabled={saving}
                    className={`p-4 border-2 rounded-lg text-left transition-all ${
                      selectedBillTemplate === template.name
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-gray-900">{template.name}</span>
                      {template.is_default && (
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Default</span>
                      )}
                    </div>
                    {selectedBillTemplate === template.name && (
                      <div className="text-sm text-blue-600 mt-2">✓ Dipilih</div>
                    )}
                  </button>
                ))}
                {availableTemplates.bill.length === 0 && (
                  <div className="col-span-full text-center py-8 text-gray-500">
                    Tidak ada template tersedia. Jalankan insert_default_templates.sql untuk menambahkan template default.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
