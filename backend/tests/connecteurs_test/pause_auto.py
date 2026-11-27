NOM = "Pause auto"
DESCRIPTION = "Connecteur de test : demande une pause pendant le traitement de la première fiche."
APPELS_PAR_SECONDE = 1000
_deja = False


def rechercher(fiche):
    global _deja
    if not _deja:
        _deja = True
        from app.db import connexion
        with connexion() as conn:
            conn.execute("UPDATE igeya.taches SET statut = 'pausing' WHERE statut = 'running'")
    return [{"champ": "tel", "valeur": "04 76 88 00 0" + fiche["id"][-1], "confiance": 90}]
