import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { config } from './config.js';
import { db } from './db/client.js';
import * as schema from './db/schema.js';
import { logInfo } from './utils/logger.js';

// Google OAuth só é registrado quando as duas credenciais existem — self-host
// sem OAuth configurado roda em modo single-user (AUTH_DISABLED, D6) e o
// provider não pode quebrar o boot por falta de env.
const googleConfigured = Boolean(config.googleClientId && config.googleClientSecret);

if (!googleConfigured) {
  logInfo('auth.google_provider_disabled', {
    reason: 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ausentes',
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
