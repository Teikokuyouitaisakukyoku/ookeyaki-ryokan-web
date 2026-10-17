import * as THREE from 'three';
import { TALK, NOTICE_OUT } from './npc.js';
import { NEWS } from './news.js';
import { TOUCH } from './touch.js';

const ANSWER_TIME = 3;   // 話しかけられてから、返事を待つ秒数
const AFTER_TIME = 2.6;  // 返事・反応のせりふを見せる秒数
const REPLY_TIME = 1.6;  // お知らせへ続くときの、返事を見せる秒数
const NEWS_TIME = 20;    // お知らせを見せておく最長の秒数
const PLAYER = { name: 'あなた', reply: '特に何も……' };

/**
 * 会話の流れ:
 *   正面に来る → 住人が話しかける（ほかの住人は通常の動きへ）
 *   3 秒以内にスペース／クリック → 返事（住人以外をクリック）か、頭のクリックで住人が反応
 *   3 秒たつ・離れる → 住人は興味を失って元の動きへ（いったん離れるまで再び反応しない）
 *   返事のあとはお知らせ（リンク付き）を話す。リンクを押せるようカーソルを解放し、
 *   リンクのクリック・Enter で開く。画面クリック（視点操作に戻る）・立ち去る・時間切れで終わる
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
    this.state = 'none'; // none | ask | after | news
    this.r = null;
    this.t = 0;
    this.ray = new THREE.Ray();
    this.onEnd = () => {};
    this.onShow = () => {}; // VR のパネルへ同じ内容を出す: ({ name, text, isPlayer, hint }) か null
  }

  show(name, text, isPlayer = false, link = null) {
    this.who.textContent = name;
    this.who.classList.toggle('player', isPlayer);
    this.line.replaceChildren();
    const at = link ? text.indexOf(link.label) : -1;
    if (at < 0) {
      this.line.textContent = `「${text}」`;
    } else {
      const a = document.createElement('a');
      a.href = link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = link.label;
      a.addEventListener('click', () => this.end());
      this.line.append(`「${text.slice(0, at)}`, a, `${text.slice(at + link.label.length)}」`);
    }
    this.dialog.classList.add('show');
    this.onShow({ name, text, isPlayer, hint: this.state === 'ask' ? 'ask' : link ? 'news' : null });
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
      if (this.t <= 0) (this.next ? this.next() : this.end());
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

  /** 住人に触れた（part）・引っ張り始めた（part = 'pull'）: 反応のせりふを出す */
  touch(r, part) {
    const line = part === 'pull' ? TOUCH[r.name].pull.line : r.reactTouch(part);
    if (!line) return;
    if (this.state !== 'none' && this.r !== r) this.end();
    if (this.state === 'none') { this.r = r; this.residents.focus(r); }
    this.after(TALK[r.name].name, line);
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
    const news = NEWS?.lines?.[this.r.name];
    this.after(PLAYER.name, PLAYER.reply, true, news ? () => this.news(news) : null);
  }

  after(name, text, isPlayer, next = null) {
    this.state = 'after';
    this.t = next ? REPLY_TIME : AFTER_TIME;
    this.next = next;
    this.dialog.classList.remove('asking', 'news');
    this.show(name, text, isPlayer);
  }

  /** お知らせ: リンクを押せるようにカーソルを解放する */
  news(text) {
    this.state = 'news';
    this.t = NEWS_TIME;
    this.next = null;
    this.show(TALK[this.r.name].name, text, false, NEWS);
    this.dialog.classList.add('news');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Enter: お知らせのリンクを開く */
  openLink() {
    if (this.state !== 'news') return;
    window.open(NEWS.url, '_blank', 'noopener');
    this.end();
  }

  /** 視点操作に戻った（画面をクリックしてカーソルが隠れた） */
  relocked() {
    if (this.state === 'news') this.end();
  }

  end() {
    if (this.state === 'none') return;
    this.next = null;
    this.onShow(null);
    this.dialog.classList.remove('show', 'asking', 'news');
    this.r.loseInterest();
    this.residents.unfocus();
    this.r = null;
    this.state = 'none';
    this.onEnd();
  }
}
