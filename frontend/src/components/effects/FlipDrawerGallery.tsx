import React, { useEffect, useRef, WheelEvent, TouchEvent } from 'react';
import type { Exam } from '../../api/exams';
import { ExamSingularityCard } from './ExamSingularityCard';
import './FlipDrawerGallery.css';

interface FlipDrawerGalleryProps {
  exams: Exam[];
  onExamClick?: (exam: Exam) => void;
  onExamEdit?: (exam: Exam) => void;
  onExamDelete?: (exam: Exam) => void;
}

const ITEM_SPACING = 150; // Distance between cards in the logical track

export function FlipDrawerGallery({ exams, onExamClick, onExamEdit, onExamDelete }: FlipDrawerGalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<(HTMLDivElement | null)[]>([]);
  
  // BYPASS REACT RENDER: We store scroll offset in a mutable ref
  const offsetRef = useRef(0);
  const animationFrameRef = useRef<number>();

  // Ensure enough items to create a continuous loop
  let displayExams = [...exams];
  while (displayExams.length > 0 && displayExams.length < 20) {
    displayExams = [...displayExams, ...exams];
  }
  const totalLength = displayExams.length * ITEM_SPACING;

  // HARDWARE ACCELERATED PHYSICS ENGINE
  const updatePhysics = () => {
    if (!trackRef.current) return;
    
    // Loop boundary logic
    let o = offsetRef.current;
    if (displayExams.length > 0) {
      if (o >= totalLength) o -= totalLength;
      if (o < 0) o += totalLength;
      offsetRef.current = o;
    }

    nodesRef.current.forEach((node, index) => {
      if (!node) return;

      const elementAbsoluteZ = index * ITEM_SPACING;
      let relativeZ = (elementAbsoluteZ - o) % totalLength;
      
      // Keep coordinates in continuous mapping around the 0 center
      if (relativeZ < -totalLength / 2) relativeZ += totalLength;
      else if (relativeZ > totalLength / 2) relativeZ -= totalLength;

      // --- PHYSICS: PASTAS EM CASCATA (KDE Plasma Style) ---
      // relativeZ = 0: Focado no centro/frente
      // relativeZ > 0: Fundo da pilha (diagonal Esquerda/Cima)
      // relativeZ < 0: Passou do foco (caindo para Direita/Baixo)

      let translateX = 0;
      let translateY = 0;
      let translateZ = 0;
      let opacity = 1;
      let dormancyDarkness = 0;
      let isFocused = false;

      if (relativeZ >= 0) {
        // Atrás na pilha (Esquerda e Cima)
        translateZ = -relativeZ * 1.5;     // Profundidade
        translateX = -relativeZ * 0.85;    // Move para Esquerda
        translateY = -relativeZ * 0.4;     // Move para Cima
        
        // Sem rotações (perfeitamente paralelo à tela, como o print do KDE)
        
        // Elementos distantes escurecem
        opacity = Math.max(1 - (relativeZ / 2500), 0);
        const progress = Math.min(relativeZ / 500, 1);
        dormancyDarkness = progress * 0.75;

        // Is it the front-most card?
        if (relativeZ < 50) {
          isFocused = true;
          dormancyDarkness = 0;
        }

      } else {
        // Passou do foco (Cai para Direita e Baixo, sumindo na câmera)
        translateZ = Math.abs(relativeZ) * 2; 
        translateX = Math.abs(relativeZ) * 1.5;   
        translateY = Math.abs(relativeZ) * 1;    
        opacity = Math.max(1 - (Math.abs(relativeZ) / 150), 0); 
      }

      // DIRECT DOM MANIPULATION (Zero React Reflows)
      node.style.transform = `translate3d(${translateX}px, ${translateY}px, ${translateZ}px)`;
      node.style.opacity = opacity.toString();
      node.style.setProperty('--dormancy-darkness', dormancyDarkness.toString());
      node.style.zIndex = Math.round(1000 - relativeZ).toString();

      // CULLING LOGIC & Interaction
      if (isFocused) {
        node.classList.add('flip-drawer-node--focused');
      } else {
        node.classList.remove('flip-drawer-node--focused');
      }

      // GPU Optimization: Skip rendering if invisible
      if (opacity <= 0.01) {
        node.style.visibility = 'hidden';
      } else {
        node.style.visibility = 'visible';
      }
    });
  };

  useEffect(() => {
    updatePhysics(); // Initial Paint
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  // Event Hijacking
  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    offsetRef.current += e.deltaY * 0.4; // Scroll sensitivity
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(updatePhysics);
  };

  const touchStartY = useRef(0);
  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    touchStartY.current = e.touches[0].clientY;
  };
  
  const handleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    const currentY = e.touches[0].clientY;
    const delta = (touchStartY.current - currentY) * 1.5;
    touchStartY.current = currentY;
    offsetRef.current += delta;
    
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(updatePhysics);
  };

  if (exams.length === 0) return null;

  return (
    <div 
      className="flip-drawer-wrapper"
      ref={containerRef}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      style={{ touchAction: 'none' }}
    >
      <div className="flip-drawer-track" ref={trackRef}>
        {displayExams.map((exam, index) => (
          <div 
            key={`${exam.id}-${index}`} 
            className="flip-drawer-node"
            ref={el => { nodesRef.current[index] = el; }}
          >
            <div className="flip-drawer-card-wrapper">
              <ExamSingularityCard 
                exam={exam} 
                onClick={() => onExamClick?.(exam)}
                onEdit={() => onExamEdit?.(exam)}
                onDelete={() => onExamDelete?.(exam)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
