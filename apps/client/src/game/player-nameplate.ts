import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';

const NAMEPLATE_WIDTH = 256;
const NAMEPLATE_HEIGHT = 64;
const NAMEPLATE_ALWAYS_VISIBLE_RANGE = 3;

export type NameplateTone = 'enemy' | 'friend' | 'protected' | 'frozen';

export function createPlayerNameplate(displayName: string): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = NAMEPLATE_WIDTH;
  canvas.height = NAMEPLATE_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required for player nameplates');

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const fontFamily = 'Bahnschrift, "Segoe UI", sans-serif';
  let fontSize = 16;
  context.font = `300 ${fontSize}px ${fontFamily}`;
  const maxTextWidth = NAMEPLATE_WIDTH - 36;
  const initialTextWidth = context.measureText(displayName).width;
  if (initialTextWidth > maxTextWidth) {
    fontSize *= maxTextWidth / initialTextWidth;
    context.font = `300 ${fontSize}px ${fontFamily}`;
  }

  // A compact dark keyline keeps the floating text legible over snow, water, and terrain.
  context.lineJoin = 'round';
  context.strokeStyle = '#10283b';
  context.lineWidth = 2;
  context.strokeText(displayName, NAMEPLATE_WIDTH / 2, NAMEPLATE_HEIGHT / 2);
  context.fillStyle = '#ffffff';
  context.fillText(displayName, NAMEPLATE_WIDTH / 2, NAMEPLATE_HEIGHT / 2);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;

  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.9,
    alphaTest: 0.08,
    depthWrite: false,
    sizeAttenuation: false,
    toneMapped: false,
  });
  const nameplate = new Sprite(material);
  nameplate.name = `nameplate-${displayName}`;
  nameplate.scale.set(0.56, 0.14, 1);
  nameplate.renderOrder = 3;
  return nameplate;
}

export function shouldDepthTestNameplate(distance: number): boolean {
  return distance >= NAMEPLATE_ALWAYS_VISIBLE_RANGE;
}

export function setNameplateTone(nameplate: Sprite, tone: NameplateTone): void {
  const color =
    tone === 'frozen'
      ? 0xbdefff
      : tone === 'protected'
        ? 0xf3b747
        : tone === 'friend'
          ? 0x74d9ec
          : 0xffffff;
  (nameplate.material as SpriteMaterial).color.setHex(color);
}

export function disposePlayerNameplate(nameplate: Sprite): void {
  const material = nameplate.material as SpriteMaterial;
  material.map?.dispose();
  material.dispose();
  nameplate.removeFromParent();
}
