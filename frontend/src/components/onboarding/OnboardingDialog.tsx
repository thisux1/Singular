import { useCallback, useEffect, useRef, useState } from 'react';
import './OnboardingDialog.css';

interface OnboardingStep {
  tag: string;
  title: string;
  description: string;
  icon: 'upload' | 'review' | 'play';
}

const STEPS: OnboardingStep[] = [
  {
    tag: 'Passo 01 // Ingestão',
    title: 'Envie a prova',
    description:
      'Faça upload do PDF da prova ou do gabarito. O Singular extrai as questões automaticamente — sem digitar nada.',
    icon: 'upload',
  },
  {
    tag: 'Passo 02 // Revisão',
    title: 'Revise as questões',
    description:
      'Confira o que foi extraído: edite enunciados, alternativas e gabarito antes de montar o seu quiz.',
    icon: 'review',
  },
  {
    tag: 'Passo 03 // Execução',
    title: 'Jogue o quiz',
    description:
      'Responda no modo quiz com feedback imediato e acompanhe o seu desempenho prova a prova.',
    icon: 'play',
  },
];

function StepIcon({ icon }: { icon: OnboardingStep['icon'] }) {
  switch (icon) {
    case 'upload':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="11" />
          <polyline points="9 14 12 11 15 14" />
        </svg>
      );
    case 'review':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          <line x1="7" y1="12" x2="7.01" y2="12" />
          <line x1="7" y1="17" x2="11" y2="17" />
        </svg>
      );
    case 'play':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

interface OnboardingDialogProps {
  open: boolean;
  onClose: () => void;
}

export function OnboardingDialog({ open, onClose }: OnboardingDialogProps) {
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  // Reseta o passo quando o dialog reabre (ajuste de estado durante render).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setStep(0);
  }

  // Foco inicial + Escape para fechar
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
      if (event.key === 'ArrowRight') setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (event.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, 0));
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const handleAdvance = useCallback(() => {
    if (isLast) {
      onClose();
    } else {
      setStep((s) => s + 1);
    }
  }, [isLast, onClose]);

  if (!open) return null;

  return (
    <div className="onboarding-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="onboarding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-step-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="onboarding-dialog__header">
          <span className="onboarding-dialog__sys">
            Singular<em>://</em>boot_sequence
          </span>
          <span className="onboarding-dialog__step-tag">{current.tag}</span>
        </div>

        <div className="onboarding-step" key={step}>
          <div className="onboarding-step__icon" aria-hidden="true">
            <StepIcon icon={current.icon} />
          </div>
          <h2 id="onboarding-step-title" className="onboarding-step__title">
            {current.title}
          </h2>
          <p className="onboarding-step__desc">{current.description}</p>
        </div>

        <div className="onboarding-dialog__footer">
          <div className="onboarding-dots" role="group" aria-label="Progresso do onboarding">
            {STEPS.map((s, i) => (
              <button
                key={s.tag}
                type="button"
                className={`onboarding-dot${i === step ? ' onboarding-dot--active' : ''}`}
                onClick={() => setStep(i)}
                aria-label={`Ir para ${s.title}`}
                aria-current={i === step ? 'step' : undefined}
              />
            ))}
          </div>

          <div className="onboarding-actions">
            <button type="button" className="onboarding-btn onboarding-btn--ghost" onClick={onClose}>
              Pular
            </button>
            <button
              type="button"
              className="onboarding-btn onboarding-btn--primary"
              onClick={handleAdvance}
            >
              {isLast ? 'Começar' : 'Próximo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
