import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { BODY } from './collision.js';
import { pickPoint, GRAB } from './touch.js';

const UP = new THREE.Vector3(0, 1, 0);
const TOUCH_COOLDOWN = 1.2; // 同じ住人に続けて反応しない秒数
const PANEL_W = 1024, PANEL_H = 300;

/**
 * VR モード（PC 接続の VR 機器・WebXR）。画面右下の［VR開始］で入り、［VR終了］かヘッドセット側の操作で通常モードへ戻る。
 *   左スティック: 移動 / 右スティック: 30° ずつ向きを変える / トリガー: 返事（問い詰めているときは証拠を順に突きつける）
 *   空間の手で住人に触れると反応する。手・腕はグリップでつかんで引っ張れる
 * 会話は顔の前の 3D パネルに出す（通常モードの字幕と同じ内容）。
 */
export class VR {
  constructor({ renderer, scene, camera, player, collision, residents, talk, button }) {
    Object.assign(this, { renderer, scene, camera, player, collision, residents, talk, button });
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setFoveation(1.0);
    this.rig = new THREE.Group();
    scene.add(this.rig);
    this.body = { vy: 0 };
    this.turnLatch = false;
    this.hands = [];
    this.onStart = () => {};
    this.onEnd = () => {};
    this.setupHands();
    this.setupPanel();
    this.setupButton();
    renderer.xr.addEventListener('sessionstart', () => this.start());
    renderer.xr.addEventListener('sessionend', () => this.end());
  }

  get active() { return this.renderer.xr.isPresenting; }

  // ---- ボタン
  async setupButton() {
    const b = this.button;
    // 対応確認が返ってこない環境もあるので 3 秒で打ち切る
    const ok = await Promise.race([
      navigator.xr?.isSessionSupported('immersive-vr').catch(() => false),
      new Promise((done) => setTimeout(() => done(false), 3000)),
    ]);
    if (!ok) {
      b.textContent = 'VR 非対応';
      b.disabled = true;
      b.title = 'VR 機器がつながった PC の対応ブラウザ（Chrome / Edge など）で使えます';
      return;
    }
    b.textContent = 'VR開始';
    b.disabled = false;
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (this.session) { this.session.end(); return; }
      try {
        const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
        this.session = session;
        session.addEventListener('end', () => { this.session = null; });
        await this.renderer.xr.setSession(session);
      } catch (err) {
        console.warn(err);
        b.textContent = 'VR開始（失敗）';
      }
    });
  }

  // ---- 空間の手
  setupHands() {
    const factory = new XRControllerModelFactory();
    for (let i = 0; i < 2; i++) {
      const grip = this.renderer.xr.getControllerGrip(i);
      grip.add(factory.createControllerModel(grip));
      // 手のひらの位置に触れる点（触れているときは光る）
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xf0c36b, transparent: true, opacity: 0.55 }));
      palm.position.set(0, -0.01, -0.03);
      grip.add(palm);
      this.rig.add(grip);
      const ctl = this.renderer.xr.getController(i);
      this.rig.add(ctl);
      const hand = { grip, ctl, palm, source: null, touching: null, drag: null };
      ctl.addEventListener('connected', (e) => { hand.source = e.data; });
      ctl.addEventListener('disconnected', () => { hand.source = null; });
      ctl.addEventListener('selectstart', () => this.talk.input('vr'));
      ctl.addEventListener('squeezestart', () => this.grab(hand));
      ctl.addEventListener('squeezeend', () => this.release(hand));
      this.hands.push(hand);
    }
  }

  palmPos(hand, out = new THREE.Vector3()) { return hand.palm.getWorldPosition(out); }

  pulse(hand, strength = 0.5, ms = 60) {
    hand.source?.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms);
  }

  /** 手がいま触れている住人の部位（近い住人から） */
  touchAt(p) {
    let best = null;
    for (const r of this.residents.list) {
      if (r.root.position.distanceTo(p) > 2.5) continue;
      const hit = pickPoint(r.vrm, p);
      if (hit && (!best || hit.depth < best.depth)) best = { r, ...hit };
    }
    return best;
  }

  grab(hand) {
    const hit = this.touchAt(this.palmPos(hand));
    if (!hit || !GRAB[hit.part] || !hit.r.beginDrag(GRAB[hit.part])) return;
    hand.drag = hit.r;
    this.talk.touch(hit.r, 'pull');
    this.pulse(hand, 0.7, 80);
  }

  release(hand) {
    hand.drag?.endDrag();
    hand.drag = null;
  }

  // ---- 会話パネル（顔の前）
  setupPanel() {
    const c = document.createElement('canvas');
    c.width = PANEL_W; c.height = PANEL_H;
    this.panelCtx = c.getContext('2d');
    this.panelTex = new THREE.CanvasTexture(c);
    this.panelTex.colorSpace = THREE.SRGBColorSpace;
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8 * PANEL_H / PANEL_W),
      new THREE.MeshBasicMaterial({ map: this.panelTex, transparent: true, depthTest: false }));
    this.panel.renderOrder = 10;
    this.panel.position.set(0, -0.28, -0.9);
    this.panel.rotation.x = -0.2;
    this.panel.visible = false;
    this.camera.add(this.panel);
    this.talk.onShow = (m) => this.drawPanel(m);
  }

  drawPanel(m) {
    if (!m) { this.panel.visible = false; return; }
    const g = this.panelCtx;
    g.clearRect(0, 0, PANEL_W, PANEL_H);
    g.fillStyle = 'rgba(14,12,10,0.82)';
    g.strokeStyle = 'rgba(240,195,107,0.6)';
    g.lineWidth = 3;
    g.beginPath(); g.roundRect(4, 4, PANEL_W - 8, PANEL_H - 8, 22); g.fill(); g.stroke();
    g.font = '30px sans-serif';
    const nw = g.measureText(m.name).width + 36;
    g.fillStyle = m.isPlayer ? '#2f4f6b' : '#7a4a1c';
    g.beginPath(); g.roundRect(36, 28, nw, 46, 8); g.fill();
    g.fillStyle = '#fbe9c6';
    g.fillText(m.name, 54, 62);
    g.fillStyle = '#fff';
    g.font = '44px sans-serif';
    // 折り返し（日本語なので 1 文字ずつ測る）
    let line = '「', y = 140;
    for (const ch of `${m.text}」`) {
      if (g.measureText(line + ch).width > PANEL_W - 90) { g.fillText(line, 40, y); line = ''; y += 58; }
      line += ch;
    }
    g.fillText(line, 40, y);
    const hint = m.hint === 'ask' ? 'トリガーで返事・手で触れると…' : m.hint === 'news' ? 'リンクは通常モードで開けます'
      : m.hint === 'case' ? 'トリガーで集めた証拠を順に突きつける' : '';
    if (hint) { g.fillStyle = '#b8ad98'; g.font = '26px sans-serif'; g.fillText(hint, 40, PANEL_H - 30); }
    this.panelTex.needsUpdate = true;
    this.panel.visible = this.active; // 通常モードでは HTML の字幕だけ
  }

  // ---- 開始・終了
  start() {
    const p = this.player;
    this.rig.position.copy(p.feet);
    this.rig.rotation.set(0, p.yaw, 0);
    this.rig.add(this.camera);
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    this.body.vy = 0;
    this.button.textContent = 'VR終了';
    this.onStart();
  }

  end() {
    for (const h of this.hands) this.release(h);
    const head = this.camera.getWorldPosition(new THREE.Vector3());
    const yaw = new THREE.Euler().setFromQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    this.scene.add(this.camera);
    this.player.feet.set(head.x, this.rig.position.y, head.z);
    this.player.yaw = yaw;
    this.player.pitch = 0;
    this.player.sync();
    this.panel.visible = false;
    this.button.textContent = 'VR開始';
    this.onEnd();
  }

  // ---- 毎フレーム
  update(dt) {
    let move = null, turn = 0;
    for (const h of this.hands) {
      const gp = h.source?.gamepad;
      if (!gp) continue;
      const ax = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0], gp.axes[1]];
      if (h.source.handedness === 'left' && Math.hypot(ax[0], ax[1]) > 0.15) move = new THREE.Vector3(ax[0], 0, ax[1]);
      if (h.source.handedness === 'right') {
        if (Math.abs(ax[0]) > 0.7) { if (!this.turnLatch) turn = -Math.sign(ax[0]) * Math.PI / 6; this.turnLatch = true; }
        else if (Math.abs(ax[0]) < 0.3) this.turnLatch = false;
      }
    }
    const head = this.camera.getWorldPosition(new THREE.Vector3());
    if (turn) { // 頭の位置を中心に回る
      this.rig.position.sub(head).applyAxisAngle(UP, turn).add(head);
      this.rig.rotation.y += turn;
    }
    // 歩く: 体の位置 = 頭の真下。部屋の中を実際に歩いた分も当たり判定にかける
    const yaw = new THREE.Euler().setFromQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    const step = move ? move.clampLength(0, 1).applyAxisAngle(UP, yaw).multiplyScalar(BODY.walk * dt) : new THREE.Vector3();
    const feet = new THREE.Vector3(head.x, this.rig.position.y, head.z);
    const before = feet.clone();
    this.collision.moveBody(feet, step, dt, this.body);
    this.rig.position.x += feet.x - before.x;
    this.rig.position.z += feet.z - before.z;
    this.rig.position.y = feet.y;

    // 手で触れる・引っ張る
    const p = new THREE.Vector3();
    for (const h of this.hands) {
      if (!h.source) continue;
      this.palmPos(h, p);
      if (h.drag) { h.drag.dragTarget.copy(p); h.palm.material.color.set(0x7fd1ff); continue; }
      this.talk.game?.touchItem(p); // 証拠の品に触れたら拾う
      const hit = this.touchAt(p);
      const key = hit ? `${hit.r.name}:${hit.part}` : null;
      if (key && key !== h.touching && (performance.now() - (hit.r.lastTouched || 0)) / 1000 > TOUCH_COOLDOWN) {
        hit.r.lastTouched = performance.now();
        this.talk.touch(hit.r, hit.part);
        this.pulse(h);
      }
      h.touching = key;
      h.palm.material.color.set(hit ? 0xffe08a : 0xf0c36b);
      h.palm.material.opacity = hit ? 0.9 : 0.55;
    }
  }
}
