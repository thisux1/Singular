import { useSyncExternalStore } from 'react';

/**
 * Flag "fundo estático" — manual override do usuário (toggle MANUAL_OVRD
 * no FuiOverlay). Quando ativa, o SingularityCanvas renderiza o fallback
 * CSS em vez do canvas WebGL animado.
 *
 * Persiste em localStorage e propaga em tempo real via evento
 * 'singular:bg-toggle' (mesma aba) e 'storage' (entre abas).
 */
export const BG_STATIC_STORAGE_KEY = 'singular:bg-static';
export const BG_STATIC_EVENT = 'singular:bg-toggle';

export function isStaticBackgroundEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(BG_STATIC_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setStaticBackground(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.setItem(BG_STATIC_STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(BG_STATIC_STORAGE_KEY);
    }
  } catch {
    // Storage indisponível (modo privado) — o evento ainda vale para esta aba.
  }

  window.dispatchEvent(new Event(BG_STATIC_EVENT));
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener(BG_STATIC_EVENT, onStoreChange);
  window.addEventListener('storage', onStoreChange);
  return () => {
    window.removeEventListener(BG_STATIC_EVENT, onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

export function useStaticBackground(): boolean {
  return useSyncExternalStore(subscribe, isStaticBackgroundEnabled, () => false);
}
