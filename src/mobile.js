/**
 * スマホのタッチ操作。
 *   左下のスティック: 移動（いっぱいに倒すと走る）
 *   画面をドラッグ: 視点
 *   タップ: onTap(x, y)（住人に触れる・返事）
 *   長押し: onHoldStart(x, y) が true を返したら、そのまま指を動かすと onHoldMove、離すと onHoldEnd（引っ張る）
 */
const TAP_MS = 280;      // これより短く、ほとんど動かさずに離したらタップ
const HOLD_MS = 350;     // これより長く動かさずに押していたら長押し
const SLOP = 10;         // タップ・長押しとみなす指のぶれ(px)
const LOOK_SPEED = 0.005;

export class TouchControls {
  constructor({ surface, stick, player, onTap, onHoldStart, onHoldMove, onHoldEnd }) {
    Object.assign(this, { surface, player, onTap, onHoldStart, onHoldMove, onHoldEnd });
    this.stick = stick;
    this.knob = stick.querySelector('i');
    this.stickId = null;
    this.looks = new Map(); // touch id → { x, y, sx, sy, t, held, timer }
    this.enabled = true;

    stick.addEventListener('touchstart', (e) => this.stickStart(e), { passive: false });
    surface.addEventListener('touchstart', (e) => this.lookStart(e), { passive: false });
    addEventListener('touchmove', (e) => this.move(e), { passive: false });
    addEventListener('touchend', (e) => this.end(e));
    addEventListener('touchcancel', (e) => this.end(e));
  }

  // ---- スティック
  stickStart(e) {
    e.preventDefault();
    if (this.stickId !== null) return;
    const t = e.changedTouches[0];
    this.stickId = t.identifier;
    this.stickMove(t);
  }

  stickMove(t) {
    const r = this.stick.getBoundingClientRect();
    const R = r.width / 2;
    let dx = t.clientX - (r.left + R), dy = t.clientY - (r.top + R);
    const len = Math.hypot(dx, dy);
    if (len > R) { dx *= R / len; dy *= R / len; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // 画面の上 = 前（-z）
    this.player.touchMove = { x: dx / R, z: dy / R };
  }

  // ---- 視点・タップ・長押し
  lookStart(e) {
    e.preventDefault();
    if (!this.enabled) return;
    for (const t of e.changedTouches) {
      const s = { x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t: performance.now(), held: false, moved: false };
      s.timer = setTimeout(() => {
        if (!s.moved && this.onHoldStart(s.x, s.y)) s.held = true;
      }, HOLD_MS);
      this.looks.set(t.identifier, s);
    }
  }

  move(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) { e.preventDefault(); this.stickMove(t); continue; }
      const s = this.looks.get(t.identifier);
      if (!s) continue;
      e.preventDefault();
      if (Math.hypot(t.clientX - s.sx, t.clientY - s.sy) > SLOP) s.moved = true;
      if (s.held) this.onHoldMove(t.clientX, t.clientY);
      else if (s.moved) {
        const p = this.player;
        p.yaw -= (t.clientX - s.x) * LOOK_SPEED;
        p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - (t.clientY - s.y) * LOOK_SPEED));
      }
      s.x = t.clientX; s.y = t.clientY;
    }
  }

  end(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.knob.style.transform = '';
        this.player.touchMove = null;
        continue;
      }
      const s = this.looks.get(t.identifier);
      if (!s) continue;
      clearTimeout(s.timer);
      this.looks.delete(t.identifier);
      if (s.held) this.onHoldEnd();
      else if (!s.moved && performance.now() - s.t < TAP_MS) this.onTap(t.clientX, t.clientY);
    }
  }
}
