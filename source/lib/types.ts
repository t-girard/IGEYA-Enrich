export type Field = 'tel' | 'email';
export type PushState = 'ok' | 'todo' | 'na';
export type Origin = 'extractor' | 'rpps' | 'file';
export type Decision = 'pending' | 'accepted' | 'rejected';
export type View = 'base' | 'import' | 'connect' | 'control' | 'sync' | 'arch';
export type MapKey = 'nom' | 'prenom' | 'cp' | 'tel' | 'email';

export const FIELD_LABEL: Record<Field, string> = { tel: 'Téléphone', email: 'E-mail' };
export const ORIGIN_LABEL: Record<Origin, string> = { extractor: 'Contact Extractor', rpps: 'Annuaire Santé', file: 'Fichier importé' };

/** Provenance d'une coordonnée : d'où vient la valeur et quand elle a été enregistrée. */
export interface Src {
  source: string;
  at: string;
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
  adresse: string;
  cp: string;
  ville: string;
  tel: string;
  telSrc: Src | null;
  email: string;
  emailSrc: Src | null;
  history: HistoryItem[];
  /** Etat de diffusion : ONE reçoit le téléphone, OUTREACH reçoit l'e-mail. */
  push: { one: PushState; out: PushState };
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

export interface ProposalInput {
  ficheId: string;
  field: Field;
  raw: string;
  source: string;
  url?: string;
  conf: number;
  matchScore?: number | null;
  ambiguous?: boolean;
  origin: Origin;
}

export type AddStatus = 'created' | 'merged' | 'same' | 'vide';

export type FlagKind = 'invalide' | 'doublon' | 'incertain' | 'divergence' | 'conflit' | 'nouveau' | 'format' | 'multi';
export interface Flag {
  k: FlagKind;
  t: string;
  d: string;
  c: 'good' | 'warn' | 'bad' | 'info';
}

export interface SyncLogItem {
  at: string;
  dest: string;
  n: number;
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
  best?: { ficheId: string; m: MatchScore };
  ambiguous?: boolean;
}

/** Résultat brut renvoyé par un connecteur pour une fiche. */
export interface RawResult {
  field: Field;
  raw: string;
  source: string;
  url: string;
  conf: number;
}

/** Contrat d'un connecteur : une source = un objet de ce type. */
export interface Connector {
  id: Origin;
  name: string;
  kind: string;
  desc: string;
  fields: Field[];
  run: (fiche: Fiche, all: Fiche[]) => RawResult[] | Promise<RawResult[]>;
}
