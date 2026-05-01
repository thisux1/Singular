import { useRef, useState, type MouseEvent, type CSSProperties } from 'react';
import type { Exam } from '../../api/exams';
import { Button } from '../ui/Button';
import './ExamSingularityCard.css';

interface ExamSingularityCardProps {
  exam: Exam;
  onClick?: () => void;
  onEdit?: (e: MouseEvent) => void;
  onDelete?: (e: MouseEvent) => void;
}

function getStatusDisplay(status: string) {
  if (status === 'queued') return { label: 'Em órbita: Aguardando fila' };
  if (status === 'processing') return { label: 'Extraindo dados da singularidade...' };
  if (status === 'reviewing') return { label: 'Anomalia detectada: Requer revisão manual' };
  if (status === 'failed') return { label: 'Falha crítica: Estrutura corrompida' };
  return { label: null };
}

export function ExamSingularityCard({ exam, onClick, onEdit, onDelete }: ExamSingularityCardProps) {
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
        <span>OPÇÕES</span>
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

        <div className="exam-singularity__content-layer">
          <div className="exam-singularity__glass-panel">
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
