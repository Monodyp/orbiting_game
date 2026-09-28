import { ARENA_BLOCKS, ARENA_RAMPS, ICE_PATCHES, WATER_PATCHES } from '@ice-water/shared';
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  CylinderGeometry,
  type Scene,
} from 'three';
import { disposeModel } from './model-disposal.js';
export class FrostlineMap {
  readonly group = new Group();
  constructor(scene: Scene) {
    const snow = new MeshStandardMaterial({ color: 0xedf6fa, roughness: 0.9 });
    const navy = new MeshStandardMaterial({ color: 0x18334b, roughness: 0.75 });
    const blue = new MeshStandardMaterial({ color: 0x308cad, roughness: 0.7 });
    const ice = new MeshStandardMaterial({ color: 0x74d9ec, roughness: 0.2, metalness: 0.15 });
    const amber = new MeshStandardMaterial({ color: 0xf3b747, roughness: 0.6 });
    const floor = new Mesh(new BoxGeometry(120, 0.3, 120), snow);
    floor.position.y = -0.15;
    this.group.add(floor);
    for (const block of ARENA_BLOCKS) {
      const material = block.id.startsWith('cover')
        ? blue
        : block.id === 'reactor'
          ? navy
          : block.height > 4
            ? snow
            : navy;
      const mesh = new Mesh(new BoxGeometry(block.width, block.height, block.depth), material);
      mesh.position.set(block.x, block.y + block.height / 2, block.z);
      this.group.add(mesh);
      const trim = new Mesh(new BoxGeometry(block.width + 0.02, 0.1, block.depth + 0.02), ice);
      trim.position.set(block.x, block.y + block.height - 0.2, block.z);
      this.group.add(trim);
    }
    for (const r of ARENA_RAMPS) {
      const w = r.width / 2,
        d = r.depth / 2,
        h = r.height;
      const low = -d * r.direction,
        high = d * r.direction;
      const vertices = [-w, 0, low, w, 0, low, -w, h, high, w, h, high, -w, 0, high, w, 0, high];
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
      geometry.setIndex([0, 2, 1, 1, 2, 3, 0, 4, 2, 1, 3, 5, 2, 4, 3, 3, 4, 5, 0, 1, 4, 1, 5, 4]);
      if (r.direction === -1) {
        const indices = geometry.index!;
        for (let i = 0; i < indices.count; i += 3) {
          const a = indices.getX(i);
          indices.setX(i, indices.getX(i + 1));
          indices.setX(i + 1, a);
        }
      }
      geometry.computeVertexNormals();
      const mesh = new Mesh(geometry, blue);
      mesh.position.set(r.x, 0, r.z);
      this.group.add(mesh);
    }
    for (const patch of [...ICE_PATCHES, ...WATER_PATCHES]) {
      const mesh = new Mesh(
        new BoxGeometry(patch.width, 0.025, patch.depth),
        ICE_PATCHES.some((p) => p === patch) ? ice : blue,
      );
      mesh.position.set(patch.x, 0.0125, patch.z);
      this.group.add(mesh);
    }
    // Route paint is cosmetic and never blocks movement or shots.
    for (const x of [-30, 0, 30])
      for (const z of [-46.5, 46.5]) {
        const stripe = new Mesh(new BoxGeometry(5, 0.015, 0.3), amber);
        stripe.position.set(x, 0.025, z);
        this.group.add(stripe);
      }
    const core = new Mesh(new CylinderGeometry(1.5, 1.5, 2, 12), ice);
    core.position.y = 2.5;
    this.group.add(core);
    const ring = new Mesh(new CylinderGeometry(2.1, 2.1, 0.2, 12), amber);
    ring.position.y = 3.4;
    this.group.add(ring);
    scene.add(this.group);
  }
  destroy(): void {
    disposeModel(this.group);
    this.group.removeFromParent();
  }
}
