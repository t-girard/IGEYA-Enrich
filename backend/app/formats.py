"""Mise en forme JSON (mêmes noms de champs que les types du site) et filtres partagés."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from .regles import norm


def iso(v: datetime | None) -> str | None:
    return v.isoformat() if v else None


def src(source: str | None, le: datetime | None, url: str | None) -> dict | None:
    return {"source": source, "at": iso(le), "url": url or ""} if source else None


def fiche(r: dict) -> dict:
    return {
        "id": r["id"], "rpps": r["rpps"] or "", "nom": r["nom"], "prenom": r["prenom"],
        "metier": r["metier"], "specialite": r["specialite"], "adresse": r["adresse"], "cp": r["cp"], "ville": r["ville"],
        "tel": r["tel"], "telSrc": src(r["tel_source"], r["tel_le"], r["tel_url"]),
        "email": r["email"], "emailSrc": src(r["email_source"], r["email_le"], r["email_url"]),
        "push": {"one": r["push_one"], "out": r["push_out"]}, "actif": r["actif"],
    }


def proposition(r: dict) -> dict:
    return {
        "id": str(r["id"]), "ficheId": r["fiche_id"], "field": r["champ"], "proposed": r["propose"], "raw": r["brut"],
        "valid": r["valide"], "reason": r["raison"], "fmtChanged": r["format_modifie"], "kind": r["genre"], "note": r["note"],
        "sources": r["sources"], "conf": r["confiance"], "matchScore": r["score_rapprochement"], "ambiguous": r["ambigu"],
        "origin": r["origine"], "status": r["statut"], "at": iso(r["cree_le"]), "decidedAt": iso(r["decide_le"]),
    }


MISSING = ("", "tel", "email", "any", "dup")


def like(v: str) -> str:
    """Neutralise % et _ dans un fragment saisi par l'utilisateur."""
    return v.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def filtre_fiches(q: str = "", metier: str = "", cp: str = "", missing: str = "", alias: str = "f") -> tuple[str, list[Any]]:
    """Clause WHERE de la base de référence. Mêmes règles que le filtre du site :
    recherche dans « nom prénom ville » (sans accents), le n° RPPS ou l'identifiant."""
    a = alias
    conds: list[str] = []
    params: list[Any] = []
    nq, rq = norm(q), (q or "").strip().lower()
    if nq or rq:
        parts = []
        if nq:
            parts.append(f"{a}.recherche LIKE %s")
            params.append(f"%{nq}%")
        if rq:
            parts += [f"{a}.rpps LIKE %s", f"lower({a}.id) LIKE %s"]
            params += [f"%{like(rq)}%", f"%{like(rq)}%"]
        conds.append("(" + " OR ".join(parts) + ")")
    if metier:
        conds.append(f"{a}.metier = %s")
        params.append(metier)
    if cp and cp.strip():
        conds.append(f"{a}.cp LIKE %s")
        params.append(like(cp.strip()) + "%")
    if missing == "tel":
        conds.append(f"{a}.tel = ''")
    elif missing == "email":
        conds.append(f"{a}.email = ''")
    elif missing == "any":
        conds.append(f"({a}.tel = '' OR {a}.email = '')")
    elif missing == "dup":
        conds.append(f"EXISTS (SELECT 1 FROM igeya.fiches d WHERE d.dup_key = {a}.dup_key AND d.id <> {a}.id)")
    return (" AND ".join(conds) or "TRUE"), params
