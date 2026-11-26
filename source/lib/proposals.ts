import type { AddStatus, Fiche, Flag, Proposal, ProposalInput } from './types';
import { nowIso } from './text';
import { normEmail, normTel } from './phone';

/** Ce dont les fonctions ci-dessous ont besoin : un sous-ensemble de l'état de l'application. */
export interface ProposalState {
  fiches: Fiche[];
  props: Proposal[];
  seq: number;
}

/**
 * Transforme une valeur brute en proposition : normalisation, validation, fusion si la même valeur est
 * déjà proposée (les sources s'additionnent), abandon si la fiche contient déjà cette valeur.
 * Fonction conçue pour être appelée sur un brouillon immer.
 */
export function addProposal(state: ProposalState, o: ProposalInput): AddStatus {
  const f = state.fiches.find((x) => x.id === o.ficheId);
  if (!f || o.raw == null || String(o.raw).trim() === '') return 'vide';
  const field = o.field;
  let proposed: string;
  let valid: boolean;
  let reason = '';
  let fmtChanged = false;
  let kind = '';
  let note = '';
  if (field === 'tel') {
    const n = normTel(o.raw);
    valid = n.ok;
    reason = n.reason || '';
    proposed = n.ok ? (n.value as string) : String(o.raw).trim();
    fmtChanged = !!n.changed;
    kind = n.kind || '';
    note = n.note || '';
  } else {
    const e = normEmail(o.raw);
    valid = e.ok;
    reason = e.reason || '';
    proposed = e.ok ? (e.value as string) : String(o.raw).trim();
    fmtChanged = e.ok && e.value !== String(o.raw).trim();
  }
  if (valid && f[field].toLowerCase() === proposed.toLowerCase()) return 'same';
  const src = { label: o.source, url: o.url || '' };
  const ex = state.props.find((p) => p.status === 'pending' && p.ficheId === o.ficheId && p.field === field && p.proposed === proposed);
  if (ex) {
    if (!ex.sources.some((s) => s.label === src.label && s.url === src.url)) {
      ex.sources.push(src);
      ex.conf = Math.min(99, Math.max(ex.conf, o.conf) + 8);
    }
    return 'merged';
  }
  state.seq += 1;
  state.props.push({
    id: 'P' + String(state.seq).padStart(4, '0'),
    ficheId: o.ficheId, field, proposed, raw: String(o.raw).trim(), valid, reason, fmtChanged, kind, note,
    sources: [src], conf: Math.round(o.conf), matchScore: o.matchScore ?? null, ambiguous: !!o.ambiguous,
    origin: o.origin, status: 'pending', at: nowIso(), decidedAt: null,
  });
  return 'created';
}

/** Applique une proposition validée à la fiche : valeur, source, historique, et fiche marquée "à diffuser". */
export function applyProp(state: ProposalState, propId: string, by: string): boolean {
  const p = state.props.find((x) => x.id === propId);
  if (!p || p.status !== 'pending' || !p.valid) return false;
  const f = state.fiches.find((x) => x.id === p.ficheId);
  if (!f) return false;
  const at = nowIso();
  const old = f[p.field];
  const srcLabel = p.sources.map((s) => s.label).join(' + ');
  f[p.field] = p.proposed;
  const src = { source: srcLabel, at, url: p.sources[0].url || '' };
  if (p.field === 'tel') f.telSrc = src;
  else f.emailSrc = src;
  f.history.unshift({ at, field: p.field, from: old || '', to: p.proposed, source: srcLabel, by });
  f.push[p.field === 'tel' ? 'one' : 'out'] = 'todo';
  p.status = 'accepted';
  p.decidedAt = at;
  return true;
}

/* ---------- Contrôles affichés dans l'écran de validation ---------- */

export interface Ctx {
  idx: Map<string, Set<string>>;
  pendVal: Map<string, Set<string>>;
  byKey: Map<string, Proposal[]>;
}

export function buildCtx(fiches: Fiche[], props: Proposal[]): Ctx {
  const idx = new Map<string, Set<string>>();
  const pendVal = new Map<string, Set<string>>();
  const byKey = new Map<string, Proposal[]>();
  const add = (m: Map<string, Set<string>>, k: string, id: string) => {
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(id);
  };
  fiches.forEach((f) => {
    if (f.tel) add(idx, 'tel:' + f.tel, f.id);
    if (f.email) add(idx, 'email:' + f.email.toLowerCase(), f.id);
  });
  props.forEach((p) => {
    if (p.status !== 'pending') return;
    const k = p.ficheId + '|' + p.field;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(p);
    if (p.valid) add(pendVal, p.field + ':' + p.proposed.toLowerCase(), p.ficheId);
  });
  return { idx, pendVal, byKey };
}

const who = (f: Fiche) => `${f.prenom} ${f.nom.toUpperCase()} (${f.cp})`;

/** Liste des signalements d'une proposition : doublon, correspondance incertaine, remplacement, format corrigé, etc. */
export function flagsOf(p: Proposal, ctx: Ctx, fmap: Map<string, Fiche>): Flag[] {
  const fl: Flag[] = [];
  const f = fmap.get(p.ficheId);
  const key = p.field + ':' + p.proposed.toLowerCase();
  if (!p.valid) {
    fl.push({ k: 'invalide', t: 'Valeur invalide', d: p.reason || 'Format non reconnu', c: 'bad' });
  } else {
    const others = Array.from(ctx.idx.get(key) ?? []).filter((id) => id !== p.ficheId);
    const pendOthers = Array.from(ctx.pendVal.get(key) ?? []).filter((id) => id !== p.ficheId);
    if (others.length) {
      const o = fmap.get(others[0]);
      if (o) fl.push({ k: 'doublon', t: 'Doublon', d: 'Cette valeur est déjà sur la fiche ' + who(o), c: 'warn' });
    } else if (pendOthers.length) {
      const o = fmap.get(pendOthers[0]);
      if (o) fl.push({ k: 'doublon', t: 'Doublon', d: 'Cette valeur est aussi proposée pour ' + who(o), c: 'warn' });
    }
  }
  const unsure = p.matchScore != null ? p.matchScore < 90 || p.ambiguous : p.conf < 70;
  if (unsure) {
    fl.push({
      k: 'incertain', t: 'Correspondance incertaine', c: 'warn',
      d: p.matchScore != null ? `Rapprochement à ${p.matchScore} %${p.ambiguous ? ', plusieurs fiches possibles' : ''}` : `Confiance de la source : ${p.conf} %`,
    });
  }
  const grp = ctx.byKey.get(p.ficheId + '|' + p.field) ?? [];
  if (grp.some((o) => o.proposed !== p.proposed)) {
    fl.push({ k: 'divergence', t: 'Sources divergentes', d: 'Plusieurs valeurs différentes sont proposées pour ce champ', c: 'warn' });
  }
  if (p.valid && f) {
    if (f[p.field]) fl.push({ k: 'conflit', t: 'Remplace la valeur actuelle', d: 'La fiche contient déjà : ' + f[p.field], c: 'info' });
    else fl.push({ k: 'nouveau', t: 'Nouvelle donnée', d: 'Ce champ est vide sur la fiche', c: 'good' });
    if (p.fmtChanged) fl.push({ k: 'format', t: p.field === 'tel' ? 'Format uniformisé' : 'E-mail normalisé', d: 'Valeur brute : ' + p.raw, c: 'info' });
    if (p.note) fl.push({ k: 'format', t: 'Zéro rétabli', d: p.note, c: 'info' });
  }
  if (p.sources.length > 1) {
    fl.push({ k: 'multi', t: `Confirmé par ${p.sources.length} sources`, d: p.sources.map((s) => s.label).join(' · '), c: 'good' });
  }
  return fl;
}

/** "Fiable" = valide, sans doublon, sans doute sur la correspondance et sans remplacement : peut être validée en lot. */
export function isReliable(p: Proposal, fl: Flag[]): boolean {
  return p.status === 'pending' && p.valid && !fl.some((x) => ['doublon', 'incertain', 'divergence', 'conflit', 'invalide'].includes(x.k));
}
