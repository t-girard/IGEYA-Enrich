import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Decision, Fiche, FlagKind, ImportRow, MapKey, Origin, Proposal, RawResult, SyncLogItem, View } from './types';
import { nowIso, plural, sleep } from './text';
import { seedData, computeDups } from './seed';
import { guessMap, readSpreadsheet } from './csv';
import { matchRows, type ColumnMap } from './match';
import { CONNECTORS } from './connectors';
import { addProposal, applyProp, buildCtx, flagsOf, isReliable } from './proposals';
import { makeSample } from './sample';

export const CREDS = { email: 'demo@igeya.fr', pw: 'Igeya-2026' };
const STORE_KEY = 'igeya-enrich-next-demo-v1';

export interface Toast { id: number; msg: string; kind?: 'good' | 'bad' }
export interface Progress { done: number; total: number; created: number; merged: number; same: number; none: number; finished: boolean }
export interface BaseState { q: string; metier: string; cp: string; missing: '' | 'tel' | 'email' | 'any' | 'dup'; page: number; openId: string | null }
export interface ImportState { file: string; headers: string[]; rows: string[][]; map: ColumnMap; result: ImportRow[] | null; include: number[] }
export interface CtlState { tab: Decision; flag: '' | FlagKind; origin: '' | Origin; q: string; sel: string[] }

export interface AppState {
  user: { email: string } | null;
  view: View;
  confirmReset: boolean;
  fiches: Fiche[];
  props: Proposal[];
  syncLog: SyncLogItem[];
  seq: number;
  sel: string[];
  base: BaseState;
  imp: ImportState;
  conn: { selected: string[]; progress: Progress | null; log: string[]; running: boolean };
  ctl: CtlState;
  toasts: Toast[];

  login: (email: string) => void;
  logout: () => void;
  setView: (v: View) => void;
  toast: (msg: string, kind?: 'good' | 'bad') => void;
  requestReset: () => void;
  setBase: (patch: Partial<BaseState>) => void;
  openFiche: (id: string | null) => void;
  toggleSel: (id: string) => void;
  setSelMany: (ids: string[], on: boolean) => void;
  clearSel: () => void;
  enrichOne: (id: string) => void;
  setCtl: (patch: Partial<CtlState>) => void;
  goControl: () => void;
  goControlFiche: (id: string) => void;
  ctlToggle: (id: string) => void;
  ctlSetMany: (ids: string[], on: boolean) => void;
  accept: (id: string) => void;
  reject: (id: string) => void;
  requeue: (id: string) => void;
  bulkAccept: () => void;
  bulkReject: () => void;
  acceptReliable: () => void;
  loadFile: (file: File) => Promise<void>;
  loadSample: () => void;
  setImportData: (name: string, rows: string[][]) => void;
  setImpMap: (k: MapKey, v: string) => void;
  resetImport: () => void;
  runMatch: () => void;
  toggleInclude: (line: number) => void;
  sendToControl: () => void;
  toggleConnector: (id: string) => void;
  runEnrich: () => Promise<void>;
  pushDest: (key: 'one' | 'out') => void;
}

/* ---------- Persistance locale (navigateur) ---------- */
interface Persisted { v: 1; fiches: Fiche[]; props: Proposal[]; syncLog: SyncLogItem[]; seq: number }

function loadPersisted(): Persisted | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Persisted;
    return d && d.v === 1 && Array.isArray(d.fiches) && d.fiches.length ? d : null;
  } catch {
    return null;
  }
}

function savePersisted(s: AppState) {
  try {
    const data: Persisted = { v: 1, fiches: s.fiches, props: s.props, syncLog: s.syncLog, seq: s.seq };
    window.localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    /* stockage indisponible : la démo fonctionne quand même, sans mémoire entre deux visites */
  }
}

const emptyImport = (): ImportState => ({ file: '', headers: [], rows: [], map: { nom: '', prenom: '', cp: '', tel: '', email: '' }, result: null, include: [] });
const emptyBase = (): BaseState => ({ q: '', metier: '', cp: '', missing: '', page: 1, openId: null });
const emptyCtl = (): CtlState => ({ tab: 'pending', flag: '', origin: '', q: '', sel: [] });

let toastSeq = 0;

export const useStore = create<AppState>()(
  immer((set, get) => {
    const saved = loadPersisted();
    return {
      user: null,
      view: 'base',
      confirmReset: false,
      fiches: saved?.fiches ?? seedData(),
      props: saved?.props ?? [],
      syncLog: saved?.syncLog ?? [],
      seq: saved?.seq ?? 0,
      sel: [],
      base: emptyBase(),
      imp: emptyImport(),
      conn: { selected: ['extractor'], progress: null, log: [], running: false },
      ctl: emptyCtl(),
      toasts: [],

      login: (email) => set((d) => { d.user = { email }; d.view = 'base'; }),
      logout: () => set((d) => { d.user = null; d.base.openId = null; }),
      setView: (v) => set((d) => { d.view = v; d.base.openId = null; }),

      toast: (msg, kind) => {
        const id = ++toastSeq;
        set((d) => { d.toasts.push({ id, msg, kind }); });
        setTimeout(() => set((d) => { d.toasts = d.toasts.filter((t) => t.id !== id); }), 5200);
      },

      requestReset: () => {
        if (!get().confirmReset) {
          set((d) => { d.confirmReset = true; });
          setTimeout(() => set((d) => { d.confirmReset = false; }), 4000);
          return;
        }
        try { window.localStorage.removeItem(STORE_KEY); } catch { /* ignoré */ }
        set((d) => {
          d.fiches = seedData(); d.props = []; d.syncLog = []; d.seq = 0; d.sel = [];
          d.imp = emptyImport(); d.ctl = emptyCtl(); d.base = emptyBase();
          d.conn = { selected: ['extractor'], progress: null, log: [], running: false };
          d.confirmReset = false; d.view = 'base';
        });
        get().toast('Données de démonstration réinitialisées.', 'good');
      },

      setBase: (patch) => set((d) => { Object.assign(d.base, patch); }),
      openFiche: (id) => set((d) => { d.base.openId = id; }),

      toggleSel: (id) => set((d) => { d.sel = d.sel.includes(id) ? d.sel.filter((x) => x !== id) : [...d.sel, id]; }),
      setSelMany: (ids, on) => set((d) => {
        const s = new Set(d.sel);
        ids.slice(0, 300).forEach((id) => (on ? s.add(id) : s.delete(id)));
        d.sel = Array.from(s);
      }),
      clearSel: () => set((d) => { d.sel = []; }),
      enrichOne: (id) => set((d) => { d.sel = [id]; d.base.openId = null; d.view = 'connect'; }),

      setCtl: (patch) => set((d) => { Object.assign(d.ctl, patch); }),
      goControl: () => set((d) => { d.ctl = emptyCtl(); d.view = 'control'; }),
      goControlFiche: (id) => set((d) => {
        const f = d.fiches.find((x) => x.id === id);
        d.ctl = { ...emptyCtl(), q: f ? f.nom : '' };
        d.base.openId = null; d.view = 'control';
      }),
      ctlToggle: (id) => set((d) => { d.ctl.sel = d.ctl.sel.includes(id) ? d.ctl.sel.filter((x) => x !== id) : [...d.ctl.sel, id]; }),
      ctlSetMany: (ids, on) => set((d) => {
        const s = new Set(d.ctl.sel);
        ids.forEach((id) => (on ? s.add(id) : s.delete(id)));
        d.ctl.sel = Array.from(s);
      }),

      accept: (id) => {
        const s = get();
        const p = s.props.find((x) => x.id === id);
        const f = p && s.fiches.find((x) => x.id === p.ficheId);
        if (!p || !f || !p.valid) return;
        set((d) => { applyProp(d, id, d.user?.email ?? ''); d.ctl.sel = d.ctl.sel.filter((x) => x !== id); });
        get().toast(`Valeur appliquée à la fiche de ${f.prenom} ${f.nom}.`, 'good');
      },
      reject: (id) => set((d) => {
        const p = d.props.find((x) => x.id === id);
        if (p) { p.status = 'rejected'; p.decidedAt = nowIso(); }
        d.ctl.sel = d.ctl.sel.filter((x) => x !== id);
      }),
      requeue: (id) => set((d) => {
        const p = d.props.find((x) => x.id === id);
        if (p) { p.status = 'pending'; p.decidedAt = null; }
      }),
      bulkAccept: () => {
        let ok = 0, skip = 0;
        set((d) => {
          d.ctl.sel.forEach((id) => {
            const p = d.props.find((x) => x.id === id);
            if (!p || p.status !== 'pending') return;
            if (!p.valid) { skip++; return; }
            if (applyProp(d, id, d.user?.email ?? '')) ok++;
          });
          d.ctl.sel = [];
        });
        get().toast(`${plural(ok, 'valeur appliquée', 'valeurs appliquées')}${skip ? ', ' + plural(skip, 'invalide ignorée', 'invalides ignorées') : ''}.`, 'good');
      },
      bulkReject: () => {
        let n = 0;
        set((d) => {
          d.ctl.sel.forEach((id) => {
            const p = d.props.find((x) => x.id === id);
            if (p && p.status === 'pending') { p.status = 'rejected'; p.decidedAt = nowIso(); n++; }
          });
          d.ctl.sel = [];
        });
        get().toast(`${plural(n, 'proposition rejetée', 'propositions rejetées')}.`);
      },
      acceptReliable: () => {
        const s = get();
        const fmap = new Map(s.fiches.map((f) => [f.id, f]));
        const ctx = buildCtx(s.fiches, s.props);
        const ids = s.props.filter((p) => isReliable(p, flagsOf(p, ctx, fmap))).map((p) => p.id);
        set((d) => { ids.forEach((id) => applyProp(d, id, d.user?.email ?? '')); d.ctl.sel = []; });
        get().toast(`${plural(ids.length, 'proposition fiable acceptée', 'propositions fiables acceptées')}.`, 'good');
      },

      /* ----- Import de fichier ----- */
      loadFile: async (file) => {
        try {
          const rows = await readSpreadsheet(file);
          get().setImportData(file.name, rows);
        } catch (e) {
          get().toast(e instanceof Error ? e.message : 'Impossible de lire ce fichier.', 'bad');
        }
      },
      loadSample: () => {
        const s = get();
        const sample = makeSample(s.fiches, computeDups(s.fiches));
        get().setImportData('prospects_exemple.csv', [sample.headers, ...sample.rows]);
      },
      setImportData: (name, allRows) => {
        const rows = allRows.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
        if (rows.length < 2) { get().toast('Ce fichier ne contient pas de ligne de données.', 'bad'); return; }
        const headers = rows[0].map((h) => String(h ?? '').trim());
        set((d) => {
          d.imp = { file: name, headers, rows: rows.slice(1, 5001), map: guessMap(headers), result: null, include: [] };
          d.view = 'import';
        });
        if (rows.length - 1 > 5000) get().toast('Seules les 5 000 premières lignes sont traitées.');
      },
      setImpMap: (k, v) => set((d) => { d.imp.map[k] = v; }),
      resetImport: () => set((d) => { d.imp = emptyImport(); }),
      runMatch: () => {
        const s = get();
        const m = s.imp.map;
        if (m.nom === '' || m.prenom === '' || m.cp === '') {
          get().toast('Associez les colonnes Nom, Prénom et Code postal avant de lancer le rapprochement.', 'bad');
          return;
        }
        const result = matchRows(s.imp.rows, m, s.fiches);
        set((d) => {
          d.imp.result = result;
          d.imp.include = result.filter((r) => r.best && (r.status === 'certain' || r.status === 'incertain')).map((r) => r.line);
        });
      },
      toggleInclude: (line) => set((d) => {
        d.imp.include = d.imp.include.includes(line) ? d.imp.include.filter((l) => l !== line) : [...d.imp.include, line];
      }),
      sendToControl: () => {
        const counts = { created: 0, merged: 0, same: 0 };
        const s = get();
        const file = s.imp.file;
        const result = s.imp.result ?? [];
        set((d) => {
          result.forEach((r) => {
            if (!r.best || !d.imp.include.includes(r.line)) return;
            (['tel', 'email'] as const).forEach((field) => {
              if (!r[field]) return;
              const st = addProposal(d, {
                ficheId: r.best!.ficheId, field, raw: r[field], source: `Fichier ${file} (ligne ${r.line})`,
                conf: r.best!.m.score, matchScore: r.best!.m.score, ambiguous: r.ambiguous, origin: 'file',
              });
              if (st === 'created' || st === 'merged' || st === 'same') counts[st]++;
            });
          });
          d.ctl = emptyCtl();
          d.view = 'control';
        });
        get().toast(
          `${plural(counts.created + counts.merged, 'proposition')} à contrôler${counts.same ? ` (${plural(counts.same, 'valeur')} déjà à jour ignorée${counts.same > 1 ? 's' : ''})` : ''}.`,
          'good',
        );
      },

      /* ----- Connecteurs web ----- */
      toggleConnector: (id) => set((d) => {
        d.conn.selected = d.conn.selected.includes(id) ? d.conn.selected.filter((x) => x !== id) : [...d.conn.selected, id];
      }),
      runEnrich: async () => {
        const s0 = get();
        const known = new Set(s0.fiches.map((f) => f.id));
        const ids = s0.sel.filter((id) => known.has(id));
        const conns = CONNECTORS.filter((c) => s0.conn.selected.includes(c.id));
        if (!ids.length || !conns.length || s0.conn.running) return;
        set((d) => {
          d.conn.running = true;
          d.conn.log = [];
          d.conn.progress = { done: 0, total: ids.length, created: 0, merged: 0, same: 0, none: 0, finished: false };
        });
        for (const id of ids) {
          const f = get().fiches.find((x) => x.id === id);
          if (!f) continue;
          // Appels des connecteurs HORS du set immer (ils peuvent faire du réseau).
          const all = get().fiches;
          const results = await Promise.all(
            conns.map(async (c) => {
              try {
                return { origin: c.id, rows: await c.run(f, all) };
              } catch {
                return { origin: c.id, rows: [] as RawResult[] };
              }
            }),
          );
          // Application des propositions dans le store (synchrone, comme avant).
          set((d) => {
            const pr = d.conn.progress;
            if (!pr) return;
            let got = 0, same = 0;
            results.forEach(({ origin, rows }) => {
              rows.forEach((res) => {
                const st = addProposal(d, { ficheId: f.id, field: res.field, raw: res.raw, source: res.source, url: res.url, conf: res.conf, origin });
                if (st === 'created') { pr.created++; got++; }
                else if (st === 'merged') { pr.merged++; got++; }
                else if (st === 'same') { pr.same++; same++; }
              });
            });
            if (!got && !same) pr.none++;
            pr.done++;
            d.conn.log.unshift(`${f.prenom} ${f.nom.toUpperCase()} : ${got ? plural(got, 'proposition') : same ? 'valeurs déjà à jour' : 'aucun résultat'}`);
            d.conn.log = d.conn.log.slice(0, 6);
          });
          await sleep(80); // ménage la limite de l'ANS (~17 appels/s) et laisse la barre respirer
        }
        set((d) => {
          d.conn.running = false;
          if (d.conn.progress) d.conn.progress.finished = true;
        });
      },

      /* ----- Diffusion vers ONE et OUTREACH (simulée) ----- */
      pushDest: (key) => {
        const field = key === 'one' ? 'tel' : 'email';
        const label = key === 'one' ? 'ONE' : 'OUTREACH';
        let n = 0;
        set((d) => {
          d.fiches.forEach((f) => {
            if (f.push[key] === 'todo' && f[field]) { f.push[key] = 'ok'; n++; }
          });
          if (n) d.syncLog.unshift({ at: nowIso(), dest: label, n });
        });
        if (n) get().toast(`${plural(n, 'fiche envoyée', 'fiches envoyées')} vers ${label} (simulation).`, 'good');
      },
    };
  }),
);

// Sauvegarde locale différée, uniquement dans le navigateur.
if (typeof window !== 'undefined') {
  let timer: ReturnType<typeof setTimeout> | undefined;
  useStore.subscribe((s, prev) => {
    if (s.fiches === prev.fiches && s.props === prev.props && s.syncLog === prev.syncLog && s.seq === prev.seq) return;
    clearTimeout(timer);
    timer = setTimeout(() => savePersisted(useStore.getState()), 200);
  });
}
