'use client';

import { useEffect, useState } from 'react';
import { api, qs, useApi } from '@/lib/api';
import { useStore, type BaseState } from '@/lib/store';
import { fmtDate, plural } from '@/lib/text';
import type { FicheRow, Page, SynchroEtat } from '@/lib/types';
import { Chip, Empty, Ic, PageHead } from '../ui';

const PAGE_SIZE = 12;
const fmtN = (n: number) => n.toLocaleString('fr-FR');

/** Un clic sur la ligne la sélectionne, sauf si le clic vise un bouton, une case ou un lien. */
const isInteractive = (t: EventTarget | null) => t instanceof Element && !!t.closest('button, a, input, label, select, summary');

function FicheLine({ f, selected }: { f: FicheRow; selected: boolean }) {
  const toggleSel = useStore((s) => s.toggleSel);
  const openFiche = useStore((s) => s.openFiche);
  const toDiffuse = f.push.one === 'todo' || f.push.out === 'todo';
  const complete = f.tel && f.email && !f.isDup && !toDiffuse;
  return (
    <tr className={'row-pick' + (selected ? ' is-sel' : '')} onClick={(e) => { if (!isInteractive(e.target)) toggleSel(f); }}>
      <td className="c-check">
        <input type="checkbox" checked={selected} onChange={() => toggleSel(f)} aria-label={`Sélectionner ${f.prenom} ${f.nom}`} />
      </td>
      <td className="c-name">
        <button className="link-name" onClick={() => openFiche(f.id)}>
          {f.prenom} <strong>{f.nom.toUpperCase()}</strong>
        </button>
        <div className="sub mono">{f.rpps ? `RPPS ${f.rpps}` : f.id}</div>
        <button className="btn btn-sm only-m" onClick={() => openFiche(f.id)}>Voir la fiche</button>
      </td>
      <td data-label="Métier">
        {f.metier}
        {f.specialite && <div className="sub">{f.specialite}</div>}
      </td>
      <td data-label="Ville">{f.cp} · {f.ville}</td>
      <td data-label="Tél.">{f.tel ? <span className="mono tel">{f.tel}</span> : <Chip tone="bad">Manquant</Chip>}</td>
      <td data-label="E-mail">{f.email ? <span className="em">{f.email}</span> : <Chip tone="bad">Manquant</Chip>}</td>
      <td className="c-state">
        <div className="tags">
          {!f.actif && <Chip title="Aucun lieu d’exercice actif dans l’Annuaire Santé">Inactif</Chip>}
          {f.isDup && <Chip tone="warn" title="Même nom, prénom et code postal qu’une autre fiche">Doublon possible</Chip>}
          {toDiffuse && <Chip tone="info">À diffuser</Chip>}
          {complete && <Chip tone="good">Complète</Chip>}
          {f.pending > 0 && <Chip tone="accent">{plural(f.pending, 'proposition')}</Chip>}
        </div>
      </td>
    </tr>
  );
}

const SYNCHRO_ACTIF = ['running', 'pausing', 'cancelling'] as const;
const SYNCHRO_LABEL: Record<string, string> = {
  running: 'en cours', pausing: 'mise en pause…', cancelling: 'annulation…',
  paused: 'en pause', cancelled: 'annulée', done: 'terminée', failed: 'en échec',
};

function SynchroBar() {
  const version = useStore((s) => s.version);
  const bump = useStore((s) => s.bump);
  const toast = useStore((s) => s.toast);
  const [tick, setTick] = useState(0);
  const { data } = useApi<SynchroEtat>('/synchro', version + tick);
  const last = data?.historique[0];
  const actif = SYNCHRO_ACTIF.some((s) => last?.statut === s);

  useEffect(() => {
    if (!actif) return;
    const t = setInterval(() => setTick((x) => x + 1), 4000);
    return () => clearInterval(t);
  }, [actif]);
  // Fin de synchro active : on rafraîchit la base.
  const [wasActif, setWasActif] = useState(false);
  useEffect(() => {
    if (wasActif && !actif) bump();
    setWasActif(actif);
  }, [actif]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null;

  const call = async (action: 'synchro' | 'synchro/pause' | 'synchro/reprendre' | 'synchro/annuler') => {
    try {
      await api(`/${action}`, { body: {} });
      if (action === 'synchro') toast('Synchronisation lancée. Elle se poursuit même si vous fermez la page.', 'good');
      if (action === 'synchro/pause') toast("Pause demandée — la synchro s'arrêtera après la page en cours.", 'good');
      if (action === 'synchro/reprendre') toast('Reprise de la synchronisation.', 'good');
      if (action === 'synchro/annuler') toast('Synchronisation annulée.');
      setTick((x) => x + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erreur', 'bad');
    }
  };

  const lastDone = data.historique.find((s) => s.statut === 'done');
  const enPause = last?.statut === 'paused';
  const running = last?.statut === 'running';

  return (
    <div className="selbar" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
      <span>
        <strong>Annuaire Santé</strong>{' '}
        {!data.configuree ? (
          <>— clé <code>ESANTE_API_KEY</code> non configurée sur le serveur.</>
        ) : actif ? (
          <>— synchronisation {SYNCHRO_LABEL[last!.statut] ?? last!.statut} : {fmtN(last!.lignes)} lignes lues ({fmtN(last!.creees)} créées, {fmtN(last!.maj)} mises à jour)…</>
        ) : enPause ? (
          <>— synchronisation en pause ({fmtN(last!.pages)} pages, {fmtN(last!.lignes)} lignes traitées).</>
        ) : last?.statut === 'failed' ? (
          <>— dernière synchronisation en échec le {fmtDate(last.debut)} : {last.message || 'erreur inconnue'}</>
        ) : last?.statut === 'cancelled' ? (
          <>— dernière synchronisation annulée le {fmtDate(last.debut)}.</>
        ) : lastDone ? (
          <>— à jour au {fmtDate(lastDone.fin)}{data.auto ? `, synchronisation automatique chaque nuit à ${data.heure} h` : ''}.</>
        ) : (
          <>— jamais synchronisé.</>
        )}
      </span>
      {data.configuree && (
        <div className="pills" style={{ margin: 0 }}>
          {!actif && !enPause && (
            <button className="btn btn-sm" onClick={() => void call('synchro')}>
              {lastDone ? 'Synchroniser maintenant' : 'Lancer le chargement initial'}
            </button>
          )}
          {running && (
            <button className="btn btn-sm" onClick={() => void call('synchro/pause')}>Mettre en pause</button>
          )}
          {enPause && (
            <button className="btn btn-primary btn-sm" onClick={() => void call('synchro/reprendre')}>Reprendre</button>
          )}
          {(actif || enPause) && (
            <button className="btn btn-sm btn-ghost" onClick={() => { if (window.confirm('Annuler définitivement cette synchronisation ?')) void call('synchro/annuler'); }}>
              Annuler
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function BaseView() {
  const base = useStore((s) => s.base);
  const sel = useStore((s) => s.sel);
  const stats = useStore((s) => s.stats);
  const version = useStore((s) => s.version);
  const setBase = useStore((s) => s.setBase);
  const setSelMany = useStore((s) => s.setSelMany);
  const selectIds = useStore((s) => s.selectIds);
  const clearSel = useStore((s) => s.clearSel);
  const setView = useStore((s) => s.setView);
  const setTarget = useStore((s) => s.setTarget);
  const toast = useStore((s) => s.toast);

  // Saisie temporisée : une requête quand l'utilisateur s'arrête de taper.
  const [q, setQ] = useState(base.q);
  const [cp, setCp] = useState(base.cp);
  useEffect(() => {
    const t = setTimeout(() => { if (q !== base.q || cp !== base.cp) setBase({ q, cp, page: 1 }); }, 300);
    return () => clearTimeout(t);
  }, [q, cp]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtre = { q: base.q, metier: base.metier, cp: base.cp, missing: base.missing };
  const { data: metiers } = useApi<string[]>('/metiers', version);
  const { data, error, loading } = useApi<Page<FicheRow>>('/fiches' + qs({ ...filtre, page: base.page, taille: PAGE_SIZE }), version);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const page = data?.page ?? 1;
  const pages = data?.pages ?? 1;
  const allOn = rows.length > 0 && rows.every((f) => sel.includes(f.id));
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(total, page * PAGE_SIZE);
  const filtered = !!(base.q || base.metier || base.cp || base.missing);

  const filter = (patch: Partial<BaseState>) => setBase({ ...patch, page: 1 });
  const kpi = (n: number | undefined, label: string, val: BaseState['missing']) => (
    <button className={'kpi' + (base.missing === val ? ' is-on' : '')} onClick={() => filter({ missing: val })}>
      <span className="n">{n === undefined ? '…' : fmtN(n)}</span>
      <span className="l">{label}</span>
    </button>
  );
  const selectAll = async () => {
    try {
      selectIds(await api<string[]>('/fiches/ids' + qs({ ...filtre, max: 400 })));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erreur', 'bad');
    }
  };
  const enrichFilter = () => {
    const parts = [base.q && `« ${base.q} »`, base.metier, base.cp && `CP ${base.cp}*`,
      { tel: 'sans téléphone', email: 'sans e-mail', any: 'sans téléphone ou sans e-mail', dup: 'en doublon possible', '': '' }[base.missing]].filter(Boolean);
    setTarget({ kind: 'filtre', filtre, count: total, label: `${plural(total, 'fiche')}${parts.length ? ' : ' + parts.join(', ') : ''}` });
    setView('connect');
  };

  return (
    <>
      <PageHead title="Base de référence">
        Les fiches des professionnels de santé, alimentées par l’Annuaire Santé et enrichies par vos sources. Repérez celles qui n’ont ni téléphone ni e-mail, puis sélectionnez-les pour les enrichir.
      </PageHead>
      <div className="kpis">
        {kpi(stats?.fiches, 'Fiches dans la base', '')}
        {kpi(stats?.sans_tel, 'Sans téléphone', 'tel')}
        {kpi(stats?.sans_email, 'Sans e-mail', 'email')}
        {kpi(stats?.doublons, 'Fiches en doublon possible', 'dup')}
      </div>
      <SynchroBar />
      <section className="panel">
        <div className="filters">
          <div className="field">
            <label htmlFor="f-q">Rechercher</label>
            <input id="f-q" type="search" placeholder="Nom, prénom, ville ou n° RPPS" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-metier">Métier</label>
            <select id="f-metier" value={base.metier} onChange={(e) => filter({ metier: e.target.value })}>
              <option value="">Tous les métiers</option>
              {(metiers ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-cp">Code postal</label>
            <input id="f-cp" type="text" inputMode="numeric" placeholder="38000 ou 38" value={cp} onChange={(e) => setCp(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-miss">Complétude</label>
            <select id="f-miss" value={base.missing} onChange={(e) => filter({ missing: e.target.value as BaseState['missing'] })}>
              <option value="">Toutes les fiches</option>
              <option value="tel">Sans téléphone</option>
              <option value="email">Sans e-mail</option>
              <option value="any">Sans téléphone ou sans e-mail</option>
              <option value="dup">Doublons possibles</option>
            </select>
          </div>
        </div>

        {(sel.length > 0 || (filtered && total > 0)) && (
          <div className="selbar">
            {sel.length > 0 && (
              <>
                <span>{plural(sel.length, 'fiche sélectionnée', 'fiches sélectionnées')}</span>
                <button className="btn btn-sm" onClick={() => { setTarget({ kind: 'sel' }); setView('connect'); }}>
                  <Ic name="globe" />
                  Enrichir la sélection
                </button>
                {total > sel.length && total <= 400 && (
                  <button className="btn btn-sm" onClick={() => void selectAll()}>Sélectionner les {total} résultats</button>
                )}
                <button className="btn btn-sm btn-ghost" onClick={clearSel}>Vider la sélection</button>
              </>
            )}
            {filtered && total > 0 && (
              <button className="btn btn-sm" onClick={enrichFilter} title="Toutes les fiches qui correspondent aux filtres, même au-delà de cette page">
                <Ic name="globe" />
                Enrichir les {fmtN(total)} fiches de ce filtre
              </button>
            )}
          </div>
        )}

        {error ? (
          <Empty title="Impossible de charger la base">{error}</Empty>
        ) : rows.length ? (
          <>
            <label className="pick-page only-m">
              <input type="checkbox" checked={allOn} onChange={(e) => setSelMany(rows, e.target.checked)} />
              Sélectionner les {rows.length} professionnels de la page
            </label>
            <div className="tbl-wrap" style={loading ? { opacity: 0.6 } : undefined}>
              <table className="tbl tbl-stack">
                <thead>
                  <tr>
                    <th className="c-check">
                      <input type="checkbox" checked={allOn} onChange={(e) => setSelMany(rows, e.target.checked)} aria-label="Sélectionner toute la page" />
                    </th>
                    <th>Professionnel</th>
                    <th>Métier</th>
                    <th>CP · Ville</th>
                    <th>Téléphone</th>
                    <th>E-mail</th>
                    <th>État</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => <FicheLine key={f.id} f={f} selected={sel.includes(f.id)} />)}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span>{fmtN(from)}–{fmtN(to)} sur {plural(total, 'fiche')}</span>
              <span>
                <button className="btn btn-sm" disabled={page <= 1} onClick={() => setBase({ page: page - 1 })}>Précédent</button>
                <span style={{ margin: '0 8px' }}>Page {fmtN(page)} / {fmtN(pages)}</span>
                <button className="btn btn-sm" disabled={page >= pages} onClick={() => setBase({ page: page + 1 })}>Suivant</button>
              </span>
            </div>
          </>
        ) : data && !filtered && total === 0 ? (
          <Empty title="La base est vide">Lancez le chargement initial depuis l’Annuaire Santé (bandeau ci-dessus).</Empty>
        ) : data ? (
          <Empty title="Aucune fiche ne correspond">Modifiez la recherche ou retirez un filtre.</Empty>
        ) : (
          <Empty title="Chargement…">Lecture de la base de référence.</Empty>
        )}
      </section>
    </>
  );
}
