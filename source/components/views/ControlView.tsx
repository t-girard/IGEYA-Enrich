'use client';

import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { useCtx, useFicheMap } from '@/lib/hooks';
import { flagsOf, isReliable } from '@/lib/proposals';
import { fmtDate, norm, plural } from '@/lib/text';
import { FIELD_LABEL, ORIGIN_LABEL, type Decision, type FlagKind, type Origin } from '@/lib/types';
import { Chip, Empty, PageHead } from '../ui';

const TABS: { k: Decision; label: string }[] = [
  { k: 'pending', label: 'À valider' },
  { k: 'accepted', label: 'Validées' },
  { k: 'rejected', label: 'Rejetées' },
];

const FLAG_OPTIONS: [FlagKind | '', string][] = [
  ['', 'Tous'],
  ['doublon', 'Doublons'],
  ['incertain', 'Correspondances incertaines'],
  ['divergence', 'Sources divergentes'],
  ['conflit', 'Remplacements'],
  ['nouveau', 'Nouvelles données'],
  ['format', 'Format uniformisé'],
  ['invalide', 'Valeurs invalides'],
];

const SEP = ' · ';

/** Un clic sur la carte la sélectionne, sauf si le clic vise un bouton, une case ou un lien. */
const isInteractive = (t: EventTarget | null) => t instanceof Element && !!t.closest('button, a, input, label, select, summary');

export default function ControlView() {
  const props = useStore((s) => s.props);
  const ctl = useStore((s) => s.ctl);
  const setCtl = useStore((s) => s.setCtl);
  const ctlToggle = useStore((s) => s.ctlToggle);
  const ctlSetMany = useStore((s) => s.ctlSetMany);
  const accept = useStore((s) => s.accept);
  const reject = useStore((s) => s.reject);
  const requeue = useStore((s) => s.requeue);
  const bulkAccept = useStore((s) => s.bulkAccept);
  const bulkReject = useStore((s) => s.bulkReject);
  const acceptReliable = useStore((s) => s.acceptReliable);
  const openFiche = useStore((s) => s.openFiche);
  const fmap = useFicheMap();
  const ctx = useCtx();

  const counts = useMemo(() => {
    const c = { pending: 0, accepted: 0, rejected: 0 };
    props.forEach((p) => { c[p.status]++; });
    return c;
  }, [props]);

  const reliable = useMemo(
    () => props.filter((p) => p.status === 'pending' && isReliable(p, flagsOf(p, ctx, fmap))).length,
    [props, ctx, fmap],
  );

  const rows = useMemo(() => {
    const nq = norm(ctl.q);
    const out = [];
    for (const p of props) {
      if (p.status !== ctl.tab) continue;
      const f = fmap.get(p.ficheId);
      if (!f) continue;
      if (ctl.origin && p.origin !== ctl.origin) continue;
      const fl = flagsOf(p, ctx, fmap);
      if (ctl.flag && !fl.some((x) => x.k === ctl.flag)) continue;
      if (nq && !norm(f.nom + ' ' + f.prenom + ' ' + f.id).includes(nq)) continue;
      out.push({ p, f, fl });
    }
    return out;
  }, [props, ctl.tab, ctl.origin, ctl.flag, ctl.q, ctx, fmap]);

  const n = ctl.sel.length;
  const pendRows = rows.filter((r) => r.p.status === 'pending');
  const allOn = pendRows.length > 0 && pendRows.every((r) => ctl.sel.includes(r.p.id));
  const pending = ctl.tab === 'pending';

  return (
    <>
      <PageHead title="Contrôle et validation">
        Chaque ligne montre la source, la valeur actuelle et la valeur proposée. Les doublons et les correspondances incertaines sont signalés, et les numéros de téléphone sont mis au même format (+33 X XX XX XX XX). Après validation, la valeur apparaît sur la fiche.
      </PageHead>

      <div className="steps">
        {TABS.map((t) => (
          <button key={t.k} className={'btn btn-sm' + (ctl.tab === t.k ? ' btn-primary' : '')} onClick={() => setCtl({ tab: t.k, sel: [] })}>
            {t.label} ({counts[t.k]})
          </button>
        ))}
      </div>

      <section className="panel">
        <div className="filters f3">
          <div className="field">
            <label htmlFor="c-q">Fiche</label>
            <input id="c-q" type="search" placeholder="Nom, prénom ou identifiant" value={ctl.q} onChange={(e) => setCtl({ q: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="c-flag">Contrôle</label>
            <select id="c-flag" value={ctl.flag} onChange={(e) => setCtl({ flag: e.target.value as FlagKind | '' })}>
              {FLAG_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="c-origin">Source</label>
            <select id="c-origin" value={ctl.origin} onChange={(e) => setCtl({ origin: e.target.value as Origin | '' })}>
              <option value="">Toutes</option>
              {(Object.keys(ORIGIN_LABEL) as Origin[]).map((o) => <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>)}
            </select>
          </div>
        </div>

        {pending && (
          <div className="selbar">
            <span>{n ? plural(n, 'proposition sélectionnée', 'propositions sélectionnées') : 'Aucune sélection'}</span>
            {n > 0 && (
              <>
                <button className="btn btn-sm" onClick={bulkAccept}>Accepter la sélection</button>
                <button className="btn btn-sm" onClick={bulkReject}>Rejeter la sélection</button>
              </>
            )}
            <button
              className="btn btn-sm"
              disabled={!reliable}
              onClick={acceptReliable}
              title="Valeurs valides, sans doublon, sans doute sur la correspondance et sans remplacement"
            >
              Accepter les {reliable} propositions fiables
            </button>
          </div>
        )}

        {!rows.length ? (
          <Empty title={pending ? 'Rien à contrôler' : 'Aucune proposition ici'}>
            {pending ? 'Importez un fichier ou lancez une recherche web pour générer des propositions.' : 'Les propositions traitées apparaîtront dans cet onglet.'}
          </Empty>
        ) : (
          <>
            {pending && (
              <label className="pick-page only-m">
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={(e) => ctlSetMany(pendRows.map((r) => r.p.id), e.target.checked)}
                />
                Sélectionner les {pendRows.length} propositions affichées
              </label>
            )}
            <div className="tbl-wrap">
              <table className="tbl tbl-stack tbl-ctl">
                <thead>
                  <tr>
                    <th className="c-check">
                      {pending && (
                        <input
                          type="checkbox"
                          checked={allOn}
                          onChange={(e) => ctlSetMany(pendRows.map((r) => r.p.id), e.target.checked)}
                          aria-label="Tout sélectionner"
                        />
                      )}
                    </th>
                    <th>Fiche</th>
                    <th>Source</th>
                    <th>Valeur actuelle</th>
                    <th>Valeur proposée</th>
                    <th>Contrôles</th>
                    <th className="sticky-r">Décision</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map(({ p, f, fl }) => {
                    const src = p.sources[0];
                    const cur = f[p.field];
                    const curSrc = p.field === 'tel' ? f.telSrc : f.emailSrc;
                    const isSel = ctl.sel.includes(p.id);
                    const parts = src.label.split(SEP);
                    return (
                      <tr
                        key={p.id}
                        className={(p.status !== 'pending' ? 'is-done' : 'row-pick') + (isSel ? ' is-sel' : '')}
                        onClick={p.status === 'pending' ? (e) => { if (!isInteractive(e.target)) ctlToggle(p.id); } : undefined}
                      >
                        <td className="c-check">
                          {p.status === 'pending' && (
                            <input type="checkbox" checked={isSel} onChange={() => ctlToggle(p.id)} aria-label={`Sélectionner la proposition ${p.id}`} />
                          )}
                        </td>
                        <td className="c-name">
                          <button className="link-name" onClick={() => openFiche(f.id)}>
                            {f.prenom} <strong>{f.nom.toUpperCase()}</strong>
                          </button>
                          <div className="sub">{f.metier} · {f.cp}</div>
                          <div style={{ marginTop: 4 }}><Chip tone="accent">{FIELD_LABEL[p.field]}</Chip></div>
                        </td>
                        <td data-label="Source" title={src.url || src.label}>
                          <div>{parts[0]}</div>
                          {parts.length > 1 && <div className="sub trunc mono">{parts.slice(1).join(SEP)}</div>}
                          {p.sources.length > 1 && <div className="sub">+ {plural(p.sources.length - 1, 'autre source')}</div>}
                        </td>
                        <td data-label="Actuelle">
                          <div className="vals">
                            {cur ? (
                              <>
                                <span className="val-old mono">{cur}</span>
                                {curSrc && <span className="sub">{curSrc.source} · {fmtDate(curSrc.at)}</span>}
                              </>
                            ) : <Chip tone="bad">Vide</Chip>}
                          </div>
                        </td>
                        <td data-label="Proposée">
                          <div className="vals">
                            <span className={'val-new mono' + (p.valid ? '' : ' is-bad')}>{p.proposed}</span>
                            {p.valid && p.fmtChanged && <span className="raw">brut : <s>{p.raw}</s></span>}
                            {p.valid && p.kind && <span className="sub">{p.kind}</span>}
                            <span className="sub">Confiance {p.conf} %</span>
                          </div>
                        </td>
                        <td className="c-flags">
                          <div className="tags" style={{ maxWidth: 230 }}>
                            {fl.map((x, i) => <Chip key={x.k + i} tone={x.c} title={x.d}>{x.t}</Chip>)}
                          </div>
                        </td>
                        <td className="sticky-r c-act">
                          {p.status === 'pending' && (
                            <div className="stack">
                              <button
                                className="btn btn-sm btn-good"
                                disabled={!p.valid}
                                title={p.valid ? undefined : 'Valeur invalide : acceptation impossible'}
                                onClick={() => accept(p.id)}
                              >
                                Accepter
                              </button>
                              <button className="btn btn-sm btn-bad" onClick={() => reject(p.id)}>Rejeter</button>
                            </div>
                          )}
                          {p.status === 'accepted' && (
                            <>
                              <Chip tone="good">Appliquée</Chip>
                              <div><button className="linkbtn" onClick={() => openFiche(f.id)}>Voir la fiche</button></div>
                            </>
                          )}
                          {p.status === 'rejected' && (
                            <>
                              <Chip>Rejetée</Chip>
                              <div><button className="linkbtn" onClick={() => requeue(p.id)}>Remettre à contrôler</button></div>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > 200 && <div className="pager"><span>Les 200 premières propositions sont affichées.</span></div>}
          </>
        )}
      </section>
    </>
  );
}
