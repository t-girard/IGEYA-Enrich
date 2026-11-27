"""Python et le site doivent normaliser et rapprocher exactement de la même façon.

parite_reference.json contient les résultats du code TypeScript d'origine
(source/lib/phone.ts, text.ts, match.ts) sur une batterie de cas difficiles.
"""
import json
from pathlib import Path

import pytest

from app.regles import lev, norm, norm_cp, norm_email, norm_tel, score_match

REF = json.loads((Path(__file__).parent / "parite_reference.json").read_text(encoding="utf-8"))


def _tel_dict(t):
    d = {"ok": t.ok}
    if t.ok:
        d.update(value=t.value, kind=t.kind, changed=t.changed, note=t.note)
    else:
        if t.empty:
            d["empty"] = True
        d["reason"] = t.reason
    return d


@pytest.mark.parametrize("raw,attendu", REF["tel"])
def test_tel(raw, attendu):
    assert _tel_dict(norm_tel(raw)) == attendu


@pytest.mark.parametrize("raw,attendu", REF["email"])
def test_email(raw, attendu):
    e = norm_email(raw)
    d = {"ok": e.ok}
    if e.ok:
        d["value"] = e.value
    else:
        if e.empty:
            d["empty"] = True
        d["reason"] = e.reason
    assert d == attendu


@pytest.mark.parametrize("raw,attendu", REF["norm"])
def test_norm(raw, attendu):
    assert norm(raw) == attendu


@pytest.mark.parametrize("a,b,attendu", REF["lev"])
def test_lev(a, b, attendu):
    assert lev(a, b) == attendu


@pytest.mark.parametrize("raw,attendu", REF["cp"])
def test_cp(raw, attendu):
    assert norm_cp(raw) == attendu


@pytest.mark.parametrize("r,f,attendu", REF["match"])
def test_match(r, f, attendu):
    assert score_match(r["nom"], r["prenom"], r["cp"], f["nom"], f["prenom"], f["cp"]).as_dict() == attendu
