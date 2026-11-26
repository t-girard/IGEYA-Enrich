'use client';

import { useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { useFicheMap } from '@/lib/hooks';
import { normTel, normEmail } from '@/lib/phone';
import { plural } from '@/lib/text';
import type { ImportRow, MapKey } from '@/lib/types';
import { Chip, Ic, PageHead } from '../ui';

function StatusChip({ r }: { r: ImportRow }) {
  if (r.status === 'certain') return <Chip tone="good">Correspondance certaine</Chip>;
  if (r.status === 'incertain') return <Chip tone="warn">{r.ambiguous ? 'Plusieurs fiches possibles' : 'Correspondance incertaine'}</Chip>;
  if (r.status === 'doublon') return <Chip tone="warn">Doublon de la ligne {r.dupOf}</Chip>;
  return <Chip tone="bad">Aucune fiche trouvée</Chip>;
}

function Brings({ r }: { r: ImportRow }) {
  const t = r.tel ? normTel(r.tel) : null;
  const e = r.email ? normEmail(r.email) : null;
  if (!t && !e) return <span className="sub">Aucune coordonnée</span>;
  return (
    <>
      {t && (t.ok ? (
        <div>
          <span className="mono">{t.value}</span>
          {t.changed && <span className="raw"> (brut : {r.tel})</span>}
        </div>
      ) : (
        <div><Chip tone="bad">Tél. invalide</Chip> <span className="raw">{r.tel}</span></div>
      ))}
      {e && (e.ok ? <div>{e.value}</div> : <div><Chip tone="bad">E-mail invalide</Chip></div>)}
    </>
  );
}

const MAP_FIELDS: { k: MapKey; label: string; required?: boolean }[] = [
  { k: 'nom', label: 'Nom', required: true },
  { k: 'prenom', label: 'Prénom', required: true },
  { k: 'cp', label: 'Code postal', required: true },
  { k: 'tel', label: 'Téléphone' },
  { k: 'email', label: 'E-mail' },
];

export default function ImportView() {
  const imp = useStore((s) => s.imp);
  const loadFile = useStore((s) => s.loadFile);
  const loadSample = useStore((s) => s.loadSample);
  const setImpMap = useStore((s) => s.setImpMap);
  const resetImport = useStore((s) => s.resetImport);
  const runMatch = useStore((s) => s.runMatch);
  const toggleInclude = useStore((s) => s.toggleInclude);
  const sendToControl = useStore((s) => s.sendToControl);
  const fmap = useFicheMap();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const head = (
    <PageHead title="Import de fichier">
      Déposez un fichier CSV ou Excel. L’outil rapproche chaque ligne d’une fiche existante à partir du nom, du prénom et du code postal, puis transmet les coordonnées au contrôle.
    </PageHead>
  );

  if (!imp.file) {
    return (
      <>
        {head}
        <div
          className={'dropzone' + (over ? ' is-over' : '')}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={() => setOver(false)}
        >
          <Ic name="upload" big />
          <h3>Déposez un fichier CSV ou Excel ici</h3>
          <p className="muted">Colonnes attendues : nom, prénom, code postal. Téléphone et e-mail sont facultatifs.</p>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => input.current?.click()}>Choisir un fichier</button>
            <button className="btn" onClick={loadSample}>Utiliser un fichier d’exemple</button>
          </div>
          <input
            ref={input}
            type="file"
            hidden
            accept=".csv,.tsv,.txt,.xlsx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </>
    );
  }

  const res = imp.result;
  const counts = { certain: 0, incertain: 0, aucune: 0, doublon: 0 };
  res?.forEach((r) => { counts[r.status]++; });
  const included = res ? res.filter((r) => imp.include.includes(r.line)).length : 0;

  return (
    <>
      {head}
      <section className="panel">
        <div className="panel-head">
          <h2><Ic name="file" /> {imp.file} <span className="sub">{plural(imp.rows.length, 'ligne')}</span></h2>
          <button className="btn btn-sm" onClick={resetImport}>Changer de fichier</button>
        </div>
        <div className="panel-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Colonnes reconnues</h3>
            <div className="map-grid">
              {MAP_FIELDS.map(({ k, label, required }) => (
                <div className="field" key={k}>
                  <label htmlFor={'m-' + k}>{label}{required ? ' (obligatoire)' : ''}</label>
                  <select id={'m-' + k} value={imp.map[k]} onChange={(e) => setImpMap(k, e.target.value)}>
                    <option value="">Non utilisée</option>
                    {imp.headers.map((h, i) => <option key={i} value={String(i)}>{h || 'Colonne ' + (i + 1)}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl" style={{ minWidth: 520 }}>
              <thead><tr>{imp.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {imp.rows.slice(0, 5).map((r, i) => (
                  <tr key={i}>{imp.headers.map((_, j) => <td key={j}>{r[j]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div><button className="btn btn-primary" onClick={runMatch}>Rapprocher avec la base</button></div>
        </div>
      </section>

      {res && (
        <section className="panel">
          <div className="panel-head">
            <h2>Résultat du rapprochement</h2>
            <div className="pills summary-pills">
              <Chip tone="good">{plural(counts.certain, 'correspondance certaine', 'correspondances certaines')}</Chip>
              <Chip tone="warn">{plural(counts.incertain, 'correspondance incertaine', 'correspondances incertaines')}</Chip>
              <Chip tone="bad">{plural(counts.aucune, 'ligne sans fiche', 'lignes sans fiche')}</Chip>
              <Chip tone="warn">{plural(counts.doublon, 'doublon dans le fichier', 'doublons dans le fichier')}</Chip>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="c-check" />
                  <th>Ligne</th>
                  <th>Dans le fichier</th>
                  <th>Fiche rapprochée</th>
                  <th>Score</th>
                  <th>Statut</th>
                  <th>Coordonnées apportées</th>
                </tr>
              </thead>
              <tbody>
                {res.slice(0, 150).map((r) => {
                  const can = !!r.best && r.status !== 'doublon' && r.status !== 'aucune';
                  const on = imp.include.includes(r.line);
                  const m = r.best?.m;
                  const f = r.best ? fmap.get(r.best.ficheId) : undefined;
                  return (
                    <tr key={r.line} className={can && on ? '' : 'is-done'}>
                      <td className="c-check">
                        {can && <input type="checkbox" checked={on} onChange={() => toggleInclude(r.line)} aria-label={`Inclure la ligne ${r.line}`} />}
                      </td>
                      <td>{r.line}</td>
                      <td>{r.prenom} <strong>{r.nom.toUpperCase()}</strong><div className="sub">{r.cp}</div></td>
                      <td>
                        {f ? (<>{f.prenom} <strong>{f.nom.toUpperCase()}</strong><div className="sub">{f.id} · {f.cp} {f.ville}</div></>) : <span className="sub">—</span>}
                      </td>
                      <td>
                        {m && (
                          <>
                            <span className={'bar' + (m.score < 90 ? ' low' : '')}><i style={{ width: m.score + '%' }} /></span>
                            <span className="mono" title={`Nom : ${m.tN} · Prénom : ${m.tP} · Code postal : ${m.tC}`}>{m.score} %</span>
                            <div className="sub">Nom {m.tN}, prénom {m.tP}, CP {m.tC}</div>
                          </>
                        )}
                      </td>
                      <td><StatusChip r={r} /></td>
                      <td>{r.status === 'doublon' ? <span className="sub">Fusionnée avec la ligne {r.dupOf}</span> : <Brings r={r} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {res.length > 150 && <div className="pager"><span>Les 150 premières lignes sont affichées. Toutes sont traitées.</span></div>}
          <div className="pager">
            <span>{plural(included, 'ligne')} à transmettre au contrôle. Rien n’est écrit dans la base avant validation.</span>
            <button className="btn btn-primary" disabled={!included} onClick={sendToControl}>Envoyer vers le contrôle</button>
          </div>
        </section>
      )}
    </>
  );
}
