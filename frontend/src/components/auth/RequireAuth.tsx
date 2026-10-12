import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../api/auth';
import { Skeleton } from '../ui/Skeleton';
import './RequireAuth.css';

function SessionRestoring() {
  return (
    <div className="auth-guard" role="status" aria-live="polite">
      <span className="auth-guard__mark" aria-hidden="true">⌘</span>
      <Skeleton width="140px" height="10px" borderRadius="var(--radius-full)" />
      <span className="auth-guard__label">restaurando sessão</span>
    </div>
  );
}

/**
 * Route guard (layout route) — envolve as rotas autenticadas.
 *
 * - `VITE_AUTH_DISABLED=true` (dev): passa direto, sem consultar sessão.
 * - `isPending`: skeleton no padrão visual enquanto /get-session resolve.
 * - Sem sessão com auth ativa: redireciona para /login?next=<rota atual>.
 */
export function RequireAuth() {
  const { isPending, isAuthenticated, authDisabled } = useAuth();
  const location = useLocation();

  if (authDisabled) {
    return <Outlet />;
  }

  if (isPending) {
    return <SessionRestoring />;
  }

  if (!isAuthenticated) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <Outlet />;
}
