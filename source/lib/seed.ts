import type { Fiche } from './types';
import { mulberry32, norm, pick, wpick } from './text';
import { groupTel } from './phone';

const PRENOMS = ['Camille','Julien','Sophie','Thomas','Nathalie','Antoine','Claire','Mathieu','Isabelle','Nicolas','Émilie','Alexandre','Laure','Maxime','Céline','Romain','Hélène','Vincent','Marion','Pierre','Aurélie','Guillaume','Sandrine','Florent','Léa','Benoît','Karine','Yann','Margaux','Olivier','Inès','Damien','Lucie','Étienne','Amandine','Sébastien'];
const NOMS = ['Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia','David','Bertrand','Roux','Vincent','Fournier','Morel','Girard','André','Mercier','Dupont','Lambert','Bonnet','François','Martinez','Legrand','Garnier','Faure','Rousseau','Blanc','Guérin','Muller','Henry','Roussel','Perrin','Morin','Mathieu','Clément','Gauthier','Dumont','Lopez','Fontaine','Chevalier','Robin','Masson'];
const METIERS: [string, number][] = [['Médecin généraliste',22],['Infirmier(ère) libéral(e)',20],['Masseur-kinésithérapeute',16],['Chirurgien-dentiste',12],['Pharmacien(ne)',10],['Sage-femme',6],['Orthophoniste',6],['Podologue',4],['Orthoptiste',3]];
const VILLES: [string, string, number][] = [['Grenoble','38000',10],['Grenoble','38100',8],['Échirolles','38130',5],['Meylan','38240',4],['Voiron','38500',3],['Lyon','69003',7],['Lyon','69006',6],['Villeurbanne','69100',5],['Chambéry','73000',4],['Annecy','74000',4],['Paris','75011',5],['Paris','75015',5],['Marseille','13006',4],['Toulouse','31000',4],['Bordeaux','33000',3],['Lille','59000',3]];
const RUES = ['rue de la République','avenue Jean Jaurès','boulevard Gambetta','rue Victor Hugo','place de la Mairie','cours Berriat','rue des Écoles','avenue de la Gare','rue Pasteur','rue Saint-Jacques'];
const MAILDOM = ['mail-pro.example','cabinet-sante.example','sante-mail.example'];
const PREF: Record<string, string> = { '38':'476','69':'472','73':'479','74':'450','75':'142','13':'491','31':'561','33':'556','59':'320' };

/** 9 chiffres d'un numéro français (sans le 0 initial), préfixe régional selon le code postal. */
export function genN9(r: () => number, cp: string, mobile: boolean): string {
  const six = () => String(Math.floor(r() * 1e6)).padStart(6, '0');
  if (mobile) return (r() < 0.7 ? '6' : '7') + String(Math.floor(r() * 1e8)).padStart(8, '0');
  return (PREF[cp.slice(0, 2)] || '476') + six();
}

export function mailOf(prenom: string, nom: string, dom: string): string {
  return `${norm(prenom).replace(/ /g, '-')}.${norm(nom).replace(/ /g, '-')}@${dom}`;
}

/** Base de référence fictive : 120 professionnels + 3 doublons volontaires. Toujours identique. */
export function seedData(): Fiche[] {
  const r = mulberry32(20261118);
  const out: Fiche[] = [];
  const used: Record<string, number> = {};
  let guard = 0;
  while (out.length < 120 && guard++ < 5000) {
    const nom = pick(r, NOMS);
    const prenom = pick(r, PRENOMS);
    const k = nom + '|' + prenom;
    if (used[k]) continue;
    used[k] = 1;
    const v = wpick(r, VILLES);
    const metier = wpick(r, METIERS)[0];
    const hasTel = r() < 0.6;
    const hasMail = r() < 0.5;
    const at = '2025-' + String(1 + Math.floor(r() * 10)).padStart(2, '0') + '-' + String(1 + Math.floor(r() * 27)).padStart(2, '0') + 'T09:00:00.000Z';
    const rpps = '10' + String(Math.floor(r() * 1e9)).padStart(9, '0');
    const adresse = 1 + Math.floor(r() * 80) + ' ' + pick(r, RUES);
    const tel = hasTel ? groupTel(genN9(r, v[1], r() < 0.25)) : '';
    const email = hasMail ? mailOf(prenom, nom, pick(r, MAILDOM)) : '';
    out.push({
      id: '', rpps, nom, prenom, metier, adresse, cp: v[1], ville: v[0],
      tel, telSrc: hasTel ? { source: 'Base ONE (reprise initiale)', at } : null,
      email, emailSrc: hasMail ? { source: 'Base ONE (reprise initiale)', at } : null,
      history: [], push: { one: hasTel ? 'ok' : 'na', out: hasMail ? 'ok' : 'na' },
    });
  }
  out.sort((a, b) => a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr'));
  out.forEach((f, i) => {
    f.id = 'IGY-' + String(i + 1).padStart(5, '0');
  });
  [7, 41, 83].forEach((idx, j) => {
    const f = out[idx];
    const tel = f.tel ? '' : groupTel(genN9(r, f.cp, false));
    const mail = f.email ? '' : mailOf(f.prenom, f.nom, MAILDOM[j % 3]);
    const at = '2026-03-1' + (j + 2) + 'T10:00:00.000Z';
    out.push({
      id: 'IGY-' + String(121 + j).padStart(5, '0'), rpps: f.rpps, nom: f.nom, prenom: f.prenom, metier: f.metier,
      adresse: '12 rue Pasteur', cp: f.cp, ville: f.ville,
      tel, telSrc: tel ? { source: 'Saisie manuelle ONE', at } : null,
      email: mail, emailSrc: mail ? { source: 'Saisie manuelle ONE', at } : null,
      history: [], push: { one: tel ? 'ok' : 'na', out: mail ? 'ok' : 'na' },
    });
  });
  out.sort((a, b) => a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr') || a.id.localeCompare(b.id));
  return out;
}

/** Fiches présentes plusieurs fois (même nom, prénom et code postal) : id -> ids des autres exemplaires. */
export function computeDups(fiches: Fiche[]): Map<string, string[]> {
  const groups: Record<string, string[]> = {};
  const dups = new Map<string, string[]>();
  fiches.forEach((f) => {
    const k = norm(f.nom) + '|' + norm(f.prenom) + '|' + f.cp;
    (groups[k] = groups[k] || []).push(f.id);
  });
  Object.values(groups).forEach((g) => {
    if (g.length > 1) g.forEach((id) => dups.set(id, g.filter((x) => x !== id)));
  });
  return dups;
}
