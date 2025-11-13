'use client';

/**
 * Utility helpers for caching login emails locally.
 *
 * Note: This cache is intentionally client-side only.
 * If we ever switch this to SQLite, keep it local-only
 * and do not replicate to the VPS database.
 */

const STORAGE_KEY = 'marviano_saved_login_emails';
const MAX_ITEMS = 10;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readRawList(): string[] {
  if (!isBrowser()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === 'string');
  } catch (error) {
    console.warn('[savedLoginEmails] Failed to read saved emails:', error);
    return [];
  }
}

function writeRawList(emails: string[]) {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(emails));
  } catch (error) {
    console.warn('[savedLoginEmails] Failed to write saved emails:', error);
  }
}

export function getSavedEmails(): string[] {
  return readRawList();
}

export function getMostRecentEmail(): string | undefined {
  const emails = readRawList();
  return emails[0];
}

export function addSavedEmail(email: string) {
  const trimmed = email.trim();
  if (!trimmed) {
    return;
  }

  const normalized = trimmed.toLowerCase();
  const emails = readRawList();

  const deduped = emails.filter(item => item.toLowerCase() !== normalized);
  deduped.unshift(trimmed);

  if (deduped.length > MAX_ITEMS) {
    deduped.length = MAX_ITEMS;
  }

  writeRawList(deduped);
}

export function removeSavedEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const emails = readRawList();
  const filtered = emails.filter(item => item.toLowerCase() !== normalized);
  writeRawList(filtered);
}



