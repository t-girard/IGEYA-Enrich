/** Minuscules, sans accents, sans ponctuation : sert à comparer des noms. */
export const norm = (s: unknown): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const nowIso = () => new Date().toISOString();

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n > 1 ? pluralForm ?? singular + 's' : singular}`;
}
