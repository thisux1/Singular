import { useEffect, useRef } from 'react';
import './FuiWaveform.css';

export function FuiWaveform() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let animationFrame: number;
    let time = 0;

    const animate = () => {
      time += 0.05;
      if (!svgRef.current) return;
      
      const paths = svgRef.current.querySelectorAll('.fui-wave-path');
      paths.forEach((path, index) => {
        const speed = 1 + index * 0.5;
        const amplitude = 15 + index * 10;
        const frequency = 0.02 + index * 0.01;
        
        let d = `M 0 50 `;
        for (let x = 0; x <= 800; x += 10) {
          // Complex waveform: combination of sine waves
          const y = 50 + 
            Math.sin(x * frequency + time * speed) * amplitude * Math.sin(time * 0.2 + index) +
            Math.sin(x * (frequency * 2) - time * speed * 1.5) * (amplitude * 0.5);
          d += `L ${x} ${y} `;
        }
        path.setAttribute('d', d);
      });

      animationFrame = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  return (
    <div className="fui-waveform-container">
      <div className="fui-waveform-visualizer">
        {/* SVG Waves */}
        <svg ref={svgRef} viewBox="0 0 800 100" preserveAspectRatio="none" className="fui-waveform-svg">
          {/* Grid lines */}
          <line x1="0" y1="20" x2="800" y2="20" className="fui-wave-grid" />
          <line x1="0" y1="80" x2="800" y2="80" className="fui-wave-grid" />
          
          {/* Animated Sine Waves */}
          <path className="fui-wave-path fui-wave-path--1" fill="none" />
          <path className="fui-wave-path fui-wave-path--2" fill="none" />
          <path className="fui-wave-path fui-wave-path--3" fill="none" />
          
          {/* Center Energy Line */}
          <line x1="0" y1="50" x2="800" y2="50" className="fui-wave-center" />
        </svg>

        {/* Circular Particle Bursts (CSS) */}
        <div className="fui-wave-burst fui-wave-burst--1">
          <div className="fui-wave-burst__particles" />
          <div className="fui-wave-burst__ring" />
          <div className="fui-wave-burst__ring fui-wave-burst__ring--inner" />
        </div>
        
        <div className="fui-wave-burst fui-wave-burst--2">
          <div className="fui-wave-burst__particles" />
          <div className="fui-wave-burst__ring" />
        </div>

        {/* Data Nodes */}
        <div className="fui-wave-node" style={{ left: '25%', top: '20%' }}>
          <div className="fui-wave-node__box" />
          <span className="fui-wave-node__label">18.6</span>
        </div>
        <div className="fui-wave-node" style={{ left: '60%', top: '75%' }}>
          <div className="fui-wave-node__box" />
          <span className="fui-wave-node__label">3U.8</span>
        </div>
        <div className="fui-wave-node" style={{ left: '80%', top: '30%' }}>
          <div className="fui-wave-node__box" />
          <span className="fui-wave-node__label">5V.3</span>
        </div>
      </div>
    </div>
  );
}
