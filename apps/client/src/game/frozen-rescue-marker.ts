import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';

export function createFrozenRescueMarker(): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required for frozen rescue markers');
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '800 38px Bahnschrift, "Segoe UI", sans-serif';
  context.lineWidth = 9;
  context.strokeStyle = '#352900';
  context.strokeText('⚠ FROZEN — NEEDS RESCUE', 256, 64);
  context.fillStyle = '#ffe05c';
  context.fillText('⚠ FROZEN — NEEDS RESCUE', 256, 64);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    sizeAttenuation: true,
  });
  const marker = new Sprite(material);
  marker.name = 'frozen-rescue-marker';
  marker.renderOrder = 1000;
  marker.scale.set(5.6, 1.4, 1);
  return marker;
}

export function disposeFrozenRescueMarker(marker: Sprite): void {
  const material = marker.material as SpriteMaterial;
  material.map?.dispose();
  material.dispose();
  marker.removeFromParent();
}
