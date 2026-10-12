import { describe, expect, it } from 'vitest';
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
} from '../../src/services/email-templates.js';
import { rewriteAuthCallbackUrl } from '../../src/services/email.js';

/**
 * Templates transacionais + rewrite do callbackURL (T1) — testes PUROS,
 * sem DB/Resend: as funções são determinísticas sobre o input.
 */
describe('email templates (T1)', () => {
  it('verification: assunto, dark+laranja, link e saudação com nome', () => {
    const { subject, html } = buildVerificationEmail({
      userName: 'Maria',
      actionUrl: 'http://localhost:3001/api/auth/verify-email?token=abc&callbackURL=http%3A%2F%2Fapp%2Fverify-email',
    });

    expect(subject).toBe('Verifique seu email — Singular');
    // link de ação presente (botão + fallback)
    expect(html).toContain('token=abc');
    expect(html).toContain('Verificar email');
    expect(html).toContain('Maria');
    // tema dark + acento laranja
    expect(html).toContain('#0b0b10');
    expect(html).toContain('#f97316');
    expect(html).toContain('Singular');
  });

  it('reset: assunto, link e aviso de expiração', () => {
    const { subject, html } = buildPasswordResetEmail({
      userName: undefined,
      actionUrl: 'http://localhost:3001/api/auth/reset-password/tok123?callbackURL=x',
    });

    expect(subject).toBe('Redefinir senha — Singular');
    expect(html).toContain('reset-password/tok123');
    expect(html).toContain('Redefinir senha');
    expect(html).toContain('expira em 1 hora');
    // sem nome → saudação genérica
    expect(html).toContain('Olá!');
  });

  it('escapa HTML no userName (anti-injeção em template)', () => {
    const { html } = buildVerificationEmail({
      userName: '<script>alert(1)</script>',
      actionUrl: 'http://x/verify?a=1&b=2',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('rewriteAuthCallbackUrl', () => {
  it('reescreve callbackURL preservando path e token', () => {
    const url = 'http://localhost:3001/api/auth/verify-email?token=JWT123&callbackURL=%2F';
    const out = rewriteAuthCallbackUrl(url, 'http://localhost:5173/verify-email');

    const parsed = new URL(out);
    expect(parsed.pathname).toBe('/api/auth/verify-email');
    expect(parsed.searchParams.get('token')).toBe('JWT123');
    expect(parsed.searchParams.get('callbackURL')).toBe('http://localhost:5173/verify-email');
  });

  it('funciona com callbackURL vazio (reset sem redirectTo do cliente)', () => {
    const url = 'http://localhost:3001/api/auth/reset-password/tok99?callbackURL=';
    const out = rewriteAuthCallbackUrl(url, 'http://localhost:5173/reset-password');

    const parsed = new URL(out);
    expect(parsed.pathname).toBe('/api/auth/reset-password/tok99');
    expect(parsed.searchParams.get('callbackURL')).toBe('http://localhost:5173/reset-password');
  });

  it('URL inválida → devolve a original (nunca quebra o envio)', () => {
    expect(rewriteAuthCallbackUrl('not-a-url', 'http://x/cb')).toBe('not-a-url');
  });
});
