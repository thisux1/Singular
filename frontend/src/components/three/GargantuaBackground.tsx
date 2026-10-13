import { useMemo, useRef, useEffect, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  gargantuaQuadVertexShader,
  gargantuaRaymarchFragmentShader,
  gargantuaBlurFragmentShader,
  gargantuaCompositeFragmentShader,
} from './shaders/gargantua.glsl';
import type { GpuTier } from '../../hooks/useGpuTier';
import type { CursorDistortionState } from './CursorDistortion';

/**
 * Gargantua — raymarcher Schwarzschild portado de PORTFOLIO/gargantua.html.
 *
 * Substitui o pipeline space→distortion→composite do BlackholeBackground por
 * geodésicas nulas reais: disco Novikov-Thorne com doppler relativístico,
 * redshift gravitacional, bloom HDR em 2 mips e ACES no composite.
 *
 * Sem input próprio (o canvas fica atrás do conteúdo): a câmera orbita
 * lentamente no eixo azimutal e o cursor aplica um parallax sutil de
 * elevação/azimute — substitui o antigo warp de UV por deslocamento real
 * de ponto de vista.
 */

const FOV_TAN = Math.tan((34 * Math.PI) / 360);

type GargantuaBackgroundProps = {
  tier: GpuTier;
  cursorStateRef: MutableRefObject<CursorDistortionState>;
  /** Scroll global 0..1 — descer a página orbita a câmera. */
  scrollRef?: MutableRefObject<number>;
};

export function GargantuaBackground({ tier, cursorStateRef, scrollRef }: GargantuaBackgroundProps) {
  const { gl, size } = useThree();
  const dpr = useThree((s) => s.viewport.dpr);
  const isMedium = tier === 'medium';
  const maxSteps = isMedium ? 320 : 560;
  const baseScale = isMedium ? 0.85 : 1.0;

  // Câmera orbital (azim/elev/dist) — auto-orbita no idle + parallax do cursor.
  // dist 17 (vs 12.5 do standalone): afasta o buraco pra dar ar ao layout.
  const camRef = useRef({ azim: 0, elev: 0.115, dist: 17 });
  const tgtRef = useRef({ azim: 0, elev: 0.115, dist: 17 });
  const simTRef = useRef(0);
  const qualityRef = useRef({ scale: baseScale, steps: maxSteps, emaMs: 16.7, frames: 0 });
  const dbgRef = useRef<HTMLElement | null>(null);

  const hdrOK = useMemo(() => gl.extensions.has('EXT_color_buffer_float'), [gl]);
  const rtType = hdrOK ? THREE.HalfFloatType : THREE.UnsignedByteType;

  const mkRT = (div: number) => {
    const rt = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: rtType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    rt.texture.generateMipmaps = false;
    (rt as THREE.WebGLRenderTarget & { __div: number }).__div = div;
    return rt;
  };

  const targets = useMemo(
    () => ({ scene: mkRT(1), b1a: mkRT(2), b1b: mkRT(2), b2a: mkRT(4), b2b: mkRT(4) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hdrOK/rtType estáveis por contexto
    [rtType],
  );

  const quadScene = useMemo(() => new THREE.Scene(), []);
  // ortho 2×2 quad: camera precisa estar afastada do plano z=0 senão o near
  // clipa o quad inteiro (foi o bug do "render preto").
  const quadCam = useMemo(() => {
    const c = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    c.position.z = 1;
    return c;
  }, []);
  const quadGeom = useMemo(() => new THREE.PlaneGeometry(2, 2), []);

  const raymarchMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          uRes: { value: new THREE.Vector2(2, 2) },
          uTime: { value: 0 },
          uCamPos: { value: new THREE.Vector3() },
          uRight: { value: new THREE.Vector3() },
          uUp: { value: new THREE.Vector3() },
          uFwd: { value: new THREE.Vector3(0, 0, -1) },
          uFov: { value: FOV_TAN },
          uSpin: { value: -1.4 },
          uExpo: { value: 1.0 },
          uSteps: { value: maxSteps },
        },
        vertexShader: gargantuaQuadVertexShader,
        fragmentShader: gargantuaRaymarchFragmentShader,
      }),
    [maxSteps],
  );

  const blurMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          uTex: { value: null },
          uDir: { value: new THREE.Vector2() },
          uSrcTexel: { value: new THREE.Vector2() },
          uThresh: { value: 0 },
          uKnee: { value: 0.45 },
        },
        vertexShader: gargantuaQuadVertexShader,
        fragmentShader: gargantuaBlurFragmentShader,
      }),
    [],
  );

  const compMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          uScene: { value: null },
          uB1: { value: null },
          uB2: { value: null },
          uBloom: { value: 1.0 },
          uExpo: { value: 1.0 },
          uTime: { value: 0 },
        },
        vertexShader: gargantuaQuadVertexShader,
        fragmentShader: gargantuaCompositeFragmentShader,
      }),
    [],
  );

  const quadMesh = useMemo(() => {
    const m = new THREE.Mesh(quadGeom, raymarchMat);
    m.frustumCulled = false;
    return m;
  }, [quadGeom, raymarchMat]);

  useEffect(() => {
    quadScene.add(quadMesh);
    return () => {
      quadScene.remove(quadMesh);
    };
  }, [quadScene, quadMesh]);

  // Resize de todos os RTs respeitando a escala adaptativa.
  useEffect(() => {
    const q = qualityRef.current;
    const w = Math.max(2, Math.round(size.width * dpr * q.scale));
    const h = Math.max(2, Math.round(size.height * dpr * q.scale));
    for (const rt of Object.values(targets)) {
      const div = (rt as THREE.WebGLRenderTarget & { __div: number }).__div;
      rt.setSize(Math.max(2, Math.round(w / div)), Math.max(2, Math.round(h / div)));
    }
    raymarchMat.uniforms.uRes.value.set(
      Math.max(2, Math.round(w)),
      Math.max(2, Math.round(h)),
    );
  }, [size, dpr, targets, raymarchMat]);

  useEffect(() => {
    return () => {
      for (const rt of Object.values(targets)) rt.dispose();
      quadGeom.dispose();
      raymarchMat.dispose();
      blurMat.dispose();
      compMat.dispose();
    };
  }, [targets, quadGeom, raymarchMat, blurMat, compMat]);

  const resizeTargets = () => {
    const q = qualityRef.current;
    const w = Math.max(2, Math.round(size.width * dpr * q.scale));
    const h = Math.max(2, Math.round(size.height * dpr * q.scale));
    for (const rt of Object.values(targets)) {
      const div = (rt as THREE.WebGLRenderTarget & { __div: number }).__div;
      rt.setSize(Math.max(2, Math.round(w / div)), Math.max(2, Math.round(h / div)));
    }
    raymarchMat.uniforms.uRes.value.set(w, h);
  };

  const blurPass = (
    src: THREE.WebGLRenderTarget,
    dst: THREE.WebGLRenderTarget,
    dx: number,
    dy: number,
    thresh: number,
  ) => {
    quadMesh.material = blurMat;
    blurMat.uniforms.uTex.value = src.texture;
    blurMat.uniforms.uDir.value.set(dx, dy);
    blurMat.uniforms.uSrcTexel.value.set(1 / src.width, 1 / src.height);
    blurMat.uniforms.uThresh.value = thresh;
    gl.setRenderTarget(dst);
    gl.render(quadScene, quadCam);
  };

  useFrame((_state, delta) => {
    const dt = Math.min(delta, 0.05);
    simTRef.current += dt;
    const simT = simTRef.current;
    const cam = camRef.current;
    const tgt = tgtRef.current;

    // Auto-órbita lenta (o standalone espera 4s de idle; aqui é sempre idle)
    // + parallax sutil do cursor: desloca o alvo de azimute/elevação.
    const cursor = cursorStateRef.current;
    const cx = cursor.active ? cursor.x - 0.5 : 0;
    const cy = cursor.active ? cursor.y - 0.5 : 0;

    tgt.azim += dt * 0.028;
    tgt.elev += Math.sin(simT * 0.11) * dt * 0.012;
    // Scroll-driven: descer a página gira o buraco (+0.8 rad azim,
    // ~46°) com leve subida de elevação — o lerp abaixo suaviza.
    const scroll = scrollRef?.current ?? 0;
    const effAzim = tgt.azim + cx * 0.34 + scroll * 0.8;
    const effElev = Math.min(1.35, Math.max(-1.35, tgt.elev + cy * 0.26 + scroll * 0.12));

    const k = 1 - Math.exp(-dt * 7);
    cam.azim += (effAzim - cam.azim) * k;
    cam.elev += (effElev - cam.elev) * k;
    cam.dist += (tgt.dist - cam.dist) * k;

    const ce = Math.cos(cam.elev);
    const se = Math.sin(cam.elev);
    const ca = Math.cos(cam.azim);
    const sa = Math.sin(cam.azim);
    const px = cam.dist * ce * ca;
    const py = cam.dist * se;
    const pz = cam.dist * ce * sa;
    const fl = Math.hypot(px, py, pz);
    const fx = -px / fl;
    const fy = -py / fl;
    const fz = -pz / fl;
    const rl = Math.hypot(fz, fx);
    const rx = -fz / rl;
    const rz = fx / rl;
    // up = r_ × f  (r_ = [-fz, 0, fx] normalizado)
    const upx = -rz * fy;
    const upy = rz * fx - rx * fz;
    const upz = rx * fy;

    // Governor estendido: EMA de frame time → escala dos RTs (0.35–1.0)
    // e steps do raymarch (200–maxSteps). Degrada resolução primeiro,
    // steps depois; recupera steps primeiro (ganho invisível), resolução depois.
    const q = qualityRef.current;
    q.emaMs = q.emaMs * 0.94 + Math.min(dt * 1000, 50) * 0.06;
    q.frames += 1;
    if (q.frames % 24 === 0) {
      if (q.emaMs > 21) {
        if (q.scale > 0.35) {
          q.scale = Math.max(0.35, q.scale * 0.85);
          resizeTargets();
        } else if (q.steps > 200) {
          q.steps = Math.max(200, q.steps - 80);
        }
      } else if (q.emaMs < 11.5) {
        if (q.steps < maxSteps) {
          q.steps = Math.min(maxSteps, q.steps + 60);
        } else if (q.scale < baseScale) {
          q.scale = Math.min(baseScale, q.scale * 1.12);
          resizeTargets();
        }
      }
    }

    // ?gfxdbg → overlay com fps/emaMs/scale/steps (textContent direto, sem re-render)
    if (q.frames % 10 === 0) {
      const dbg = (dbgRef.current ??= document.getElementById('gargantua-dbg'));
      if (dbg) {
        dbg.textContent = `${(1000 / q.emaMs).toFixed(0)}fps · ${q.emaMs.toFixed(1)}ms · scale ${q.scale.toFixed(2)} · steps ${q.steps}`;
      }
    }

    // Pass 1: raymarch → HDR RT
    const u = raymarchMat.uniforms;
    u.uTime.value = simT;
    u.uCamPos.value.set(px, py, pz);
    u.uFwd.value.set(fx, fy, fz);
    u.uRight.value.set(rx, 0, rz);
    u.uUp.value.set(upx, upy, upz);
    u.uSteps.value = q.steps;
    quadMesh.material = raymarchMat;
    gl.setRenderTarget(targets.scene);
    gl.render(quadScene, quadCam);

    // Passes 2-6: bright-pass → blur H/V em ½ → downsample → blur H/V em ¼
    const thresh = hdrOK ? 0.9 : 0.55;
    blurPass(targets.scene, targets.b1a, 0, 0, thresh);
    blurPass(targets.b1a, targets.b1b, 1, 0, 0);
    blurPass(targets.b1b, targets.b1a, 0, 1, 0);
    blurPass(targets.b1a, targets.b2a, 0, 0, 0);
    blurPass(targets.b2a, targets.b2b, 1, 0, 0);
    blurPass(targets.b2b, targets.b2a, 0, 1, 0);

    // Pass 7: composite → tela (quadCam ortográfica = fullscreen exato;
    // usar a câmera perspectiva do R3F croparia as UVs do quad)
    quadMesh.material = compMat;
    compMat.uniforms.uScene.value = targets.scene.texture;
    compMat.uniforms.uB1.value = targets.b1a.texture;
    compMat.uniforms.uB2.value = targets.b2a.texture;
    compMat.uniforms.uTime.value = simT;
    gl.setRenderTarget(null);
    gl.render(quadScene, quadCam);
  }, 1);

  return null;
}
