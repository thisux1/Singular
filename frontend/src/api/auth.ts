import { createAuthClient } from 'better-auth/react';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';

// Better Auth espera a RAIZ do backend em baseURL — ele sufixa `/api/auth`
// sozinho. VITE_AUTH_URL (ex.: http://localhost:3001) permite override
// direto; na ausência dela derivamos de VITE_API_URL removendo o `/api`.
const AUTH_BASE_URL =
  import.meta.env.VITE_AUTH_URL ?? API_BASE_URL.replace(/\/api\/?$/, '');

export const authClient = createAuthClient({
  baseURL: AUTH_BASE_URL,
  fetchOptions: { credentials: 'include' },
});

export const useSession = authClient.useSession;

export type AuthSession = NonNullable<ReturnType<typeof useSession>['data']>;
export type AuthUser = AuthSession['user'];

// Identidade stub injetada pelo backend quando AUTH_DISABLED=true
// (espelha backend/src/middleware/auth.ts — usuário único do modo self-host).
const LOCAL_USER_ID = 'local';
const LOCAL_USER_EMAIL = 'local@singular.local';

/**
 * Feature flag de dev: VITE_AUTH_DISABLED=true deve acompanhar
 * AUTH_DISABLED=true do backend. Nesse modo a API injeta o usuário `local`
 * sem sessão — o frontend trata tudo como autenticado e pula a login wall.
 */
export function isAuthDisabled(): boolean {
  return import.meta.env.VITE_AUTH_DISABLED === 'true';
}

/** Sessão aponta para o stub local do backend (cinto-e-suspensório do modo dev). */
export function isLocalUser(user: AuthUser | null | undefined): boolean {
  return user?.id === LOCAL_USER_ID || user?.email === LOCAL_USER_EMAIL;
}

export interface AuthState {
  session: AuthSession | null;
  user: AuthUser | null;
  isPending: boolean;
  isAuthenticated: boolean;
  authDisabled: boolean;
}

/**
 * Estado de auth consumível pelos guards (RequireAuth) e pela Navbar.
 * Em modo dev (authDisabled), `isAuthenticated` é true mesmo sem sessão.
 */
export function useAuth(): AuthState {
  const { data, isPending } = useSession();
  const authDisabled = isAuthDisabled();
  const user = data?.user ?? null;

  return {
    session: data ?? null,
    user,
    isPending,
    authDisabled,
    isAuthenticated: authDisabled || isLocalUser(user) || user !== null,
  };
}

/** Leitura imperativa de sessão (fora de componente). */
export async function getSession(): Promise<AuthSession | null> {
  const { data } = await authClient.getSession();
  return data ?? null;
}
