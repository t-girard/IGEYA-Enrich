import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { api, setUnauthorizedHandler } from './api';
import type { ColumnMap, Decision, Fiche, FlagKind, ImportRow, MapKey, Missing, Origin, Stats, Tache, View } from './types';
import { plural } from './text';
import { guessMap, readSpreadsheet } from './csv';
import { normCp } from './phone';

export interface Toast { id: number; msg: string; kind?: 'good' | 'bad' }
export interface BaseState { q: string; metier: string; cp: string; missing: Missing; page: number }
export interface ImportState { file: string; headers: string[]; rows: string[][]; map: ColumnMap; result: ImportRow[] | null; include: number[]; busy: boolean }
export interface CtlState { tab: Decision; flag: '' | FlagKind; origin: '' | Origin; q: string; sel: string[] }
/** Fiches visées par un enrichissement.
 *  - sel   : sélection manuelle (liste d'IDs dans `sel`)
 *  - tout  : toutes les fiches de la base (sans filtre)
 *  - filtre: fiches correspondant à un ou plusieurs critères cumulés
 */
export type Target =
  | { kind: 'sel' }
  | { kind: 'tout'; count: number }
  | { kind: 'filtre'; filtre: Omit<BaseState, 'page'>; label: string; count: number };
type Who = Pick<Fiche, 'id' | 'prenom' | 'nom'>;

export interface AppState {
  user: { email: string } | null;
  booting: boolean;
  view: View;
  toasts: Toast[];
  stats: Stats | null;
  /** Incrémentée après chaque modification : les écrans rechargent leurs données. */
  version: number;
  sel: string[];
  selInfo: Record<string, Who>;
  base: BaseState;
  openId: string | null;
  imp: ImportState;
  conn: { selected: string[]; touched: boolean; target: Target; tacheId: number | null };
  ctl: CtlState;

  boot: () => Promise<void>;
  login: (email: string, pw: string) => Promise<string | null>;
  logout: () => Promise<void>;
  sessionExpired: () => void;
  setView: (v: View) => void;
  toast: (msg: string, kind?: 'good' | 'bad') => void;
  refreshStats: () => Promise<void>;
  bump: () => void;
  setBase: (patch: Partial<BaseState>) => void;
  openFiche: (id: string | null) => void;
  toggleSel: (f: Who) => void;
  setSelMany: (fiches: Who[], on: boolean) => void;
  selectIds: (ids: string[]) => void;
  clearSel: () => void;
  enrichOne: (f: Who) => void;
  setCtl: (patch: Partial<CtlState>) => void;
  goControl: () => void;
  goControlFiche: (nom: string) => void;
  ctlToggle: (id: string) => void;
  ctlSetMany: (ids: string[], on: boolean) => void;
  decide: (action: 'accepter' | 'rejeter' | 'remettre', ids: string[]) => Promise<void>;
  acceptReliable: () => Promise<void>;
  loadFile: (file: File) => Promise<void>;
  setImportData: (name: string, rows: string[][]) => void;
  setImpMap: (k: MapKey, v: string) => void;
  resetImport: () => void;
  runMatch: () => Promise<void>;
  toggleInclude: (line: number) => void;
  sendToControl: () => Promise<void>;
  setConnectors: (ids: string[], touched?: boolean) => void;
  toggleConnector: (id: string) => void;
  setTarget: (t: Target) => void;
  runEnrich: () => Promise<void>;
  followTache: (id: number) => void;
  pushDest: (dest: 'ONE' | 'OUTREACH') => Promise<void>;
}

const emptyImport = (): ImportState => ({ file: '', headers: [], rows: [], map: { nom: '', prenom: '', cp: '', tel: '', email: '' }, result: null, include: [], busy: false });
const emptyBase = (): BaseState => ({ q: '', metier: '', cp: '', missing: '', page: 1 });
const emptyCtl = (): CtlState => ({ tab: 'pending', flag: '', origin: '', q: '', sel: [] });
const emptyConn = (): AppState['conn'] => ({ selected: [], touched: false, target: { kind: 'sel' }, tacheId: null });
const MAX_SEL = 5000;

let toastSeq = 0;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Erreur inattendue.');

export const useStore = create<AppState>()(
  immer((set, get) => {
    setUnauthorizedHandler(() => get().sessionExpired());
    return {
      user: null,
      booting: true,
      view: 'base',
      toasts: [],
      stats: null,
      version: 0,
      sel: [],
      selInfo: {},
      base: emptyBase(),
      openId: null,
      imp: emptyImport(),
      conn: emptyConn(),
      ctl: emptyCtl(),

      /* ----- Session ----- */
      boot: async () => {
        try {
          const me = await api<{ email: string }>('/me');
          set((d) => { d.user = me; });
          void get().refreshStats();
        } catch {
          /* pas de session : écran de connexion */
        } finally {
          set((d) => { d.booting = false; });
        }
      },
      login: async (email, pw) => {
        try {
          const me = await api<{ email: string }>('/login', { body: { email, password: pw } });
          set((d) => { d.user = me; d.view = 'base'; });
          void get().refreshStats();
          return null;
        } catch (e) {
          return errMsg(e);
        }
      },
      logout: async () => {
        try { await api('/logout', { body: {} }); } catch { /* déjà déconnecté */ }
        set((d) => {
          d.user = null; d.openId = null; d.sel = []; d.selInfo = {}; d.stats = null;
          d.base = emptyBase(); d.imp = emptyImport(); d.ctl = emptyCtl(); d.conn = emptyConn();
        });
      },
      sessionExpired: () => {
        if (!get().user) return;
        set((d) => { d.user = null; d.openId = null; });
        get().toast('Votre session a expiré. Reconnectez-vous.', 'bad');
      },

      setView: (v) => set((d) => { d.view = v; d.openId = null; }),
      toast: (msg, kind) => {
        const id = ++toastSeq;
        set((d) => { d.toasts.push({ id, msg, kind }); });
        setTimeout(() => set((d) => { d.toasts = d.toasts.filter((t) => t.id !== id); }), 5200);
      },
      refreshStats: async () => {
        try {
          const s = await api<Stats>('/stats');
          set((d) => { d.stats = s; });
        } catch { /* l'erreur s'affiche dans l'écran concerné */ }
      },
      bump: () => {
        set((d) => { d.version++; });
        void get().refreshStats();
      },

      /* ----- Base et sélection ----- */
      setBase: (patch) => set((d) => { Object.assign(d.base, patch); }),
      openFiche: (id) => set((d) => { d.openId = id; }),
      toggleSel: (f) => set((d) => {
        if (d.sel.includes(f.id)) d.sel = d.sel.filter((x) => x !== f.id);
        else if (d.sel.length < MAX_SEL) { d.sel.push(f.id); d.selInfo[f.id] = { id: f.id, prenom: f.prenom, nom: f.nom }; }
        d.conn.target = { kind: 'sel' };
      }),
      setSelMany: (fiches, on) => set((d) => {
        const s = new Set(d.sel);
        fiches.forEach((f) => {
          if (on && s.size < MAX_SEL) { s.add(f.id); d.selInfo[f.id] = { id: f.id, prenom: f.prenom, nom: f.nom }; }
          if (!on) s.delete(f.id);
        });
        d.sel = Array.from(s);
        d.conn.target = { kind: 'sel' };
      }),
      selectIds: (ids) => set((d) => {
        d.sel = Array.from(new Set([...d.sel, ...ids])).slice(0, MAX_SEL);
        d.conn.target = { kind: 'sel' };
      }),
      clearSel: () => set((d) => { d.sel = []; d.selInfo = {}; }),
      enrichOne: (f) => set((d) => {
        d.sel = [f.id]; d.selInfo = { [f.id]: { id: f.id, prenom: f.prenom, nom: f.nom } };
        d.conn.target = { kind: 'sel' }; d.openId = null; d.view = 'connect';
      }),

      /* ----- Contrôle ----- */
      setCtl: (patch) => set((d) => { Object.assign(d.ctl, patch); }),
      goControl: () => set((d) => { d.ctl = emptyCtl(); d.view = 'control'; d.version++; }),
      goControlFiche: (nom) => set((d) => { d.ctl = { ...emptyCtl(), q: nom }; d.openId = null; d.view = 'control'; }),
      ctlToggle: (id) => set((d) => { d.ctl.sel = d.ctl.sel.includes(id) ? d.ctl.sel.filter((x) => x !== id) : [...d.ctl.sel, id]; }),
      ctlSetMany: (ids, on) => set((d) => {
        const s = new Set(d.ctl.sel);
        ids.forEach((id) => (on ? s.add(id) : s.delete(id)));
        d.ctl.sel = Array.from(s);
      }),
      decide: async (action, ids) => {
        try {
          const r = await api<{ ok: number; ignorees: number; fiche?: { prenom: string; nom: string } }>('/propositions/decision', { body: { action, ids } });
          set((d) => { d.ctl.sel = d.ctl.sel.filter((x) => !ids.includes(x)); });
          if (action === 'accepter') {
            if (ids.length === 1 && r.fiche) get().toast(`Valeur appliquée à la fiche de ${r.fiche.prenom} ${r.fiche.nom}.`, 'good');
            else get().toast(`${plural(r.ok, 'valeur appliquée', 'valeurs appliquées')}${r.ignorees ? ', ' + plural(r.ignorees, 'ignorée (invalide ou déjà traitée)', 'ignorées (invalides ou déjà traitées)') : ''}.`, 'good');
          } else if (action === 'rejeter' && ids.length > 1) {
            get().toast(`${plural(r.ok, 'proposition rejetée', 'propositions rejetées')}.`);
          } else if (action === 'remettre' && !r.ok) {
            get().toast('Impossible : la même valeur est déjà en attente pour cette fiche.', 'bad');
          }
        } catch (e) {
          get().toast(errMsg(e), 'bad');
        }
        get().bump();
      },
      acceptReliable: async () => {
        try {
          const r = await api<{ ok: number }>('/propositions/accepter-fiables', { body: {} });
          set((d) => { d.ctl.sel = []; });
          get().toast(`${plural(r.ok, 'proposition fiable acceptée', 'propositions fiables acceptées')}.`, 'good');
        } catch (e) {
          get().toast(errMsg(e), 'bad');
        }
        get().bump();
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
      setImportData: (name, allRows) => {
        const rows = allRows.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
        if (rows.length < 2) { get().toast('Ce fichier ne contient pas de ligne de données.', 'bad'); return; }
        const headers = rows[0].map((h) => String(h ?? '').trim());
        set((d) => {
          d.imp = { ...emptyImport(), file: name, headers, rows: rows.slice(1, 5001), map: guessMap(headers) };
          d.view = 'import';
        });
        if (rows.length - 1 > 5000) get().toast('Seules les 5 000 premières lignes sont traitées.');
      },
      setImpMap: (k, v) => set((d) => { d.imp.map[k] = v; }),
      resetImport: () => set((d) => { d.imp = emptyImport(); }),
      runMatch: async () => {
        const { imp } = get();
        const m = imp.map;
        if (m.nom === '' || m.prenom === '' || m.cp === '') {
          get().toast('Associez les colonnes Nom, Prénom et Code postal avant de lancer le rapprochement.', 'bad');
          return;
        }
        const cell = (r: string[], k: MapKey) => (m[k] === '' ? '' : String(r[Number(m[k])] ?? '').trim());
        const lignes = imp.rows.map((r, i) => ({ line: i + 2, nom: cell(r, 'nom'), prenom: cell(r, 'prenom'), cp: normCp(cell(r, 'cp')), tel: cell(r, 'tel'), email: cell(r, 'email') }));
        set((d) => { d.imp.busy = true; });
        try {
          const { result } = await api<{ result: ImportRow[] }>('/import/rapprocher', { body: { lignes } });
          set((d) => {
            d.imp.result = result;
            d.imp.include = result.filter((r) => r.best && (r.status === 'certain' || r.status === 'incertain')).map((r) => r.line);
          });
        } catch (e) {
          get().toast(errMsg(e), 'bad');
        } finally {
          set((d) => { d.imp.busy = false; });
        }
      },
      toggleInclude: (line) => set((d) => {
        d.imp.include = d.imp.include.includes(line) ? d.imp.include.filter((l) => l !== line) : [...d.imp.include, line];
      }),
      sendToControl: async () => {
        const { imp } = get();
        const lignes = (imp.result ?? [])
          .filter((r) => r.best && imp.include.includes(r.line))
          .map((r) => ({ line: r.line, ficheId: r.best!.ficheId, tel: r.tel, email: r.email, score: r.best!.m.score, ambigu: !!r.ambiguous }));
        set((d) => { d.imp.busy = true; });
        try {
          const c = await api<{ created: number; merged: number; same: number }>('/import/envoyer', { body: { fichier: imp.file, lignes } });
          set((d) => { d.ctl = emptyCtl(); d.view = 'control'; d.imp.busy = false; });
          get().toast(
            `${plural(c.created + c.merged, 'proposition')} à contrôler${c.same ? ` (${plural(c.same, 'valeur')} déjà à jour ignorée${c.same > 1 ? 's' : ''})` : ''}.`,
            'good',
          );
          get().bump();
        } catch (e) {
          set((d) => { d.imp.busy = false; });
          get().toast(errMsg(e), 'bad');
        }
      },

      /* ----- Connecteurs web ----- */
      setConnectors: (ids, touched = false) => set((d) => { d.conn.selected = ids; d.conn.touched = d.conn.touched || touched; }),
      toggleConnector: (id) => set((d) => {
        d.conn.selected = d.conn.selected.includes(id) ? d.conn.selected.filter((x) => x !== id) : [...d.conn.selected, id];
        d.conn.touched = true;
      }),
      setTarget: (t) => set((d) => { d.conn.target = t; }),
      runEnrich: async () => {
        const { conn, sel } = get();
        let cible: { ids?: string[]; filtre?: Omit<BaseState, 'page'> };
        let libelle: string;
        if (conn.target.kind === 'filtre') {
          cible = { filtre: conn.target.filtre };
          libelle = conn.target.label;
        } else if (conn.target.kind === 'tout') {
          cible = { filtre: { q: '', metier: '', cp: '', missing: '' } };
          libelle = 'toutes les fiches';
        } else {
          cible = { ids: sel };
          libelle = plural(sel.length, 'fiche sélectionnée', 'fiches sélectionnées');
        }
        try {
          const t = await api<Tache>('/taches', { body: { connecteurs: conn.selected, cible, libelle } });
          set((d) => { d.conn.tacheId = t.id; });
        } catch (e) {
          get().toast(errMsg(e), 'bad');
        }
      },

      followTache: (id) => set((d) => { d.conn.tacheId = id; }),

      /* ----- Diffusion ----- */
      pushDest: async (dest) => {
        try {
          const r = await api<{ n: number }>(`/diffusion/${dest}`, { body: {} });
          get().toast(`${plural(r.n, 'fiche déposée', 'fiches déposées')} pour ${dest}.`, 'good');
        } catch (e) {
          get().toast(errMsg(e), 'bad');
        }
        get().bump();
      },
    };
  }),
);
