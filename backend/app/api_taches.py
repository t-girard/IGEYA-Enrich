"""Connecteurs, tâches d'enrichissement et synchronisation Annuaire Santé."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import auth, config, connecteurs, executeur, formats, synchro
from .db import connexion

router = APIRouter(prefix="/api")


@router.get("/connecteurs")
def lister_connecteurs(_: str = Depends(auth.utilisateur)) -> list[dict]:
    return [c.info() for c in connecteurs.tous()]


class Filtre(BaseModel):
    q: str = ""
    metier: str = ""
    cp: str = ""
    missing: Literal["", "tel", "email", "any", "dup"] = ""


class Cible(BaseModel):
    ids: list[str] | None = None
    filtre: Filtre | None = None


class NouvelleTache(BaseModel):
    connecteurs: list[str]
    cible: Cible
    libelle: str = ""


def _tache(t: dict) -> dict:
    return {
        "id": t["id"], "par": t["par"], "connecteurs": t["connecteurs"], "libelle": t["libelle"], "statut": t["statut"],
        "total": t["total"], "fait": t["fait"], "crees": t["crees"], "fusionnees": t["fusionnees"],
        "identiques": t["identiques"], "sansResultat": t["sans_resultat"], "erreurs": t["erreurs"],
        "journal": t["journal"], "message": t["message"],
        "creeLe": formats.iso(t["cree_le"]), "debut": formats.iso(t["debut"]), "fin": formats.iso(t["fin"]),
    }


@router.post("/taches")
def creer(body: NouvelleTache, email: str = Depends(auth.utilisateur)) -> dict:
    if not body.connecteurs:
        raise HTTPException(400, "Choisissez au moins un connecteur.")
    for cid in body.connecteurs:
        c = connecteurs.obtenir(cid)
        if not c:
            raise HTTPException(400, f"Connecteur inconnu : {cid}")
        if not c.pret:
            raise HTTPException(400, f"Le connecteur « {c.nom} » n'est pas prêt : " + (c.erreur or "variables manquantes : " + ", ".join(c.manquantes)))
    if body.cible.ids is not None:
        cible: dict = {"ids": sorted(set(body.cible.ids))[:5000]}
        if not cible["ids"]:
            raise HTTPException(400, "Aucune fiche sélectionnée.")
    elif body.cible.filtre is not None:
        cible = {"filtre": body.cible.filtre.model_dump()}
    else:
        raise HTTPException(400, "Indiquez les fiches à enrichir.")
    with connexion() as conn:
        t = executeur.nouvelle_tache(conn, email, body.connecteurs, cible, body.libelle[:200])
    if not config.EXECUTEUR:
        config.log.warning("EXECUTEUR=0 : la tâche %s attendra qu'un exécuteur soit démarré.", t["id"])
    return _tache(t)


@router.get("/taches")
def recentes(limite: int = 5, _: str = Depends(auth.utilisateur)) -> list[dict]:
    with connexion() as conn:
        rows = conn.execute("SELECT * FROM igeya.taches ORDER BY id DESC LIMIT %s", (max(1, min(50, limite)),)).fetchall()
    return [_tache(t) for t in rows]


@router.get("/taches/{tid}")
def lire(tid: int, _: str = Depends(auth.utilisateur)) -> dict:
    with connexion() as conn:
        t = conn.execute("SELECT * FROM igeya.taches WHERE id = %s", (tid,)).fetchone()
    if not t:
        raise HTTPException(404, "Tâche introuvable.")
    return _tache(t)


@router.post("/taches/{tid}/annuler")
def annuler(tid: int, _: str = Depends(auth.utilisateur)) -> dict:
    with connexion() as conn:
        t = conn.execute(
            """UPDATE igeya.taches SET
                 statut = CASE WHEN statut = 'queued' THEN 'cancelled' ELSE 'cancelling' END,
                 fin = CASE WHEN statut = 'queued' THEN now() ELSE fin END
               WHERE id = %s AND statut IN ('queued', 'running') RETURNING *""",
            (tid,),
        ).fetchone()
    if not t:
        raise HTTPException(409, "Cette tâche n'est plus en cours.")
    return _tache(t)


# ---------------------------------------------------------------- synchronisation

def _synchro(s: dict) -> dict:
    return {
        "id": s["id"], "debut": formats.iso(s["debut"]), "fin": formats.iso(s["fin"]), "depuis": formats.iso(s["depuis"]),
        "statut": s["statut"], "pages": s["pages"], "lignes": s["lignes"], "creees": s["creees"], "maj": s["maj"],
        "message": s["message"], "par": s["par"],
    }


@router.get("/synchro")
def etat_synchro(_: str = Depends(auth.utilisateur)) -> dict:
    with connexion() as conn:
        rows = conn.execute("SELECT * FROM igeya.synchros ORDER BY id DESC LIMIT 5").fetchall()
    return {
        "configuree": bool(config.ESANTE_API_KEY),
        "auto": config.SYNC_AUTO,
        "heure": config.SYNC_HEURE,
        "professions": config.SYNC_PROFESSIONS,
        "historique": [_synchro(s) for s in rows],
    }


@router.post("/synchro")
def lancer_synchro(email: str = Depends(auth.utilisateur)) -> dict:
    if not config.ESANTE_API_KEY:
        raise HTTPException(400, "La clé ESANTE_API_KEY n'est pas configurée sur le serveur.")
    if not synchro.lancer_en_fond(par=email):
        raise HTTPException(409, "Une synchronisation est déjà en cours.")
    return {"ok": True}
