/**
 * Gargantua GLSL — port fiel do raymarcher Schwarzschild
 * (PORTFOLIO/gargantua.html) para três passes ShaderMaterial/GLSL3.
 *
 * Pipeline:
 *   Pass 1: raymarch (geodésicas nulas + disco Novikov-Thorne) → HDR RT
 *   Passes 2-6: bright-pass + blur separável em ½ e ¼ de resolução
 *   Pass 7: composite — scene + bloom mips → ACES + vignette + grain
 *
 * Adaptações vs. o standalone: sem #version (three injeta), saída via
 * `out vec4 outColor` explícito (GLSL3), câmera é alimentada por
 * uniforms calculadas no useFrame (sem input próprio — o canvas fica
 * atrás do conteúdo; parallax sutil vem do cursor via cursorStateRef).
 */

// ─── Fullscreen quad vertex (compartilhado) ───
export const gargantuaQuadVertexShader = /* glsl */ `
  out vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// ─── Pass 1: raymarch (Schwarzschild, r_s = 1) ───
export const gargantuaRaymarchFragmentShader = /* glsl */ `
precision highp float;

out vec4 outColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCamPos;
uniform vec3  uRight;
uniform vec3  uUp;
uniform vec3  uFwd;
uniform float uFov;
uniform float uSpin;
uniform float uExpo;
uniform int   uSteps;

const float DIN    = 3.0;    // disk inner edge (Schwarzschild ISCO)
const float DOUT   = 15.0;   // disk outer edge
const float ESCAPE = 26.0;

float hash13(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  float d = p3.x * (p3.y + 33.33) + p3.y * (p3.z + 33.33) + p3.z * (p3.x + 33.33);
  return fract((p3.x + d) * (p3.y + d) * (p3.z + d));
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i),                 hash13(i + vec3(1,0,0)), u.x),
        mix(hash13(i + vec3(0,1,0)),   hash13(i + vec3(1,1,0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0,0,1)),   hash13(i + vec3(1,0,1)), u.x),
        mix(hash13(i + vec3(0,1,1)),   hash13(i + vec3(1,1,1)), u.x), u.y),
    u.z);
}

float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < oct; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

vec3 kelvin(float k) {
  k = clamp(k, 1000.0, 40000.0) / 100.0;
  float r = k <= 66.0 ? 1.0 : clamp(1.2929 * pow(k - 60.0, -0.1332), 0.0, 1.0);
  float g = k <= 66.0 ? clamp(0.3901 * log(k) - 0.6316, 0.0, 1.0)
                      : clamp(1.1299 * pow(k - 60.0, -0.0755), 0.0, 1.0);
  float b = k >= 66.0 ? 1.0 : (k <= 19.0 ? 0.0 : clamp(0.5432 * log(k - 10.0) - 1.1962, 0.0, 1.0));
  return vec3(r, g, b);
}

vec3 background(vec3 d, bool withStars) {
  vec3 col = vec3(0.0);
  float bd = dot(d, vec3(0.28, 0.92, 0.26));
  float band = exp(-bd * bd * 14.0);
  float cl = fbm(d * 3.1 + vec3(7.0, 0.0, 0.0), 4);
  float lane = fbm(d * 6.0 + vec3(0.0, 3.0, 0.0), 3);
  float mw = band * (0.012 + 0.07 * cl) * (0.45 + 0.55 * lane);
  col += mw * vec3(0.75, 0.82, 1.0);
  if (!withStars) return col;

  const float scales[3] = float[3](30.0, 70.0, 160.0);
  const float sizes[3]  = float[3](0.018, 0.012, 0.008);
  const float gains[3]  = float[3](2.2, 1.7, 1.1);
  const float thr[3]    = float[3](0.986, 0.993, 0.996);
  for (int s = 0; s < 3; s++) {
    float R = scales[s];
    vec3 cell = floor(d * R);
    for (int ox = -1; ox < 2; ox++)
    for (int oy = -1; oy < 2; oy++)
    for (int oz = -1; oz < 2; oz++) {
      vec3 ic = cell + vec3(float(ox), float(oy), float(oz));
      float h1 = hash13(ic);
      if (h1 < thr[s]) continue;
      float h2 = hash13(ic + vec3(19.0, -7.0, 3.0));
      float h3 = hash13(ic + vec3(-5.0, 11.0, 23.0));
      vec3 sp = normalize((ic + 0.5 + (vec3(h1, h2, h3) - 0.5) * 0.85) / R);
      float dd = length(d - sp);
      float m = 1.0 - smoothstep(0.0, sizes[s], dd);
      if (m <= 0.0) continue;
      float br = gains[s] * (0.4 + 0.6 * h2) * m;
      vec3 sc = h3 < 0.3 ? vec3(0.75, 0.85, 1.30)
              : h3 < 0.8 ? vec3(1.15, 1.10, 1.05)
                         : vec3(1.30, 0.85, 0.55);
      col += br * sc;
    }
  }
  return col;
}

// disk emission at an equatorial-plane crossing; rgb = radiance, a = coverage
vec4 diskShade(vec2 cxz, vec3 vel) {
  float rr = length(cxz);
  vec2 tang = vec2(cxz.y, -cxz.x) / rr;                    // Keplerian flow direction
  float beta = min(sqrt(0.55 / (rr - 0.9)), 0.85);         // orbital speed (c = 1)
  vec3 n = -normalize(vel);                                // photon dir toward camera
  float dopp = tang.x * n.x + tang.y * n.z;
  float gamma = inversesqrt(1.0 - beta * beta);
  float D = 1.0 / (gamma * (1.0 - beta * dopp));           // relativistic doppler
  float grav = sqrt(1.0 - 1.0 / rr);                       // gravitational redshift
  float shift = D * grav;

  // Novikov-Thorne flux profile: zero at r_in, peak at ~1.36 r_in, ~r^-3 tail
  float x = DIN / rr;
  float nt = x * x * x * max(0.0, 1.0 - sqrt(x)) / 0.0572;
  // faint plunging stream inside ISCO
  float plunge = 0.24 * (1.0 - smoothstep(DIN - 0.7, DIN, rr)) * smoothstep(1.45, 2.1, rr);
  float prof = rr >= DIN ? nt : plunge;

  // rigid swirl for the streak field (no windup) + Lagrangian knots at
  // local Keplerian rate (true differential motion, stable forever)
  float a = atan(cxz.y, cxz.x);
  float rot0 = uTime * uSpin * pow(DIN / 4.5, 1.5);
  float ar = a - rot0 + 3.6 * log(rr / DIN);
  // dual-speed streak field: inner layer ~3.5x faster than outer (each rigid,
  // so no windup) blended across r ~3.6-7.0 -> perceived differential rotation
  float arI = a - rot0 * 1.9 + 3.6 * log(rr / DIN);
  float arO = a - rot0 * 0.55 + 3.6 * log(rr / DIN);
  float nAi = fbm(vec3(cos(arI) * 4.2, sin(arI) * 4.2, log(rr) * 6.0 + uTime * 0.28), 4);
  float nAo = fbm(vec3(cos(arO) * 4.2, sin(arO) * 4.2, log(rr) * 6.0 + uTime * 0.28 + 7.0), 4);
  float nA = mix(nAi, nAo, smoothstep(3.6, 7.0, rr));
  float nB = fbm(vec3(cos(ar * 3.0) * 7.0, sin(ar * 3.0) * 7.0, log(rr) * 22.0 + 5.0 - uTime * 0.42), 3);
  float ac = a - rot0 + 1.8 * log(rr / DIN);
  float nC = fbm(vec3(cos(ac) * 4.2, sin(ac) * 4.2, log(rr) * 8.5 + 9.0 + uTime * 0.15), 3);
  float clump = smoothstep(0.36, 0.74, nC);
  float dens = clamp(0.48 + 1.05 * (nA - 0.5) + 0.60 * (nB - 0.5), 0.10, 1.6)
             * (0.36 + 0.64 * clump);
  // spiral density waves excited by MRI turbulence (same direction, different speeds)
  float w1 = sin(2.0 * a - 10.0 * log(rr / DIN) - rot0 * 0.55);
  float w2 = sin(3.0 * a - 13.0 * log(rr / DIN) - rot0 * 0.30 + 2.1);
  float arms = 0.62 + 0.30 * w1 * smoothstep(3.2, 4.5, rr)
                    + 0.18 * w2 * smoothstep(4.5, 6.5, rr);
  float kn = 0.0;
  for (int i = 0; i < 150; i++) {
    float fi = float(i);
    float h1 = hash13(vec3(fi, 7.0, 1.0));
    float h2 = hash13(vec3(fi, 3.0, 9.0));
    float h3 = hash13(vec3(fi, 5.0, 4.0));
    float rk = DIN * 1.02 + h1 * (DOUT - DIN * 1.02);
    float ak = h2 * 6.2831853 + uTime * uSpin * pow(DIN / rk, 1.5) * (0.75 + 0.5 * h3);
    float da = mod(a - ak, 6.2831853);
    if (da > 3.14159265) da -= 6.2831853; else if (da < -3.14159265) da += 6.2831853;
    float dtan = da * rr;
    float dln = log(rr / rk);
    kn += (0.3 + 1.2 * h3) * exp(-dtan * dtan * (0.02 + 0.05 * h3) - dln * dln * 160.0);
  }
  dens += min(kn, 1.3) * 0.75;

  float inner = rr >= DIN ? smoothstep(DIN, DIN + 0.06, rr)
              : (1.0 - smoothstep(DIN - 0.7, DIN, rr)) * smoothstep(1.55, 2.0, rr);
  float outer = 1.0 - smoothstep(4.5, 14.0, rr);
  float rim = (rr - 3.35) / 0.7;
  float rimG = exp(-rim * rim);
  float flux = prof * pow(DIN / rr, 0.9) * inner * outer * max(arms, 0.05) * dens * dens
             * (1.0 + 1.6 * rimG);
  float alpha = clamp(dens * (0.50 + 0.95 * prof) * inner * outer
             + 0.50 * inner * outer
             + min(kn, 1.2) * 0.22 * inner * outer
             + 0.30 * rimG, 0.0, 0.98);

  float tobs = clamp(pow(max(prof, 0.001), 0.25) * shift, 0.10, 3.8);
  vec3 kb = kelvin(1600.0 + tobs * 5800.0) * vec3(1.05, 0.92, 0.72);

  float I = flux * pow(shift, 4.0) * 0.9;
  return vec4(kb * I, alpha);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 ndc = (uv * 2.0 - 1.0) * vec2(uRes.x / uRes.y, 1.0) * uFov;
  vec3 dir = normalize(uFwd + uRight * ndc.x + uUp * ndc.y);

  // null-geodesic march in Schwarzschild (r_s = 1, photon sphere r = 1.5)
  vec3 p = uCamPos;
  vec3 v = dir;
  vec3 hv = cross(p, v);
  float h2 = dot(hv, hv);                                  // |L|^2, conserved

  vec3 col = vec3(0.0);
  float trans = 1.0;
  float rmin = 1e9;
  int ncross = 0;
  bool captured = false;
  bool escaped = false;

  float r = length(p);
  for (int i = 0; i < 640; i++) {
    if (i >= uSteps) break;
    if (r < 1.0) { captured = true; break; }
    if (r > ESCAPE && dot(p, v) > 0.0) { escaped = true; break; }
    rmin = min(rmin, r);

    float r2 = r * r;
    float accMag = 1.5 * h2 / (r2 * r2);                   // -3M L^2 / r^4 (r_s = 1)
    float dt = min(min(0.07 / max(accMag, 1e-5), max(0.02, 0.18 * r)), 1.0);
    v += p * (-accMag / r) * dt;
    vec3 np = p + v * dt;

    if (p.y * np.y < 0.0 && trans > 0.01 && ncross < 4) {  // equatorial-plane crossing
      float t = p.y / (p.y - np.y);
      vec3 x = mix(p, np, t);
      float rr = length(x.xz);
      if (rr >= 1.45 && rr <= DOUT) {
        vec4 ds = diskShade(x.xz, v);
        col += trans * ds.rgb;
        trans *= 1.0 - ds.a;
        ncross++;
      }
    }
    p = np;
    r = length(p);
  }

  if (!captured) {
    vec3 bgd = normalize(v);
    // near the photon sphere the sky is squeezed into sub-pixel features:
    // fade point stars out so the ring region reads as smooth lensed glow
    float smear = smoothstep(1.8, 7.0, rmin);
    vec3 bg;
    if (smear >= 1.0) bg = background(bgd, true);
    else if (smear <= 0.0) bg = background(bgd, false);
    else bg = mix(background(bgd, false), background(bgd, true), smear);
    col += trans * bg;
  }
  float ring = exp(-abs(rmin - 1.5) * 14.0) * 0.30;        // photon-ring sheen
  col += ring * vec3(1.0, 0.72, 0.42) * trans;

  outColor = vec4(col * uExpo, 1.0);                   // linear HDR out
}
`;

// ─── Passes 2-6: bright-pass + separable gaussian (linear-space HDR) ───
export const gargantuaBlurFragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDir;
uniform vec2 uSrcTexel;
uniform float uThresh;
uniform float uKnee;
in vec2 vUv;
out vec4 outColor;

void main() {
  vec2 o1 = uDir * uSrcTexel * 1.3846;
  vec2 o2 = uDir * uSrcTexel * 3.2308;
  vec3 c = texture(uTex, vUv).rgb * 0.227027
         + (texture(uTex, vUv + o1).rgb + texture(uTex, vUv - o1).rgb) * 0.316216
         + (texture(uTex, vUv + o2).rgb + texture(uTex, vUv - o2).rgb) * 0.070270;
  if (uThresh > 0.0) {
    float br = max(c.r, max(c.g, c.b));
    float soft = clamp(br - uThresh + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee);
    c *= max(soft, br - uThresh) / max(br, 1e-4);
  }
  outColor = vec4(c, 1.0);
}
`;

// ─── Pass 7: scene + bloom mips -> tonemap -> gamma ───
export const gargantuaCompositeFragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uB1;
uniform sampler2D uB2;
uniform float uBloom;
uniform float uExpo;
uniform float uTime;
in vec2 vUv;
out vec4 outColor;

float hash13(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  float d = p3.x * (p3.y + 33.33) + p3.y * (p3.z + 33.33) + p3.z * (p3.x + 33.33);
  return fract((p3.x + d) * (p3.y + d) * (p3.z + d));
}
vec3 aces(vec3 c) {
  return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec3 c = texture(uScene, vUv).rgb
         + texture(uB1, vUv).rgb * (0.85 * uBloom)
         + texture(uB2, vUv).rgb * (1.0 * uBloom);
  vec2 nc = vUv - 0.5;
  float vig = 1.0 - 0.35 * dot(nc, nc) * 1.6;
  vec3 cc = aces(c * uExpo * vig);
  float L = dot(cc, vec3(0.3, 0.59, 0.11));
  cc = clamp(L + (cc - L) * 1.30, 0.0, 1.0);
  float g = hash13(vec3(gl_FragCoord.xy, fract(uTime) * 977.0)) - 0.5;
  cc += g * (0.0015 + 0.010 * max(L, 0.0));
  outColor = vec4(pow(cc, vec3(1.0 / 2.2)), 1.0);
}
`;
