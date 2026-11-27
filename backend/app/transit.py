"""Zone de transit : les sources proposent, un humain valide. Port de source/lib/proposals.ts.

Principe : aucune source n'écrit dans une fiche. Connecteurs et fichiers appellent `ajouter_proposition`,
seule `appliquer` (déclenchée par une validation) modifie la fiche, avec source, date et historique.
"""
from __future__ import annotations

import json
from typing import Any

import psycopg

from .regles import norm_email, norm_tel

CHAMPS = ("tel", "email")
COLONNES = {
    "tel": ("tel", "tel_source", "tel_le", "tel_url", "push_one"),
    "email": ("email", "email_source", "email_le", "email_url", "push_out"),
}


def ajouter_proposition(
    conn: psycopg.Connection,
    fiche: dict,
    champ: str,
    brut: Any,
    source: str,
    url: str = "",
    confiance: float = 50,
    origine: str = "",
    score: int | None = None,
    ambigu: bool = False,
) -> str:
    """Normalise, valide, puis crée la proposition ou la fusionne avec une proposition identique.

    Renvoie 'created', 'merged' (même valeur déjà proposée : la source s'ajoute, la confiance monte),
    'same' (la fiche contient déjà cette valeur) ou 'vide'.
    """
    if champ not in CHAMPS or brut is None or str(brut).strip() == "":
        return "vide"
    brut_s = str(brut).strip()
    if champ == "tel":
        n = norm_tel(brut)
        valide, raison = n.ok, n.reason
        propose = n.value if n.ok else brut_s
        format_modifie, genre, note = n.changed, n.kind, n.note
    else:
        e = norm_email(brut)
        valide, raison = e.ok, e.reason
        propose = e.value if e.ok else brut_s
        format_modifie, genre, note = (e.ok and e.value != brut_s), "", ""
    if valide and (fiche.get(champ) or "").lower() == propose.lower():
        return "same"
    src = {"label": source, "url": url or ""}

    for _ in range(2):  # 2e passage seulement si une insertion concurrente a gagné la course
        ex = conn.execute(
            "SELECT id, sources, confiance FROM igeya.propositions"
            " WHERE statut = 'pending' AND fiche_id = %s AND champ = %s AND propose = %s FOR UPDATE",
            (fiche["id"], champ, propose),
        ).fetchone()
        if ex:
            if not any(s.get("label") == src["label"] and s.get("url") == src["url"] for s in ex["sources"]):
                conn.execute(
                    "UPDATE igeya.propositions SET sources = sources || %s::jsonb, confiance = %s WHERE id = %s",
                    (json.dumps([src]), min(99, max(ex["confiance"], round(confiance)) + 8), ex["id"]),
                )
            return "merged"
        row = conn.execute(
            """INSERT INTO igeya.propositions
                 (fiche_id, champ, propose, brut, valide, raison, format_modifie, genre, note,
                  sources, confiance, score_rapprochement, ambigu, origine)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s)
               ON CONFLICT (fiche_id, champ, propose) WHERE statut = 'pending' DO NOTHING
               RETURNING id""",
            (fiche["id"], champ, propose, brut_s, valide, raison or "", format_modifie, genre or "", note or "",
             json.dumps([src]), round(confiance), score, bool(ambigu), origine),
        ).fetchone()
        if row:
            return "created"
    return "merged"


def appliquer(conn: psycopg.Connection, prop_id: int, par: str) -> dict | None:
    """Applique une proposition validée : valeur, source, historique, fiche marquée « à diffuser »."""
    p = conn.execute("SELECT * FROM igeya.propositions WHERE id = %s FOR UPDATE", (prop_id,)).fetchone()
    if not p or p["statut"] != "pending" or not p["valide"]:
        return None
    col, col_src, col_le, col_url, col_push = COLONNES[p["champ"]]
    f = conn.execute(f"SELECT id, prenom, nom, {col} AS actuelle FROM igeya.fiches WHERE id = %s FOR UPDATE", (p["fiche_id"],)).fetchone()
    if not f:
        return None
    label = " + ".join(s.get("label", "") for s in p["sources"])
    url = (p["sources"][0].get("url") if p["sources"] else "") or ""
    conn.execute(
        f"UPDATE igeya.fiches SET {col} = %s, {col_src} = %s, {col_le} = now(), {col_url} = %s,"
        f" {col_push} = 'todo', maj_le = now() WHERE id = %s",
        (p["propose"], label, url, f["id"]),
    )
    conn.execute(
        "INSERT INTO igeya.historique (fiche_id, champ, ancien, nouveau, source, par) VALUES (%s,%s,%s,%s,%s,%s)",
        (f["id"], p["champ"], f["actuelle"] or "", p["propose"], label, par),
    )
    conn.execute("UPDATE igeya.propositions SET statut = 'accepted', decide_le = now(), decide_par = %s WHERE id = %s", (par, prop_id))
    return f


# ---------------------------------------------------------------- signalements

FIABLE_SQL = "statut = 'pending' AND valide AND NOT (f_doublon OR f_incertain OR f_divergence OR f_conflit)"
FLAG_SQL = {
    "invalide": "f_invalide", "doublon": "f_doublon", "incertain": "f_incertain", "divergence": "f_divergence",
    "conflit": "f_conflit", "nouveau": "f_nouveau", "format": "f_format", "multi": "f_multi",
}


def _who(f: dict) -> str:
    return f"{f['prenom']} {f['nom'].upper()} ({f['cp']})"


def details_doublons(conn: psycopg.Connection, rows: list[dict]) -> dict[int, dict]:
    """Pour les propositions signalées « doublon » : la fiche concernée, pour le libellé du signalement."""
    out: dict[int, dict] = {}
    for r in rows:
        if not r["f_doublon"]:
            continue
        if r["champ"] == "tel":
            o = conn.execute(
                "SELECT nom, prenom, cp FROM igeya.fiches WHERE tel = %s AND id <> %s ORDER BY nom_norm, prenom_norm, id LIMIT 1",
                (r["propose"], r["fiche_id"]),
            ).fetchone()
        else:
            o = conn.execute(
                "SELECT nom, prenom, cp FROM igeya.fiches WHERE email <> '' AND lower(email) = lower(%s) AND id <> %s"
                " ORDER BY nom_norm, prenom_norm, id LIMIT 1",
                (r["propose"], r["fiche_id"]),
            ).fetchone()
        if o:
            out[r["id"]] = {"txt": "Cette valeur est déjà sur la fiche " + _who(o)}
            continue
        o = conn.execute(
            "SELECT f.nom, f.prenom, f.cp FROM igeya.propositions p JOIN igeya.fiches f ON f.id = p.fiche_id"
            " WHERE p.statut = 'pending' AND p.valide AND p.champ = %s AND lower(p.propose) = lower(%s) AND p.fiche_id <> %s"
            " ORDER BY p.id LIMIT 1",
            (r["champ"], r["propose"], r["fiche_id"]),
        ).fetchone()
        if o:
            out[r["id"]] = {"txt": "Cette valeur est aussi proposée pour " + _who(o)}
    return out


def signalements(r: dict, doublon: dict | None) -> list[dict]:
    """Même liste, même ordre, mêmes libellés que flagsOf() dans le site."""
    fl: list[dict] = []
    if r["f_invalide"]:
        fl.append({"k": "invalide", "t": "Valeur invalide", "d": r["raison"] or "Format non reconnu", "c": "bad"})
    elif r["f_doublon"] and doublon:
        fl.append({"k": "doublon", "t": "Doublon", "d": doublon["txt"], "c": "warn"})
    if r["f_incertain"]:
        if r["score_rapprochement"] is not None:
            d = f"Rapprochement à {r['score_rapprochement']} %" + (", plusieurs fiches possibles" if r["ambigu"] else "")
        else:
            d = f"Confiance de la source : {r['confiance']} %"
        fl.append({"k": "incertain", "t": "Correspondance incertaine", "d": d, "c": "warn"})
    if r["f_divergence"]:
        fl.append({"k": "divergence", "t": "Sources divergentes", "d": "Plusieurs valeurs différentes sont proposées pour ce champ", "c": "warn"})
    if r["valide"]:
        if r["f_conflit"]:
            fl.append({"k": "conflit", "t": "Remplace la valeur actuelle", "d": "La fiche contient déjà : " + r["actuelle"], "c": "info"})
        else:
            fl.append({"k": "nouveau", "t": "Nouvelle donnée", "d": "Ce champ est vide sur la fiche", "c": "good"})
        if r["format_modifie"]:
            fl.append({"k": "format", "t": "Format uniformisé" if r["champ"] == "tel" else "E-mail normalisé", "d": "Valeur brute : " + r["brut"], "c": "info"})
        if r["note"]:
            fl.append({"k": "format", "t": "Zéro rétabli", "d": r["note"], "c": "info"})
    if len(r["sources"]) > 1:
        fl.append({"k": "multi", "t": f"Confirmé par {len(r['sources'])} sources", "d": " · ".join(s.get("label", "") for s in r["sources"]), "c": "good"})
    return fl
