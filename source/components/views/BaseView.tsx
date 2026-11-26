'use client';

import { useMemo } from 'react';
import { useStore, type BaseState } from '@/lib/store';
import { useDups } from '@/lib/hooks';
import { norm, plural } from '@/lib/text';
import type { Fiche } from '@/lib/types';
import { Chip, Empty, Ic, PageHead } from '../ui';

const PAGE_SIZE = 12;

/** Un clic sur la ligne la sélectionne, sauf si le clic vise un bouton, une case ou un lien. */
const isInteractive = (t: EventTarget | null) => t instanceof Element && !!t.closest('button, a, input, label, select, summary');

function FicheRow({ f, selected, pending, isDup }: { f: Fiche; selected: boolean; pending: number; isDup: boolean }) {
  const toggleSel = useStore((s) => s.toggleSel);
  const openFiche = useStore((s) => s.openFiche);
  const toDiffuse = f.push.one === 'todo' || f.push.out === 'todo';
  const complete = f.tel && f.email && !isDup && !toDiffuse;
  return (
    <tr
      className={'row-pick' + (selected ? ' is-sel' : '')}
      onClick={(e) => { if (!isInteractive(e.target)) toggleSel(f.id); }}
    >
      <td className="c-check">
        <input type="checkbox" checked={selected} onChange={() => toggleSel(f.id)} aria-label={`Sélectionner ${f.prenom} ${f.nom}`} />
      </td>
      <td className="c-name">
        <button className="link-name" onClick={() => openFiche(f.id)}>
          {f.prenom} <strong>{f.nom.toUpperCase()}</strong>
        </button>
        <div className="sub mono">RPPS {f.rpps}</div>
        <button className="btn btn-sm only-m" onClick={() => openFiche(f.id)}>Voir la fiche</button>
      </td>
      <td data-label="Métier">{f.metier}</td>
      <td data-label="Ville">{f.cp} · {f.ville}</td>
      <td data-label="Tél.">{f.tel ? <span className="mono tel">{f.tel}</span> : <Chip tone="bad">Manquant</Chip>}</td>
      <td data-label="E-mail">{f.email ? <span className="em">{f.email}</span> : <Chip tone="bad">Manquant</Chip>}</td>
      <td className="c-state">
        <div className="tags">
          {isDup && <Chip tone="warn" title="Même nom, prénom et code postal qu’une autre fiche">Doublon possible</Chip>}
          {toDiffuse && <Chip tone="info">À diffuser</Chip>}
          {complete && <Chip tone="good">Complète</Chip>}
          {pending > 0 && <Chip tone="accent">{plural(pending, 'proposition')}</Chip>}
        </div>
      </td>
    </tr>
  );
}

export default function BaseView() {
  const fiches = useStore((s) => s.fiches);
  const props = useStore((s) => s.props);
  const base = useStore((s) => s.base);
  const sel = useStore((s) => s.sel);
  const setBase = useStore((s) => s.setBase);
  const setSelMany = useStore((s) => s.setSelMany);
  const clearSel = useStore((s) => s.clearSel);
  const setView = useStore((s) => s.setView);
  const dups = useDups();

  const metiers = useMemo(() => Array.from(new Set(fiches.map((f) => f.metier))).sort((a, b) => a.localeCompare(b, 'fr')), [fiches]);
  const pendingBy = useMemo(() => {
    const m = new Map<string, number>();
    props.forEach((p) => { if (p.status === 'pending') m.set(p.ficheId, (m.get(p.ficheId) ?? 0) + 1); });
    return m;
  }, [props]);

  const list = useMemo(() => {
    const nq = norm(base.q);
    const rq = base.q.trim().toLowerCase();
    const cp = base.cp.trim();
    return fiches.filter((f) => {
      if (nq || rq) {
        const hit = (nq && norm(f.nom + ' ' + f.prenom + ' ' + f.ville).includes(nq)) || f.rpps.includes(rq) || f.id.toLowerCase().includes(rq);
        if (!hit) return false;
      }
      if (base.metier && f.metier !== base.metier) return false;
      if (cp && !f.cp.startsWith(cp)) return false;
      if (base.missing === 'tel' && f.tel) return false;
      if (base.missing === 'email' && f.email) return false;
      if (base.missing === 'any' && f.tel && f.email) return false;
      if (base.missing === 'dup' && !dups.has(f.id)) return false;
      return true;
    });
  }, [fiches, base.q, base.metier, base.cp, base.missing, dups]);

  const noTel = fiches.filter((f) => !f.tel).length;
  const noMail = fiches.filter((f) => !f.email).length;
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const page = Math.min(base.page, pages);
  const rows = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const allOn = rows.length > 0 && rows.every((f) => sel.includes(f.id));
  const from = list.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(list.length, page * PAGE_SIZE);

  const filter = (patch: Partial<BaseState>) => setBase({ ...patch, page: 1 });
  const kpi = (n: number, label: string, val: BaseState['missing']) => (
    <button className={'kpi' + (base.missing === val ? ' is-on' : '')} onClick={() => filter({ missing: val })}>
      <span className="n">{n}</span>
      <span className="l">{label}</span>
    </button>
  );

  return (
    <>
      <PageHead title="Base de référence">
        Les fiches de professionnels de santé (données fictives de type ONE ou Annuaire Santé). Repérez celles qui n’ont ni téléphone ni e-mail, puis sélectionnez-les pour les enrichir.
      </PageHead>
      <div className="kpis">
        {kpi(fiches.length, 'Fiches dans la base', '')}
        {kpi(noTel, 'Sans téléphone', 'tel')}
        {kpi(noMail, 'Sans e-mail', 'email')}
        {kpi(dups.size, 'Fiches en doublon possible', 'dup')}
      </div>
      <section className="panel">
        <div className="filters">
          <div className="field">
            <label htmlFor="f-q">Rechercher</label>
            <input id="f-q" type="search" placeholder="Nom, prénom, ville ou n° RPPS" value={base.q} onChange={(e) => filter({ q: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="f-metier">Métier</label>
            <select id="f-metier" value={base.metier} onChange={(e) => filter({ metier: e.target.value })}>
              <option value="">Tous les métiers</option>
              {metiers.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-cp">Code postal</label>
            <input id="f-cp" type="text" inputMode="numeric" placeholder="38000 ou 38" value={base.cp} onChange={(e) => filter({ cp: e.target.value })} />
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

        {sel.length > 0 && (
          <div className="selbar">
            <span>{plural(sel.length, 'fiche sélectionnée', 'fiches sélectionnées')}</span>
            <button className="btn btn-sm" onClick={() => setView('connect')}>
              <Ic name="globe" />
              Enrichir via un connecteur web
            </button>
            {list.length > sel.length && list.length <= 400 && (
              <button className="btn btn-sm" onClick={() => setSelMany(list.map((f) => f.id), true)}>
                Sélectionner les {list.length} résultats
              </button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={clearSel}>Vider la sélection</button>
          </div>
        )}

        {list.length ? (
          <>
            <label className="pick-page only-m">
              <input type="checkbox" checked={allOn} onChange={(e) => setSelMany(rows.map((f) => f.id), e.target.checked)} />
              Sélectionner les {rows.length} professionnels de la page
            </label>
            <div className="tbl-wrap">
              <table className="tbl tbl-stack">
                <thead>
                  <tr>
                    <th className="c-check">
                      <input type="checkbox" checked={allOn} onChange={(e) => setSelMany(rows.map((f) => f.id), e.target.checked)} aria-label="Sélectionner toute la page" />
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
                  {rows.map((f) => (
                    <FicheRow key={f.id} f={f} selected={sel.includes(f.id)} pending={pendingBy.get(f.id) ?? 0} isDup={dups.has(f.id)} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span>{from}–{to} sur {plural(list.length, 'fiche')}</span>
              <span>
                <button className="btn btn-sm" disabled={page <= 1} onClick={() => setBase({ page: page - 1 })}>Précédent</button>
                <span style={{ margin: '0 8px' }}>Page {page} / {pages}</span>
                <button className="btn btn-sm" disabled={page >= pages} onClick={() => setBase({ page: page + 1 })}>Suivant</button>
              </span>
            </div>
          </>
        ) : (
          <Empty title="Aucune fiche ne correspond">Modifiez la recherche ou retirez un filtre.</Empty>
        )}
      </section>
    </>
  );
}
