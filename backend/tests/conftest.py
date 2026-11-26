"""Tests d'intégration : base PostgreSQL réelle (TEST_DATABASE_URL), application complète."""
import os
from pathlib import Path

import pytest

# Avant tout import de l'application : la configuration est lue à l'import.
os.environ.setdefault("DATABASE_URL", os.environ.get("TEST_DATABASE_URL", ""))
os.environ["APP_USERS"] = "test@igeya.fr:Mot-de-passe-test;autre@igeya.fr:Autre"
os.environ["SECRET_KEY"] = "cle-de-test"
os.environ["EXECUTEUR"] = "0"
os.environ["SYNC_AUTO"] = "0"
os.environ["CONNECTEURS_DIR"] = str(Path(__file__).parent / "connecteurs_test")
os.environ["STATIC_DIR"] = str(Path(__file__).parent / "pas_de_site")


def pytest_collection_modifyitems(config, items):
    if os.environ.get("DATABASE_URL"):
        return
    skip = pytest.mark.skip(reason="TEST_DATABASE_URL non définie (tests d'intégration ignorés)")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)


@pytest.fixture()
def client():
    import psycopg
    from fastapi.testclient import TestClient

    from app import db
    from app.main import app

    db.close()
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as c:
        c.execute("DROP SCHEMA IF EXISTS igeya CASCADE")
    with TestClient(app) as cl:
        yield cl
    db.close()


@pytest.fixture()
def connecte(client):
    r = client.post("/api/login", json={"email": "Test@Igeya.fr", "password": "Mot-de-passe-test"})
    assert r.status_code == 200, r.text
    return client


def ajouter_fiche(nom, prenom, cp, tel="", email="", metier="Médecin", ville="Grenoble", rpps=None):
    from app.db import connexion
    from app.regles import norm

    with connexion() as conn:
        return conn.execute(
            """INSERT INTO igeya.fiches (rpps, nom, prenom, nom_norm, prenom_norm, metier, cp, ville, ville_norm, tel, email,
                                         tel_source, email_source, tel_le, email_le, push_one, push_out)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),now(),%s,%s) RETURNING id""",
            (rpps, nom, prenom, norm(nom), norm(prenom), metier, cp, ville, norm(ville), tel, email,
             "Reprise" if tel else None, "Reprise" if email else None, "ok" if tel else "na", "ok" if email else "na"),
        ).fetchone()["id"]
