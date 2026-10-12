import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { authClient } from '../api/auth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import './LoginPage.css';
import './AuthPages.css';

export function ForgotPasswordPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [email, setEmail] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFormError(null);

    // redirectTo é a URL do FRONTEND para onde o fluxo retorna — o email
    // aponta para a API, que valida o token e redireciona com ?token=.
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setIsSubmitting(false);

    if (error) {
      // Só falha real de rede/servidor chega aqui — email inexistente
      // retorna 200 no better-auth (anti-enumeração no servidor).
      setFormError('Não foi possível enviar o link agora. Tente novamente.');
      return;
    }

    setSent(true);
  };

  return (
    <main className="login-page">
      <div className="login-page__flare" aria-hidden="true" />

      <div className="login-page__content">
        <span className="login-page__mark" aria-hidden="true">⌘</span>
        <h1 className="login-page__wordmark">Singular</h1>
        <p className="login-page__tagline">recuperar acesso</p>

        {sent ? (
          <div className="auth-status empty" role="status">
            <span className="auth-status__icon" aria-hidden="true">✉</span>
            <h2 className="auth-status__title">Link enviado</h2>
            <p className="auth-status__text">
              Se existir uma conta para <strong>{email}</strong>, você receberá
              um link para redefinir a senha em alguns instantes.
            </p>
            <Link className="auth-link text-btn" to="/login">
              Voltar ao login
            </Link>
          </div>
        ) : (
          <>
            <form className="auth-form" onSubmit={handleSubmit} noValidate>
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
              <Button type="submit" size="lg" loading={isSubmitting} disabled={isSubmitting}>
                Enviar link de redefinição
              </Button>
            </form>

            {formError && (
              <p className="login-page__error" role="alert">{formError}</p>
            )}

            <div className="auth-links">
              <Link className="auth-link auth-link--muted text-btn" to="/login">
                Voltar ao login
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
