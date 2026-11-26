# IGEYA Enrich — maquette Next.js

Maquette fonctionnelle de la plateforme d'enrichissement des bases de prospects, en amont d'OUTREACH et de ONE.
Toutes les données sont fictives, tous les traitements sont simulés.

**Identifiants de test** : `demo@igeya.fr` / `Igeya-2026`
(connexion simulée côté navigateur : elle ne protège rien, c'est une maquette.)

## Tester sans rien installer

Ouvrir le dossier `out/` (version déjà compilée) et double-cliquer sur `index.html` dans Chrome.
Vérifié en `file://` : connexion, base, import CSV et Excel (.xlsx), connecteurs, contrôle, diffusion.
Le fichier `exemple_prospects.csv` est fourni pour tester l'import (ou bouton « Utiliser un fichier d'exemple »).

## Lancer le projet

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # génère out/ (export statique)
npm start          # sert out/ en local
npm run typecheck
```

Prérequis : Node.js 20 ou plus.

## Parcours à tester

1. Connexion.
2. Base de référence : recherche, filtre par métier et code postal, repérage des téléphones et e-mails manquants, sélection de fiches.
3. Connecteurs web : lancer Contact Extractor et Annuaire Santé (simulés) sur la sélection.
4. Contrôle et validation : source, valeur actuelle, valeur proposée, doublons et correspondances incertaines signalés, téléphone unifié en `+33 X XX XX XX XX`. Accepter ou rejeter, seul ou en lot.
5. La fiche se met à jour après validation (source, date, historique).
6. Import CSV ou Excel : rapprochement sur nom + prénom + code postal, puis envoi vers le contrôle.
7. ONE et OUTREACH : diffusion simulée des fiches validées.

## Architecture

```
Sources (fichiers, connecteurs web, Annuaire Santé)
  → adaptateurs : une proposition par champ
  → zone de transit : normalisation, rapprochement, doublons, incertitudes
  → contrôle humain : accepter / rejeter
  → base de référence : une fiche par professionnel, source et date par coordonnée, historique
  → ONE (téléphone) et OUTREACH (e-mail)
```

Principe : aucune source n'écrit directement dans la base de référence.

| Dossier | Contenu |
| --- | --- |
| `lib/types.ts` | Modèle de données (fiche, proposition, signalements) |
| `lib/connectors.ts` | Contrat d'un connecteur et registre : ajouter une source = ajouter un objet |
| `lib/proposals.ts` | Zone de transit : création, fusion et application des propositions, signalements |
| `lib/match.ts`, `lib/phone.ts`, `lib/csv.ts` | Rapprochement, normalisation, lecture CSV et Excel |
| `lib/store.ts` | État global (zustand + immer), sauvegarde locale dans le navigateur |
| `components/views/` | Un écran par étape du parcours |

Stockage : `localStorage` uniquement (clé `igeya-enrich-next-demo-v1`). Le bouton « Réinitialiser la démo » remet les données de départ.
