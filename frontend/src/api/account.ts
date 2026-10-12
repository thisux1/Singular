import { ApiError, apiFetch, apiUrl } from './client';
import type { StatsSummary } from './stats';

/**
 * GET /api/account — perfil agregado da conta (backend monta a partir do
 * usuário da sessão + providers vinculados + resumo de gamificação).
 */
export type AccountUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  createdAt: string;
};

export type AccountProfile = {
  user: AccountUser;
  /**
   * providerIds das credenciais vinculadas — ex.: 'credential' (email+senha
   * do better-auth) e 'google'. A UI decide o que exibir (troca de senha só
   * faz sentido com 'credential').
   */
  providers: string[];
  statsSummary: StatsSummary;
};

export function fetchAccount(): Promise<AccountProfile> {
  return apiFetch<AccountProfile>('/account');
}

/**
 * GET /api/account/export → arquivo JSON para download. Não usa apiFetch
 * porque o payload é um blob, não o envelope JSON da API.
 */
export async function exportAccount(): Promise<Blob> {
  const response = await fetch(apiUrl('/account/export'), {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new ApiError('Falha ao exportar os dados da conta.', response.status, undefined);
  }

  return response.blob();
}

/** DELETE /api/account { confirmation: 'APAGAR' } → 204. */
export function deleteAccount(confirmation: string): Promise<void> {
  return apiFetch<void>('/account', {
    method: 'DELETE',
    body: JSON.stringify({ confirmation }),
  });
}
