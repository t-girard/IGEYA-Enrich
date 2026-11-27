# IGEYA Enrich

Plateforme d'enrichissement des fiches de professionnels de santé, en amont de **ONE** (CRM) et
d'**OUTREACH** (marketing). Base de référence alimentée par l'Annuaire Santé, sources multiples
(fichiers, connecteurs web), contrôle humain avant toute écriture, diffusion par base partagée.

```
Sources                         Zone de transit              Contrôle humain        Base de référence        Diffusion
─────────────────────────       ────────────────────         ───────────────        ─────────────────        ─────────────────
Annuaire Santé (chaque nuit) ─┐
Fichiers CSV / Excel ─────────┼─► propositions normalisées ─► accepter / rejeter ─► fiches + historique ─► igeya.diffusion
Connecteurs Python ───────────┘   doublons, incertitudes       seul ou en lot         source et date            lue par ONE
(un fichier = une source)                                                              par coordonnée            et OUTREACH
```

Principe : **aucune source n'écrit directement dans une fiche**. Seule exception, documentée : la
synchronisation Annuaire Santé met à jour l'identité des professionnels et remplit un téléphone ou un
e-mail **vide** ; elle n'écrase jamais une coordonnée existante.

## Contenu du dépôt

| Dossier | Rôle |
| --- | --- |
| `source/` | Le site (Next.js, export statique). Voir `source/README.md`. |
| `backend/app/` | L'API (Python, FastAPI) : connexion, base, contrôle, import, diffusion, tâches de fond, synchro. |
| `backend/connecteurs/` | **Les connecteurs : un fichier Python par source.** Voir `backend/connecteurs/README.md`. |
| `backend/app/ans.py` | Lecture de l'API de l'ANS, reprise du script `annuaire_sante_export.py`. |
| `backend/app/schema.sql` | Le schéma PostgreSQL (tout dans le schéma `igeya`). |
| `Dockerfile`, `railway.json` | Image unique (site + API) et réglages de déploiement Railway. |

## Mise en service sur Railway

1. **Créer le projet** : railway.com → *New Project* → *Deploy from GitHub repo* → `IGEYA-Enrich`.
   Railway détecte le `Dockerfile` et lance la construction.
2. **Ajouter la base** : dans le projet, *+ New* → *Database* → *PostgreSQL*.
3. **Variables du service** (service IGEYA-Enrich → *Variables*) :

   | Variable | Valeur |
   | --- | --- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (référence proposée par Railway) |
   | `APP_USERS` | Les comptes : `prenom.nom@igeya.fr:MotDePasseLong;autre@igeya.fr:AutreMotDePasse` |
   | `SECRET_KEY` | Une longue chaîne aléatoire (signe les sessions) |
   | `ESANTE_API_KEY` | Votre clé du portail de l'ANS |
   | `SYNC_PROFESSIONS` | *Facultatif.* Codes de professions à synchroniser, ex. `10,60` (médecins, infirmiers). Vide = toutes. |
   | `SYNC_HEURE` | *Facultatif.* Heure (Paris) de la synchronisation quotidienne. Défaut : `3`. |

4. **Adresse publique** : service → *Settings* → *Networking* → *Generate Domain*.
5. **Premier chargement** : connectez-vous, puis dans *Base de référence*, cliquez sur
   *Lancer le chargement initial*. Il se poursuit sur le serveur même si vous fermez la page.
   Selon le nombre de professions, il peut durer plusieurs heures (limite de l'ANS : ~17 appels/s).

Ensuite, chaque push sur `main` redéploie automatiquement. La base (schéma, index) se met à jour
toute seule au démarrage.

## Pause et reprise des recherches

Une recherche lancée depuis *Connecteurs web* peut être **mise en pause** : elle s'arrête après la
fiche en cours et garde sa position. **Reprendre** la relance à partir de la fiche suivante, même
plusieurs jours après ; une recherche interrompue par une erreur se reprend de la même façon.
**Abandonner** est définitif. Un redéploiement ne perd rien : la recherche en cours repart seule au
redémarrage, une recherche en pause reste en pause.

## Ajouter un connecteur

Déposer un fichier Python dans `backend/connecteurs/` (copier `_modele.py`), le tester avec
`python -m app.tester mon_connecteur --nom Dupont --prenom Marie --cp 75011`, puis pousser.
Il apparaît dans *Connecteurs web* après le redéploiement. Détails : `backend/connecteurs/README.md`.

## Comment ONE et OUTREACH lisent les données

« Envoyer » (écran *ONE et OUTREACH*) dépose une ligne par fiche dans `igeya.diffusion` :

```sql
SELECT id, donnees FROM igeya.diffusion WHERE destination = 'ONE' AND lu_le IS NULL ORDER BY id;
UPDATE igeya.diffusion SET lu_le = now() WHERE id = ANY(:ids);   -- une fois intégrées
```

Vues de l'état courant : `igeya.v_one_prospects` (téléphones), `igeya.v_outreach_contacts` (e-mails).
Conseil : donner à ONE et OUTREACH un rôle Postgres en lecture seule sur `igeya`, plus le droit
`UPDATE (lu_le)` sur `igeya.diffusion`.

## Développement local

```bash
# API (Python 3.12, PostgreSQL)
cd backend
pip install -r requirements-dev.txt
export DATABASE_URL=postgresql://localhost/igeya APP_USERS="moi@igeya.fr:test" SECRET_KEY=dev
uvicorn app.main:app --reload          # http://localhost:8000/api/docs

# Site (Node 20+)
cd source
npm install
npm run build                           # l'API sert source/out sur http://localhost:8000

# Tests (base jetable)
TEST_DATABASE_URL=postgresql://localhost/igeya_test python -m pytest
```

La CI GitHub (`.github/workflows/ci.yml`) lance ces tests sur un vrai PostgreSQL, vérifie les types
et la compilation du site, et construit l'image Railway à chaque pull request.

