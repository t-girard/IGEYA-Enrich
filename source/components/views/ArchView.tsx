'use client';

import type { ReactNode } from 'react';
import { PageHead } from '../ui';

const CONTRACT = `Proposition = {
  ficheId, champ,            // ex. IGY-00012, tel
  valeurBrute, valeurNormalisee,
  source, url, confiance,    // décrit d’où vient la valeur
  scoreRapprochement,        // nom + prénom + code postal
  statut                     // à valider | validée | rejetée
}

Fiche = {
  id, rpps, nom, prenom, metier, cp, ville,
  tel:   { valeur, source, date },
  email: { valeur, source, date },
  historique[], diffusion: { one, outreach }
}`;

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
        <Stage n={1} title="Sources" items={['Fichiers CSV et Excel', 'Connecteur web (type Contact Extractor)', 'Annuaire Santé (API)', 'Futurs connecteurs']} />
        <Stage n={2} title="Adaptateurs" items={['Un adaptateur par source', 'Sortie unique : une proposition par champ', 'La source ignore le reste du système']} />
        <Stage n={3} title="Zone de transit" keyStage items={['Normalisation des téléphones et e-mails', 'Rapprochement nom, prénom, code postal', 'Détection des doublons et des incertitudes']} />
        <Stage n={4} title="Contrôle humain" keyStage items={['Source, valeur actuelle, valeur proposée', 'Accepter ou rejeter, seul ou en lot', 'Rien n’est écrit avant cette étape']} />
        <Stage n={5} title="Base de référence" items={['Une fiche par professionnel', 'Source et date pour chaque coordonnée', 'Historique de chaque modification']} />
      </div>
      <div className="two">
        <Card title="Vers ONE (CRM)" items={['Fiche prospect et téléphone au format unique', 'Seules les fiches validées partent', 'ONE alimente les batchs des téléprospecteurs']} />
        <Card title="Vers OUTREACH (marketing)" items={['E-mail et attributs de segmentation', 'Alimente les campagnes e-mail, SMS, landing pages et bientôt Meta Ads', 'Flux indépendant de celui de ONE']} />
      </div>
      <div className="two">
        <Card
          title="Pourquoi cette structure"
          items={[
            'Une source mauvaise ou erronée ne peut pas dégrader la base',
            'Ajouter un connecteur ne demande aucune évolution du reste',
            'On sait toujours d’où vient une valeur et qui l’a validée',
            'ONE et OUTREACH reçoivent des données homogènes',
          ]}
        />
        <Card title="Modèle de données">
          <pre className="code">{CONTRACT}</pre>
        </Card>
      </div>
    </>
  );
}
