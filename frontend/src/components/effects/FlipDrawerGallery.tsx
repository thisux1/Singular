import React, { useEffect, useRef, useState, WheelEvent, TouchEvent } from 'react';
import type { Exam } from '../../api/exams';
import { ExamSingularityCard } from './ExamSingularityCard';
import './FlipDrawerGallery.css';

interface FlipDrawerGalleryProps {
  exams: Exam[];
  onExamClick?: (exam: Exam) => void;
  onExamEdit?: (exam: Exam) => void;
  onExamDelete?: (exam: Exam) => void;
}

const ITEM_SPACING = 250; // Distance between cards in the logical track

export function FlipDrawerGallery({ exams, onExamClick, onExamEdit, onExamDelete }: FlipDrawerGalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<(HTMLDivElement | null)[]>([]);
  
  // BYPASS REACT RENDER: We store scroll offset in a mutable ref
  const offsetRef = useRef(0);
  const touchStartY = useRef(0);
  const animationFrameRef = useRef<number>();
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();
  // Controle de auto-scroll
  const scrollToTargetRef = useRef<number | null>(null);
  const lastWheelTimeRef = useRef<number>(0);
  // Ref para navegação e hover
  const selectedExamIdRef = useRef<string | null>(null);
  const hoverPhysicsRef = useRef<number[]>([]);

  let displayExams = [...exams];
  
  // Initialize hover physics array
  if (hoverPhysicsRef.current.length !== displayExams.length) {
    hoverPhysicsRef.current = new Array(displayExams.length).fill(0);
  }

  const ITEM_SPACING = 250;
  // O tamanho exato do universo
  const maxOffset = Math.max(0, (displayExams.length - 1) * ITEM_SPACING);

  // HARDWARE ACCELERATED PHYSICS ENGINE
  const updatePhysics = () => {
    if (!trackRef.current) return;
    
    // Magnetic Scroll Snap (Friction physics)
    if (!isScrollingRef.current) {
      let targetSnapPoint = Math.round(offsetRef.current / ITEM_SPACING) * ITEM_SPACING;
      
      // Override magnético para o Scroll Step
      if (scrollToTargetRef.current !== null) {
        targetSnapPoint = scrollToTargetRef.current;
      }

      // Clamp o target pra não ultrapassar os limites
      if (targetSnapPoint < 0) targetSnapPoint = 0;
      if (targetSnapPoint > maxOffset) targetSnapPoint = maxOffset;

      let diff = targetSnapPoint - offsetRef.current;

      // Checa se o alvo de navegação autônoma foi alcançado
      if (scrollToTargetRef.current !== null && Math.abs(diff) < 1) {
        scrollToTargetRef.current = null;
        targetSnapPoint = Math.round(offsetRef.current / ITEM_SPACING) * ITEM_SPACING;
        if (targetSnapPoint < 0) targetSnapPoint = 0;
        if (targetSnapPoint > maxOffset) targetSnapPoint = maxOffset;
        diff = targetSnapPoint - offsetRef.current;
      }
      
      // Aplica a força elástica
      if (Math.abs(diff) > 0.5) {
        offsetRef.current += diff * 0.12; // Mola super suave (12%)
      } else {
        offsetRef.current += diff; // Crava na posição exata
      }
    }

    // Clamp absolute bounds even during scroll
    if (offsetRef.current < 0) offsetRef.current = 0;
    if (offsetRef.current > maxOffset) offsetRef.current = maxOffset;

    let o = offsetRef.current;

    nodesRef.current.forEach((node, index) => {
      if (!node) return;

      const elementAbsoluteZ = index * ITEM_SPACING;
      let dist = elementAbsoluteZ - o;

      // --- PHYSICS: GAVETA HORIZONTAL (Cover Flow Restrito) ---
      // absDist = 0: Focado (Desenclinado)
      // absDist > 0: Fundo da Gaveta (Todas com a MESMA inclinação, encostadas como pastas)

      const absDist = Math.abs(dist);

      // Interpolation factor: 0 to 1 based on how close it is to center.
      // Outside 1 ITEM_SPACING (dist > 250), they are fully tilted and packed.
      const transitionFactor = Math.min(absDist / ITEM_SPACING, 1);

      const pushOutBase = transitionFactor * 140; 
      const tightStackSpacing = absDist * 0.35; 
      
      // Física de Hover (Mola Suave 60FPS)
      const isHovered = selectedExamIdRef.current === displayExams[index].id;
      const isFocused = absDist < 50;
      const targetHover = (isHovered || isFocused) ? 1 : 0;
      hoverPhysicsRef.current[index] += (targetHover - hoverPhysicsRef.current[index]) * 0.15; // Velocidade da mola
      const hoverFactor = hoverPhysicsRef.current[index];

      const isMobile = window.innerWidth <= 768;
      
      let translateX, translateY, rotateY, rotateX;

      if (isMobile) {
        // --- GAVETA VERTICAL (Mobile) ---
        translateY = Math.sign(dist) * (pushOutBase + tightStackSpacing);
        translateX = 20 * hoverFactor; // Puxa levemente pro lado no hover
        rotateX = (Math.sign(dist) * transitionFactor * 25) * (1 - (hoverFactor * 0.5));
        rotateY = 0;
        
        // Adiciona flag na DOM pra Aba de Pasta
        if (dist < -50) node.setAttribute('data-drawer-side', 'top');
        else if (dist > 50) node.setAttribute('data-drawer-side', 'bottom');
        else node.setAttribute('data-drawer-side', 'center');

      } else {
        // --- GAVETA HORIZONTAL (Desktop) ---
        translateX = Math.sign(dist) * (pushOutBase + tightStackSpacing);
        translateY = -60 * hoverFactor; // Sobe quando hoverado
        rotateY = (Math.sign(dist) * transitionFactor * -25) * (1 - (hoverFactor * 0.5));
        rotateX = 0;
        
        // Adiciona flag na DOM pra Aba de Pasta
        if (dist < -50) node.setAttribute('data-drawer-side', 'left');
        else if (dist > 50) node.setAttribute('data-drawer-side', 'right');
        else node.setAttribute('data-drawer-side', 'center');
      }

      let translateZ = -transitionFactor * 150 + (40 * hoverFactor); 
      
      let opacity = 1;
      let dormancyDarkness = transitionFactor * 0.5 * (1 - hoverFactor); // Clareia ao passar o mouse

      if (isFocused) {
        dormancyDarkness = 0;
      }

      // Hard Culling: Max ~4 items on each side to avoid visual pollution
      if (absDist > 1000) {
        opacity = 0;
      } else {
        opacity = Math.max(1 - (absDist / 1000), 0);
      }
      
      // Override: Se o mouse estiver em cima, a opacidade sobrepõe o fading da distância
      opacity = Math.max(opacity, hoverFactor);

      // DIRECT DOM MANIPULATION (Zero React Reflows)
      node.style.transform = `translate3d(${translateX}px, ${translateY}px, ${translateZ}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
      node.style.opacity = opacity.toString();
      node.style.setProperty('--dormancy-darkness', dormancyDarkness.toString());
      
      // Elevação brutal do zIndex para que a pasta puxada se sobreponha a TODAS as outras
      const baseZ = Math.round(1000 - absDist);
      node.style.zIndex = (baseZ + Math.round(hoverFactor * 2000)).toString();

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

    // Schedule next frame
    animationFrameRef.current = requestAnimationFrame(updatePhysics);
  };

  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(updatePhysics);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  // Event Hijacking (Nativo para garantir bloqueio do body scroll)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onNativeWheel = (e: globalThis.WheelEvent) => {
      // Pega o elemento exato onde o mouse está em cima
      const target = e.target as HTMLElement;
      const isOverTrack = target.closest('.flip-drawer-track');

      // Se não estiver em cima da trilha, OU se só houver 1 carta, deixa a página rolar normalmente
      if (!isOverTrack || exams.length <= 1) return;

      const direction = Math.sign(e.deltaY);
      const maxOffsetLimit = Math.max(0, (exams.length - 1) * ITEM_SPACING);

      // Permite o scroll da página se já estiver no limite e tentar rolar para fora
      if (direction < 0 && offsetRef.current <= 0) return;
      if (direction > 0 && offsetRef.current >= maxOffsetLimit) return;

      e.preventDefault(); // Bloqueia o scroll da página apenas se estiver focado na área da galeria
      
      const now = Date.now();
      // Cooldown de 250ms: Impede mouses soltos de "teleportarem"
      if (now - lastWheelTimeRef.current < 250) return;
      lastWheelTimeRef.current = now;

      // Desliga a flag manual para a Física de Mola assumir o controle
      isScrollingRef.current = false;

      const currentSnap = Math.round(offsetRef.current / ITEM_SPACING) * ITEM_SPACING;
      
      // Manda a física rolar exatamente 1 carta de distância
      scrollToTargetRef.current = currentSnap + (direction * ITEM_SPACING);
    };

    container.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', onNativeWheel);
    };
  }, [ITEM_SPACING, exams.length]);

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (exams.length <= 1) return;
    touchStartY.current = e.touches[0].clientY;
    isScrollingRef.current = true;
    scrollToTargetRef.current = null; // Interrompe scroll autônomo
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
  };
  
  const handleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (exams.length <= 1) return;
    const currentY = e.touches[0].clientY;
    const delta = (touchStartY.current - currentY) * 2.0; // Voltou pro multiplicador seguro
    touchStartY.current = currentY;
    offsetRef.current += delta;
  };

  const handleTouchEnd = () => {
    isScrollingRef.current = false;
  };

  if (exams.length === 0) return null;

  return (
    <div className="flip-drawer-universe">
      
      {/* ─── FLAT HUD OVERLAY (Outside 3D Perspective) ─── */}
      <div className="flip-drawer-fui-overlay">
        
        {/* Top & Bottom Brackets */}
        <div className="fui-top-bracket" />
        <div className="fui-bottom-bracket">
          <div className="fui-data-stream">
             <span>MEM_CORE_ACTIVE</span>
             <span className="blink">|</span>
             <span>VER_9.0.4</span>
          </div>
        </div>

        {/* Left Wing FUI */}
        <div className="fui-wing fui-wing-left">
          <div className="fui-wing-glass" />
          <div className="fui-wing-glow" />
          <div className="fui-wing-deco">
             <div className="fui-text">SYS.NAV</div>
             <div className="fui-text highlight">NOMINAL</div>
             <div className="fui-bar"></div>
             <div className="fui-dots">
               <span/><span/><span/><span/>
             </div>
          </div>
        </div>

        {/* Right Wing FUI */}
        <div className="fui-wing fui-wing-right">
          <div className="fui-wing-glass" />
          <div className="fui-wing-glow" />
          <div className="fui-wing-deco">
             <div className="fui-text">FLUX</div>
             <div className="fui-text highlight">CAPACITY</div>
             <div className="fui-bar reverse"></div>
             <div className="fui-radar">
                <div className="fui-radar-sweep"></div>
             </div>
          </div>
        </div>

        {/* Center Targeting Box (2D Overlay) */}
        <div className="fui-target-box">
          <div className="fui-corner top-left" />
          <div className="fui-corner top-right" />
          <div className="fui-corner bottom-left" />
          <div className="fui-corner bottom-right" />
          <div className="fui-crosshair-h" />
          <div className="fui-crosshair-v" />
          <div className="fui-data-label">TGT_LOCK // OK</div>
          <div className="fui-scanline" />
        </div>

      </div>

      {/* ─── 3D PERSPECTIVE DRAWER ─── */}
      <div 
        className="flip-drawer-wrapper"
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ touchAction: 'none' }}
      >
        <div className="flip-drawer-track" ref={trackRef}>
          {displayExams.map((exam, index) => (
            <div 
              key={`${exam.id}-${index}`} 
              className="flip-drawer-node"
              ref={el => { nodesRef.current[index] = el; }}
              onMouseEnter={() => {
                selectedExamIdRef.current = exam.id;
              }}
              onMouseLeave={() => {
                selectedExamIdRef.current = null;
              }}
            >
              <div className="flip-drawer-card-wrapper">
                <ExamSingularityCard 
                  exam={exam} 
                  onClick={() => {
                    const targetOffset = index * ITEM_SPACING;
                    const currentSnap = Math.round(offsetRef.current / ITEM_SPACING) * ITEM_SPACING;
                    // Distância linear simples, já que a galeria não é mais infinita/circular
                    let dist = targetOffset - currentSnap;

                    if (Math.abs(dist) < 10) {
                      // Está cravada no centro! Pode abrir o exame.
                      onExamClick?.(exam);
                    } else {
                      // É uma carta na margem. Rola a gaveta até ela.
                      scrollToTargetRef.current = currentSnap + dist;
                      isScrollingRef.current = false; // Garante que a mola assuma o controle
                    }
                  }}
                  onEdit={(e) => onExamEdit?.(exam, e)}
                  onDelete={(e) => onExamDelete?.(exam, e)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
