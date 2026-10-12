import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { deleteAccount, exportAccount, fetchAccount } from '../api/account';
import { authClient } from '../api/auth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ProgressBar } from '../components/ui/ProgressBar';
import { Skeleton } from '../components/ui/Skeleton';
import { toast } from '../components/ui/ToastUtils';
import './AccountPage.css';

const DELETE_CONFIRMATION = 'APAGAR';

function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name ?? email ?? '').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatMemberSince(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function formatTotalTime(totalMs: number): string {
  if (!Number.isFinite(totalMs) || totalMs <= 0) {
    return '0min';
  }
  const totalMinutes = Math.round(totalMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
}

/** Header com nome editável inline (authClient.updateUser). */
function AccountHeader({
  user,
}: {
  user: { name: string | null; email: string; image: string | null; createdAt: string };
}) {
  const queryClient = useQueryClient();
  const [draftName, setDraftName] = useState<string | null>(null);

  const renameMutation = useMutation({
    mutationFn: (name: string) => authClient.updateUser({ name }),
    onSuccess: async ({ error }) => {
      if (error) {
        toast('Falha ao atualizar o nome.', 'error');
        return;
      }
      toast('Nome atualizado.', 'success');
      setDraftName(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account'] }),
        queryClient.invalidateQueries({ queryKey: ['session'] }),
      ]);
    },
    onError: () => {
      toast('Falha ao atualizar o nome.', 'error');
    },
  });

  const displayName = user.name?.trim() ?? '';
  const editing = draftName !== null;

  const commit = () => {
    const next = (draftName ?? '').trim();
    if (!next || next === displayName) {
      setDraftName(null);
      return;
    }
    renameMutation.mutate(next);
  };

  return (
    <header className="account__header">
      {user.image ? (
        <img className="account__avatar" src={user.image} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span className="account__avatar account__avatar--initials" aria-hidden="true">
          {initialsOf(user.name, user.email)}
        </span>
      )}
      <div className="account__identity">
        {editing ? (
          <form
            className="account__name-form"
            onSubmit={(event) => {
              event.preventDefault();
              commit();
            }}
          >
            <input
              className="account__name-input"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={commit}
              autoFocus
              maxLength={80}
              aria-label="Nome de exibição"
              disabled={renameMutation.isPending}
            />
          </form>
        ) : (
          <h1 className="account__name">
            {displayName || 'Sem nome'}{' '}
            <button
              type="button"
              className="account__name-edit"
              onClick={() => setDraftName(displayName)}
              aria-label="Editar nome"
            >
              editar
            </button>
          </h1>
        )}
        <p className="account__meta text-mono">
          {user.email} · membro desde {formatMemberSince(user.createdAt)}
        </p>
      </div>
    </header>
  );
}

export function AccountPage() {
  const navigate = useNavigate();

  const accountQuery = useQuery({
    queryKey: ['account'],
    queryFn: fetchAccount,
    retry: false,
  });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [deleteInput, setDeleteInput] = useState('');

  const passwordMutation = useMutation({
    mutationFn: () =>
      authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      }),
    onSuccess: ({ error }) => {
      if (error) {
        setPasswordError(
          error.code === 'INVALID_PASSWORD'
            ? 'Senha atual incorreta.'
            : 'Falha ao trocar a senha. Tente novamente.',
        );
        return;
      }
      setPasswordError(null);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast('Senha atualizada. Outras sessões foram encerradas.', 'success');
    },
    onError: () => {
      setPasswordError('Falha ao trocar a senha. Tente novamente.');
    },
  });

  const exportMutation = useMutation({
    mutationFn: exportAccount,
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `singular-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast('Dados exportados.', 'success');
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Falha na exportação.', 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAccount(DELETE_CONFIRMATION),
    onSuccess: async () => {
      toast('Conta apagada. Os dados dissiparam no horizonte.', 'info');
      try {
        await authClient.signOut();
      } finally {
        navigate('/', { replace: true });
      }
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Falha ao apagar a conta.', 'error');
    },
  });

  const handlePasswordSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      setPasswordError('A nova senha precisa de pelo menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('As senhas não coincidem.');
      return;
    }
    setPasswordError(null);
    passwordMutation.mutate();
  };

  if (accountQuery.isLoading) {
    return (
      <section className="account page page-container">
        <Skeleton width="35%" height="32px" />
        <Skeleton width="100%" height="120px" />
        <Skeleton width="100%" height="260px" />
        <Skeleton width="100%" height="200px" />
      </section>
    );
  }

  if (accountQuery.isError || !accountQuery.data) {
    return (
      <section className="account page page-container">
        <div className="account__error">
          <p>Erro ao carregar o perfil da conta.</p>
          <Button variant="ghost" onClick={() => void accountQuery.refetch()}>
            Tentar reconexão
          </Button>
        </div>
      </section>
    );
  }

  const { user, providers, statsSummary: stats } = accountQuery.data;
  const hasCredential = providers.includes('credential');
  const canDelete = deleteInput.trim() === DELETE_CONFIRMATION && !deleteMutation.isPending;

  return (
    <section className="account page page-container">
      <AccountHeader user={user} />

      {/* ─── Conquistas ─── */}
      <div className="account__card" aria-labelledby="account-progress-title">
        <h2 className="account__card-title" id="account-progress-title">Conquistas</h2>

        <div className="account__level">
          <div className="account__level-meta">
            <span className="account__level-badge">LV {stats.level}</span>
            <span className="account__level-xp text-mono">
              {stats.xp.toLocaleString('pt-BR')} XP
            </span>
            <span className="account__level-next text-mono">
              {Math.round(stats.levelProgressPct)}% → LV {stats.level + 1}
            </span>
          </div>
          <ProgressBar value={stats.levelProgressPct} />
          {stats.streakDays > 0 ? (
            <p className="account__streak text-mono">streak {stats.streakDays}d</p>
          ) : null}
        </div>

        <div className="account__totals">
          <div className="account__total">
            <span className="account__total-label">Sessões</span>
            <strong className="account__total-value">{stats.totalSessions}</strong>
          </div>
          <div className="account__total">
            <span className="account__total-label">Questões</span>
            <strong className="account__total-value">{stats.totalAnswered}</strong>
          </div>
          <div className="account__total">
            <span className="account__total-label">Precisão</span>
            <strong className="account__total-value">{Math.round(stats.accuracyPct)}%</strong>
          </div>
          <div className="account__total">
            <span className="account__total-label">Tempo total</span>
            <strong className="account__total-value">{formatTotalTime(stats.totalTimeMs)}</strong>
          </div>
        </div>

        {stats.badges.length > 0 ? (
          <ul className="account__badges" aria-label="Badges">
            {stats.badges.map((badge) => (
              <li
                key={badge.id}
                className={`account__badge ${
                  badge.earned ? 'account__badge--earned' : 'account__badge--locked'
                }`}
              >
                <span aria-hidden="true">{badge.earned ? '◈' : '◇'}</span>
                {badge.label}
                <span className="sr-only">
                  {badge.earned ? ' (conquistado)' : ' (não conquistado)'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {stats.perSubject.length > 0 ? (
          <div className="account__subjects">
            <h3 className="account__subheading">Precisão por disciplina</h3>
            <ul className="account__subject-list">
              {stats.perSubject.map((subject) => (
                <li className="account__subject" key={subject.subject}>
                  <span className="account__subject-name">{subject.subject}</span>
                  <span className="account__subject-bar">
                    <ProgressBar value={subject.accuracyPct} size="sm" />
                  </span>
                  <span className="account__subject-pct text-mono">
                    {Math.round(subject.accuracyPct)}%
                  </span>
                </li>
              ))}
            </ul>
            {stats.weakestSubject ? (
              <p className="account__weakest text-mono">
                setor mais fraco: {stats.weakestSubject.subject} (
                {Math.round(stats.weakestSubject.accuracyPct)}%)
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ─── Segurança ─── */}
      <div className="account__card" aria-labelledby="account-security-title">
        <h2 className="account__card-title" id="account-security-title">Segurança</h2>
        {hasCredential ? (
          <form className="account__password-form" onSubmit={handlePasswordSubmit} noValidate>
            <Input
              label="Senha atual"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            <Input
              label="Nova senha"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              hint="Mínimo de 8 caracteres."
            />
            <Input
              label="Confirmar nova senha"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            {passwordError ? (
              <p className="account__form-error" role="alert">{passwordError}</p>
            ) : null}
            <div>
              <Button type="submit" loading={passwordMutation.isPending}>
                Trocar senha
              </Button>
            </div>
          </form>
        ) : (
          <p className="account__note text-mono">
            conta via {providers[0] ?? 'google'} — a senha é gerenciada pelo provedor.
          </p>
        )}
      </div>

      {/* ─── Dados ─── */}
      <div className="account__card" aria-labelledby="account-data-title">
        <h2 className="account__card-title" id="account-data-title">Dados</h2>
        <div className="account__data-row">
          <div>
            <p className="account__data-label">Exportar dados</p>
            <p className="account__data-desc">
              Baixa um JSON com provas, sessões de quiz e estatísticas da sua conta.
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => exportMutation.mutate()}
            loading={exportMutation.isPending}
          >
            Exportar JSON
          </Button>
        </div>

        <div className="account__danger">
          <p className="account__data-label account__data-label--danger">Zona de perigo</p>
          <p className="account__data-desc">
            Apaga a conta e todos os dados vinculados. Ação irreversível — digite{' '}
            <strong>{DELETE_CONFIRMATION}</strong> para confirmar.
          </p>
          <form
            className="account__delete-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (canDelete) {
                deleteMutation.mutate();
              }
            }}
          >
            <input
              className="account__delete-input"
              value={deleteInput}
              onChange={(event) => setDeleteInput(event.target.value)}
              placeholder={DELETE_CONFIRMATION}
              aria-label={`Digite ${DELETE_CONFIRMATION} para confirmar a exclusão`}
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" variant="danger" disabled={!canDelete} loading={deleteMutation.isPending}>
              Apagar conta
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
