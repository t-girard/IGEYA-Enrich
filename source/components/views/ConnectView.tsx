'use client';

import { useStore } from '@/lib/store';
import { useFicheMap } from '@/lib/hooks';
import { CONNECTORS } from '@/lib/connectors';
import { plural } from '@/lib/text';
import { FIELD_LABEL } from '@/lib/types';
import { Chip, Ic, PageHead } from '../ui';

const CONTRACT = `// lib/connectors.ts : un connecteur = une source
const monConnecteur: Connector = {
  id: 'ma-source',
  name: 'Nom affiché',
  fields: ['tel', 'email'],
  // reçoit une fiche, renvoie des propositions
  run(fiche) {
    return [{
      field: 'tel',
      raw: '04.76.12.34.56',
      source: 'Ma source',
      url: 'https://…',
      conf: 82,
    }];
  },
};
// La normalisation, les doublons, le contrôle
// et l’historique sont gérés par IGEYA Enrich.`;

export default function ConnectView() {
  const sel = useStore((s) => s.sel);
  const fiches = useStore((s) => s.fiches);
  const conn = useStore((s) => s.conn);
  const setSelMany = useStore((s) => s.setSelMany);
  const toggleSel = useStore((s) => s.toggleSel);
  const clearSel = useStore((s) => s.clearSel);
  const setView = useStore((s) => s.setView);
  const toggleConnector = useStore((s) => s.toggleConnector);
  const runEnrich = useStore((s) => s.runEnrich);
  const goControl = useStore((s) => s.goControl);
  const fmap = useFicheMap();

  const n = sel.length;
  const noTel = fiches.filter((f) => !f.tel);
  const noMail = fiches.filter((f) => !f.email);
  const pr = conn.progress;
  const pct = pr ? Math.round((pr.done / pr.total) * 100) : 0;
  const canRun = !conn.running && n > 0 && conn.selected.length > 0;

  return (
    <>
      <PageHead title="Connecteurs web">
        Sélectionnez les fiches à enrichir, choisissez une ou plusieurs sources puis lancez la recherche. Les résultats arrivent dans le contrôle sous forme de propositions, jamais directement sur les fiches.
      </PageHead>

      <section className="panel">
        <div className="panel-head">
          <h2>1. Fiches à enrichir</h2>
          <Chip tone="accent">{plural(n, 'fiche sélectionnée', 'fiches sélectionnées')}</Chip>
        </div>
        <div className="panel-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {n ? (
            <div className="picked">
              {sel.slice(0, 12).map((id) => {
                const f = fmap.get(id);
                if (!f) return null;
                return (
                  <span className="chip chip-accent" key={id}>
                    {f.prenom} {f.nom}{' '}
                    <button className="linkbtn" onClick={() => toggleSel(id)} aria-label={`Retirer ${f.prenom} ${f.nom}`}><Ic name="x" /></button>
                  </span>
                );
              })}
              {n > 12 && <Chip>+ {n - 12} autres</Chip>}
            </div>
          ) : (
            <p className="muted">Aucune fiche sélectionnée. Choisissez-les dans la base de référence ou ajoutez-les ci-dessous.</p>
          )}
          <div className="pills">
            <button className="btn btn-sm" onClick={() => setSelMany(noTel.map((f) => f.id), true)}>Ajouter les {noTel.length} fiches sans téléphone</button>
            <button className="btn btn-sm" onClick={() => setSelMany(noMail.map((f) => f.id), true)}>Ajouter les {noMail.length} fiches sans e-mail</button>
            <button className="btn btn-sm" onClick={() => setView('base')}>Choisir dans la base</button>
            {n > 0 && <button className="btn btn-sm btn-ghost" onClick={clearSel}>Vider</button>}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>2. Sources</h2>
          <span className="sub">Les recherches sont simulées : aucune requête externe n’est envoyée.</span>
        </div>
        <div className="panel-pad">
          <div className="cards">
            {CONNECTORS.map((c) => (
              <label className="conn" key={c.id}>
                <div className="top">
                  <div>
                    <h3>{c.name}</h3>
                    <span className="sub">{c.kind}</span>
                  </div>
                  <input type="checkbox" checked={conn.selected.includes(c.id)} onChange={() => toggleConnector(c.id)} aria-label={`Utiliser ${c.name}`} />
                </div>
                <p className="muted">{c.desc}</p>
                <div className="tags">
                  {c.fields.map((x) => <Chip key={x}>{FIELD_LABEL[x]}</Chip>)}
                  <Chip tone="info">Simulé</Chip>
                </div>
              </label>
            ))}
            <div className="conn add">
              <div>
                <h3>Ajouter un connecteur</h3>
                <span className="sub">À venir</span>
              </div>
              <p className="muted">Chaque nouvelle source respecte le même contrat. Rien d’autre à modifier dans l’application.</p>
              <details>
                <summary>Voir le contrat</summary>
                <pre className="code" style={{ marginTop: 8 }}>{CONTRACT}</pre>
              </details>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>3. Recherche</h2>
          <button className="btn btn-primary" disabled={!canRun} onClick={() => void runEnrich()}>
            <Ic name="globe" />
            Lancer la recherche{n && conn.selected.length ? ` (${plural(n, 'fiche')} × ${plural(conn.selected.length, 'source')})` : ''}
          </button>
        </div>
        <div className="panel-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!pr ? (
            <p className="muted">Aucune recherche lancée pour le moment.</p>
          ) : (
            <>
              <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: pct + '%' }} /></div>
              <div className="pills summary-pills">
                <Chip>{pr.done} / {pr.total} fiches traitées</Chip>
                <Chip tone="good">{plural(pr.created + pr.merged, 'proposition')}</Chip>
                <Chip>{plural(pr.same, 'valeur déjà à jour', 'valeurs déjà à jour')}</Chip>
                <Chip>{plural(pr.none, 'fiche sans résultat', 'fiches sans résultat')}</Chip>
              </div>
              <div className="log">{conn.log.map((l, i) => <div key={i}>{l}</div>)}</div>
              {pr.finished && <div><button className="btn btn-primary" onClick={goControl}>Contrôler les propositions</button></div>}
            </>
          )}
        </div>
      </section>
    </>
  );
}
