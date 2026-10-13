import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { usePrefersReducedMotion } from '../../hooks/useMediaQuery';
import { usePerfLite } from '../../hooks/usePerfLite';

interface PageTransitionProps {
  children: ReactNode;
  locationKey: string;
}

export function PageTransition({ children, locationKey }: PageTransitionProps) {
  const reducedMotion = usePrefersReducedMotion();
  const perfLite = usePerfLite();

  /* Três níveis: reduced = fade puro; lite = colapso CRT sem filter
     (scaleY+opacity são compostáveis); full = colapso + aberration. */
  const mode = reducedMotion ? 'reduced' : perfLite ? 'lite' : 'full';
  const crtFilter = {
    initial: 'brightness(2) contrast(1.5) hue-rotate(90deg) blur(4px)',
    animate: 'brightness(1) contrast(1) hue-rotate(0deg) blur(0px)',
    exit: 'brightness(3) contrast(2) hue-rotate(-90deg) blur(8px)',
  };

  return (
    <motion.div
      key={locationKey}
      initial={
        mode === 'reduced'
          ? { opacity: 0 }
          : {
              opacity: 0,
              scaleY: 0.01,
              ...(mode === 'full' && { filter: crtFilter.initial }),
            }
      }
      animate={
        mode === 'reduced'
          ? { opacity: 1 }
          : {
              opacity: 1,
              scaleY: 1,
              ...(mode === 'full' && { filter: crtFilter.animate }),
            }
      }
      exit={
        mode === 'reduced'
          ? { opacity: 0 }
          : {
              opacity: 0,
              scaleY: 0.01,
              ...(mode === 'full' && { filter: crtFilter.exit }),
            }
      }
      transition={{
        duration: mode === 'reduced' ? 0.15 : 0.4,
        ease: [0.22, 1, 0.36, 1], // Custom CRT ease
      }}
      style={{
        width: '100%',
        transformOrigin: 'center center',
      }}
    >
      {children}
    </motion.div>
  );
}
