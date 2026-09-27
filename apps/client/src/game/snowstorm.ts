import type { MapId } from '@ice-water/shared';
import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Scene,
} from 'three';

/** Remaining-time thresholds. They do not alter the authoritative match clock. */
export const STORM_WARNING_START_MS = 240_000;
export const STORM_WARNING_DURATION_MS = 3_500;
export const SNOWFALL_START_MS = STORM_WARNING_START_MS;
export const STORM_BEGUN_MESSAGE_MS = 236_500;
export const STORM_BEGUN_DURATION_MS = 3_000;
export const STORM_MID_MS = 120_000;
export const STORM_HEAVY_MS = 60_000;
export const STORM_MAX_MS = 10_000;

const FROSTLINE_EXTENT = { radius: 66, ground: 132, groundY: 0.026 } as const;
const PARTICLE_COUNTS = { high: 5_200, medium: 3_000, low: 1_300 } as const;
type Quality = keyof typeof PARTICLE_COUNTS;

export interface SnowstormFrame {
  readonly intensity: number;
  readonly accumulation: number;
  readonly gust: number;
  readonly wind: number;
  readonly fogNear: number;
  readonly fogFar: number;
  readonly lightScale: number;
  readonly exposure: number;
  readonly cameraPitch: number;
  readonly cameraYaw: number;
  readonly cameraRoll: number;
}

export const CLEAR_STORM_FRAME: SnowstormFrame = {
  intensity: 0,
  accumulation: 0,
  gust: 0,
  wind: 0,
  fogNear: 150,
  fogFar: 300,
  lightScale: 1,
  exposure: 1,
  cameraPitch: 0,
  cameraYaw: 0,
  cameraRoll: 0,
};

export function isSnowstormWarningVisible(
  remainingMs: number,
  mapId: MapId = 'frostline',
): boolean {
  if (mapId !== 'frostline') return false;
  return (
    remainingMs <= STORM_WARNING_START_MS &&
    remainingMs > STORM_WARNING_START_MS - STORM_WARNING_DURATION_MS
  );
}

export function isSnowstormBegunVisible(remainingMs: number, mapId: MapId = 'frostline'): boolean {
  if (mapId !== 'frostline') return false;
  return (
    remainingMs <= STORM_BEGUN_MESSAGE_MS &&
    remainingMs > STORM_BEGUN_MESSAGE_MS - STORM_BEGUN_DURATION_MS
  );
}

/** Smoothly advances from warning snow at 4:00 to a playable whiteout at 0:10. */
export function snowstormIntensity(remainingMs: number, mapId: MapId = 'frostline'): number {
  if (mapId !== 'frostline' || remainingMs > SNOWFALL_START_MS) return 0;
  if (remainingMs <= STORM_MAX_MS) return 1;
  if (remainingMs > STORM_MID_MS) {
    const t = smoothstep((SNOWFALL_START_MS - remainingMs) / (SNOWFALL_START_MS - STORM_MID_MS));
    return mix(0.045, 0.36, t);
  }
  if (remainingMs > STORM_HEAVY_MS) {
    const t = smoothstep((STORM_MID_MS - remainingMs) / (STORM_MID_MS - STORM_HEAVY_MS));
    return mix(0.36, 0.72, t);
  }
  const t = smoothstep((STORM_HEAVY_MS - remainingMs) / (STORM_HEAVY_MS - STORM_MAX_MS));
  return mix(0.72, 1, t);
}

export function snowAccumulation(remainingMs: number, mapId: MapId = 'frostline'): number {
  if (mapId !== 'frostline' || remainingMs >= SNOWFALL_START_MS) return 0;
  if (remainingMs <= STORM_MAX_MS) return 1;
  if (remainingMs > STORM_MID_MS) {
    const t = smoothstep((SNOWFALL_START_MS - remainingMs) / (SNOWFALL_START_MS - STORM_MID_MS));
    return mix(0, 0.18, t);
  }
  if (remainingMs > STORM_HEAVY_MS) {
    const t = smoothstep((STORM_MID_MS - remainingMs) / (STORM_MID_MS - STORM_HEAVY_MS));
    return mix(0.18, 0.58, t);
  }
  const t = smoothstep((STORM_HEAVY_MS - remainingMs) / (STORM_HEAVY_MS - STORM_MAX_MS));
  return mix(0.58, 1, t);
}

/** Deterministic, irregular 2-4 second gusts keep every client visually stable. */
export function stormGustStrength(remainingMs: number, mapId: MapId = 'frostline'): number {
  const intensity = snowstormIntensity(remainingMs, mapId);
  if (intensity < 0.12) return 0;
  const ageSeconds = Math.max(0, (SNOWFALL_START_MS - remainingMs) / 1_000);
  const cycle = Math.floor(ageSeconds / 13);
  const local = ageSeconds - cycle * 13;
  const start = 2.4 + hash01(cycle + 17) * 4.2;
  const duration = 2.2 + hash01(cycle + 73) * 1.8;
  if (local <= start || local >= start + duration) return 0;
  const phase = (local - start) / duration;
  return Math.sin(phase * Math.PI) ** 1.35 * mix(0.52, 1, intensity);
}

export function snowstormFrame(
  remainingMs: number,
  elapsedSeconds: number,
  mapId: MapId = 'frostline',
): SnowstormFrame {
  const intensity = snowstormIntensity(remainingMs, mapId);
  if (intensity <= 0) return CLEAR_STORM_FRAME;
  const accumulation = snowAccumulation(remainingMs, mapId);
  const gust = stormGustStrength(remainingMs, mapId);
  const sway = intensity * (0.18 + gust * 0.82);
  return {
    intensity,
    accumulation,
    gust,
    wind: clamp01(0.12 + intensity * 0.76 + gust * 0.34),
    fogNear: mix(148, 8, intensity ** 1.35),
    fogFar: mix(298, 46, intensity ** 1.18) - gust * 9,
    lightScale: Math.max(0.4, 1 - intensity * 0.5 - gust * 0.06),
    exposure: Math.max(0.76, 1 - intensity * 0.18 - gust * 0.035),
    cameraPitch: Math.sin(elapsedSeconds * 2.3) * 0.00065 * sway,
    cameraYaw: Math.sin(elapsedSeconds * 1.7 + 1.3) * 0.0009 * sway,
    cameraRoll: Math.sin(elapsedSeconds * 1.15 + 0.4) * 0.0016 * sway,
  };
}

/**
 * Camera-local storm volume. One draw call contains distant flakes, mid-field
 * snow, occasional near-camera flakes and ankle-height spindrift.
 */
export class Snowstorm {
  readonly group = new Group();
  private readonly snowParticles: Points<BufferGeometry, ShaderMaterial>;
  private readonly groundSnow: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly particleMaterial: ShaderMaterial;
  private readonly groundMaterial: ShaderMaterial;
  private readonly maxParticles: number;

  constructor(
    scene: Scene,
    private readonly mapId: MapId = 'frostline',
    quality: Quality = 'high',
  ) {
    this.maxParticles = PARTICLE_COUNTS[quality];
    const positions = new Float32Array(this.maxParticles * 3);
    const seeds = new Float32Array(this.maxParticles * 4);
    for (let index = 0; index < this.maxParticles; index += 1) {
      const band = index % 100;
      const layer = band < 50 ? 0 : band < 82 ? 1 : band < 93 ? 2 : 3;
      const radius = layer === 2 ? 18 : layer === 3 ? 34 : FROSTLINE_EXTENT.radius;
      positions[index * 3] = (Math.random() * 2 - 1) * radius;
      positions[index * 3 + 1] = layer === 3 ? Math.random() * 2.2 : Math.random() * 52;
      positions[index * 3 + 2] = (Math.random() * 2 - 1) * radius;
      seeds[index * 4] = Math.random() * Math.PI * 2;
      seeds[index * 4 + 1] = 0.65 + Math.random() * 0.9;
      seeds[index * 4 + 2] = layer;
      seeds[index * 4 + 3] = Math.random();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('seed', new Float32BufferAttribute(seeds, 4));
    geometry.boundingSphere = null;

    this.particleMaterial = createParticleMaterial();
    this.snowParticles = new Points(geometry, this.particleMaterial);
    this.snowParticles.name = 'snowstorm-layered-particles';
    this.snowParticles.frustumCulled = false;
    this.snowParticles.renderOrder = 100;
    this.group.add(this.snowParticles);

    const groundGeometry = new PlaneGeometry(FROSTLINE_EXTENT.ground, FROSTLINE_EXTENT.ground);
    groundGeometry.rotateX(-Math.PI / 2);
    this.groundMaterial = createGroundMaterial();
    this.groundSnow = new Mesh(groundGeometry, this.groundMaterial);
    this.groundSnow.name = 'snowstorm-ground-drift';
    this.groundSnow.position.y = FROSTLINE_EXTENT.groundY;
    this.groundSnow.renderOrder = 2;
    this.group.add(this.groundSnow);

    this.group.name = 'SNOWSTORM';
    this.group.visible = false;
    scene.add(this.group);
  }

  update(elapsedSeconds: number, remainingMs: number, cameraPosition: Vector3): SnowstormFrame {
    const frame = snowstormFrame(remainingMs, elapsedSeconds, this.mapId);
    this.group.visible = frame.intensity > 0;
    if (!this.group.visible) return frame;

    const particleUniforms = this.particleMaterial.uniforms;
    particleUniforms.uTime!.value = elapsedSeconds;
    particleUniforms.uIntensity!.value = frame.intensity;
    particleUniforms.uWind!.value = frame.wind;
    particleUniforms.uGust!.value = frame.gust;
    (particleUniforms.uCameraPos!.value as Vector3).copy(cameraPosition);
    const density = 0.12 + frame.intensity * 0.78 + frame.gust * 0.1;
    this.snowParticles.geometry.setDrawRange(0, Math.ceil(this.maxParticles * density));

    const groundUniforms = this.groundMaterial.uniforms;
    groundUniforms.uAccumulation!.value = frame.accumulation;
    groundUniforms.uIntensity!.value = frame.intensity;
    groundUniforms.uWind!.value = frame.wind;
    groundUniforms.uGust!.value = frame.gust;
    groundUniforms.uTime!.value = elapsedSeconds;
    this.groundSnow.position.set(cameraPosition.x, FROSTLINE_EXTENT.groundY, cameraPosition.z);
    return frame;
  }

  destroy(): void {
    this.snowParticles.geometry.dispose();
    this.particleMaterial.dispose();
    this.groundSnow.geometry.dispose();
    this.groundMaterial.dispose();
    this.group.removeFromParent();
  }
}

function createParticleMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    blending: AdditiveBlending,
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.fog!),
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uWind: { value: 0 },
      uGust: { value: 0 },
      uFallHeight: { value: 52 },
      uRadius: { value: FROSTLINE_EXTENT.radius },
      uCameraPos: { value: new Vector3() },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec4 seed;
      uniform float uTime, uIntensity, uWind, uGust, uFallHeight, uRadius;
      uniform vec3 uCameraPos;
      varying float vAlpha, vLayer, vGust;

      void main() {
        float layer = seed.z;
        float isNear = step(1.5, layer) * (1.0 - step(2.5, layer));
        float isGround = step(2.5, layer);
        float layerRadius = mix(uRadius, mix(18.0, 34.0, isGround), step(1.5, layer));
        float fallSpeed = seed.y * mix(2.1, 11.5, uIntensity) * mix(1.0, 1.65, isNear);
        float crossWind = mix(1.6, 15.0, uWind) + uGust * 16.0;

        vec3 p = position;
        if (isGround > 0.5) {
          p.x += uTime * crossWind * (0.8 + seed.y * 0.35);
          p.z += sin(uTime * 1.7 + seed.x) * (1.2 + uGust * 2.4);
          p.y = mod(p.y + sin(uTime * 2.1 + seed.x) * 0.45, 2.4);
        } else {
          p.y = mod(p.y - uTime * fallSpeed, uFallHeight);
          p.x += uTime * crossWind + sin(uTime * 0.8 + seed.x) * (1.0 + uIntensity * 2.2);
          p.z += cos(uTime * 0.53 + seed.x * 1.7) * (0.9 + uIntensity * 1.7);
          p.y += uCameraPos.y - uFallHeight * 0.32;
        }
        p.x = uCameraPos.x + mod(p.x - uCameraPos.x + layerRadius, layerRadius * 2.0) - layerRadius;
        p.z = uCameraPos.z + mod(p.z - uCameraPos.z + layerRadius, layerRadius * 2.0) - layerRadius;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float distance = max(1.0, -mvPosition.z);
        float layerSize = layer < 0.5 ? 1.4 : layer < 1.5 ? 3.0 : layer < 2.5 ? 8.5 : 4.4;
        float size = layerSize * mix(0.75, 1.45, uIntensity) * mix(1.0, 1.6, uGust);
        gl_PointSize = clamp(size * 300.0 / distance, 1.0, isNear > 0.5 ? 34.0 : 16.0);

        float distFade = smoothstep(layerRadius, layerRadius * 0.62, length(p.xz - uCameraPos.xz));
        float heightFade = isGround > 0.5 ? 1.0 :
          smoothstep(0.0, 3.5, p.y - uCameraPos.y + uFallHeight * 0.32) *
          smoothstep(0.0, 4.5, uFallHeight - p.y + uCameraPos.y - uFallHeight * 0.32);
        float layerAlpha = layer < 0.5 ? 0.34 : layer < 1.5 ? 0.58 : layer < 2.5 ? 0.68 : 0.42;
        vAlpha = mix(0.28, 1.0, uIntensity) * layerAlpha * distFade * heightFade;
        vLayer = layer;
        vGust = uGust;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      varying float vAlpha, vLayer, vGust;
      void main() {
        vec2 centered = gl_PointCoord - vec2(0.5);
        float streak = mix(1.0, 2.6, vGust) * (vLayer > 1.5 ? 1.45 : 1.0);
        float radius = length(vec2(centered.x / streak, centered.y * streak)) * 2.0;
        float soft = 1.0 - smoothstep(0.18, 1.0, radius);
        float alpha = soft * vAlpha;
        if (alpha < 0.004) discard;
        vec3 snow = mix(vec3(0.69, 0.79, 0.87), vec3(0.95, 0.98, 1.0), soft);
        gl_FragColor = vec4(snow, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

function createGroundMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: true,
    blending: NormalBlending,
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.fog!),
      uAccumulation: { value: 0 },
      uIntensity: { value: 0 },
      uWind: { value: 0 },
      uGust: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uAccumulation, uIntensity, uWind, uGust, uTime;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
      }
      void main() {
        vec2 windUv = vUv * vec2(18.0, 72.0) + vec2(uTime * (0.15 + uWind * 0.9), 0.0);
        float ribbons = smoothstep(0.56, 0.88, noise(windUv) * 0.72 + noise(windUv * 0.31) * 0.42);
        float drifts = smoothstep(0.5, 0.9, noise(vUv * 42.0));
        float radial = smoothstep(0.72, 0.18, length(vUv - vec2(0.5)));
        float accumulationAlpha = drifts * uAccumulation * 0.28;
        float blowingAlpha = ribbons * radial * (0.025 + uIntensity * 0.16 + uGust * 0.19);
        float alpha = accumulationAlpha + blowingAlpha;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(vec3(0.84, 0.9, 0.95), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

function hash01(value: number): number {
  const raw = Math.sin(value * 12.9898) * 43_758.5453;
  return raw - Math.floor(raw);
}

function mix(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number): number {
  const progress = clamp01(value);
  return progress * progress * (3 - 2 * progress);
}
