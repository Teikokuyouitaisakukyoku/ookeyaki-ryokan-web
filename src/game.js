import * as THREE from 'three';
import { CASE, MOMENTS } from './story.js';
import { TALK } from './npc.js';
import { now } from './schedule.js';

const REACH = 2.5;      // 証拠の品に手が届く距離
const PICK_R = 0.18;    // 照準がこの距離まで品に寄っていれば拾える
const TOUCH_R = 0.15;   // VR の手がこの距離まで品に近づけば拾える
const PICKS = 3;        // 1 日に崩す言い訳の数

// 進み具合はブラウザに保存する（端末ごと。読めない環境でも遊べるようにする）
const load = (key, def) => { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } };
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const nameOf = (who) => TALK[who].name;
const fmtH = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/** 日付から決まる乱数（同じ日なら何度読み込んでも同じ事件になる） */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** その日の事件: 言い訳 3 つ（証言と現物を少なくとも 1 つずつ）と、現物の置き場所 */
function caseOfDay(d) {
  const r = rng(d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate());
  const pick = (list) => list.splice(Math.floor(r() * list.length), 1)[0];
  const talks = CASE.pairs.filter((p) => p.from), items = CASE.pairs.filter((p) => p.item);
  const chosen = [pick(talks), pick(items)];
  const rest = [...talks, ...items];
  while (chosen.length < PICKS) chosen.push(pick(rest));
  for (let i = chosen.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
  return chosen.map((p) => ({ ...p, spot: p.spots ? p.spots[Math.floor(r() * p.spots.length)] : null }));
}

/** 証拠の品の見た目（小さく作り、光の粒で見つけやすくする） */
function itemMesh(kind) {
  const g = new THREE.Group();
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...extra });
  if (kind === 'cup') {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.055, 20, 1, true), mat(0xf4f0e6, { side: THREE.DoubleSide }));
    cup.position.y = 0.028;
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), mat(0x8a4a1c));
    bottom.rotation.x = -Math.PI / 2; bottom.position.y = 0.004; // 底に残ったカラメル
    g.add(cup, bottom);
    g.rotation.z = 1.4; // 倒れている
    g.position.y = 0.03;
  } else if (kind === 'spoon') {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.006, 0.014), mat(0xd8d8de, { metalness: 0.8, roughness: 0.25 }));
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), mat(0x9a5a24, { metalness: 0.3 }));
    bowl.scale.set(1.3, 0.3, 1); bowl.position.x = 0.07;
    g.add(handle, bowl);
    g.position.y = 0.006;
  } else {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 192;
    const x = c.getContext('2d');
    x.fillStyle = '#fbf6e8'; x.fillRect(0, 0, 256, 192);
    x.fillStyle = '#5a3a2a'; x.font = 'bold 30px sans-serif'; x.textAlign = 'center';
    x.fillText('ごちそうさま', 128, 86); x.fillText('ですん！', 128, 130);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const memo = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.09), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    memo.rotation.x = -Math.PI / 2; memo.position.y = 0.003;
    g.add(memo);
  }
  // 光の粒
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d'), grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,240,190,1)'); grd.addColorStop(0.3, 'rgba(255,220,140,.5)'); grd.addColorStop(1, 'rgba(255,220,140,0)');
  x.fillStyle = grd; x.fillRect(0, 0, 64, 64);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  glow.scale.setScalar(0.25);
  glow.position.y = 0.08;
  glow.renderOrder = 5;
  g.add(glow);
  g.userData.glow = glow;
  return g;
}

/**
 * ゲームの進行: 限定プリン事件と、できごと図鑑。会話（talk.js）から呼ばれて、住人の台詞を差し替える。
 *   事件: その日はじめて話しかけると始まる → 証言を聞く・品を拾って証拠を集める → 真九郎に話しかけると言い訳をするので、
 *         証拠を突きつけて崩す（3 つ）→ 白状して解決。毎日新しい事件になる
 *   図鑑: 決まった時間・場所の住人に話しかける（夜中に起こす）と記録される
 */
export class Game {
  constructor({ scene, collision, toast, notebook }) {
    Object.assign(this, { scene, collision, toast, notebook });
    this.found = new Set(load('moments', []));
    this.solvedTotal = load('pudding-solved', 0);
    this.items = [];
    this.day = null;
    this.refreshDay();
    notebook.addEventListener('click', () => this.toggleNotebook(false));
  }

  // ---- 1 日ごとの事件
  refreshDay() {
    const d = now(), key = dayKey(d);
    if (key === this.day) return;
    this.day = key;
    this.pairs = caseOfDay(d);
    this.state = load(`pudding-${key}`, { started: false, evidence: [], broken: 0, solved: false, after: [] });
    this.placeItems();
  }

  store() { save(`pudding-${this.day}`, this.state); }

  get active() { return this.state.started && !this.state.solved; }

  placeItems() {
    for (const it of this.items) this.scene.remove(it.mesh);
    this.items = [];
    for (const p of this.pairs) {
      if (!p.item) continue;
      const mesh = itemMesh(p.item);
      const [x, y, z] = p.spot.pos;
      const floor = this.collision.groundAt(new THREE.Vector3(x, y, z)); // 置き場所の床・台の上に置く
      mesh.position.set(x, (floor ?? y - 0.3) + mesh.position.y, z);
      mesh.rotation.y = x * 7.3 + z * 3.1; // 向きは場所ごとにばらつかせる
      this.scene.add(mesh);
      this.items.push({ pair: p, mesh });
    }
    this.updateItems();
  }

  /** 事件の最中で、まだ拾っていない品だけ見せる */
  updateItems() {
    for (const it of this.items) it.mesh.visible = this.active && !this.state.evidence.includes(it.pair.id);
  }

  start() {
    this.state.started = true;
    this.store();
    this.updateItems();
    this.toast(`${CASE.title}が起きた（Tab／「手帳」で証拠を確認）`);
  }

  gain(pair) {
    if (this.state.evidence.includes(pair.id)) return;
    this.state.evidence.push(pair.id);
    this.store();
    this.updateItems();
    this.toast(`証拠を手に入れた：${pair.evidence}`);
  }

  // ---- 会話から
  /**
   * 住人 r に話しかけた: 差し替える台詞を返す。
   *   { text } 第一声を差し替える / { interrogate: true } 真九郎を問い詰める / null いつもの会話
   */
  onTalk(r) {
    this.refreshDay();
    const m = r.momentNow();
    if (m && !this.found.has(m.id)) { this.discover(m); return { text: m.line }; }
    const st = this.state;
    if (!st.started) { this.start(); return { text: CASE.intro[r.name] }; }
    if (st.solved) {
      if (!st.after.includes(r.name)) { st.after.push(r.name); this.store(); return { text: CASE.after[r.name] }; }
    } else {
      if (r.name === 'shinkuro') return { interrogate: true };
      const p = this.pairs.find((q) => q.from === r.name && !st.evidence.includes(q.id));
      if (p) { this.gain(p); return { text: p.get }; }
    }
    return m ? { text: m.line } : null;
  }

  /** 問い詰める: 今の言い訳と、突きつけられる証拠 */
  question() {
    return {
      excuse: this.pairs[this.state.broken].excuse,
      choices: this.pairs.filter((p) => this.state.evidence.includes(p.id)).map((p) => ({ id: p.id, label: p.evidence })),
      empty: CASE.noEvidence,
    };
  }

  /** 証拠 id を突きつけた: 続く台詞 [[話し手, 文, プレイヤーか]] と、続けて問い詰めるか */
  present(id) {
    const p = this.pairs.find((q) => q.id === id), target = this.pairs[this.state.broken];
    const shin = nameOf('shinkuro'), me = 'あなた';
    const say = p.present.replace('{spot}', p.spot?.name ?? '');
    if (p !== target) return { lines: [[me, say, true], [shin, CASE.wrong[Math.floor(Math.random() * CASE.wrong.length)]]], again: true };
    this.state.broken++;
    const lines = [[me, say, true], [shin, p.react]];
    if (this.state.broken < this.pairs.length) { this.store(); return { lines, again: true }; }
    this.state.solved = true;
    this.solvedTotal++;
    save('pudding-solved', this.solvedTotal);
    this.store();
    this.updateItems();
    return { lines: [...lines, ...CASE.confess.map((t) => [shin, t])], again: false, solved: true };
  }

  /** 事件を解決した（白状の台詞を見せ終えた） */
  solvedToast() { this.toast(`${CASE.title}、解決！（これまでに ${this.solvedTotal} 件）`); }

  // ---- 証拠の品を拾う
  /** 照準（ray）の先の品を拾う。拾えたら true */
  pickItem(ray) {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      const p = it.mesh.position;
      if (ray.origin.distanceTo(p) > REACH + 0.5 || ray.distanceSqToPoint(p) > PICK_R ** 2) continue;
      this.gain(it.pair);
      return true;
    }
    return false;
  }

  /** VR の手（point）が品に触れたら拾う */
  touchItem(point) {
    for (const it of this.items) if (it.mesh.visible && point.distanceTo(it.mesh.position) < TOUCH_R) this.gain(it.pair);
  }

  /** 毎フレーム: 光の粒をゆらす・日付が変わったら新しい事件に */
  update(t) {
    if (Math.floor(t) !== this.lastSec) { this.lastSec = Math.floor(t); this.refreshDay(); }
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      const s = 0.2 + 0.07 * Math.sin(t * 3 + it.mesh.position.x);
      it.mesh.userData.glow.scale.setScalar(s);
    }
  }

  // ---- できごと図鑑
  discover(m) {
    if (this.found.has(m.id)) return;
    this.found.add(m.id);
    save('moments', [...this.found]);
    this.toast(`できごと図鑑に記録：「${m.title}」（${this.found.size}/${MOMENTS.length}）`);
  }

  /** 夜中に住人を起こした */
  woke(r) {
    const m = MOMENTS.find((q) => q.wake && q.who === r.name);
    if (m) this.discover(m);
  }

  // ---- 手帳（Tab／スマホは「手帳」ボタン）
  toggleNotebook(open = !this.notebook.classList.contains('show')) {
    if (open) this.renderNotebook();
    this.notebook.classList.toggle('show', open);
  }

  renderNotebook() {
    this.refreshDay();
    const st = this.state, esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const status = !st.started ? 'まだ何も起きていない（誰かに話しかけると始まる）'
      : st.solved ? '解決！ 犯人は真九郎だった' : `調査中（崩した言い訳 ${st.broken}/${this.pairs.length}）`;
    const ev = this.pairs.map((p) => {
      if (st.evidence.includes(p.id)) return `<li class="got"><b>${esc(p.evidence)}</b><span>${esc(p.desc)}</span></li>`;
      if (!st.started) return '';
      const hint = p.from ? `${nameOf(p.from)}が何か知っているかも` : `${p.spot.name}のあたりを探そう`;
      return `<li><b>？？？</b><span>${esc(hint)}</span></li>`;
    }).join('');
    const when = (m) => (m.wake ? m.hint : `${m.days ? `${'日月火水木金土'[m.days[0]]}曜 ` : ''}${m.sunset ? '日の入りのころ' : `${fmtH(m.from)}〜${fmtH(m.to)}`}`);
    const moments = MOMENTS.map((m) => (this.found.has(m.id)
      ? `<li class="got"><b>${esc(m.title)}</b><span>${nameOf(m.who)}・${when(m)}</span></li>`
      : `<li><b>？？？</b><span>${nameOf(m.who)}・${when(m)}</span></li>`)).join('');
    this.notebook.innerHTML = `<div class="card">
      <h3>${CASE.title}<small>これまでに ${this.solvedTotal} 件解決</small></h3>
      <p>${status}</p><ul>${ev}</ul>
      <h3>できごと図鑑<small>${this.found.size}/${MOMENTS.length}</small></h3>
      <ul class="moments">${moments}</ul>
      <p class="close"><span class="only-pc"><kbd>Tab</kbd> で閉じる</span><span class="only-mobile">タップで閉じる</span></p></div>`;
  }
}
