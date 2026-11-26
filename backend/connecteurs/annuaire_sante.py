"""Connecteur Annuaire Santé : interroge l'API FHIR publique de l'ANS pour une fiche.

Retrouve le professionnel par son RPPS (sinon par nom et prénom), puis remonte les téléphones et
e-mails de sa fiche, de ses lieux d'exercice et des structures rattachées. Même logique que la fonction
`telecoms` du script annuaire_sante_export.py.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

NOM = "Annuaire Santé"
TYPE = "API de référence"
DESCRIPTION = "Interroge l’API FHIR publique de l’ANS à partir du numéro RPPS. Peu de résultats, mais fiables."
CHAMPS = ["tel", "email"]
VARIABLES = ["ESANTE_API_KEY"]
APPELS_PAR_SECONDE = 4  # 2 appels par fiche : ~8 appels/s, sous la limite de l'ANS (~17/s)

BASE = os.environ.get("FHIR_BASE", "https://gateway.api.esante.gouv.fr/fhir/v2").rstrip("/")


def _get(chemin: str) -> dict:
    req = urllib.request.Request(BASE + chemin, headers={
        "ESANTE-API-KEY": os.environ["ESANTE_API_KEY"], "Accept": "application/fhir+json"})
    for essai in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and essai < 2:
                time.sleep(2 ** essai)
                continue
            raise RuntimeError(f"API ANS : HTTP {e.code}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            if essai < 2:
                time.sleep(2 ** essai)
                continue
            raise RuntimeError(f"API ANS injoignable : {e}") from e
    return {}


def _ressources(bundle: dict) -> list:
    return [e["resource"] for e in bundle.get("entry", []) if e.get("resource")]


def rechercher(fiche: dict) -> list:
    rpps = "".join(ch for ch in (fiche.get("rpps") or "") if ch.isdigit())
    if rpps:
        chemin = "/Practitioner?" + urllib.parse.urlencode({"identifier": rpps})
        label = f"Annuaire Santé · RPPS {rpps}"
    elif fiche.get("nom"):
        q = {"family": fiche["nom"]}
        if fiche.get("prenom"):
            q["given"] = fiche["prenom"]
        chemin = "/Practitioner?" + urllib.parse.urlencode(q)
        label = f"Annuaire Santé · {fiche['nom']} {fiche.get('prenom', '')}".strip()
    else:
        return []

    praticien = next((r for r in _ressources(_get(chemin)) if r.get("resourceType") == "Practitioner"), None)
    if not praticien:
        return []
    ressources = [praticien]
    roles = _get("/PractitionerRole?" + urllib.parse.urlencode(
        {"practitioner": praticien["id"], "_include": "PractitionerRole:organization"}))
    ressources += [r for r in _ressources(roles) if r.get("resourceType") in ("PractitionerRole", "Organization")]

    out, vus = [], set()
    for res in ressources:
        for t in res.get("telecom", []):
            valeur = str(t.get("value", "")).strip()
            champ = {"phone": "tel", "email": "email"}.get(t.get("system"))
            if not valeur or not champ or (champ, valeur.lower()) in vus:
                continue
            vus.add((champ, valeur.lower()))
            out.append({"champ": champ, "valeur": valeur, "source": label, "confiance": 95 if champ == "tel" else 93})
    return out
