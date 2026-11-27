"""Règles métier : normalisation des coordonnées et rapprochement de fiches.

Port fidèle de la logique du site (source/lib/phone.ts, text.ts, match.ts) : un numéro saisi
« 04.76.12.34.56 » ou « +33 (0)4 76 12 34 56 » devient « +33 4 76 12 34 56 », partout et toujours.
Les tests de parité (tests/test_parite.py) vérifient que Python et TypeScript donnent les mêmes résultats.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

_ACCENTS = re.compile("[̀-ͯ]")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def norm(s: object) -> str:
    """Minuscules, sans accents, sans ponctuation : sert à comparer des noms."""
    t = unicodedata.normalize("NFD", "" if s is None else str(s))
    t = _ACCENTS.sub("", t).lower()
    return _NON_ALNUM.sub(" ", t).strip()


def plural(n: int, singulier: str, pluriel: str | None = None) -> str:
    return f"{n} {(pluriel or singulier + 's') if n > 1 else singulier}"


def lev(a: str, b: str) -> int:
    """Distance de Levenshtein : tolère une faute de frappe dans un nom."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (0 if a[i - 1] == b[j - 1] else 1))
        prev = cur
    return prev[len(b)]


# ---------------------------------------------------------------- téléphone et e-mail

@dataclass
class Tel:
    ok: bool
    value: str = ""
    kind: str = ""  # 'Mobile' | 'Fixe'
    changed: bool = False
    note: str = ""
    empty: bool = False
    reason: str = ""


@dataclass
class Email:
    ok: bool
    value: str = ""
    empty: bool = False
    reason: str = ""


def group_tel(n9: str) -> str:
    """Format unique de stockage et de diffusion : +33 X XX XX XX XX (n9 = 9 chiffres sans le 0)."""
    return f"+33 {n9[0]} {n9[1:3]} {n9[3:5]} {n9[5:7]} {n9[7:9]}"


def norm_tel(raw: object) -> Tel:
    """Reconnaît les formats courants (points, tirets, +33, 0033, zéro manquant) et les ramène au format unique."""
    s = ("" if raw is None else str(raw)).strip()
    if not s:
        return Tel(ok=False, empty=True, reason="Valeur vide")
    s = s.replace("(0)", "")
    d = re.sub(r"[^0-9+]", "", s)
    d = "+" + d[1:].replace("+", "") if d.startswith("+") else d.replace("+", "")
    note = ""
    if d.startswith("+33"):
        n = d[3:]
    elif d.startswith("0033"):
        n = d[4:]
    elif re.fullmatch(r"33[0-9]{9}", d):
        n = d[2:]
    elif re.fullmatch(r"0[0-9]{9}", d):
        n = d[1:]
    elif re.fullmatch(r"[1-9][0-9]{8}", d):
        n = d
        note = "Zéro initial manquant (export Excel), rétabli"
    else:
        hors_france = re.match(r"^\+(?!33)", d) is not None
        return Tel(ok=False, reason="Numéro hors France non géré" if hors_france else "Numéro incomplet ou format non reconnu")
    n = re.sub(r"^0", "", n)
    if not re.fullmatch(r"[1-9][0-9]{8}", n):
        return Tel(ok=False, reason="Numéro incomplet ou trop long")
    if n[0] == "8":
        return Tel(ok=False, reason="Numéro spécial (08) non retenu")
    value = group_tel(n)
    return Tel(ok=True, value=value, kind="Mobile" if n[0] in "67" else "Fixe", changed=s != value, note=note)


_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


def norm_email(raw: object) -> Email:
    s = ("" if raw is None else str(raw)).strip().lower()
    if not s:
        return Email(ok=False, empty=True, reason="Valeur vide")
    if not _EMAIL.match(s):
        return Email(ok=False, reason="Adresse e-mail mal formée")
    return Email(ok=True, value=s)


def norm_cp(v: object) -> str:
    d = re.sub(r"[^0-9]", "", "" if v is None else str(v))
    if len(d) == 4:
        d = "0" + d  # Excel supprime le zéro initial des codes postaux
    return d[:5]


# ---------------------------------------------------------------- rapprochement

@dataclass
class Score:
    score: int
    tN: str = "différent"
    tP: str = "différent"
    tC: str = "différent"

    def as_dict(self) -> dict:
        return {"score": self.score, "tN": self.tN, "tP": self.tP, "tC": self.tC}


def score_match(nom: str, prenom: str, cp: str, f_nom: str, f_prenom: str, f_cp: str) -> Score:
    """Score sur 100 : nom (40) + prénom (35) + code postal (25). Un nom sans ressemblance exclut la fiche."""
    n1, n2, p1, p2 = norm(nom), norm(f_nom), norm(prenom), norm(f_prenom)
    sc = Score(0)
    s_n = s_p = s_c = 0
    if n1 and n1 == n2:
        s_n, sc.tN = 40, "identique"
    elif n1 and n2 and min(len(n1), len(n2)) > 3 and lev(n1, n2) <= 1:
        s_n, sc.tN = 26, "proche"
    if not s_n:
        return sc
    if p1 and p1 == p2:
        s_p, sc.tP = 35, "identique"
    elif p1 and p2 and p1[0] == p2[0] and (len(p1) == 1 or len(p2) == 1):
        s_p, sc.tP = 20, "initiale"
    elif p1 and p2 and min(len(p1), len(p2)) > 3 and lev(p1, p2) <= 1:
        s_p, sc.tP = 22, "proche"
    if cp and cp == f_cp:
        s_c, sc.tC = 25, "identique"
    elif cp and cp[:2] == f_cp[:2]:
        s_c, sc.tC = 10, "même département"
    sc.score = s_n + s_p + s_c
    return sc


@dataclass
class LigneImport:
    line: int
    nom: str
    prenom: str
    cp: str
    tel: str
    email: str
    status: str = "aucune"  # certain | incertain | aucune | doublon
    dupOf: int | None = None
    best: dict | None = None
    ambiguous: bool = False
    extra: dict = field(default_factory=dict)


def rapprocher(lignes: list[LigneImport], exacts, proches=None) -> list[LigneImport]:
    """Rapproche chaque ligne d'une fiche. Les lignes répétées dans le fichier sont fusionnées.

    `exacts(nom_norm)` renvoie les fiches portant exactement ce nom, `proches(nom_norm)` celles dont le
    nom est voisin (faute de frappe). Les fiches sont des dict avec id, nom, prenom, cp.
    Les noms voisins ne sont cherchés que si aucune fiche n'obtient 100 : un nom voisin plafonne à 86,
    il ne peut donc ni battre ni rendre ambigu un 100. Le résultat est identique à une comparaison complète.
    """
    def candidats_pour(row: LigneImport):
        nom_norm = norm(row.nom)
        base = list(exacts(nom_norm))
        if proches is None:
            return base
        best = max((score_match(row.nom, row.prenom, row.cp, f["nom"], f["prenom"], f["cp"]).score for f in base), default=0)
        if best >= 100:
            return base
        ids = {f["id"] for f in base}
        return base + [f for f in proches(nom_norm) if f["id"] not in ids]

    seen: dict[str, LigneImport] = {}
    out: list[LigneImport] = []
    for row in lignes:
        if not row.nom and not row.prenom:
            continue
        key = f"{norm(row.nom)}|{norm(row.prenom)}|{row.cp}"
        first = seen.get(key)
        if first:
            if not first.tel and row.tel:
                first.tel = row.tel
            if not first.email and row.email:
                first.email = row.email
            row.status, row.dupOf = "doublon", first.line
            out.append(row)
            continue
        seen[key] = row
        cands = []
        for f in candidats_pour(row):
            m = score_match(row.nom, row.prenom, row.cp, f["nom"], f["prenom"], f["cp"])
            if m.score >= 60:
                cands.append((f, m))
        cands.sort(key=lambda c: -c[1].score)
        if not cands:
            row.status = "aucune"
            out.append(row)
            continue
        bf, bm = cands[0]
        row.best = {"ficheId": bf["id"], "m": bm.as_dict(), "fiche": bf}
        row.ambiguous = len(cands) > 1 and cands[1][1].score >= bm.score - 5 and cands[1][0]["id"] != bf["id"]
        row.status = "certain" if bm.score >= 90 and not row.ambiguous else "incertain"
        out.append(row)
    return out
