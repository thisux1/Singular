/**
 * Blackhole GLSL shaders — faithful port of the prototype.
 *
 * Architecture (multi-pass):
 *   Pass 1: Render "space" scene (disc + particles + stars) → RenderTarget
 *   Pass 2: Render "distortion" maps (radial gradients) → RenderTarget
 *   Pass 3: Final composition — UV displacement of Pass 1 using Pass 2 + RGB shift
 *
 * The gravitational lensing is NOT a mesh — it's a post-processing UV displacement.
 * The event horizon is just the center of the distortion map being pulled inward.
 *
 * Primary colors shifted from purple to RED:
 *   Original: inner=#ff8080, outer=#3633ff
 *   New:      inner=#ff9060, outer=#cc1111
 */

// ─── Accretion Disc Vertex Shader ───
// Uses a CylinderGeometry (open-ended tube). The fragment shader
// tiles noise texture with time-scrolling UVs and blends 3 ring layers.

export const discVertexShader = /* glsl */ `
  varying vec2 vUv;
  
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vUv = uv;
  }
`;

export const discFragmentShader = /* glsl */ `
  precision highp float;
  
  uniform float uTime;
  uniform sampler2D uNoiseTexture;
  uniform vec3 uInnerColor;
  uniform vec3 uOuterColor;
  
  varying vec2 vUv;
  
  float inverseLerp(float v, float minValue, float maxValue) {
    return (v - minValue) / (maxValue - minValue);
  }
  
  float remap(float v, float inMin, float inMax, float outMin, float outMax) {
    float t = inverseLerp(v, inMin, inMax);
    return mix(outMin, outMax, t);
  }
  
  vec3 blendAdd(vec3 base, vec3 blend) {
    return min(base + blend, vec3(1.0));
  }
  
  // Blackbody radiation ramp
  vec3 blackbodyColor(float t) {
    vec3 white    = vec3(1.0, 0.98, 0.95);
    vec3 yellow   = vec3(1.0, 0.85, 0.4);
    vec3 orange   = vec3(1.0, 0.45, 0.1);
    vec3 red      = vec3(0.7, 0.1, 0.03);
    vec3 darkRed  = vec3(0.2, 0.02, 0.01);
    
    vec3 col;
    if (t < 0.15) {
      col = mix(white, yellow, t / 0.15);
    } else if (t < 0.35) {
      col = mix(yellow, orange, (t - 0.15) / 0.2);
    } else if (t < 0.6) {
      col = mix(orange, red, (t - 0.35) / 0.25);
    } else {
      col = mix(red, darkRed, (t - 0.6) / 0.4);
    }
    return col;
  }
  
  void main() {
    vec4 color = vec4(0.0);
    color.a = 1.0;
    
    // vUv.x = angle around disc (0-1, repeating)
    // vUv.y = radial distance (0 = inner edge, 1 = outer edge)
    float radial = vUv.y; // 0=inner, 1=outer
    
    // === FLUID DYNAMICS: multiple noise layers with differential rotation ===
    // Inner regions rotate faster than outer (Keplerian: v ~ r^-0.5)
    // This creates shearing that produces the organic spiral-arm gaps.
    
    float iterations = 3.0; // The prototype used 3 thick interlocking layers
    
    // === ANGULAR DENSITY MODULATION ===
    // Create large-scale crescent/half-moon shapes that orbit at Keplerian speeds.
    // These break the perfect rotational symmetry of the rings.
    // Multiple overlapping spiral arms at different angular frequencies.
    float angularPos = vUv.x * 6.28318; // convert 0-1 to radians
    
    // Keplerian angular velocity: inner orbits faster (v ~ r^-1.5 in angle/time)
    // Wrap time to prevent infinite spiral winding that creates ripples
    float wrapPeriod = 6.28318; // one full rotation cycle
    float wrappedTime = mod(uTime * 0.3, wrapPeriod); // slow base speed, cycles every ~21s
    float keplerianAngle = angularPos + wrappedTime * (1.0 - radial * 0.7) * 2.0;
    
    // Crescent density waves — high frequency for many micro-gaps, not one giant gap
    float arm1 = sin(keplerianAngle * 3.0) * 0.5 + 0.5;
    float arm2 = sin(keplerianAngle * 5.0 + 2.1) * 0.5 + 0.5;
    float arm3 = sin(keplerianAngle * 7.0 + 4.7) * 0.5 + 0.5;
    
    // Combine: creates many subtle brightness variations around circumference
    float angularDensity = arm1 * 0.4 + arm2 * 0.35 + arm3 * 0.25;
    // Range 0.55 to 1.0: subtle variation, particles always visible, never a full gap
    angularDensity = mix(0.55, 1.0, angularDensity);
    
    for (float i = 0.0; i < iterations; i++) {
      float layerProgress = i / (iterations - 1.0);
      
      // Vertical ring placement
      float intensity = 1.0 - ((radial - layerProgress) * iterations) * 0.5;
      intensity = smoothstep(0.0, 1.0, intensity);
      
      vec2 uv = vUv;
      uv.y *= 2.0; 
      // Differential rotation per layer — matched to particle orbit direction
      // Inner layers (i=0) scroll fastest, outer layers (i=2) slowest
      uv.x += uTime / ((i * 5.0) + 1.0);
      
      // Blackbody color for this specific ring
      vec3 ringColor = blackbodyColor(layerProgress);
      
      // Sample noise directly, using the R, G, B channels as different octaves/layers
      float noiseVal;
      if (i == 0.0) noiseVal = texture2D(uNoiseTexture, uv).r;
      else if (i == 1.0) noiseVal = texture2D(uNoiseTexture, uv).g;
      else noiseVal = texture2D(uNoiseTexture, uv).b;
      
      // Apply BOTH the noise texture AND the angular density modulation
      // This makes rings incomplete — bright crescents on one side, dim on the other
      ringColor = mix(vec3(0.0), ringColor * 3.0, noiseVal * intensity * angularDensity);
      
      color.rgb = blendAdd(color.rgb, ringColor);
    }
    
    // === HOT SPOTS: random bright white zones near inner ring ===
    // These are turbulent heating events — dynamic and moving
    float hotSpotNoise1 = texture2D(uNoiseTexture, vec2(
      vUv.x * 6.0 + uTime * 0.8,
      vUv.y * 4.0 + uTime * 0.1
    )).r;
    float hotSpotNoise2 = texture2D(uNoiseTexture, vec2(
      vUv.x * 10.0 - uTime * 0.6 + 3.14,
      vUv.y * 3.0 + uTime * 0.15 + 1.5
    )).g;
    
    // Hot spots only appear near inner region (radial < 0.4)
    float hotSpotMask = smoothstep(0.4, 0.0, radial);
    // Multiply hot spots dramatically so they add bright irregular chunks instead of uniform rings
    float hotSpot = pow(hotSpotNoise1, 3.0) * pow(hotSpotNoise2, 2.0) * hotSpotMask * 3.5;
    
    // Hot spots are white/yellow (very hot plasma)
    vec3 hotColor = mix(vec3(1.0, 0.9, 0.5), vec3(1.0, 1.0, 0.95), hotSpot);
    color.rgb += hotColor * hotSpot;
    
    // === RING BANDING: sinusoidal modulation for distinct ring structure ===
    float ringBand = sin(radial * 18.0) * 0.2 + 0.8;
    ringBand *= sin(radial * 37.0 + 1.0) * 0.1 + 0.9;
    color.rgb *= ringBand;
    
    // === EDGE ATTENUATION ===
    float edgesAttenuation = min(
      inverseLerp(radial, 0.0, 0.02),
      inverseLerp(radial, 1.0, 0.35)
    );
    
    // Extra brightness boost near ISCO
    float innerGlow = smoothstep(0.12, 0.0, radial) * 0.35;
    
    color.rgb = mix(vec3(0.0), color.rgb, edgesAttenuation);
    
    // Entropy from the particle system and disc plasma provides natural brightness.
    // The disc is hot enough on its own without painting a solid white radial circle over it.
    
    gl_FragColor = color;
  }
`;

// ─── Orbiting Particles Vertex Shader ───
// 50,000 points. Each particle has:
//   - `position` (float 0-1) = random seed for radial placement
//   - `aSize` (float) = random size
//   - `aRandom` (float) = random factor for orbit distribution
// Inner particles orbit faster (1 - outerProgress) * speed.

export const particleVertexShader = /* glsl */ `
  #define PI 3.1415926538
  
  uniform float uTime;
  uniform sampler2D uNoiseTexture;
  uniform vec3 uInnerColor;
  uniform vec3 uOuterColor;
  uniform float uViewHeight;
  uniform float uSize;
  
  attribute float aSize;
  attribute float aRandom;
  attribute float aAngleOffset;
  
  varying vec3 vColor;
  
  // Blackbody radiation: inner particles are white-hot, outer are deep red
  vec3 blackbodyParticle(float t) {
    vec3 white    = vec3(1.0, 0.97, 0.92);
    vec3 yellow   = vec3(1.0, 0.82, 0.35);
    vec3 orange   = vec3(1.0, 0.4, 0.08);
    vec3 red      = vec3(0.65, 0.08, 0.02);
    
    vec3 col;
    if (t < 0.2) {
      col = mix(white, yellow, t / 0.2);
    } else if (t < 0.5) {
      col = mix(yellow, orange, (t - 0.2) / 0.3);
    } else {
      col = mix(orange, red, (t - 0.5) / 0.5);
    }
    return col;
  }
  
  void main() {
    float concentration = 0.02;
    float outerProgress = smoothstep(0.0, 1.0, position.x);
    // Pow 2.5 concentrates more points towards 0 (the inner radius)
    outerProgress = mix(concentration, outerProgress, pow(aRandom, 2.5));
    float radius = 1.0 + outerProgress * 4.0;
    
    // Inner particles orbit faster. Base angle from time.
    float angle = outerProgress - uTime * (1.0 - outerProgress) * 3.0;
    
    // Fully random angular placement to eliminate artificial fixed trail lines
    angle += aAngleOffset;
    
    // Sample the fluid noise at this location (map angle and radius to a uv-like space)
    vec2 noiseUv = vec2(angle * 0.15 + uTime * 0.1, outerProgress * 2.0);
    float noiseVal = texture2D(uNoiseTexture, noiseUv).r;
    
    // Introduce fluid entropy to radius — subtle, not spiral-galaxy levels
    float radialChaos = (noiseVal - 0.5) * 2.0; 
    radius += radialChaos * 0.3 * (1.0 - outerProgress * 0.5);
    
    // Fluid turbulence for vertical position — subtle thickness
    float verticalChaos = texture2D(uNoiseTexture, noiseUv + vec2(0.5)).g;
    float verticalDisplacement = (verticalChaos - 0.5) * 0.15 * (1.0 - outerProgress);
    
    vec3 newPosition = vec3(
      sin(angle) * radius,
      verticalDisplacement, // 3D plasma volume thickness based on noise
      cos(angle) * radius
    );
    vec4 modelViewPosition = modelViewMatrix * vec4(newPosition, 1.0);
    gl_Position = projectionMatrix * modelViewPosition;
    
    // pow(aSize, 0.4) skews the distribution so most particles are medium-large
    // with a few tiny ones, creating a grainy textured look
    float variedSize = pow(aSize, 0.4);
    gl_PointSize = variedSize * uSize * uViewHeight;
    gl_PointSize *= (1.0 / -modelViewPosition.z);
    
    // === ANGULAR DENSITY MODULATION (must match disc shader!) ===
    // Same spiral arm pattern so particles are dense where disc is bright
    float wrapPeriod = 6.28318;
    float wrappedTime = mod(uTime * 0.3, wrapPeriod);
    float keplerianAngle = angle + wrappedTime * (1.0 - outerProgress * 0.7) * 2.0;
    float arm1 = sin(keplerianAngle * 3.0) * 0.5 + 0.5;
    float arm2 = sin(keplerianAngle * 5.0 + 2.1) * 0.5 + 0.5;
    float arm3 = sin(keplerianAngle * 7.0 + 4.7) * 0.5 + 0.5;
    float angularDensity = arm1 * 0.4 + arm2 * 0.35 + arm3 * 0.25;
    angularDensity = mix(0.55, 1.0, angularDensity);
    
    // Modulate particle size by angular density (big in bright arcs, tiny in dim arcs)
    gl_PointSize *= angularDensity;
    
    // Physically-based blackbody color, with added entropy (aRandom) so colors aren't perfectly uniform at a given radius
    float tempProgress = clamp(outerProgress + (aRandom * 0.3 - 0.15), 0.0, 1.0);
    vColor = blackbodyParticle(tempProgress) * angularDensity;
  }
`;

export const particleFragmentShader = /* glsl */ `
  precision highp float;
  
  varying vec3 vColor;
  
  void main() {
    float distanceToCenter = length(gl_PointCoord - vec2(0.5));
    if (distanceToCenter > 0.5)
      discard;
      
    // Soft radial gradient for organic blending
    float alpha = smoothstep(0.5, 0.0, distanceToCenter) * 0.45;
    
    gl_FragColor = vec4(vColor, alpha);
  }
`;

// ─── Distortion Map: Active (spherical lens) ───
// Renders a radial gradient that encodes distortion strength.
// R channel = distortion intensity. Pure white at center, fading to 0.

export const distortionVertexShader = /* glsl */ `
  varying vec2 vUv;
  
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vUv = uv;
  }
`;

export const distortionActiveFragmentShader = /* glsl */ `
  precision highp float;
  
  varying vec2 vUv;
  
  float inverseLerp(float v, float minValue, float maxValue) {
    return (v - minValue) / (maxValue - minValue);
  }
  
  float remap(float v, float inMin, float inMax, float outMin, float outMax) {
    float t = inverseLerp(v, inMin, inMax);
    return mix(outMin, outMax, t);
  }
  
  void main() {
    float distanceToCenter = length(vUv - 0.5);
    float radialStrength = remap(distanceToCenter, 0.0, 0.15, 1.0, 0.0);
    radialStrength = smoothstep(0.0, 1.0, radialStrength);
    
    gl_FragColor = vec4(radialStrength, 1.0, 1.0, 1.0);
  }
`;

// ─── Distortion Map: Mask (disc shadow silhouette) ───
// Creates the shadow/silhouette of the accretion disc on the distortion map.
// R channel = distortion in disc plane, with alpha fade at edges.

export const distortionMaskFragmentShader = /* glsl */ `
  precision highp float;
  
  varying vec2 vUv;
  
  float inverseLerp(float v, float minValue, float maxValue) {
    return (v - minValue) / (maxValue - minValue);
  }
  
  float remap(float v, float inMin, float inMax, float outMin, float outMax) {
    float t = inverseLerp(v, inMin, inMax);
    return mix(outMin, outMax, t);
  }
  
  void main() {
    float distanceToCenter = length(vUv - 0.5);
    float radialStrength = remap(distanceToCenter, 0.0, 0.15, 1.0, 0.0);
    radialStrength = smoothstep(0.0, 1.0, radialStrength);
    
    float alpha = smoothstep(0.0, 1.0, remap(distanceToCenter, 0.4, 0.5, 1.0, 0.0));
    
    gl_FragColor = vec4(radialStrength, 0.0, 0.0, alpha);
  }
`;

// ─── Final Composition Shader ───
// This is where the magic happens. Takes the space texture and distortion texture,
// and displaces UVs to create gravitational lensing. RGB chromatic aberration near center.

export const finalVertexShader = /* glsl */ `
  varying vec2 vUv;
  
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

export const finalFragmentShader = /* glsl */ `
  #define PI 3.1415926538
  
  precision highp float;
  
  varying vec2 vUv;
  
  uniform sampler2D uSpaceTexture;
  uniform sampler2D uDistortionTexture;
  uniform vec2 uBlackHolePosition;
  uniform vec2 uCursorPosition;
  uniform vec2 uResolution;
  uniform float uCursorStrength;
  uniform float uCursorRadius;
  uniform float uRGBShiftRadius;
  
  vec3 getRGBShiftedColor(sampler2D _texture, vec2 _uv, float _radius) {
    vec3 angle = vec3(
      PI * 2.0 / 3.0,
      PI * 4.0 / 3.0,
      0.0
    );
    vec3 color = vec3(0.0);
    color.r = texture2D(_texture, _uv + vec2(sin(angle.r) * _radius, cos(angle.r) * _radius)).r;
    color.g = texture2D(_texture, _uv + vec2(sin(angle.g) * _radius, cos(angle.g) * _radius)).g;
    color.b = texture2D(_texture, _uv + vec2(sin(angle.b) * _radius, cos(angle.b) * _radius)).b;
    
    return color;
  }
  
  void main() {
    vec4 distortionColor = texture2D(uDistortionTexture, vUv);
    float distortionIntensity = distortionColor.r;
    
    vec2 towardCenter = vUv - uBlackHolePosition;
    towardCenter *= -distortionIntensity * 2.0;

    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 cursorDelta = vUv - uCursorPosition;
    vec2 cursorDeltaAspect = vec2(cursorDelta.x * aspect, cursorDelta.y);
    float cursorDistance = max(length(cursorDeltaAspect), 0.0012);
    float safeRadius = max(uCursorRadius, 0.001);
    float localFalloff = exp(-pow(cursorDistance / safeRadius, 3.2));
    float lensStrength = (uCursorStrength * localFalloff) / (cursorDistance * 18.0 + 0.35);

    vec2 cursorDirectionAspect = -normalize(cursorDeltaAspect + vec2(0.0001));
    vec2 cursorWarpAspect = cursorDirectionAspect * lensStrength;
    vec2 cursorWarp = vec2(cursorWarpAspect.x / aspect, cursorWarpAspect.y);
    towardCenter += cursorWarp;

    vec2 distortedUv = vUv + towardCenter;
    vec3 outColor = getRGBShiftedColor(uSpaceTexture, distortedUv, uRGBShiftRadius);

    gl_FragColor = vec4(outColor, 1.0);
  }
`;

// ─── Background Stars Vertex Shader ───
// 50,000 points distributed on a sphere of radius 400.

export const starsVertexShader = /* glsl */ `
  uniform float uViewHeight;
  uniform float uSize;
  
  attribute float aSize;
  attribute vec3 aColor;
  
  varying vec3 vColor;
  
  void main() {
    vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewPosition;
    
    gl_PointSize = aSize * uSize * uViewHeight;
    
    vColor = aColor;
  }
`;

export const starsFragmentShader = /* glsl */ `
  precision highp float;
  
  varying vec3 vColor;
  
  void main() {
    float distanceToCenter = length(gl_PointCoord - vec2(0.5));
    if (distanceToCenter > 0.5)
      discard;
    
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

// ─── Noise generator shader ───
// Renders a Perlin noise texture that tiles seamlessly.
// Used as the noise lookup for the accretion disc.

export const noiseVertexShader = /* glsl */ `
  varying vec2 vUv;
  
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

// Simplified noise for the texture — we'll generate it on CPU instead
// to avoid needing GLSL 300 es in the noise generator
