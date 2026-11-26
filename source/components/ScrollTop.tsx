'use client';

import { useEffect, useRef, useState } from 'react';
import { Ic } from './ui';

/** Seuil de défilement (px) à partir duquel le bouton peut apparaître. */
const MIN_Y = 240;
/** Remontée minimale (px) pour considérer que la personne remonte vraiment la page. */
const UP_DELTA = 8;

/**
 * Bouton « retour en haut » pour mobile : il apparaît en haut à droite quand on remonte la page
 * et disparaît quand on redescend ou qu'on est déjà tout en haut.
 */
export default function ScrollTop() {
  const [show, setShow] = useState(false);
  const last = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    last.current = window.scrollY;
    const update = () => {
      ticking.current = false;
      const y = window.scrollY;
      const dy = y - last.current;
      if (y < MIN_Y) setShow(false);
      else if (dy <= -UP_DELTA) setShow(true);
      else if (dy >= UP_DELTA) setShow(false);
      if (Math.abs(dy) >= UP_DELTA || y < MIN_Y) last.current = y;
    };
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const goTop = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    setShow(false);
  };

  return (
    <button
      type="button"
      className={'scroll-top' + (show ? ' is-on' : '')}
      onClick={goTop}
      aria-label="Revenir en haut de la page"
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
    >
      <Ic name="up" />
    </button>
  );
}
