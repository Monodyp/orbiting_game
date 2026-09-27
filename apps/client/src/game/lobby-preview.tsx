import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  loadLobbyCharacterFactories,
  type CharacterInstance,
} from './character-model.js';
import { gameplayTeamColor } from './team-colors.js';

export type LobbySection = 'main' | 'play' | 'modes' | 'customize' | 'profile' | 'settings';

interface LobbyPreviewProps {
  section: LobbySection;
  reducedEffects: boolean;
  isRoomActive: boolean;
}

const CAMERA_POSES: Record<LobbySection, { position: THREE.Vector3; target: THREE.Vector3 }> = {
  main: { position: new THREE.Vector3(4.15, 2.7, 6.05), target: new THREE.Vector3(0.55, 1.2, 0) },
  play: { position: new THREE.Vector3(3.95, 2.6, 5.75), target: new THREE.Vector3(0.52, 1.17, 0) },
  modes: {
    position: new THREE.Vector3(4.6, 2.95, 6.65),
    target: new THREE.Vector3(0.42, 1.25, -0.15),
  },
  customize: {
    position: new THREE.Vector3(3.2, 2.4, 4.65),
    target: new THREE.Vector3(0.24, 1.18, 0),
  },
  profile: {
    position: new THREE.Vector3(3.15, 2.4, 4.7),
    target: new THREE.Vector3(0.23, 1.38, 0),
  },
  settings: {
    position: new THREE.Vector3(4.55, 2.9, 6.55),
    target: new THREE.Vector3(0.48, 1.26, 0),
  },
};

export function LobbyPreview({ section, reducedEffects, isRoomActive }: LobbyPreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null),
    sceneRef = useRef<LobbyScene | undefined>(undefined);
  const [hasError, setHasError] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    try {
      sceneRef.current = new LobbyScene(canvas);
    } catch {
      setHasError(true);
      return;
    }
    return () => {
      sceneRef.current?.destroy();
      sceneRef.current = undefined;
    };
  }, []);
  useEffect(
    () => sceneRef.current?.setState(section, reducedEffects, isRoomActive),
    [section, reducedEffects, isRoomActive],
  );
  return (
    <>
      <canvas className="lobby-preview" ref={ref} aria-label="Interactive frozen facility lobby" />
      {hasError && (
        <div className="preview-fallback" role="img" aria-label="Frozen facility unavailable">
          <span>3D lobby unavailable</span>
          <small>Menu controls remain active.</small>
        </div>
      )}
    </>
  );
}

class LobbyScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 90);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly stage = new THREE.Group();
  private readonly fan = new THREE.Group();
  private readonly holograms: THREE.Mesh[] = [];
  private readonly cameraTarget = new THREE.Vector3(0.65, 1.25, 0);
  private readonly pointer = new THREE.Vector2();
  private readonly smoothPointer = new THREE.Vector2();
  private readonly ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x263846,
    emissive: 0xffbd59,
    emissiveIntensity: 0.7,
    metalness: 0.65,
    roughness: 0.25,
  });
  private readonly cleanup: Array<() => void> = [];
  private readonly characters: CharacterInstance[] = [];
  private placeholder?: THREE.Group;
  private snow?: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private frame = 0;
  private previous = performance.now();
  private section: LobbySection = 'main';
  private isReduced = false;
  private isRoomActive = false;
  private isDestroyed = false;
  private isDragging = false;
  private dragX = 0;
  private rotationOffset = 0;
  private zoomOffset = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const isCoarse = matchMedia('(any-pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !isCoarse,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = !isCoarse;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0x06111d);
    this.scene.fog = new THREE.FogExp2(0x071522, 0.035);
    this.buildEnvironment();
    this.buildLighting();
    this.bind();
    this.resize();
    this.placeholder = this.buildPlaceholder();
    this.stage.add(this.placeholder);
    this.scene.add(this.stage);
    void this.loadCharacter();
    this.frame = requestAnimationFrame((time) => this.render(time));
  }

  setState(
    section: LobbySection,
    reducedEffects: boolean,
    isRoomActive: boolean,
  ): void {
    this.section = section;
    this.isReduced = reducedEffects;
    this.isRoomActive = isRoomActive;
    if (this.snow) this.snow.visible = !reducedEffects;
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    cancelAnimationFrame(this.frame);
    this.cleanup.forEach((dispose) => dispose());
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.renderer.dispose();
  }

  private buildLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0x8edbea, 0x02070d, 1.25));
    const key = new THREE.SpotLight(0xeafcff, 95, 30, Math.PI / 5, 0.5, 1.2);
    key.position.set(4, 8, 6);
    key.target.position.set(0, 1, 0);
    key.castShadow = this.renderer.shadowMap.enabled;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key, key.target);
    const rim = new THREE.PointLight(0x43d9f2, 38, 11, 1.6);
    rim.position.set(-3.5, 2.6, -1.8);
    this.scene.add(rim);
    const warm = new THREE.PointLight(0xffbd59, 18, 7, 2);
    warm.position.set(0, 0.35, 1);
    this.scene.add(warm);
  }

  private buildEnvironment(): void {
    const steel = new THREE.MeshStandardMaterial({
        color: 0x0b1d2b,
        metalness: 0.72,
        roughness: 0.42,
      }),
      darkSteel = new THREE.MeshStandardMaterial({
        color: 0x061019,
        metalness: 0.82,
        roughness: 0.34,
      });
    const ice = new THREE.MeshPhysicalMaterial({
      color: 0x77e6f5,
      transparent: true,
      opacity: 0.3,
      roughness: 0.12,
      metalness: 0.05,
      transmission: 0.16,
    });
    const cyan = new THREE.MeshStandardMaterial({
      color: 0x173c50,
      emissive: 0x38cde5,
      emissiveIntensity: 1.4,
      metalness: 0.4,
      roughness: 0.3,
    });
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 0.28, 48), steel);
    floor.position.y = -0.18;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const inset = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.08, 48), darkSteel);
    inset.position.y = 0.005;
    inset.receiveShadow = true;
    this.scene.add(inset);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.52, 0.05, 8, 64), this.ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.075;
    this.scene.add(ring);
    for (let i = -5; i <= 5; i++) {
      const seam = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.018, 19),
        i % 2 ? cyan : darkSteel,
      );
      seam.position.set(i * 1.85, 0.02, -1);
      this.scene.add(seam);
    }
    for (const z of [-7.8, -3.9, 3.9]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(21, 0.02, 0.025), darkSteel);
      seam.position.set(0, 0.03, z);
      this.scene.add(seam);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(25, 8, 0.4), steel);
    back.position.set(0, 3.8, -7.5);
    this.scene.add(back);
    const windowPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 4.2),
      new THREE.MeshBasicMaterial({ color: 0x0b3147 }),
    );
    windowPanel.position.set(1, 4, -7.27);
    this.scene.add(windowPanel);
    for (let i = 0; i < 7; i++) {
      const peak = new THREE.Mesh(
        new THREE.ConeGeometry(1.6 + (i % 3) * 0.35, 3 + (i % 2), 4),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0x163b50 : 0x102c3d, roughness: 0.9 }),
      );
      peak.position.set(-7.5 + i * 2.8, 1.8, -7);
      peak.rotation.y = Math.PI / 4;
      this.scene.add(peak);
    }
    for (const x of [-8.5, 8.5]) {
      const support = new THREE.Mesh(new THREE.BoxGeometry(1, 7.6, 1.1), darkSteel);
      support.position.set(x, 3.6, -5.8);
      this.scene.add(support);
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 8.5, 12), steel);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(x > 0 ? 5.1 : -5.1, 6.45, -5.9);
      this.scene.add(pipe);
      for (const y of [1.5, 3.8, 6]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.18, 1.4), cyan);
        band.position.set(x, y, -5.75);
        this.scene.add(band);
      }
    }
    for (const x of [-5.8, 6.3]) this.addCryoTank(x, -4.75, steel, ice, cyan);
    this.addHologram(-4.35, 2.6, -4.5, 0.42);
    this.addHologram(5.05, 3.7, -4.8, -0.38);
    this.buildFan(7.15, 4.65, -7.15, darkSteel, cyan);
    this.buildSnow();
  }

  private addCryoTank(
    x: number,
    z: number,
    steel: THREE.Material,
    ice: THREE.Material,
    cyan: THREE.Material,
  ): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const chamber = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 3.5, 20, 1, true), ice);
    chamber.position.y = 2.1;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.38, 16), steel);
    base.position.y = 0.2;
    const cap = base.clone();
    cap.position.y = 4;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 2.8, 10), cyan);
    core.position.y = 2.1;
    group.add(chamber, base, cap, core);
    this.scene.add(group);
  }

  private addHologram(x: number, y: number, z: number, rotation: number): void {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 1.45, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x0d2433, metalness: 0.7, roughness: 0.3 }),
    );
    frame.position.set(x, y, z);
    frame.rotation.y = rotation;
    this.scene.add(frame);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(2.05, 1.2),
      new THREE.MeshBasicMaterial({
        color: 0x60deef,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    panel.position.set(x + (rotation < 0 ? -0.04 : 0.04), y, z + 0.06);
    panel.rotation.y = rotation;
    this.holograms.push(panel);
    this.scene.add(panel);
  }

  private buildFan(
    x: number,
    y: number,
    z: number,
    steel: THREE.Material,
    cyan: THREE.Material,
  ): void {
    this.fan.position.set(x, y, z);
    this.fan.rotation.y = Math.PI;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.24, 12), cyan);
    hub.rotation.x = Math.PI / 2;
    this.fan.add(hub);
    for (let i = 0; i < 6; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.55, 0.08), steel);
      blade.position.y = 0.7;
      blade.rotation.z = (i * Math.PI) / 3;
      blade.geometry.translate(0, 0.1, 0);
      this.fan.add(blade);
    }
    this.scene.add(this.fan);
  }

  private buildSnow(): void {
    const count = matchMedia('(any-pointer: coarse)').matches ? 180 : 520,
      positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 22;
      positions[i * 3 + 1] = Math.random() * 9;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 18;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.snow = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xd8f8ff,
        size: 0.035,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      }),
    );
    this.scene.add(this.snow);
  }

  private buildPlaceholder(): THREE.Group {
    const group = new THREE.Group(),
      suit = new THREE.MeshStandardMaterial({ color: 0xdbeef2, roughness: 0.58, metalness: 0.15 }),
      visor = new THREE.MeshStandardMaterial({
        color: 0x123449,
        emissive: 0x38cde5,
        emissiveIntensity: 0.7,
      });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.05, 0.42), suit);
    torso.position.y = 1.18;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), visor);
    head.position.y = 1.96;
    const legs = [-0.22, 0.22].map((x) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.9, 0.3), suit);
      leg.position.set(x, 0.45, 0);
      return leg;
    });
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.52, 0.18), suit);
    leftArm.position.set(-0.22, 1.3, 0.24);
    leftArm.rotation.set(-0.7, 0.35, -0.3);
    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.52, 0.18), suit);
    rightArm.position.set(0.28, 1.24, 0.26);
    rightArm.rotation.set(-0.6, -0.2, 0.25);
    group.add(torso, head, leftArm, rightArm, ...legs);
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = true;
    });
    return group;
  }

  private async loadCharacter(): Promise<void> {
    try {
      const { ice, water } = await loadLobbyCharacterFactories();
      if (!ice || !water) return;
      if (this.isDestroyed) return;
      const lobbyCharacters = [
        { name: 'lobby-ice-character', factory: ice, color: gameplayTeamColor('ice'), x: -0.95, rotation: -0.3 },
        { name: 'lobby-water-character', factory: water, color: '#43c6d6', x: 0.95, rotation: 0.3 },
      ];
      for (const definition of lobbyCharacters) {
        const character = definition.factory.instantiate(definition.color, 'Idle');
        const actor = new THREE.Group();
        actor.name = definition.name;
        actor.position.set(definition.x, 0.02, -0.25);
        actor.rotation.y = definition.rotation;
        character.root.scale.setScalar(0.26);
        actor.add(character.root);
        this.stage.add(actor);
        this.characters.push(character);
      }
      if (this.placeholder) {
        this.placeholder.removeFromParent();
        this.disposeObject(this.placeholder);
        this.placeholder = undefined;
      }
    } catch {
      /* Keep the original procedural field-suit fallback. */
    }
  }

  private bind(): void {
    const resize = () => this.resize(),
      move = (event: PointerEvent) => {
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.set(
          ((event.clientX - rect.left) / Math.max(1, rect.width)) * 0.2 - 0.1,
          ((event.clientY - rect.top) / Math.max(1, rect.height)) * 0.2 - 0.1,
        );
        if (this.isDragging && this.section === 'customize') {
          this.rotationOffset += (event.clientX - this.dragX) * 0.008;
          this.dragX = event.clientX;
        }
      },
      down = (event: PointerEvent) => {
        if (this.section !== 'customize') return;
        this.isDragging = true;
        this.dragX = event.clientX;
        this.canvas.setPointerCapture(event.pointerId);
      },
      up = () => {
        this.isDragging = false;
      },
      wheel = (event: WheelEvent) => {
        if (this.section !== 'customize') return;
        event.preventDefault();
        this.zoomOffset = THREE.MathUtils.clamp(
          this.zoomOffset + Math.sign(event.deltaY) * 0.28,
          -0.55,
          0.85,
        );
      };
    const observer = new ResizeObserver(resize);
    observer.observe(this.canvas);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('wheel', wheel, { passive: false });
    this.cleanup.push(
      () => observer.disconnect(),
      () => this.canvas.removeEventListener('pointermove', move),
      () => this.canvas.removeEventListener('pointerdown', down),
      () => this.canvas.removeEventListener('pointerup', up),
      () => this.canvas.removeEventListener('pointercancel', up),
      () => this.canvas.removeEventListener('wheel', wheel),
    );
  }

  private resize(): void {
    const width = this.canvas.clientWidth || innerWidth,
      height = this.canvas.clientHeight || innerHeight;
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, matchMedia('(any-pointer: coarse)').matches ? 1.25 : 1.7),
    );
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  private render(now: number): void {
    if (this.isDestroyed) return;
    const delta = Math.min(0.05, (now - this.previous) / 1000);
    this.previous = now;
    if (!document.hidden) {
      this.update(now, delta);
      this.renderer.render(this.scene, this.camera);
    }
    this.frame = requestAnimationFrame((time) => this.render(time));
  }

  private update(now: number, delta: number): void {
    this.characters.forEach((character) => character.update(delta));
    const pose = CAMERA_POSES[this.section],
      ease = 1 - Math.exp(-4.8 * delta),
      pointerScale = this.isReduced ? 0 : 1;
    this.smoothPointer.lerp(this.pointer, ease * 0.65);
    const desired = pose.position.clone();
    desired.z += this.section === 'customize' ? this.zoomOffset : 0;
    desired.x += this.smoothPointer.x * 0.9 * pointerScale;
    desired.y -= this.smoothPointer.y * 0.45 * pointerScale;
    this.camera.position.lerp(desired, ease);
    const target = pose.target.clone();
    target.x += this.smoothPointer.x * 0.24 * pointerScale;
    target.y -= this.smoothPointer.y * 0.12 * pointerScale;
    this.cameraTarget.lerp(target, ease);
    this.camera.lookAt(this.cameraTarget);
    const baseRotation =
      this.section === 'customize' ? -0.18 : -0.12;
    this.stage.rotation.y = THREE.MathUtils.lerp(
      this.stage.rotation.y,
      baseRotation + (this.section === 'customize' ? this.rotationOffset : 0),
      ease,
    );
    const idle = this.isReduced ? 0 : Math.sin(now * 0.0017) * 0.018;
    this.stage.position.y = idle;
    this.fan.rotation.z += delta * 0.38;
    this.holograms.forEach((panel, index) => {
      (panel.material as THREE.MeshBasicMaterial).opacity =
        0.14 + (Math.sin(now * 0.002 + index * 1.7) + 1) * 0.045;
    });
    this.ringMaterial.emissiveIntensity = THREE.MathUtils.lerp(
      this.ringMaterial.emissiveIntensity,
      this.isRoomActive ? 2.1 : this.section === 'play' ? 1.35 : 0.72,
      ease,
    );
    if (this.snow && !this.isReduced) {
      const attribute = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < attribute.count; i++) {
        let y = attribute.getY(i) - delta * (0.13 + (i % 7) * 0.018);
        if (y < 0.08) y = 8.5;
        attribute.setY(i, y);
      }
      attribute.needsUpdate = true;
    }
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }
}
