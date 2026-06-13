/** DB/storage format: HH:mm */
export function normalizeJamDb(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) {
    const h = String(v.getHours()).padStart(2, '0');
    const m = String(v.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  const s = String(v).trim();
  if (!s) return '';
  if (/^\d{1,2}[.:]\d{2}$/.test(s)) {
    const [h, m] = s.split(/[.:]/);
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  }
  if (/^\d{3,4}$/.test(s)) {
    const padded = s.padStart(4, '0');
    return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;
  }
  if (s.length >= 5 && /^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
  const d = new Date(`1970-01-01T${s}`);
  if (!Number.isNaN(d.getTime())) {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  return '';
}

/** UI format: HH.mm */
export function jamToDisplay(jamDb: string): string {
  const norm = normalizeJamDb(jamDb);
  if (!norm) return '';
  return norm.replace(':', '.');
}

/** Parse typed UI input (19.30, 19:30, 1930) to HH:mm for DB. Returns null if invalid. */
export function parseJamDotInput(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const norm = normalizeJamDb(raw);
  if (!norm || !/^\d{2}:\d{2}$/.test(norm)) return null;
  const [h, m] = norm.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return norm;
}

/** Restrict live typing to digits and one separator (. or :) */
export function sanitizeJamDotTyping(raw: string): string {
  let out = '';
  let sepUsed = false;
  for (const ch of raw) {
    if (/\d/.test(ch)) {
      if (out.replace(/\D/g, '').length >= 4) continue;
      out += ch;
    } else if ((ch === '.' || ch === ':') && !sepUsed && out.length > 0) {
      out += '.';
      sepUsed = true;
    }
  }
  return out;
}
