import { useRef, type MouseEvent } from 'react';

/**
 * Spotlight que segue o cursor dentro do card — mesma linguagem do
 * glow magnético dos botões (--mx/--my), mas sem pull de translate.
 * Escreve --gx/--gy/--glow-o direto no elemento: zero re-render por mousemove.
 * A camada visual é o filho `.card-glow` (primitives.css).
 */
export function useCursorGlow<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  const onMouseMove = (e: MouseEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--gx', `${e.clientX - r.left}px`);
    el.style.setProperty('--gy', `${e.clientY - r.top}px`);
  };

  const onMouseEnter = () => ref.current?.style.setProperty('--glow-o', '1');
  const onMouseLeave = () => ref.current?.style.setProperty('--glow-o', '0');

  return { ref, onMouseMove, onMouseEnter, onMouseLeave };
}
