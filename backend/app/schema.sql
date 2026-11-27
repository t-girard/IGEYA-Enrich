-- Schéma de la base de référence IGEYA Enrich.
-- Tout vit dans le schéma « igeya » : la base peut être partagée avec ONE et OUTREACH
-- sans collision de noms. Script idempotent, rejoué à chaque démarrage de l'API.

CREATE SCHEMA IF NOT EXISTS igeya;

CREATE SEQUENCE IF NOT EXISTS igeya.fiche_seq;

-- ---------------------------------------------------------------- base de référence
-- Une fiche = un professionnel de santé.
CREATE TABLE IF NOT EXISTS igeya.fiches (
  id            text PRIMARY KEY DEFAULT ('IGY-' || lpad(nextval('igeya.fiche_seq')::text, 7, '0')),
  rpps          text UNIQUE,
  nom           text NOT NULL,
  prenom        text NOT NULL DEFAULT '',
  nom_norm      text NOT NULL,
  prenom_norm   text NOT NULL DEFAULT '',
  metier        text NOT NULL DEFAULT '',
  specialite    text NOT NULL DEFAULT '',
  adresse       text NOT NULL DEFAULT '',
  cp            text NOT NULL DEFAULT '',
  ville         text NOT NULL DEFAULT '',
  ville_norm    text NOT NULL DEFAULT '',
  -- coordonnées : valeur au format unique + provenance (source, date, lien)
  tel           text NOT NULL DEFAULT '',
  tel_source    text,
  tel_le        timestamptz,
  tel_url       text,
  email         text NOT NULL DEFAULT '',
  email_source  text,
  email_le      timestamptz,
  email_url     text,
  -- état de diffusion : 'na' rien à diffuser, 'todo' à diffuser, 'ok' à jour
  push_one      text NOT NULL DEFAULT 'na',
  push_out      text NOT NULL DEFAULT 'na',
  -- données de l'Annuaire Santé
  actif         boolean NOT NULL DEFAULT true,
  lieux         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ans_maj       timestamptz,
  cree_le       timestamptz NOT NULL DEFAULT now(),
  maj_le        timestamptz NOT NULL DEFAULT now(),
  dup_key       text GENERATED ALWAYS AS (nom_norm || '|' || prenom_norm || '|' || cp) STORED,
  recherche     text GENERATED ALWAYS AS (nom_norm || ' ' || prenom_norm || ' ' || ville_norm) STORED
);
CREATE INDEX IF NOT EXISTS fiches_nom_idx    ON igeya.fiches (nom_norm, prenom_norm);
CREATE INDEX IF NOT EXISTS fiches_cp_idx     ON igeya.fiches (cp text_pattern_ops);
CREATE INDEX IF NOT EXISTS fiches_metier_idx ON igeya.fiches (metier);
CREATE INDEX IF NOT EXISTS fiches_tel_idx    ON igeya.fiches (tel) WHERE tel <> '';
CREATE INDEX IF NOT EXISTS fiches_email_idx  ON igeya.fiches (lower(email)) WHERE email <> '';
CREATE INDEX IF NOT EXISTS fiches_dup_idx    ON igeya.fiches (dup_key);
CREATE INDEX IF NOT EXISTS fiches_notel_idx  ON igeya.fiches (id) WHERE tel = '';
CREATE INDEX IF NOT EXISTS fiches_nomail_idx ON igeya.fiches (id) WHERE email = '';

-- Chaque modification validée d'une coordonnée.
CREATE TABLE IF NOT EXISTS igeya.historique (
  id        bigserial PRIMARY KEY,
  fiche_id  text NOT NULL REFERENCES igeya.fiches(id) ON DELETE CASCADE,
  le        timestamptz NOT NULL DEFAULT now(),
  champ     text NOT NULL,
  ancien    text NOT NULL DEFAULT '',
  nouveau   text NOT NULL,
  source    text NOT NULL,
  par       text NOT NULL
);
CREATE INDEX IF NOT EXISTS historique_fiche_idx ON igeya.historique (fiche_id, le DESC);

-- ---------------------------------------------------------------- zone de transit
-- Les sources (connecteurs, fichiers) n'écrivent QUE ici. Rien n'atteint une fiche sans validation.
CREATE TABLE IF NOT EXISTS igeya.propositions (
  id                   bigserial PRIMARY KEY,
  fiche_id             text NOT NULL REFERENCES igeya.fiches(id) ON DELETE CASCADE,
  champ                text NOT NULL CHECK (champ IN ('tel', 'email')),
  propose              text NOT NULL,
  brut                 text NOT NULL,
  valide               boolean NOT NULL,
  raison               text NOT NULL DEFAULT '',
  format_modifie       boolean NOT NULL DEFAULT false,
  genre                text NOT NULL DEFAULT '',
  note                 text NOT NULL DEFAULT '',
  sources              jsonb NOT NULL DEFAULT '[]'::jsonb,
  confiance            integer NOT NULL,
  score_rapprochement  integer,
  ambigu               boolean NOT NULL DEFAULT false,
  origine              text NOT NULL,
  statut               text NOT NULL DEFAULT 'pending' CHECK (statut IN ('pending', 'accepted', 'rejected')),
  cree_le              timestamptz NOT NULL DEFAULT now(),
  decide_le            timestamptz,
  decide_par           text
);
-- Une même valeur proposée deux fois pour la même fiche est fusionnée (les sources s'additionnent).
CREATE UNIQUE INDEX IF NOT EXISTS propositions_unique_pending
  ON igeya.propositions (fiche_id, champ, propose) WHERE statut = 'pending';
CREATE INDEX IF NOT EXISTS propositions_statut_idx ON igeya.propositions (statut, id);
CREATE INDEX IF NOT EXISTS propositions_valeur_idx
  ON igeya.propositions (champ, lower(propose)) WHERE statut = 'pending';

-- Signalements calculés : servent au filtrage, aux compteurs et à la validation en lot.
-- Vue interne, sans données : recréée à chaque démarrage pour suivre l'évolution des colonnes.
DROP VIEW IF EXISTS igeya.v_propositions;
CREATE VIEW igeya.v_propositions AS
SELECT
  p.*,
  f.nom, f.prenom, f.metier, f.cp, f.ville, f.nom_norm, f.prenom_norm,
  CASE WHEN p.champ = 'tel' THEN f.tel ELSE f.email END                AS actuelle,
  CASE WHEN p.champ = 'tel' THEN f.tel_source ELSE f.email_source END  AS actuelle_source,
  CASE WHEN p.champ = 'tel' THEN f.tel_le ELSE f.email_le END          AS actuelle_le,
  (NOT p.valide) AS f_invalide,
  (p.valide AND (
     EXISTS (SELECT 1 FROM igeya.fiches f2
             WHERE f2.id <> p.fiche_id
               AND ((p.champ = 'tel' AND f2.tel = p.propose)
                 OR (p.champ = 'email' AND f2.email <> '' AND lower(f2.email) = lower(p.propose))))
     OR EXISTS (SELECT 1 FROM igeya.propositions p2
                WHERE p2.statut = 'pending' AND p2.valide AND p2.champ = p.champ
                  AND lower(p2.propose) = lower(p.propose) AND p2.fiche_id <> p.fiche_id)
  )) AS f_doublon,
  (CASE WHEN p.score_rapprochement IS NOT NULL THEN p.score_rapprochement < 90 OR p.ambigu
        ELSE p.confiance < 70 END) AS f_incertain,
  EXISTS (SELECT 1 FROM igeya.propositions p3
          WHERE p3.statut = 'pending' AND p3.fiche_id = p.fiche_id AND p3.champ = p.champ
            AND p3.propose <> p.propose) AS f_divergence,
  (p.valide AND (CASE WHEN p.champ = 'tel' THEN f.tel ELSE f.email END) <> '') AS f_conflit,
  (p.valide AND (CASE WHEN p.champ = 'tel' THEN f.tel ELSE f.email END) = '')  AS f_nouveau,
  (p.valide AND (p.format_modifie OR p.note <> ''))                            AS f_format,
  (jsonb_array_length(p.sources) > 1)                                          AS f_multi
FROM igeya.propositions p
JOIN igeya.fiches f ON f.id = p.fiche_id;

-- ---------------------------------------------------------------- tâches de fond
-- Enrichissements lancés depuis l'écran « Connecteurs web » : exécutés par le serveur,
-- l'onglet peut être fermé. « curseur » permet la reprise après un redémarrage.
CREATE TABLE IF NOT EXISTS igeya.taches (
  id             bigserial PRIMARY KEY,
  cree_le        timestamptz NOT NULL DEFAULT now(),
  par            text NOT NULL,
  connecteurs    text[] NOT NULL,
  cible          jsonb NOT NULL,
  libelle        text NOT NULL DEFAULT '',
  statut         text NOT NULL DEFAULT 'queued'
                 CHECK (statut IN ('queued', 'running', 'done', 'failed', 'cancelling', 'cancelled', 'pausing', 'paused')),
  total          integer NOT NULL DEFAULT 0,
  fait           integer NOT NULL DEFAULT 0,
  crees          integer NOT NULL DEFAULT 0,
  fusionnees     integer NOT NULL DEFAULT 0,
  identiques     integer NOT NULL DEFAULT 0,
  sans_resultat  integer NOT NULL DEFAULT 0,
  erreurs        integer NOT NULL DEFAULT 0,
  curseur        text,
  journal        jsonb NOT NULL DEFAULT '[]'::jsonb,
  message        text NOT NULL DEFAULT '',
  debut          timestamptz,
  fin            timestamptz
);
CREATE INDEX IF NOT EXISTS taches_statut_idx ON igeya.taches (statut, id);
-- Bases créées avant la pause/reprise : on remplace la contrainte des statuts.
ALTER TABLE igeya.taches DROP CONSTRAINT IF EXISTS taches_statut_check;
ALTER TABLE igeya.taches ADD CONSTRAINT taches_statut_check
  CHECK (statut IN ('queued', 'running', 'done', 'failed', 'cancelling', 'cancelled', 'pausing', 'paused'));
ALTER TABLE igeya.taches ADD COLUMN IF NOT EXISTS reprises integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------- synchronisation ANS
-- Migration : bases créées avant la pause/reprise de la synchro ANS.
ALTER TABLE IF EXISTS igeya.synchros DROP CONSTRAINT IF EXISTS synchros_statut_check;

CREATE TABLE IF NOT EXISTS igeya.synchros (
  id         bigserial PRIMARY KEY,
  debut      timestamptz NOT NULL DEFAULT now(),
  fin        timestamptz,
  depuis     timestamptz,
  statut     text NOT NULL DEFAULT 'running' CHECK (statut IN ('running', 'pausing', 'paused', 'done', 'failed', 'cancelling', 'cancelled')),
  pages      integer NOT NULL DEFAULT 0,
  lignes     integer NOT NULL DEFAULT 0,
  creees     integer NOT NULL DEFAULT 0,
  maj        integer NOT NULL DEFAULT 0,
  message    text NOT NULL DEFAULT '',
  par        text NOT NULL DEFAULT 'planification'
);

-- ---------------------------------------------------------------- diffusion vers ONE et OUTREACH
-- Base partagée : chaque envoi dépose une ligne par fiche dans cette file.
-- ONE et OUTREACH lisent les lignes non lues, puis renseignent « lu_le ».
CREATE TABLE IF NOT EXISTS igeya.lots_diffusion (
  id           bigserial PRIMARY KEY,
  destination  text NOT NULL CHECK (destination IN ('ONE', 'OUTREACH')),
  n            integer NOT NULL,
  le           timestamptz NOT NULL DEFAULT now(),
  par          text NOT NULL
);
CREATE TABLE IF NOT EXISTS igeya.diffusion (
  id           bigserial PRIMARY KEY,
  lot_id       bigint NOT NULL REFERENCES igeya.lots_diffusion(id),
  destination  text NOT NULL CHECK (destination IN ('ONE', 'OUTREACH')),
  fiche_id     text NOT NULL REFERENCES igeya.fiches(id) ON DELETE CASCADE,
  donnees      jsonb NOT NULL,
  envoye_le    timestamptz NOT NULL DEFAULT now(),
  lu_le        timestamptz
);
CREATE INDEX IF NOT EXISTS diffusion_a_lire_idx ON igeya.diffusion (destination, id) WHERE lu_le IS NULL;

-- Vues prêtes à l'emploi pour ONE et OUTREACH : l'état courant des fiches, coordonnées validées.
CREATE OR REPLACE VIEW igeya.v_one_prospects AS
SELECT id AS id_externe, rpps, nom, prenom, metier AS profession, specialite, adresse,
       cp AS code_postal, ville, replace(tel, ' ', '') AS telephone,
       tel_source AS source, tel_le AS mis_a_jour, actif
FROM igeya.fiches WHERE tel <> '';

CREATE OR REPLACE VIEW igeya.v_outreach_contacts AS
SELECT id AS id_externe, rpps, nom, prenom, metier AS profession, specialite,
       cp AS code_postal, ville, email, email_source AS source, email_le AS mis_a_jour, actif
FROM igeya.fiches WHERE email <> '';
