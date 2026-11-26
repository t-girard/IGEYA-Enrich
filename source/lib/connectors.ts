import type { Connector, Fiche, RawResult } from './types';
import { hash, mulberry32, norm } from './text';
import { rawTel } from './phone';
import { genN9, mailOf } from './seed';
import { ANNUAIRE_API } from './config';

/**
 * Un connecteur = une source. Il reçoit une fiche et renvoie des propositions.
 * La normalisation, les doublons, le contrôle et l'historique sont gérés par IGEYA Enrich.
 *
 * Contact Extractor reste simulé (démonstration). « Annuaire Santé » est branché sur
 * la vraie API FHIR de l'ANS dès qu'un backend est configuré (voir lib/config.ts) ;
 * sinon il retombe automatiquement sur des données fictives pour que la démo publique
 * continue de fonctionner sans infrastructure.
 */

const WEBDOM = ['pages-sante-pro.example', 'annuaire-soignants.example', 'cabinet-{ville}.example'];

/** Numéro "réel" fictif d'une fiche : les sources fiables le retrouvent, ce qui permet de simuler des confirmations croisées. */
function truthN9(f: Fiche): string {
  return genN9(mulberry32(hash(f.id + 'truth')), f.cp, hash(f.id) % 4 === 0);
}

const contactExtractor: Connector = {
  id: 'extractor',
  name: 'Contact Extractor',
  kind: 'Recherche web',
  desc: 'Interroge des pages publiques de cabinets et d’annuaires pour retrouver téléphone et e-mail.',
  fields: ['tel', 'email'],
  run(f, all) {
    const r = mulberry32(hash(f.id + 'extractor'));
    const out: RawResult[] = [];
    const roll = r(), roll2 = r(), roll3 = r();
    const base = 52 + Math.floor(r() * 44);
    const variant = Math.floor(r() * 5);
    const mobile = r() < 0.25;
    const dom = WEBDOM[Math.floor(r() * WEBDOM.length)].replace('{ville}', norm(f.ville).replace(/ /g, '-'));
    const slug = norm(f.prenom + ' ' + f.nom).replace(/ /g, '-');
    const url = 'https://' + dom + '/' + slug;
    const label = 'Contact Extractor · ' + dom;
    const push = (field: 'tel' | 'email', raw: string, conf: number) => out.push({ field, raw, source: label, url, conf });

    if (!f.tel) {
      if (roll < 0.66) {
        // Cas simulés : numéro déjà porté par une autre fiche (doublon), numéro tronqué (invalide), cas normal.
        const owner = roll3 < 0.06 ? all.find((o) => o.id !== f.id && o.tel && o.cp === f.cp && norm(o.nom) !== norm(f.nom)) : undefined;
        if (owner) push('tel', rawTel(variant, owner.tel.replace(/\D/g, '').slice(2)), base);
        else if (roll3 > 0.94) push('tel', rawTel(variant, genN9(r, f.cp, false)).slice(0, -3), base);
        else push('tel', rawTel(variant, base < 66 ? genN9(r, f.cp, mobile) : truthN9(f)), base);
      }
    } else if (roll < 0.14) {
      push('tel', rawTel(variant, f.tel.replace(/\D/g, '').slice(2)), Math.max(base, 72));
    } else if (roll < 0.24) {
      push('tel', rawTel(variant, genN9(r, f.cp, mobile)), base);
    }

    if (!f.email) {
      if (roll2 < 0.55) {
        const mailDom = dom.startsWith('cabinet-') ? dom : 'cabinet-' + norm(f.ville).replace(/ /g, '-') + '.example';
        push('email', mailOf(f.prenom, f.nom, mailDom).toUpperCase().replace(/\.EXAMPLE$/, '.example'), Math.max(40, base - 4));
      }
    } else if (roll2 < 0.12) push('email', f.email.toUpperCase(), Math.max(base, 72));
    else if (roll2 < 0.2) push('email', mailOf(f.prenom, f.nom, dom), base);
    return out;
  },
};

/** Version simulée de l'Annuaire Santé : utilisée tant qu'aucun backend n'est configuré. */
function simulateAnnuaire(f: Fiche): RawResult[] {
  const r = mulberry32(hash(f.id + 'rpps'));
  const out: RawResult[] = [];
  const roll = r(), roll2 = r();
  const variant = Math.floor(r() * 5);
  const conf = 90 + Math.floor(r() * 10);
  const label = 'Annuaire Santé · RPPS ' + f.rpps;
  if (!f.tel) {
    if (roll < 0.5) out.push({ field: 'tel', raw: rawTel(variant, truthN9(f)), source: label, url: '', conf });
  } else if (roll < 0.1) {
    out.push({ field: 'tel', raw: rawTel(variant, genN9(r, f.cp, false)), source: label, url: '', conf });
  }
  if (!f.email && roll2 < 0.1) out.push({ field: 'email', raw: mailOf(f.prenom, f.nom, 'mssante-demo.example'), source: label, url: '', conf: conf - 2 });
  return out;
}

/** Appel réel : interroge le Worker, qui interroge l'API FHIR de l'ANS. */
async function fetchAnnuaire(f: Fiche): Promise<RawResult[]> {
  const q = new URLSearchParams();
  if (f.rpps) q.set('rpps', f.rpps);
  if (f.nom) q.set('nom', f.nom);
  if (f.prenom) q.set('prenom', f.prenom);
  if (f.cp) q.set('cp', f.cp);
  const r = await fetch(`${ANNUAIRE_API.replace(/\/$/, '')}/annuaire?${q.toString()}`);
  if (!r.ok) throw new Error(`Annuaire Santé : HTTP ${r.status}`);
  const data = (await r.json()) as { results?: RawResult[] };
  return data.results ?? [];
}

const annuaireSante: Connector = {
  id: 'rpps',
  name: 'Annuaire Santé',
  kind: 'API de référence',
  desc: 'Interroge l’API FHIR publique de l’ANS à partir du numéro RPPS. Peu de résultats, mais fiables.',
  fields: ['tel', 'email'],
  async run(f) {
    if (!ANNUAIRE_API) return simulateAnnuaire(f); // pas de backend → mode simulé (démo publique)
    try {
      return await fetchAnnuaire(f);
    } catch (e) {
      console.warn('[Annuaire Santé]', e);
      return []; // en mode réel, pas de repli trompeur sur des données fictives
    }
  },
};

/** Registre des connecteurs disponibles. Ajouter une source = ajouter une entrée ici. */
export const CONNECTORS: Connector[] = [contactExtractor, annuaireSante];
