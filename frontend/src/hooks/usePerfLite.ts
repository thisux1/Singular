import { useEffect, useSyncExternalStore } from 'react';

/**
 * Flag "FX.LITE" — modo leve global: toda a UI passa a usar apenas
 * efeitos compostáveis (transform + opacity). Liga/desliga:
 *   - backdrop-filter (o blur sobre o WebGL é o maior custo da página)
 *   - filter animado (blur, drop-shadow, hue-rotate) e gradientes vivos
 *   - o próprio raymarcher (o canvas cai pro fallback estático)
 * Mantém: transform, opacity, cores — o que roda só no compositor.
 *
 * Persiste em localStorage, propaga via 'singular:fx-toggle' (mesma aba)
 * e 'storage' (entre abas), e espelha a classe `.fx-lite` no <html>
 * pra camada CSS em styles/perf-lite.css.
 */
export const FX_LITE_STORAGE_KEY = 'singular:fx-lite';
export const FX_LITE_EVENT = 'singular:fx-toggle';

export function isPerfLiteEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(FX_LITE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPerfLite(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.setItem(FX_LITE_STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(FX_LITE_STORAGE_KEY);
    }
  } catch {
    // Storage indisponível (modo privado) — o evento ainda vale para esta aba.
  }

  window.dispatchEvent(new Event(FX_LITE_EVENT));
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener(FX_LITE_EVENT, onStoreChange);
  window.addEventListener('storage', onStoreChange);
  return () => {
    window.removeEventListener(FX_LITE_EVENT, onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

export function usePerfLite(): boolean {
  const enabled = useSyncExternalStore(subscribe, isPerfLiteEnabled, () => false);

  useEffect(() => {
    document.documentElement.classList.toggle('fx-lite', enabled);
  }, [enabled]);

  return enabled;
}
