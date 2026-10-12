import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { authClient, useAuth } from '../api/auth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { sanitizeNext } from '../utils/sanitizeNext';
import './LoginPage.css';
import './AuthPages.css';

const MIN_PASSWORD_LENGTH = 8;

/** better-auth retorna { code, message } — traduz os casos comuns. */
function signUpErrorMessage(code: string | undefined, fallback?: string): string {
  switch (code) {
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'Já existe uma conta com este email.';
    case 'INVALID_EMAIL':
      return 'Email inválido.';
    case 'PASSWORD_TOO_SHORT':
      return `A senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
    default:
      return fallback ?? 'Falha ao criar a conta. Tente novamente.';
  }
}

export function SignupPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, isPending, authDisabled } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [checkEmail, setCheckEmail] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const next = sanitizeNext(searchParams.get('next'));

  // Já autenticado → direto para o destino.
  if (!authDisabled && !isPending && isAuthenticated) {
    return <Navigate to={next} replace />;
  }

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
    if (errors.password || errors.confirm) {
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    const { data, error } = await authClient.signUp.email({ name, email, password });
    setIsSubmitting(false);

    if (error) {
      setFormError(signUpErrorMessage(error.code, error.message));
      return;
    }

    // Sem token de sessão na resposta → o backend exige verificação de
    // email antes do primeiro acesso. Caso contrário a sessão já está
    // ativa e o guard acima redireciona no próximo render.
    if (!data?.token) {
      setCheckEmail(email);
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
        <p className="login-page__tagline">criar conta</p>

        {checkEmail ? (
          <div className="auth-status" role="status">
            <span className="auth-status__icon" aria-hidden="true">✉</span>
            <h2 className="auth-status__title">Verifique seu email</h2>
            <p className="auth-status__text">
              Enviamos um link de confirmação para <strong>{checkEmail}</strong>.
              Abra o link para ativar sua conta e depois faça login.
            </p>
            <Link className="auth-link" to="/login">
              Ir para o login
            </Link>
          </div>
        ) : (
          <>
            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              <Input
                label="Nome"
                type="text"
                name="name"
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Seu nome"
              />
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
                Criar conta
              </Button>
            </form>

            {formError && (
              <p className="login-page__error" role="alert">{formError}</p>
            )}

            <div className="auth-links">
              <Link className="auth-link auth-link--muted" to="/login">
                Já tenho conta — entrar
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
