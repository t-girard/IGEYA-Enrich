'use client';

import type { ReactNode } from 'react';
import { useStore } from '@/lib/store';
import type { View } from '@/lib/types';
import { Brand, Ic, type IconName } from './ui';
import Drawer from './Drawer';
import ScrollTop from './ScrollTop';

function NavItem({ v, icon, label, badge }: { v: View; icon: IconName; label: string; badge?: number }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  return (
    <button className="nav-item" aria-current={view === v ? 'page' : undefined} onClick={() => { setView(v); window.scrollTo(0, 0); }}>
      <Ic name={icon} />
      <span>{label}</span>
      {badge ? <span className="badge">{badge}</span> : null}
    </button>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const user = useStore((s) => s.user);
  const pending = useStore((s) => s.stats?.pending ?? 0);
  const todo = useStore((s) => (s.stats ? s.stats.a_diffuser_one + s.stats.a_diffuser_out : 0));
  const logout = useStore((s) => s.logout);
  const openId = useStore((s) => s.openId);

  return (
    <>
      <div className="shell">
        <nav className="rail" aria-label="Navigation principale">
          <div className="rail-inner">
            <Brand />
            <div className="nav-group">
              <div className="nav-label">Référentiel</div>
              <NavItem v="base" icon="base" label="Base de référence" />
            </div>
            <div className="nav-group">
              <div className="nav-label">Sources</div>
              <NavItem v="import" icon="upload" label="Import de fichier" />
              <NavItem v="connect" icon="globe" label="Connecteurs web" />
            </div>
            <div className="nav-group">
              <div className="nav-label">Qualité</div>
              <NavItem v="control" icon="shield" label="Contrôle et validation" badge={pending} />
            </div>
            <div className="nav-group">
              <div className="nav-label">Diffusion</div>
              <NavItem v="sync" icon="send" label="ONE et OUTREACH" badge={todo} />
            </div>
            <div className="nav-group">
              <div className="nav-label">Conception</div>
              <NavItem v="arch" icon="layers" label="Architecture" />
            </div>
            <div className="rail-foot">
              <div className="who">{user?.email}</div>
              <button className="btn btn-sm" onClick={() => void logout()}>
                <Ic name="logout" />
                Se déconnecter
              </button>
            </div>
          </div>
        </nav>
        <main className="main" id="main">
          <div className="main-inner">{children}</div>
        </main>
      </div>
      <ScrollTop />
      {openId ? <Drawer id={openId} /> : null}
    </>
  );
}
