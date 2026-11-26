# IGEYA Enrich — le site

Interface de la plateforme (Next.js, React, TypeScript), compilée en fichiers statiques et servie par
l'API Python (`backend/`) à la même adresse. Toutes les données viennent de l'API : le site ne stocke
rien dans le navigateur, hormis le cookie de session.

## Commandes

```bash
npm install
npm run typecheck
npm run build      # génère out/, servi par l'API (variable STATIC_DIR)
```

En développement avec l'API sur un autre port : `NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev`
(l'API doit alors autoriser cette origine ; le plus simple reste `npm run build` puis l'API seule).

## Organisation

| Dossier | Contenu |
| --- | --- |
| `lib/api.ts` | Client de l'API (session par cookie, erreurs, rechargement des écrans). |
| `lib/store.ts` | État de l'interface (écran, filtres, sélection) et actions vers l'API. |
| `lib/types.ts` | Types partagés avec l'API (fiche, proposition, tâche, connecteur…). |
| `lib/phone.ts`, `lib/csv.ts` | Aperçu de la normalisation à l'import, lecture CSV et Excel dans le navigateur. |
| `components/views/` | Un écran par étape du parcours. |

Les règles métier (normalisation des téléphones, rapprochement, signalements) sont appliquées par
l'API (`backend/app/regles.py`, `transit.py`). `lib/phone.ts` n'en garde qu'une copie pour l'aperçu
de l'import ; les tests `backend/tests/test_parite.py` vérifient que les deux donnent le même résultat.
