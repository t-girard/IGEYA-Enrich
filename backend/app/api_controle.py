"""Contrôle et validation des propositions."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import auth, connecteurs, formats, transit
from .api_base import invalider_stats
from .db import connexion
from .regles import norm

router = APIRouter(prefix="/api")


@router.get("/propositions")
def lister(statut: Literal["pending", "accepted", "rejected"] = "pending", flag: str = "", origine: str = "",
           q: str = "", limite: int = 200, _: str = Depends(auth.utilisateur)) -> dict:
    limite = max(1, min(500, limite))
    conds, params = ["statut = %s"], [statut]
    if flag:
        if flag not in transit.FLAG_SQL:
            raise HTTPException(400, "Contrôle inconnu.")
        conds.append(transit.FLAG_SQL[flag])
    if origine:
        conds.append("origine = %s")
        params.append(origine)
    nq = norm(q)
    if nq:
        conds.append("(nom_norm || ' ' || prenom_norm || ' ' || replace(lower(fiche_id), '-', ' ')) LIKE %s")
        params.append(f"%{nq}%")
    where = " AND ".join(conds)
    with connexion() as conn:
        counts = {"pending": 0, "accepted": 0, "rejected": 0}
        for r in conn.execute("SELECT statut, count(*) AS n FROM igeya.propositions GROUP BY statut").fetchall():
            counts[r["statut"]] = r["n"]
        fiables = conn.execute(f"SELECT count(*) AS n FROM igeya.v_propositions WHERE {transit.FIABLE_SQL}").fetchone()["n"]
        total = conn.execute(f"SELECT count(*) AS n FROM igeya.v_propositions WHERE {where}", params).fetchone()["n"]
        rows = conn.execute(f"SELECT * FROM igeya.v_propositions WHERE {where} ORDER BY id LIMIT %s", [*params, limite]).fetchall()
        dbl = transit.details_doublons(conn, rows)
    return {
        "counts": counts,
        "fiables": fiables,
        "total": total,
        "origines": connecteurs.libelles(),
        "rows": [
            {
                "p": formats.proposition(r),
                "f": {
                    "id": r["fiche_id"], "nom": r["nom"], "prenom": r["prenom"], "metier": r["metier"], "cp": r["cp"], "ville": r["ville"],
                    "current": r["actuelle"], "currentSrc": formats.src(r["actuelle_source"], r["actuelle_le"], None),
                },
                "flags": transit.signalements(r, dbl.get(r["id"])),
            }
            for r in rows
        ],
    }


class Decision(BaseModel):
    action: Literal["accepter", "rejeter", "remettre"]
    ids: list[str]


@router.post("/propositions/decision")
def decider(body: Decision, email: str = Depends(auth.utilisateur)) -> dict:
    ok = ignorees = 0
    fiche = None
    with connexion() as conn:
        for sid in body.ids[:5000]:
            try:
                pid = int(sid)
            except ValueError:
                ignorees += 1
                continue
            if body.action == "accepter":
                f = transit.appliquer(conn, pid, email)
                if f:
                    ok += 1
                    fiche = f
                else:
                    ignorees += 1
            elif body.action == "rejeter":
                r = conn.execute(
                    "UPDATE igeya.propositions SET statut = 'rejected', decide_le = now(), decide_par = %s"
                    " WHERE id = %s AND statut = 'pending' RETURNING id",
                    (email, pid),
                ).fetchone()
                ok, ignorees = (ok + 1, ignorees) if r else (ok, ignorees + 1)
            else:
                # Une même valeur ne peut être en attente qu'une fois par fiche : on ne remet pas un doublon.
                r = conn.execute(
                    """UPDATE igeya.propositions p SET statut = 'pending', decide_le = NULL, decide_par = NULL
                       WHERE p.id = %s AND p.statut = 'rejected'
                         AND NOT EXISTS (SELECT 1 FROM igeya.propositions o WHERE o.statut = 'pending'
                                         AND o.fiche_id = p.fiche_id AND o.champ = p.champ AND o.propose = p.propose)
                       RETURNING id""",
                    (pid,),
                ).fetchone()
                ok, ignorees = (ok + 1, ignorees) if r else (ok, ignorees + 1)
    invalider_stats()
    out: dict = {"ok": ok, "ignorees": ignorees}
    if fiche and ok == 1:
        out["fiche"] = {"prenom": fiche["prenom"], "nom": fiche["nom"]}
    return out


@router.post("/propositions/accepter-fiables")
def accepter_fiables(email: str = Depends(auth.utilisateur)) -> dict:
    n = 0
    with connexion() as conn:
        ids = [r["id"] for r in conn.execute(f"SELECT id FROM igeya.v_propositions WHERE {transit.FIABLE_SQL} ORDER BY id").fetchall()]
        for pid in ids:
            if transit.appliquer(conn, pid, email):
                n += 1
    invalider_stats()
    return {"ok": n}
