'use client';

import { useState, useEffect } from 'react';
import { Save, FileText, Settings, Image, Phone, MapPin, Building2, Printer, Copy, X, Pencil, Eye, CloudUpload, CloudDownload, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

/** Preview: show placeholders as bold {{something}}, strip conditionals. For checker type, scale down so label fits. */
function renderReceiptPreview(code: string, templateType?: TemplateType): string {
  let html = code;
  // Fix CSS: replace padding placeholders in <style> with numbers so layout works (centering, etc.)
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_: string, open: string, css: string, close: string) => {
    const fixed = css.replace(/\{\{leftPadding\}\}/g, '7').replace(/\{\{rightPadding\}\}/g, '7');
    return open + fixed + close;
  });
  // Strip conditionals: no reprint, include amount-received block, no voucher
  html = html.replace(/\{\{#ifReprint\}\}[\s\S]*?\{\{\/ifReprint\}\}/g, '');
  const ifAmount = html.match(/\{\{#ifAmountReceived\}\}([\s\S]*?)\{\{\/ifAmountReceived\}\}/);
  if (ifAmount) html = html.replace(/\{\{#ifAmountReceived\}\}[\s\S]*?\{\{\/ifAmountReceived\}\}/g, ifAmount[1]);
  else html = html.replace(/\{\{#ifAmountReceived\}\}[\s\S]*?\{\{\/ifAmountReceived\}\}/g, '');
  html = html.replace(/\{\{#ifVoucher\}\}[\s\S]*?\{\{\/ifVoucher\}\}/g, '');
  html = html.replace(/\{\{#ifBill\}\}[\s\S]*?\{\{\/ifBill\}\}/g, '');
  html = html.replace(/\{\{#ifReceipt\}\}[\s\S]*?\{\{\/ifReceipt\}\}/g, '');
  // Show all {{placeholder}} as bold (style block already fixed, so CSS stays valid)
  html = html.replace(/\{\{([^{}]+)\}\}/g, '<strong>{{$1}}</strong>');
  // Logo: wrap in .logo-container so it centers like real receipt (same structure as print)
  html = html.replace(/<strong>\{\{logo\}\}<\/strong>/g, '<div class="logo-container"><strong>{{logo}}</strong></div>');
  // Preview-only style: center receipt; for checker/label scale down so small label doesn't appear huge
  const previewStyle =
    templateType === 'checker'
      ? '<style data-preview>body{margin-left:auto;margin-right:auto;transform:scale(0.55);transform-origin:top center;}</style>'
      : '<style data-preview>body{margin-left:auto;margin-right:auto;}</style>';
  html = html.replace('</head>', previewStyle + '</head>');
  return html;
}

type TemplateType = 'receipt' | 'bill' | 'checker';

type TemplateModalMode = 'edit' | 'duplicate' | 'create';

const DEFAULT_MINIMAL_TEMPLATE = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>body{font-family:Arial;width:42ch;font-size:10pt;padding:2mm 7mm;} .dashed-line{border-top:1px dashed #000;margin:1.5mm 0;} table{width:100%;border-collapse:collapse;} td{padding:0.5mm 0;} .footer{text-align:center;font-size:8pt;margin-top:2mm;}</style></head>
<body>
<div class="branch">{{businessName}}</div>
<div class="address">{{address}}</div>
<div class="contact">{{contactPhone}}</div>
<div class="dashed-line"></div>
<table><tr><th>Nama Produk</th><th>Harga</th><th>Jumlah</th><th>Subtotal</th></tr>{{items}}</table>
<div class="dashed-line"></div>
<div>Total: {{total}}</div>
<div class="footer">{{footerText}}</div>
</body>
</html>`;

/** Default checker (label) template – placeholders: {{counter}}, {{itemNumber}}, {{totalItems}}, {{pickupMethod}}, {{productName}}, {{customizations}}, {{orderTime}}, {{labelContinuation}} */
const DEFAULT_CHECKER_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 40mm 30mm; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; color: black; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      width: 22ch;
      max-width: 22ch;
      font-size: 8pt;
      font-weight: 600;
      line-height: 1.4;
      padding: 3mm 0 3mm 3mm;
      word-wrap: break-word;
      overflow-wrap: break-word;
      color: black;
    }
    .content { }
    .row { display: table; width: calc(100% + 3mm); table-layout: fixed; margin-right: -3mm; }
    .row > div { display: table-cell; }
    .counter { font-size: 9pt; font-weight: 700; }
    .pickup { text-align: left; font-size: 7pt; font-weight: 700; text-transform: uppercase; }
    .product { text-align: left; font-size: 7pt; font-weight: 600; }
    .customizations { text-align: left; font-size: 7pt; font-weight: 500; }
    .number { font-size: 9pt; font-weight: 700; text-align: right; }
    .continuation { font-size: 7pt; font-weight: 600; color: #666; text-align: center; }
    .footer { margin-top: 2mm; }
    .time { text-align: left; font-size: 7pt; font-weight: 500; }
  </style>
</head>
<body>
  <div class="content">
    <div class="row">
      <div class="counter">{{counter}}</div>
      <div class="continuation">{{labelContinuation}}</div>
      <div class="number">{{itemNumber}}/{{totalItems}}</div>
    </div>
    <div class="pickup">{{pickupMethod}}</div>
    <div class="product">{{productName}}</div>
    <div class="customizations">{{customizations}}</div>
  </div>
  <div class="footer">
    <div class="time">{{orderTime}}</div>
  </div>
</body>
</html>`;

interface EditTemplateModal {
  mode: TemplateModalMode;
  type: TemplateType;
  templateId: number;
  templateName: string;
  code: string;
  newName: string;
  setAsDefault: boolean;
  showNotes: boolean;
  /** Checker only: true = one label per product unit, false = one combined kitchen order slip. */
  oneLabelPerProduct: boolean;
  /** True if this template is the default (used for printing). */
  isDefault: boolean;
}

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
  const [activeTab, setActiveTab] = useState<'settings' | 'receipt' | 'bill' | 'checker'>('settings');
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

  // Template selection state (name for API; id for UI so only one card shows as selected)
  const [selectedReceiptTemplate, setSelectedReceiptTemplate] = useState<string | null>(null);
  const [selectedReceiptTemplateId, setSelectedReceiptTemplateId] = useState<number | null>(null);
  const [selectedBillTemplate, setSelectedBillTemplate] = useState<string | null>(null);
  const [selectedBillTemplateId, setSelectedBillTemplateId] = useState<number | null>(null);
  const [selectedCheckerTemplate, setSelectedCheckerTemplate] = useState<string | null>(null);
  const [selectedCheckerTemplateId, setSelectedCheckerTemplateId] = useState<number | null>(null);
  const [availableTemplates, setAvailableTemplates] = useState<{
    receipt: Array<{ id: number; name: string; is_default: boolean }>;
    bill: Array<{ id: number; name: string; is_default: boolean }>;
    checker: Array<{ id: number; name: string; is_default: boolean }>;
  }>({ receipt: [], bill: [], checker: [] });

  // Copy & Edit template modal
  const [editModal, setEditModal] = useState<EditTemplateModal | null>(null);
  const [editModalLoading, setEditModalLoading] = useState(false);

  // Per-template VPS sync (upload/download)
  const [syncingCard, setSyncingCard] = useState<{ id: number; direction: 'upload' | 'download' } | null>(null);
  const [cardSyncResults, setCardSyncResults] = useState<Record<number, { type: 'success' | 'skip' | 'error'; message: string } | null>>({});
  const [downloadingAllReceipt, setDownloadingAllReceipt] = useState(false);

  const businessId = user?.selectedBusinessId ?? undefined;

  const clearCardResultAfterDelay = (templateId: number, delayMs: number) => {
    const t = setTimeout(() => {
      setCardSyncResults(prev => {
        const next = { ...prev };
        delete next[templateId];
        return next;
      });
    }, delayMs);
    return () => clearTimeout(t);
  };

  const handleUploadTemplate = async (id: number) => {
    setSyncingCard({ id, direction: 'upload' });
    setCardSyncResults(prev => ({ ...prev, [id]: null }));
    try {
      const result = await window.electronAPI?.uploadTemplateToVps?.(id);
      if (!result) {
        setCardSyncResults(prev => ({ ...prev, [id]: { type: 'error', message: 'VPS tidak tersedia' } }));
        clearCardResultAfterDelay(id, 3000);
        return;
      }
      const type = result.skipped ? 'skip' : result.success ? 'success' : 'error';
      setCardSyncResults(prev => ({ ...prev, [id]: { type, message: result.message } }));
      clearCardResultAfterDelay(id, 3000);
      if (result.success && !result.skipped) await loadAvailableTemplates();
    } catch (e) {
      setCardSyncResults(prev => ({ ...prev, [id]: { type: 'error', message: (e as Error)?.message || 'Gagal upload' } }));
      clearCardResultAfterDelay(id, 3000);
    } finally {
      setSyncingCard(null);
    }
  };

  const handleDownloadTemplate = async (id: number) => {
    setSyncingCard({ id, direction: 'download' });
    setCardSyncResults(prev => ({ ...prev, [id]: null }));
    try {
      const result = await window.electronAPI?.downloadTemplateFromVps?.(id);
      if (!result) {
        setCardSyncResults(prev => ({ ...prev, [id]: { type: 'error', message: 'VPS tidak tersedia' } }));
        clearCardResultAfterDelay(id, 3000);
        return;
      }
      const type = result.skipped ? 'skip' : result.success ? 'success' : 'error';
      setCardSyncResults(prev => ({ ...prev, [id]: { type, message: result.message } }));
      clearCardResultAfterDelay(id, 3000);
      if (result.success && !result.skipped) await loadAvailableTemplates();
    } catch (e) {
      setCardSyncResults(prev => ({ ...prev, [id]: { type: 'error', message: (e as Error)?.message || 'Gagal download' } }));
      clearCardResultAfterDelay(id, 3000);
    } finally {
      setSyncingCard(null);
    }
  };

  const handleDownloadAllReceiptFromVps = async () => {
    if (availableTemplates.receipt.length === 0) return;
    setDownloadingAllReceipt(true);
    try {
      for (const template of availableTemplates.receipt) {
        await window.electronAPI?.downloadTemplateFromVps?.(template.id);
      }
      await loadAvailableTemplates();
    } finally {
      setDownloadingAllReceipt(false);
    }
  };

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
      const [receiptResult, billResult, checkerResult] = await Promise.all([
        window.electronAPI?.getReceiptTemplates?.('receipt', businessId),
        window.electronAPI?.getReceiptTemplates?.('bill', businessId),
        window.electronAPI?.getReceiptTemplates?.('checker', businessId),
      ]);

      if (receiptResult?.success) {
        setAvailableTemplates(prev => ({ ...prev, receipt: receiptResult.templates || [] }));
        const defaultTemplate = receiptResult.templates?.find(t => t.is_default);
        if (defaultTemplate) {
          setSelectedReceiptTemplate(defaultTemplate.name);
          setSelectedReceiptTemplateId(defaultTemplate.id);
        } else {
          setSelectedReceiptTemplateId(null);
        }
      }
      if (billResult?.success) {
        setAvailableTemplates(prev => ({ ...prev, bill: billResult.templates || [] }));
        const defaultTemplate = billResult.templates?.find(t => t.is_default);
        if (defaultTemplate) {
          setSelectedBillTemplate(defaultTemplate.name);
          setSelectedBillTemplateId(defaultTemplate.id);
        } else {
          setSelectedBillTemplateId(null);
        }
      }
      if (checkerResult?.success) {
        setAvailableTemplates(prev => ({ ...prev, checker: checkerResult.templates || [] }));
        const defaultTemplate = checkerResult.templates?.find(t => t.is_default);
        if (defaultTemplate) {
          setSelectedCheckerTemplate(defaultTemplate.name);
          setSelectedCheckerTemplateId(defaultTemplate.id);
        } else {
          setSelectedCheckerTemplateId(null);
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

  const handleSelectTemplate = async (type: 'receipt' | 'bill' | 'checker', templateName: string, templateId?: number) => {
    try {
      setSaving(true);
      setMessage(null);
      const result = await window.electronAPI?.setDefaultReceiptTemplate?.(type, templateName, businessId);
      if (result?.success) {
        if (type === 'receipt') {
          setSelectedReceiptTemplate(templateName);
          if (templateId != null) setSelectedReceiptTemplateId(templateId);
        } else if (type === 'bill') {
          setSelectedBillTemplate(templateName);
          if (templateId != null) setSelectedBillTemplateId(templateId);
        } else if (type === 'checker') {
          setSelectedCheckerTemplate(templateName);
          if (templateId != null) setSelectedCheckerTemplateId(templateId);
        }
        setMessage({ type: 'success', text: `Template ${templateName} dipilih sebagai default` });
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

  const openTemplateEditor = async (mode: TemplateModalMode, type: TemplateType, template: { id: number; name: string; is_default?: boolean }) => {
    try {
      setEditModalLoading(true);
      setMessage(null);
      const result = await window.electronAPI?.getReceiptTemplateById?.(template.id);
      if (!result?.success || result.templateCode == null) {
        setMessage({ type: 'error', text: result?.error || 'Gagal memuat kode template' });
        return;
      }
      setEditModal({
        mode,
        type,
        templateId: template.id,
        templateName: template.name,
        code: result.templateCode,
        newName: mode === 'duplicate' ? `${template.name} (Salinan)` : template.name,
        setAsDefault: false,
        showNotes: result.showNotes ?? false,
        oneLabelPerProduct: result.oneLabelPerProduct !== false,
        isDefault: template.is_default ?? false,
      });
    } catch (error) {
      console.error('Error loading template:', error);
      setMessage({ type: 'error', text: 'Gagal memuat template' });
    } finally {
      setEditModalLoading(false);
    }
  };

  const handleEditTemplate = (type: TemplateType, template: { id: number; name: string; is_default?: boolean }) =>
    openTemplateEditor('edit', type, template);

  const handleDuplikatEdit = (type: TemplateType, template: { id: number; name: string; is_default?: boolean }) =>
    openTemplateEditor('duplicate', type, template);

  const openCreateTemplate = (type: TemplateType) => {
    setEditModal({
      mode: 'create',
      type,
      templateId: 0,
      templateName: '',
      code: type === 'checker' ? DEFAULT_CHECKER_TEMPLATE : DEFAULT_MINIMAL_TEMPLATE,
      newName: '',
      setAsDefault: false,
      showNotes: false,
      oneLabelPerProduct: true,
      isDefault: false,
    });
  };

  const handleCloseEditModal = () => {
    setEditModal(null);
  };

  const handleSaveTemplate = async () => {
    if (!editModal) return;
    if (!editModal.newName.trim()) {
      setMessage({ type: 'error', text: editModal.mode === 'duplicate' || editModal.mode === 'create' ? 'Nama template baru wajib diisi' : 'Nama template wajib diisi' });
      return;
    }
    try {
      setSaving(true);
      setMessage(null);
      if (editModal.mode === 'edit') {
        const newName = editModal.newName.trim();
        const result = await window.electronAPI?.updateReceiptTemplate?.(editModal.templateId, editModal.code, newName, editModal.showNotes, editModal.oneLabelPerProduct);
        if (!result?.success) {
          setMessage({ type: 'error', text: result?.error || 'Gagal menyimpan perubahan' });
          return;
        }
        const nameChanged = newName !== editModal.templateName;
        if (nameChanged) {
          if (selectedReceiptTemplate === editModal.templateName) setSelectedReceiptTemplate(newName);
          if (selectedBillTemplate === editModal.templateName) setSelectedBillTemplate(newName);
          if (selectedCheckerTemplate === editModal.templateName) setSelectedCheckerTemplate(newName);
          setAvailableTemplates(prev => ({
            ...prev,
            receipt: prev.receipt.map(t => t.id === editModal.templateId ? { ...t, name: newName } : t),
            bill: prev.bill.map(t => t.id === editModal.templateId ? { ...t, name: newName } : t),
            checker: prev.checker.map(t => t.id === editModal.templateId ? { ...t, name: newName } : t),
          }));
        }
        await loadAvailableTemplates();
        setMessage({ type: 'success', text: `Template "${newName}" berhasil diperbarui` });
      } else {
        const result = await window.electronAPI?.saveReceiptTemplate?.(
          editModal.type,
          editModal.code,
          editModal.newName.trim(),
          businessId,
          editModal.showNotes,
          editModal.oneLabelPerProduct
        );
        if (!result?.success) {
          setMessage({ type: 'error', text: result?.error || 'Gagal menyimpan template' });
          return;
        }
        if (editModal.setAsDefault) {
          await window.electronAPI?.setDefaultReceiptTemplate?.(editModal.type, editModal.newName.trim(), businessId);
          if (editModal.type === 'receipt') setSelectedReceiptTemplate(editModal.newName.trim());
          else if (editModal.type === 'bill') setSelectedBillTemplate(editModal.newName.trim());
          else if (editModal.type === 'checker') setSelectedCheckerTemplate(editModal.newName.trim());
        }
        await loadAvailableTemplates();
        setMessage({ type: 'success', text: editModal.mode === 'create' ? `Template "${editModal.newName.trim()}" berhasil dibuat` : `Template "${editModal.newName.trim()}" berhasil disimpan` });
      }
      handleCloseEditModal();
    } catch (error) {
      console.error('Error saving template:', error);
      setMessage({ type: 'error', text: 'Gagal menyimpan template' });
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

  const handleTestPrint = async (templateType: 'receipt' | 'bill' | 'checker') => {
    try {
      setSaving(true);
      setMessage(null);

      if (templateType === 'checker') {
        // Test print checker (label) – uses checker template when set; prints to label printer
        const testData: Record<string, unknown> = {
          type: 'test',
          printerType: 'labelPrinter',
          business_id: businessId || undefined,
          id: 'test-checker-' + Date.now(),
        };
        const configsRaw = await window.electronAPI?.localDbGetPrinterConfigs?.();
        if (Array.isArray(configsRaw)) {
          const labelConfig = configsRaw.find(
            (c: unknown) => (c as { printer_type?: string })?.printer_type === 'labelPrinter'
          ) as { system_printer_name?: string } | undefined;
          if (labelConfig?.system_printer_name?.trim()) {
            testData.printerName = String(labelConfig.system_printer_name).trim();
          }
        }
        const printResult = await window.electronAPI?.printReceipt?.(testData);
        if (printResult && typeof printResult === 'object' && 'success' in printResult) {
          const result = printResult as { success: boolean; error?: string };
          if (result.success) {
            setMessage({ type: 'success', text: 'Test print checker berhasil dikirim ke printer label' });
          } else {
            setMessage({ type: 'error', text: result.error || 'Gagal mencetak test checker' });
          }
        } else {
          setMessage({ type: 'success', text: 'Test print checker berhasil dikirim ke printer label' });
        }
        setSaving(false);
        return;
      }

      // Use Printer 1 (receiptPrinter): fetch from config and pass printerName so it's used
      let printerName: string | undefined;
      let marginAdjustMm: number | undefined;
      const configsRaw = await window.electronAPI?.localDbGetPrinterConfigs?.();
      if (Array.isArray(configsRaw)) {
        const receiptConfig = configsRaw.find(
          (c: unknown) => (c as { printer_type?: string })?.printer_type === 'receiptPrinter'
        ) as { system_printer_name?: string; extra_settings?: string | Record<string, unknown> } | undefined;
        if (receiptConfig?.system_printer_name?.trim()) {
          printerName = String(receiptConfig.system_printer_name).trim();
        }
        if (receiptConfig?.extra_settings) {
          try {
            const extra = typeof receiptConfig.extra_settings === 'string'
              ? JSON.parse(receiptConfig.extra_settings) as Record<string, unknown>
              : receiptConfig.extra_settings as Record<string, unknown>;
            if (extra && typeof extra.marginAdjustMm === 'number' && !Number.isNaN(extra.marginAdjustMm)) {
              marginAdjustMm = extra.marginAdjustMm;
            }
          } catch { /* ignore */ }
        }
      }

      const testData: Record<string, unknown> = {
        type: 'test',
        printerType: 'receiptPrinter',
        business_id: businessId || undefined,
        items: [
          { name: 'Test Item 1', quantity: 2, price: 15000, total_price: 30000 },
          { name: 'Test Item 2', quantity: 1, price: 25000, total_price: 25000 },
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
      if (printerName) testData.printerName = printerName;
      if (typeof marginAdjustMm === 'number' && !Number.isNaN(marginAdjustMm)) testData.marginAdjustMm = marginAdjustMm;

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
          <button
            onClick={() => setActiveTab('checker')}
            className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
              activeTab === 'checker'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Printer className="w-4 h-4" />
            Template Label/Checker
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
                  Nama Toko (store_name)
                </label>
                <input
                  type="text"
                  value={settings.store_name || ''}
                  onChange={(e) => setSettings({ ...settings, store_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder:text-gray-500"
                  placeholder="Contoh: MOMOYO"
                />
                <p className="text-xs text-gray-500 mt-1">Untuk referensi / custom template. Nama cabang di struk default dari bisnis yang dipilih.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Alamat (<strong className="font-semibold">{'{{address}}'}</strong> di template)
                </label>
                <textarea
                  value={settings.address || ''}
                  onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder:text-gray-500"
                  placeholder="Jl. Kalimantan no. 21, Kartoharjo&#10;Kec. Kartoharjo, Kota Madiun"
                />
                <p className="text-xs text-gray-500 mt-1">Tampil di struk. Gunakan &lt;br&gt; untuk baris baru.</p>
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
                  Nomor Telepon (phone_number)
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
                  Kontak di header struk (<strong className="font-semibold">{'{{contactPhone}}'}</strong>)
                </label>
                <input
                  type="text"
                  value={settings.contact_phone || ''}
                  onChange={(e) => setSettings({ ...settings, contact_phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder:text-gray-500"
                  placeholder="silahkan hubungi: 0813-9888-8568"
                />
                <p className="text-xs text-gray-500 mt-1">Teks di bagian atas struk (<strong className="font-semibold">{'{{contactPhone}}'}</strong>).</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Kontak Partnership (partnership_contact)
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
              Logo (<strong className="font-semibold">{'{{logo}}'}</strong> di template)
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Upload logo / Gambar picker
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                />
                <p className="text-xs text-gray-500 mt-1">Tampil di struk sebagai <strong className="font-semibold">{'{{logo}}'}</strong>. PNG/JPG disarankan.</p>
                {settings.logo_base64 && (
                  <div className="mt-4">
                    <p className="text-sm text-gray-600 mb-2">Preview:</p>
                    <img
                      src={settings.logo_base64}
                      alt="Logo preview"
                      className="max-h-32 border border-gray-300 rounded"
                    />
                    <button
                      type="button"
                      onClick={() => setSettings({ ...settings, logo_base64: '' })}
                      className="mt-2 px-3 py-1.5 text-sm text-red-700 border border-red-300 rounded-md hover:bg-red-50"
                    >
                      Hapus logo
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Teks Footer (<strong className="font-semibold">{'{{footerText}}'}</strong>)</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Teks footer struk
              </label>
              <textarea
                value={settings.footer_text || ''}
                onChange={(e) => setSettings({ ...settings, footer_text: e.target.value })}
                rows={5}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm text-gray-900 placeholder:text-gray-500"
                placeholder="Pendapat Anda sangat penting bagi kami.&#10;Untuk kritik dan saran silahkan hubungi :&#10;0812-1822-2666"
              />
              <p className="text-xs text-gray-500 mt-1">Tampil di bawah struk (rata kiri-kanan). Gunakan <strong className="font-semibold">{'<br>'}</strong> untuk baris baru, <strong className="font-semibold">{'<p>...</p>'}</strong> untuk paragraf.</p>
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
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-lg font-semibold text-gray-900">Pilih Template Struk (Receipt)</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDownloadAllReceiptFromVps}
                  disabled={saving || editModalLoading || loading || availableTemplates.receipt.length === 0 || downloadingAllReceipt}
                  className="px-4 py-2 border border-green-200 bg-white text-green-700 rounded-md hover:bg-green-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {downloadingAllReceipt ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CloudDownload className="w-4 h-4" />
                  )}
                  Download dari VPS
                </button>
                <button
                  type="button"
                  onClick={() => openCreateTemplate('receipt')}
                  disabled={saving || editModalLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Buat template baru
                </button>
                <button
                  onClick={handleTestPrint.bind(null, 'receipt')}
                  disabled={saving || !selectedReceiptTemplate}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Printer className="w-4 h-4" />
                  Test Print
                </button>
              </div>
            </div>
            {loading ? (
              <div className="text-center py-8 text-gray-500">Memuat template...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {availableTemplates.receipt.map((template) => (
                  <div
                    key={template.id}
                    className={`p-4 border-2 rounded-lg transition-all ${
                      selectedReceiptTemplateId === template.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <button
                      onClick={() => handleSelectTemplate('receipt', template.name, template.id)}
                      disabled={saving}
                      className="w-full text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-gray-900">{template.name}</span>
                        {template.is_default && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Default</span>
                        )}
                      </div>
                      {selectedReceiptTemplateId === template.id && (
                        <div className="text-sm text-blue-600 mt-2">✓ Dipilih</div>
                      )}
                    </button>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleEditTemplate('receipt', template)}
                        disabled={saving || editModalLoading || (syncingCard?.id === template.id)}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-100 text-gray-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Pencil className="w-4 h-4 shrink-0" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplikatEdit('receipt', template)}
                        disabled={saving || editModalLoading || (syncingCard?.id === template.id)}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-100 text-gray-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Copy className="w-4 h-4 shrink-0" />
                        Duplikat
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUploadTemplate(template.id)}
                        disabled={saving || editModalLoading || (syncingCard?.id === template.id)}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-blue-200 rounded-md hover:bg-blue-50 text-blue-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {syncingCard?.id === template.id && syncingCard?.direction === 'upload' ? (
                          <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                        ) : (
                          <CloudUpload className="w-4 h-4 shrink-0" />
                        )}
                        Upload
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadTemplate(template.id)}
                        disabled={saving || editModalLoading || (syncingCard?.id === template.id)}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-green-200 rounded-md hover:bg-green-50 text-green-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {syncingCard?.id === template.id && syncingCard?.direction === 'download' ? (
                          <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                        ) : (
                          <CloudDownload className="w-4 h-4 shrink-0" />
                        )}
                        Download
                      </button>
                    </div>
                    {cardSyncResults[template.id] && (
                      <div
                        className={`mt-2 text-xs px-2 py-1.5 rounded ${
                          cardSyncResults[template.id]?.type === 'success'
                            ? 'bg-green-100 text-green-800'
                            : cardSyncResults[template.id]?.type === 'skip'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {cardSyncResults[template.id]?.type === 'success' && '✓ '}
                        {cardSyncResults[template.id]?.type === 'skip' && '⚠ '}
                        {cardSyncResults[template.id]?.type === 'error' && '✕ '}
                        {cardSyncResults[template.id]?.message}
                      </div>
                    )}
                  </div>
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
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-lg font-semibold text-gray-900">Pilih Template Bill</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => openCreateTemplate('bill')}
                  disabled={saving || editModalLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Buat template baru
                </button>
                <button
                  onClick={handleTestPrint.bind(null, 'bill')}
                  disabled={saving || !selectedBillTemplate}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Printer className="w-4 h-4" />
                  Test Print
                </button>
              </div>
            </div>
            {loading ? (
              <div className="text-center py-8 text-gray-500">Memuat template...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {availableTemplates.bill.map((template) => (
                  <div
                    key={template.id}
                    className={`p-4 border-2 rounded-lg transition-all ${
                      selectedBillTemplateId === template.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <button
                      onClick={() => handleSelectTemplate('bill', template.name, template.id)}
                      disabled={saving}
                      className="w-full text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-gray-900">{template.name}</span>
                        {template.is_default && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Default</span>
                        )}
                      </div>
                      {selectedBillTemplateId === template.id && (
                        <div className="text-sm text-blue-600 mt-2">✓ Dipilih</div>
                      )}
                    </button>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleEditTemplate('bill', template)}
                        disabled={saving || editModalLoading || (syncingCard?.id === template.id)}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-100 text-gray-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Pencil className="w-4 h-4 shrink-0" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplikatEdit('bill', template)}
                        disabled={saving || editModalLoading || (syncingCard?.id === template.id)}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-100 text-gray-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Copy className="w-4 h-4 shrink-0" />
                        Duplikat
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUploadTemplate(template.id)}
                        disabled={saving || editModalLoading || (syncingCard?.id === template.id)}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-blue-200 rounded-md hover:bg-blue-50 text-blue-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {syncingCard?.id === template.id && syncingCard?.direction === 'upload' ? (
                          <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                        ) : (
                          <CloudUpload className="w-4 h-4 shrink-0" />
                        )}
                        Upload
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadTemplate(template.id)}
                        disabled={saving || editModalLoading || (syncingCard?.id === template.id)}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-green-200 rounded-md hover:bg-green-50 text-green-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {syncingCard?.id === template.id && syncingCard?.direction === 'download' ? (
                          <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                        ) : (
                          <CloudDownload className="w-4 h-4 shrink-0" />
                        )}
                        Download
                      </button>
                    </div>
                    {cardSyncResults[template.id] && (
                      <div
                        className={`mt-2 text-xs px-2 py-1.5 rounded ${
                          cardSyncResults[template.id]?.type === 'success'
                            ? 'bg-green-100 text-green-800'
                            : cardSyncResults[template.id]?.type === 'skip'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {cardSyncResults[template.id]?.type === 'success' && '✓ '}
                        {cardSyncResults[template.id]?.type === 'skip' && '⚠ '}
                        {cardSyncResults[template.id]?.type === 'error' && '✕ '}
                        {cardSyncResults[template.id]?.message}
                      </div>
                    )}
                  </div>
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

      {/* Template Label/Checker Tab (label/checker – same template logic as struk) */}
      {activeTab === 'checker' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-lg font-semibold text-gray-900">Template Label/Checker (Label Pesanan)</h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => openCreateTemplate('checker')}
                  disabled={saving || editModalLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Buat template baru
                </button>
                <button
                  onClick={handleTestPrint.bind(null, 'checker')}
                  disabled={saving || !selectedCheckerTemplate}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Printer className="w-4 h-4" />
                  Test Print
                </button>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Template ini dipakai untuk label/checker yang dicetak saat transaksi atau saat menambah item di Active Order (Lihat). Placeholder: <code className="bg-gray-100 px-1 rounded">{'{{counter}}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{{itemNumber}}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{{totalItems}}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{{pickupMethod}}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{{productName}}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{{customizations}}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{{orderTime}}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{{labelContinuation}}'}</code>.
            </p>
            {loading ? (
              <div className="text-center py-8 text-gray-500">Memuat template...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {availableTemplates.checker.map((template) => (
                  <div
                    key={template.id}
                    className={`p-4 border-2 rounded-lg transition-all ${
                      selectedCheckerTemplateId === template.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <button
                      onClick={() => handleSelectTemplate('checker', template.name, template.id)}
                      disabled={saving}
                      className="w-full text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-gray-900">{template.name}</span>
                        {template.is_default && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Default</span>
                        )}
                      </div>
                      {selectedCheckerTemplateId === template.id && (
                        <div className="text-sm text-blue-600 mt-2">✓ Dipilih</div>
                      )}
                    </button>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleEditTemplate('checker', template)}
                        disabled={saving || editModalLoading || (syncingCard?.id === template.id)}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-100 text-gray-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Pencil className="w-4 h-4 shrink-0" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplikatEdit('checker', template)}
                        disabled={saving || editModalLoading || (syncingCard?.id === template.id)}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-100 text-gray-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Copy className="w-4 h-4 shrink-0" />
                        Duplikat
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUploadTemplate(template.id)}
                        disabled={saving || editModalLoading || (syncingCard?.id === template.id)}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-blue-200 rounded-md hover:bg-blue-50 text-blue-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {syncingCard?.id === template.id && syncingCard?.direction === 'upload' ? (
                          <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                        ) : (
                          <CloudUpload className="w-4 h-4 shrink-0" />
                        )}
                        Upload
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadTemplate(template.id)}
                        disabled={saving || editModalLoading || (syncingCard?.id === template.id)}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-green-200 rounded-md hover:bg-green-50 text-green-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {syncingCard?.id === template.id && syncingCard?.direction === 'download' ? (
                          <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                        ) : (
                          <CloudDownload className="w-4 h-4 shrink-0" />
                        )}
                        Download
                      </button>
                    </div>
                    {cardSyncResults[template.id] && (
                      <div
                        className={`mt-2 text-xs px-2 py-1.5 rounded ${
                          cardSyncResults[template.id]?.type === 'success'
                            ? 'bg-green-100 text-green-800'
                            : cardSyncResults[template.id]?.type === 'skip'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {cardSyncResults[template.id]?.type === 'success' && '✓ '}
                        {cardSyncResults[template.id]?.type === 'skip' && '⚠ '}
                        {cardSyncResults[template.id]?.type === 'error' && '✕ '}
                        {cardSyncResults[template.id]?.message}
                      </div>
                    )}
                  </div>
                ))}
                {availableTemplates.checker.length === 0 && (
                  <div className="col-span-full text-center py-8 text-gray-500">
                    Belum ada template label/checker. Klik &quot;Buat template baru&quot; untuk membuat template label.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit / Duplicate Template Modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {editModal.mode === 'create'
                  ? `Buat template baru — ${editModal.type === 'receipt' ? 'Template Struk' : editModal.type === 'bill' ? 'Template Bill' : 'Template Label/Checker'}`
                  : editModal.mode === 'edit'
                    ? `Edit — ${editModal.templateName}`
                    : `Duplikat & Edit — ${editModal.type === 'receipt' ? 'Template Struk' : editModal.type === 'bill' ? 'Template Bill' : 'Template Label/Checker'}`}
              </h3>
              <button
                type="button"
                onClick={handleCloseEditModal}
                className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
                aria-label="Tutup"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
              {editModal.mode === 'duplicate' && (
                <p className="text-sm text-gray-600">
                  Salinan dari <strong>{editModal.templateName}</strong>. Edit kode HTML di bawah, beri nama baru, lalu simpan.
                </p>
              )}
              {editModal.mode === 'create' && (
                <p className="text-sm text-gray-600">
                  Buat template baru. Isi nama, edit kode HTML di bawah, lalu simpan.
                </p>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {editModal.mode === 'edit' ? 'Nama template' : 'Nama template baru'}
                </label>
                <input
                  type="text"
                  value={editModal.newName}
                  onChange={(e) => setEditModal(prev => prev ? { ...prev, newName: e.target.value } : null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  placeholder={editModal.mode === 'edit' ? 'Nama template' : 'Contoh: Struk Custom Toko A'}
                />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Kode HTML template</label>
                  <textarea
                    value={editModal.code}
                    onChange={(e) => setEditModal(prev => prev ? { ...prev, code: e.target.value } : null)}
                    rows={18}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm text-gray-900"
                    placeholder="HTML dengan placeholder {{...}}"
                    spellCheck={false}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Placeholder: {'{{businessName}}'}, {'{{address}}'}, {'{{contactPhone}}'}, {'{{logo}}'}, {'{{footerText}}'}, {'{{items}}'}, {'{{total}}'}, dll.
                  </p>
                </div>
                <div className="flex flex-col">
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                    <Eye className="w-4 h-4" />
                    Preview
                  </label>
                  <div className="flex-1 min-h-[280px] max-h-[480px] border border-gray-300 rounded-md bg-gray-50 overflow-auto p-2 flex justify-center">
                    <iframe
                      title="Receipt preview"
                      srcDoc={(() => {
                        try {
                          const raw = renderReceiptPreview(editModal.code || '', editModal.type);
                          if (!raw || !raw.trim()) return '<!DOCTYPE html><html><body><p class="text-gray-500 text-sm">Edit template untuk melihat preview.</p></body></html>';
                          return raw;
                        } catch {
                          return '<!DOCTYPE html><html><body><p class="text-red-600 text-sm">Error rendering preview.</p></body></html>';
                        }
                      })()}
                      className={`border-0 bg-white min-h-[260px] ${editModal.type === 'checker' ? 'w-[160px] max-w-[160px]' : 'w-full max-w-[320px]'}`}
                      style={{ minHeight: editModal.type === 'checker' ? '240px' : '360px' }}
                      sandbox="allow-same-origin"
                    />
                  </div>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editModal.showNotes}
                  onChange={(e) => setEditModal(prev => prev ? { ...prev, showNotes: e.target.checked } : null)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Tampilkan catatan/kustomisasi di struk/bill</span>
              </label>
              {editModal.type === 'checker' && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editModal.oneLabelPerProduct}
                    onChange={(e) => setEditModal(prev => prev ? { ...prev, oneLabelPerProduct: e.target.checked } : null)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">1 Label for each product</span>
                </label>
              )}
              {editModal.type === 'checker' && (
                <p className="text-xs text-gray-500 ml-6 -mt-1">Centang = satu label per porsi; tidak centang = satu slip gabungan pesanan (semua item dalam satu cetakan).</p>
              )}
              {editModal.mode === 'edit' && !editModal.isDefault && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Template ini <strong>bukan default</strong>. Cetak struk/bill menggunakan template default. Agar pengaturan &quot;Tampilkan catatan&quot; berlaku di cetakan, jadikan template ini sebagai default (pilih di daftar) atau edit template default.
                </p>
              )}
              {(editModal.mode === 'duplicate' || editModal.mode === 'create') && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editModal.setAsDefault}
                    onChange={(e) => setEditModal(prev => prev ? { ...prev, setAsDefault: e.target.checked } : null)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Jadikan default setelah disimpan</span>
                </label>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <button
                type="button"
                onClick={handleCloseEditModal}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-100"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveTemplate}
                disabled={saving || !editModal.newName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Menyimpan...' : editModal.mode === 'edit' ? 'Simpan' : editModal.mode === 'create' ? 'Buat template' : 'Simpan sebagai template baru'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
