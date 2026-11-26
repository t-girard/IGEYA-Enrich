'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import Login from './Login';
import Shell from './Shell';
import Toasts from './Toasts';
import BaseView from './views/BaseView';
import ImportView from './views/ImportView';
import ConnectView from './views/ConnectView';
import ControlView from './views/ControlView';
import SyncView from './views/SyncView';
import ArchView from './views/ArchView';

export default function App() {
  const user = useStore((s) => s.user);
  const view = useStore((s) => s.view);

  useEffect(() => {
    // Échap ferme la fiche ouverte.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useStore.getState().base.openId) useStore.getState().openFiche(null);
    };
    // Un fichier déposé n'importe où dans la fenêtre est envoyé vers l'import (sinon le navigateur l'ouvrirait).
    const onOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file && useStore.getState().user) void useStore.getState().loadFile(file);
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <>
      {!user ? (
        <Login />
      ) : (
        <Shell>
          {view === 'base' && <BaseView />}
          {view === 'import' && <ImportView />}
          {view === 'connect' && <ConnectView />}
          {view === 'control' && <ControlView />}
          {view === 'sync' && <SyncView />}
          {view === 'arch' && <ArchView />}
        </Shell>
      )}
      <Toasts />
    </>
  );
}
