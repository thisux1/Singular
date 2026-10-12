import { useCallback, useState } from 'react';

const STORAGE_KEY = 'singular_onboarded';

function readOnboarded(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Estado de onboarding persistido em localStorage ('singular_onboarded').
 * O orquestrador usa `onboarded` para decidir quando abrir o OnboardingDialog.
 */
export function useOnboarding() {
  const [onboarded, setOnboarded] = useState<boolean>(readOnboarded);

  const complete = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // storage indisponível (modo privado) — segue apenas em memória
    }
    setOnboarded(true);
  }, []);

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // idem
    }
    setOnboarded(false);
  }, []);

  return { onboarded, complete, reset };
}
