import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { authClient } from '../api/auth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import './LoginPage.css';
import './AuthPages.css';

const MIN_PASSWORD_LENGTH = 8;
const REDIRECT_DELAY_MS = 2500;

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [done, setDone] = useState(false);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  // A API valida o link do email e redireciona para cá com ?token= (válido)
  // ou ?error=INVALID_TOKEN (expirado/usado).
  const token = searchParams.get('token');
  const linkError = searchParams.get('error');
  const tokenInvalid = !token || Boolean(linkError);

  useEffect(() => {
    if (!done) {
      return;
    }
    const timer = window.setTimeout(() => navigate('/login', { replace: true }), REDIRECT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [done, navigate]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const errors: { password?: string; confirm?: string } = {};
    if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Mínimo de ${MIN_PASSWORD_LENGTH} caracteres.`;
    }
    if (confirm !== password) {
      errors.confirm = 'As senhas não coincidem.';
    }
    setFieldErrors(errors);
    if (errors.password || errors.confirm || !token) {
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setIsSubmitting(false);

    if (error) {
      setFormError(
        error.code === 'INVALID_TOKEN' || error.code === 'TOKEN_EXPIRED'
          ? 'Este link expirou ou já foi usado. Peça um novo.'
          : 'Falha ao redefinir a senha. Tente novamente.',
      );
      return;
    }

    setDone(true);
  };

  return (
    <main className="login-page">
      <div className="login-page__flare" aria-hidden="true" />

      <div className="login-page__content">
        <span className="login-page__mark" aria-hidden="true">⌘</span>
        <h1 className="login-page__wordmark">Singular</h1>
        <p className="login-page__tagline">nova senha</p>

        {tokenInvalid ? (
          <div className="auth-status auth-status--error" role="alert">
            <span className="auth-status__icon" aria-hidden="true">✕</span>
            <h2 className="auth-status__title">Link inválido</h2>
            <p className="auth-status__text">
              Este link de redefinição expirou ou já foi usado.
            </p>
            <Link className="auth-link" to="/forgot-password">
              Pedir novo link
            </Link>
          </div>
        ) : done ? (
          <div className="auth-status" role="status">
            <span className="auth-status__icon" aria-hidden="true">✓</span>
            <h2 className="auth-status__title">Senha redefinida</h2>
            <p className="auth-status__text">
              Sua senha foi atualizada. Redirecionando para o login…
            </p>
            <Link className="auth-link" to="/login">
              Ir para o login
            </Link>
          </div>
        ) : (
          <>
            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              <Input
                label="Nova senha"
                type="password"
                name="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Mínimo de 8 caracteres"
                error={fieldErrors.password}
              />
              <Input
                label="Confirmar senha"
                type="password"
                name="confirm"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Repita a senha"
                error={fieldErrors.confirm}
              />
              <Button type="submit" size="lg" loading={isSubmitting} disabled={isSubmitting}>
                Redefinir senha
              </Button>
            </form>

            {formError && (
              <p className="login-page__error" role="alert">{formError}</p>
            )}

            <div className="auth-links">
              <Link className="auth-link auth-link--muted" to="/login">
                Voltar ao login
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
