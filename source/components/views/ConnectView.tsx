'use client';

import { useEffect, useState } from 'react';
import { api, useApi } from '@/lib/api';
import { useStore, type BaseState } from '@/lib/store';
import { fmtDate, plural } from '@/lib/text';
import { FIELD_LABEL, type ConnectorInfo, type Stats, type Tache } from '@/lib/types';
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
const ACTIVE = ['queued', 'running', 'cancelling', 'pausing'];
const RESUMABLE = ['paused', 'failed'];
const STATUT: Record<Tache['statut'], string> = {
  queued: 'En attente', running: 'En cours', cancelling: 'Abandon en cours', done: 'Terminée', cancelled: 'Abandonnée',
  failed: 'En échec', pausing: 'Mise en pause…', paused: 'En pause',
};

/** Actions possibles sur une recherche : pause, reprise (repart de la fiche suivante), abandon définitif. */
function useTacheActions(t: Tache, onChange: () => void) {
  const toast = useStore((s) => s.toast);
  const followTache = useStore((s) => s.followTache);
  const call = async (action: 'pause' | 'reprendre' | 'annuler') => {
    try {
      await api(`/taches/${t.id}/${action}`, { body: {} });
      if (action === 'reprendre') {
        followTache(t.id);
        toast(`Recherche reprise à la fiche ${(t.fait + 1).toLocaleString('fr-FR')} sur ${t.total.toLocaleString('fr-FR')}.`, 'good');
      }
      if (action === 'pause') toast('La recherche s’arrête après la fiche en cours. Vous pourrez la reprendre là où elle en est.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erreur', 'bad');
    }
    onChange();
  };
  return call;
}

function TacheButtons({ t, onChange, blocked }: { t: Tache; onChange: () => void; blocked: boolean }) {
  const call = useTacheActions(t, onChange);
  return (
    <>
      {(t.statut === 'running' || t.statut === 'queued') && (
        <button className="btn btn-sm" onClick={() => void call('pause')}>Mettre en pause</button>
      )}
      {RESUMABLE.includes(t.statut) && (
        <button className="btn btn-primary btn-sm" disabled={blocked} title={blocked ? 'Une autre recherche est en cours' : undefined} onClick={() => void call('reprendre')}>
          Reprendre
        </button>
      )}
      {[...ACTIVE, ...RESUMABLE].includes(t.statut) && t.statut !== 'cancelling' && (
        <button className="btn btn-sm btn-ghost" onClick={() => { if (window.confirm('Abandonner définitivement cette recherche ? Elle ne pourra plus être reprise.')) void call('annuler'); }}>
          Abandonner
        </button>
      )}
    </>
  );
}

function Progress({ t, names, onChange, blocked }: { t: Tache; names: Record<string, string>; onChange: () => void; blocked: boolean }) {
  const goControl = useStore((s) => s.goControl);
  const pct = t.total ? Math.min(100, Math.round((t.fait / t.total) * 100)) : t.statut === 'done' ? 100 : 0;
  const active = ACTIVE.includes(t.statut);
  return (
    <>
      <div className="tags">
        <Chip tone={t.statut === 'done' ? 'good' : t.statut === 'failed' ? 'bad' : t.statut === 'paused' ? 'warn' : active ? 'accent' : undefined}>{STATUT[t.statut]}</Chip>
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
        <TacheButtons t={t} onChange={onChange} blocked={blocked} />
        {t.crees + t.fusionnees > 0 && <button className="btn btn-sm" onClick={goControl}>Contrôler les propositions</button>}
      </div>
      {active && <p className="sub">La recherche tourne sur le serveur : vous pouvez fermer cette page, elle continue.</p>}
      {t.statut === 'paused' && (
        <p className="sub">En pause après {plural(t.fait, 'fiche traitée', 'fiches traitées')}. « Reprendre » repart de la fiche suivante, même dans plusieurs jours.</p>
      )}
      {t.reprises > 0 && <p className="sub">Reprise {t.reprises} fois.</p>}
    </>
  );
}

type TargetType =
  | { kind: 'sel' }
  | { kind: 'tout'; count: number }
  | { kind: 'filtre'; filtre: Omit<BaseState, 'page'>; label: string; count: number };

type Who = { id: string; prenom: string; nom: string };

/** Composant de filtres additifs pour cibler les fiches à enrichir. */
function FiltreBuilder({
  stats,
  target,
  setTarget,
  sel,
  selInfo,
  toggleSel,
  clearSel,
  setView,
}: {
  stats: Stats | null;
  target: TargetType;
  setTarget: (t: TargetType) => void;
  sel: string[];
  selInfo: Record<string, Who>;
  toggleSel: (f: Who) => void;
  clearSel: () => void;
  setView: (v: string) => void;
}) {
  // État local des critères de filtre additifs.
  const [metier, setMetier] = useState('');
  const [cp, setCp] = useState('');
  const [missing, setMissing] = useState<'' | 'tel' | 'email' | 'any'>('');

  const hasFiltre = metier !== '' || cp !== '' || missing !== '';
  const fmtN = (n: number) => n.toLocaleString('fr-FR');

  const appliquerFiltre = () => {
    const filtre: Omit<BaseState, 'page'> = { q: '', metier, cp, missing };
    const labels: string[] = [];
    if (missing === 'tel') labels.push('sans téléphone');
    if (missing === 'email') labels.push('sans e-mail');
    if (missing === 'any') labels.push('sans téléphone ni e-mail');
    if (metier) labels.push(`métier : ${metier}`);
    if (cp) labels.push(`CP : ${cp}`);
    const label = labels.length ? labels.join(' + ') : 'toutes les fiches';
    // On ne peut pas connaître le count exact sans requête serveur ; on met 0 pour que
    // le backend le détermine lui-même. L'affichage montre "filtre" sans count.
    setTarget({ kind: 'filtre', filtre, label, count: 0 });
  };

  const n = sel.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {target.kind === 'tout' ? (
        <p>
          <strong>Toutes les fiches</strong> de la base ({fmtN(stats?.fiches ?? 0)}).{' '}
          <button className="linkbtn" onClick={() => setTarget({ kind: 'sel' })}>Revenir à la sélection</button>
        </p>
      ) : target.kind === 'filtre' ? (
        <p>
          Filtre : <strong>{target.label}</strong>
          {target.count > 0 ? ` — ${fmtN(target.count)} fiches` : ''}.{' '}
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
        <p className="muted">Aucune fiche sélectionnée. Choisissez-les dans la base de référence ou utilisez un filtre rapide ci-dessous.</p>
      )}

      {/* Filtres rapides */}
      <div className="pills">
        <button
          className="btn btn-sm"
          disabled={!stats?.fiches}
          onClick={() => setTarget({ kind: 'tout', count: stats?.fiches ?? 0 })}
        >
          Toutes les fiches ({fmtN(stats?.fiches ?? 0)})
        </button>
        <button
          className="btn btn-sm"
          disabled={!stats?.sans_tel}
          onClick={() => setTarget({ kind: 'filtre', filtre: { q: '', metier: '', cp: '', missing: 'tel' }, count: stats?.sans_tel ?? 0, label: 'sans téléphone' })}
        >
          Sans téléphone ({fmtN(stats?.sans_tel ?? 0)})
        </button>
        <button
          className="btn btn-sm"
          disabled={!stats?.sans_email}
          onClick={() => setTarget({ kind: 'filtre', filtre: { q: '', metier: '', cp: '', missing: 'email' }, count: stats?.sans_email ?? 0, label: 'sans e-mail' })}
        >
          Sans e-mail ({fmtN(stats?.sans_email ?? 0)})
        </button>
        <button className="btn btn-sm" onClick={() => setView('base')}>Choisir dans la base</button>
        {target.kind === 'sel' && n > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={clearSel}>Vider</button>
        )}
      </div>

      {/* Filtres combinés */}
      <details>
        <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--muted)' }}>
          Filtres combinés (métier, code postal…)
        </summary>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem' }}>
            Coordonnées manquantes
            <select
              className="input"
              style={{ width: 180 }}
              value={missing}
              onChange={(e) => setMissing(e.target.value as '' | 'tel' | 'email' | 'any')}
            >
              <option value="">Toutes</option>
              <option value="tel">Sans téléphone</option>
              <option value="email">Sans e-mail</option>
              <option value="any">Sans tél. ni e-mail</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem' }}>
            Métier
            <input
              className="input"
              style={{ width: 160 }}
              placeholder="ex: Médecin"
              value={metier}
              onChange={(e) => setMetier(e.target.value)}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.82rem' }}>
            Code postal
            <input
              className="input"
              style={{ width: 100 }}
              placeholder="ex: 75"
              value={cp}
              onChange={(e) => setCp(e.target.value)}
            />
          </label>
          <button
            className="btn btn-sm btn-primary"
            disabled={!hasFiltre}
            onClick={appliquerFiltre}
          >
            Appliquer ce filtre
          </button>
        </div>
      </details>
    </div>
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
  const { data: recent } = useApi<Tache[]>('/taches?limite=30', version + tick);
  const shown = recent?.find((t) => t.id === conn.tacheId) ?? recent?.find((t) => ACTIVE.includes(t.statut)) ?? recent?.[0];
  const running = !!recent?.some((t) => ACTIVE.includes(t.statut));
  const others = (recent ?? []).filter((t) => t.id !== shown?.id && RESUMABLE.includes(t.statut));
  const refresh = () => setTick((x) => x + 1);
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
  const n = target.kind === 'tout' ? target.count : target.kind === 'filtre' ? target.count : sel.length;
  const ready = conn.selected.filter((id) => connectors?.find((c) => c.id === id)?.pret);
  // Pour le target 'tout' ou 'filtre' sans count précis, on autorise le lancement.
  const canRun = !running && (target.kind !== 'sel' || n > 0) && ready.length > 0;

  return (
    <>
      <PageHead title="Connecteurs web">
        Sélectionnez les fiches à enrichir, choisissez une ou plusieurs sources puis lancez la recherche. Les résultats arrivent dans le contrôle sous forme de propositions, jamais directement sur les fiches.
      </PageHead>

      <section className="panel">
        <div className="panel-head">
          <h2>1. Fiches à enrichir</h2>
          <Chip tone="accent">
            {target.kind === 'tout'
              ? plural(target.count, 'fiche')
              : target.kind === 'filtre'
              ? (target.count > 0 ? plural(target.count, 'fiche') : 'filtre actif')
              : plural(n, 'fiche sélectionnée', 'fiches sélectionnées')}
          </Chip>
        </div>
        <div className="panel-pad">
          <FiltreBuilder
            stats={stats}
            target={target}
            setTarget={setTarget}
            sel={sel}
            selInfo={selInfo}
            toggleSel={toggleSel}
            clearSel={clearSel}
            setView={setView}
          />
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
          {running && <p className="sub">Une recherche est déjà en cours : la suivante pourra être lancée quand elle sera terminée ou mise en pause.</p>}
          {!shown ? <p className="muted">Aucune recherche lancée pour le moment.</p> : <Progress t={shown} names={names} onChange={refresh} blocked={running} />}
        </div>
      </section>

      {others.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Recherches à reprendre</h2>
            <span className="sub">En pause ou interrompues : elles repartent de la fiche suivante.</span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Recherche</th><th>Sources</th><th>Avancement</th><th>État</th><th /></tr></thead>
              <tbody>
                {others.map((t) => (
                  <tr key={t.id}>
                    <td>{t.libelle}<div className="sub">par {t.par}{t.creeLe ? ` le ${fmtDate(t.creeLe)}` : ''}</div></td>
                    <td>{t.connecteurs.map((c) => names[c] ?? c).join(' + ')}</td>
                    <td>{fmtN(t.fait)} / {fmtN(t.total)}<div className="sub">{plural(t.crees + t.fusionnees, 'proposition')}</div></td>
                    <td><Chip tone={t.statut === 'failed' ? 'bad' : 'warn'}>{STATUT[t.statut]}</Chip>{t.message && <div className="sub">{t.message.slice(0, 120)}</div>}</td>
                    <td><div className="pills"><TacheButtons t={t} onChange={refresh} blocked={running} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
