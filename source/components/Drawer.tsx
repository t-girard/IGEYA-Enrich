'use client';

import { useStore } from '@/lib/store';
import { useDups, useFicheMap } from '@/lib/hooks';
import { fmtDate, plural } from '@/lib/text';
import { FIELD_LABEL, type Field, type PushState } from '@/lib/types';
import { Chip, Ic } from './ui';

function PushChip({ v }: { v: PushState }) {
  if (v === 'ok') return <Chip tone="good">À jour</Chip>;
  if (v === 'todo') return <Chip tone="info">À diffuser</Chip>;
  return <Chip>Rien à diffuser</Chip>;
}

/** Fiche d'un professionnel : coordonnées avec leur source, historique, état de diffusion. */
export default function Drawer({ id }: { id: string }) {
  const fmap = useFicheMap();
  const dups = useDups();
  const pending = useStore((s) => s.props.filter((p) => p.ficheId === id && p.status === 'pending').length);
  const openFiche = useStore((s) => s.openFiche);
  const enrichOne = useStore((s) => s.enrichOne);
  const goControlFiche = useStore((s) => s.goControlFiche);
  const f = fmap.get(id);
  if (!f) return null;
  const others = (dups.get(id) ?? []).map((x) => fmap.get(x)).filter((x): x is NonNullable<typeof x> => !!x);

  const box = (field: Field) => {
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
        <div className="sub">{src ? `Source : ${src.source} · ${fmtDate(src.at)}` : 'Aucune source enregistrée'}</div>
      </div>
    );
  };

  return (
    <>
      <div className="scrim" onClick={() => openFiche(null)} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Fiche de ${f.prenom} ${f.nom}`}>
        <header>
          <div>
            <h2>{f.prenom} {f.nom.toUpperCase()}</h2>
            <div className="sub">{f.metier} · {f.adresse}, {f.cp} {f.ville}</div>
            <div className="sub mono">{f.id} · RPPS {f.rpps}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => openFiche(null)} aria-label="Fermer la fiche">
            <Ic name="x" />
          </button>
        </header>
        <div className="drawer-body">
          {box('tel')}
          {box('email')}
          {others.length > 0 && (
            <div className="form-err" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
              Doublon possible avec la fiche{' '}
              {others.map((d, i) => (
                <span key={d.id}>
                  {i > 0 && ', '}
                  <button className="linkbtn" style={{ color: 'inherit', textDecoration: 'underline' }} onClick={() => openFiche(d.id)}>{d.id}</button>
                </span>
              ))}{' '}
              (même nom, prénom et code postal).
            </div>
          )}
          {pending > 0 && (
            <div className="hint">
              <span>{plural(pending, 'proposition')} en attente de contrôle pour cette fiche.</span>
              <button className="btn btn-sm" onClick={() => goControlFiche(f.id)}>Ouvrir le contrôle</button>
            </div>
          )}
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Diffusion</h3>
            <div className="tags">
              <span>ONE (téléphone) :</span> <PushChip v={f.push.one} />
              <span style={{ marginLeft: 8 }}>OUTREACH (e-mail) :</span> <PushChip v={f.push.out} />
            </div>
          </div>
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Historique</h3>
            <ul className="timeline">
              {f.history.map((h) => (
                <li key={h.at + h.field}>
                  <strong>{FIELD_LABEL[h.field]}</strong> mis à jour le {fmtDate(h.at)}
                  <div className="sub">{h.from ? <><s>{h.from}</s> → </> : null}{h.to}</div>
                  <div className="sub">Source : {h.source} · validé par {h.by}</div>
                </li>
              ))}
              <li>
                <strong>Fiche créée</strong>
                <div className="sub">Reprise initiale de la base ONE</div>
              </li>
            </ul>
          </div>
          <div>
            <button className="btn btn-primary" onClick={() => enrichOne(f.id)}>
              <Ic name="globe" />
              Enrichir cette fiche
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
