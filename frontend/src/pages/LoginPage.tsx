import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { authClient, useAuth } from '../api/auth';
import { Button } from '../components/ui/Button';
import './LoginPage.css';

// Aceita apenas paths internos ("/exam/123"); rejeita URLs absolutas e
// protocol-relative ("//evil.com") para não virar open redirect.
function sanitizeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
    return '/';
  }
  return raw;
}

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, isPending, authDisabled } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const next = sanitizeNext(searchParams.get('next'));

  // Sessão real já ativa → não faz sentido exibir a login wall.
  if (!authDisabled && !isPending && isAuthenticated) {
    return <Navigate to={next} replace />;
  }

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setSignInError(null);

    const { error } = await authClient.signIn.social({
      provider: 'google',
      // Absoluto: o redirect final sai do backend (outra origem) — path
      // relativo cairia em :3001. A origem precisa estar em trustedOrigins.
      callbackURL: `${window.location.origin}${next}`,
    });

    // Sucesso → redirect plugin navega para o Google antes de resolver.
    if (error) {
      setSignInError('Falha ao iniciar login com Google. Tente novamente.');
      setIsSigningIn(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-page__flare" aria-hidden="true" />

      <div className="login-page__content">
        <span className="login-page__mark" aria-hidden="true">⌘</span>
        <h1 className="login-page__wordmark">Singular</h1>
        <p className="login-page__tagline">exames → quizzes</p>

        {authDisabled ? (
          <div className="login-page__dev">
            <span className="login-page__dev-note">dev mode — auth_disabled</span>
            <Button variant="ghost" size="lg" onClick={() => navigate(next, { replace: true })}>
              Entrar sem conta
            </Button>
          </div>
        ) : (
          <>
            <Button size="lg" onClick={handleGoogleSignIn} loading={isSigningIn}>
              <span className="login-page__google-g" aria-hidden="true">G</span>
              {isSigningIn ? 'Redirecionando…' : 'Continuar com Google'}
            </Button>
            {signInError && (
              <p className="login-page__error" role="alert">{signInError}</p>
            )}
            <span className="login-page__hint">acesso via conta google</span>
          </>
        )}
      </div>
    </main>
  );
}
