/**
 * URL du connecteur Annuaire Santé (le Worker Cloudflare).
 *
 * Résolution, par ordre de priorité :
 *   1. localStorage['igeya-annuaire-api']      → pratique pour tester sans rebuild
 *   2. window.__ANNUAIRE_API__                 → injectable à la volée
 *   3. NEXT_PUBLIC_ANNUAIRE_API (au build)     → valeur de production
 *   4. "" (vide)                               → le connecteur reste en mode simulé
 *
 * Tant que cette valeur est vide, la maquette fonctionne exactement comme avant
 * (données fictives). Dès qu'une URL est fournie, le connecteur « Annuaire Santé »
 * interroge la vraie API de l'ANS via le Worker.
 */
export const ANNUAIRE_API: string =
  (typeof window !== 'undefined' &&
    (window.localStorage?.getItem('igeya-annuaire-api') ||
      (window as unknown as { __ANNUAIRE_API__?: string }).__ANNUAIRE_API__)) ||
  process.env.NEXT_PUBLIC_ANNUAIRE_API ||
  '';
