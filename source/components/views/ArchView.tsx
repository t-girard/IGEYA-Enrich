'use client';

import type { ReactNode } from 'react';
import { PageHead } from '../ui';

const CONTRACT = `igeya.fiches          une ligne par professionnel (RPPS)
  tel, tel_source, tel_le        valeur + provenance
  email, email_source, email_le
  push_one, push_out             à diffuser / à jour
  lieux                          lieux d’exercice (ANS)

igeya.propositions    zone de transit
  champ, propose, brut, sources[], confiance,
  score_rapprochement, statut, decide_par

igeya.historique      chaque valeur validée
igeya.taches          enrichissements en cours
igeya.diffusion       file lue par ONE et OUTREACH`;

function Stage({ n, title, items, keyStage }: { n: number; title: string; items: string[]; keyStage?: boolean }) {
  return (
    <div className={'stage' + (keyStage ? ' key' : '')}>
      <h3><span className="n">{n}</span>{title}</h3>
      <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </div>
  );
}

function Card({ title, items, children }: { title: string; items?: string[]; children?: ReactNode }) {
  return (
    <div className="panel panel-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ fontSize: 15 }}>{title}</h3>
      {items && <ul className="rules muted">{items.map((i) => <li key={i}>{i}</li>)}</ul>}
      {children}
    </div>
  );
}

export default function ArchView() {
  return (
    <>
      <PageHead title="Architecture">
        Les sources ne touchent jamais la base de référence. Tout passe par une zone de transit, puis par le contrôle d’un utilisateur.
      </PageHead>
      <div className="flow">
        <Stage n={1} title="Sources" items={['Annuaire Santé : synchronisation chaque nuit', 'Fichiers CSV et Excel', 'Connecteurs web (Annuaire Santé, puis Contact Extractor…)', 'Futurs connecteurs']} />
        <Stage n={2} title="Connecteurs" items={['Un fichier Python par source', 'Sortie unique : une proposition par champ', 'Exécutés en tâche de fond, au rythme de chaque source']} />
        <Stage n={3} title="Zone de transit" keyStage items={['Normalisation des téléphones et e-mails', 'Rapprochement nom, prénom, code postal', 'Détection des doublons et des incertitudes']} />
        <Stage n={4} title="Contrôle humain" keyStage items={['Source, valeur actuelle, valeur proposée', 'Accepter ou rejeter, seul ou en lot', 'Rien n’est écrit avant cette étape']} />
        <Stage n={5} title="Base de référence" items={['Une fiche par professionnel', 'Source et date pour chaque coordonnée', 'Historique de chaque modification']} />
      </div>
      <div className="two">
        <Card title="Vers ONE (CRM)" items={['Fiche prospect et téléphone au format unique', 'Seules les fiches validées partent', 'Base partagée : ONE lit la file igeya.diffusion', 'ONE alimente les batchs des téléprospecteurs']} />
        <Card title="Vers OUTREACH (marketing)" items={['E-mail et attributs de segmentation', 'Alimente les campagnes e-mail, SMS, landing pages et bientôt Meta Ads', 'Flux indépendant de celui de ONE']} />
      </div>
      <div className="two">
        <Card
          title="Pourquoi cette structure"
          items={[
            'Une source mauvaise ou erronée ne peut pas dégrader la base',
            'Ajouter un connecteur = déposer un fichier Python, rien d’autre',
            'On sait toujours d’où vient une valeur et qui l’a validée',
            'ONE et OUTREACH reçoivent des données homogènes',
          ]}
        />
        <Card title="Modèle de données (PostgreSQL, schéma igeya)">
          <pre className="code">{CONTRACT}</pre>
        </Card>
      </div>
    </>
  );
}
