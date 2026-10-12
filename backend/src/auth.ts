import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { config } from './config.js';
import { db } from './db/client.js';
import * as schema from './db/schema.js';
import {
  isEmailDeliveryEnabled,
  rewriteAuthCallbackUrl,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from './services/email.js';
import { logInfo, logWarn } from './utils/logger.js';

// Google OAuth só é registrado quando as duas credenciais existem — self-host
// sem OAuth configurado roda em modo single-user (AUTH_DISABLED, D6) e o
// provider não pode quebrar o boot por falta de env.
const googleConfigured = Boolean(config.googleClientId && config.googleClientSecret);

if (!googleConfigured) {
  logInfo('auth.google_provider_disabled', {
    reason: 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ausentes',
  });
}

// Sem Resend configurado, emails de verificação viram log no console (o hook
// continua registrado — dev-friendly), mas não faz sentido BLOQUEAR login por
// verificação que o usuário nunca receberia por email. Então
// requireEmailVerification só honra a env quando há entrega real.
const emailDeliveryEnabled = isEmailDeliveryEnabled();
const requireEmailVerification =
  emailDeliveryEnabled && config.authRequireEmailVerification;

if (!emailDeliveryEnabled && config.authRequireEmailVerification) {
  logWarn('auth.email_verification_forced_off', {
    reason: 'AUTH_REQUIRE_EMAIL_VERIFICATION=true ignorado — RESEND_API_KEY ausente',
  });
}

export const auth = betterAuth({
  appName: 'Singular',
  baseURL: config.betterAuthUrl,
  // undefined → better-auth gera secret efêmero com warning (apenas dev).
  secret: config.betterAuthSecret,
  trustedOrigins: config.trustedOrigins,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification,
    // Reset de senha revoga todas as sessões (padrão seguro p/ conta
    // potencialmente comprometida).
    revokeSessionsOnPasswordReset: true,
    // O `url` recebido aponta para GET /api/auth/reset-password/:token —
    // reescrevemos o callbackURL para a rota do SPA: o backend valida o token
    // e 302 para FRONTEND_URL/reset-password?token=… (ou ?error=INVALID_TOKEN).
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({
        to: user.email,
        userName: user.name,
        actionUrl: rewriteAuthCallbackUrl(url, `${config.frontendUrl}/reset-password`),
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail({
        to: user.email,
        userName: user.name,
        actionUrl: rewriteAuthCallbackUrl(url, `${config.frontendUrl}/verify-email`),
      });
    },
    // Sempre dispara no sign-up — sem Resend o link vai para o log, o que
    // continua sendo o comportamento desejado em dev.
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
  },
  // Rate limit nativo do better-auth (memory storage, 100 req/10s por path).
  // O default da lib só liga em NODE_ENV=production — forçamos on: sign-in /
  // sign-up / reset são alvos clássicos de brute-force em qualquer ambiente.
  rateLimit: { enabled: true },
  socialProviders: googleConfigured
    ? {
        google: {
          clientId: config.googleClientId as string,
          clientSecret: config.googleClientSecret as string,
        },
      }
    : {},
});

export type Session = typeof auth.$Infer.Session;
export type AuthUser = Session['user'];
