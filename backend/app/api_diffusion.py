"""Diffusion vers ONE (téléphones) et OUTREACH (e-mails) par base partagée.

« Envoyer » dépose une ligne par fiche dans igeya.diffusion (un lot par envoi). ONE et OUTREACH
lisent les lignes non lues de leur destination, puis renseignent lu_le :

    SELECT id, donnees FROM igeya.diffusion WHERE destination = 'ONE' AND lu_le IS NULL ORDER BY id;
    UPDATE igeya.diffusion SET lu_le = now() WHERE id = ANY(...);
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends

from . import auth, formats
from .api_base import invalider_stats
from .db import connexion

router = APIRouter(prefix="/api/diffusion")

# Contenu de chaque message : identique à l'exemple affiché dans l'écran ONE et OUTREACH.
DONNEES = {
    "ONE": """jsonb_build_object('id_externe', f.id, 'rpps', f.rpps, 'nom', f.nom, 'prenom', f.prenom,
               'profession', f.metier, 'code_postal', f.cp, 'telephone', replace(f.tel, ' ', ''),
               'source', f.tel_source, 'mis_a_jour', to_char(f.tel_le, 'YYYY-MM-DD'))""",
    "OUTREACH": """jsonb_build_object('id_externe', f.id, 'email', f.email, 'nom', f.nom, 'prenom', f.prenom,
               'profession', f.metier, 'code_postal', f.cp, 'source', f.email_source,
               'mis_a_jour', to_char(f.email_le, 'YYYY-MM-DD'))""",
}
COND = {"ONE": "f.push_one = 'todo' AND f.tel <> ''", "OUTREACH": "f.push_out = 'todo' AND f.email <> ''"}
PUSH = {"ONE": "push_one", "OUTREACH": "push_out"}


def _panneau(conn, dest: str) -> dict:
    n = conn.execute(f"SELECT count(*) AS n FROM igeya.fiches f WHERE {COND[dest]}").fetchone()["n"]
    rows = conn.execute(
        f"SELECT f.*, {DONNEES[dest]} AS donnees FROM igeya.fiches f WHERE {COND[dest]} ORDER BY f.nom_norm, f.prenom_norm LIMIT 8"
    ).fetchall()
    return {"n": n, "apercu": [formats.fiche(r) for r in rows], "exemple": rows[0]["donnees"] if rows else None}


@router.get("")
def etat(_: str = Depends(auth.utilisateur)) -> dict:
    with connexion() as conn:
        journal = conn.execute(
            """SELECT l.id, l.destination, l.n, l.le, l.par,
                      count(d.id) FILTER (WHERE d.lu_le IS NOT NULL) AS lus
               FROM igeya.lots_diffusion l LEFT JOIN igeya.diffusion d ON d.lot_id = l.id
               GROUP BY l.id ORDER BY l.id DESC LIMIT 12"""
        ).fetchall()
        return {
            "one": _panneau(conn, "ONE"),
            "out": _panneau(conn, "OUTREACH"),
            "journal": [{"at": formats.iso(j["le"]), "dest": j["destination"], "n": j["n"], "lus": j["lus"], "by": j["par"]} for j in journal],
        }


@router.post("/{dest}")
def envoyer(dest: Literal["ONE", "OUTREACH"], email: str = Depends(auth.utilisateur)) -> dict:
    with connexion() as conn:
        cibles = conn.execute(f"SELECT f.id FROM igeya.fiches f WHERE {COND[dest]} FOR UPDATE").fetchall()
        if not cibles:
            return {"n": 0}
        lot = conn.execute(
            "INSERT INTO igeya.lots_diffusion (destination, n, par) VALUES (%s, %s, %s) RETURNING id", (dest, len(cibles), email)
        ).fetchone()["id"]
        conn.execute(
            f"""INSERT INTO igeya.diffusion (lot_id, destination, fiche_id, donnees)
                SELECT %s, %s, f.id, {DONNEES[dest]} FROM igeya.fiches f WHERE f.id = ANY(%s)""",
            (lot, dest, [c["id"] for c in cibles]),
        )
        conn.execute(f"UPDATE igeya.fiches SET {PUSH[dest]} = 'ok' WHERE id = ANY(%s)", ([c["id"] for c in cibles],))
    invalider_stats()
    return {"n": len(cibles), "lot": lot}
