import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface PageTransitionProps {
  children: ReactNode;
  locationKey: string;
}

export function PageTransition({ children, locationKey }: PageTransitionProps) {
  return (
    <motion.div
      key={locationKey}
      initial={{ 
        opacity: 0, 
        scaleY: 0.01, 
        filter: 'brightness(2) contrast(1.5) hue-rotate(90deg) blur(4px)' 
      }}
      animate={{ 
        opacity: 1, 
        scaleY: 1, 
        filter: 'brightness(1) contrast(1) hue-rotate(0deg) blur(0px)' 
      }}
      exit={{ 
        opacity: 0, 
        scaleY: 0.01, 
        filter: 'brightness(3) contrast(2) hue-rotate(-90deg) blur(8px)' 
      }}
      transition={{ 
        duration: 0.4, 
        ease: [0.22, 1, 0.36, 1] // Custom CRT ease
      }}
      style={{
        width: '100%',
        transformOrigin: 'center center'
      }}
    >
      {children}
    </motion.div>
  );
}
