import { useEffect, useRef } from 'react';
import './QuizDots.css';

export type QuizDotState = 'pending' | 'current' | 'correct' | 'wrong' | 'annulled' | 'answered';

type QuizDotsProps = {
  total: number;
  currentIndex: number;
  /** Resolve o estado visual de cada posição (current é aplicado pelo componente). */
  getState: (index: number) => QuizDotState;
  onNavigate: (index: number) => void;
  /** Desativa a navegação por teclado (ex.: modal aberto). */
  keyboardEnabled?: boolean;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

export function QuizDots({ total, currentIndex, getState, onNavigate, keyboardEnabled = true }: QuizDotsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Teclado: ←/→ navega; dígitos 1-9 pulam direto para o fragmento N.
  useEffect(() => {
    if (!keyboardEnabled) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onNavigate(Math.max(0, currentIndex - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onNavigate(Math.min(total - 1, currentIndex + 1));
      } else if (/^[1-9]$/.test(event.key)) {
        const target = Number(event.key) - 1;
        if (target < total) {
          event.preventDefault();
          onNavigate(target);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keyboardEnabled, currentIndex, total, onNavigate]);

  // Mantém o dot atual visível no scroll container (mobile).
  useEffect(() => {
    const container = scrollRef.current;
    const active = container?.querySelector<HTMLElement>('.quiz-dots__dot--current');
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [currentIndex]);

  return (
    <div className="quiz-dots" ref={scrollRef} role="tablist" aria-label="Navegação de fragmentos">
      {Array.from({ length: total }, (_, index) => {
        const state: QuizDotState = index === currentIndex ? 'current' : getState(index);
        return (
          <button
            key={index}
            type="button"
            role="tab"
            aria-selected={index === currentIndex}
            aria-label={`Fragmento ${index + 1} — ${state}`}
            className={`quiz-dots__dot quiz-dots__dot--${state}`}
            onClick={() => onNavigate(index)}
          >
            {index + 1}
          </button>
        );
      })}
    </div>
  );
}
