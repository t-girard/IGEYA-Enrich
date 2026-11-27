"""Lecture de l'API FHIR de l'Annuaire Santé (ANS).

Repris de annuaire_sante_export.py : mêmes appels, mêmes nomenclatures, même construction des lignes
(une ligne par professionnel et par lieu d'exercice). Deux changements seulement :
- une erreur lève une exception (enregistrée par la synchronisation) au lieu d'arrêter le programme ;
- il n'y a plus de CSV : synchro.py écrit les lignes dans la base.
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE = "https://gateway.api.esante.gouv.fr/fhir/v2"  # v1 : .../fhir/v1
MIN_INTERVAL = 1 / 15  # limite annoncée : 17 appels/s

# Libellés des professions (nomenclature TRE_G15), utilisés si l'API ne renvoie que le code
PROFESSIONS = {
    "10": "Médecin", "21": "Pharmacien", "26": "Audioprothésiste", "28": "Opticien-lunetier",
    "40": "Chirurgien-dentiste", "50": "Sage-femme", "60": "Infirmier", "69": "Infirmier psychiatrique",
    "70": "Masseur-kinésithérapeute", "80": "Pédicure-podologue", "81": "Orthoprothésiste",
    "82": "Podo-orthésiste", "83": "Orthopédiste-orthésiste", "84": "Oculariste", "85": "Épithésiste",
    "86": "Technicien de laboratoire médical", "91": "Orthophoniste", "92": "Orthoptiste",
    "93": "Psychologue", "94": "Ergothérapeute", "95": "Diététicien", "96": "Psychomotricien",
    "98": "Manipulateur ERM",
}

# Nomenclature de l'ANS -> colonne du CSV
CODE_COLUMNS = {
    "G15": "Profession",
    "R09": "Catégorie professionnelle",
    "R21": "Fonction",
    "R22": "Genre d'activité",
    "R23": "Mode d'exercice",
    "R38": "Spécialité",
    "R39": "Compétence",
    "R40": "Compétence exclusive",
    "R41": "Orientation particulière",
    "R42": "Capacité",
    "R43": "Qualification PAC",
    "R44": "DESC non qualifiant",
    "R45": "DESC qualifiant",
    "R97": "Droit d'exercice complémentaire",
    "R48": "Diplôme",
    "R49": "Diplôme",
    "R14": "Type de diplôme",
    "R11": "Civilité d'exercice",
    "R81": "Civilité",
    "R66": "Catégorie d'établissement",
    "R02": "Secteur d'activité",
    "R72": "Statut juridique",
    "R75": "Catégorie juridique",
}

COLUMNS = [
    "RPPS", "Civilité", "Civilité d'exercice", "Nom", "Prénom",
    "Profession", "Catégorie professionnelle", "Spécialité", "Compétence",
    "Compétence exclusive", "Orientation particulière", "Capacité", "Qualification PAC",
    "DESC non qualifiant", "DESC qualifiant", "Droit d'exercice complémentaire",
    "Diplôme", "Type de diplôme",
    "Mode d'exercice", "Fonction", "Genre d'activité",
    "Structure", "Enseigne", "FINESS établissement", "FINESS juridique", "SIRET", "SIREN",
    "Identifiant structure", "Catégorie d'établissement", "Secteur d'activité",
    "Statut juridique", "Catégorie juridique",
    "Adresse", "Code postal", "Ville", "Code commune", "Pays",
    "Téléphone", "Téléphone 2", "Fax", "E-mail", "MSSanté",
    "Autres codes", "Fiche active", "Dernière mise à jour",
]


# ---------------------------------------------------------------- API

def fetch(url, api_key, retries=5):
    req = urllib.request.Request(url, headers={
        "ESANTE-API-KEY": api_key, "Accept": "application/fhir+json"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            body = e.read().decode("utf-8", "replace")[:500]
            raise RuntimeError(f"Erreur HTTP {e.code} sur {url} : {body}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"Erreur réseau : {e}") from e


def iter_bundles(url, api_key, max_pages=None):
    page, last = 0, 0.0
    while url:
        wait = MIN_INTERVAL - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
        last = time.monotonic()
        bundle = fetch(url, api_key)
        page += 1
        yield page, bundle
        if max_pages and page >= max_pages:
            return
        url = next((l["url"] for l in bundle.get("link", []) if l.get("relation") == "next"), None)


# ---------------------------------------------------------------- lecture des champs

def add(values, col, val):
    """Ajoute une valeur dans une colonne, sans doublon (plusieurs valeurs séparées par « | »)."""
    if val and val not in values.setdefault(col, []):
        values[col].append(val)


def collect_codes(obj, values):
    """Parcourt toute la ressource et range chaque code de nomenclature dans sa colonne."""
    if isinstance(obj, dict):
        if "system" in obj and "code" in obj and "/TRE" in str(obj.get("system", "")):
            system = obj["system"]
            tre = system.split("/")[-1].replace("TRE-", "").replace("TRE_", "").split("-")[0]
            code, label = str(obj["code"]), obj.get("display", "")
            if tre == "G15" and not label:
                label = PROFESSIONS.get(code, "")
            col = CODE_COLUMNS.get(tre)
            if col:
                add(values, col, label or code)
            else:
                add(values, "Autres codes", f"{tre}={label or code}")
        for v in obj.values():
            collect_codes(v, values)
    elif isinstance(obj, list):
        for v in obj:
            collect_codes(v, values)


def id_type(identifier):
    codes = [c.get("code", "") for c in identifier.get("type", {}).get("coding", [])]
    return " ".join(codes + [identifier.get("system", "")]).upper()


def practitioner_ids(prac, values):
    rpps, idnps = "", ""
    for i in prac.get("identifier", []):
        t, v = id_type(i), i.get("value", "")
        if "RPPS" in t and not rpps:
            rpps = v
        elif "IDNPS" in t and not idnps:
            idnps = v
    if not rpps and idnps.startswith("8") and len(idnps) == 12:
        rpps = idnps[1:]
    values["RPPS"] = [rpps or idnps]


def organization_ids(org, values):
    for i in org.get("identifier", []):
        t, v = id_type(i), i.get("value", "")
        if "FINEG" in t:
            add(values, "FINESS établissement", v)
        elif "FINEJ" in t:
            add(values, "FINESS juridique", v)
        elif "SIRET" in t:
            add(values, "SIRET", v)
        elif "SIREN" in t:
            add(values, "SIREN", v)
        elif "FINESS" in t:
            add(values, "FINESS établissement", v)
        else:
            add(values, "Identifiant structure", v)


def address(org, values):
    for a in org.get("address", [])[:1]:
        lines = [l for l in a.get("line", []) if l]
        if not lines:  # adresse découpée en extensions (numéro, voie…)
            for ext_line in a.get("_line", []) or []:
                parts = [e.get("valueString", "") for e in (ext_line or {}).get("extension", [])]
                lines.append(" ".join(p for p in parts if p))
        add(values, "Adresse", a.get("text") or " ".join(lines))
        add(values, "Code postal", a.get("postalCode", ""))
        add(values, "Ville", a.get("city", ""))
        add(values, "Pays", a.get("country", ""))
        for e in a.get("_city", {}).get("extension", []) + a.get("extension", []):
            if "insee" in e.get("url", "").lower() or "commune" in e.get("url", "").lower():
                v = e.get("valueString") or e.get("valueCode") or ""
                if not v and "valueCoding" in e:
                    v = e["valueCoding"].get("code", "")
                add(values, "Code commune", v)


def telecoms(resource, values):
    for t in resource.get("telecom", []):
        system, v = t.get("system", ""), t.get("value", "")
        if system == "phone":
            col = "Téléphone" if not values.get("Téléphone") else "Téléphone 2"
            if v not in values.get("Téléphone", []):
                add(values, col, v)
        elif system == "fax":
            add(values, "Fax", v)
        elif system == "email":
            add(values, "MSSanté" if "mssante" in json.dumps(t).lower() else "E-mail", v)


def build_row(role, prac, org):
    values = {}
    practitioner_ids(prac, values)
    for n in prac.get("name", [])[:1]:
        add(values, "Nom", n.get("family", ""))
        add(values, "Prénom", " ".join(n.get("given", [])))
        for p in n.get("prefix", []):
            add(values, "Civilité d'exercice", p)
    add(values, "Structure", org.get("name", ""))
    for a in org.get("alias", []):
        add(values, "Enseigne", a)
    organization_ids(org, values)
    address(org, values)

    # codes : professionnel, situation d'exercice, structure
    for res in (prac, role, org):
        collect_codes(res, values)

    # coordonnées : d'abord celles du lieu d'exercice, puis celles de la structure, puis le PS
    for res in (role, org, prac):
        telecoms(res, values)

    actif = role.get("active", prac.get("active"))
    values["Fiche active"] = ["" if actif is None else ("oui" if actif else "non")]
    values["Dernière mise à jour"] = [max(
        r.get("meta", {}).get("lastUpdated", "") for r in (role, prac, org))[:10]]
    return {c: " | ".join(values.get(c, [])) for c in COLUMNS}


