"""Import de fichier : rapprochement des lignes avec la base, puis envoi au contrôle.

Le navigateur lit le fichier (CSV ou Excel) et envoie les lignes. Le serveur les rapproche de
toute la base, avec les mêmes règles que le site (nom 40 + prénom 35 + code postal 25).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import auth, db, transit
from .api_base import invalider_stats
from .db import connexion
from .regles import LigneImport, norm, norm_cp, rapprocher

router = APIRouter(prefix="/api/import")

MAX_LIGNES = 5000
COLS = "id, nom, prenom, cp, ville"


class Ligne(BaseModel):
    line: int
    nom: str = ""
    prenom: str = ""
    cp: str = ""
    tel: str = ""
    email: str = ""


class Rapprochement(BaseModel):
    lignes: list[Ligne]


@router.post("/rapprocher")
def rapprocher_lignes(body: Rapprochement, _: str = Depends(auth.utilisateur)) -> dict:
    if len(body.lignes) > MAX_LIGNES:
        raise HTTPException(400, f"Au plus {MAX_LIGNES} lignes par import.")
    lignes = [LigneImport(line=l.line, nom=l.nom.strip(), prenom=l.prenom.strip(), cp=norm_cp(l.cp), tel=l.tel.strip(), email=l.email.strip())
              for l in body.lignes]
    noms = sorted({norm(l.nom) for l in lignes if l.nom})
    with connexion() as conn:
        exact: dict[str, list[dict]] = {}
        for r in conn.execute(
            f"SELECT nom_norm, {COLS} FROM igeya.fiches WHERE nom_norm = ANY(%s) ORDER BY nom_norm, prenom_norm, id", (noms,)
        ).fetchall():
            exact.setdefault(r["nom_norm"], []).append(r)
        cache: dict[str, list[dict]] = {}

        def proches(nom_norm: str) -> list[dict]:
            if len(nom_norm) <= 3:
                return []
            if nom_norm not in cache:
                cache[nom_norm] = conn.execute(
                    f"SELECT {COLS} FROM igeya.fiches WHERE nom_norm %% %s AND nom_norm <> %s"
                    " AND abs(length(nom_norm) - length(%s)) <= 1 ORDER BY nom_norm, prenom_norm, id LIMIT 2000",
                    (nom_norm, nom_norm, nom_norm),
                ).fetchall()
            return cache[nom_norm]

        res = rapprocher(lignes, lambda n: exact.get(n, []), proches if db.RECHERCHE_RAPIDE else None)
    out = []
    for r in res:
        d = {"line": r.line, "nom": r.nom, "prenom": r.prenom, "cp": r.cp, "tel": r.tel, "email": r.email, "status": r.status}
        if r.dupOf is not None:
            d["dupOf"] = r.dupOf
        if r.best:
            f = r.best["fiche"]
            d["best"] = {"ficheId": r.best["ficheId"], "m": r.best["m"],
                         "fiche": {"id": f["id"], "nom": f["nom"], "prenom": f["prenom"], "cp": f["cp"], "ville": f["ville"]}}
            d["ambiguous"] = r.ambiguous
        out.append(d)
    return {"result": out, "fuzzy": db.RECHERCHE_RAPIDE}


class LigneEnvoi(BaseModel):
    line: int
    ficheId: str
    tel: str = ""
    email: str = ""
    score: int
    ambigu: bool = False


class Envoi(BaseModel):
    fichier: str
    lignes: list[LigneEnvoi]


@router.post("/envoyer")
def envoyer(body: Envoi, _: str = Depends(auth.utilisateur)) -> dict:
    counts = {"created": 0, "merged": 0, "same": 0}
    ids = list({l.ficheId for l in body.lignes})
    with connexion() as conn:
        fiches = {r["id"]: r for r in conn.execute("SELECT id, tel, email FROM igeya.fiches WHERE id = ANY(%s)", (ids,)).fetchall()}
        for l in body.lignes[:MAX_LIGNES]:
            f = fiches.get(l.ficheId)
            if not f:
                continue
            for champ in ("tel", "email"):
                val = getattr(l, champ)
                if not val:
                    continue
                st = transit.ajouter_proposition(
                    conn, f, champ, val, source=f"Fichier {body.fichier} (ligne {l.line})",
                    confiance=l.score, origine="fichier", score=l.score, ambigu=l.ambigu,
                )
                if st in counts:
                    counts[st] += 1
    invalider_stats()
    return counts
