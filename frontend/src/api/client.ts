import { isAuthDisabled } from './auth';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedPath}`;
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return undefined;
  }

  return response.json().catch(() => undefined);
}

// Em auth ativa, um 401 em rota de dados derruba a UI para /login
// preservando o destino em ?next=. Não redireciona quando:
// - AUTH_DISABLED (dev single-user): a API não emite sessão;
// - a chamada é do próprio /api/auth (gerenciado pelo authClient);
// - já estamos em /login (evita loop).
function redirectToLoginIfNeeded(path: string): void {
  if (isAuthDisabled()) return;
  if (joinUrl(API_BASE_URL, path).includes('/api/auth')) return;
  if (window.location.pathname === '/login') return;

  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

/** URL absoluta para um path da API (streams, blobs, assets fora do JSON). */
export function apiUrl(path: string): string {
  return joinUrl(API_BASE_URL, path);
}

/** Extrai `error.code` do payload de erro da API (ex.: 'NO_WRONG_ANSWERS'). */
export function getApiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) {
    return null;
  }

  const payload = error.data;
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) {
    return null;
  }

  const inner = (payload as { error?: unknown }).error;
  if (typeof inner !== 'object' || inner === null) {
    return null;
  }

  const code = (inner as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(joinUrl(API_BASE_URL, path), {
    credentials: 'include',
    ...options,
    headers: {
      ...(options?.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });

  const payload = await parseJsonSafe(response);

  if (!response.ok) {
    if (response.status === 401) {
      redirectToLoginIfNeeded(path);
    }

    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'object' &&
      payload.error !== null &&
      'message' in payload.error &&
      typeof payload.error.message === 'string'
        ? payload.error.message
        : 'Erro inesperado na API';

    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}
