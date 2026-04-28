import { useState } from 'react';

export type GpuTier = 'high' | 'medium' | 'low';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const MEDIUM_RENDERER_HINTS = ['intel', 'mesa', 'swiftshader'];

function classifyRenderer(renderer: string): GpuTier {
  const normalized = renderer.toLowerCase();

  if (MEDIUM_RENDERER_HINTS.some((hint) => normalized.includes(hint))) {
    return 'medium';
  }

  return 'high';
}

function detectGpuTier(): GpuTier {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 'medium';
  }

  try {
    const prefersReduced = window.matchMedia(REDUCED_MOTION_QUERY).matches;
    if (prefersReduced) {
      return 'low';
    }

    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl') ||
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);

    if (!gl) {
      return 'low';
    }

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');

    if (debugInfo) {
      const renderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? '');
      return classifyRenderer(renderer);
    }

    const fallbackRenderer = String(gl.getParameter(gl.RENDERER) ?? '');
    return classifyRenderer(fallbackRenderer);
  } catch {
    return 'medium';
  }
}

export function useGpuTier(): GpuTier {
  const [tier] = useState<GpuTier>(detectGpuTier);

  return tier;
}
