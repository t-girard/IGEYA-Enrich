# Brancher le script Annuaire Santé comme connecteur web réel

Objectif : rendre le connecteur « Annuaire Santé » **réel** (vraie API FHIR de l'ANS),
sans toucher au reste de l'architecture. Deux briques :

1. **Worker Cloudflare** (ce dossier) — le proxy qui détient la clé et appelle l'ANS.
2. **3 fichiers front** (`source/lib/`) — pour que le connecteur appelle le Worker.

Le site reste statique (GitHub Pages). Tant qu'aucune URL de Worker n'est fournie, la
maquette fonctionne comme avant (données simulées) : aucune régression.

---

## 1. Déployer le Worker

```bash
cd worker   # depuis la racine du dépôt
npm install -g wrangler      # ou : npx wrangler ...
wrangler login
wrangler secret put ESANTE_API_KEY   # coller votre clé du portail de l'ANS
# régler ALLOWED_ORIGIN dans wrangler.toml (ex. https://t-girard.github.io)
wrangler deploy
```

Wrangler affiche l'URL publique, du type :
`https://igeya-annuaire-sante.VOTRE-SOUS-DOMAINE.workers.dev`

Test rapide (remplacez par un vrai RPPS) :

```bash
curl "https://igeya-annuaire-sante.VOTRE-SOUS-DOMAINE.workers.dev/annuaire?rpps=10003461033"
# → {"results":[{"field":"tel","raw":"...","source":"Annuaire Santé · RPPS ...","url":"","conf":95}, ...],"found":true}
```

> Rappel : dans l'Annuaire Santé en libre accès, le **téléphone est rare** (les
> coordonnées de correspondance ne sont pas publiques). On remonte surtout les
> coordonnées des lieux d'exercice et les adresses MSSanté. C'est normal d'avoir
> `results: []` pour certaines fiches.

---

## 2. Modifications du front (déjà appliquées dans cette branche)

- `source/lib/config.ts` (nouveau) : résout l'URL du Worker ; vide → mode simulé.
- `source/lib/connectors.ts` : le connecteur `rpps` devient async et appelle le Worker.
- `source/lib/types.ts` : `run` peut renvoyer une `Promise<RawResult[]>`.
- `source/lib/store.ts` : `runEnrich` appelle les connecteurs hors du `set()` immer, puis applique les propositions.

---

## 3. Dire au front où est le Worker, puis republier

Deux options.

**Au build (production).** Avant `npm run build`, poser la variable :

```bash
cd source
echo 'NEXT_PUBLIC_ANNUAIRE_API=https://igeya-annuaire-sante.VOTRE-SOUS-DOMAINE.workers.dev' > .env.local
npm install
npm run build        # régénère source/out/
```

**Sans rebuild (test immédiat sur le site déjà en ligne).** Dans la console du navigateur :

```js
localStorage.setItem('igeya-annuaire-api', 'https://igeya-annuaire-sante.VOTRE-SOUS-DOMAINE.workers.dev');
```

Puis recharger : le connecteur « Annuaire Santé » tape désormais la vraie API.

### Republier sur GitHub Pages
Comme indiqué dans le README du dépôt : remplacer les fichiers compilés à la racine par
le contenu de `source/out/` (en gardant `.nojekyll`, `README.md` et `source/`), puis
pousser sur `main`.

---

## Récapitulatif des flux

```
Navigateur (GitHub Pages, statique)
  └─ connecteur « Annuaire Santé »  ──fetch──►  Worker Cloudflare (détient la clé)
                                                   └─ API FHIR ANS (ESANTE-API-KEY)
  ◄────────── results: RawResult[] ──────────────┘
  └─ zone de transit : normalisation tél., doublons, incertitudes
  └─ contrôle humain : accepter / rejeter
  └─ base de référence  ──►  ONE (téléphone) / OUTREACH (e-mail)
```

La clé ne quitte jamais le serveur. Ajouter une autre source = un nouvel objet
`Connector` dans `connectors.ts` (et, si réseau, un nouveau Worker) : le reste ne bouge pas.
