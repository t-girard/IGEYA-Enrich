import type { Fiche } from './types';
import { rawTel } from './phone';
import { mailOf } from './seed';

const stripAcc = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Fichier d'exemple construit à partir de la base : il couvre tous les cas à montrer
 * (correspondance certaine, faute de frappe, initiale, code postal différent, doublon dans le fichier,
 * numéro invalide, personne inconnue, numéro déjà porté par une autre fiche, zéro initial perdu par Excel).
 */
export function makeSample(fiches: Fiche[], dups: Map<string, string[]>): { headers: string[]; rows: string[][] } {
  const pool = fiches.filter((f) => !dups.has(f.id));
  const noTel = pool.filter((f) => !f.tel);
  const noMail = pool.filter((f) => !f.email && f.tel);
  const both = pool.filter((f) => f.tel && f.email);
  const headers = ['Nom', 'Prénom', 'Code postal', 'Téléphone', 'E-mail', 'Profession'];
  const rows: string[][] = [];
  type Override = Partial<{ nom: string; prenom: string; cp: string; tel: string; email: string }>;
  const add = (f: Fiche, o: Override = {}) =>
    rows.push([o.nom ?? f.nom, o.prenom ?? f.prenom, o.cp ?? f.cp, o.tel ?? '', o.email ?? '', f.metier]);
  const mail = (f: Fiche) => mailOf(f.prenom, f.nom, 'cabinet-sante.example');
  const holder = both[2];

  add(noTel[0], { tel: rawTel(1, '476550123'), email: mail(noTel[0]) });
  add(noTel[1], { nom: noTel[1].nom.toUpperCase(), prenom: stripAcc(noTel[1].prenom), tel: rawTel(3, '472880456') });
  add(noTel[2], { tel: '0612345678' });
  add(noTel[3], { tel: '+33 (0)6 98 76 54 32' });
  add(noMail[0], { email: mail(noMail[0]).toUpperCase() });
  add(noTel[4], { nom: noTel[4].nom[0] + noTel[4].nom.slice(2), tel: rawTel(0, '479310477') });
  add(noTel[5], { prenom: noTel[5].prenom[0] + '.', tel: rawTel(4, '450221188') });
  add(noTel[6], { cp: noTel[6].cp.slice(0, 2) + (noTel[6].cp.slice(2) === '000' ? '100' : '000'), tel: rawTel(1, '476990321') });
  add(noTel[7], { cp: '75010', tel: rawTel(0, '142070809') });
  add(noTel[0], { tel: rawTel(0, '476550199') });
  add(noTel[8], { tel: '04 76 12 34' });
  rows.push(['Orsolya', 'Zéphirin', '38000', '04 76 00 11 22', '', 'Podologue']);
  add(noTel[9], { tel: rawTel(2, holder.tel.replace(/\D/g, '').slice(2)) });
  add(noTel[10], { tel: '476123987' });
  add(both[0], { tel: rawTel(1, both[0].tel.replace(/\D/g, '').slice(2)) });
  add(both[1], { tel: rawTel(0, '476440012') });
  add(noTel[11], { tel: rawTel(3, '472110234'), email: mail(noTel[11]) });
  add(noMail[1], { email: mail(noMail[1]) });
  return { headers, rows };
}
