import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { authClient, useAuth } from '../../api/auth';
import { fetchStatsSummary } from '../../api/stats';
import { Skeleton } from '../ui/Skeleton';
import './Navbar.css';

// Chip discreto de progressão (LV + streak). Some silenciosamente se a
// API de stats falhar — gamificação nunca pode quebrar a navegação.
function StatsChip() {
  const summaryQuery = useQuery({
    queryKey: ['stats-summary'],
    queryFn: fetchStatsSummary,
    staleTime: 60_000,
    retry: false,
  });

  const summary = summaryQuery.data;
  if (!summary) {
    return null;
  }

  return (
    <span
      className="navbar__stats-chip badge badge--pill"
      title={`${summary.xp} XP · ${summary.totalSessions} sessões · ${Math.round(summary.accuracyPct)}% de precisão`}
    >
      <span className="navbar__stats-level">LV {summary.level}</span>
      {summary.streakDays > 0 ? (
        <span className="navbar__stats-streak">STREAK {summary.streakDays}D</span>
      ) : null}
    </span>
  );
}

function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name ?? email ?? '').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function Navbar() {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isPending, isAuthenticated, authDisabled } = useAuth();
  const [menuPath, setMenuPath] = useState(location.pathname);

  // Fecha o menu do usuário ao trocar de rota (ajuste durante o render —
  // evita setState síncrono em effect).
  if (menuPath !== location.pathname) {
    setMenuPath(location.pathname);
    setMenuOpen(false);
  }

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

  // Fecha o menu do usuário em clique fora / Escape / troca de rota.
  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const handleSignOut = async () => {
    setMenuOpen(false);
    try {
      await authClient.signOut();
    } finally {
      navigate('/login', { replace: true });
    }
  };

  const shortName = user?.name?.trim().split(/\s+/)[0] ?? user?.email ?? '';

  return (
    <header className={`navbar glass glass--bar ${isScrolled ? 'navbar--scrolled' : ''}`}>
      {/* Scroll Progress Indicator - Premium Accretion Disk Aesthetic */}
      <div
        className="navbar__scroll-indicator"
        style={{ width: `${scrollProgress}%` }}
      />

      <div className="navbar__inner page-container">
        <Link className="navbar__brand heading-3" to="/app">
          <span className="navbar__brand-icon">⌘</span>
          Singular
        </Link>

        <nav className="navbar__nav" aria-label="Navegação principal">
          <StatsChip />
          <NavLink
            className={({ isActive }) => `navbar__link ${isActive ? 'navbar__link--active' : ''}`}
            to="/app"
            end
          >
            Terminal
          </NavLink>
          <NavLink
            className={({ isActive }) => `navbar__link ${isActive ? 'navbar__link--active' : ''}`}
            to="/app/banco"
          >
            Banco
          </NavLink>

          {authDisabled ? (
            <span className="navbar__dev-badge badge badge--pill badge--dashed" title="AUTH_DISABLED — sessão local">
              local
            </span>
          ) : isPending ? (
            <Skeleton width="30px" height="30px" borderRadius="var(--radius-full)" />
          ) : isAuthenticated && user ? (
            <div className="navbar__user" ref={menuRef}>
              <button
                type="button"
                className="navbar__user-trigger"
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Conta de ${user.name ?? user.email}`}
              >
                {user.image ? (
                  <img
                    className="navbar__avatar"
                    src={user.image}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="navbar__avatar navbar__avatar--initials" aria-hidden="true">
                    {initialsOf(user.name, user.email)}
                  </span>
                )}
                <span className="navbar__user-name">{shortName}</span>
              </button>

              {menuOpen && (
                <div className="navbar__menu glass glass--menu" role="menu">
                  <span className="navbar__menu-user" aria-hidden="true">
                    {user.email}
                  </span>
                  <button
                    type="button"
                    className="navbar__menu-item"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      navigate('/app/conta');
                    }}
                  >
                    Conta
                  </button>
                  <button
                    type="button"
                    className="navbar__menu-item navbar__menu-item--danger"
                    role="menuitem"
                    onClick={handleSignOut}
                  >
                    Sair
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
