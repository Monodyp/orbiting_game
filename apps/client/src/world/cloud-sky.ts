import type { MapId } from '@ice-water/shared';
import {
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LinearFilter,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  Vector3,
  type Light,
  type Scene,
} from 'three';

export type CloudQuality = 'low' | 'medium' | 'high';

interface CloudSpec {
  readonly shape: number;
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly width: number;
  readonly depth: number;
  readonly rotation: number;
  readonly speed: number;
  readonly windAngle: number;
}

interface CloudTheme {
  readonly colors: readonly number[];
  readonly opacity: number;
  readonly radius: number;
  readonly altitudeScale: number;
  readonly maxLightAttenuation: number;
}

interface LightLevel {
  readonly light: Light;
  readonly intensity: number;
}

const CLOUD_SPECS: readonly CloudSpec[] = [
  {
    shape: 0,
    x: -122,
    z: -72,
    y: 92,
    width: 64,
    depth: 29,
    rotation: 0.18,
    speed: 0.46,
    windAngle: 0.1,
  },
  {
    shape: 1,
    x: -70,
    z: 118,
    y: 116,
    width: 83,
    depth: 36,
    rotation: -0.33,
    speed: 0.34,
    windAngle: 0.16,
  },
  {
    shape: 2,
    x: 18,
    z: -139,
    y: 105,
    width: 47,
    depth: 22,
    rotation: 0.64,
    speed: 0.58,
    windAngle: 0.04,
  },
  {
    shape: 0,
    x: 107,
    z: -92,
    y: 128,
    width: 91,
    depth: 38,
    rotation: -0.16,
    speed: 0.3,
    windAngle: 0.21,
  },
  {
    shape: 2,
    x: 139,
    z: 24,
    y: 88,
    width: 55,
    depth: 25,
    rotation: 0.37,
    speed: 0.63,
    windAngle: 0.08,
  },
  {
    shape: 1,
    x: 78,
    z: 126,
    y: 101,
    width: 72,
    depth: 31,
    rotation: -0.72,
    speed: 0.41,
    windAngle: 0.14,
  },
  {
    shape: 0,
    x: -21,
    z: 151,
    y: 137,
    width: 52,
    depth: 23,
    rotation: 0.49,
    speed: 0.54,
    windAngle: 0.02,
  },
  {
    shape: 2,
    x: -151,
    z: 35,
    y: 111,
    width: 97,
    depth: 41,
    rotation: -0.08,
    speed: 0.28,
    windAngle: 0.19,
  },
  {
    shape: 1,
    x: 43,
    z: 57,
    y: 145,
    width: 44,
    depth: 19,
    rotation: 0.91,
    speed: 0.67,
    windAngle: 0.07,
  },
  {
    shape: 0,
    x: -96,
    z: 61,
    y: 124,
    width: 69,
    depth: 27,
    rotation: -0.55,
    speed: 0.38,
    windAngle: 0.12,
  },
  {
    shape: 2,
    x: 153,
    z: 115,
    y: 132,
    width: 76,
    depth: 33,
    rotation: 0.23,
    speed: 0.44,
    windAngle: 0.17,
  },
  {
    shape: 1,
    x: 4,
    z: -54,
    y: 98,
    width: 58,
    depth: 26,
    rotation: -0.25,
    speed: 0.51,
    windAngle: 0.05,
  },
  {
    shape: 0,
    x: -169,
    z: -137,
    y: 142,
    width: 86,
    depth: 34,
    rotation: 0.7,
    speed: 0.32,
    windAngle: 0.2,
  },
  {
    shape: 1,
    x: 170,
    z: -154,
    y: 119,
    width: 62,
    depth: 28,
    rotation: -0.44,
    speed: 0.49,
    windAngle: 0.09,
  },
  {
    shape: 2,
    x: -48,
    z: -171,
    y: 151,
    width: 104,
    depth: 43,
    rotation: 0.11,
    speed: 0.27,
    windAngle: 0.15,
  },
];

const CLOUD_PUFFS: readonly (readonly (readonly [number, number, number, number])[])[] = [
  [
    [0.25, 0.52, 0.2, 0.24],
    [0.4, 0.43, 0.25, 0.33],
    [0.57, 0.5, 0.28, 0.27],
    [0.73, 0.56, 0.2, 0.2],
  ],
  [
    [0.19, 0.57, 0.17, 0.18],
    [0.34, 0.49, 0.24, 0.25],
    [0.5, 0.38, 0.2, 0.36],
    [0.62, 0.49, 0.25, 0.27],
    [0.8, 0.58, 0.15, 0.16],
  ],
  [
    [0.22, 0.55, 0.18, 0.2],
    [0.39, 0.5, 0.27, 0.24],
    [0.61, 0.47, 0.3, 0.31],
    [0.79, 0.55, 0.16, 0.19],
  ],
];

const CLOUD_BATCH_SPECS = CLOUD_PUFFS.map((_, shape) =>
  CLOUD_SPECS.filter((spec) => spec.shape === shape),
);

const DAY_THEME: CloudTheme = {
  colors: [0xf7fbfd, 0xe7f3f7, 0xdcebf1],
  opacity: 0.56,
  radius: 175,
  altitudeScale: 1,
  maxLightAttenuation: 0.04,
};

const NIGHT_THEME: CloudTheme = {
  colors: [0x8f9cba, 0x71819f, 0xa1a9c2],
  opacity: 0.38,
  radius: 250,
  altitudeScale: 1.14,
  maxLightAttenuation: 0.025,
};

const ORIGIN = new Vector3();

/** A bounded, presentation-only cloud field with three instanced draw calls. */
export class CloudSky {
  readonly group = new Group();
  private readonly batches: readonly InstancedMesh[];
  private readonly lightLevels: readonly LightLevel[];
  private readonly theme: CloudTheme;
  private readonly isPermanentNight: boolean;
  private readonly dayCloudColors = DAY_THEME.colors.map((color) => new Color(color));
  private readonly nightCloudColors = NIGHT_THEME.colors.map((color) => new Color(color));
  private readonly stormCloudColors = [0x46545f, 0x34424f, 0x5c6974].map(
    (color) => new Color(color),
  );
  private readonly transform = new Object3D();

  constructor(scene: Scene, mapId: MapId, lights: readonly Light[] = []) {
    this.isPermanentNight = mapId === 'original';
    this.theme = mapId === 'original' ? NIGHT_THEME : DAY_THEME;
    this.lightLevels = lights.map((light) => ({ light, intensity: light.intensity }));
    this.group.name = 'PROCEDURAL_CLOUD_SKY';
    this.batches = CLOUD_PUFFS.map((_, shape) => this.createBatch(shape));
    this.group.add(...this.batches);
    scene.add(this.group);
    this.update(0, ORIGIN, 'high');
  }

  setUnderwater(isUnderwater: boolean): void {
    this.group.visible = !isUnderwater;
  }

  update(
    elapsedSeconds: number,
    cameraPosition: Vector3,
    quality: CloudQuality,
    nightProgress = 0,
    stormIntensity = 0,
    stormGust = 0,
  ): void {
    const transition = this.isPermanentNight ? 1 : clamp01(nightProgress);
    const storm = this.isPermanentNight ? 0 : clamp01(stormIntensity);
    const gust = clamp01(stormGust);
    const radius = mix(mix(DAY_THEME.radius, NIGHT_THEME.radius, transition), 132, storm);
    const altitudeScale = mix(
      mix(DAY_THEME.altitudeScale, NIGHT_THEME.altitudeScale, transition),
      0.72,
      storm,
    );
    const qualityMotion = quality === 'low' ? 0.22 : quality === 'medium' ? 0.72 : 1;
    const motionScale = qualityMotion * (1 + storm * 3.2 + gust * 2.1);
    for (let shape = 0; shape < this.batches.length; shape++) {
      const mesh = this.batches[shape]!;
      const material = mesh.material as MeshBasicMaterial;
      material.color.lerpColors(
        this.dayCloudColors[shape]!,
        this.nightCloudColors[shape]!,
        transition,
      );
      material.color.lerp(this.stormCloudColors[shape]!, storm);
      material.opacity = mix(mix(DAY_THEME.opacity, NIGHT_THEME.opacity, transition), 0.86, storm);
      const specs = CLOUD_BATCH_SPECS[shape]!;
      const qualityScale = quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1;
      mesh.count = Math.max(2, Math.ceil(specs.length * qualityScale));
      for (let index = 0; index < mesh.count; index++) {
        const spec = specs[index]!;
        const travel = elapsedSeconds * spec.speed * motionScale;
        const x = wrapAround(spec.x + Math.cos(spec.windAngle) * travel, cameraPosition.x, radius);
        const z = wrapAround(spec.z + Math.sin(spec.windAngle) * travel, cameraPosition.z, radius);
        this.transform.position.set(x, spec.y * altitudeScale, z);
        this.transform.scale.set(spec.width, spec.depth, 1);
        this.transform.lookAt(cameraPosition);
        this.transform.rotateZ(spec.rotation);
        this.transform.updateMatrix();
        mesh.setMatrixAt(index, this.transform.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    const lightFactor = cloudLightingFactor(
      elapsedSeconds,
      cameraPosition.x,
      cameraPosition.z,
      mix(
        mix(DAY_THEME.maxLightAttenuation, NIGHT_THEME.maxLightAttenuation, transition),
        0.24 + gust * 0.06,
        storm,
      ),
      quality !== 'low',
    );
    const nightLightScale = this.isPermanentNight ? 1 : mix(1, 0.46, transition);
    for (const level of this.lightLevels)
      level.light.intensity = level.intensity * lightFactor * nightLightScale;
  }

  destroy(): void {
    for (const level of this.lightLevels) level.light.intensity = level.intensity;
    for (const mesh of this.batches) {
      mesh.geometry.dispose();
      const material = mesh.material as MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
      mesh.dispose();
    }
    this.group.removeFromParent();
  }

  private createBatch(shape: number): InstancedMesh {
    const geometry = new PlaneGeometry(1, 1);
    const texture = createCloudTexture(shape);
    const material = new MeshBasicMaterial({
      color: this.theme.colors[shape],
      map: texture,
      transparent: true,
      opacity: this.theme.opacity,
      alphaTest: 0.015,
      depthWrite: false,
      depthTest: true,
      side: DoubleSide,
      fog: false,
      toneMapped: false,
    });
    const count = CLOUD_BATCH_SPECS[shape]!.length;
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.name = `cloud-bank-${shape + 1}`;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = -50;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }
}

export function cloudLightingFactor(
  elapsedSeconds: number,
  x: number,
  z: number,
  maxAttenuation: number,
  isAnimated: boolean,
): number {
  if (!isAnimated) return 1 - maxAttenuation * 0.45;
  const broad = Math.sin(elapsedSeconds * 0.018 + x * 0.006 + z * 0.004);
  const detail = Math.sin(elapsedSeconds * 0.031 - x * 0.003 + z * 0.008 + 1.7);
  const coverage = Math.min(1, Math.max(0, 0.52 + broad * 0.28 + detail * 0.2));
  return 1 - coverage * maxAttenuation;
}

function wrapAround(value: number, center: number, radius: number): number {
  const width = radius * 2;
  return center - radius + ((((value - center + radius) % width) + width) % width);
}

function mix(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function createCloudTexture(shape: number): DataTexture {
  const width = 96;
  const height = 48;
  const data = new Uint8Array(width * height * 4);
  const puffs = CLOUD_PUFFS[shape]!;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      let empty = 1;
      for (const [puffX, puffY, radiusX, radiusY] of puffs) {
        const dx = (u - puffX) / radiusX;
        const dy = (v - puffY) / radiusY;
        const puff = Math.exp(-(dx * dx + dy * dy) * 1.8);
        empty *= 1 - puff;
      }
      const density = 1 - empty;
      const edge = Math.min(1, Math.max(0, (density - 0.08) / 0.48));
      const alpha = edge * edge * (3 - 2 * edge);
      const offset = (y * width + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.name = `procedural-cloud-${shape + 1}`;
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
