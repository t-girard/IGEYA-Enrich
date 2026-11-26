"""Exécuteur des tâches de fond : enrichissements lancés depuis « Connecteurs web », synchro planifiée.

Tourne dans un fil du serveur : l'utilisateur peut fermer l'onglet. Un verrou PostgreSQL garantit
qu'un seul exécuteur travaille, même avec plusieurs instances. Après chaque fiche, la position est
enregistrée (« curseur ») : après un redéploiement, la tâche reprend où elle s'était arrêtée.
"""
from __future__ import annotations

import json
import threading
import time
import traceback
from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg

from . import config, connecteurs, formats, transit
from .db import connexion
from .regles import plural

VERROU = 727301
LOT = 50
PARIS = ZoneInfo("Europe/Paris")
COLS_FICHE = "id, rpps, nom, prenom, metier, specialite, adresse, cp, ville, tel, email"

_stop = threading.Event()
reveil = threading.Event()
_fil: threading.Thread | None = None


# ---------------------------------------------------------------- cibles

def _cible_sql(cible: dict) -> tuple[str, list]:
    if "ids" in cible:
        return "f.id = ANY(%s)", [list(cible["ids"])]
    fl = cible.get("filtre") or {}
    return formats.filtre_fiches(fl.get("q", ""), fl.get("metier", ""), fl.get("cp", ""), fl.get("missing", ""))


def compter_cible(conn: psycopg.Connection, cible: dict) -> int:
    where, params = _cible_sql(cible)
    return conn.execute(f"SELECT count(*) AS n FROM igeya.fiches f WHERE {where}", params).fetchone()["n"]


# ---------------------------------------------------------------- exécution d'une tâche

def _journal(conn, tid: int, ligne: str) -> None:
    """Ajoute une ligne en tête du journal et n'en garde que les 8 plus récentes."""
    conn.execute(
        """UPDATE igeya.taches SET journal = (
             SELECT coalesce(jsonb_agg(e ORDER BY i), '[]'::jsonb) FROM (
               SELECT e, i FROM jsonb_array_elements(jsonb_build_array(%s::text) || journal) WITH ORDINALITY AS t(e, i)
               ORDER BY i LIMIT 8) s)
           WHERE id = %s""",
        (ligne, tid),
    )


def executer(tid: int) -> None:
    with connexion() as conn:
        t = conn.execute("SELECT * FROM igeya.taches WHERE id = %s", (tid,)).fetchone()
    conns = []
    for cid in t["connecteurs"]:
        c = connecteurs.obtenir(cid)
        if c and c.pret:
            conns.append(c)
        else:
            with connexion() as conn:
                _journal(conn, tid, f"Connecteur « {cid} » indisponible : ignoré.")
    if not conns:
        with connexion() as conn:
            conn.execute("UPDATE igeya.taches SET statut = 'failed', fin = now(), message = 'Aucun connecteur disponible.' WHERE id = %s", (tid,))
        return

    where, params = _cible_sql(t["cible"])
    curseur = t["curseur"] or ""
    dernier_appel: dict[str, float] = {}

    while True:
        with connexion() as conn:
            etat = conn.execute("SELECT statut FROM igeya.taches WHERE id = %s", (tid,)).fetchone()["statut"]
            if etat == "cancelling" or _stop.is_set():
                break
            lot = conn.execute(
                f"SELECT {COLS_FICHE} FROM igeya.fiches f WHERE {where} AND f.id > %s ORDER BY f.id LIMIT %s",
                [*params, curseur, LOT],
            ).fetchall()
        if not lot:
            break
        for fiche in lot:
            if _stop.is_set():
                break
            resultats: list[tuple[connecteurs.Connecteur, dict]] = []
            erreurs: list[str] = []
            for c in conns:
                attente = 1.0 / c.appels_par_seconde - (time.monotonic() - dernier_appel.get(c.id, 0.0))
                if attente > 0:
                    time.sleep(attente)
                dernier_appel[c.id] = time.monotonic()
                try:
                    bruts = c.rechercher(dict(fiche))  # type: ignore[misc]
                    ok, pb = connecteurs.resultats_valides(c, bruts)
                    resultats += [(c, r) for r in ok]
                    erreurs += [f"{c.nom} : {p}" for p in pb[:2]]
                except Exception as e:  # noqa: BLE001 — un connecteur qui plante ne doit pas arrêter la tâche
                    erreurs.append(f"{c.nom} : {type(e).__name__} : {e}"[:300])
            with connexion() as conn:
                courante = conn.execute("SELECT id, tel, email FROM igeya.fiches WHERE id = %s FOR UPDATE", (fiche["id"],)).fetchone()
                got = same = 0
                cpt = {"created": 0, "merged": 0, "same": 0}
                if courante:
                    for c, r in resultats:
                        st = transit.ajouter_proposition(
                            conn, courante, r["champ"], r["valeur"], source=r["source"], url=r["url"],
                            confiance=r["confiance"], origine=c.id,
                        )
                        if st in cpt:
                            cpt[st] += 1
                    got, same = cpt["created"] + cpt["merged"], cpt["same"]
                qui = f"{fiche['prenom']} {fiche['nom'].upper()}"
                if erreurs:
                    ligne = f"{qui} : erreur — {erreurs[0]}"
                else:
                    ligne = f"{qui} : " + (plural(got, "proposition") if got else "valeurs déjà à jour" if same else "aucun résultat")
                conn.execute(
                    """UPDATE igeya.taches SET fait = fait + 1, crees = crees + %s, fusionnees = fusionnees + %s,
                         identiques = identiques + %s, sans_resultat = sans_resultat + %s, erreurs = erreurs + %s,
                         curseur = %s WHERE id = %s""",
                    (cpt["created"], cpt["merged"], cpt["same"], 1 if not got and not same and not erreurs else 0,
                     1 if erreurs else 0, fiche["id"], tid),
                )
                _journal(conn, tid, ligne)
            curseur = fiche["id"]

    with connexion() as conn:
        if _stop.is_set():
            return  # arrêt du serveur : la tâche reste « running » et reprendra au redémarrage
        etat = conn.execute("SELECT statut FROM igeya.taches WHERE id = %s", (tid,)).fetchone()["statut"]
        final = "cancelled" if etat == "cancelling" else "done"
        # Cible par filtre : des fiches ont pu sortir du filtre en cours de route (téléphone validé, etc.).
        conn.execute(
            "UPDATE igeya.taches SET statut = %s, fin = now(), total = CASE WHEN %s THEN fait ELSE total END WHERE id = %s",
            (final, final == "done" and "filtre" in t["cible"], tid),
        )


def traiter_une() -> bool:
    """Prend la plus ancienne tâche en attente et l'exécute. Renvoie False s'il n'y en a pas."""
    with connexion() as conn:
        t = conn.execute(
            "SELECT id FROM igeya.taches WHERE statut = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED"
        ).fetchone()
        if not t:
            return False
        conn.execute("UPDATE igeya.taches SET statut = 'running', debut = coalesce(debut, now()) WHERE id = %s", (t["id"],))
    try:
        executer(t["id"])
    except Exception:  # noqa: BLE001
        config.log.exception("Tâche %s en échec", t["id"])
        with connexion() as conn:
            conn.execute(
                "UPDATE igeya.taches SET statut = 'failed', fin = now(), message = %s WHERE id = %s",
                (traceback.format_exc(limit=2)[-500:], t["id"]),
            )
    return True


def reprendre_interrompues() -> None:
    with connexion() as conn:
        conn.execute("UPDATE igeya.taches SET statut = 'queued' WHERE statut = 'running'")
        conn.execute("UPDATE igeya.taches SET statut = 'cancelled', fin = now() WHERE statut = 'cancelling'")


# ---------------------------------------------------------------- planification de la synchro

def _synchro_due() -> bool:
    if not (config.SYNC_AUTO and config.ESANTE_API_KEY):
        return False
    maintenant = datetime.now(PARIS)
    if maintenant.hour != config.SYNC_HEURE:
        return False
    with connexion() as conn:
        r = conn.execute(
            "SELECT 1 FROM igeya.synchros WHERE (debut AT TIME ZONE 'Europe/Paris')::date = %s LIMIT 1", (maintenant.date(),)
        ).fetchone()
    return r is None


# ---------------------------------------------------------------- boucle

def _boucle() -> None:
    from . import synchro  # import tardif : évite une dépendance circulaire

    while not _stop.is_set():
        try:
            with psycopg.connect(config.DATABASE_URL, autocommit=True) as verrou:
                if not verrou.execute("SELECT pg_try_advisory_lock(%s)", (VERROU,)).fetchone()[0]:
                    _stop.wait(30)  # un autre exécuteur travaille déjà
                    continue
                reprendre_interrompues()
                while not _stop.is_set():
                    if _synchro_due():
                        synchro.lancer_en_fond(par="planification")
                    if not traiter_une():
                        reveil.wait(3)
                        reveil.clear()
                    verrou.execute("SELECT 1")  # garde la connexion (et le verrou) en vie
        except Exception:  # noqa: BLE001
            config.log.exception("Exécuteur : erreur, nouvel essai dans 10 s")
            _stop.wait(10)


def demarrer() -> None:
    global _fil
    if _fil and _fil.is_alive():
        return
    _stop.clear()
    _fil = threading.Thread(target=_boucle, name="executeur", daemon=True)
    _fil.start()


def arreter() -> None:
    _stop.set()
    reveil.set()
    if _fil:
        _fil.join(timeout=10)


def nouvelle_tache(conn: psycopg.Connection, par: str, ids_connecteurs: list[str], cible: dict, libelle: str) -> dict:
    total = compter_cible(conn, cible)
    t = conn.execute(
        "INSERT INTO igeya.taches (par, connecteurs, cible, libelle, total) VALUES (%s, %s, %s::jsonb, %s, %s) RETURNING *",
        (par, ids_connecteurs, json.dumps(cible), libelle, total),
    ).fetchone()
    reveil.set()
    return t
