import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { user } from '../db/schema.js';
import { getUser, invalidateLocalUserCache, requireAuth, type AuthVariables } from '../middleware/auth.js';
import {
  buildAccountExport,
  deleteUserAccount,
  listUserProviders,
  PasswordRequiredError,
  PasswordVerificationError,
  toAccountUserDTO,
} from '../services/account-service.js';
import { getStatsSummaryForUser } from '../services/stats-summary.js';
import { logError } from '../utils/logger.js';

/**
 * Rotas de conta (WS-A T2) — escopo: sempre o próprio usuário autenticado
 * (ou stub 'local' em AUTH_DISABLED). Montado em /api/account no index.ts.
 */
export const accountRoutes = new Hono<{ Variables: AuthVariables }>();

// Guard por rota — mesmo padrão de quiz/stats (idempotente com o global).
accountRoutes.use('*', requireAuth);

const deleteAccountSchema = z.object({
  confirmation: z.string(),
  password: z.string().optional(),
});

/**
 * GET /api/account → perfil + providers vinculados + statsSummary
 * (mesmo payload de GET /api/stats/summary).
 */
accountRoutes.get('/', async (c) => {
  const authUser = getUser(c);

  const [[userRow], providers, statsSummary] = await Promise.all([
    db.select().from(user).where(eq(user.id, authUser.id)).limit(1),
    listUserProviders(authUser.id),
    getStatsSummaryForUser(authUser.id),
  ]);

  // Fallback defensivo: usuário da sessão sempre existe na tabela, mas se a
  // row sumir (race com DELETE), devolve os dados da sessão.
  const userDTO = userRow
    ? toAccountUserDTO(userRow)
    : {
        id: authUser.id,
        name: authUser.name,
        email: authUser.email,
        image: authUser.image ?? null,
        createdAt: authUser.createdAt instanceof Date
          ? authUser.createdAt.toISOString()
          : String(authUser.createdAt),
      };

  return c.json({
    user: userDTO,
    providers,
    statsSummary,
  });
});

/**
 * GET /api/account/export → download JSON com TODOS os dados do usuário
 * (LGPD — portabilidade). Content-Disposition: attachment singular-export.json.
 */
accountRoutes.get('/export', async (c) => {
  const authUser = getUser(c);
  const payload = await buildAccountExport(authUser.id);

  return c.body(JSON.stringify(payload), 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': 'attachment; filename="singular-export.json"',
  });
});

/**
 * DELETE /api/account — exclusão irreversível (LGPD — esquecimento).
 *
 * Body: { confirmation: 'APAGAR', password?: string }
 * - confirmation exato 'APAGAR' obrigatório → 400 VALIDATION caso contrário;
 * - conta com credential (email/senha) exige `password` correto →
 *   400 PASSWORD_REQUIRED se ausente, 401 INVALID_PASSWORD se incorreta;
 * - conta só-OAuth não tem senha → confirmation basta (decisão documentada
 *   em account-service.ts).
 *
 * O delete na row `user` dispara a cascata do schema (sessions/accounts/
 * exams→questions/quizSessions→answers) — sessões morrem junto, o cookie
 * vira inválido. Retorna 204.
 */
accountRoutes.delete('/', async (c) => {
  const authUser = getUser(c);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json(
      { error: { code: 'VALIDATION', field: 'body', message: 'Body JSON inválido' } },
      400,
    );
  }

  const parsed = deleteAccountSchema.safeParse(rawBody);
  if (!parsed.success || parsed.data.confirmation !== 'APAGAR') {
    return c.json(
      {
        error: {
          code: 'VALIDATION',
          field: 'confirmation',
          message: "Confirmação obrigatória: envie confirmation: 'APAGAR'",
        },
      },
      400,
    );
  }

  try {
    await deleteUserAccount(authUser.id, { password: parsed.data.password });
  } catch (error) {
    if (error instanceof PasswordRequiredError) {
      return c.json(
        {
          error: {
            code: 'PASSWORD_REQUIRED',
            field: 'password',
            message: 'Esta conta usa email/senha — envie a senha atual no campo password',
          },
        },
        400,
      );
    }
    if (error instanceof PasswordVerificationError) {
      return c.json(
        { error: { code: 'INVALID_PASSWORD', field: 'password', message: 'Senha incorreta' } },
        401,
      );
    }
    logError('account.delete.failed', {
      userId: authUser.id,
      error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    });
    throw error;
  }

  // AUTH_DISABLED: a row stub 'local' foi apagada — reseta o cache para o
  // próximo request re-criar (delete vira "reset dos dados dev").
  if (config.authDisabled) {
    invalidateLocalUserCache();
  }

  return c.body(null, 204);
});
