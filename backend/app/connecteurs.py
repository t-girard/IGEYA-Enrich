"""Registre des connecteurs : chaque fichier .py de backend/connecteurs/ est un connecteur.

Contrat d'un connecteur (voir backend/connecteurs/_modele.py) :

    NOM = "Ma source"                     # obligatoire
    DESCRIPTION = "Ce que fait la source"  # obligatoire
    TYPE = "Recherche web"                 # facultatif
    CHAMPS = ["tel", "email"]              # facultatif : champs qu'il peut trouver
    VARIABLES = ["MA_CLE_API"]             # facultatif : variables d'environnement nécessaires
    APPELS_PAR_SECONDE = 5                 # facultatif : rythme maximal, appliqué par IGEYA Enrich

    def rechercher(fiche: dict) -> list[dict]:
        return [{"champ": "tel", "valeur": "04 76 12 34 56", "source": "...", "url": "...", "confiance": 80}]

Les fichiers dont le nom commence par « _ » sont ignorés (modèles, utilitaires partagés).
Normalisation, doublons, contrôle humain et historique sont gérés par IGEYA Enrich, pas par le connecteur.
"""
from __future__ import annotations

import importlib.util
import os
import re
import sys
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from . import config

ID_VALIDE = re.compile(r"^[a-z0-9_]+$")
RESERVES = {"fichier", "synchro"}
LIBELLES_FIXES = {"fichier": "Fichier importé", "synchro": "Annuaire Santé (synchronisation)"}


@dataclass
class Connecteur:
    id: str
    nom: str
    description: str = ""
    type: str = "Connecteur"
    champs: list[str] = field(default_factory=lambda: ["tel", "email"])
    variables: list[str] = field(default_factory=list)
    appels_par_seconde: float = 5.0
    rechercher: Callable[[dict], Any] | None = None
    erreur: str = ""
    fichier: str = ""

    @property
    def manquantes(self) -> list[str]:
        return [v for v in self.variables if not os.environ.get(v, "").strip()]

    @property
    def pret(self) -> bool:
        return not self.erreur and self.rechercher is not None and not self.manquantes

    def info(self) -> dict:
        return {
            "id": self.id, "nom": self.nom, "type": self.type, "description": self.description,
            "champs": self.champs, "pret": self.pret, "manquantes": self.manquantes, "erreur": self.erreur,
            "fichier": self.fichier,
        }


_registre: dict[str, Connecteur] = {}


def charger(dossier: Path | None = None) -> dict[str, Connecteur]:
    """(Re)charge tous les connecteurs du dossier. Un connecteur cassé est listé avec son erreur."""
    global _registre
    dossier = dossier or config.CONNECTEURS_DIR
    reg: dict[str, Connecteur] = {}
    for chemin in sorted(dossier.glob("*.py")):
        cid = chemin.stem
        if cid.startswith("_"):
            continue
        c = Connecteur(id=cid, nom=cid, fichier=chemin.name)
        if not ID_VALIDE.match(cid) or cid in RESERVES:
            c.erreur = "Nom de fichier invalide : lettres minuscules, chiffres et _ uniquement (et pas « fichier » ni « synchro »)."
            reg[cid] = c
            continue
        try:
            nom_module = f"igeya_connecteurs.{cid}"
            spec = importlib.util.spec_from_file_location(nom_module, chemin)
            mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
            sys.modules[nom_module] = mod
            spec.loader.exec_module(mod)  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001 — on affiche l'erreur dans l'écran plutôt que de planter l'application
            c.erreur = "Erreur au chargement :\n" + traceback.format_exc(limit=3)
            reg[cid] = c
            continue
        c.nom = str(getattr(mod, "NOM", "") or cid)
        c.description = str(getattr(mod, "DESCRIPTION", "") or "")
        c.type = str(getattr(mod, "TYPE", "") or "Connecteur")
        c.champs = [x for x in getattr(mod, "CHAMPS", ["tel", "email"]) if x in ("tel", "email")] or ["tel", "email"]
        c.variables = [str(v) for v in getattr(mod, "VARIABLES", [])]
        try:
            c.appels_par_seconde = max(0.1, float(getattr(mod, "APPELS_PAR_SECONDE", 5)))
        except (TypeError, ValueError):
            c.appels_par_seconde = 5.0
        fn = getattr(mod, "rechercher", None)
        if not callable(fn):
            c.erreur = "Fonction rechercher(fiche) introuvable."
        elif not getattr(mod, "NOM", "") or not c.description:
            c.erreur = "NOM et DESCRIPTION sont obligatoires."
        else:
            c.rechercher = fn
        if getattr(mod, "ACTIF", True) is False:
            continue
        reg[cid] = c
    _registre = reg
    return reg


def tous() -> list[Connecteur]:
    if not _registre:
        charger()
    return list(_registre.values())


def obtenir(cid: str) -> Connecteur | None:
    if not _registre:
        charger()
    return _registre.get(cid)


def libelles() -> dict[str, str]:
    """Libellé de chaque origine possible d'une proposition (filtre « Source » du contrôle)."""
    out = {c.id: c.nom for c in tous()}
    out.update(LIBELLES_FIXES)
    return out


def resultats_valides(c: Connecteur, bruts: Any) -> tuple[list[dict], list[str]]:
    """Vérifie et complète ce que renvoie un connecteur. Renvoie (résultats, problèmes)."""
    ok: list[dict] = []
    pb: list[str] = []
    if bruts is None:
        return ok, pb
    if isinstance(bruts, dict):
        bruts = [bruts]
    if not isinstance(bruts, (list, tuple)):
        return ok, [f"rechercher() doit renvoyer une liste, pas {type(bruts).__name__}"]
    for i, r in enumerate(bruts):
        if not isinstance(r, dict):
            pb.append(f"résultat {i + 1} ignoré : ce n'est pas un dictionnaire")
            continue
        champ = str(r.get("champ", r.get("field", ""))).strip().lower()
        champ = {"telephone": "tel", "téléphone": "tel", "phone": "tel", "mail": "email", "e-mail": "email"}.get(champ, champ)
        valeur = r.get("valeur", r.get("value", r.get("raw")))
        if champ not in c.champs:
            pb.append(f"résultat {i + 1} ignoré : champ « {champ} » non déclaré dans CHAMPS")
            continue
        if valeur is None or str(valeur).strip() == "":
            continue
        try:
            conf = float(r.get("confiance", r.get("conf", 70)))
        except (TypeError, ValueError):
            conf = 70.0
        ok.append({
            "champ": champ,
            "valeur": str(valeur).strip(),
            "source": str(r.get("source") or c.nom),
            "url": str(r.get("url") or ""),
            "confiance": max(0.0, min(99.0, conf)),
        })
    return ok, pb
