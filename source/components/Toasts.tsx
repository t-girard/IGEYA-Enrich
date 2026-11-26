'use client';

import { useStore } from '@/lib/store';

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div id="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={'toast' + (t.kind ? ' ' + t.kind : '')} role="status">
          {t.msg}
        </div>
      ))}
    </div>
  );
}
