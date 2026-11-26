"""MODÈLE DE CONNECTEUR — copiez ce fichier pour créer le vôtre.

1. Copiez-le sous un nouveau nom, sans « _ » au début : backend/connecteurs/ma_source.py
   (lettres minuscules, chiffres et _ ; ce nom sert d'identifiant).
2. Remplissez NOM, DESCRIPTION et la fonction rechercher().
3. Testez-le sur une fiche :
       cd backend
       python -m app.tester ma_source --nom Dupont --prenom Marie --cp 75011
4. Poussez sur GitHub : Railway redéploie, le connecteur apparaît dans « Connecteurs web ».

Les fichiers commençant par « _ » sont ignorés : celui-ci n'apparaît donc pas dans l'application.
"""

# --- Obligatoire --------------------------------------------------------------------------------
NOM = "Ma source"                         # nom affiché dans l'écran Connecteurs web
DESCRIPTION = "Ce que fait la source, en une phrase."

# --- Facultatif ---------------------------------------------------------------------------------
TYPE = "Recherche web"                    # sous-titre de la carte (« API », « Annuaire », …)
CHAMPS = ["tel", "email"]                 # ce que le connecteur peut trouver
VARIABLES = []                            # ex. ["MA_SOURCE_CLE_API"] : à définir dans Railway → Variables.
                                          # Tant qu'elles manquent, le connecteur est affiché « à configurer ».
APPELS_PAR_SECONDE = 2                    # rythme maximal : IGEYA Enrich attend entre deux fiches.


def rechercher(fiche: dict) -> list:
    """Reçoit une fiche, renvoie ce que la source a trouvé.

    `fiche` contient : id, rpps, nom, prenom, metier, specialite, adresse, cp, ville, tel, email
    (tel et email sont les valeurs actuelles, éventuellement vides).

    Renvoyez une liste de dictionnaires :
        champ      "tel" ou "email"                       (obligatoire)
        valeur     la valeur trouvée, dans n'importe quel format : « 04.76.12.34.56 » convient,
                   IGEYA Enrich la met au format +33 X XX XX XX XX   (obligatoire)
        source     ce qui s'affichera dans le contrôle    (facultatif, défaut : NOM)
        url        la page où la valeur a été trouvée      (facultatif)
        confiance  de 0 à 99 ; sous 70, la proposition est signalée « incertaine »  (défaut : 70)

    Rien trouvé : renvoyez []. Une erreur (exception) est enregistrée dans le journal de la tâche
    sans arrêter l'enrichissement des autres fiches.

    Conseils : mettez toujours un délai maximal (timeout) à vos appels réseau, et ne modifiez
    jamais la base vous-même : vos résultats passent par le contrôle humain.
    """
    # Exemple avec la bibliothèque standard (urllib) :
    #
    #   import json, os, urllib.parse, urllib.request
    #   url = "https://api.exemple.fr/recherche?" + urllib.parse.urlencode(
    #       {"nom": fiche["nom"], "prenom": fiche["prenom"], "cp": fiche["cp"]})
    #   req = urllib.request.Request(url, headers={"Authorization": os.environ["MA_SOURCE_CLE_API"]})
    #   with urllib.request.urlopen(req, timeout=20) as r:
    #       data = json.load(r)
    #   return [{"champ": "tel", "valeur": data["telephone"], "url": data["page"], "confiance": 80}]
    #
    # Une bibliothèque externe (requests, beautifulsoup4…) s'ajoute dans backend/requirements.txt.
    return []
