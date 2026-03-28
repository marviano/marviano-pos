'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Fingerprint, CheckCircle, Loader2, Trash2, AlertTriangle } from 'lucide-react';

interface Employee {
  id: number;
  nama_karyawan: string;
  color?: string | null;
  jabatan_id?: number | null;
}

interface EnrollmentModalProps {
  enrolledByUserId: number;
  onClose: () => void;
}

type EnrollStep = 'select_employee' | 'select_finger' | 'scanning' | 'done' | 'error';

const FINGER_OPTIONS = [
  { index: 0, label: 'Telunjuk Kanan' },
  { index: 1, label: 'Telunjuk Kiri' },
  { index: 2, label: 'Ibu Jari Kanan' },
  { index: 3, label: 'Ibu Jari Kiri' },
  { index: 4, label: 'Jari Tengah Kanan' },
  { index: 5, label: 'Jari Tengah Kiri' },
];

export default function EnrollmentModal({ enrolledByUserId, onClose }: EnrollmentModalProps) {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;

  const [step, setStep]               = useState<EnrollStep>('select_employee');
  const [employees, setEmployees]     = useState<Employee[]>([]);
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [fingerIndex, setFingerIndex] = useState<number>(0);
  const [statusMsg, setStatusMsg]     = useState('');
  const [templates, setTemplates]     = useState<FingerprintTemplateRow[]>([]);
  const [search, setSearch]           = useState('');
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [fpImage, setFpImage]         = useState<string | null>(null);

  // Load employees
  useEffect(() => {
    api?.localDbGetEmployees?.().then((rows: unknown) => {
      setEmployees((rows as Employee[]) ?? []);
    });
  }, [api]);

  // Load templates when employee selected
  const loadTemplates = useCallback(async (empId: number) => {
    const res = await api?.absensiGetTemplatesByEmployee?.(empId);
    setTemplates((res?.data ?? []) as FingerprintTemplateRow[]);
  }, [api]);

  useEffect(() => {
    if (selectedEmp) loadTemplates(selectedEmp.id);
  }, [selectedEmp, loadTemplates]);

  // Register progress listener
  useEffect(() => {
    api?.onAbsensiEnrollProgress?.((event: AbsensiCaptureEvent) => {
      setStatusMsg(event.message);
      if (event.image) setFpImage(event.image);
    });
    return () => { api?.removeAbsensiListeners?.(); };
  }, [api]);

  const handleStartEnroll = useCallback(async () => {
    if (!selectedEmp || !api) return;
    setStep('scanning');
    setStatusMsg('Siapkan jari Anda…');
    setFpImage(null);

    try {
      // FlexCode SDK requires employeeId for internal secret key generation
      const res = await api.absensiStartEnroll?.(selectedEmp.id);
      if (!res?.success || !res.templateBase64) {
        throw new Error(res?.error ?? 'Enrollmen gagal');
      }

      // Save template to DB
      const saveRes = await api.absensiSaveTemplate?.({
        employee_id: selectedEmp.id,
        finger_index: fingerIndex,
        template_data: res.templateBase64,
        quality: res.quality,
        enrolled_by: enrolledByUserId,
      });

      if (!saveRes?.success) throw new Error(saveRes?.error ?? 'Gagal menyimpan template');

      setStatusMsg('Sidik jari berhasil direkam!');
      setStep('done');
      loadTemplates(selectedEmp.id);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
      setStep('error');
    } finally {
      api?.removeAbsensiListeners?.();
    }
  }, [api, selectedEmp, fingerIndex, enrolledByUserId, loadTemplates]);

  const handleDeleteTemplate = useCallback(async (id: number) => {
    await api?.absensiDeleteTemplate?.(id);
    setConfirmDelete(null);
    if (selectedEmp) loadTemplates(selectedEmp.id);
  }, [api, selectedEmp, loadTemplates]);

  const filteredEmps = employees.filter(e =>
    e.nama_karyawan.toLowerCase().includes(search.toLowerCase())
  );

  const FINGER_LABELS: Record<number, string> = Object.fromEntries(FINGER_OPTIONS.map(f => [f.index, f.label]));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-800">Enrollment Sidik Jari</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Step 1: Select employee */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">1. Pilih Karyawan</h3>
            <input
              type="text"
              placeholder="Cari nama karyawan…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {filteredEmps.length === 0 && (
                <p className="text-sm text-gray-400 px-3 py-2 text-center">Karyawan tidak ditemukan</p>
              )}
              {filteredEmps.map(emp => (
                <button
                  key={emp.id}
                  onClick={() => { setSelectedEmp(emp); setStep('select_finger'); }}
                  className={`w-full text-left px-3 py-2.5 text-sm transition-colors flex items-center gap-2
                    ${selectedEmp?.id === emp.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-gray-50 text-gray-700'}`}
                >
                  {emp.color && (
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: emp.color }} />
                  )}
                  {emp.nama_karyawan}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Select finger + existing templates */}
          {selectedEmp && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                2. Pilih Jari — <span className="text-blue-600">{selectedEmp.nama_karyawan}</span>
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {FINGER_OPTIONS.map(f => (
                  <button
                    key={f.index}
                    onClick={() => setFingerIndex(f.index)}
                    className={`px-2 py-2 text-xs rounded-lg border transition-colors
                      ${fingerIndex === f.index
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Existing templates for this employee */}
              {templates.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">Sidik jari terdaftar:</p>
                  <div className="space-y-1.5">
                    {templates.map(t => (
                      <div key={t.id} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                        <div className="text-xs text-gray-700">
                          <span className="font-medium">{FINGER_LABELS[t.finger_index] ?? `Jari ${t.finger_index}`}</span>
                          {t.quality != null && <span className="text-gray-400 ml-1">(kualitas: {t.quality})</span>}
                          <span className="text-gray-400 block">{new Date(t.enrolled_at).toLocaleDateString('id-ID')}</span>
                        </div>
                        {confirmDelete === t.id ? (
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleDeleteTemplate(t.id)}
                              className="text-xs bg-red-500 text-white px-2 py-1 rounded"
                            >Hapus</button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded"
                            >Batal</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(t.id)}
                            className="p-1 text-gray-400 hover:text-red-500 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Scan status & Image Preview */}
          {(step === 'scanning' || step === 'done' || step === 'error') && (
            <div className="space-y-4">
              {step === 'scanning' && fpImage && (
                <div className="flex justify-center">
                  <div className="bg-gray-100 border-2 border-dashed border-gray-300 rounded-xl p-2 w-48 h-60 flex items-center justify-center overflow-hidden shadow-inner">
                    <img 
                      src={fpImage} 
                      alt="Fingerprint Preview" 
                      className="max-w-full max-h-full object-contain mix-blend-multiply opacity-80"
                    />
                  </div>
                </div>
              )}
              
              <div className={`rounded-lg p-4 flex items-center gap-3
                ${step === 'done' ? 'bg-green-50 border border-green-200'
                  : step === 'error' ? 'bg-red-50 border border-red-200'
                  : 'bg-blue-50 border border-blue-200'}`}
              >
                {step === 'scanning' && <Loader2 className="w-6 h-6 text-blue-500 animate-spin flex-shrink-0" />}
                {step === 'done'     && <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0" />}
                {step === 'error'    && <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0" />}
                <p className={`text-sm font-medium
                  ${step === 'done' ? 'text-green-700' : step === 'error' ? 'text-red-700' : 'text-blue-700'}`}>
                  {statusMsg}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0 flex justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Tutup
          </button>
          <button
            onClick={step === 'done' || step === 'error' ? () => setStep('select_finger') : handleStartEnroll}
            disabled={!selectedEmp || step === 'scanning'}
            className={`flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg transition-colors
              ${!selectedEmp || step === 'scanning'
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'}`}
          >
            {step === 'scanning'
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning…</>
              : step === 'done' || step === 'error'
                ? <><Fingerprint className="w-4 h-4" /> Enroll Lagi</>
                : <><Fingerprint className="w-4 h-4" /> Mulai Scan</>}
          </button>
        </div>
      </div>
    </div>
  );
}
