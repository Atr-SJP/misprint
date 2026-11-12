'use strict';
/* =========================================================
   MISPRINT — the print shop
   Canvas setup, colour plates (misregistration), grain,
   halftone, the decal sheet that records play, rubber
   stamps, type helpers and the icon set.
   ========================================================= */

const FONT_DISPLAY = '"Alfa Slab One", Rockwell, "Roboto Slab", Georgia, serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';
const fDisplay = (px) => `${px}px ${FONT_DISPLAY}`;
const fMono = (px, w = 500) => `${w} ${px}px ${FONT_MONO}`;

/* ---------- canvas & view ---------- */
const Gfx = {
  cv: null, ctx: null, grainCv: null, wipeCv: null, wipeCtx: null,
  W: 0, H: 0, dpr: 1, s: 1, ox: 0, oy: 0,

  init() {
    this.cv = document.getElementById('game');
    this.ctx = this.cv.getContext('2d');
    this.grainCv = document.getElementById('grain');
    this.wipeCv = document.getElementById('wipe');
    this.wipeCtx = this.wipeCv.getContext('2d');
    this.resize();
    addEventListener('resize', () => this.resize());
  },

  resize() {
    const dpr = (this.dpr = Math.min(window.devicePixelRatio || 1, 2));
    const W = (this.W = window.innerWidth);
    const H = (this.H = window.innerHeight);
    for (const c of [this.cv, this.grainCv, this.wipeCv]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    this.layout();
    Grain.paint(this.grainCv, dpr);
    if (typeof Title !== 'undefined') Title.layout();
    if (typeof Wipe !== 'undefined' && Wipe.active) Wipe.draw();
  },

  /** Wide windows: the field fills the height and panels hang either side.
      Narrow windows: the original portrait page with HUD above and below. */
  layout() {
    const W = this.W, H = this.H;
    const top = FIELD.y - 34, bot = FIELD.b + 46;
    const sW = (H - 20) / (bot - top);
    const side = (W / sW - FIELD.w) / 2;
    const panel = Math.min(410, side - 36 - PANEL_GAP);
    if (W / H > 1.12 && panel >= 230) {
      this.mode = 'wide';
      this.s = sW;
      this.ox = W / 2 - FIELD.cx * sW;
      this.oy = (H - (bot - top) * sW) / 2 - top * sW;
      this.panelW = panel;
    } else {
      this.mode = 'tall';
      const s = Math.min(W / PAGE_W, H / PAGE_H);
      this.s = s;
      this.ox = (W - PAGE_W * s) / 2;
      this.oy = (H - PAGE_H * s) / 2;
      this.panelW = 0;
    }
  },

  page(ctx = this.ctx) {
    ctx.setTransform(this.s * this.dpr, 0, 0, this.s * this.dpr, this.ox * this.dpr, this.oy * this.dpr);
  },
  screen(ctx = this.ctx) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  },
  toPageX(cx) { return (cx - this.ox) / this.s; },
};

/* ---------- paper grain: ink voids + fibres, printed once ---------- */
const Grain = {
  tile: null,

  makeTile() {
    const N = 256;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const d = img.data;
    const r = mulberry32(7);
    for (let i = 0; i < N * N; i++) {
      const v = r();
      const o = i * 4;
      if (v < 0.032) {            // speck where the ink didn't take
        d[o] = 255; d[o + 1] = 253; d[o + 2] = 247; d[o + 3] = 60 + r() * 120;
      } else if (v < 0.07) {      // paper fibre
        d[o] = 72; d[o + 1] = 60; d[o + 2] = 48; d[o + 3] = 8 + r() * 16;
      }
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(84,70,56,0.07)';
    g.lineWidth = 0.6;
    for (let i = 0; i < 28; i++) {
      const x = r() * N, y = r() * N, a = r() * TAU, l = 3 + r() * 10;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a + 0.7) * l * 0.5, y + Math.sin(a + 0.7) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    return c;
  },

  paint(cv, dpr) {
    if (!this.tile) this.tile = this.makeTile();
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.imageSmoothingEnabled = false;
    const sc = Math.max(1, Math.round(dpr));
    g.setTransform(sc, 0, 0, sc, 0, 0);
    g.fillStyle = g.createPattern(this.tile, 'repeat');
    g.fillRect(0, 0, cv.width / sc + 1, cv.height / sc + 1);
    g.setTransform(1, 0, 0, 1, 0, 0);
  },
};

/* ---------- colour plates ----------
   Every ink is drawn through its own plate offset. Big hits
   knock the plates out of register; they spring back. */
const Plates = {
  p: { x: 0.9, y: -0.6, vx: 0, vy: 0, rx: 0.9, ry: -0.6 },
  b: { x: -0.7, y: 0.6, vx: 0, vy: 0, rx: -0.7, ry: 0.6 },
  y: { x: 0.6, y: 0.9, vx: 0, vy: 0, rx: 0.6, ry: 0.9 },
  k: { x: 0, y: 0, vx: 0, vy: 0, rx: 0, ry: 0 },
  ids: ['p', 'b', 'y', 'k'],
  gain: 1,

  kick(power, keyShare = 0.25) {
    const m = (Settings.shake === 0 ? 0 : Settings.shake === 1 ? 0.3 : 1) * this.gain;
    if (!m || power <= 0) return;
    for (const id of this.ids) {
      const pl = this[id];
      const a = Math.random() * TAU;
      const mag = power * m * (id === 'k' ? keyShare : rand(0.65, 1)) * 120;
      pl.vx += Math.cos(a) * mag;
      pl.vy += Math.sin(a) * mag;
    }
  },

  update(dt) {
    const K = 300, C = 15;
    for (const id of this.ids) {
      const pl = this[id];
      let t = dt;
      while (t > 1e-6) {
        const h = Math.min(t, 1 / 120);
        t -= h;
        pl.vx += (-K * (pl.x - pl.rx) - C * pl.vx) * h;
        pl.vy += (-K * (pl.y - pl.ry) - C * pl.vy) * h;
        pl.x += pl.vx * h;
        pl.y += pl.vy * h;
      }
      pl.x = clamp(pl.x, pl.rx - 18, pl.rx + 18);
      pl.y = clamp(pl.y, pl.ry - 18, pl.ry + 18);
    }
  },
};

/* ---------- halftone ---------- */
function halftoneDisc(ctx, cx, cy, R, step, angle, fn) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const n = Math.ceil(R / step) + 1;
  ctx.beginPath();
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const lx = i * step, ly = j * step;
      const x = lx * ca - ly * sa;
      const y = lx * sa + ly * ca;
      const d = Math.sqrt(x * x + y * y) / R;
      if (d > 1) continue;
      const r = fn(d, x / R, y / R) * step * 0.5;
      if (r < 0.25) continue;
      ctx.moveTo(cx + x + r, cy + y);
      ctx.arc(cx + x, cy + y, r, 0, TAU);
    }
  }
  ctx.fill();
}

/** Halftone over a rect, dot size from any function of position (0..1). */
function halftoneField(g, x0, y0, w, h, step, angle, fn) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const cx = x0 + w / 2, cy = y0 + h / 2;
  const n = Math.ceil(Math.hypot(w, h) / 2 / step) + 1;
  g.beginPath();
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const lx = i * step, ly = j * step;
      const x = cx + lx * ca - ly * sa;
      const y = cy + lx * sa + ly * ca;
      if (x < x0 - step || x > x0 + w + step || y < y0 - step || y > y0 + h + step) continue;
      const r = clamp(fn(x, y), 0, 1.15) * step * 0.5;
      if (r < 0.3) continue;
      g.moveTo(x + r, y);
      g.arc(x, y, r, 0, TAU);
    }
  }
  g.fill();
}

const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ---------- backdrop: a pale printed poster behind each plate ---------- */
const Backdrop = {
  k: 1.5,
  cv: null,
  g: null,
  has: false,

  init() {
    this.cv = document.createElement('canvas');
    this.cv.width = Math.round(FIELD.w * this.k);
    this.cv.height = Math.round(FIELD.h * this.k);
    this.g = this.cv.getContext('2d');
  },

  /** paint(g) draws in field-local units: x 0..640, y 0..868. */
  build(paint) {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    this.has = !!paint;
    if (!paint) return;
    g.setTransform(this.k, 0, 0, this.k, 0, 0);
    g.save();
    paint(g);
    g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);
  },

  draw(ctx, alpha) {
    if (!this.has) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.cv, FIELD.x, FIELD.y, FIELD.w, FIELD.h);
    ctx.restore();
  },
};

/* ---------- ink splat ---------- */
function splatPath(ctx, x, y, s, dx = 0, dy = 0, rng = Math.random) {
  const r0 = s * (0.42 + rng() * 0.2);
  ctx.moveTo(x + r0, y);
  ctx.arc(x, y, r0, 0, TAU);
  const n = 5 + ((rng() * 5) | 0);
  const dir = dx || dy ? Math.atan2(dy, dx) : null;
  for (let i = 0; i < n; i++) {
    const a = dir === null ? rng() * TAU : dir + (rng() - 0.5) * 2.4;
    const dist = s * (0.5 + rng() * 1.15);
    const r = Math.max(0.7, s * (0.07 + rng() * 0.2) * (1.25 - dist / (s * 1.9)));
    const px = x + Math.cos(a) * dist, py = y + Math.sin(a) * dist;
    ctx.moveTo(px + r, py);
    ctx.arc(px, py, r, 0, TAU);
  }
}

/* ---------- decal sheet ----------
   Two sheets. The live sheet sits faintly under play: splats
   and the ball's hairline path. The print sheet also takes a
   full-strength impression of every layer you peel, each ink
   on its own slightly-off plate — so clearing a plate prints
   its picture, overprinted, with your play scrawled across. */
const PRINT_REG = { p: [1.6, -1.1], b: [-1.3, 1.0], y: [1.0, 1.7], k: [0, 0] };

const Decal = {
  k: 1.25,
  live: null, lg: null,
  print: null, pg: null,

  init() {
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(FIELD.w * this.k);
      c.height = Math.round(FIELD.h * this.k);
      return c;
    };
    this.live = mk();
    this.print = mk();
    this.lg = this.live.getContext('2d');
    this.pg = this.print.getContext('2d');
  },
  clear() {
    this.lg.clearRect(0, 0, this.live.width, this.live.height);
    this.pg.clearRect(0, 0, this.print.width, this.print.height);
    this.bb = null;
  },
  tx(x) { return (x - FIELD.x) * this.k; },
  ty(y) { return (y - FIELD.y) * this.k; },

  /** Grow the region of real marks (field coords), used to crop the print. */
  track(x0, y0, x1, y1) {
    const a = x0 - FIELD.x, b = y0 - FIELD.y, c = x1 - FIELD.x, d = y1 - FIELD.y;
    if (!this.bb) this.bb = { x0: a, y0: b, x1: c, y1: d };
    else {
      this.bb.x0 = Math.min(this.bb.x0, a); this.bb.y0 = Math.min(this.bb.y0, b);
      this.bb.x1 = Math.max(this.bb.x1, c); this.bb.y1 = Math.max(this.bb.y1, d);
    }
  },

  _ink(g, ink, alpha) {
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = alpha;
    g.fillStyle = INK[ink];
    g.strokeStyle = INK[ink];
  },
  _done(g) {
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  },

  splat(x, y, ink, size = 10, dx = 0, dy = 0, alpha = 0.5, mark = true) {
    const seed = (Math.random() * 1e9) | 0;
    if (mark) this.track(x - size * 1.3, y - size * 1.3, x + size * 1.3, y + size * 1.3);
    for (const [g, a] of [[this.lg, alpha * 0.7], [this.pg, Math.min(0.9, alpha * 1.5)]]) {
      this._ink(g, ink, a);
      g.beginPath();
      splatPath(g, this.tx(x), this.ty(y), size * this.k, dx, dy, mulberry32(seed));
      g.fill();
      this._done(g);
    }
  },

  /** A full impression of one peeled layer — print sheet only. */
  ghost(x, y, w, h, ink, alpha = 0.66) {
    const g = this.pg;
    const o = PRINT_REG[ink] || PRINT_REG.k;
    this.track(x, y, x + w, y + h);
    this._ink(g, ink, alpha);
    g.fillRect(this.tx(x) + o[0], this.ty(y) + o[1], w * this.k, h * this.k);
    this._done(g);
  },

  line(x1, y1, x2, y2, ink, alpha = 0.08, width = 1.1) {
    for (const [g, a] of [[this.lg, alpha * 0.7], [this.pg, alpha * 1.6]]) {
      this._ink(g, ink, a);
      g.lineWidth = width * this.k;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(this.tx(x1), this.ty(y1));
      g.lineTo(this.tx(x2), this.ty(y2));
      g.stroke();
      this._done(g);
    }
  },

  draw(ctx, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.live, FIELD.x, FIELD.y, FIELD.w, FIELD.h);
    ctx.restore();
  },

  /** The finished print: the marked region with an even paper border.
      Each print keeps its own proportions — a fish prints wide, a tulip tall. */
  snapshot(maxSide = 420) {
    const pad = 22;
    let x0 = 0, y0 = 0, x1 = FIELD.w, y1 = FIELD.h;
    if (this.bb) {
      x0 = clamp(this.bb.x0 - pad, 0, FIELD.w); x1 = clamp(this.bb.x1 + pad, 0, FIELD.w);
      y0 = clamp(this.bb.y0 - pad, 0, FIELD.h); y1 = clamp(this.bb.y1 + pad, 0, FIELD.h);
    }
    let cw = Math.max(120, x1 - x0), ch = Math.max(120, y1 - y0);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (cw / ch > 1.9) ch = cw / 1.9;          // no thinner than a postcard
    else if (ch / cw > 1.5) cw = ch / 1.5;
    cw = Math.min(cw, FIELD.w);
    ch = Math.min(ch, FIELD.h);
    x0 = clamp(cx - cw / 2, 0, FIELD.w - cw);
    y0 = clamp(cy - ch / 2, 0, FIELD.h - ch);

    const m = Math.max(cw, ch) * 0.085;        // even border, a little deeper at the foot
    const sw = cw + 2 * m, sh = ch + 2.3 * m;
    const s = maxSide / Math.max(sw, sh);
    const c = document.createElement('canvas');
    c.width = Math.round(sw * s);
    c.height = Math.round(sh * s);
    const g = c.getContext('2d');
    g.fillStyle = PAPER_HI;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'multiply';
    if (Backdrop.has) {
      const bk = Backdrop.k;
      g.globalAlpha = 0.42;
      g.drawImage(Backdrop.cv, x0 * bk, y0 * bk, cw * bk, ch * bk, m * s, m * s, cw * s, ch * s);
      g.globalAlpha = 1;
    }
    g.drawImage(this.print, x0 * this.k, y0 * this.k, cw * this.k, ch * this.k, m * s, m * s, cw * s, ch * s);
    g.globalCompositeOperation = 'source-over';
    if (Grain.tile) {
      g.fillStyle = g.createPattern(Grain.tile, 'repeat');
      g.fillRect(0, 0, c.width, c.height);
    }
    return c;
  },
};

/* ---------- type ---------- */
const hasLetterSpacing = (() => {
  try { return 'letterSpacing' in document.createElement('canvas').getContext('2d'); } catch (e) { return false; }
})();

/** Fill text with tracking. Returns drawn width. */
function spaced(ctx, text, x, y, spacing, align = 'left') {
  if (hasLetterSpacing) {
    ctx.letterSpacing = spacing + 'px';
    const w = ctx.measureText(text).width - spacing;
    const prev = ctx.textAlign;
    ctx.textAlign = 'left';
    const sx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    ctx.fillText(text, sx, y);
    ctx.textAlign = prev;
    ctx.letterSpacing = '0px';
    return w;
  }
  const ws = [];
  let w = 0;
  for (const ch of text) {
    const cw = ctx.measureText(ch).width;
    ws.push(cw);
    w += cw + spacing;
  }
  w -= spacing;
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  let i = 0;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ws[i++] + spacing;
  }
  ctx.textAlign = prev;
  return w;
}

/* ---------- rubber stamps, pre-inked and worn ---------- */
const StampCache = new Map();

function makeStamp(text, sub, ink, size) {
  const key = `${text}|${sub || ''}|${ink}|${size}`;
  if (StampCache.has(key)) return StampCache.get(key);
  const K = 2;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = fDisplay(size);
  const tw = g.measureText(text).width;
  const subSize = Math.round(size * 0.22);
  let sw = 0;
  if (sub) {
    g.font = fMono(subSize, 600);
    sw = g.measureText(sub).width + sub.length * subSize * 0.22;
  }
  const pad = size * 0.34;
  const w = Math.max(tw, sw) + pad * 2;
  const h = size * (sub ? 1.5 : 1.12) + pad * 0.9;
  c.width = Math.ceil(w * K);
  c.height = Math.ceil(h * K);
  g.scale(K, K);
  g.fillStyle = INK[ink];
  g.strokeStyle = INK[ink];
  const lw = Math.max(3, size * 0.075);
  g.lineWidth = lw;
  g.strokeRect(lw / 2, lw / 2, w - lw, h - lw);
  g.lineWidth = Math.max(1, lw * 0.35);
  g.strokeRect(lw * 1.9, lw * 1.9, w - lw * 3.8, h - lw * 3.8);
  g.textBaseline = 'alphabetic';
  g.textAlign = 'center';
  g.font = fDisplay(size);
  const base = pad * 0.45 + size * 0.88;
  g.fillText(text, w / 2, base);
  if (sub) {
    g.font = fMono(subSize, 600);
    spaced(g, sub, w / 2, base + size * 0.44, subSize * 0.22, 'center');
  }
  g.globalCompositeOperation = 'destination-out';
  const r = mulberry32(text.length * 131 + size * 7 + (sub ? sub.length : 0));
  const specks = Math.round(w * h * 0.01);
  for (let i = 0; i < specks; i++) {
    const x = r() * w, y = r() * h, s = r() * r() * 2.8 + 0.35;
    g.globalAlpha = 0.45 + r() * 0.55;
    g.beginPath();
    g.arc(x, y, s, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 0.55;
  g.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) {
    const x = r() * w, y = r() * h;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * w * 0.5, y + (r() - 0.5) * 10);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  const out = { cv: c, w, h };
  StampCache.set(key, out);
  return out;
}

/* ---------- icon set: one weight, round caps, geometric ---------- */
function drawIcon(ctx, id, cx, cy, size, color = INK.k) {
  const s = size;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.2, s * 0.11);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const dot = (x, y, r) => { ctx.beginPath(); ctx.arc(x * s, y * s, r * s, 0, TAU); ctx.fill(); };
  const line = (pts) => {
    ctx.beginPath();
    ctx.moveTo(pts[0] * s, pts[1] * s);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * s, pts[i + 1] * s);
    ctx.stroke();
  };
  const ring = (x, y, r) => { ctx.beginPath(); ctx.arc(x * s, y * s, r * s, 0, TAU); ctx.stroke(); };
  const fillPoly = (pts) => {
    ctx.beginPath();
    ctx.moveTo(pts[0] * s, pts[1] * s);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * s, pts[i + 1] * s);
    ctx.closePath();
    ctx.fill();
  };

  switch (id) {
    case 'split':
      dot(0, -0.2, 0.13); dot(-0.2, 0.15, 0.13); dot(0.2, 0.15, 0.13);
      break;
    case 'wide':
      line([-0.36, 0, 0.36, 0]);
      line([-0.22, -0.14, -0.36, 0, -0.22, 0.14]);
      line([0.22, -0.14, 0.36, 0, 0.22, 0.14]);
      break;
    case 'slow':
      ring(0, 0, 0.32);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 0.32 * s, -Math.PI / 2, 0); ctx.closePath(); ctx.fill();
      break;
    case 'margin':
      line([-0.38, 0.12, 0.38, 0.12]);
      for (let i = -2; i <= 2; i++) line([i * 0.17, 0.12, i * 0.17, i % 2 ? -0.02 : -0.12]);
      break;
    case 'flood':
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        for (let i = 0; i <= 16; i++) {
          const x = -0.36 + (i / 16) * 0.72;
          const y = k * 0.2 + Math.sin(i / 16 * TAU * 1.5) * 0.06;
          if (i === 0) ctx.moveTo(x * s, y * s); else ctx.lineTo(x * s, y * s);
        }
        ctx.stroke();
      }
      break;
    case 'tack':
      dot(0, -0.14, 0.17);
      line([-0.2, 0.06, 0.2, 0.06]);
      line([0, 0.06, 0, 0.38]);
      break;
    case 'life':
    case 'spare':
      ring(0, 0, 0.22);
      line([-0.38, 0, 0.38, 0]);
      line([0, -0.38, 0, 0.38]);
      if (id === 'spare') dot(0, 0, 0.09);
      break;
    case 'heavy':
      ctx.beginPath();
      ctx.moveTo(-0.3 * s, 0.32 * s); ctx.lineTo(0.3 * s, 0.32 * s); ctx.lineTo(0.2 * s, -0.08 * s); ctx.lineTo(-0.2 * s, -0.08 * s); ctx.closePath(); ctx.fill();
      ring(0, -0.2, 0.1);
      break;
    case 'soft':
      ring(0, 0, 0.33); dot(0, 0, 0.13);
      break;
    case 'wet':
      ctx.beginPath();
      ctx.moveTo(0, -0.38 * s);
      ctx.bezierCurveTo(0.08 * s, -0.2 * s, 0.28 * s, 0.02 * s, 0.28 * s, 0.14 * s);
      ctx.arc(0, 0.14 * s, 0.28 * s, 0, Math.PI);
      ctx.bezierCurveTo(-0.28 * s, 0.02 * s, -0.08 * s, -0.2 * s, 0, -0.38 * s);
      ctx.fill();
      break;
    case 'twin':
      dot(-0.15, 0.05, 0.15); dot(0.17, -0.08, 0.15);
      line([-0.38, 0.28, -0.24, 0.24]);
      break;
    case 'splash':
      dot(0, 0, 0.16);
      dot(0.3, -0.18, 0.06); dot(-0.28, -0.22, 0.07); dot(0.26, 0.26, 0.05); dot(-0.32, 0.2, 0.05);
      break;
    case 'magnet':
      ctx.lineWidth = s * 0.15;
      ctx.beginPath(); ctx.arc(0, -0.02 * s, 0.24 * s, Math.PI, 0, true); ctx.stroke();
      line([-0.24, -0.02, -0.24, -0.3]);
      line([0.24, -0.02, 0.24, -0.3]);
      break;
    case 'lucky':
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI;
        line([Math.cos(a) * -0.36, Math.sin(a) * -0.36, Math.cos(a) * 0.36, Math.sin(a) * 0.36]);
      }
      break;
    case 'rico':
      line([-0.36, -0.3, -0.12, 0.28, 0.12, -0.2, 0.34, 0.3]);
      break;
    case 'cutter':
      ctx.fillRect(-0.3 * s, -0.22 * s, 0.6 * s, 0.44 * s);
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = Math.max(1, s * 0.07);
      line([-0.06, -0.22, 0.05, -0.05, -0.04, 0.06, 0.07, 0.22]);
      break;
    case 'coat':
      ctx.fillRect(-0.12 * s, -0.04 * s, 0.44 * s, 0.34 * s);
      ctx.lineWidth = Math.max(1.2, s * 0.08);
      ctx.strokeRect(-0.32 * s, -0.3 * s, 0.44 * s, 0.34 * s);
      break;
    case 'english':
      ctx.beginPath(); ctx.arc(-0.06 * s, 0.24 * s, 0.4 * s, -Math.PI * 0.95, -Math.PI * 0.32); ctx.stroke();
      line([0.06, -0.24, 0.18, -0.1, 0.0, -0.06]);
      break;
    case 'longstamp':
      line([-0.26, -0.34, 0.26, -0.34]);
      line([-0.26, 0.34, 0.26, 0.34]);
      line([-0.2, -0.34, 0.2, 0.34]);
      line([0.2, -0.34, -0.2, 0.34]);
      fillPoly([-0.13, 0.34, 0.13, 0.34, 0, 0.12]);
      break;
    case 'tracer':
      ctx.setLineDash([s * 0.09, s * 0.07]);
      line([0, -0.4, 0, 0.06]);
      ctx.setLineDash([]);
      ring(0, 0.24, 0.13);
      dot(0, 0.24, 0.05);
      break;
    case 'bigball':
      dot(0.07, 0.05, 0.27);
      dot(-0.3, -0.28, 0.08);
      break;
    case 'wells':
      ring(0, 0, 0.33);
      dot(-0.13, -0.09, 0.07); dot(0.11, -0.12, 0.06); dot(0.01, 0.1, 0.08); dot(-0.15, 0.16, 0.045); dot(0.17, 0.12, 0.05);
      break;
    case 'pigment':
      ctx.beginPath();
      ctx.moveTo(-0.12 * s, -0.36 * s);
      ctx.bezierCurveTo(-0.06 * s, -0.2 * s, 0.1 * s, -0.04 * s, 0.1 * s, 0.1 * s);
      ctx.arc(-0.12 * s, 0.1 * s, 0.22 * s, 0, Math.PI);
      ctx.bezierCurveTo(-0.34 * s, -0.04 * s, -0.18 * s, -0.2 * s, -0.12 * s, -0.36 * s);
      ctx.fill();
      line([0.26, -0.3, 0.26, -0.02]);
      line([0.12, -0.16, 0.4, -0.16]);
      break;
    case 'tough':
      ctx.beginPath();
      ctx.moveTo(0, -0.38 * s);
      ctx.lineTo(0.3 * s, -0.28 * s);
      ctx.lineTo(0.3 * s, 0.02 * s);
      ctx.quadraticCurveTo(0.28 * s, 0.26 * s, 0, 0.4 * s);
      ctx.quadraticCurveTo(-0.28 * s, 0.26 * s, -0.3 * s, 0.02 * s);
      ctx.lineTo(-0.3 * s, -0.28 * s);
      ctx.closePath();
      ctx.fill();
      break;
    case 'bounty':
      ring(0.08, -0.08, 0.22);
      dot(0.08, -0.08, 0.06);
      line([-0.36, 0.36, -0.04, 0.04]);
      line([-0.2, 0.04, -0.04, 0.04, -0.04, 0.2]);
      break;
    case 'shock':
      ctx.fillRect(-0.12 * s, -0.12 * s, 0.24 * s, 0.24 * s);
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1.3], [0, 1.3], [-1.3, 0], [1.3, 0]]) {
        line([dx * 0.2, dy * 0.2, dx * 0.32, dy * 0.32]);
      }
      break;
    case 'steel':
      ctx.fillRect(-0.4 * s, 0.04 * s, 0.8 * s, 0.2 * s);
      for (let i = -3; i <= 3; i++) line([i * 0.12, 0.04, i * 0.12, i % 2 ? -0.08 : -0.18]);
      break;
    case 'charged':
      fillPoly([0.08, -0.42, -0.24, 0.05, -0.02, 0.05, -0.1, 0.42, 0.24, -0.08, 0.02, -0.08]);
      break;
    case 'spatter':
      dot(-0.06, 0.05, 0.17);
      for (const [x, y, r] of [[0.28, -0.2, 0.06], [-0.3, -0.24, 0.07], [0.3, 0.2, 0.05], [-0.34, 0.24, 0.045], [0.06, -0.34, 0.05], [0.36, -0.02, 0.035], [-0.38, 0.0, 0.035], [0.14, 0.34, 0.04]]) dot(x, y, r);
      break;
    case 'bigbang': {
      const pts = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        const r = i % 2 ? 0.17 : 0.4;
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      fillPoly(pts);
      break;
    }
    case 'duplicate':
      dot(-0.13, 0.08, 0.18);
      ring(0.13, -0.08, 0.18);
      dot(0.13, -0.08, 0.06);
      break;
    case 'aftershock':
      for (const r of [0.13, 0.25, 0.37]) {
        ctx.beginPath(); ctx.arc(0, 0, r * s, -0.75, 0.75); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, r * s, Math.PI - 0.75, Math.PI + 0.75); ctx.stroke();
      }
      dot(0, 0, 0.06);
      break;
    case 'hotpress':
      ctx.beginPath();
      ctx.moveTo(0.02 * s, -0.42 * s);
      ctx.bezierCurveTo(0.34 * s, -0.12 * s, 0.32 * s, 0.22 * s, 0.02 * s, 0.38 * s);
      ctx.bezierCurveTo(-0.3 * s, 0.26 * s, -0.3 * s, 0.0, -0.12 * s, -0.12 * s);
      ctx.bezierCurveTo(-0.06 * s, 0.02 * s, 0.04 * s, 0.0, 0.02 * s, -0.42 * s);
      ctx.fill();
      break;
    case 'saturate':
      ctx.beginPath(); ctx.arc(-0.12 * s, 0.1 * s, 0.2 * s, 0, TAU); ctx.fill();
      ring(0.14, -0.08, 0.2);
      break;
    case 'keyblast':
      ctx.fillRect(-0.17 * s, -0.11 * s, 0.34 * s, 0.22 * s);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.2;
        line([Math.cos(a) * 0.27, Math.sin(a) * 0.24, Math.cos(a) * 0.4, Math.sin(a) * 0.37]);
      }
      break;
    case 'overrun':
      line([-0.32, -0.26, -0.06, 0, -0.32, 0.26]);
      line([0.02, -0.26, 0.28, 0, 0.02, 0.26]);
      break;
    case 'collector':
      dot(-0.12, 0.1, 0.2);
      ctx.save();
      ctx.fillStyle = PAPER_HI;
      ctx.beginPath(); ctx.arc(0.13 * s, -0.08 * s, 0.2 * s, 0, TAU); ctx.fill();
      ctx.restore();
      ring(0.13, -0.08, 0.2);
      dot(0.13, -0.08, 0.06);
      break;
    case 'reprint':
      ctx.beginPath(); ctx.arc(0, 0, 0.28 * s, -Math.PI * 0.35, Math.PI * 1.4); ctx.stroke();
      fillPoly([0.14, -0.38, 0.32, -0.24, 0.1, -0.14]);
      break;
    case 'absorb':
      ctx.fillRect(-0.32 * s, -0.24 * s, 0.64 * s, 0.48 * s);
      ctx.save();
      ctx.fillStyle = PAPER_HI;
      for (const [x, y, r] of [[-0.18, -0.1, 0.06], [0.06, -0.12, 0.05], [0.2, 0.06, 0.06], [-0.06, 0.1, 0.07], [-0.22, 0.12, 0.04], [0.2, -0.14, 0.03]]) {
        ctx.beginPath(); ctx.arc(x * s, y * s, r * s, 0, TAU); ctx.fill();
      }
      ctx.restore();
      break;
    case 'jet':
      ctx.fillRect(-0.32 * s, 0.24 * s, 0.64 * s, 0.11 * s);
      line([0, 0.22, 0, -0.32]);
      line([-0.12, -0.2, 0, -0.34, 0.12, -0.2]);
      break;
    case 'fullbleed':
      ctx.fillRect(-0.22 * s, -0.22 * s, 0.44 * s, 0.44 * s);
      ctx.lineWidth = Math.max(1, s * 0.06);
      for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        line([cx * 0.3, cy * 0.22, cx * 0.42, cy * 0.22]);
        line([cx * 0.22, cy * 0.3, cx * 0.22, cy * 0.42]);
      }
      break;
    case 'dualink':
      dot(-0.11, 0, 0.23);
      ring(0.12, 0, 0.23);
      break;
    case 'foil': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * TAU;
        const r = i % 2 ? 0.16 : 0.4;
        pts.push(Math.cos(a) * r, Math.sin(a) * r + 0.03);
      }
      fillPoly(pts);
      break;
    }
    case 'edition':
      ctx.lineWidth = Math.max(1.2, s * 0.08);
      ctx.strokeRect(-0.12 * s, -0.36 * s, 0.42 * s, 0.52 * s);
      ctx.strokeRect(-0.22 * s, -0.26 * s, 0.42 * s, 0.52 * s);
      ctx.save();
      ctx.fillStyle = PAPER_HI;
      ctx.fillRect(-0.32 * s, -0.16 * s, 0.42 * s, 0.52 * s);
      ctx.restore();
      ctx.strokeRect(-0.32 * s, -0.16 * s, 0.42 * s, 0.52 * s);
      line([-0.11, 0.0, -0.11, 0.2]);
      line([-0.21, 0.1, -0.01, 0.1]);
      break;
    default:
      dot(0, 0, 0.2);
  }
  ctx.restore();
}

/* ---------- the halftone wipe between scenes ---------- */
const Wipe = {
  active: false,
  phase: 'in',
  t: 0,
  hold: 0,
  ink: 'b',
  mid: null,
  done: null,
  dur: 0.38,

  run(ink, mid, done) {
    this.active = true;
    this.phase = 'in';
    this.t = 0;
    this.ink = ink;
    this.mid = mid;
    this.done = done;
  },

  update(dt) {
    if (!this.active) return;
    if (this.phase === 'in') {
      this.t += dt / this.dur;
      if (this.t >= 1) {
        this.t = 1;
        this.phase = 'hold';
        this.hold = 0.08;
        const m = this.mid;
        this.mid = null;
        if (m) m();
      }
    } else if (this.phase === 'hold') {
      this.hold -= dt;
      if (this.hold <= 0) { this.phase = 'out'; this.t = 0; }
    } else {
      this.t += dt / this.dur;
      if (this.t >= 1) {
        this.active = false;
        const g = this.ctxClear();
        const d = this.done;
        this.done = null;
        if (d) d();
        return g;
      }
    }
    this.draw();
  },

  ctxClear() {
    const g = Gfx.wipeCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, Gfx.wipeCv.width, Gfx.wipeCv.height);
    return g;
  },

  draw() {
    const g = this.ctxClear();
    Gfx.screen(g);
    const W = Gfx.W, H = Gfx.H;
    const step = 34;
    const cols = Math.ceil(W / step) + 2;
    const rows = Math.ceil(H / step) + 2;
    g.fillStyle = INK[this.ink];
    g.beginPath();
    const t = this.phase === 'hold' ? 1 : this.t;
    for (let j = -1; j < rows; j++) {
      for (let i = -1; i < cols; i++) {
        const x = i * step + (j % 2 ? step / 2 : 0);
        const y = j * step;
        const d = clamp((x / W) * 0.65 + (y / H) * 0.35, 0, 1);
        let p;
        if (this.phase === 'out') p = clamp((1 - t) * 1.6 - (1 - d) * 0.6, 0, 1);
        else p = clamp(t * 1.6 - d * 0.6, 0, 1);
        const r = Ease.inOutCubic(p) * step * 0.8;
        if (r < 0.3) continue;
        g.moveTo(x + r, y);
        g.arc(x, y, r, 0, TAU);
      }
    }
    g.fill();
  },
};
