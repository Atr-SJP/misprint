'use strict';
/* =========================================================
   MISPRINT — core
   Math helpers, palette, page layout, settings, input.
   ========================================================= */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
};

const Ease = {
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inQuad: (t) => t * t,
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outElastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- palette: three spot inks + key, on paper ---------- */
const PAPER = '#F3EEE4';
const PAPER_HI = '#F8F5EE';
const INK = { p: '#FF4F8B', b: '#1C6BC7', y: '#FFC21F', k: '#24201F' };
const COLOR_INKS = ['p', 'b', 'y'];
const INK_NAME = { p: 'pink', b: 'blue', y: 'yellow', k: 'black' };

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) {
  const c = hexRgb(hex);
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

/* ---------- page layout, in logical units ---------- */
const PAGE_W = 720;
const PAGE_H = 1010;
const FIELD = { x: 40, y: 82, w: 640, h: 868 };
FIELD.r = FIELD.x + FIELD.w;
FIELD.b = FIELD.y + FIELD.h;
FIELD.cx = FIELD.x + FIELD.w / 2;

const GRID = { cols: 13, rows: 15, cw: 48, ch: 24 };
GRID.x = FIELD.x + (FIELD.w - GRID.cols * GRID.cw) / 2;
GRID.y = FIELD.y + 48;

const BRICK_INSET = 2;              // visual gap around a brick body
const BRICK_W = GRID.cw - BRICK_INSET * 2;
const BRICK_H = GRID.ch - BRICK_INSET * 2;
const LAYER_STEP = 4;               // how far each deeper layer peeks out

const PANEL_GAP = 60;               // between the field and the side panels (wide layout)

const PADDLE_Y = FIELD.b - 76;
const PADDLE_H = 14;
const BALL_R = 8;

/* ---------- persistent settings ---------- */
const Store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('misprint.' + k);
      return v === null ? d : JSON.parse(v);
    } catch (e) { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('misprint.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ }
  },
};

const Settings = {
  sfx: Store.get('sfx', true),
  music: Store.get('music', true),
  shake: Store.get('shake', 2),        // 0 off · 1 gentle · 2 full
  patterns: Store.get('patterns', false),
  save() {
    Store.set('sfx', this.sfx);
    Store.set('music', this.music);
    Store.set('shake', this.shake);
    Store.set('patterns', this.patterns);
  },
};

/* ---------- input ----------
   Gameplay input only. Menus are plain DOM buttons. */
const Input = {
  left: false,
  right: false,
  px: null,               // pointer x, client px
  usePointer: true,
  hold: false,
  queue: [],
  primaryTouch: null,
  gameActive: false,      // true while a run is on screen and unpaused

  init() {
    addEventListener('keydown', (e) => this.key(e, true));
    addEventListener('keyup', (e) => this.key(e, false));

    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && e.pointerId !== this.primaryTouch) return;
      this.px = e.clientX;
      this.usePointer = true;
    }, { passive: true });

    const cv = document.getElementById('game');
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        if (this.primaryTouch === null) {
          this.primaryTouch = e.pointerId;
          this.px = e.clientX;
          this.usePointer = true;
          this.queue.push('tap');
        } else {
          this.queue.push('press');   // second finger smashes
        }
      } else if (e.button === 0) {
        this.px = e.clientX;
        this.queue.push('press');
        this.hold = true;
      }
    });
    const up = (e) => {
      if (e.pointerType === 'touch') {
        if (e.pointerId === this.primaryTouch) this.primaryTouch = null;
      } else {
        this.hold = false;
      }
    };
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);

    addEventListener('blur', () => {
      this.left = this.right = this.hold = false;
      this.queue.push('blur');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.queue.push('blur');
    });
    addEventListener('contextmenu', (e) => { if (this.gameActive) e.preventDefault(); });
  },

  key(e, down) {
    const c = e.code;
    if (c === 'ArrowLeft' || c === 'KeyA') {
      this.left = down;
      if (down) this.usePointer = false;
      if (this.gameActive) e.preventDefault();
    } else if (c === 'ArrowRight' || c === 'KeyD') {
      this.right = down;
      if (down) this.usePointer = false;
      if (this.gameActive) e.preventDefault();
    } else if (c === 'Space' || c === 'ArrowUp' || c === 'KeyW') {
      if (!this.gameActive) return;           // let focused menu buttons work
      e.preventDefault();
      if (down && !e.repeat) this.queue.push('press');
      this.hold = down;
    } else if (down && (c === 'Escape' || c === 'KeyP')) {
      this.queue.push('pause');
    } else if (down && c === 'KeyM') {
      this.queue.push('mute');
    }
  },

  take() {
    const q = this.queue;
    this.queue = [];
    return q;
  },
};
