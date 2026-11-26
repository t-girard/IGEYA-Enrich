'use client';

import { useApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import { fmtDate, plural } from '@/lib/text';
import { FIELD_LABEL, type FicheDetail, type Field, type PushState } from '@/lib/types';
import { Chip, Ic } from './ui';

function PushChip({ v }: { v: PushState }) {
  if (v === 'ok') return <Chip tone="good">À jour</Chip>;
  if (v === 'todo') return <Chip tone="info">À diffuser</Chip>;
  return <Chip>Rien à diffuser</Chip>;
}

/** Fiche d'un professionnel : coordonnées avec leur source, lieux d'exercice, historique, état de diffusion. */
export default function Drawer({ id }: { id: string }) {
  const version = useStore((s) => s.version);
  const openFiche = useStore((s) => s.openFiche);
  const enrichOne = useStore((s) => s.enrichOne);
  const goControlFiche = useStore((s) => s.goControlFiche);
  const { data: f, error } = useApi<FicheDetail>('/fiches/' + encodeURIComponent(id), version);

  const box = (field: Field) => {
    if (!f) return null;
    const v = f[field];
    const src = field === 'tel' ? f.telSrc : f.emailSrc;
    const updated = f.history.some((h) => h.field === field);
    return (
      <div className={'fbox' + (updated ? ' is-new' : '')}>
        <div className="lab">
          <span>{FIELD_LABEL[field]}</span>
          {updated ? <Chip tone="good">Mis à jour</Chip> : null}
        </div>
        <div className="v">{v ? <span className="mono" style={{ fontSize: 15 }}>{v}</span> : <Chip tone="bad">Manquant</Chip>}</div>
        <div className="sub">
          {src ? <>Source : {src.url ? <a href={src.url} target="_blank" rel="noreferrer">{src.source}</a> : src.source} · {fmtDate(src.at)}</> : 'Aucune source enregistrée'}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="scrim" onClick={() => openFiche(null)} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={f ? `Fiche de ${f.prenom} ${f.nom}` : 'Fiche'}>
        <header>
          <div>
            {f ? (
              <>
                <h2>{f.prenom} {f.nom.toUpperCase()}</h2>
                <div className="sub">{f.metier}{f.specialite ? ` · ${f.specialite}` : ''} · {f.adresse}{f.adresse ? ', ' : ''}{f.cp} {f.ville}</div>
                <div className="sub mono">{f.id}{f.rpps ? ` · RPPS ${f.rpps}` : ''}</div>
              </>
            ) : (
              <h2>{error ? 'Fiche introuvable' : 'Chargement…'}</h2>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => openFiche(null)} aria-label="Fermer la fiche">
            <Ic name="x" />
          </button>
        </header>
        {error && <div className="drawer-body"><div className="form-err">{error}</div></div>}
        {f && (
          <div className="drawer-body">
            {box('tel')}
            {box('email')}
            {!f.actif && <div className="hint"><span>Aucun lieu d’exercice actif dans l’Annuaire Santé.</span></div>}
            {f.dups.length > 0 && (
              <div className="form-err" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
                Doublon possible avec la fiche{' '}
                {f.dups.map((d, i) => (
                  <span key={d}>
                    {i > 0 && ', '}
                    <button className="linkbtn" style={{ color: 'inherit', textDecoration: 'underline' }} onClick={() => openFiche(d)}>{d}</button>
                  </span>
                ))}{' '}
                (même nom, prénom et code postal).
              </div>
            )}
            {f.pending > 0 && (
              <div className="hint">
                <span>{plural(f.pending, 'proposition')} en attente de contrôle pour cette fiche.</span>
                <button className="btn btn-sm" onClick={() => goControlFiche(f.nom)}>Ouvrir le contrôle</button>
              </div>
            )}
            <div>
              <h3 style={{ fontSize: 14, marginBottom: 8 }}>Diffusion</h3>
              <div className="tags">
                <span>ONE (téléphone) :</span> <PushChip v={f.push.one} />
                <span style={{ marginLeft: 8 }}>OUTREACH (e-mail) :</span> <PushChip v={f.push.out} />
              </div>
            </div>
            {f.lieux.length > 0 && (
              <div>
                <h3 style={{ fontSize: 14, marginBottom: 8 }}>Lieux d’exercice (Annuaire Santé)</h3>
                <ul className="timeline">
                  {f.lieux.map((l, i) => (
                    <li key={i}>
                      <strong>{l.structure || 'Lieu d’exercice'}</strong>
                      {l.actif === 'non' && <> <Chip>Inactif</Chip></>}
                      <div className="sub">{[l.adresse, [l.cp, l.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</div>
                      {(l.tel || l.mode) && <div className="sub">{[l.mode, l.tel].filter(Boolean).join(' · ')}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <h3 style={{ fontSize: 14, marginBottom: 8 }}>Historique</h3>
              <ul className="timeline">
                {f.history.map((h, i) => (
                  <li key={h.at + h.field + i}>
                    <strong>{FIELD_LABEL[h.field]}</strong> mis à jour le {fmtDate(h.at)}
                    <div className="sub">{h.from ? <><s>{h.from}</s> → </> : null}{h.to}</div>
                    <div className="sub">Source : {h.source} · validé par {h.by}</div>
                  </li>
                ))}
                <li>
                  <strong>Fiche créée</strong>
                  <div className="sub">{f.creeLe ? `Le ${fmtDate(f.creeLe)}` : ''}{f.ansMaj ? ` · Annuaire Santé mis à jour le ${fmtDate(f.ansMaj)}` : ''}</div>
                </li>
              </ul>
            </div>
            <div>
              <button className="btn btn-primary" onClick={() => enrichOne(f)}>
                <Ic name="globe" />
                Enrichir cette fiche
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
