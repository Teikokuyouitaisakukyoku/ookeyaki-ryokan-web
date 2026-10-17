import * as THREE from 'three';
import { BODY } from './collision.js';

const UP = new THREE.Vector3(0, 1, 0);

/** PC の FPS 視点（PointerLock + WASD）。足元は rig、目線は camera */
export class Player {
  constructor(camera, dom, collision, spawns) {
    this.camera = camera;
    this.dom = dom;
    this.col = collision;
    this.spawns = spawns;
    this.spawnIdx = 0;
    this.keys = new Set();
    this.pitch = 0;
    this.yaw = 0;
    this.feet = new THREE.Vector3();
    this.body = { vy: 0 };
    this.onLockChange = () => {};

    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (/^Digit[1-9]$/.test(e.code)) this.goSpawn(+e.code.slice(5) - 1);
      if (e.code === 'BracketRight') this.goSpawn(this.spawnIdx + 1);
      if (e.code === 'BracketLeft') this.goSpawn(this.spawnIdx - 1);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0022));
    });
    document.addEventListener('pointerlockchange', () => this.onLockChange(this.locked));
  }

  get locked() { return document.pointerLockElement === this.dom; }
  lock() { this.dom.requestPointerLock(); }

  goSpawn(i) {
    this.spawnIdx = (i + this.spawns.length) % this.spawns.length;
    const s = this.spawns[this.spawnIdx];
    this.feet.set(s.pos[0], s.pos[1], s.pos[2]);
    this.yaw = s.yaw;
    this.pitch = 0;
    this.body.vy = 0;
    this.sync();
  }

  sync() {
    this.camera.position.set(this.feet.x, this.feet.y + BODY.eye, this.feet.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  update(dt) {
    const k = this.keys;
    const move = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) move.z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) move.z += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) move.x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) move.x += 1;
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    if (move.lengthSq() > 0) {
      move.normalize().applyAxisAngle(UP, this.yaw).multiplyScalar((run ? BODY.run : BODY.walk) * dt);
    }
    this.col.moveBody(this.feet, move, dt, this.body);
    this.sync();
  }
}
