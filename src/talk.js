import * as THREE from 'three';
import { TALK, NOTICE_OUT } from './npc.js';

const ANSWER_TIME = 3;   // 話しかけられてから、返事を待つ秒数
const AFTER_TIME = 2.6;  // 返事・反応のせりふを見せる秒数
const PLAYER = { name: 'あなた', reply: '特に何も……' };

/**
 * 会話の流れ:
 *   正面に来る → 住人が話しかける（ほかの住人は通常の動きへ）
 *   3 秒以内にスペース／クリック → 返事（住人以外をクリック）か、頭のクリックで住人が反応
 *   3 秒たつ・離れる → 住人は興味を失って元の動きへ（いったん離れるまで再び反応しない）
 */
export class Conversation {
  constructor(dialog, residents, camera) {
    this.dialog = dialog;
    this.who = dialog.querySelector('.who');
    this.line = dialog.querySelector('.line');
    this.hint = dialog.querySelector('.hint');
    this.bar = dialog.querySelector('.timer i');
    this.residents = residents;
    this.camera = camera;
    this.state = 'none'; // none | ask | after
    this.r = null;
    this.t = 0;
    this.ray = new THREE.Ray();
  }

  show(name, text, isPlayer = false) {
    this.who.textContent = name;
    this.who.classList.toggle('player', isPlayer);
    this.line.textContent = `「${text}」`;
    this.dialog.classList.add('show');
  }

  /** candidate = 正面で話せる住人（いなければ null） */
  update(dt, candidate) {
    if (this.state === 'none') {
      if (candidate) this.start(candidate);
      return;
    }
    if (this.r.dist > NOTICE_OUT) { this.end(); return; } // プレイヤーが立ち去った
    if (this.state === 'ask') {
      this.t += dt;
      this.bar.style.width = `${Math.max(0, 1 - this.t / ANSWER_TIME) * 100}%`;
      if (this.t >= ANSWER_TIME) this.end();
    } else {
      this.t -= dt;
      if (this.t <= 0) this.end();
    }
  }

  start(r) {
    this.r = r;
    this.state = 'ask';
    this.t = 0;
    this.residents.focus(r);
    this.show(TALK[r.name].name, TALK[r.name].line);
    this.dialog.classList.add('asking');
  }

  /** スペース（kind = 'key'）か、照準でのクリック（kind = 'click'） */
  input(kind) {
    if (this.state !== 'ask') return;
    if (kind === 'click') {
      this.camera.getWorldPosition(this.ray.origin);
      this.camera.getWorldDirection(this.ray.direction);
      const hit = this.r.hitTest(this.ray);
      if (hit === 'head') { this.after(TALK[this.r.name].name, TALK[this.r.name].pat); this.r.reactPat(); return; }
      if (hit === 'body') return; // 住人の体のクリックは返事にしない
    }
    this.after(PLAYER.name, PLAYER.reply, true);
  }

  after(name, text, isPlayer) {
    this.state = 'after';
    this.t = AFTER_TIME;
    this.dialog.classList.remove('asking');
    this.show(name, text, isPlayer);
  }

  end() {
    this.dialog.classList.remove('show', 'asking');
    this.r.loseInterest();
    this.residents.unfocus();
    this.r = null;
    this.state = 'none';
  }
}
