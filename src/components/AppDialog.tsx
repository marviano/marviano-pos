'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ─── Types ───────────────────────────────────────────────────────────────────

type DialogType = 'alert' | 'confirm';

interface DialogEntry {
    id: number;
    type: DialogType;
    message: string;
    resolve: (value: boolean) => void;
}

interface AppDialogContextValue {
    showAlert: (message: string) => Promise<void>;
    showConfirm: (message: string) => Promise<boolean>;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AppDialogContext = createContext<AppDialogContextValue | null>(null);

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAppDialog(): AppDialogContextValue {
    const ctx = useContext(AppDialogContext);
    if (!ctx) {
        // Fallback to native dialogs when used outside provider (e.g. during SSR)
        return {
            showAlert: async (message: string) => { window.alert(message); },
            showConfirm: async (message: string) => window.confirm(message),
        };
    }
    return ctx;
}

// ─── Standalone helper (for use outside React components) ────────────────────

let _globalDialogFns: AppDialogContextValue | null = null;

export function setGlobalDialogFns(fns: AppDialogContextValue) {
    _globalDialogFns = fns;
}

export function appAlert(message: string): Promise<void> {
    if (_globalDialogFns) return _globalDialogFns.showAlert(message);
    window.alert(message);
    return Promise.resolve();
}

export function appConfirm(message: string): Promise<boolean> {
    if (_globalDialogFns) return _globalDialogFns.showConfirm(message);
    return Promise.resolve(window.confirm(message));
}

// ─── Single dialog renderer ─────────────────────────────────────────────────

function DialogModal({ entry, onDismiss }: { entry: DialogEntry; onDismiss: (id: number, result: boolean) => void }) {
    const okRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        // Auto-focus OK button when dialog mounts
        const timer = setTimeout(() => okRef.current?.focus(), 50);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onDismiss(entry.id, false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [entry.id, onDismiss]);

    // Split message on \n for multi-line display
    const lines = entry.message.split('\n');

    return (
        <div
            className="fixed inset-0 z-[99999] flex items-center justify-center"
            style={{ fontFamily: 'Tahoma, "MS Sans Serif", sans-serif' }}
        >
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/40"
                onClick={() => onDismiss(entry.id, false)}
            />

            {/* Dialog box */}
            <div
                className="relative bg-white rounded-lg shadow-2xl max-w-[420px] w-[90%] overflow-hidden"
                style={{
                    border: '1px solid #c0c0c0',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.15)',
                }}
            >
                {/* Header */}
                <div
                    className="px-4 py-2.5 flex items-center"
                    style={{
                        background: 'linear-gradient(to bottom, #3a6ea5 0%, #245edb 50%, #1e4a8f 100%)',
                    }}
                >
                    <span
                        className="text-white text-xs font-bold"
                        style={{ textShadow: '0 1px 1px rgba(0,0,0,0.5)' }}
                    >
                        {entry.type === 'confirm' ? 'Konfirmasi' : 'Informasi'}
                    </span>
                </div>

                {/* Body */}
                <div className="px-5 py-4">
                    <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
                        {lines.map((line, i) => (
                            <React.Fragment key={i}>
                                {line}
                                {i < lines.length - 1 && <br />}
                            </React.Fragment>
                        ))}
                    </div>
                </div>

                {/* Footer / Buttons */}
                <div className="px-5 pb-4 flex justify-end gap-2">
                    {entry.type === 'confirm' && (
                        <button
                            type="button"
                            onClick={() => onDismiss(entry.id, false)}
                            className="px-5 py-1.5 text-xs font-semibold rounded transition-colors text-gray-900"
                            style={{
                                background: 'linear-gradient(to bottom, #ece9d8 0%, #d4d0c8 100%)',
                                border: '1px solid #808080',
                                borderTopColor: '#ffffff',
                                borderLeftColor: '#ffffff',
                                borderRightColor: '#404040',
                                borderBottomColor: '#404040',
                                minWidth: '75px',
                                color: '#000',
                            }}
                        >
                            Batal
                        </button>
                    )}
                    <button
                        ref={okRef}
                        type="button"
                        onClick={() => onDismiss(entry.id, true)}
                        className="px-5 py-1.5 text-xs font-semibold text-white rounded transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
                        style={{
                            background: 'linear-gradient(to bottom, #3a6ea5 0%, #245edb 100%)',
                            border: '1px solid #1e4a8f',
                            minWidth: '75px',
                        }}
                    >
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Provider ────────────────────────────────────────────────────────────────

let nextId = 1;

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
    const [dialogs, setDialogs] = useState<DialogEntry[]>([]);
    const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

    useEffect(() => {
        setPortalRoot(document.body);
    }, []);

    const showAlert = useCallback((message: string): Promise<void> => {
        return new Promise<void>((resolve) => {
            const id = nextId++;
            setDialogs((prev) => [
                ...prev,
                { id, type: 'alert', message, resolve: () => resolve() },
            ]);
        });
    }, []);

    const showConfirm = useCallback((message: string): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
            const id = nextId++;
            setDialogs((prev) => [
                ...prev,
                { id, type: 'confirm', message, resolve },
            ]);
        });
    }, []);

    const handleDismiss = useCallback((id: number, result: boolean) => {
        setDialogs((prev) => {
            const entry = prev.find((d) => d.id === id);
            if (entry) {
                // Resolve on next tick to avoid state-update-during-render
                setTimeout(() => entry.resolve(result), 0);
            }
            return prev.filter((d) => d.id !== id);
        });
    }, []);

    // Register global functions so non-component code can use appAlert/appConfirm
    useEffect(() => {
        setGlobalDialogFns({ showAlert, showConfirm });
        return () => { _globalDialogFns = null; };
    }, [showAlert, showConfirm]);

    const contextValue: AppDialogContextValue = React.useMemo(
        () => ({ showAlert, showConfirm }),
        [showAlert, showConfirm]
    );

    // Only render the top-most dialog (queue behaviour)
    const activeDialog = dialogs[0] ?? null;

    return (
        <AppDialogContext.Provider value={contextValue}>
            {children}
            {portalRoot && activeDialog && createPortal(
                <DialogModal
                    key={activeDialog.id}
                    entry={activeDialog}
                    onDismiss={handleDismiss}
                />,
                portalRoot,
            )}
        </AppDialogContext.Provider>
    );
}
