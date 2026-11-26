"""Accès à PostgreSQL (psycopg 3, pool de connexions)."""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from . import config

_pool: ConnectionPool | None = None
RECHERCHE_RAPIDE = False  # pg_trgm disponible ?


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        if not config.DATABASE_URL:
            raise RuntimeError("DATABASE_URL n'est pas définie.")
        _pool = ConnectionPool(
            conninfo=config.DATABASE_URL,
            min_size=1,
            max_size=10,
            kwargs={"row_factory": dict_row},
            open=True,
        )
    return _pool


def close() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def connexion() -> Iterator[psycopg.Connection]:
    """Une connexion dans une transaction : validée en sortie normale, annulée en cas d'erreur."""
    with pool().connection() as conn:
        yield conn


def migrer() -> None:
    """Crée ou met à jour le schéma. Sans danger à chaque démarrage."""
    global RECHERCHE_RAPIDE
    here = Path(__file__).parent
    with connexion() as conn:
        conn.execute((here / "schema.sql").read_text(encoding="utf-8"))
    try:
        with connexion() as conn:
            conn.execute((here / "schema_recherche.sql").read_text(encoding="utf-8"))
    except psycopg.Error as e:  # extension non autorisée : on continue sans
        config.log.warning("pg_trgm indisponible (%s) : recherche et rapprochement simplifiés.", e)
    with connexion() as conn:
        RECHERCHE_RAPIDE = conn.execute("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'").fetchone() is not None
