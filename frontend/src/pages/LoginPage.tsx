import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { authClient, useAuth } from '../api/auth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { sanitizeNext } from '../utils/sanitizeNext';
import './LoginPage.css';
import './AuthPages.css';

/** better-auth retorna { code, message } — traduz os casos comuns. */
function signInErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'Email ou senha inválidos.';
    case 'EMAIL_NOT_VERIFIED':
      return 'Email ainda não verificado — confira sua caixa de entrada.';
    default:
      return 'Falha ao entrar. Tente novamente.';
  }
}

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, isPending, authDisabled } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

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

  const handleEmailSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSigningIn(true);
    setSignInError(null);

    const { error } = await authClient.signIn.email({ email, password });
    setIsSigningIn(false);

    if (error) {
      setSignInError(signInErrorMessage(error.code));
      return;
    }

    navigate(next, { replace: true });
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
            <span className="login-page__dev-note badge badge--violet badge--dashed badge--pill">dev mode — auth_disabled</span>
            <Button variant="ghost" size="lg" onClick={() => navigate(next, { replace: true })}>
              Entrar sem conta
            </Button>
          </div>
        ) : (
          <>
            <Button size="lg" onClick={handleGoogleSignIn} loading={isSigningIn} disabled={isSigningIn}>
              <span className="login-page__google-g" aria-hidden="true">G</span>
              Continuar com Google
            </Button>

            <span className="auth-divider" aria-hidden="true">ou</span>

            <form className="auth-form" onSubmit={handleEmailSignIn} noValidate>
              <Input
                label="Email"
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="voce@exemplo.com"
              />
              <Input
                label="Senha"
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
              <Button type="submit" size="lg" loading={isSigningIn} disabled={isSigningIn}>
                Entrar
              </Button>
            </form>

            {signInError && (
              <p className="login-page__error" role="alert">{signInError}</p>
            )}

            <div className="auth-links">
              <Link className="auth-link text-btn" to="/forgot-password">
                Esqueci a senha
              </Link>
              <Link className="auth-link auth-link--muted text-btn" to="/signup">
                Criar conta
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
