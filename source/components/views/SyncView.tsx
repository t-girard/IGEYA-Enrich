'use client';

import { useStore } from '@/lib/store';
import { plural } from '@/lib/text';
import { FIELD_LABEL, type Fiche, type Field } from '@/lib/types';
import { Ic, PageHead } from '../ui';

const payloadOne = (f: Fiche) => ({
  id_externe: f.id,
  rpps: f.rpps,
  nom: f.nom,
  prenom: f.prenom,
  profession: f.metier,
  code_postal: f.cp,
  telephone: f.tel.replace(/\s/g, ''),
  source: f.telSrc?.source,
  mis_a_jour: (f.telSrc?.at ?? '').slice(0, 10),
});

const payloadOut = (f: Fiche) => ({
  id_externe: f.id,
  email: f.email,
  nom: f.nom,
  prenom: f.prenom,
  profession: f.metier,
  code_postal: f.cp,
  source: f.emailSrc?.source,
  mis_a_jour: (f.emailSrc?.at ?? '').slice(0, 10),
});

function Panel({
  title, desc, list, field, payload, onPush,
}: {
  title: string;
  desc: string;
  list: Fiche[];
  field: Field;
  payload: (f: Fiche) => unknown;
  onPush: () => void;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <button className="btn btn-primary btn-sm" disabled={!list.length} onClick={onPush}>
          <Ic name="send" />
          Envoyer {plural(list.length, 'fiche')}
        </button>
      </div>
      <div className="panel-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="muted">{desc}</p>
        {list.length ? (
          <>
            <div className="tbl-wrap">
              <table className="tbl" style={{ minWidth: 420 }}>
                <thead><tr><th>Fiche</th><th>{FIELD_LABEL[field]}</th><th>Source</th></tr></thead>
                <tbody>
                  {list.slice(0, 8).map((f) => (
                    <tr key={f.id}>
                      <td>{f.prenom} <strong>{f.nom.toUpperCase()}</strong></td>
                      <td className="mono">{f[field]}</td>
                      <td className="sub">{(field === 'tel' ? f.telSrc : f.emailSrc)?.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list.length > 8 && <span className="sub">+ {list.length - 8} autres fiches</span>}
            <details>
              <summary>Voir le message envoyé (exemple)</summary>
              <pre className="code" style={{ marginTop: 8 }}>{JSON.stringify(payload(list[0]), null, 2)}</pre>
            </details>
          </>
        ) : (
          <Empty0 />
        )}
      </div>
    </section>
  );
}

function Empty0() {
  return (
    <div className="empty" style={{ padding: '20px 0' }}>
      <strong>Rien à diffuser</strong>
      Les fiches validées dans le contrôle apparaîtront ici.
    </div>
  );
}

export default function SyncView() {
  const fiches = useStore((s) => s.fiches);
  const syncLog = useStore((s) => s.syncLog);
  const pushDest = useStore((s) => s.pushDest);

  const one = fiches.filter((f) => f.push.one === 'todo' && f.tel);
  const out = fiches.filter((f) => f.push.out === 'todo' && f.email);

  return (
    <>
      <PageHead title="ONE et OUTREACH">
        Seules les fiches validées sont diffusées. ONE reçoit les téléphones, OUTREACH reçoit les e-mails. Les envois sont simulés dans cette maquette.
      </PageHead>
      <div className="two">
        <Panel
          title="Vers ONE (CRM)"
          desc="ONE reçoit la fiche et son numéro de téléphone normalisé. Il alimente ensuite les batchs des téléprospecteurs."
          list={one}
          field="tel"
          payload={payloadOne}
          onPush={() => pushDest('one')}
        />
        <Panel
          title="Vers OUTREACH (marketing)"
          desc="OUTREACH reçoit l’adresse e-mail et les attributs de segmentation pour les campagnes e-mail, SMS et landing pages."
          list={out}
          field="email"
          payload={payloadOut}
          onPush={() => pushDest('out')}
        />
      </div>
      <section className="panel">
        <div className="panel-head"><h2>Journal des envois</h2></div>
        {syncLog.length ? (
          <div className="tbl-wrap">
            <table className="tbl" style={{ minWidth: 480 }}>
              <thead><tr><th>Date</th><th>Destination</th><th>Fiches</th></tr></thead>
              <tbody>
                {syncLog.slice(0, 8).map((l, i) => (
                  <tr key={l.at + i}>
                    <td>{new Date(l.at).toLocaleString('fr-FR')}</td>
                    <td>{l.dest}</td>
                    <td>{plural(l.n, 'fiche')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty" style={{ padding: '24px 18px' }}>Aucun envoi pour le moment.</div>
        )}
      </section>
    </>
  );
}
