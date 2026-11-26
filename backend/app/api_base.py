"""Connexion, indicateurs et base de référence."""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from . import auth, config, formats
from .db import connexion

router = APIRouter(prefix="/api")


class Identifiants(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(body: Identifiants, request: Request, response: Response) -> dict:
    if not config.APP_USERS:
        raise HTTPException(503, "Aucun compte n'est configuré sur le serveur (variable APP_USERS).")
    email = body.email.strip().lower()
    if not auth.verifier(email, body.password):
        time.sleep(0.6)  # freine les essais en série
        raise HTTPException(401, "E-mail ou mot de passe incorrect.")
    auth.poser_cookie(response, request, email)
    return {"email": email}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(auth.COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(email: str = Depends(auth.utilisateur)) -> dict:
    return {"email": email}


@router.get("/health")
def health() -> dict:
    with connexion() as conn:
        conn.execute("SELECT 1")
    return {"ok": True}


# ---------------------------------------------------------------- indicateurs

_cache: dict[str, tuple[float, dict]] = {}


def invalider_stats() -> None:
    _cache.clear()


@router.get("/stats")
def stats(_: str = Depends(auth.utilisateur)) -> dict:
    hit = _cache.get("stats")
    if hit and time.monotonic() - hit[0] < 5:
        return hit[1]
    with connexion() as conn:
        r = conn.execute(
            """SELECT count(*) AS fiches,
                      count(*) FILTER (WHERE tel = '') AS sans_tel,
                      count(*) FILTER (WHERE email = '') AS sans_email,
                      count(*) FILTER (WHERE push_one = 'todo' AND tel <> '') AS a_diffuser_one,
                      count(*) FILTER (WHERE push_out = 'todo' AND email <> '') AS a_diffuser_out,
                      count(*) FILTER (WHERE push_one = 'todo' OR push_out = 'todo') AS a_diffuser
               FROM igeya.fiches"""
        ).fetchone()
        dup = conn.execute(
            "SELECT coalesce(sum(n), 0)::int AS n FROM (SELECT count(*) AS n FROM igeya.fiches GROUP BY dup_key HAVING count(*) > 1) g"
        ).fetchone()
        pend = conn.execute("SELECT count(*) AS n FROM igeya.propositions WHERE statut = 'pending'").fetchone()
    out = {**r, "doublons": dup["n"], "pending": pend["n"]}
    _cache["stats"] = (time.monotonic(), out)
    return out


@router.get("/metiers")
def metiers(_: str = Depends(auth.utilisateur)) -> list[str]:
    with connexion() as conn:
        rows = conn.execute("SELECT DISTINCT metier FROM igeya.fiches WHERE metier <> '' ORDER BY metier").fetchall()
    return [r["metier"] for r in rows]


# ---------------------------------------------------------------- base de référence

@router.get("/fiches")
def lister(q: str = "", metier: str = "", cp: str = "", missing: str = "", page: int = 1, taille: int = 12,
           _: str = Depends(auth.utilisateur)) -> dict:
    taille = max(1, min(100, taille))
    where, params = formats.filtre_fiches(q, metier, cp, missing)
    with connexion() as conn:
        total = conn.execute(f"SELECT count(*) AS n FROM igeya.fiches f WHERE {where}", params).fetchone()["n"]
        pages = max(1, -(-total // taille))
        page = max(1, min(page, pages))
        rows = conn.execute(
            f"""SELECT f.*,
                   (SELECT count(*) FROM igeya.propositions p WHERE p.fiche_id = f.id AND p.statut = 'pending') AS pending,
                   EXISTS (SELECT 1 FROM igeya.fiches d WHERE d.dup_key = f.dup_key AND d.id <> f.id) AS is_dup
                FROM igeya.fiches f WHERE {where}
                ORDER BY f.nom_norm, f.prenom_norm, f.id LIMIT %s OFFSET %s""",
            [*params, taille, (page - 1) * taille],
        ).fetchall()
    return {
        "total": total, "page": page, "pages": pages,
        "rows": [{**formats.fiche(r), "pending": r["pending"], "isDup": r["is_dup"]} for r in rows],
    }


@router.get("/fiches/ids")
def ids(q: str = "", metier: str = "", cp: str = "", missing: str = "", max: int = 400,
        _: str = Depends(auth.utilisateur)) -> list[str]:
    where, params = formats.filtre_fiches(q, metier, cp, missing)
    with connexion() as conn:
        rows = conn.execute(
            f"SELECT f.id FROM igeya.fiches f WHERE {where} ORDER BY f.nom_norm, f.prenom_norm, f.id LIMIT %s",
            [*params, min(max, 5000)],
        ).fetchall()
    return [r["id"] for r in rows]


@router.get("/fiches/{fid}")
def detail(fid: str, _: str = Depends(auth.utilisateur)) -> dict:
    with connexion() as conn:
        r = conn.execute("SELECT * FROM igeya.fiches WHERE id = %s", (fid,)).fetchone()
        if not r:
            raise HTTPException(404, "Fiche introuvable.")
        hist = conn.execute(
            "SELECT le, champ, ancien, nouveau, source, par FROM igeya.historique WHERE fiche_id = %s ORDER BY le DESC, id DESC",
            (fid,),
        ).fetchall()
        dups = conn.execute(
            "SELECT id FROM igeya.fiches WHERE dup_key = %s AND id <> %s ORDER BY id", (r["dup_key"], fid)
        ).fetchall()
        pend = conn.execute(
            "SELECT count(*) AS n FROM igeya.propositions WHERE fiche_id = %s AND statut = 'pending'", (fid,)
        ).fetchone()["n"]
    lieux = sorted(r["lieux"].values(), key=lambda x: (x.get("structure") or "", x.get("ville") or "")) if r["lieux"] else []
    return {
        **formats.fiche(r),
        "history": [
            {"at": formats.iso(h["le"]), "field": h["champ"], "from": h["ancien"], "to": h["nouveau"], "source": h["source"], "by": h["par"]}
            for h in hist
        ],
        "dups": [d["id"] for d in dups],
        "pending": pend,
        "lieux": lieux,
        "creeLe": formats.iso(r["cree_le"]),
        "ansMaj": formats.iso(r["ans_maj"]),
    }
