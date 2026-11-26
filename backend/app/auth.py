"""Connexion : même écran qu'avant, mais vérifiée par le serveur.

Les identifiants sont lus dans la variable APP_USERS. Une connexion réussie pose un cookie signé
(HttpOnly, illisible par le JavaScript de la page). Sans ce cookie, toute l'API répond 401.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from fastapi import HTTPException, Request, Response

from . import config

COOKIE = "igeya_session"


def _sign(payload: bytes) -> str:
    return hmac.new(config.SECRET_KEY.encode(), payload, hashlib.sha256).hexdigest()


def creer_jeton(email: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"e": email, "x": int(time.time()) + config.SESSION_HEURES * 3600}).encode())
    return payload.decode() + "." + _sign(payload)


def lire_jeton(jeton: str | None) -> str | None:
    if not jeton or "." not in jeton:
        return None
    payload, sig = jeton.rsplit(".", 1)
    if not hmac.compare_digest(sig, _sign(payload.encode())):
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(payload.encode()))
    except ValueError:
        return None
    if data.get("x", 0) < time.time():
        return None
    email = data.get("e", "")
    return email if email in config.APP_USERS else None  # compte retiré de APP_USERS = session refusée


def verifier(email: str, mot_de_passe: str) -> bool:
    attendu = config.APP_USERS.get(email.strip().lower())
    return attendu is not None and hmac.compare_digest(attendu.encode(), mot_de_passe.encode())


def poser_cookie(response: Response, request: Request, email: str) -> None:
    https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "") == "https"
    response.set_cookie(
        COOKIE, creer_jeton(email), max_age=config.SESSION_HEURES * 3600,
        httponly=True, secure=https, samesite="lax", path="/",
    )


def utilisateur(request: Request) -> str:
    """Dépendance FastAPI : l'e-mail de l'utilisateur connecté, sinon 401."""
    email = lire_jeton(request.cookies.get(COOKIE))
    if not email:
        raise HTTPException(status_code=401, detail="Session expirée ou absente. Reconnectez-vous.")
    return email
