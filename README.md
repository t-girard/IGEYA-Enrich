# IGEYA Enrich — maquette

Maquette fonctionnelle de la plateforme d'enrichissement des bases de prospects (en amont d'OUTREACH et de ONE).
Toutes les données sont fictives et tous les traitements (connecteurs web, diffusion) sont simulés.

**Identifiants de test** : `demo@igeya.fr` / `Igeya-2026`
(connexion simulée dans le navigateur : elle ne protège rien, c'est une maquette).

## Essayer la maquette

- **En ligne** : via GitHub Pages, si le site est activé (*Settings → Pages → Deploy from a branch → `main` / `/ (root)`*).
- **En local, sans rien installer** : télécharger le dépôt, puis double-cliquer sur `index.html` dans Chrome.
- Fichier de test pour l'import : `exemple_prospects.csv`.

## Contenu du dépôt

| Emplacement | Rôle |
| --- | --- |
| `index.html`, `_next/`, `404.html`, … | Le site **compilé** (export statique de Next.js). C'est ce que GitHub Pages sert. |
| `.nojekyll` | Indispensable : sans lui, GitHub Pages ignore le dossier `_next` et la page s'affiche sans style. |
| `source/` | Le **code source** (Next.js, React, TypeScript). Voir `source/README.md`. |

## Modifier le code puis republier

```bash
cd source
npm install
npm run dev          # test local sur http://localhost:3000
npm run build        # génère source/out/
```

Pour mettre à jour le site, remplacer les fichiers compilés à la racine par le contenu de `source/out/`
(en gardant `.nojekyll`, `README.md` et `source/`), puis pousser sur `main`.
Supprimer d'abord les anciens fichiers compilés (`index.html`, `_next/`, `404.html`, `_not-found*`, `__next*`, `index.txt`) évite d'accumuler des restes d'anciens builds.

## Parcours à tester

1. Connexion.
2. Base de référence : recherche, filtres par métier et code postal, repérage des téléphones et e-mails manquants.
3. Connecteurs web (simulés) : Contact Extractor et Annuaire Santé.
4. Contrôle et validation : source, valeur actuelle, valeur proposée, doublons et correspondances incertaines signalés, téléphone unifié (`+33 X XX XX XX XX`), accepter ou rejeter.
5. Mise à jour de la fiche après validation (source, date, historique).
6. Import CSV ou Excel (`.xlsx`) avec rapprochement sur nom + prénom + code postal.
7. Diffusion simulée vers ONE et OUTREACH.

## Architecture en bref

```
Sources (fichiers, connecteurs web, Annuaire Santé)
  → adaptateurs : une proposition par champ
  → zone de transit : normalisation, rapprochement, doublons, incertitudes
  → contrôle humain : accepter / rejeter
  → base de référence : source et date par coordonnée, historique
  → ONE (téléphone) et OUTREACH (e-mail)
```

Principe : aucune source n'écrit directement dans la base de référence.
