import { useRef, useState, type MouseEvent, type ReactNode, type CSSProperties } from 'react';
import './ExamSingularityCard.css';

interface ExamSingularityCardProps {
  children: ReactNode;
  status: string;
  onClick?: () => void;
}

export function ExamSingularityCard({ children, status, onClick }: ExamSingularityCardProps) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const [mousePos, setMousePos] = useState({ x: 200, y: 200, px: 0, py: 0 });

  const handleMouseMove = (e: MouseEvent) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const px = (x / rect.width) * 2 - 1;
    const py = (y / rect.height) * 2 - 1;

    setMousePos({ x, y, px, py });
  };

  const handleMouseLeave = () => {
    setMousePos(prev => ({ ...prev, px: 0, py: 0 }));
  };

  const statusClass = `exam-singularity--${status}`;

  return (
    <button
      className={`exam-singularity ${statusClass}`}
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
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
      {/* Cosmic Background Layers */}
      <div className="exam-singularity__nebula" />
      <div className="exam-singularity__stars" />

      {/* The Singularity Orb */}
      <div className="exam-singularity__orb-container">
        <div className="exam-singularity__orb">
          <div className="exam-singularity__orb-core" />
          <div className="exam-singularity__orb-ring ring-1" />
          <div className="exam-singularity__orb-ring ring-2" />
        </div>
      </div>

      {/* Glass Panel Content */}
      <div className="exam-singularity__content-layer">
        <div className="exam-singularity__glass-panel">
          {children}
        </div>
      </div>

      {/* Continuous Glitch Overlay for Failed Status */}
      {status === 'failed' && (
        <>
          <div className="exam-singularity__glitch-layer glitch-layer-1">
            <div className="exam-singularity__content-layer glitch-content-layer">
              <div className="exam-singularity__glass-panel">
                {children}
              </div>
            </div>
          </div>
          <div className="exam-singularity__glitch-layer glitch-layer-2">
            <div className="exam-singularity__content-layer glitch-content-layer">
              <div className="exam-singularity__glass-panel">
                {children}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Interactive Glare overlay */}
      <div className="exam-singularity__glare" />
    </button>
  );
}
