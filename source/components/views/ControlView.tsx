'use client';

import { useEffect, useState } from 'react';
import { qs, useApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import { fmtDate, plural } from '@/lib/text';
import { FIELD_LABEL, type ControlPage, type Decision, type FlagKind, type Origin } from '@/lib/types';
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
  const ctl = useStore((s) => s.ctl);
  const version = useStore((s) => s.version);
  const setCtl = useStore((s) => s.setCtl);
  const ctlToggle = useStore((s) => s.ctlToggle);
  const ctlSetMany = useStore((s) => s.ctlSetMany);
  const decide = useStore((s) => s.decide);
  const acceptReliable = useStore((s) => s.acceptReliable);
  const openFiche = useStore((s) => s.openFiche);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>) => { setBusy(true); await fn(); setBusy(false); };

  // Recherche temporisée.
  const [q, setQ] = useState(ctl.q);
  useEffect(() => setQ(ctl.q), [ctl.q]);
  useEffect(() => {
    const t = setTimeout(() => { if (q !== ctl.q) setCtl({ q }); }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, error, loading } = useApi<ControlPage>(
    '/propositions' + qs({ statut: ctl.tab, flag: ctl.flag, origine: ctl.origin, q: ctl.q, limite: 200 }), version,
  );
  const counts = data?.counts ?? { pending: 0, accepted: 0, rejected: 0 };
  const reliable = data?.fiables ?? 0;
  const rows = (data?.rows ?? []).map(({ p, f, flags }) => ({ p, f, fl: flags }));
  const total = data?.total ?? 0;

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
            <input id="c-q" type="search" placeholder="Nom, prénom ou identifiant" value={q} onChange={(e) => setQ(e.target.value)} />
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
              {Object.entries(data?.origines ?? {}).map(([o, l]) => <option key={o} value={o}>{l}</option>)}
            </select>
          </div>
        </div>

        {pending && (
          <div className="selbar">
            <span>{n ? plural(n, 'proposition sélectionnée', 'propositions sélectionnées') : 'Aucune sélection'}</span>
            {n > 0 && (
              <>
                <button className="btn btn-sm" disabled={busy} onClick={() => void act(() => decide('accepter', ctl.sel))}>Accepter la sélection</button>
                <button className="btn btn-sm" disabled={busy} onClick={() => void act(() => decide('rejeter', ctl.sel))}>Rejeter la sélection</button>
              </>
            )}
            <button
              className="btn btn-sm"
              disabled={!reliable || busy}
              onClick={() => void act(acceptReliable)}
              title="Valeurs valides, sans doublon, sans doute sur la correspondance et sans remplacement"
            >
              Accepter les {reliable} propositions fiables
            </button>
          </div>
        )}

        {error ? (
          <Empty title="Impossible de charger les propositions">{error}</Empty>
        ) : !rows.length ? (
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
            <div className="tbl-wrap" style={loading ? { opacity: 0.6 } : undefined}>
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
                  {rows.map(({ p, f, fl }) => {
                    const src = p.sources[0] ?? { label: '', url: '' };
                    const cur = f.current;
                    const curSrc = f.currentSrc;
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
                          <div>{src.url ? <a href={src.url} target="_blank" rel="noreferrer">{parts[0]}</a> : parts[0]}</div>
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
                                onClick={() => void decide('accepter', [p.id])}
                              >
                                Accepter
                              </button>
                              <button className="btn btn-sm btn-bad" onClick={() => void decide('rejeter', [p.id])}>Rejeter</button>
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
                              <div><button className="linkbtn" onClick={() => void decide('remettre', [p.id])}>Remettre à contrôler</button></div>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {total > rows.length && <div className="pager"><span>Les {rows.length} premières propositions sur {total.toLocaleString('fr-FR')} sont affichées. Traitez-les ou affinez les filtres pour voir les suivantes.</span></div>}
          </>
        )}
      </section>
    </>
  );
}
