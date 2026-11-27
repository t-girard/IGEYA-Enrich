export interface TelResult {
  ok: boolean;
  value?: string;
  kind?: 'Mobile' | 'Fixe';
  changed?: boolean;
  note?: string;
  empty?: boolean;
  reason?: string;
}

export interface EmailResult {
  ok: boolean;
  value?: string;
  empty?: boolean;
  reason?: string;
}

/** Format unique de stockage et de diffusion : +33 X XX XX XX XX. `n9` = les 9 chiffres sans le 0 initial. */
export function groupTel(n9: string): string {
  return `+33 ${n9[0]} ${n9.slice(1, 3)} ${n9.slice(3, 5)} ${n9.slice(5, 7)} ${n9.slice(7, 9)}`;
}

/** Reconnaît les formats courants (points, tirets, +33, 0033, zéro manquant) et les ramène au format unique. */
export function normTel(raw: unknown): TelResult {
  let s = String(raw ?? '').trim();
  if (!s) return { ok: false, empty: true, reason: 'Valeur vide' };
  s = s.replace(/\(0\)/g, '');
  let d = s.replace(/[^\d+]/g, '');
  d = d.startsWith('+') ? '+' + d.slice(1).replace(/\+/g, '') : d.replace(/\+/g, '');
  let n: string;
  let note = '';
  if (/^\+33/.test(d)) n = d.slice(3);
  else if (/^0033/.test(d)) n = d.slice(4);
  else if (/^33\d{9}$/.test(d)) n = d.slice(2);
  else if (/^0\d{9}$/.test(d)) n = d.slice(1);
  else if (/^[1-9]\d{8}$/.test(d)) {
    n = d;
    note = 'Zéro initial manquant (export Excel), rétabli';
  } else {
    return { ok: false, reason: /^\+(?!33)/.test(d) ? 'Numéro hors France non géré' : 'Numéro incomplet ou format non reconnu' };
  }
  n = n.replace(/^0/, '');
  if (!/^[1-9]\d{8}$/.test(n)) return { ok: false, reason: 'Numéro incomplet ou trop long' };
  if (n[0] === '8') return { ok: false, reason: 'Numéro spécial (08) non retenu' };
  const value = groupTel(n);
  return { ok: true, value, kind: /^[67]/.test(n) ? 'Mobile' : 'Fixe', changed: s !== value, note };
}

export function normEmail(raw: unknown): EmailResult {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return { ok: false, empty: true, reason: 'Valeur vide' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return { ok: false, reason: 'Adresse e-mail mal formée' };
  return { ok: true, value: s };
}

/** Code postal sur 5 chiffres : Excel supprime le zéro initial (« 5011 » → « 05011 »). */
export function normCp(v: unknown): string {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 4) d = '0' + d;
  return d.slice(0, 5);
}
