import lobbyMusicUrl from '../../../../assets/music/bg1.mp3?url';
import type { FpsSettings } from '../game/fps-settings.js';

type InterfaceCue = 'hover' | 'select' | 'deploy';

export class LobbyAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private musicGain?: GainNode;
  private sfxGain?: GainNode;
  private musicBuffer?: AudioBuffer;
  private musicSource?: AudioBufferSourceNode;
  private ambience?: { wind: AudioBufferSourceNode; hum: OscillatorNode };
  private loadPromise?: Promise<void>;
  private isStarted = false;
  private isDestroyed = false;
  private lastHoverAt = 0;

  constructor(private settings: FpsSettings) {}

  setSettings(settings: FpsSettings): void {
    this.settings = settings;
    this.applyLevels(0.08);
  }

  start(): void {
    if (this.isDestroyed || this.isStarted) return;
    this.isStarted = true;
    void this.unlock();
  }

  async unlock(): Promise<void> {
    if (this.isDestroyed || !this.isStarted) return;
    this.ensureGraph();
    const context = this.context;
    if (!context) return;
    try {
      await context.resume();
    } catch {
      return;
    }
    if (context.state !== 'running') return;
    await this.loadMusic();
    if (this.isDestroyed) return;
    this.startLobbySources();
  }

  cue(kind: InterfaceCue): void {
    const context = this.context;
    if (!this.isStarted || !context || context.state !== 'running' || !this.sfxGain) return;
    if (kind === 'hover' && performance.now() - this.lastHoverAt < 90) return;
    if (kind === 'hover') this.lastHoverAt = performance.now();
    const oscillator = context.createOscillator(),
      gain = context.createGain(),
      now = context.currentTime;
    const duration = kind === 'deploy' ? 0.24 : 0.055;
    oscillator.type = kind === 'deploy' ? 'sawtooth' : 'sine';
    oscillator.frequency.setValueAtTime(
      kind === 'hover' ? 620 : kind === 'select' ? 390 : 110,
      now,
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      kind === 'deploy' ? 880 : kind === 'select' ? 760 : 710,
      now + duration,
    );
    gain.gain.setValueAtTime(kind === 'deploy' ? 0.12 : 0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.sfxGain);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.isStarted = false;
    this.stopLobbySources();
    void this.context?.close().catch(() => {});
  }

  private ensureGraph(): void {
    if (this.context) return;
    const context = new AudioContext(),
      master = context.createGain(),
      music = context.createGain(),
      sfx = context.createGain();
    music.connect(master);
    sfx.connect(master);
    master.connect(context.destination);
    this.context = context;
    this.master = master;
    this.musicGain = music;
    this.sfxGain = sfx;
    this.applyLevels(0);
  }

  private applyLevels(duration: number): void {
    const context = this.context,
      master = this.master,
      music = this.musicGain,
      sfx = this.sfxGain;
    if (!context || !master || !music || !sfx) return;
    const at = context.currentTime + duration;
    master.gain.cancelScheduledValues(context.currentTime);
    music.gain.cancelScheduledValues(context.currentTime);
    sfx.gain.cancelScheduledValues(context.currentTime);
    master.gain.linearRampToValueAtTime(this.settings.isMuted ? 0 : this.settings.volume, at);
    music.gain.linearRampToValueAtTime(0, at);
    sfx.gain.linearRampToValueAtTime(this.settings.sfxVolume, at);
  }

  private loadMusic(): Promise<void> {
    if (this.musicBuffer) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    const context = this.context;
    if (!context) return Promise.resolve();
    this.loadPromise = fetch(lobbyMusicUrl)
      .then((response) => {
        if (!response.ok) throw new Error('Lobby music could not be loaded');
        return response.arrayBuffer();
      })
      .then((data) => context.decodeAudioData(data))
      .then((buffer) => {
        this.musicBuffer = buffer;
      })
      .catch(() => {
        /* The lobby remains fully usable without optional music. */
      });
    return this.loadPromise;
  }

  private startLobbySources(): void {
    const context = this.context,
      musicGain = this.musicGain,
      buffer = this.musicBuffer;
    if (!context || !musicGain || !buffer || this.musicSource) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(musicGain);
    source.onended = () => {
      if (this.musicSource === source) this.musicSource = undefined;
      source.disconnect();
    };
    this.musicSource = source;
    source.start();
    this.startAmbience();
    this.applyLevels(0.65);
  }

  private startAmbience(): void {
    const context = this.context,
      musicGain = this.musicGain;
    if (!context || !musicGain || this.ambience) return;
    const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate),
      channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = (Math.random() * 2 - 1) * 0.16;
    const wind = context.createBufferSource();
    wind.buffer = noiseBuffer;
    wind.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 280;
    windFilter.Q.value = 0.35;
    const windGain = context.createGain();
    windGain.gain.value = 0.05;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(musicGain);
    wind.start();
    const hum = context.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 47;
    const humGain = context.createGain();
    humGain.gain.value = 0.025;
    hum.connect(humGain);
    humGain.connect(musicGain);
    hum.start();
    this.ambience = { wind, hum };
  }

  private stopLobbySources(): void {
    const music = this.musicSource;
    this.musicSource = undefined;
    if (music) {
      music.onended = null;
      try {
        music.stop();
      } catch {
        /* Already stopped. */
      }
      music.disconnect();
    }
    if (this.ambience) {
      try {
        this.ambience.wind.stop();
        this.ambience.hum.stop();
      } catch {
        /* Already stopped. */
      }
      this.ambience.wind.disconnect();
      this.ambience.hum.disconnect();
      this.ambience = undefined;
    }
  }
}
