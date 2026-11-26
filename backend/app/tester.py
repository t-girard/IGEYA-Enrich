"""Tester un connecteur sur une fiche, sans base de données ni serveur.

    cd backend
    python -m app.tester                                     # liste les connecteurs
    python -m app.tester annuaire_sante --rpps 10003461033
    python -m app.tester ma_source --nom Dupont --prenom Marie --cp 75011

Affiche ce que le connecteur renvoie, puis ce qu'IGEYA Enrich en fera (format unique, validité).
"""
from __future__ import annotations

import argparse
import json
import sys

from . import connecteurs
from .regles import norm_email, norm_tel


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("connecteur", nargs="?")
    for champ in ("rpps", "nom", "prenom", "metier", "adresse", "cp", "ville", "tel", "email"):
        p.add_argument("--" + champ, default="")
    a = p.parse_args()

    reg = connecteurs.charger()
    if not a.connecteur:
        for c in reg.values():
            etat = "prêt" if c.pret else (c.erreur.splitlines()[0] if c.erreur else "manque : " + ", ".join(c.manquantes))
            print(f"{c.id:24} {c.nom:30} {etat}")
        return 0
    c = reg.get(a.connecteur)
    if not c:
        print(f"Connecteur inconnu : {a.connecteur}. Disponibles : {', '.join(reg)}")
        return 1
    if not c.pret:
        print(c.erreur or "Variables d'environnement manquantes : " + ", ".join(c.manquantes))
        return 1
    fiche = {"id": "TEST", "specialite": "", **{k: getattr(a, k) for k in ("rpps", "nom", "prenom", "metier", "adresse", "cp", "ville", "tel", "email")}}
    bruts = c.rechercher(fiche)  # type: ignore[misc]
    print("Renvoyé par le connecteur :")
    print(json.dumps(bruts, ensure_ascii=False, indent=2))
    ok, pb = connecteurs.resultats_valides(c, bruts)
    print("\nCe qu'IGEYA Enrich proposera au contrôle :")
    for r in ok:
        n = norm_tel(r["valeur"]) if r["champ"] == "tel" else norm_email(r["valeur"])
        etat = n.value if n.ok else f"INVALIDE ({n.reason})"
        print(f"  {r['champ']:5} {r['valeur']!r:28} → {etat}   [{r['source']}, confiance {r['confiance']:.0f}]")
    for x in pb:
        print("  ignoré :", x)
    if not ok:
        print("  (aucun résultat)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
