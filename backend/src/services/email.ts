import { Resend } from 'resend';
import { config } from '../config.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
} from './email-templates.js';

/**
 * Envio de emails transacionais via Resend (WS-A T1).
 *
 * Sem RESEND_API_KEY: loga warn UMA vez no primeiro envio e vira "log-only" —
 * o link de ação vai para o console (dev/self-host friendly). Nunca lança:
 * falha de email não pode derrubar sign-up/reset/verify no better-auth.
 */

let resendClient: Resend | null = null;
let warnedMissingKey = false;

/** true quando há entrega real de email configurada. */
export function isEmailDeliveryEnabled(): boolean {
  return Boolean(config.resendApiKey);
}

/**
 * Reescreve o `callbackURL` da URL gerada pelo better-auth para apontar para
 * uma rota do FRONTEND (SPA). O link do email continua batendo no endpoint do
 * backend (/verify-email, /reset-password/:token) — que valida o token e faz
 * 302 para o frontend. `callbackURL` precisa estar em trustedOrigins.
 */
export function rewriteAuthCallbackUrl(rawUrl: string, callbackUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.set('callbackURL', callbackUrl);
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

async function deliver(input: {
  to: string;
  subject: string;
  html: string;
  actionUrl: string;
}): Promise<void> {
  if (!config.resendApiKey) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      logWarn('email.resend_disabled', {
        reason: 'RESEND_API_KEY ausente — emails transacionais viram log (modo dev/self-host)',
      });
    }
    logInfo('email.log_only', {
      to: input.to,
      subject: input.subject,
      actionUrl: input.actionUrl,
    });
    return;
  }

  resendClient ??= new Resend(config.resendApiKey);

  try {
    const { error } = await resendClient.emails.send({
      from: config.emailFrom,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });

    if (error) {
      logError('email.send_failed', {
        to: input.to,
        subject: input.subject,
        error: error.message,
      });
      return;
    }

    logInfo('email.sent', { to: input.to, subject: input.subject });
  } catch (error) {
    // Nunca propagar — fluxo de auth não pode quebrar por indisponibilidade
    // do provedor de email.
    logError('email.send_failed', {
      to: input.to,
      subject: input.subject,
      error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });
  }
}

/** Hook `emailVerification.sendVerificationEmail` do better-auth. */
export async function sendVerificationEmail(input: {
  to: string;
  userName?: string | null;
  actionUrl: string;
}): Promise<void> {
  const template = buildVerificationEmail({
    userName: input.userName,
    actionUrl: input.actionUrl,
  });
  await deliver({ to: input.to, actionUrl: input.actionUrl, ...template });
}

/** Hook `emailAndPassword.sendResetPassword` do better-auth. */
export async function sendPasswordResetEmail(input: {
  to: string;
  userName?: string | null;
  actionUrl: string;
}): Promise<void> {
  const template = buildPasswordResetEmail({
    userName: input.userName,
    actionUrl: input.actionUrl,
  });
  await deliver({ to: input.to, actionUrl: input.actionUrl, ...template });
}
