import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { auth, type AuthUser } from '../auth.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { user } from '../db/schema.js';
import { logInfo } from '../utils/logger.js';

const LOCAL_USER_ID = 'local';
const LOCAL_USER_EMAIL = 'local@singular.local';
const LOCAL_USER_NAME = 'Local User';

export type AuthVariables = {
  user: AuthUser;
};

// Cache do stub local — identidade única do modo self-host (D6).
let localUserPromise: Promise<AuthUser> | null = null;

function findOrCreateLocalUser(): Promise<AuthUser> {
  localUserPromise ??= (async () => {
    const now = new Date();
    await db
      .insert(user)
      .values({
        id: LOCAL_USER_ID,
        name: LOCAL_USER_NAME,
        email: LOCAL_USER_EMAIL,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: user.email });

    const rows = await db
      .select()
      .from(user)
      .where(eq(user.email, LOCAL_USER_EMAIL))
      .limit(1);

    const localUser = rows[0];
    if (!localUser) {
      throw new Error('auth.local_user_unavailable');
    }

    logInfo('auth.local_user_ready', { userId: localUser.id });
    return localUser as AuthUser;
  })();

  return localUserPromise;
}

/**
 * Guard de rotas /api/* (D6/D14).
 *
 * - AUTH_DISABLED=true (dev/self-host single-user): injeta o usuário stub
 *   `local@singular.local` (find-or-create) sem consultar sessão.
 * - AUTH_DISABLED=false: valida sessão Better Auth via cookie/header;
 *   sem sessão → 401 JSON `{error:{code:'UNAUTHORIZED'}}`.
 *
 * Aplicado globalmente em index.ts para `/api/*` exceto `/api/auth/*`.
 */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    if (config.authDisabled) {
      const localUser = await findOrCreateLocalUser();
      c.set('user', localUser);
      await next();
      return;
    }

    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        401,
      );
    }

    c.set('user', session.user);
    await next();
  },
);

/** Usuário autenticado injetado por requireAuth (ou stub local). */
export function getUser(c: Context): AuthUser {
  return c.get('user') as AuthUser;
}

/**
 * Ownership filter (D16).
 *
 * Retorna `undefined` quando `config.authDisabled` — modo dev single-user
 * enxerga TODAS as provas (inclusive as legadas do user `system`), sem
 * filtro de ownership. Com auth ativa, retorna o `user.id` real para
 * filtrar queries.
 *
 * Uso: passar direto para `examsRepository.listByUser`/`getByIdForUser`
 * (que tratam `undefined` como "sem filtro").
 */
export function ownershipUserId(c: Context): string | undefined {
  return config.authDisabled ? undefined : getUser(c).id;
}

/**
 * Checagem pontual de ownership para um registro já carregado.
 * Em `authDisabled` sempre retorna true (bypass dev).
 */
export function canAccessExam(
  c: Context,
  exam: { userId?: string | null },
): boolean {
  if (config.authDisabled) {
    return true;
  }

  return exam.userId === getUser(c).id;
}
