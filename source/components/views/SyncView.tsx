'use client';

import { useState } from 'react';
import { useApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import { plural } from '@/lib/text';
import { FIELD_LABEL, type DiffusionEtat, type DiffusionPanel, type Field } from '@/lib/types';
import { Ic, PageHead } from '../ui';

function Panel({
  title, desc, panel, field, dest, onPush,
}: {
  title: string;
  desc: string;
  panel: DiffusionPanel | undefined;
  field: Field;
  dest: string;
  onPush: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const list = panel?.apercu ?? [];
  const n = panel?.n ?? 0;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <button className="btn btn-primary btn-sm" disabled={!n || busy} onClick={async () => { setBusy(true); await onPush(); setBusy(false); }}>
          <Ic name="send" />
          Envoyer {plural(n, 'fiche')}
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
            {n > 8 && <span className="sub">+ {(n - 8).toLocaleString('fr-FR')} autres fiches</span>}
            <details>
              <summary>Voir le message déposé pour {dest} (exemple)</summary>
              <pre className="code" style={{ marginTop: 8 }}>{JSON.stringify(panel?.exemple, null, 2)}</pre>
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

const LECTURE = `-- Lecture par ONE (même principe pour OUTREACH) :
SELECT id, donnees FROM igeya.diffusion
 WHERE destination = 'ONE' AND lu_le IS NULL ORDER BY id;
-- puis, une fois les fiches intégrées :
UPDATE igeya.diffusion SET lu_le = now() WHERE id = ANY(:ids);

-- État courant, sans passer par la file :
SELECT * FROM igeya.v_one_prospects;      -- téléphones
SELECT * FROM igeya.v_outreach_contacts;  -- e-mails`;

export default function SyncView() {
  const version = useStore((s) => s.version);
  const pushDest = useStore((s) => s.pushDest);
  const { data, error } = useApi<DiffusionEtat>('/diffusion', version);
  const syncLog = data?.journal ?? [];

  return (
    <>
      <PageHead title="ONE et OUTREACH">
        Seules les fiches validées sont diffusées. ONE reçoit les téléphones, OUTREACH reçoit les e-mails. L’envoi dépose les fiches dans la base partagée, où ONE et OUTREACH viennent les lire.
      </PageHead>
      <div className="two">
        <Panel
          title="Vers ONE (CRM)"
          desc="ONE reçoit la fiche et son numéro de téléphone normalisé. Il alimente ensuite les batchs des téléprospecteurs."
          panel={data?.one}
          field="tel"
          dest="ONE"
          onPush={() => pushDest('ONE')}
        />
        <Panel
          title="Vers OUTREACH (marketing)"
          desc="OUTREACH reçoit l’adresse e-mail et les attributs de segmentation pour les campagnes e-mail, SMS et landing pages."
          panel={data?.out}
          field="email"
          dest="OUTREACH"
          onPush={() => pushDest('OUTREACH')}
        />
      </div>
      {error && <div className="form-err">{error}</div>}
      <section className="panel">
        <div className="panel-head"><h2>Journal des envois</h2></div>
        {syncLog.length ? (
          <div className="tbl-wrap">
            <table className="tbl" style={{ minWidth: 480 }}>
              <thead><tr><th>Date</th><th>Destination</th><th>Fiches</th><th>Lues par la destination</th><th>Par</th></tr></thead>
              <tbody>
                {syncLog.slice(0, 8).map((l, i) => (
                  <tr key={l.at + i}>
                    <td>{new Date(l.at).toLocaleString('fr-FR')}</td>
                    <td>{l.dest}</td>
                    <td>{plural(l.n, 'fiche')}</td>
                    <td>{l.lus === l.n ? 'Toutes' : `${l.lus} / ${l.n}`}</td>
                    <td className="sub">{l.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty" style={{ padding: '24px 18px' }}>Aucun envoi pour le moment.</div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Comment ONE et OUTREACH lisent les fiches</h2></div>
        <div className="panel-pad"><pre className="code">{LECTURE}</pre></div>
      </section>
    </>
  );
}
