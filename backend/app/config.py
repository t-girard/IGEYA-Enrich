"""Réglages, tous lus dans les variables d'environnement (onglet « Variables » du service Railway)."""
from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path

log = logging.getLogger("igeya")

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


# Base PostgreSQL (Railway la fournit : ${{Postgres.DATABASE_URL}}).
DATABASE_URL = _env("DATABASE_URL")

# Comptes autorisés : « email:motdepasse », séparés par des points-virgules ou des retours à la ligne.
# Ex. : APP_USERS="thomas@igeya.fr:Un-Mot-De-Passe-Long;seb@igeya.fr:Un-Autre"
def _users(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in raw.replace("\n", ";").split(";"):
        if ":" in part:
            email, pw = part.split(":", 1)
            if email.strip() and pw:
                out[email.strip().lower()] = pw
    return out


APP_USERS = _users(_env("APP_USERS"))

# Clé qui signe les sessions. Sans elle, une clé aléatoire est tirée au démarrage
# (les utilisateurs devront se reconnecter après chaque redéploiement).
SECRET_KEY = _env("SECRET_KEY")
SECRET_KEY_ALEATOIRE = not SECRET_KEY
if not SECRET_KEY:
    SECRET_KEY = secrets.token_hex(32)

SESSION_HEURES = int(_env("SESSION_HEURES", "12") or 12)

# Site compilé (Next.js, export statique) servi par l'API.
STATIC_DIR = Path(_env("STATIC_DIR") or REPO_DIR / "source" / "out")

# Dossier des connecteurs : un fichier .py = un connecteur.
CONNECTEURS_DIR = Path(_env("CONNECTEURS_DIR") or BACKEND_DIR / "connecteurs")

# Exécuteur de tâches de fond (enrichissements, synchronisation planifiée). « 0 » pour le couper.
EXECUTEUR = _env("EXECUTEUR", "1") != "0"

# Synchronisation Annuaire Santé.
ESANTE_API_KEY = _env("ESANTE_API_KEY")
FHIR_BASE = _env("FHIR_BASE") or "https://gateway.api.esante.gouv.fr/fhir/v2"
SYNC_AUTO = _env("SYNC_AUTO", "1") != "0"
SYNC_HEURE = int(_env("SYNC_HEURE", "3") or 3)  # heure de Paris
SYNC_PROFESSIONS = [p.strip() for p in _env("SYNC_PROFESSIONS").split(",") if p.strip()]
SYNC_PAGE = int(_env("SYNC_PAGE", "100") or 100)
SYNC_MAX_PAGES = int(_env("SYNC_MAX_PAGES", "0") or 0)  # 0 = sans limite (test : 2)
