"""Synchronisation Annuaire Santé → base de référence (remplace l'export CSV).

- Première fois : chargement complet de l'annuaire (selon SYNC_PROFESSIONS, sinon toutes professions).
- Ensuite : uniquement les fiches modifiées depuis la dernière synchro réussie (filtre _lastUpdated,
  l'option --since du script d'origine), avec un jour de recouvrement par sécurité.

Règles d'écriture :
- identité (nom, prénom, profession, spécialité) : l'Annuaire Santé fait référence, elle est mise à jour ;
- adresse : celle du premier lieu d'exercice connu, conservée ensuite ; tous les lieux sont gardés dans « lieux » ;
- téléphone et e-mail : ne remplissent qu'un champ VIDE (source « Annuaire Santé (synchronisation) »).
  Une coordonnée existante n'est jamais écrasée : les changements passent par les connecteurs et le contrôle.

Lancement manuel : python -m app.synchro   (ou bouton « Synchroniser maintenant » dans la base)
"""
from __future__ import annotations

import json
import threading
import urllib.parse
from datetime import timedelta

import psycopg

from . import ans, config, db
from .db import connexion
from .regles import norm, norm_email, norm_tel

VERROU = 727302
SOURCE = "Annuaire Santé (synchronisation)"


def _premier(v: str) -> str:
    return (v or "").split(" | ")[0].strip()


def _valeurs(v: str) -> list[str]:
    return [x.strip() for x in (v or "").split(" | ") if x.strip()]


def ligne_vers_fiche(row: dict, role: dict) -> dict | None:
    """Une ligne du script (un professionnel × un lieu) → les champs d'une fiche."""
    rpps = _premier(row["RPPS"])
    nom = _premier(row["Nom"])
    if not rpps or not nom:
        return None
    tel = next((t.value for t in (norm_tel(x) for x in _valeurs(row["Téléphone"]) + _valeurs(row["Téléphone 2"])) if t.ok), "")
    email = next((e.value for e in (norm_email(x) for x in _valeurs(row["E-mail"]) + _valeurs(row["MSSanté"])) if e.ok), "")
    lieu = {
        "structure": _premier(row["Structure"]) or _premier(row["Enseigne"]),
        "adresse": _premier(row["Adresse"]), "cp": _premier(row["Code postal"]), "ville": _premier(row["Ville"]),
        "tel": tel, "finess": _premier(row["FINESS établissement"]), "siret": _premier(row["SIRET"]),
        "mode": _premier(row["Mode d'exercice"]), "actif": row["Fiche active"] or "oui",
    }
    prenom = _premier(row["Prénom"])
    return {
        "rpps": rpps, "nom": nom, "prenom": prenom, "nom_norm": norm(nom), "prenom_norm": norm(prenom),
        "metier": _premier(row["Profession"]), "specialite": _premier(row["Spécialité"]),
        "adresse": lieu["adresse"], "cp": lieu["cp"], "ville": lieu["ville"], "ville_norm": norm(lieu["ville"]),
        "tel": tel, "email": email,
        "lieux": {str(role.get("id") or f"{rpps}-{norm(lieu['structure'])}"): lieu},
        "ans_maj": row["Dernière mise à jour"] or None,
    }


UPSERT = """
INSERT INTO igeya.fiches AS f
  (rpps, nom, prenom, nom_norm, prenom_norm, metier, specialite, adresse, cp, ville, ville_norm,
   tel, tel_source, tel_le, email, email_source, email_le, push_one, push_out, lieux, ans_maj, actif)
VALUES
  (%(rpps)s, %(nom)s, %(prenom)s, %(nom_norm)s, %(prenom_norm)s, %(metier)s, %(specialite)s, %(adresse)s, %(cp)s,
   %(ville)s, %(ville_norm)s,
   %(tel)s, CASE WHEN %(tel)s <> '' THEN %(source)s END, CASE WHEN %(tel)s <> '' THEN now() END,
   %(email)s, CASE WHEN %(email)s <> '' THEN %(source)s END, CASE WHEN %(email)s <> '' THEN now() END,
   CASE WHEN %(tel)s <> '' THEN 'todo' ELSE 'na' END, CASE WHEN %(email)s <> '' THEN 'todo' ELSE 'na' END,
   %(lieux)s::jsonb, %(ans_maj)s::timestamptz,
   (SELECT coalesce(bool_or(v->>'actif' <> 'non'), true) FROM jsonb_each(%(lieux)s::jsonb) AS e(k, v)))
ON CONFLICT (rpps) DO UPDATE SET
  nom = EXCLUDED.nom, prenom = EXCLUDED.prenom, nom_norm = EXCLUDED.nom_norm, prenom_norm = EXCLUDED.prenom_norm,
  metier = CASE WHEN EXCLUDED.metier <> '' THEN EXCLUDED.metier ELSE f.metier END,
  specialite = CASE WHEN EXCLUDED.specialite <> '' THEN EXCLUDED.specialite ELSE f.specialite END,
  adresse    = CASE WHEN f.cp = '' THEN EXCLUDED.adresse ELSE f.adresse END,
  cp         = CASE WHEN f.cp = '' THEN EXCLUDED.cp ELSE f.cp END,
  ville      = CASE WHEN f.cp = '' THEN EXCLUDED.ville ELSE f.ville END,
  ville_norm = CASE WHEN f.cp = '' THEN EXCLUDED.ville_norm ELSE f.ville_norm END,
  tel          = CASE WHEN f.tel = '' THEN EXCLUDED.tel ELSE f.tel END,
  tel_source   = CASE WHEN f.tel = '' AND EXCLUDED.tel <> '' THEN EXCLUDED.tel_source ELSE f.tel_source END,
  tel_le       = CASE WHEN f.tel = '' AND EXCLUDED.tel <> '' THEN EXCLUDED.tel_le ELSE f.tel_le END,
  push_one     = CASE WHEN f.tel = '' AND EXCLUDED.tel <> '' THEN 'todo' ELSE f.push_one END,
  email        = CASE WHEN f.email = '' THEN EXCLUDED.email ELSE f.email END,
  email_source = CASE WHEN f.email = '' AND EXCLUDED.email <> '' THEN EXCLUDED.email_source ELSE f.email_source END,
  email_le     = CASE WHEN f.email = '' AND EXCLUDED.email <> '' THEN EXCLUDED.email_le ELSE f.email_le END,
  push_out     = CASE WHEN f.email = '' AND EXCLUDED.email <> '' THEN 'todo' ELSE f.push_out END,
  lieux   = f.lieux || EXCLUDED.lieux,
  actif   = (SELECT coalesce(bool_or(v->>'actif' <> 'non'), true) FROM jsonb_each(f.lieux || EXCLUDED.lieux) AS e(k, v)),
  ans_maj = greatest(f.ans_maj, EXCLUDED.ans_maj),
  maj_le  = now()
RETURNING (xmax = 0) AS creee
"""


def ecrire(conn: psycopg.Connection, fiche: dict) -> bool:
    """Crée ou met à jour une fiche. Renvoie True si elle a été créée."""
    p = {**fiche, "lieux": json.dumps(fiche["lieux"]), "source": SOURCE}
    return bool(conn.execute(UPSERT, p).fetchone()["creee"])


def url_depart(depuis: str | None) -> str:
    params = [("_count", str(config.SYNC_PAGE)),
              ("_include", "PractitionerRole:practitioner"),
              ("_include", "PractitionerRole:organization")]
    if config.SYNC_PROFESSIONS:
        params.append(("role", ",".join(config.SYNC_PROFESSIONS)))
    if depuis:
        params.append(("_lastUpdated", f"ge{depuis}"))
    return f"{config.FHIR_BASE.rstrip('/')}/PractitionerRole?{urllib.parse.urlencode(params)}"


def synchroniser(par: str = "planification", bundles=None) -> dict | None:
    """Exécute une synchronisation complète ou différentielle. `bundles` sert aux tests.
    Renvoie le bilan, ou None si une synchro est déjà en cours."""
    if bundles is None and not config.ESANTE_API_KEY:
        raise RuntimeError("ESANTE_API_KEY n'est pas définie.")
    with psycopg.connect(config.DATABASE_URL, autocommit=True) as verrou:
        if not verrou.execute("SELECT pg_try_advisory_lock(%s)", (VERROU,)).fetchone()[0]:
            return None
        with connexion() as conn:
            prec = conn.execute(
                "SELECT debut FROM igeya.synchros WHERE statut = 'done' ORDER BY debut DESC LIMIT 1"
            ).fetchone()
            depuis = (prec["debut"] - timedelta(days=1)) if prec else None
            sid = conn.execute(
                "INSERT INTO igeya.synchros (depuis, par) VALUES (%s, %s) RETURNING id", (depuis, par)
            ).fetchone()["id"]
        bilan = {"pages": 0, "lignes": 0, "creees": 0, "maj": 0}
        try:
            if bundles is None:
                bundles = ans.iter_bundles(url_depart(depuis.date().isoformat() if depuis else None),
                                           config.ESANTE_API_KEY, config.SYNC_MAX_PAGES or None)
            for page, bundle in bundles:
                entries = [e["resource"] for e in bundle.get("entry", []) if "resource" in e]
                by_ref = {f'{r["resourceType"]}/{r["id"]}': r for r in entries}
                with connexion() as conn:
                    for role in (r for r in entries if r["resourceType"] == "PractitionerRole"):
                        prac = by_ref.get(role.get("practitioner", {}).get("reference", ""), {})
                        org = by_ref.get(role.get("organization", {}).get("reference", ""), {})
                        fiche = ligne_vers_fiche(ans.build_row(role, prac, org), role)
                        if not fiche:
                            continue
                        bilan["lignes"] += 1
                        bilan["creees" if ecrire(conn, fiche) else "maj"] += 1
                    bilan["pages"] = page
                    conn.execute(
                        "UPDATE igeya.synchros SET pages = %s, lignes = %s, creees = %s, maj = %s WHERE id = %s",
                        (bilan["pages"], bilan["lignes"], bilan["creees"], bilan["maj"], sid),
                    )
            with connexion() as conn:
                conn.execute("UPDATE igeya.synchros SET statut = 'done', fin = now() WHERE id = %s", (sid,))
        except Exception as e:  # noqa: BLE001
            config.log.exception("Synchronisation en échec")
            with connexion() as conn:
                conn.execute("UPDATE igeya.synchros SET statut = 'failed', fin = now(), message = %s WHERE id = %s", (str(e)[:1000], sid))
            raise
        return bilan


def en_cours() -> bool:
    with connexion() as conn:
        return conn.execute("SELECT 1 FROM igeya.synchros WHERE statut = 'running' LIMIT 1").fetchone() is not None


def lancer_en_fond(par: str) -> bool:
    """Démarre une synchro dans un fil séparé (n'empêche pas les enrichissements de tourner)."""
    if en_cours():
        return False

    def run() -> None:
        try:
            synchroniser(par)
        except Exception:  # noqa: BLE001 — déjà journalisé et enregistré dans igeya.synchros
            pass

    threading.Thread(target=run, name="synchro", daemon=True).start()
    return True


def nettoyer_interrompues() -> None:
    """Au démarrage : une synchro « running » sans verrou a été coupée par un redémarrage."""
    with psycopg.connect(config.DATABASE_URL, autocommit=True) as c:
        if c.execute("SELECT pg_try_advisory_lock(%s)", (VERROU,)).fetchone()[0]:
            c.execute("UPDATE igeya.synchros SET statut = 'failed', fin = now(), message = 'Interrompue par un redémarrage.'"
                      " WHERE statut = 'running'")
            c.execute("SELECT pg_advisory_unlock(%s)", (VERROU,))


if __name__ == "__main__":
    import logging

    logging.basicConfig(level=logging.INFO)
    db.migrer()
    print(synchroniser("ligne de commande"))
