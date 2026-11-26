'use client';

import { useEffect, useState } from 'react';
import { api, useApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import { fmtDate, plural } from '@/lib/text';
import { FIELD_LABEL, type ConnectorInfo, type Tache } from '@/lib/types';
import { Chip, Ic, PageHead } from '../ui';

const CONTRACT = `# backend/connecteurs/ma_source.py : un fichier = un connecteur
NOM = "Ma source"
DESCRIPTION = "Ce que fait la source."
CHAMPS = ["tel", "email"]
VARIABLES = ["MA_SOURCE_CLE_API"]   # dans Railway → Variables

def rechercher(fiche):
    # fiche : rpps, nom, prenom, metier, cp, ville, tel, email…
    return [{
        "champ": "tel",
        "valeur": "04.76.12.34.56",
        "url": "https://…",
        "confiance": 82,
    }]

# Normalisation, doublons, contrôle, historique et
# rythme des appels sont gérés par IGEYA Enrich.
# Modèle complet : backend/connecteurs/_modele.py`;

const fmtN = (n: number) => n.toLocaleString('fr-FR');
const ACTIVE = ['queued', 'running', 'cancelling'];
const STATUT: Record<Tache['statut'], string> = {
  queued: 'En attente', running: 'En cours', cancelling: 'Arrêt en cours', done: 'Terminée', cancelled: 'Annulée', failed: 'En échec',
};

function Progress({ t, names }: { t: Tache; names: Record<string, string> }) {
  const goControl = useStore((s) => s.goControl);
  const toast = useStore((s) => s.toast);
  const pct = t.total ? Math.min(100, Math.round((t.fait / t.total) * 100)) : t.statut === 'done' ? 100 : 0;
  const active = ACTIVE.includes(t.statut);
  const cancel = async () => {
    try { await api(`/taches/${t.id}/annuler`, { body: {} }); } catch (e) { toast(e instanceof Error ? e.message : 'Erreur', 'bad'); }
  };
  return (
    <>
      <div className="tags">
        <Chip tone={t.statut === 'done' ? 'good' : t.statut === 'failed' ? 'bad' : active ? 'accent' : undefined}>{STATUT[t.statut]}</Chip>
        <span className="sub">
          {t.libelle} · {t.connecteurs.map((c) => names[c] ?? c).join(' + ')} · lancée par {t.par}{t.creeLe ? ` le ${fmtDate(t.creeLe)}` : ''}
        </span>
      </div>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: pct + '%' }} /></div>
      <div className="pills summary-pills">
        <Chip>{fmtN(t.fait)} / {fmtN(t.total)} fiches traitées</Chip>
        <Chip tone="good">{plural(t.crees + t.fusionnees, 'proposition')}</Chip>
        <Chip>{plural(t.identiques, 'valeur déjà à jour', 'valeurs déjà à jour')}</Chip>
        <Chip>{plural(t.sansResultat, 'fiche sans résultat', 'fiches sans résultat')}</Chip>
        {t.erreurs > 0 && <Chip tone="bad">{plural(t.erreurs, 'fiche en erreur', 'fiches en erreur')}</Chip>}
      </div>
      {t.message && <div className="form-err">{t.message}</div>}
      {t.journal.length > 0 && <div className="log">{t.journal.map((l, i) => <div key={i}>{l}</div>)}</div>}
      <div className="pills">
        {active && t.statut !== 'cancelling' && <button className="btn btn-sm" onClick={() => void cancel()}>Arrêter</button>}
        {t.crees + t.fusionnees > 0 && <button className="btn btn-primary btn-sm" onClick={goControl}>Contrôler les propositions</button>}
      </div>
      {active && <p className="sub">La recherche tourne sur le serveur : vous pouvez fermer cette page, elle continue.</p>}
    </>
  );
}

export default function ConnectView() {
  const sel = useStore((s) => s.sel);
  const selInfo = useStore((s) => s.selInfo);
  const stats = useStore((s) => s.stats);
  const conn = useStore((s) => s.conn);
  const version = useStore((s) => s.version);
  const toggleSel = useStore((s) => s.toggleSel);
  const clearSel = useStore((s) => s.clearSel);
  const setView = useStore((s) => s.setView);
  const toggleConnector = useStore((s) => s.toggleConnector);
  const setConnectors = useStore((s) => s.setConnectors);
  const setTarget = useStore((s) => s.setTarget);
  const runEnrich = useStore((s) => s.runEnrich);
  const bump = useStore((s) => s.bump);

  const { data: connectors, error } = useApi<ConnectorInfo[]>('/connecteurs');
  const [tick, setTick] = useState(0);
  const { data: recent } = useApi<Tache[]>('/taches?limite=5', version + tick);
  const shown = recent?.find((t) => t.id === conn.tacheId) ?? recent?.find((t) => ACTIVE.includes(t.statut)) ?? recent?.[0];
  const running = !!shown && ACTIVE.includes(shown.statut);
  const names = Object.fromEntries((connectors ?? []).map((c) => [c.id, c.nom]));

  // Par défaut : le premier connecteur prêt est coché.
  useEffect(() => {
    if (connectors && !conn.touched && !conn.selected.length) {
      const first = connectors.find((c) => c.pret);
      if (first) setConnectors([first.id]);
    }
  }, [connectors]); // eslint-disable-line react-hooks/exhaustive-deps

  // Suivi de la tâche en cours ; à la fin, les compteurs et le contrôle sont rafraîchis.
  useEffect(() => {
    if (!running && !(conn.tacheId && shown?.id !== conn.tacheId)) return;
    const t = setInterval(() => setTick((x) => x + 1), 1500);
    return () => clearInterval(t);
  }, [running, conn.tacheId, shown?.id]);
  const [wasRunning, setWasRunning] = useState(false);
  useEffect(() => {
    if (wasRunning && !running) bump();
    setWasRunning(running);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const target = conn.target;
  const n = target.kind === 'filtre' ? target.count : sel.length;
  const ready = conn.selected.filter((id) => connectors?.find((c) => c.id === id)?.pret);
  const canRun = !running && n > 0 && ready.length > 0;

  return (
    <>
      <PageHead title="Connecteurs web">
        Sélectionnez les fiches à enrichir, choisissez une ou plusieurs sources puis lancez la recherche. Les résultats arrivent dans le contrôle sous forme de propositions, jamais directement sur les fiches.
      </PageHead>

      <section className="panel">
        <div className="panel-head">
          <h2>1. Fiches à enrichir</h2>
          <Chip tone="accent">{target.kind === 'filtre' ? plural(target.count, 'fiche') : plural(n, 'fiche sélectionnée', 'fiches sélectionnées')}</Chip>
        </div>
        <div className="panel-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {target.kind === 'filtre' ? (
            <p>
              Toutes les fiches du filtre : <strong>{target.label}</strong>{' '}
              <button className="linkbtn" onClick={() => setTarget({ kind: 'sel' })}>Revenir à la sélection</button>
            </p>
          ) : n ? (
            <div className="picked">
              {sel.slice(0, 12).map((id) => {
                const f = selInfo[id];
                return (
                  <span className="chip chip-accent" key={id}>
                    {f ? `${f.prenom} ${f.nom}` : id}{' '}
                    <button className="linkbtn" onClick={() => toggleSel(f ?? { id, prenom: '', nom: '' })} aria-label={`Retirer ${f ? f.prenom + ' ' + f.nom : id}`}><Ic name="x" /></button>
                  </span>
                );
              })}
              {n > 12 && <Chip>+ {fmtN(n - 12)} autres</Chip>}
            </div>
          ) : (
            <p className="muted">Aucune fiche sélectionnée. Choisissez-les dans la base de référence ou ajoutez-les ci-dessous.</p>
          )}
          <div className="pills">
            <button className="btn btn-sm" disabled={!stats?.sans_tel} onClick={() => setTarget({ kind: 'filtre', filtre: { q: '', metier: '', cp: '', missing: 'tel' }, count: stats?.sans_tel ?? 0, label: 'toutes les fiches sans téléphone' })}>
              Toutes les fiches sans téléphone ({fmtN(stats?.sans_tel ?? 0)})
            </button>
            <button className="btn btn-sm" disabled={!stats?.sans_email} onClick={() => setTarget({ kind: 'filtre', filtre: { q: '', metier: '', cp: '', missing: 'email' }, count: stats?.sans_email ?? 0, label: 'toutes les fiches sans e-mail' })}>
              Toutes les fiches sans e-mail ({fmtN(stats?.sans_email ?? 0)})
            </button>
            <button className="btn btn-sm" onClick={() => setView('base')}>Choisir dans la base</button>
            {target.kind === 'sel' && n > 0 && <button className="btn btn-sm btn-ghost" onClick={clearSel}>Vider</button>}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>2. Sources</h2>
          <span className="sub">Un connecteur = un fichier Python dans backend/connecteurs/</span>
        </div>
        <div className="panel-pad">
          {error && <div className="form-err">{error}</div>}
          <div className="cards">
            {(connectors ?? []).map((c) => (
              <label className="conn" key={c.id} style={c.pret ? undefined : { opacity: 0.75 }}>
                <div className="top">
                  <div>
                    <h3>{c.nom}</h3>
                    <span className="sub">{c.type}</span>
                  </div>
                  <input type="checkbox" disabled={!c.pret} checked={c.pret && conn.selected.includes(c.id)} onChange={() => toggleConnector(c.id)} aria-label={`Utiliser ${c.nom}`} />
                </div>
                <p className="muted">{c.description}</p>
                <div className="tags">
                  {c.champs.map((x) => <Chip key={x}>{FIELD_LABEL[x]}</Chip>)}
                  {c.pret ? <Chip tone="good">Prêt</Chip> : c.erreur ? <Chip tone="bad">Erreur</Chip> : <Chip tone="warn">À configurer</Chip>}
                </div>
                {!c.pret && !c.erreur && (
                  <p className="sub">Variable manquante dans Railway : {c.manquantes.map((v) => <code key={v} style={{ marginRight: 4 }}>{v}</code>)}</p>
                )}
                {c.erreur && (
                  <details>
                    <summary>Voir l’erreur ({c.fichier})</summary>
                    <pre className="code" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{c.erreur}</pre>
                  </details>
                )}
              </label>
            ))}
            <div className="conn add">
              <div>
                <h3>Ajouter un connecteur</h3>
                <span className="sub">Un fichier Python</span>
              </div>
              <p className="muted">Déposez un fichier dans <code>backend/connecteurs/</code> et poussez sur GitHub : il apparaît ici après le redéploiement. Rien d’autre à modifier.</p>
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
            Lancer la recherche{n && ready.length ? ` (${plural(n, 'fiche')} × ${plural(ready.length, 'source')})` : ''}
          </button>
        </div>
        <div className="panel-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {running && <p className="sub">Une recherche est déjà en cours : la suivante pourra être lancée quand elle sera terminée ou arrêtée.</p>}
          {!shown ? <p className="muted">Aucune recherche lancée pour le moment.</p> : <Progress t={shown} names={names} />}
        </div>
      </section>
    </>
  );
}
