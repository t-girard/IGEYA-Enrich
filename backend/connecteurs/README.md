# Connecteurs web

Un connecteur est **un fichier Python** dans ce dossier. IGEYA Enrich les découvre au démarrage et les
affiche dans l'écran **Connecteurs web**. Rien d'autre à modifier dans l'application.

## Ajouter un connecteur

1. Copiez `_modele.py` sous un nouveau nom, par exemple `pages_jaunes.py` (lettres minuscules, chiffres et `_`).
2. Remplissez `NOM`, `DESCRIPTION` et la fonction `rechercher(fiche)`.
3. Testez-le sur une fiche, sans base ni serveur :
   ```bash
   cd backend
   python -m app.tester pages_jaunes --nom Dupont --prenom Marie --cp 75011
   ```
4. Si votre connecteur utilise une clé ou un mot de passe, déclarez-le dans `VARIABLES` et ajoutez la
   variable dans Railway (service → **Variables**). Ne mettez jamais une clé dans le code.
5. Poussez sur GitHub : Railway redéploie et le connecteur apparaît dans l'application.

Si une bibliothèque externe est nécessaire (`requests`, `beautifulsoup4`…), ajoutez-la à `backend/requirements.txt`.

## Ce que reçoit et renvoie un connecteur

```python
def rechercher(fiche: dict) -> list:
    # fiche : id, rpps, nom, prenom, metier, specialite, adresse, cp, ville, tel, email
    return [
        {"champ": "tel",   "valeur": "04.76.12.34.56", "source": "Pages Jaunes", "url": "https://…", "confiance": 80},
        {"champ": "email", "valeur": "m.dupont@cabinet.fr", "confiance": 65},
    ]
```

| Clé | Obligatoire | Rôle |
| --- | --- | --- |
| `champ` | oui | `"tel"` ou `"email"` |
| `valeur` | oui | La valeur brute, dans n'importe quel format : IGEYA Enrich la normalise (`+33 X XX XX XX XX`). |
| `source` | non | Libellé affiché dans le contrôle (défaut : `NOM`). |
| `url` | non | Page où la valeur a été trouvée. |
| `confiance` | non | De 0 à 99 (défaut 70). Sous 70, la proposition est signalée « incertaine ». |

## Ce que le connecteur n'a pas à faire

IGEYA Enrich s'occupe de tout le reste : rythme des appels (`APPELS_PAR_SECONDE`), normalisation,
détection des doublons et des divergences, contrôle humain, historique, diffusion vers ONE et OUTREACH.
**Un connecteur n'écrit jamais dans la base** : ses résultats deviennent des propositions à valider.

Une erreur (exception) dans `rechercher()` est notée dans le journal de la tâche, et l'enrichissement
continue avec les fiches suivantes. Un fichier qui ne se charge pas est affiché avec son erreur dans
l'écran, sans empêcher l'application de démarrer.

## Connecteurs fournis

| Fichier | Source |
| --- | --- |
| `annuaire_sante.py` | API FHIR publique de l'ANS (nécessite `ESANTE_API_KEY`). |
| `contact_extractor_cf.py` | Scraping via Chrome/Selenium sur un site Cloudflare (nécessite `CF_SITE_URL`, et optionnellement `LOGIN_URL`, `LOGIN_USER`, `LOGIN_PASS`). Dépendances : `selenium`, `undetected-chromedriver`, `Xvfb` et `google-chrome` installés sur le serveur. |
| `_modele.py` | Modèle commenté (ignoré par l'application). |
