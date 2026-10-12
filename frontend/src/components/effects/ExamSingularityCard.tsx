import { useRef, useState, type MouseEvent } from 'react';
import { usePrefersReducedMotion } from '../../hooks/useMediaQuery';
import type { Exam } from '../../api/exams';
import { Button } from '../ui/Button';
import './ExamSingularityCard.css';

interface ExamSingularityCardProps {
  exam: Exam;
  onClick?: () => void;
  onEdit?: (e: MouseEvent) => void;
  onDelete?: (e: MouseEvent) => void;
  step?: number;
}

function getStatusDisplay(status: string) {
  if (status === 'queued') return { label: 'Em órbita: Aguardando fila' };
  if (status === 'processing') return { label: 'Extraindo dados da singularidade...' };
  if (status === 'reviewing') return { label: 'Anomalia detectada: Requer revisão manual' };
  if (status === 'failed') return { label: 'Falha crítica: Estrutura corrompida' };
  return { label: null };
}

export function ExamSingularityCard({ exam, onClick, onEdit, onDelete, step }: ExamSingularityCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  // Vars de tilt/glare escritas direto no DOM — composited, zero re-render.
  const setTiltVars = (x: number, y: number, px: number, py: number) => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--mx', `${x}px`);
    el.style.setProperty('--my', `${y}px`);
    el.style.setProperty('--rx', `${py * -15}deg`);
    el.style.setProperty('--ry', `${px * 15}deg`);
    el.style.setProperty('--px', `${px}`);
    el.style.setProperty('--py', `${py}`);
  };

  const toggleMenu = (e: MouseEvent) => {
    e.stopPropagation();
    setIsMenuOpen(prev => {
      if (!prev) {
        setTiltVars(200, 200, 0, 0);
      }
      return !prev;
    });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isMenuOpen || reducedMotion) return;
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const px = (x / rect.width) * 2 - 1;
    const py = (y / rect.height) * 2 - 1;

    setTiltVars(x, y, px, py);
  };

  const handleMouseLeave = () => {
    if (isMenuOpen) return;
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--px', '0');
    el.style.setProperty('--py', '0');
  };

  const statusClass = `exam-singularity--${exam.status}`;
  const statusDisplay = getStatusDisplay(exam.status);

  // Score máximo real (stats da API). Campo ausente/nulo → '—'.
  const bestScore = exam.stats?.bestScore;
  const bestScoreDisplay = typeof bestScore === 'number' ? `${Math.round(bestScore)}%` : '—';

  const formattedDate = exam.examDate 
    ? new Date(exam.examDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) 
    : 'Data Desconhecida';

  const cardContent = (
    <>
      <div className="exam-singularity__meta-top">
        <span className="exam-singularity__id-label">{exam.id.split('-')[0]}</span>
        <span>{formattedDate}</span>
      </div>

      <h3 className="exam-singularity__title">{exam.title}</h3>

      {exam.edital && <p className="exam-singularity__edital">{exam.edital}</p>}

      <div className="exam-singularity__stats">
        <div className="exam-singularity__stat-box stat">
          <span className="exam-singularity__stat-label">Questões</span>
          <span className="exam-singularity__stat-value">{exam.totalQuestions ?? '?'}</span>
        </div>
        <div className="exam-singularity__stat-box stat">
          <span className="exam-singularity__stat-label">Score Máx</span>
          <span className="exam-singularity__stat-value">{bestScoreDisplay}</span>
        </div>
      </div>

      {statusDisplay.label && (
        <div className="exam-list__status-msg">
          {statusDisplay.label}
        </div>
      )}

    </>
  );

  return (
    <div
      className={`exam-singularity ${statusClass}`}
      ref={cardRef}
      role="button"
      tabIndex={0}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={isMenuOpen ? undefined : onClick}
      onKeyDown={(e) => {
        if (isMenuOpen) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      {/* Side Badge (Triggers Menu) */}
      <button
        type="button"
        className={`exam-singularity__side-badge ${isMenuOpen ? 'is-active' : ''}`}
        onClick={toggleMenu}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        aria-label={isMenuOpen ? 'Fechar menu da prova' : 'Abrir menu da prova'}
      >
        <svg className="exam-singularity__badge-icon gear-celestial" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Outer mechanical gear ring */}
          <path className="gear-ring" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          
          {/* Inner celestial body: pulsing core with a small star flare */}
          <path className="celestial-flare" d="M12 4 L12.5 10.5 L19 11 L12.5 11.5 L12 18 L11.5 11.5 L5 11 L11.5 10.5 Z" fill="currentColor" opacity="0.6" />
          <circle className="celestial-core" cx="12" cy="11" r="2.5" fill="currentColor" />
        </svg>
      </button>

      {/* Top Tab for Stacked View */}
      <div className="exam-singularity__folder-tab">
        <span className="exam-singularity__folder-tab-title">{exam.title}</span>
      </div>

      <div className="exam-singularity__hole-mask">
        {/* Wrapper anima transform; o blur fica no filho e rasteriza 1×. */}
        <div className="exam-singularity__nebula-spin">
          <div className="exam-singularity__nebula" />
        </div>
        <div className="exam-singularity__stars" />

        <div className="exam-singularity__orb-container">
          <div className="exam-singularity__orb">
            <div className="exam-singularity__orb-core" />
            <div className="exam-singularity__orb-ring ring-1" />
            <div className="exam-singularity__orb-ring ring-2" />
          </div>
        </div>

        {/* Sci-Fi Decals (Matte/Non-reflective) */}
        <div className="exam-singularity__decals">
          <span className="decal decal--tl">[ SYS_READY ]</span>
          <span className="decal decal--tr">+</span>
          <div className="decal decal--left-bar"></div>
        </div>

        <div className="exam-singularity__content-layer">
          <div className="exam-singularity__glass-panel terminal terminal--flat terminal--cut-b">
            {step !== undefined && (
              <div key={`wizard-scan-${step}`} className="exam-singularity__wizard-scan-line" />
            )}
            {exam.status === 'processing' && <div className="exam-singularity__scan-line" />}
            {cardContent}
          </div>
        </div>

        {exam.status === 'failed' && (
          <>
            <div className="exam-singularity__glitch-layer glitch-layer-1">
              <div className="exam-singularity__content-layer glitch-content-layer">
                <div className="exam-singularity__glass-panel terminal terminal--flat terminal--cut-b">
                  {cardContent}
                </div>
              </div>
            </div>
            <div className="exam-singularity__glitch-layer glitch-layer-2">
              <div className="exam-singularity__content-layer glitch-content-layer">
                <div className="exam-singularity__glass-panel terminal terminal--flat terminal--cut-b">
                  {cardContent}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="exam-singularity__glare" />
      </div>

      {/* Full Card Modal Options */}
      {isMenuOpen && (
        <div className="exam-singularity__full-modal" onClick={(e) => e.stopPropagation()}>
          <h4 className="exam-singularity__modal-title">OPÇÕES DO SISTEMA</h4>

          <Button
            className="exam-singularity__huge-btn exam-singularity__huge-btn--edit"
            onClick={(e) => { e.stopPropagation(); setIsMenuOpen(false); onEdit?.(e); }}
          >
            EDITAR DADOS
          </Button>

          <Button
            className="exam-singularity__huge-btn exam-singularity__huge-btn--delete"
            onClick={(e) => { e.stopPropagation(); setIsMenuOpen(false); onDelete?.(e); }}
          >
            PURGAR ARQUIVO
          </Button>

          <Button
            className="exam-singularity__huge-btn exam-singularity__huge-btn--cancel"
            onClick={toggleMenu}
            aria-label="Fechar"
          >
            ✕
          </Button>
        </div>
      )}
    </div>
  );
}
