import type { SpatialPosition } from '@ice-water/shared';

export type SoundCue =
  | 'shot'
  | 'reload'
  | 'empty'
  | 'hit'
  | 'headshot'
  | 'kill'
  | 'metal'
  | 'ice'
  | 'water'
  | 'slide'
  | 'jump'
  | 'land'
  | 'lunge'
  | 'tag'
  | 'untag';

interface CueProfile {
  duration: number;
  gain: number;
  cooldownMs: number;
  pitchVariation: number;
}

const CUE_PROFILES: Record<SoundCue, CueProfile> = {
  shot: { duration: 0.09, gain: 0.26, cooldownMs: 35, pitchVariation: 0.025 },
  reload: { duration: 0.1, gain: 0.15, cooldownMs: 80, pitchVariation: 0.025 },
  empty: { duration: 0.08, gain: 0.14, cooldownMs: 80, pitchVariation: 0.02 },
  hit: { duration: 0.09, gain: 0.18, cooldownMs: 45, pitchVariation: 0.018 },
  headshot: { duration: 0.12, gain: 0.22, cooldownMs: 55, pitchVariation: 0.015 },
  kill: { duration: 0.2, gain: 0.22, cooldownMs: 70, pitchVariation: 0.012 },
  metal: { duration: 0.09, gain: 0.12, cooldownMs: 90, pitchVariation: 0.035 },
  ice: { duration: 0.1, gain: 0.15, cooldownMs: 90, pitchVariation: 0.025 },
  water: { duration: 0.13, gain: 0.11, cooldownMs: 120, pitchVariation: 0.04 },
  slide: { duration: 0.22, gain: 0.12, cooldownMs: 120, pitchVariation: 0.035 },
  jump: { duration: 0.12, gain: 0.11, cooldownMs: 100, pitchVariation: 0.035 },
  land: { duration: 0.17, gain: 0.13, cooldownMs: 100, pitchVariation: 0.03 },
  lunge: { duration: 0.27, gain: 0.18, cooldownMs: 160, pitchVariation: 0.035 },
  tag: { duration: 0.24, gain: 0.29, cooldownMs: 60, pitchVariation: 0.018 },
  untag: { duration: 0.3, gain: 0.27, cooldownMs: 70, pitchVariation: 0.018 },
};

const BASE_FREQUENCIES: Record<SoundCue, number> = {
  shot: 100,
  reload: 340,
  empty: 180,
  hit: 720,
  headshot: 1200,
  kill: 980,
  metal: 160,
  ice: 480,
  water: 85,
  slide: 120,
  jump: 330,
  land: 90,
  lunge: 150,
  tag: 760,
  untag: 360,
};

/** Maps the last downward velocity to a restrained but readable landing impact. */
export function landingIntensity(verticalVelocity: number): number {
  const fallingSpeed = Math.max(0, -verticalVelocity);
  return Math.min(1, 0.52 + fallingSpeed / 18);
}

export interface StormAudioMix {
  readonly wind: number;
  readonly rumble: number;
  readonly gust: number;
  readonly snow: number;
}

export function stormAudioMix(intensity: number, gust: number): StormAudioMix {
  const storm = Math.min(1, Math.max(0, intensity));
  const gustAmount = Math.min(1, Math.max(0, gust));
  return {
    wind: storm * (0.05 + storm * 0.19 + gustAmount * 0.12),
    rumble: storm * storm * 0.11,
    gust: storm * gustAmount * 0.22,
    snow: storm * (0.015 + storm * 0.055 + gustAmount * 0.06),
  };
}

interface StormAudioLayers {
  readonly sources: readonly AudioBufferSourceNode[];
  readonly wind: GainNode;
  readonly rumble: GainNode;
  readonly gust: GainNode;
  readonly snow: GainNode;
}

export class CueCooldowns {
  private readonly lastPlayedAt = new Map<SoundCue, number>();

  allow(cue: SoundCue, nowMs: number): boolean {
    const previous = this.lastPlayedAt.get(cue);
    if (previous !== undefined && nowMs - previous < CUE_PROFILES[cue].cooldownMs) return false;
    this.lastPlayedAt.set(cue, nowMs);
    return true;
  }
}

function envelope(t: number, attack = 0.025, releasePower = 1.8): number {
  return Math.min(1, t / attack) * (1 - t) ** releasePower;
}

function fillCue(buffer: AudioBuffer, cue: SoundCue): void {
  const samples = buffer.getChannelData(0);
  let phase = 0;
  let filteredNoise = 0;
  let randomState = [...cue].reduce((seed, character) => seed + character.charCodeAt(0), 1);
  const noise = () => {
    randomState = (randomState * 16_807) % 2_147_483_647;
    return (randomState / 2_147_483_647) * 2 - 1;
  };

  for (let index = 0; index < samples.length; index += 1) {
    const t = index / samples.length;
    filteredNoise = filteredNoise * 0.82 + noise() * 0.18;
    let sample: number;

    if (cue === 'lunge') {
      const frequency = 210 - 135 * t;
      phase += (Math.PI * 2 * frequency) / buffer.sampleRate;
      sample = (filteredNoise * 0.82 + Math.sin(phase) * 0.18) * envelope(t, 0.018, 2.2);
    } else if (cue === 'jump') {
      const frequency = 240 + 250 * t;
      phase += (Math.PI * 2 * frequency) / buffer.sampleRate;
      sample = (Math.sin(phase) * 0.68 + filteredNoise * 0.32) * envelope(t, 0.04, 2.1);
    } else if (cue === 'land') {
      const frequency = 115 - 58 * t;
      phase += (Math.PI * 2 * frequency) / buffer.sampleRate;
      sample = (Math.sin(phase) * 0.64 + filteredNoise * 0.36) * envelope(t, 0.008, 2.7);
    } else if (cue === 'tag') {
      const frequency = t < 0.43 ? 760 : 1_140;
      phase += (Math.PI * 2 * frequency) / buffer.sampleRate;
      sample = (Math.sin(phase) * 0.72 + Math.sin(phase * 2.01) * 0.28) * envelope(t, 0.012, 1.6);
    } else if (cue === 'untag') {
      const frequency = 340 + 540 * t;
      phase += (Math.PI * 2 * frequency) / buffer.sampleRate;
      sample = (Math.sin(phase) * 0.76 + Math.sin(phase * 0.5) * 0.24) * envelope(t, 0.035, 1.45);
    } else {
      const start = BASE_FREQUENCIES[cue];
      const endMultiplier = cue === 'kill' ? 1.6 : 0.35;
      const frequency = start * (1 + (endMultiplier - 1) * t);
      phase += (Math.PI * 2 * frequency) / buffer.sampleRate;
      const tone = cue === 'shot' ? (Math.sin(phase) > 0 ? 1 : -1) : Math.sin(phase);
      sample = (tone * 0.8 + filteredNoise * 0.2) * envelope(t);
    }

    samples[index] = sample * 0.82;
  }
}

export class AudioManager {
  private context?: AudioContext;
  private gain?: GainNode;
  private lowPass?: BiquadFilterNode;
  private readonly buffers = new Map<SoundCue, AudioBuffer>();
  private readonly cooldowns = new CueCooldowns();
  private variationIndex = 0;
  private isUnderwater = false;
  private stormIntensity = 0;
  private stormGust = 0;
  private stormLayers?: StormAudioLayers;
  volume = 0.65;

  unlock(): void {
    this.context ??= new AudioContext();
    if (!this.gain) {
      this.gain = this.context.createGain();
      this.lowPass = this.context.createBiquadFilter();
      this.lowPass.type = 'lowpass';
      this.lowPass.Q.value = 0.72;
      this.lowPass.frequency.value = this.isUnderwater ? 850 : 22_000;
      this.gain.connect(this.lowPass);
      this.lowPass.connect(this.context.destination);
      this.preload(this.context);
      this.ensureStormLayers(this.context);
    }
    void this.context.resume().catch(() => {});
  }

  setUnderwater(isUnderwater: boolean): void {
    if (this.isUnderwater === isUnderwater) return;
    this.isUnderwater = isUnderwater;
    if (!this.context || !this.lowPass) return;
    this.lowPass.frequency.setTargetAtTime(
      isUnderwater ? 850 : 22_000,
      this.context.currentTime,
      0.08,
    );
  }

  /** Smoothly blends the continuous wind, rumble, gust and snow-noise layers. */
  setStorm(intensity: number, gust: number): void {
    this.stormIntensity = Math.min(1, Math.max(0, intensity));
    this.stormGust = Math.min(1, Math.max(0, gust));
    const context = this.context;
    const layers = this.stormLayers;
    if (!context || !layers) return;
    const mix = stormAudioMix(this.stormIntensity, this.stormGust);
    const now = context.currentTime;
    layers.wind.gain.setTargetAtTime(mix.wind, now, 0.45);
    layers.rumble.gain.setTargetAtTime(mix.rumble, now, 0.8);
    layers.gust.gain.setTargetAtTime(mix.gust, now, 0.18);
    layers.snow.gain.setTargetAtTime(mix.snow, now, 0.3);
  }

  listener(position: SpatialPosition, yaw: number): void {
    const listener = this.context?.listener;
    if (!listener) return;
    listener.positionX.value = position.x;
    listener.positionY.value = position.y;
    listener.positionZ.value = position.z;
    listener.forwardX.value = -Math.sin(yaw);
    listener.forwardY.value = 0;
    listener.forwardZ.value = -Math.cos(yaw);
    listener.upX.value = 0;
    listener.upY.value = 1;
    listener.upZ.value = 0;
    if (this.gain) this.gain.gain.value = this.volume;
  }

  play(cue: SoundCue, position?: SpatialPosition, intensity = 1): void {
    const context = this.context;
    if (
      !context ||
      context.state !== 'running' ||
      !this.gain ||
      this.volume <= 0 ||
      !this.cooldowns.allow(cue, context.currentTime * 1000)
    )
      return;

    const profile = CUE_PROFILES[cue];
    const source = context.createBufferSource();
    const gain = context.createGain();
    const variation = [-0.028, 0.016, -0.011, 0.031, 0.006][this.variationIndex++ % 5]!;
    source.buffer = this.buffers.get(cue) ?? this.createBuffer(context, cue);
    source.playbackRate.value = 1 + variation * (profile.pitchVariation / 0.03);
    gain.gain.value = profile.gain * Math.max(0.35, Math.min(1, intensity)) * (1 + variation);
    source.connect(gain);

    let panner: PannerNode | undefined;
    if (position) {
      panner = context.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 3;
      panner.maxDistance = 40;
      panner.rolloffFactor = 1.25;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      gain.connect(panner);
      panner.connect(this.gain);
    } else gain.connect(this.gain);

    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      panner?.disconnect();
    };
    source.start();
  }

  destroy(): void {
    this.stormLayers?.sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        /* Source may already have stopped during context teardown. */
      }
      source.disconnect();
    });
    this.stormLayers = undefined;
    this.buffers.clear();
    void this.context?.close().catch(() => {});
  }

  private preload(context: AudioContext): void {
    (Object.keys(CUE_PROFILES) as SoundCue[]).forEach((cue) => this.createBuffer(context, cue));
  }

  private ensureStormLayers(context: AudioContext): void {
    if (this.stormLayers || !this.gain) return;
    const buffer = createStormNoiseBuffer(context);
    const makeLayer = (
      type: BiquadFilterType,
      frequency: number,
      q: number,
      playbackRate: number,
    ) => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = playbackRate;
      const filter = context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.gain!);
      source.start();
      return { source, gain };
    };
    const wind = makeLayer('lowpass', 920, 0.55, 0.83);
    const rumble = makeLayer('lowpass', 130, 0.7, 0.47);
    const gust = makeLayer('bandpass', 1_450, 0.48, 1.13);
    const snow = makeLayer('highpass', 2_100, 0.42, 0.97);
    this.stormLayers = {
      sources: [wind.source, rumble.source, gust.source, snow.source],
      wind: wind.gain,
      rumble: rumble.gain,
      gust: gust.gain,
      snow: snow.gain,
    };
    this.setStorm(this.stormIntensity, this.stormGust);
  }

  private createBuffer(context: AudioContext, cue: SoundCue): AudioBuffer {
    const existing = this.buffers.get(cue);
    if (existing) return existing;
    const profile = CUE_PROFILES[cue];
    const buffer = context.createBuffer(
      1,
      Math.ceil(profile.duration * context.sampleRate),
      context.sampleRate,
    );
    fillCue(buffer, cue);
    this.buffers.set(cue, buffer);
    return buffer;
  }
}

function createStormNoiseBuffer(context: AudioContext): AudioBuffer {
  const durationSeconds = 4;
  const buffer = context.createBuffer(1, context.sampleRate * durationSeconds, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let state = 91_827;
  let smooth = 0;
  for (let index = 0; index < samples.length; index += 1) {
    state = (state * 16_807) % 2_147_483_647;
    const white = (state / 2_147_483_647) * 2 - 1;
    smooth = smooth * 0.72 + white * 0.28;
    samples[index] = white * 0.58 + smooth * 0.42;
  }
  return buffer;
}
