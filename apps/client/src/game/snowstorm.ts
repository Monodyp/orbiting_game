import {
  Group,
  Points,
  BufferGeometry,
  Float32BufferAttribute,
  ShaderMaterial,
  AdditiveBlending,
  Mesh,
  PlaneGeometry,
  DoubleSide,
  type Scene,
  type Vector3,
  UniformsUtils,
  UniformsLib,
} from 'three';
import { GAMEPLAY, type MapId } from '@ice-water/shared';

/**
 * Snowstorm timing constants (all in milliseconds of remaining match time).
 * These detect when the existing timer reaches certain points — the round
 * duration itself is never modified.
 * The snowstorm mechanic is active only on Frostline.
 */
const SNOW_START_REMAINING_MS = 240_000;
export const STORM_MID_MS = 180_000; // 2:00 elapsed: Noticeably denser snowfall
export const STORM_HEAVY_MS = 120_000; // 3:00 elapsed: Heavy snowfall
export const STORM_MAX_MS = 60_000; // 4:00 elapsed: Maximum density; emission stops

const SNOW_EMISSION_STOP_ELAPSED_SECONDS =
  (GAMEPLAY.tdmTimeLimitMs - STORM_MAX_MS) / 1000;
const SNOW_START_ELAPSED_SECONDS =
  (GAMEPLAY.tdmTimeLimitMs - SNOW_START_REMAINING_MS) / 1000;

/** Frostline snowstorm radius and ground plane size. */
const FROSTLINE_EXTENT = { radius: 70, ground: 130, groundY: 0.02 } as const;

/**
 * Frostline snow visual ramp follows the authoritative round timer without a
 * separate timer. It starts at a gentle 20% at the 1:00 gameplay mark and
 * reaches full intensity by the 4:00 gameplay mark.
 */
export function snowstormIntensity(remainingMs: number, mapId: MapId = 'frostline'): number {
  if (mapId !== 'frostline') return 0;
  if (remainingMs > 240_000) return 0;
  if (remainingMs <= 60_000) return 1;

  const t = clamp01((240_000 - remainingMs) / 180_000);
  return 0.2 + 0.8 * t;
}

/**
 * Returns a 0–1 snow ground accumulation factor that matches the same visual ramp.
 */
export function snowAccumulation(remainingMs: number, mapId: MapId = 'frostline'): number {
  if (mapId !== 'frostline') return 0;
  if (remainingMs > 240_000) return 0;
  if (remainingMs <= 60_000) return 1;

  const t = clamp01((240_000 - remainingMs) / 180_000);
  return 0.2 + 0.8 * t;
}

/** Positive only while the timer-authoritative snow emitter is active. */
export function snowEmissionRate(
  remainingMs: number,
  mapId: MapId = 'frostline',
  hasSnowStarted = true,
): number {
  if (!hasSnowStarted || mapId !== 'frostline') return 0;
  if (remainingMs > SNOW_START_REMAINING_MS || remainingMs <= STORM_MAX_MS) return 0;
  return snowstormIntensity(remainingMs, mapId);
}

/** Elapsed fall time for flakes already in flight after emission stops. */
export function snowParticleFallElapsedSeconds(remainingMs: number): number {
  return Math.max(0, (STORM_MAX_MS - remainingMs) / 1000);
}

// ── Particle counts by quality ──
const PARTICLE_COUNTS = { high: 4000, medium: 2400, low: 1200 } as const;
type Quality = keyof typeof PARTICLE_COUNTS;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Performance-friendly snowstorm rendered with a single GPU particle system
 * (THREE.Points with a custom shader) and a translucent ground snow plane.
 * Exclusively active on Frostline.
 *
 * All snowflake positions are computed on the GPU via modular arithmetic so
 * the JS render loop does zero per-particle work. The ground snow plane uses
 * procedural multi-octave noise to simulate accumulation — no permanent objects are spawned.
 */
export class Snowstorm {
  readonly group = new Group();
  private readonly snowParticles: Points<BufferGeometry, ShaderMaterial>;
  private readonly groundSnow: Mesh;
  private readonly groundMaterial: ShaderMaterial;
  private readonly particleMaterial: ShaderMaterial;
  private readonly maxParticles: number;
  private currentIntensity = 0;
  private currentAccumulation = 0;
  private currentEmissionRate = 0;

  get emissionRate(): number {
    return this.currentEmissionRate;
  }

  constructor(
    scene: Scene,
    private readonly mapId: MapId = 'frostline',
    quality: Quality = 'high',
  ) {
    const extent = FROSTLINE_EXTENT;
    this.maxParticles = PARTICLE_COUNTS[quality];

    // ── GPU snow particles ──
    const positions = new Float32Array(this.maxParticles * 3);
    const seeds = new Float32Array(this.maxParticles * 2);
    for (let i = 0; i < this.maxParticles; i++) {
      const radius = extent.radius;
      positions[i * 3] = (Math.random() * 2 - 1) * radius;
      positions[i * 3 + 1] = Math.random() * 50;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * radius;
      seeds[i * 2] = Math.random() * Math.PI * 2;
      seeds[i * 2 + 1] = 0.6 + Math.random() * 0.8; // fall speed multiplier
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('seed', new Float32BufferAttribute(seeds, 2));
    geometry.boundingSphere = null; // disable frustum culling on these

    this.particleMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: AdditiveBlending,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog!),
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uMatchElapsedSeconds: { value: 0 },
        uEmissionRate: { value: 0 },
        uSnowStartElapsedSeconds: { value: SNOW_START_ELAPSED_SECONDS },
        uEmissionStopElapsedSeconds: { value: SNOW_EMISSION_STOP_ELAPSED_SECONDS },
        uSecondsAfterEmissionStop: { value: 0 },
        uFallHeight: { value: 50 },
        uRadius: { value: extent.radius },
        uCameraPos: { value: { x: 0, y: 0, z: 0 } },
      },
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        attribute vec2 seed;
        uniform float uTime, uIntensity, uMatchElapsedSeconds, uEmissionRate;
        uniform float uSnowStartElapsedSeconds, uEmissionStopElapsedSeconds;
        uniform float uSecondsAfterEmissionStop, uFallHeight, uRadius;
        uniform vec3 uCameraPos;
        varying float vAlpha;

        void main() {
          float fallSpeed = seed.y * (3.0 + uIntensity * 5.0);
          float drift = seed.x;

          // Emit continuously before the cutoff; afterward, let in-flight flakes fall out.
          vec3 p = position;
          if (uEmissionRate > 0.0 && uMatchElapsedSeconds < uEmissionStopElapsedSeconds) {
            float snowElapsed = max(0.0, uMatchElapsedSeconds - uSnowStartElapsedSeconds);
            p.y = mod(p.y - snowElapsed * fallSpeed, uFallHeight);
          } else {
            float fallBeforeStop = uEmissionStopElapsedSeconds - uSnowStartElapsedSeconds;
            float cutoffHeight = mod(p.y - fallBeforeStop * fallSpeed, uFallHeight);
            p.y = cutoffHeight - uSecondsAfterEmissionStop * fallSpeed;
          }
          p.x += sin(uTime * 0.5 + drift) * (1.5 + uIntensity * 2.0);
          p.z += cos(uTime * 0.37 + drift * 1.3) * (1.2 + uIntensity * 1.5);

          // Re-center around camera
          p.x = uCameraPos.x + mod(p.x - uCameraPos.x + uRadius, uRadius * 2.0) - uRadius;
          p.z = uCameraPos.z + mod(p.z - uCameraPos.z + uRadius, uRadius * 2.0) - uRadius;
          p.y += uCameraPos.y - uFallHeight * 0.3;

          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          float distance = -mvPosition.z;
          float baseSize = 2.2 + uIntensity * 3.5;
          gl_PointSize = clamp(baseSize * 350.0 / max(1.0, distance), 1.0, 18.0);

          // Fade at top/bottom of column + distance fade
          float heightFade = smoothstep(0.0, 3.0, p.y - uCameraPos.y + uFallHeight * 0.3)
                           * smoothstep(0.0, 4.0, uFallHeight - p.y + uCameraPos.y - uFallHeight * 0.3);
          float distFade = smoothstep(uRadius, uRadius * 0.6, length(p.xz - uCameraPos.xz));
          vAlpha = uIntensity * heightFade * distFade * (0.5 + uIntensity * 0.5);

          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        varying float vAlpha;

        void main() {
          float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
          float soft = 1.0 - smoothstep(0.0, 1.0, r);
          float alpha = soft * vAlpha;
          if (alpha < 0.003) discard;
          gl_FragColor = vec4(0.85, 0.9, 0.97, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    });

    this.snowParticles = new Points(geometry, this.particleMaterial);
    this.snowParticles.name = 'snowstorm-particles';
    this.snowParticles.frustumCulled = false;
    this.snowParticles.renderOrder = 100;
    this.group.add(this.snowParticles);

    // ── Ground snow accumulation plane ──
    const groundSize = extent.ground;
    const groundGeo = new PlaneGeometry(groundSize, groundSize, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    this.groundMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog!),
        uAccumulation: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        #include <common>
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
        uniform float uAccumulation, uTime;
        varying vec2 vUv;

        // Simple procedural noise for snow texture variation
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        void main() {
          // Multi-scale noise for natural snow coverage
          float n1 = noise(vUv * 40.0);
          float n2 = noise(vUv * 80.0 + 12.3);
          float n3 = noise(vUv * 160.0 + uTime * 0.003);
          float pattern = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;

          // Snow coverage expands with accumulation
          float coverage = smoothstep(1.0 - uAccumulation * 1.15, 1.0 - uAccumulation * 0.25, pattern);
          float alpha = mix(coverage * uAccumulation * 0.7, 0.94, uAccumulation * uAccumulation);

          // Slight warm-white tint variation
          vec3 snowColor = mix(
            vec3(0.88, 0.92, 0.98),
            vec3(0.95, 0.97, 1.0),
            n2
          );

          if (alpha < 0.003) discard;
          gl_FragColor = vec4(snowColor, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    });

    this.groundSnow = new Mesh(groundGeo, this.groundMaterial);
    this.groundSnow.name = 'snowstorm-ground';
    this.groundSnow.position.y = extent.groundY;
    this.groundSnow.renderOrder = 1;
    this.group.add(this.groundSnow);

    this.group.name = 'SNOWSTORM';
    this.group.visible = false;
    scene.add(this.group);
  }

  /**
   * Called every frame from the game render loop.
   * @param elapsedSeconds  - total elapsed wall time in seconds (from `now / 1000`)
   * @param remainingMs     - milliseconds remaining on the match timer
   * @param cameraPosition  - current camera world position
   */
  update(
    elapsedSeconds: number,
    remainingMs: number,
    cameraPosition: Vector3,
    hasSnowStarted = true,
  ): void {
    if (this.mapId !== 'frostline') {
      this.group.visible = false;
      return;
    }
    this.currentIntensity = hasSnowStarted ? snowstormIntensity(remainingMs, this.mapId) : 0;
    this.currentAccumulation = hasSnowStarted ? snowAccumulation(remainingMs, this.mapId) : 0;
    this.currentEmissionRate = snowEmissionRate(remainingMs, this.mapId, hasSnowStarted);
    const visualIntensity = this.currentIntensity;
    const isActive = visualIntensity > 0.0001 || (!!hasSnowStarted && remainingMs <= 240_000);
    this.group.visible = isActive;
    if (!isActive) return;

    // Update particle uniforms
    const pu = this.particleMaterial.uniforms;
    pu.uTime!.value = elapsedSeconds;
    pu.uIntensity!.value = this.currentIntensity;
    pu.uMatchElapsedSeconds!.value = (GAMEPLAY.tdmTimeLimitMs - remainingMs) / 1000;
    pu.uEmissionRate!.value = this.currentEmissionRate;
    pu.uSecondsAfterEmissionStop!.value = snowParticleFallElapsedSeconds(remainingMs);
    pu.uCameraPos!.value = cameraPosition;

    // Adjust visible particle count based on intensity
    const visibleCount = Math.ceil(this.maxParticles * Math.max(this.currentIntensity, 0.05));
    this.snowParticles.geometry.setDrawRange(0, visibleCount);

    // Update ground snow uniforms
    const gu = this.groundMaterial.uniforms;
    gu.uAccumulation!.value = this.currentAccumulation;
    gu.uTime!.value = elapsedSeconds;

    // Center ground plane on camera X/Z for infinite-feeling coverage
    this.groundSnow.position.x = cameraPosition.x;
    this.groundSnow.position.z = cameraPosition.z;
  }

  /** Clean up all GPU resources. */
  destroy(): void {
    this.snowParticles.geometry.dispose();
    this.particleMaterial.dispose();
    this.groundSnow.geometry.dispose();
    this.groundMaterial.dispose();
    this.group.removeFromParent();
  }
}
