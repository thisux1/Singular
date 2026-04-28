/* eslint-disable react-hooks/immutability, react-hooks/exhaustive-deps */
import { useRef, useMemo, useEffect, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  discVertexShader,
  discFragmentShader,
  particleVertexShader,
  particleFragmentShader,
  distortionVertexShader,
  distortionActiveFragmentShader,
  distortionMaskFragmentShader,
  finalVertexShader,
  finalFragmentShader,
  starsVertexShader,
  starsFragmentShader,
} from './shaders/blackhole.glsl';
import type { GpuTier } from '../../hooks/useGpuTier';
import type { CursorDistortionState } from './CursorDistortion';

// ─── Color config (RED palette, shifted from prototype's purple) ───
const INNER_COLOR = new THREE.Color('#ff9060'); // warm red-orange core
const OUTER_COLOR = new THREE.Color('#cc1111'); // deep crimson outer

// ─── Generate tileable Perlin noise texture on CPU ───
function createNoiseTexture(width: number, height: number): THREE.DataTexture {
  const size = width * height;
  const data = new Uint8Array(size * 4);

  // Simple multi-octave value noise
  function hash(x: number, y: number, seed: number): number {
    let h = (x * 127 + y * 311 + seed * 74) | 0;
    h = ((h << 13) ^ h) | 0;
    return ((h * (h * h * 15731 + 789221) + 1376312589) & 0x7fffffff) / 0x7fffffff;
  }

  function smoothNoise(x: number, y: number, seed: number, freq: number): number {
    const fx = x * freq;
    const fy = y * freq;
    const ix = Math.floor(fx) % freq;
    const iy = Math.floor(fy) % freq;
    const fx0 = fx - Math.floor(fx);
    const fy0 = fy - Math.floor(fy);
    const sx = fx0 * fx0 * (3 - 2 * fx0);
    const sy = fy0 * fy0 * (3 - 2 * fy0);

    const n00 = hash(ix, iy, seed);
    const n10 = hash((ix + 1) % freq, iy, seed);
    const n01 = hash(ix, (iy + 1) % freq, seed);
    const n11 = hash((ix + 1) % freq, (iy + 1) % freq, seed);

    const nx0 = n00 * (1 - sx) + n10 * sx;
    const nx1 = n01 * (1 - sx) + n11 * sx;
    return nx0 * (1 - sy) + nx1 * sy;
  }

  for (let i = 0; i < size; i++) {
    const x = (i % width) / width;
    const y = Math.floor(i / width) / height;
    const freq = 8;

    const noiseR = smoothNoise(x, y, 123, freq) * 0.5 + smoothNoise(x, y, 456, freq * 2) * 0.25 + 0.25;
    const noiseG = smoothNoise(x, y, 789, freq) * 0.5 + smoothNoise(x, y, 101, freq * 2) * 0.25 + 0.25;
    const noiseB = smoothNoise(x, y, 202, freq) * 0.5 + smoothNoise(x, y, 303, freq * 2) * 0.25 + 0.25;

    data[i * 4 + 0] = Math.floor(noiseR * 255);
    data[i * 4 + 1] = Math.floor(noiseG * 255);
    data[i * 4 + 2] = Math.floor(noiseB * 255);
    data[i * 4 + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

type BlackholeBackgroundProps = {
  tier: GpuTier;
  reducedMotion: boolean;
  cursorStateRef: MutableRefObject<CursorDistortionState>;
};

export function BlackholeBackground({ tier, reducedMotion, cursorStateRef }: BlackholeBackgroundProps) {
  const { gl, size, camera } = useThree();
  const isMedium = tier === 'medium';
  const rtScale = isMedium ? 1 : 1.5;
  const particleCount = isMedium ? 40000 : 120000;
  const starCount = isMedium ? 12000 : 42000;

  const spaceScene = useMemo(() => new THREE.Scene(), []);
  const distortionScene = useMemo(() => new THREE.Scene(), []);
  const finalScene = useMemo(() => new THREE.Scene(), []);
  const spaceRT = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    target.texture.generateMipmaps = false;
    return target;
  }, []);
  const distortionRT = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
    });
    target.texture.generateMipmaps = false;
    return target;
  }, []);
  const noiseTexture = useMemo(() => createNoiseTexture(128, 128), []);

  const spaceCamera = useMemo(() => {
    const cam = new THREE.PerspectiveCamera(45, size.width / size.height, 0.1, 1000);
    cam.position.set(5, 2, 5);
    cam.lookAt(0, 0, 0);
    return cam;
  }, []);

  const discMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uNoiseTexture: { value: noiseTexture },
        uInnerColor: { value: INNER_COLOR },
        uOuterColor: { value: OUTER_COLOR },
      },
      vertexShader: discVertexShader,
      fragmentShader: discFragmentShader,
    });
  }, [noiseTexture]);

  const particleMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uNoiseTexture: { value: noiseTexture },
        uInnerColor: { value: INNER_COLOR },
        uOuterColor: { value: OUTER_COLOR },
        uViewHeight: { value: size.height },
        uSize: { value: 0.06 },
      },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
    });
  }, [noiseTexture, size.height]);

  const starsMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uViewHeight: { value: size.height },
        uSize: { value: 0.001 },
      },
      vertexShader: starsVertexShader,
      fragmentShader: starsFragmentShader,
    });
  }, [size.height]);

  const distortionActiveMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      uniforms: {},
      vertexShader: distortionVertexShader,
      fragmentShader: distortionActiveFragmentShader,
    });
  }, []);

  const distortionMaskMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      uniforms: {},
      vertexShader: distortionVertexShader,
      fragmentShader: distortionMaskFragmentShader,
    });
  }, []);

  const finalMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uSpaceTexture: { value: null },
        uDistortionTexture: { value: null },
        uBlackHolePosition: { value: new THREE.Vector2(0.5, 0.5) },
        uCursorPosition: { value: new THREE.Vector2(-1, -1) },
        uResolution: { value: new THREE.Vector2(size.width, size.height) },
        uCursorStrength: { value: 0 },
        uCursorRadius: { value: 0.1 },
        uRGBShiftRadius: { value: 0.0005 },
      },
      vertexShader: finalVertexShader,
      fragmentShader: finalFragmentShader,
    });
  }, []);
  const distortionActiveMeshRef = useRef<THREE.Mesh | null>(null);
  const blackHoleWorldPosRef = useRef(new THREE.Vector3());

  useEffect(() => {
    const discGeometry = new THREE.CylinderGeometry(5, 1, 0, 64, 10, true);
    const disc = new THREE.Mesh(discGeometry, discMaterial);
    spaceScene.add(disc);

    const positions = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const randoms = new Float32Array(particleCount);
    const angleOffsets = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i += 1) {
      const idx = i * 3;
      positions[idx + 0] = Math.random();
      positions[idx + 1] = 0;
      positions[idx + 2] = 0;
      sizes[i] = Math.random();
      randoms[i] = Math.random();
      angleOffsets[i] = Math.random() * Math.PI * 2;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    particleGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    particleGeometry.setAttribute('aRandom', new THREE.Float32BufferAttribute(randoms, 1));
    particleGeometry.setAttribute('aAngleOffset', new THREE.Float32BufferAttribute(angleOffsets, 1));
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    particles.frustumCulled = false;
    spaceScene.add(particles);

    const starPositions = new Float32Array(starCount * 3);
    const starSizes = new Float32Array(starCount);
    const starColors = new Float32Array(starCount * 3);
    const tmpColor = new THREE.Color();
    for (let i = 0; i < starCount; i += 1) {
      const idx = i * 3;
      const phi = 2 * Math.PI * Math.random();
      const theta = Math.acos(2 * Math.random() - 1);
      const r = 400;
      starPositions[idx + 0] = Math.cos(phi) * Math.sin(theta) * r;
      starPositions[idx + 1] = Math.sin(phi) * Math.sin(theta) * r;
      starPositions[idx + 2] = Math.cos(theta) * r;
      starSizes[i] = Math.random();
      tmpColor.setHSL(Math.random(), 1, 0.8);
      starColors[idx + 0] = tmpColor.r;
      starColors[idx + 1] = tmpColor.g;
      starColors[idx + 2] = tmpColor.b;
    }
    const starsGeometry = new THREE.BufferGeometry();
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    starsGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(starSizes, 1));
    starsGeometry.setAttribute('aColor', new THREE.Float32BufferAttribute(starColors, 3));
    const stars = new THREE.Points(starsGeometry, starsMaterial);
    stars.frustumCulled = false;
    spaceScene.add(stars);

    const distortionActiveGeom = new THREE.PlaneGeometry(1, 1);
    const distortionActiveMesh = new THREE.Mesh(distortionActiveGeom, distortionActiveMaterial);
    distortionActiveMesh.scale.set(10, 10, 10);
    distortionScene.add(distortionActiveMesh);

    // Disc mask (rotated 90° on X to align with the disc plane)
    const distortionMaskGeom = new THREE.PlaneGeometry(1, 1);
    const distortionMaskMesh = new THREE.Mesh(distortionMaskGeom, distortionMaskMaterial);
    distortionMaskMesh.scale.set(10, 10, 10);
    distortionMaskMesh.rotation.x = Math.PI * 0.5;
    distortionScene.add(distortionMaskMesh);

    distortionActiveMeshRef.current = distortionActiveMesh;
    const finalGeom = new THREE.PlaneGeometry(2, 2);
    const finalMesh = new THREE.Mesh(finalGeom, finalMaterial);
    finalMesh.frustumCulled = false;
    finalScene.add(finalMesh);
    finalMaterial.uniforms.uSpaceTexture.value = spaceRT.texture;
    finalMaterial.uniforms.uDistortionTexture.value = distortionRT.texture;

    return () => {
      distortionActiveMeshRef.current = null;
      spaceScene.clear();
      distortionScene.clear();
      finalScene.clear();
      discGeometry.dispose();
      particleGeometry.dispose();
      starsGeometry.dispose();
      distortionActiveGeom.dispose();
      distortionMaskGeom.dispose();
      finalGeom.dispose();
    };
  }, [
    particleCount,
    starCount,
    spaceScene, distortionScene, finalScene,
    discMaterial, particleMaterial, starsMaterial,
    distortionActiveMaterial, distortionMaskMaterial,
    finalMaterial, spaceRT, distortionRT,
  ]);

  useEffect(() => {
    const safeWidth = Math.max(1, Math.floor(size.width * rtScale));
    const safeHeight = Math.max(1, Math.floor(size.height * rtScale));
    spaceRT.setSize(safeWidth, safeHeight);
    distortionRT.setSize(Math.floor(size.width * 0.5), Math.floor(size.height * 0.5));
    spaceCamera.aspect = size.width / size.height;
    spaceCamera.updateProjectionMatrix();
    particleMaterial.uniforms.uViewHeight.value = size.height;
    starsMaterial.uniforms.uViewHeight.value = size.height;
    finalMaterial.uniforms.uResolution.value.set(size.width, size.height);
  }, [size, rtScale, spaceRT, distortionRT, spaceCamera, particleMaterial, starsMaterial]);

  useEffect(() => {
    return () => {
      spaceRT.dispose();
      distortionRT.dispose();
      noiseTexture.dispose();
      discMaterial.dispose();
      particleMaterial.dispose();
      starsMaterial.dispose();
      distortionActiveMaterial.dispose();
      distortionMaskMaterial.dispose();
      finalMaterial.dispose();
    };
  }, [
    spaceRT,
    distortionRT,
    noiseTexture,
    discMaterial,
    particleMaterial,
    starsMaterial,
    distortionActiveMaterial,
    distortionMaskMaterial,
    finalMaterial,
  ]);

  useFrame((state) => {
    if (reducedMotion) {
      return;
    }

    const elapsed = state.clock.elapsedTime;

    discMaterial.uniforms.uTime.value = elapsed;
    particleMaterial.uniforms.uTime.value = elapsed + 9999;

    if (distortionActiveMeshRef.current) {
      distortionActiveMeshRef.current.lookAt(spaceCamera.position);
    }

    const bhWorldPos = blackHoleWorldPosRef.current;
    bhWorldPos.set(0, 0, 0);
    bhWorldPos.project(spaceCamera);
    const bhScreenX = bhWorldPos.x * 0.5 + 0.5;
    const bhScreenY = bhWorldPos.y * 0.5 + 0.5;
    finalMaterial.uniforms.uBlackHolePosition.value.set(bhScreenX, bhScreenY);

    const cursor = cursorStateRef.current;
    finalMaterial.uniforms.uCursorPosition.value.set(cursor.x, cursor.y);
    finalMaterial.uniforms.uCursorStrength.value = cursor.active ? (isMedium ? 0.12 : 0.16) : 0;
    finalMaterial.uniforms.uCursorRadius.value = isMedium ? 0.085 : 0.075;

    gl.setRenderTarget(spaceRT);
    gl.render(spaceScene, spaceCamera);

    gl.setRenderTarget(distortionRT);
    gl.render(distortionScene, spaceCamera);

    gl.setRenderTarget(null);
    gl.render(finalScene, camera);
  }, 1);

  return null;
}
