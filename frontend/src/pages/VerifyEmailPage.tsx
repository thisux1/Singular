import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { authClient, useAuth } from '../api/auth';
import { Skeleton } from '../components/ui/Skeleton';
import './LoginPage.css';
import './AuthPages.css';

type VerifyState = 'verifying' | 'success' | 'error' | 'invalid-link';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const { isAuthenticated, authDisabled } = useAuth();
  const token = searchParams.get('token');
  const [state, setState] = useState<VerifyState>(() => (token ? 'verifying' : 'invalid-link'));
  // StrictMode dispara o effect duas vezes — a 2ª chamada pegaria
  // INVALID_TOKEN e sobrescreveria o sucesso da 1ª.
  const requestedRef = useRef(false);

  useEffect(() => {
    if (requestedRef.current || !token) {
      return;
    }
    requestedRef.current = true;

    void authClient
      .verifyEmail({ query: { token } })
      .then(({ error }) => setState(error ? 'error' : 'success'))
      .catch(() => setState('error'));
  }, [token]);

  return (
    <main className="login-page">
      <div className="login-page__flare" aria-hidden="true" />

      <div className="login-page__content">
        <span className="login-page__mark" aria-hidden="true">⌘</span>
        <h1 className="login-page__wordmark">Singular</h1>
        <p className="login-page__tagline">verificação de email</p>

        {state === 'verifying' ? (
          <div className="auth-status empty" role="status" aria-live="polite">
            <Skeleton width="48px" height="48px" borderRadius="var(--radius-full)" />
            <Skeleton width="220px" height="14px" />
            <span className="auth-link auth-link--muted text-btn">verificando link…</span>
          </div>
        ) : state === 'success' ? (
          <div className="auth-status empty" role="status">
            <span className="auth-status__icon" aria-hidden="true">✓</span>
            <h2 className="auth-status__title">Email verificado</h2>
            <p className="auth-status__text">
              Sua conta está ativa. Bem-vindo à Singular.
            </p>
            <Link className="auth-link text-btn" to={isAuthenticated || authDisabled ? '/app' : '/login'}>
              {isAuthenticated || authDisabled ? 'Abrir o app' : 'Ir para o login'}
            </Link>
          </div>
        ) : (
          <div className="auth-status auth-status--error empty" role="alert">
            <span className="auth-status__icon" aria-hidden="true">✕</span>
            <h2 className="auth-status__title">
              {state === 'invalid-link' ? 'Link incompleto' : 'Verificação falhou'}
            </h2>
            <p className="auth-status__text">
              {state === 'invalid-link'
                ? 'Este link de verificação não tem token. Abra o link mais recente do seu email.'
                : 'Este link expirou ou já foi usado. Faça login para reenviar a verificação.'}
            </p>
            <Link className="auth-link text-btn" to="/login">
              Ir para o login
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
