"""Point d'entrée : l'API sous /api, et le site compilé servi sur le reste.

    uvicorn app.main:app --host 0.0.0.0 --port $PORT
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import api_base, api_controle, api_diffusion, api_import, api_taches, config, connecteurs, db, executeur, synchro

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s : %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.migrer()
    connecteurs.charger()
    for c in connecteurs.tous():
        etat = "prêt" if c.pret else (c.erreur.splitlines()[0] if c.erreur else "variables manquantes : " + ", ".join(c.manquantes))
        config.log.info("Connecteur %s (%s) : %s", c.id, c.nom, etat)
    if config.SECRET_KEY_ALEATOIRE:
        config.log.warning("SECRET_KEY non définie : les sessions seront invalidées à chaque redémarrage.")
    if not config.APP_USERS:
        config.log.warning("APP_USERS est vide : personne ne peut se connecter.")
    if config.EXECUTEUR:
        synchro.nettoyer_interrompues()
        executeur.demarrer()
    yield
    if config.EXECUTEUR:
        executeur.arreter()
    db.close()


app = FastAPI(title="IGEYA Enrich", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
for r in (api_base, api_controle, api_import, api_diffusion, api_taches):
    app.include_router(r.router)


@app.api_route("/api/{reste:path}", methods=["GET", "POST", "PUT", "DELETE"], include_in_schema=False)
def api_inconnue(reste: str):
    return JSONResponse({"detail": "Route inconnue."}, status_code=404)


if config.STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=config.STATIC_DIR, html=True), name="site")
else:
    @app.get("/", include_in_schema=False)
    def accueil():
        return JSONResponse({"detail": f"Site non compilé ({config.STATIC_DIR} introuvable). L'API répond sous /api."})


@app.exception_handler(404)
async def page_inconnue(request, exc):
    if not request.url.path.startswith("/api/") and (config.STATIC_DIR / "index.html").is_file():
        return FileResponse(config.STATIC_DIR / "index.html")
    detail = getattr(exc, "detail", "Introuvable.")
    return JSONResponse({"detail": detail}, status_code=404)
