import { useRef, useState, type MouseEvent, type CSSProperties } from 'react';
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
  const cardRef = useRef<HTMLButtonElement>(null);
  const [mousePos, setMousePos] = useState({ x: 200, y: 200, px: 0, py: 0 });
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = (e: MouseEvent) => {
    e.stopPropagation();
    setIsMenuOpen(prev => {
      if (!prev) {
        setMousePos({ x: 200, y: 200, px: 0, py: 0 });
      }
      return !prev;
    });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isMenuOpen) return;
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const px = (x / rect.width) * 2 - 1;
    const py = (y / rect.height) * 2 - 1;

    setMousePos({ x, y, px, py });
  };

  const handleMouseLeave = () => {
    if (isMenuOpen) return;
    setMousePos(prev => ({ ...prev, px: 0, py: 0 }));
  };

  const statusClass = `exam-singularity--${exam.status}`;
  const statusDisplay = getStatusDisplay(exam.status);

  const formattedDate = exam.examDate 
    ? new Date(exam.examDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) 
    : 'Data Desconhecida';

  const CardContent = () => (
    <>
      <div className="exam-singularity__meta-top">
        <span className="exam-singularity__id-label">{exam.id.split('-')[0]}</span>
        <span className="exam-singularity__date">{formattedDate}</span>
      </div>
      
      <h3 className="exam-singularity__title">{exam.title}</h3>
      
      {exam.edital && <p className="exam-singularity__edital">{exam.edital}</p>}

      <div className="exam-singularity__stats">
        <div className="exam-singularity__stat-box">
          <span className="stat-label">Questões</span>
          <span className="stat-value">{exam.totalQuestions ?? '?'}</span>
        </div>
        <div className="exam-singularity__stat-box">
          <span className="stat-label">Score Máx</span>
          <span className="stat-value cyber-glitch-text">TBD</span>
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
    <button
      className={`exam-singularity ${statusClass}`}
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={isMenuOpen ? undefined : onClick}
      type="button"
      style={{
        '--mx': `${mousePos.x}px`,
        '--my': `${mousePos.y}px`,
        '--rx': `${mousePos.py * -15}deg`,
        '--ry': `${mousePos.px * 15}deg`,
        '--px': mousePos.px,
        '--py': mousePos.py,
      } as CSSProperties}
    >
      {/* Side Badge (Triggers Menu) */}
      <div 
        className={`exam-singularity__side-badge ${isMenuOpen ? 'is-active' : ''}`} 
        onClick={toggleMenu}
      >
        <svg className="exam-singularity__badge-icon gear-celestial" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Outer mechanical gear ring */}
          <path className="gear-ring" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          
          {/* Inner celestial body: pulsing core with a small star flare */}
          <path className="celestial-flare" d="M12 4 L12.5 10.5 L19 11 L12.5 11.5 L12 18 L11.5 11.5 L5 11 L11.5 10.5 Z" fill="currentColor" opacity="0.6" />
          <circle className="celestial-core" cx="12" cy="11" r="2.5" fill="currentColor" />
        </svg>
      </div>

      {/* Top Tab for Stacked View */}
      <div className="exam-singularity__folder-tab">
        <span className="exam-singularity__folder-tab-title">{exam.title}</span>
      </div>

      <div className="exam-singularity__hole-mask">
        <div className="exam-singularity__nebula" />
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
          <div className="exam-singularity__glass-panel">
            {step !== undefined && (
              <div key={`wizard-scan-${step}`} className="exam-singularity__wizard-scan-line" />
            )}
            {exam.status === 'processing' && <div className="exam-singularity__scan-line" />}
            <CardContent />
          </div>
        </div>

        {exam.status === 'failed' && (
          <>
            <div className="exam-singularity__glitch-layer glitch-layer-1">
              <div className="exam-singularity__content-layer glitch-content-layer">
                <div className="exam-singularity__glass-panel">
                  {exam.status === 'processing' && <div className="exam-singularity__scan-line" />}
                  <CardContent />
                </div>
              </div>
            </div>
            <div className="exam-singularity__glitch-layer glitch-layer-2">
              <div className="exam-singularity__content-layer glitch-content-layer">
                <div className="exam-singularity__glass-panel">
                  {exam.status === 'processing' && <div className="exam-singularity__scan-line" />}
                  <CardContent />
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
          <h4 className="modal-title">OPÇÕES DO SISTEMA</h4>
          
          <Button 
            className="huge-btn edit" 
            onClick={(e) => { e.stopPropagation(); setIsMenuOpen(false); onEdit?.(e); }}
          >
            EDITAR DADOS
          </Button>
          
          <Button 
            className="huge-btn delete" 
            onClick={(e) => { e.stopPropagation(); setIsMenuOpen(false); onDelete?.(e); }}
          >
            PURGAR ARQUIVO
          </Button>

          <Button 
            className="huge-btn cancel" 
            onClick={toggleMenu}
            aria-label="Fechar"
          >
            ✕
          </Button>
        </div>
      )}
    </button>
  );
}
