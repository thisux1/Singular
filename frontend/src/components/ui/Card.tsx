import type { HTMLAttributes, ReactNode } from 'react';
import './Card.css';

type CardVariant = 'default' | 'interactive' | 'highlight';

interface CardProps extends HTMLAttributes<HTMLElement> {
  variant?: CardVariant;
  as?: 'div' | 'article' | 'section';
  children: ReactNode;
}

export function Card({
  variant = 'default',
  as: Component = 'div',
  children,
  className = '',
  ...props
}: CardProps) {
  return (
    <Component
      className={`card card--${variant} ${className}`}
      {...props}
    >
      {children}
    </Component>
  );
}
