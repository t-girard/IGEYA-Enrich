import type { Fiche, ImportRow, MapKey, MatchScore } from './types';
import { lev, norm } from './text';

export function normCp(v: unknown): string {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 4) d = '0' + d; // Excel supprime le zéro initial des codes postaux
  return d.slice(0, 5);
}

interface Candidate {
  nom: string;
  prenom: string;
  cp: string;
}

/**
 * Score de rapprochement sur 100 : nom (40) + prénom (35) + code postal (25).
 * Un nom sans aucune ressemblance exclut la fiche. Les fautes de frappe et les initiales sont tolérées.
 */
export function scoreMatch(r: Candidate, f: Fiche): MatchScore {
  const n1 = norm(r.nom), n2 = norm(f.nom), p1 = norm(r.prenom), p2 = norm(f.prenom);
  let sN = 0, sP = 0, sC = 0;
  let tN = 'différent', tP = 'différent', tC = 'différent';
  if (n1 && n1 === n2) { sN = 40; tN = 'identique'; }
  else if (n1 && n2 && Math.min(n1.length, n2.length) > 3 && lev(n1, n2) <= 1) { sN = 26; tN = 'proche'; }
  if (!sN) return { score: 0, tN, tP, tC };
  if (p1 && p1 === p2) { sP = 35; tP = 'identique'; }
  else if (p1 && p2 && p1[0] === p2[0] && (p1.length === 1 || p2.length === 1)) { sP = 20; tP = 'initiale'; }
  else if (p1 && p2 && Math.min(p1.length, p2.length) > 3 && lev(p1, p2) <= 1) { sP = 22; tP = 'proche'; }
  if (r.cp && r.cp === f.cp) { sC = 25; tC = 'identique'; }
  else if (r.cp && r.cp.slice(0, 2) === f.cp.slice(0, 2)) { sC = 10; tC = 'même département'; }
  return { score: sN + sP + sC, tN, tP, tC };
}

export type ColumnMap = Record<MapKey, string>;

/** Rapproche chaque ligne du fichier d'une fiche existante. Les lignes répétées dans le fichier sont fusionnées. */
export function matchRows(rows: string[][], map: ColumnMap, fiches: Fiche[]): ImportRow[] {
  const out: ImportRow[] = [];
  const seen: Record<string, ImportRow> = {};
  const cell = (r: string[], k: MapKey) => {
    const i = map[k];
    return i === '' || i == null ? '' : String(r[Number(i)] ?? '').trim();
  };
  rows.forEach((r, i) => {
    const row: ImportRow = { line: i + 2, nom: cell(r, 'nom'), prenom: cell(r, 'prenom'), cp: normCp(cell(r, 'cp')), tel: cell(r, 'tel'), email: cell(r, 'email'), status: 'aucune' };
    if (!row.nom && !row.prenom) return;
    const key = norm(row.nom) + '|' + norm(row.prenom) + '|' + row.cp;
    const first = seen[key];
    if (first) {
      if (!first.tel && row.tel) first.tel = row.tel;
      if (!first.email && row.email) first.email = row.email;
      row.status = 'doublon';
      row.dupOf = first.line;
      out.push(row);
      return;
    }
    seen[key] = row;
    const cands: { f: Fiche; m: MatchScore }[] = [];
    fiches.forEach((f) => {
      const m = scoreMatch(row, f);
      if (m.score >= 60) cands.push({ f, m });
    });
    cands.sort((a, b) => b.m.score - a.m.score);
    if (!cands.length) {
      row.status = 'aucune';
      out.push(row);
      return;
    }
    const best = cands[0];
    row.best = { ficheId: best.f.id, m: best.m };
    row.ambiguous = cands.length > 1 && cands[1].m.score >= best.m.score - 5 && cands[1].f.id !== best.f.id;
    row.status = best.m.score >= 90 && !row.ambiguous ? 'certain' : 'incertain';
    out.push(row);
  });
  return out;
}
