'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Client de l'API IGEYA Enrich. Le site et l'API sont servis à la même adresse :
 * la session est un cookie que le navigateur envoie tout seul.
 * NEXT_PUBLIC_API_BASE ne sert qu'en développement (API lancée sur un autre port).
 */
const BASE = (process.env.NEXT_PUBLIC_API_BASE || '').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: () => void = () => {};
/** Appelé quand le serveur répond 401 : la session a expiré. */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(BASE + '/api' + path, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: BASE ? 'include' : 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Serveur injoignable. Vérifiez votre connexion.');
  }
  if (r.status === 401 && path !== '/login' && path !== '/me') onUnauthorized();
  if (!r.ok) {
    let msg = `Erreur ${r.status}`;
    try {
      const d = await r.json();
      if (typeof d.detail === 'string') msg = d.detail;
      else if (Array.isArray(d.detail) && d.detail[0]?.msg) msg = 'Requête invalide : ' + d.detail[0].msg;
    } catch {
      /* réponse sans JSON */
    }
    throw new ApiError(r.status, msg);
  }
  return (await r.json()) as T;
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  });
  const s = u.toString();
  return s ? '?' + s : '';
}

/**
 * Charge une ressource et la recharge quand `path` ou `version` change.
 * Garde les données précédentes pendant le rechargement (pas de clignotement).
 */
export function useApi<T>(path: string | null, version = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!path) return;
    const my = ++seq.current;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (my === seq.current) {
          setData(d);
          setError('');
        }
      })
      .catch((e: unknown) => {
        if (my === seq.current) setError(e instanceof Error ? e.message : 'Erreur');
      })
      .finally(() => {
        if (my === seq.current) setLoading(false);
      });
  }, [path, version, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
