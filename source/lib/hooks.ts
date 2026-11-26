import { useMemo } from 'react';
import { useStore } from './store';
import { computeDups } from './seed';
import { buildCtx } from './proposals';

/** Index des fiches par identifiant. */
export function useFicheMap() {
  const fiches = useStore((s) => s.fiches);
  return useMemo(() => new Map(fiches.map((f) => [f.id, f])), [fiches]);
}

/** Fiches en doublon possible (même nom, prénom et code postal). */
export function useDups() {
  const fiches = useStore((s) => s.fiches);
  return useMemo(() => computeDups(fiches), [fiches]);
}

/** Index utilisé pour signaler les doublons dans l'écran de contrôle. */
export function useCtx() {
  const fiches = useStore((s) => s.fiches);
  const props = useStore((s) => s.props);
  return useMemo(() => buildCtx(fiches, props), [fiches, props]);
}
