NOM = "Faux"
DESCRIPTION = "Connecteur de test : un numéro selon le nom."
APPELS_PAR_SECONDE = 1000

def rechercher(fiche):
    if fiche["nom"] == "Sansresultat":
        return []
    return [{"champ": "tel", "valeur": "04.76.99.00." + fiche["id"][-2:], "url": "https://faux.example/" + fiche["id"], "confiance": 80}]
