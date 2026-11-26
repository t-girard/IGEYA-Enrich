import type { ReactNode } from 'react';

export type IconName = 'base' | 'upload' | 'globe' | 'shield' | 'send' | 'layers' | 'x' | 'logout' | 'file' | 'up';

const PATHS: Record<IconName, ReactNode> = {
  base: (<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>),
  upload: (<><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></>),
  globe: (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z" /></>),
  shield: (<><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>),
  send: <path d="M4 12l16-8-6 16-3-7-7-1z" />,
  layers: (<><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></>),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  logout: (<><path d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4" /><path d="M16 8l4 4-4 4M20 12H9" /></>),
  file: (<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></>),
  up: (<><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></>),
};

export function Ic({ name, big }: { name: IconName; big?: boolean }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" style={big ? { width: 32, height: 32 } : undefined}>
      {PATHS[name]}
    </svg>
  );
}

export function BrandMark() {
  return (
    <span className="brand-mark">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 7h9" />
        <path d="M5 12h14" />
        <path d="M5 17h9" />
        <circle cx="18" cy="7" r="1.4" />
      </svg>
    </span>
  );
}

export function Brand({ dark }: { dark?: boolean }) {
  return (
    <div className="brand" style={dark ? { color: 'var(--ink)' } : undefined}>
      <BrandMark />
      <div>
        IGEYA Enrich
        <small>Santé</small>
      </div>
    </div>
  );
}

export function PageHead({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
    </div>
  );
}

export function Chip({ tone, title, children }: { tone?: 'good' | 'warn' | 'bad' | 'info' | 'accent'; title?: string; children: ReactNode }) {
  return (
    <span className={'chip' + (tone ? ' chip-' + tone : '')} title={title}>
      {children}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}
