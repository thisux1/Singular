import { useRef, useState, type MouseEvent, type ReactNode, type CSSProperties } from 'react';
import './GravitationalCard.css';

interface GravitationalCardProps {
  children?: ReactNode;
  className?: string;
}

export function GravitationalCard({ children, className = '' }: GravitationalCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 200, y: 200, px: 0, py: 0 });

  const handleMouseMove = (e: MouseEvent) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Calcula o percentual de rotação 3D (-1 a 1) baseado na posição do mouse
    const px = (x / rect.width) * 2 - 1;
    const py = (y / rect.height) * 2 - 1;

    setMousePos({ x, y, px, py });
  };

  const handleMouseLeave = () => {
    setMousePos(prev => ({ ...prev, px: 0, py: 0 }));
  };

  return (
    <div className={`creative-wrapper ${className}`}>
      <div
        className="creative-card"
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          '--mx': `${mousePos.x}px`,
          '--my': `${mousePos.y}px`,
          '--rx': `${mousePos.py * -15}deg`,
          '--ry': `${mousePos.px * 15}deg`,
          '--px': mousePos.px,
          '--py': mousePos.py,
        } as CSSProperties}
      >
        {/* Layer 1: Nebulosas no fundo com animação */}
        <div className="creative-card__nebula" />
        
        {/* Layer 2: Partículas e estrelas se movendo com o parallax */}
        <div className="creative-card__stars" />

        {/* Layer 3: O Núcleo / Singularidade Flutuante 3D */}
        <div className="creative-card__orb-container">
          <div className="creative-card__orb">
            <div className="creative-card__orb-core" />
            <div className="creative-card__orb-ring ring-1" />
            <div className="creative-card__orb-ring ring-2" />
            <div className="creative-card__orb-ring ring-3" />
          </div>
        </div>

        {/* Layer 4: Interface flutuante com Parallax Extremo (Painel de Vidro) */}
        <div className="creative-card__content-layer">
          <div className="creative-card__glass-panel">
            {children || (
              <div className="creative-card__content">
                <div className="creative-card__badge">Cosmic Engine</div>
                <h3 className="creative-card__title">Stellar Forge</h3>
                <p className="creative-card__desc">
                  Simulação espacial com múltiplas camadas de parallax, 
                  reflexos dinâmicos e núcleos energéticos em 3D.
                </p>
                <button className="creative-card__btn">Ignition Sequence</button>
              </div>
            )}
          </div>
        </div>

        {/* Layer 5: Brilho que segue o mouse */}
        <div className="creative-card__glare" />
      </div>
    </div>
  );
}
