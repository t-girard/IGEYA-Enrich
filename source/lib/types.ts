export type Field = 'tel' | 'email';
export type PushState = 'ok' | 'todo' | 'na';
/** Origine d'une proposition : identifiant d'un connecteur (nom de son fichier), « fichier » ou « synchro ». */
export type Origin = string;
export type Decision = 'pending' | 'accepted' | 'rejected';
export type View = 'base' | 'import' | 'connect' | 'control' | 'sync' | 'arch';
export type MapKey = 'nom' | 'prenom' | 'cp' | 'tel' | 'email';
export type ColumnMap = Record<MapKey, string>;
export type Missing = '' | 'tel' | 'email' | 'any' | 'dup';

export const FIELD_LABEL: Record<Field, string> = { tel: 'Téléphone', email: 'E-mail' };

/** Provenance d'une coordonnée : d'où vient la valeur et quand elle a été enregistrée. */
export interface Src {
  source: string;
  at: string | null;
  url?: string;
}

export interface HistoryItem {
  at: string;
  field: Field;
  from: string;
  to: string;
  source: string;
  by: string;
}

/** Fiche de la base de référence : un professionnel de santé. */
export interface Fiche {
  id: string;
  rpps: string;
  nom: string;
  prenom: string;
  metier: string;
  specialite: string;
  adresse: string;
  cp: string;
  ville: string;
  tel: string;
  telSrc: Src | null;
  email: string;
  emailSrc: Src | null;
  /** Etat de diffusion : ONE reçoit le téléphone, OUTREACH reçoit l'e-mail. */
  push: { one: PushState; out: PushState };
  actif: boolean;
}

export interface FicheRow extends Fiche {
  pending: number;
  isDup: boolean;
}

export interface Lieu {
  structure: string;
  adresse: string;
  cp: string;
  ville: string;
  tel: string;
  finess: string;
  mode: string;
  actif: string;
}

export interface FicheDetail extends Fiche {
  history: HistoryItem[];
  dups: string[];
  pending: number;
  lieux: Lieu[];
  creeLe: string | null;
  ansMaj: string | null;
}

export interface Page<T> {
  total: number;
  page: number;
  pages: number;
  rows: T[];
}

export interface Stats {
  fiches: number;
  sans_tel: number;
  sans_email: number;
  doublons: number;
  pending: number;
  a_diffuser: number;
  a_diffuser_one: number;
  a_diffuser_out: number;
}

export interface ProposalSource {
  label: string;
  url: string;
}

/** Proposition de valeur issue d'une source, en attente de contrôle. Jamais écrite directement sur la fiche. */
export interface Proposal {
  id: string;
  ficheId: string;
  field: Field;
  proposed: string;
  raw: string;
  valid: boolean;
  reason: string;
  fmtChanged: boolean;
  kind: string;
  note: string;
  sources: ProposalSource[];
  conf: number;
  matchScore: number | null;
  ambiguous: boolean;
  origin: Origin;
  status: Decision;
  at: string;
  decidedAt: string | null;
}

export type FlagKind = 'invalide' | 'doublon' | 'incertain' | 'divergence' | 'conflit' | 'nouveau' | 'format' | 'multi';
export interface Flag {
  k: FlagKind;
  t: string;
  d: string;
  c: 'good' | 'warn' | 'bad' | 'info';
}

export interface ControlRow {
  p: Proposal;
  f: { id: string; nom: string; prenom: string; metier: string; cp: string; ville: string; current: string; currentSrc: Src | null };
  flags: Flag[];
}

export interface ControlPage {
  counts: Record<Decision, number>;
  fiables: number;
  total: number;
  origines: Record<string, string>;
  rows: ControlRow[];
}

export interface MatchScore {
  score: number;
  tN: string;
  tP: string;
  tC: string;
}

export type ImportStatus = 'certain' | 'incertain' | 'aucune' | 'doublon';
export interface ImportRow {
  line: number;
  nom: string;
  prenom: string;
  cp: string;
  tel: string;
  email: string;
  status: ImportStatus;
  dupOf?: number;
  best?: { ficheId: string; m: MatchScore; fiche: { id: string; nom: string; prenom: string; cp: string; ville: string } };
  ambiguous?: boolean;
}

/** Connecteur déclaré côté serveur (un fichier dans backend/connecteurs/). */
export interface ConnectorInfo {
  id: string;
  nom: string;
  type: string;
  description: string;
  champs: Field[];
  pret: boolean;
  manquantes: string[];
  erreur: string;
  fichier: string;
}

export type TacheStatut = 'queued' | 'running' | 'done' | 'failed' | 'cancelling' | 'cancelled' | 'pausing' | 'paused';
export interface Tache {
  id: number;
  par: string;
  connecteurs: string[];
  libelle: string;
  statut: TacheStatut;
  total: number;
  fait: number;
  crees: number;
  fusionnees: number;
  identiques: number;
  sansResultat: number;
  erreurs: number;
  journal: string[];
  message: string;
  reprises: number;
  creeLe: string | null;
  debut: string | null;
  fin: string | null;
}

export interface Synchro {
  id: number;
  debut: string;
  fin: string | null;
  depuis: string | null;
  statut: 'running' | 'pausing' | 'paused' | 'cancelling' | 'cancelled' | 'done' | 'failed';
  pages: number;
  lignes: number;
  creees: number;
  maj: number;
  message: string;
  par: string;
}

export interface SynchroEtat {
  configuree: boolean;
  auto: boolean;
  heure: number;
  professions: string[];
  historique: Synchro[];
}

export interface DiffusionPanel {
  n: number;
  apercu: Fiche[];
  exemple: Record<string, unknown> | null;
}

export interface DiffusionEtat {
  one: DiffusionPanel;
  out: DiffusionPanel;
  journal: { at: string; dest: string; n: number; lus: number; by: string }[];
}
