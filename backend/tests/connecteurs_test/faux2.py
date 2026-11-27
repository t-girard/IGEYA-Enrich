NOM = "Faux 2"
DESCRIPTION = "Second connecteur de test : confirme le même numéro (fusion)."
APPELS_PAR_SECONDE = 1000

def rechercher(fiche):
    if fiche["nom"] == "Sansresultat":
        return []
    return [{"champ": "tel", "valeur": "+33476990" + "0" + fiche["id"][-2:], "confiance": 75},
            {"champ": "email", "valeur": "Contact." + fiche["nom"] + "@Exemple.FR", "confiance": 60}]
