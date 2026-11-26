/**
 * Connecteur « Annuaire Santé » pour IGEYA Enrich — proxy Cloudflare Worker.
 *
 * Pourquoi un proxy ? Le site IGEYA Enrich est statique (GitHub Pages) : il ne peut
 * ni détenir la clé ESANTE-API-KEY (elle serait lisible dans le code), ni appeler
 * directement l'API de l'ANS (bloqué par le navigateur, CORS). Ce Worker fait le
 * pont : il garde la clé côté serveur, interroge l'API FHIR de l'ANS, et renvoie au
 * front des propositions normalisées (le format `RawResult` attendu par un connecteur).
 *
 * Il reprend la logique d'extraction des coordonnées du script Python
 * (annuaire_sante_export.py, fonction `telecoms`) : on parcourt le praticien, ses
 * rôles d'exercice et leurs structures, et on remonte téléphones et e-mails.
 *
 * Déploiement :
 *   wrangler secret put ESANTE_API_KEY   # votre vraie clé du portail de l'ANS
 *   wrangler deploy
 *
 * Appel :
 *   GET /annuaire?rpps=10003461033
 *   GET /annuaire?nom=Durand&prenom=Marie&cp=75011
 */

export interface Env {
  /** Clé du portail Gravitee de l'ANS. Définie en secret, jamais dans le code ni dans wrangler.toml. */
  ESANTE_API_KEY: string;
  /** Origine autorisée pour CORS. Ex : https://t-girard.github.io . « * » = tout le monde (déconseillé). */
  ALLOWED_ORIGIN?: string;
  /** Base de l'API FHIR. Défaut : v2. */
  FHIR_BASE?: string;
}

const DEFAULT_FHIR = 'https://gateway.api.esante.gouv.fr/fhir/v2';

interface RawResult {
  field: 'tel' | 'email';
  raw: string;
  source: string;
  url: string;
  conf: number;
}

function corsHeaders(origin: string | null, allowed?: string): Record<string, string> {
  const allow = !allowed || allowed === '*' ? origin || '*' : allowed;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Un appel FHIR, clé en en-tête, comme le fait le script Python. */
async function fhir(env: Env, path: string): Promise<any> {
  const url = `${(env.FHIR_BASE || DEFAULT_FHIR).replace(/\/$/, '')}${path}`;
  const r = await fetch(url, {
    headers: { 'ESANTE-API-KEY': env.ESANTE_API_KEY, Accept: 'application/fhir+json' },
  });
  if (!r.ok) throw new Error(`FHIR ${r.status} sur ${path}`);
  return r.json();
}

/** Remonte les téléphones et e-mails d'une ressource FHIR (équivalent de `telecoms` dans le script). */
function collectTelecom(resource: any, label: string, out: RawResult[], seen: Set<string>): void {
  for (const t of resource?.telecom ?? []) {
    const v = String(t?.value ?? '').trim();
    if (!v) continue;
    if (t.system === 'phone') {
      const key = 'tel:' + v.replace(/\D/g, '');
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ field: 'tel', raw: v, source: label, url: '', conf: 95 });
      }
    } else if (t.system === 'email') {
      const key = 'email:' + v.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ field: 'email', raw: v, source: label, url: '', conf: 93 });
      }
    }
  }
}

function resources(bundle: any): any[] {
  return (bundle?.entry ?? []).map((e: any) => e?.resource).filter(Boolean);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin, env.ALLOWED_ORIGIN),
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Méthode non autorisée' }), { status: 405, headers });

    const u = new URL(request.url);
    if (!u.pathname.replace(/\/$/, '').endsWith('/annuaire')) {
      return new Response(JSON.stringify({ error: 'Chemin inconnu. Utilisez /annuaire' }), { status: 404, headers });
    }
    if (!env.ESANTE_API_KEY) {
      return new Response(JSON.stringify({ error: 'ESANTE_API_KEY non configurée (wrangler secret put ESANTE_API_KEY).' }), { status: 500, headers });
    }

    const rpps = (u.searchParams.get('rpps') || '').replace(/\D/g, '');
    const nom = (u.searchParams.get('nom') || '').trim();
    const prenom = (u.searchParams.get('prenom') || '').trim();

    try {
      const out: RawResult[] = [];
      const seen = new Set<string>();
      const label = rpps ? `Annuaire Santé · RPPS ${rpps}` : `Annuaire Santé · ${[nom, prenom].filter(Boolean).join(' ')}`;

      // 1) Retrouver le praticien (par RPPS de préférence, sinon par nom/prénom).
      let practId = '';
      if (rpps) {
        const b = await fhir(env, `/Practitioner?identifier=${encodeURIComponent(rpps)}`);
        const p = resources(b).find((r) => r.resourceType === 'Practitioner');
        if (p) {
          practId = p.id;
          collectTelecom(p, label, out, seen);
        }
      } else if (nom) {
        const q = new URLSearchParams({ family: nom });
        if (prenom) q.set('given', prenom);
        const b = await fhir(env, `/Practitioner?${q.toString()}`);
        const p = resources(b).find((r) => r.resourceType === 'Practitioner');
        if (p) {
          practId = p.id;
          collectTelecom(p, label, out, seen);
        }
      }

      // 2) Rôles d'exercice + structures rattachées (coordonnées des lieux d'exercice).
      if (practId) {
        const b = await fhir(
          env,
          `/PractitionerRole?practitioner=${encodeURIComponent(practId)}&_include=PractitionerRole:organization`,
        );
        for (const r of resources(b)) {
          if (r.resourceType === 'PractitionerRole' || r.resourceType === 'Organization') {
            collectTelecom(r, label, out, seen);
          }
        }
      }

      return new Response(JSON.stringify({ results: out, found: Boolean(practId) }), { headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err), results: [] }), { status: 502, headers });
    }
  },
};
