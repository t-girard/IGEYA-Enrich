import { norm } from './text';
import type { ColumnMap, MapKey } from './types';

function detectDelim(line: string): string {
  let best = ';';
  let bc = -1;
  for (const d of [';', ',', '\t']) {
    const c = line.split(d).length;
    if (c > bc) {
      bc = c;
      best = d;
    }
  }
  return best;
}

/** Lecteur CSV : séparateur détecté (; , tabulation), guillemets, retours à la ligne, BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const d = detectDelim(text.split(/\r?\n/)[0] || '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** UTF-8 si possible, sinon Windows-1252 (export Excel français). */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(buf);
    } catch {
      return new TextDecoder().decode(buf);
    }
  }
}

const SYN: Record<MapKey, string[]> = {
  nom: ['nom', 'nom de famille', 'nom usuel', 'last name', 'lastname', 'name', 'nom exercice'],
  prenom: ['prenom', 'first name', 'firstname', 'prenom usuel', 'prenom exercice'],
  cp: ['code postal', 'cp', 'codepostal', 'postal', 'zip', 'code postal exercice'],
  tel: ['telephone', 'tel', 'phone', 'mobile', 'portable', 'telephone portable', 'numero de telephone'],
  email: ['email', 'e mail', 'mail', 'courriel', 'adresse mail', 'adresse email'],
};

/** Devine quelle colonne correspond à quel champ à partir des titres. */
export function guessMap(headers: string[]): ColumnMap {
  const map: ColumnMap = { nom: '', prenom: '', cp: '', tel: '', email: '' };
  const nh = headers.map(norm);
  (Object.keys(SYN) as MapKey[]).forEach((k) => {
    let i = nh.findIndex((h) => SYN[k].includes(h));
    if (i < 0) i = nh.findIndex((h) => SYN[k].some((s) => h.includes(s)));
    if (i >= 0 && (Object.keys(map) as MapKey[]).every((o) => map[o] !== String(i))) map[k] = String(i);
  });
  return map;
}

const toText = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toLocaleDateString('fr-FR');
  return String(v);
};

/** Lit un fichier CSV ou Excel (.xlsx) et renvoie ses lignes sous forme de texte. */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'xlsx') {
    // Chargé à la demande : la bibliothèque Excel n'alourdit pas le premier affichage.
    const { readSheet } = await import('read-excel-file/browser');
    const data = await readSheet(file);
    return data.map((r) => r.map(toText));
  }
  if (ext === 'xls') {
    throw new Error('Le format .xls n’est pas pris en charge. Enregistrez le fichier en .xlsx ou en CSV.');
  }
  if (['csv', 'tsv', 'txt'].includes(ext)) {
    return parseCsv(decodeText(await file.arrayBuffer()));
  }
  throw new Error('Format non pris en charge. Déposez un fichier .csv ou .xlsx.');
}
