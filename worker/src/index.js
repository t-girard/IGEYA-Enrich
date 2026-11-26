/**
 * Connecteur « Annuaire Santé » pour IGEYA Enrich — proxy Cloudflare Worker.
 *
 * Le site est statique (GitHub Pages) : il ne peut ni détenir la clé ESANTE-API-KEY,
 * ni appeler directement l'API de l'ANS (CORS). Ce Worker garde la clé côté serveur,
 * interroge l'API FHIR de l'ANS et renvoie des propositions { field, raw, source, url, conf }.
 *
 * Réglages (Settings → Variables and Secrets) :
 *   ESANTE_API_KEY  (Secret)   : votre clé du portail de l'ANS
 *   ALLOWED_ORIGIN  (Variable) : https://t-girard.github.io
 *   FHIR_BASE       (Variable, facultatif) : défaut https://gateway.api.esante.gouv.fr/fhir/v2
 *
 * Appel : GET /annuaire?rpps=10003461033  ou  GET /annuaire?nom=Durand&prenom=Marie
 */

const DEFAULT_FHIR = 'https://gateway.api.esante.gouv.fr/fhir/v2';

function corsHeaders(origin, allowed) {
  const allow = !allowed || allowed === '*' ? origin || '*' : allowed;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function fhir(env, path) {
  const url = (env.FHIR_BASE || DEFAULT_FHIR).replace(/\/$/, '') + path;
  const r = await fetch(url, {
    headers: { 'ESANTE-API-KEY': env.ESANTE_API_KEY, Accept: 'application/fhir+json' },
  });
  if (!r.ok) throw new Error('FHIR ' + r.status + ' sur ' + path);
  return r.json();
}

/** Remonte téléphones et e-mails d'une ressource FHIR (équivalent de `telecoms` dans le script Python). */
function collectTelecom(resource, label, out, seen) {
  for (const t of (resource && resource.telecom) || []) {
    const v = String((t && t.value) || '').trim();
    if (!v) continue;
    if (t.system === 'phone') {
      const key = 'tel:' + v.replace(/\D/g, '');
      if (!seen.has(key)) { seen.add(key); out.push({ field: 'tel', raw: v, source: label, url: '', conf: 95 }); }
    } else if (t.system === 'email') {
      const key = 'email:' + v.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push({ field: 'email', raw: v, source: label, url: '', conf: 93 }); }
    }
  }
}

function resources(bundle) {
  return ((bundle && bundle.entry) || []).map((e) => e && e.resource).filter(Boolean);
}

export default {
  async fetch(request, env) {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request.headers.get('Origin'), env.ALLOWED_ORIGIN),
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') return json({ error: 'Méthode non autorisée' }, 405);

    const u = new URL(request.url);
    if (!u.pathname.replace(/\/$/, '').endsWith('/annuaire')) {
      return json({ ok: true, message: 'Connecteur Annuaire Santé actif. Utilisez /annuaire?rpps=...' });
    }
    if (!env.ESANTE_API_KEY) return json({ error: 'Secret ESANTE_API_KEY non configuré.' }, 500);

    const rpps = (u.searchParams.get('rpps') || '').replace(/\D/g, '');
    const nom = (u.searchParams.get('nom') || '').trim();
    const prenom = (u.searchParams.get('prenom') || '').trim();

    try {
      const out = [];
      const seen = new Set();
      const label = rpps ? 'Annuaire Santé · RPPS ' + rpps : 'Annuaire Santé · ' + [nom, prenom].filter(Boolean).join(' ');

      // 1) Retrouver le praticien (RPPS de préférence, sinon nom/prénom).
      let practId = '';
      let path = '';
      if (rpps) path = '/Practitioner?identifier=' + encodeURIComponent(rpps);
      else if (nom) {
        const q = new URLSearchParams({ family: nom });
        if (prenom) q.set('given', prenom);
        path = '/Practitioner?' + q.toString();
      }
      if (path) {
        const p = resources(await fhir(env, path)).find((r) => r.resourceType === 'Practitioner');
        if (p) { practId = p.id; collectTelecom(p, label, out, seen); }
      }

      // 2) Rôles d'exercice + structures rattachées.
      if (practId) {
        const b = await fhir(env, '/PractitionerRole?practitioner=' + encodeURIComponent(practId) + '&_include=PractitionerRole:organization');
        for (const r of resources(b)) {
          if (r.resourceType === 'PractitionerRole' || r.resourceType === 'Organization') collectTelecom(r, label, out, seen);
        }
      }

      return json({ results: out, found: Boolean(practId) });
    } catch (err) {
      return json({ error: String(err), results: [] }, 502);
    }
  },
};
