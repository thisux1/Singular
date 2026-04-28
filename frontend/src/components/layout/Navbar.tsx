import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import './Navbar.css';

export function Navbar() {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      const totalScroll = document.documentElement.scrollTop;
      const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      
      setScrollProgress(windowHeight > 0 ? (totalScroll / windowHeight) * 100 : 0);
      setIsScrolled(totalScroll > 20);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    // Run once to initialize
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, [location.pathname]); // Re-calculate on route change

  return (
    <header className={`navbar ${isScrolled ? 'navbar--scrolled' : ''}`}>
      {/* Scroll Progress Indicator - Premium Accretion Disk Aesthetic */}
      <div 
        className="navbar__scroll-indicator" 
        style={{ width: `${scrollProgress}%` }}
      />
      
      <div className="navbar__inner page-container">
        <Link className="navbar__brand heading-3" to="/">
          <span className="navbar__brand-icon">⌘</span>
          QuizSaber
        </Link>

        <nav className="navbar__nav" aria-label="Navegação principal">
          <NavLink
            className={({ isActive }) => `navbar__link ${isActive ? 'navbar__link--active' : ''}`}
            to="/"
          >
            Terminal
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
