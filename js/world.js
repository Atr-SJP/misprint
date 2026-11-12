'use strict';
/* =========================================================
   MISPRINT — the world
   Blocks, the ball, the roller (a brayer), particles, drops,
   ink wells, the moth, boss projectiles and collision maths.
   ========================================================= */

/* ---------- collision maths ---------- */
function circleRect(cx, cy, r, x, y, w, h) {
  const qx = clamp(cx, x, x + w);
  const qy = clamp(cy, y, y + h);
  const dx = cx - qx, dy = cy - qy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, pen: r - d };
  }
  const l = cx - x, rr = x + w - cx, t = cy - y, b = y + h - cy;
  const m = Math.min(l, rr, t, b);
  if (m === t) return { nx: 0, ny: -1, pen: t + r };
  if (m === b) return { nx: 0, ny: 1, pen: b + r };
  if (m === l) return { nx: -1, ny: 0, pen: l + r };
  return { nx: 1, ny: 0, pen: rr + r };
}

function circleCircle(cx, cy, r, ox, oy, or) {
  const dx = cx - ox, dy = cy - oy;
  const d2 = dx * dx + dy * dy;
  const R = r + or;
  if (d2 >= R * R) return null;
  const d = Math.sqrt(d2) || 1e-6;
  return { nx: dx / d, ny: dy / d, pen: R - d };
}

/** Convex polygon, points clockwise on screen (y down). */
function circlePoly(cx, cy, r, pts) {
  const n = pts.length;
  let inside = true;
  let best = Infinity, qx = 0, qy = 0, enx = 0, eny = 0, edgeDist = Infinity, inx = 0, iny = 0;
  for (let i = 0; i < n; i++) {
    const ax = pts[i][0], ay = pts[i][1];
    const bx = pts[(i + 1) % n][0], by = pts[(i + 1) % n][1];
    const ex = bx - ax, ey = by - ay;
    const len = Math.hypot(ex, ey) || 1;
    const cr = (ex * (cy - ay) - ey * (cx - ax)) / len;   // >0 inside
    if (cr < 0) inside = false;
    if (cr < edgeDist) { edgeDist = cr; inx = ey / len; iny = -ex / len; }
    let t = ((cx - ax) * ex + (cy - ay) * ey) / (len * len);
    t = clamp(t, 0, 1);
    const px = ax + ex * t, py = ay + ey * t;
    const d2 = (cx - px) * (cx - px) + (cy - py) * (cy - py);
    if (d2 < best) { best = d2; qx = px; qy = py; enx = ey / len; eny = -ex / len; }
  }
  if (inside) return { nx: inx, ny: iny, pen: edgeDist + r };
  if (best >= r * r) return null;
  const d = Math.sqrt(best);
  if (d < 1e-6) return { nx: enx, ny: eny, pen: r };
  return { nx: (cx - qx) / d, ny: (cy - qy) / d, pen: r - d };
}

/** Reflect a ball off a surface that may itself be moving. */
function reflectBall(ball, hit, svx = 0, svy = 0) {
  ball.x += hit.nx * hit.pen;
  ball.y += hit.ny * hit.pen;
  const rvx = ball.vx - svx, rvy = ball.vy - svy;
  const vn = rvx * hit.nx + rvy * hit.ny;
  if (vn < 0) {
    ball.vx -= 2 * vn * hit.nx;
    ball.vy -= 2 * vn * hit.ny;
    ball.squash(hit.nx, hit.ny);
    return true;
  }
  return false;
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* =========================================================
   Blocks
   ========================================================= */
let BRICK_SEQ = 0;

class Brick {
  constructor(spec) {
    this.id = ++BRICK_SEQ;
    this.r = spec.r;
    this.c = spec.c;
    this.kind = spec.kind;            // 'ink' | 'key' | 'bomb'
    this.layers = spec.layers.slice();
    this.alive = true;
    this.hp = 3;                      // only matters with Key Cutter
    this.flash = 0;
    this.settle = 0;
    this.jx = 0; this.jy = 0; this.jvx = 0; this.jvy = 0;
    this.appear = 1;
    this.wet = 0;
    this.seed = Math.random() * TAU;
  }
  get top() { return this.layers[this.layers.length - 1]; }
  jiggle(nx, ny, power = 1) {
    this.jvx -= nx * 70 * power;
    this.jvy -= ny * 70 * power;
  }
  update(dt) {
    this.jvx += (-460 * this.jx - 20 * this.jvx) * dt;
    this.jvy += (-460 * this.jy - 20 * this.jvy) * dt;
    this.jx += this.jvx * dt;
    this.jy += this.jvy * dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 9);
    if (this.settle > 0) this.settle = Math.max(0, this.settle - dt * 9);
  }
}

const Board = {
  grid: [],
  list: [],
  rowOff: new Array(GRID.rows).fill(0),
  rowVel: new Array(GRID.rows).fill(0),
  slides: [],
  inkLeft: 0,
  t: 0,

  build(specs, slides = []) {
    this.grid = [];
    for (let r = 0; r < GRID.rows; r++) this.grid.push(new Array(GRID.cols).fill(null));
    this.list = [];
    for (const s of specs) {
      if (s.r >= GRID.rows) continue;
      const b = new Brick(s);
      this.grid[s.r][s.c] = b;
      this.list.push(b);
    }
    this.slides = slides;
    this.rowOff.fill(0);
    this.rowVel.fill(0);
    this.t = 0;
    this.count();
  },

  clear() { this.build([]); },

  count() {
    let n = 0;
    for (const b of this.list) if (b.alive && b.kind === 'ink') n++;
    this.inkLeft = n;
  },

  at(r, c) {
    if (r < 0 || r >= GRID.rows || c < 0 || c >= GRID.cols) return null;
    const b = this.grid[r][c];
    return b && b.alive ? b : null;
  },

  cellX(r, c) { return GRID.x + c * GRID.cw + this.rowOff[r]; },
  cellY(r) { return GRID.y + r * GRID.ch; },

  /** Body rect of a block (what you see). */
  body(b) {
    return { x: this.cellX(b.r, b.c) + BRICK_INSET, y: this.cellY(b.r) + BRICK_INSET, w: BRICK_W, h: BRICK_H };
  },
  center(b) {
    return { x: this.cellX(b.r, b.c) + GRID.cw / 2, y: this.cellY(b.r) + GRID.ch / 2 };
  },

  neighbours(b, diag) {
    const out = [];
    const ds = diag
      ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]
      : [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of ds) {
      const n = this.at(b.r + dr, b.c + dc);
      if (n) out.push(n);
    }
    return out;
  },

  update(dt) {
    this.t += dt;
    for (const s of this.slides) {
      const off = Math.sin(this.t * s.speed + s.phase) * s.amp;
      const vel = Math.cos(this.t * s.speed + s.phase) * s.amp * s.speed;
      for (const r of s.rows) { this.rowOff[r] = off; this.rowVel[r] = vel; }
    }
    const step = Math.min(dt, 1 / 60);
    for (const b of this.list) if (b.alive) b.update(step);
  },

  draw(ctx, time) {
    for (const b of this.list) if (b.alive) drawBrick(ctx, b, time);
  },
};

function drawBrick(ctx, b, time) {
  const bx = Board.cellX(b.r, b.c) + BRICK_INSET + b.jx;
  const by = Board.cellY(b.r) + BRICK_INSET + b.jy;
  let scaled = false;
  if (b.appear < 1) {
    if (b.appear <= 0) return;
    const s = 0.35 + 0.65 * Ease.outBack(clamp(b.appear, 0, 1));
    ctx.save();
    ctx.globalAlpha = clamp(b.appear * 3, 0, 1);
    ctx.translate(bx + BRICK_W / 2, by + BRICK_H / 2);
    ctx.scale(s, s);
    ctx.translate(-(bx + BRICK_W / 2), -(by + BRICK_H / 2));
    scaled = true;
  }

  if (b.kind === 'key') {
    const k = Plates.k;
    const x = bx + k.x, y = by + k.y;
    ctx.fillStyle = INK.k;
    ctx.fillRect(x, y, BRICK_W, BRICK_H);
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 3.5, y + 3.5, BRICK_W - 7, BRICK_H - 7);
    if (b.hp < 3) {
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x + BRICK_W * 0.45, y);
      ctx.lineTo(x + BRICK_W * 0.55, y + BRICK_H * 0.4);
      ctx.lineTo(x + BRICK_W * 0.42, y + BRICK_H * 0.62);
      if (b.hp < 2) {
        ctx.lineTo(x + BRICK_W * 0.6, y + BRICK_H);
        ctx.moveTo(x + BRICK_W * 0.55, y + BRICK_H * 0.4);
        ctx.lineTo(x + BRICK_W * 0.8, y + BRICK_H * 0.3);
      }
      ctx.stroke();
    }
  } else if (b.kind === 'bomb') {
    const k = Plates.k;
    const pulse = 1 + Math.sin(time * 6 + b.seed) * 0.05;
    const x = bx + k.x, y = by + k.y;
    ctx.fillStyle = PAPER_HI;
    ctx.fillRect(x, y, BRICK_W, BRICK_H);
    ctx.strokeStyle = INK.k;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, BRICK_W - 2, BRICK_H - 2);
    const cx = x + BRICK_W / 2, cy = y + BRICK_H / 2;
    const p = Plates.p;
    ctx.fillStyle = INK.p;
    ctx.beginPath();
    ctx.arc(cx + p.x, cy + p.y, 5.5 * pulse, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = INK.k;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI + time * 0.6;
      const l = 6.5 * pulse;
      ctx.moveTo(cx - Math.cos(a) * l, cy - Math.sin(a) * l);
      ctx.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l);
    }
    ctx.stroke();
  } else {
    const n = b.layers.length;
    const st = Ease.outCubic(b.settle);
    const depthCount = n - 1 + st;
    const fw = BRICK_W - LAYER_STEP * depthCount;
    const fh = BRICK_H - LAYER_STEP * depthCount;
    for (let i = 0; i < n; i++) {
      const ink = b.layers[i];
      const d = (n - 1 - i) + st;
      const pl = Plates[ink];
      const x = bx + d * LAYER_STEP + pl.x;
      const y = by + d * LAYER_STEP + pl.y;
      if (i > 0) {
        ctx.fillStyle = PAPER;
        ctx.fillRect(x, y, fw + 1.5, fh + 1.5);
      }
      ctx.fillStyle = INK[ink];
      ctx.fillRect(x, y, fw, fh);
      if (i === n - 1) {
        if (Settings.patterns) drawInkMark(ctx, ink, x + fw / 2, y + fh / 2, Math.min(fh, 16));
        if (b.wet > 0) {
          ctx.fillStyle = rgba(PAPER, 0.25 + 0.25 * Math.sin(time * 40 + b.seed));
          ctx.fillRect(x, y, fw, fh);
        }
        if (b.flash > 0) {
          ctx.fillStyle = rgba(PAPER_HI, b.flash);
          ctx.fillRect(x, y, fw, fh);
        }
      }
    }
  }
  if (scaled) ctx.restore();
}

/** Small per-ink marks for colour-blind play. */
function drawInkMark(ctx, ink, cx, cy, s) {
  ctx.save();
  ctx.strokeStyle = rgba(INK.k, 0.55);
  ctx.fillStyle = rgba(INK.k, 0.55);
  ctx.lineWidth = 1.6;
  const u = s * 0.28;
  if (ink === 'p') {
    ctx.beginPath(); ctx.arc(cx, cy, u * 0.9, 0, TAU); ctx.stroke();
  } else if (ink === 'b') {
    ctx.beginPath();
    ctx.moveTo(cx - u * 1.4, cy + u); ctx.lineTo(cx - u * 0.2, cy - u);
    ctx.moveTo(cx + u * 0.2, cy + u); ctx.lineTo(cx + u * 1.4, cy - u);
    ctx.stroke();
  } else if (ink === 'y') {
    ctx.fillRect(cx - u * 1.3, cy - 1, u * 2.6, 2);
    ctx.fillRect(cx - 1, cy - u * 0.9, 2, u * 1.8);
  }
  ctx.restore();
}

/* =========================================================
   The ball
   ========================================================= */
class Ball {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = BALL_R + 2 * perk('bigball');
    this.ink = 'k';
    this.ink2 = 'k';          // Overprint: a second ink
    this.charged = false;     // Charged Wells: next hit bleeds
    this.held = false;
    this.holdOff = 0;
    this.volley = 0;
    this.pierce = 0;
    this.smashArm = 0;
    this.smashed = false;
    this.smashMul = 1;
    this.sincePaddle = 9;
    this.idle = 0;
    this.trail = [];
    this.sq = 0; this.sqx = 0; this.sqy = 1;
    this.pierced = new Set();
    this.dead = false;
    this.spin = 0;
    this.px = x; this.py = y;
    this.inkFlash = 0;
  }
  squash(nx, ny) { this.sq = 1; this.sqx = nx; this.sqy = ny; }
  setInk(ink) {
    if (this.ink !== ink) this.inkFlash = 1;
    this.ink = ink;
  }
  speed() { return Math.hypot(this.vx, this.vy); }
  setSpeed(s) {
    const v = this.speed() || 1;
    this.vx = (this.vx / v) * s;
    this.vy = (this.vy / v) * s;
  }
  cosmetic(dt) {
    this.sq = Math.max(0, this.sq - dt * 7);
    this.inkFlash = Math.max(0, this.inkFlash - dt * 4);
  }
}

function drawBall(ctx, b, time, flood) {
  // trail — inked dots, overprinted
  const ink = flood ? 'p' : b.ink;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const tl = b.trail.length;
  for (let i = 0; i < tl; i++) {
    const p = b.trail[i];
    const f = (i + 1) / (tl + 1);
    ctx.globalAlpha = f * (b.pierce > 0 ? 0.5 : 0.28);
    ctx.fillStyle = INK[flood ? COLOR_INKS[i % 3] : ink];
    ctx.beginPath();
    ctx.arc(p.x, p.y, b.r * (0.35 + f * 0.55), 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  const pl = Plates[ink === 'k' ? 'k' : ink];
  let x = b.x + pl.x, y = b.y + pl.y;
  if (b.pierce > 0) { x += rand(-0.8, 0.8); y += rand(-0.8, 0.8); }
  ctx.save();
  ctx.translate(x, y);
  if (b.sq > 0.01) {
    const a = Math.atan2(b.sqy, b.sqx);
    const q = Ease.outCubic(b.sq);
    ctx.rotate(a);
    ctx.scale(1 - 0.32 * q, 1 + 0.22 * q);
    ctx.rotate(-a);
  }
  const r = b.r + (b.pierce > 0 ? 1.2 : 0) + b.inkFlash * 2;
  if (flood) {
    for (let i = 0; i < 3; i++) {
      const a0 = time * 7 + (i / 3) * TAU;
      ctx.fillStyle = INK[COLOR_INKS[i]];
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, a0, a0 + TAU / 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = INK.k;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  } else if (b.ink2 !== 'k' && b.ink !== 'k' && b.ink2 !== b.ink) {
    // Overprint: the ball carries two inks, split down the middle
    ctx.fillStyle = INK[b.ink];
    ctx.beginPath(); ctx.arc(0, 0, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = INK[b.ink2];
    ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = INK.k;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, r - 0.4, 0, TAU); ctx.stroke();
  } else {
    ctx.fillStyle = INK[b.ink];
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    if (b.ink !== 'k') {
      ctx.strokeStyle = INK.k;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, 0, r - 0.4, 0, TAU); ctx.stroke();
    } else {
      ctx.fillStyle = rgba(PAPER, 0.3);
      ctx.beginPath(); ctx.arc(-r * 0.32, -r * 0.34, r * 0.24, 0, TAU); ctx.fill();
    }
  }
  if (b.charged) {
    ctx.strokeStyle = INK.y;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, r + 3.5 + Math.sin(time * 18) * 0.8, 0, TAU); ctx.stroke();
  }
  if (b.pierce > 0) {
    ctx.strokeStyle = INK.k;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2.5, 3]);
    ctx.lineDashOffset = -time * 40;
    ctx.beginPath(); ctx.arc(0, 0, r + 5, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/* =========================================================
   The roller — a brayer
   ========================================================= */
const Paddle = {
  x: FIELD.cx,
  y: PADDLE_Y,
  w: 116,
  baseW: 116,
  vx: 0,
  kv: 0,
  sq: 0,
  press: 0,
  cd: 0,
  smudge: 0,
  smudgeInk: 'b',
  roll: 0,
  tilt: 0,
  flash: 0,
  film: 'k',

  reset() {
    this.x = FIELD.cx;
    this.vx = this.kv = 0;
    this.sq = this.press = this.cd = this.smudge = this.flash = 0;
    this.w = this.targetW();
  },

  targetW() {
    let w = this.baseW * (1 + 0.16 * perk('wide'));
    if (G.fx.wide > 0) w *= 1.42;
    if (this.smudge > 0) w *= 0.74;
    return w;
  },

  update(dt, inputOn) {
    this.w = damp(this.w, this.targetW(), 14, dt);
    const half = this.w / 2;
    const prev = this.x;
    if (G.demo) {
      this.x = damp(this.x, this.botX ?? this.x, 9, dt);
    } else if (inputOn) {
      if (Input.usePointer && Input.px !== null) {
        const tx = Gfx.toPageX(Input.px);
        this.x = damp(this.x, tx, 38, dt);
        this.kv = 0;
      } else {
        const dir = (Input.right ? 1 : 0) - (Input.left ? 1 : 0);
        if (dir) this.kv = clamp(this.kv + dir * 5600 * dt, -900, 900);
        else this.kv = approach(this.kv, 0, 7200 * dt);
        if (dir && Math.sign(this.kv) !== dir) this.kv = approach(this.kv, 0, 9000 * dt);
        this.x += this.kv * dt;
      }
    }
    this.x = clamp(this.x, FIELD.x + half, FIELD.r - half);
    if (this.x === FIELD.x + half || this.x === FIELD.r - half) this.kv = 0;
    const raw = dt > 0 ? (this.x - prev) / dt : 0;
    this.vx = damp(this.vx, raw, 22, dt);
    this.roll += this.x - prev;
    this.tilt = damp(this.tilt, clamp(this.vx * 0.00005, -0.06, 0.06), 12, dt);
    this.sq = Math.max(0, this.sq - dt * 6);
    this.press = Math.max(0, this.press - dt * 5);
    this.cd = Math.max(0, this.cd - dt);
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.smudge > 0) this.smudge = Math.max(0, this.smudge - dt);
  },

  draw(ctx) {
    const w = this.w, h = PADDLE_H;
    const k = Plates.k, yp = Plates.y;
    const dip = Math.sin(this.press * Math.PI) * 5;
    ctx.save();
    ctx.translate(this.x + k.x, this.y + k.y + dip);
    ctx.rotate(this.tilt);

    // frame and handle (behind the roller)
    ctx.strokeStyle = INK.k;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 4, 0);
    ctx.lineTo(-8, 21);
    ctx.lineTo(8, 21);
    ctx.lineTo(w / 2 - 4, 0);
    ctx.stroke();
    ctx.fillStyle = INK.y;
    roundRectPath(ctx, -6 + yp.x, 19 + yp.y, 12, 30, 6);
    ctx.fill();
    ctx.lineWidth = 2;
    roundRectPath(ctx, -6, 19, 12, 30, 6);
    ctx.stroke();

    // roller
    ctx.save();
    const sy = 1 - this.sq * 0.3, sx = 1 + this.sq * 0.05;
    ctx.scale(sx, sy);
    roundRectPath(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.fillStyle = INK.k;
    ctx.fill();
    ctx.save();
    ctx.clip();
    if (this.film !== 'k') {
      const fp = Plates[this.film];
      ctx.fillStyle = INK[this.film];
      ctx.fillRect(-w / 2 + fp.x, -h / 2 + fp.y - 1, w, 5.5);
    }
    ctx.strokeStyle = rgba(PAPER, 0.16);
    ctx.lineWidth = 1;
    ctx.beginPath();
    const spacing = 9;
    const off = ((this.roll % spacing) + spacing) % spacing;
    for (let x = -w / 2 - spacing + off; x < w / 2 + spacing; x += spacing) {
      ctx.moveTo(x, -h / 2 + 5);
      ctx.lineTo(x, h / 2 - 2);
    }
    ctx.stroke();
    if (this.smudge > 0) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = INK[this.smudgeInk];
      ctx.beginPath();
      const rng = mulberry32(7);
      splatPath(ctx, -w * 0.2, 0, 9, 0, 0, rng);
      splatPath(ctx, w * 0.22, 2, 7, 0, 0, rng);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    if (this.flash > 0) {
      ctx.fillStyle = rgba(PAPER_HI, this.flash * 0.8);
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    ctx.restore();
    ctx.fillStyle = rgba(PAPER, 0.26);
    ctx.fillRect(-w / 2 + 9, 1, w - 18, 1.5);
    ctx.restore();

    // axle caps
    for (const s of [-1, 1]) {
      ctx.fillStyle = PAPER_HI;
      ctx.strokeStyle = INK.k;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(s * (w / 2 - 5), 0, 2.8, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  },
};

/* =========================================================
   Particles, floaters, stamps
   ========================================================= */
const FX = {
  parts: [],
  floats: [],
  stamps: [],

  clear() { this.parts.length = 0; this.floats.length = 0; this.stamps.length = 0; },

  flake(x, y, w, h, ink, nx = 0, ny = 1) {
    this.parts.push({
      k: 'flake', x, y, w, h, ink,
      vx: -nx * rand(30, 90) + rand(-50, 50), vy: -ny * rand(40, 120) - rand(60, 140),
      rot: 0, vr: rand(-9, 9), t: 0, life: rand(0.5, 0.75),
    });
  },

  droplets(x, y, ink, n = 6, nx = 0, ny = 0, speed = 160) {
    for (let i = 0; i < n; i++) {
      const a = nx || ny ? Math.atan2(-ny, -nx) + rand(-1.3, 1.3) : rand(TAU);
      const s = rand(speed * 0.35, speed);
      this.parts.push({ k: 'drop', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, r: rand(1.4, 3.4), ink, t: 0, life: rand(0.35, 0.7) });
    }
  },

  ring(x, y, ink, r0, r1, life = 0.4, lw = 3) {
    this.parts.push({ k: 'ring', x, y, ink, r0, r1, t: 0, life, lw });
  },

  dots(x, y, ink, R, life = 0.5) {
    this.parts.push({ k: 'dots', x, y, ink, R, t: 0, life, a: rand(TAU) });
  },

  sparks(x, y, ink, n = 6, speed = 300) {
    for (let i = 0; i < n; i++) {
      const a = rand(TAU);
      const s = rand(speed * 0.5, speed);
      this.parts.push({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, ink, t: 0, life: rand(0.18, 0.32) });
    }
  },

  jet(x, y0, y1, ink, fromX) {
    this.parts.push({ k: 'jet', x, y0, y1, ink, fromX: fromX ?? x, t: 0, life: 0.32 });
  },

  float(x, y, text, ink = 'k', size = 13, life = 0.8) {
    this.floats.push({ x, y, text, ink, size, t: 0, life });
  },

  stamp(text, sub, ink, x, y, o = {}) {
    const st = {
      text, sub, ink, x, y,
      size: o.size || 64,
      rot: o.rot ?? rand(-0.09, 0.06),
      t: 0,
      hold: o.hold ?? 1.0,
      life: (o.hold ?? 1.0) + 0.5,
      sound: o.sound !== false,
      landed: false,
      onLand: o.onLand || null,
    };
    this.stamps.push(st);
    return st;
  },

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      if (p.t >= p.life) { this.parts.splice(i, 1); continue; }
      if (p.k === 'flake') {
        p.vy += 620 * dt;
        p.vx *= 1 - dt * 1.5;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      } else if (p.k === 'drop') {
        p.vy += 700 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
      } else if (p.k === 'spark') {
        p.vx *= 1 - dt * 6; p.vy *= 1 - dt * 6;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      if (f.t >= f.life) this.floats.splice(i, 1);
    }
    for (let i = this.stamps.length - 1; i >= 0; i--) {
      const s = this.stamps[i];
      s.t += dt;
      if (!s.landed && s.t >= 0.12) {
        s.landed = true;
        if (s.sound) Sound.stamp();
        Plates.kick(0.9, 0.5);
        if (s.onLand) s.onLand();
      }
      if (s.t >= s.life) this.stamps.splice(i, 1);
    }
  },

  draw(ctx) {
    for (const p of this.parts) {
      const f = p.t / p.life;
      if (p.k === 'flake') {
        const pl = Plates[p.ink];
        ctx.save();
        ctx.globalAlpha = 1 - Ease.inQuad(f);
        ctx.translate(p.x + pl.x, p.y + pl.y);
        ctx.rotate(p.rot);
        const s = 1 + f * 0.15;
        ctx.fillStyle = INK[p.ink];
        ctx.fillRect(-p.w / 2 * s, -p.h / 2 * s, p.w * s, p.h * s);
        ctx.restore();
      } else if (p.k === 'drop') {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = 1 - f;
        ctx.fillStyle = INK[p.ink];
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1 - f * 0.5), 0, TAU);
        ctx.fill();
        ctx.restore();
      } else if (p.k === 'ring') {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = 1 - f;
        ctx.strokeStyle = INK[p.ink];
        ctx.lineWidth = p.lw * (1 - f * 0.7);
        ctx.beginPath();
        ctx.arc(p.x, p.y, lerp(p.r0, p.r1, Ease.outCubic(f)), 0, TAU);
        ctx.stroke();
        ctx.restore();
      } else if (p.k === 'dots') {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = INK[p.ink];
        const R = p.R * (0.4 + 0.6 * Ease.outCubic(f));
        const shrink = 1 - f;
        halftoneDisc(ctx, p.x, p.y, R, 7, p.a, (d) => (1 - d * 0.4) * shrink * (d > 0.35 ? 1 : d / 0.35));
        ctx.restore();
      } else if (p.k === 'jet') {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.strokeStyle = INK[p.ink];
        ctx.globalAlpha = 1 - f;
        ctx.lineCap = 'round';
        ctx.lineWidth = 7 * (1 - f) + 1;
        ctx.beginPath();
        ctx.moveTo(p.fromX, p.y0);
        ctx.lineTo(p.x, p.y1 + (p.y0 - p.y1) * Ease.inCubic(f));
        ctx.stroke();
        ctx.restore();
      } else if (p.k === 'spark') {
        ctx.save();
        ctx.strokeStyle = INK[p.ink];
        ctx.globalAlpha = 1 - f;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        ctx.stroke();
        ctx.restore();
      }
    }

    for (const fl of this.floats) {
      const f = fl.t / fl.life;
      const y = fl.y - Ease.outCubic(Math.min(1, f * 1.6)) * 26;
      const a = f < 0.7 ? 1 : 1 - (f - 0.7) / 0.3;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = fMono(fl.size, 700);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (fl.ink !== 'k') {
        const pl = Plates[fl.ink];
        ctx.fillStyle = INK[fl.ink];
        ctx.fillText(fl.text, fl.x + 1.5 + pl.x, y + 1.2 + pl.y);
      }
      ctx.fillStyle = INK.k;
      ctx.fillText(fl.text, fl.x, y);
      ctx.restore();
    }
  },

  drawStamps(ctx) {
    for (const s of this.stamps) {
      const st = makeStamp(s.text, s.sub, s.ink, s.size);
      let scale, alpha;
      if (s.t < 0.12) {
        const q = s.t / 0.12;
        scale = lerp(1.9, 1, Ease.inCubic(q));
        alpha = q;
      } else {
        scale = 1 + Math.max(0, 0.04 - (s.t - 0.12) * 0.3);
        alpha = s.t > s.hold + 0.12 ? clamp(1 - (s.t - s.hold - 0.12) / 0.38, 0, 1) : 1;
      }
      const pl = Plates[s.ink];
      ctx.save();
      ctx.globalAlpha = alpha * 0.94;
      ctx.globalCompositeOperation = 'multiply';
      ctx.translate(s.x + pl.x, s.y + pl.y);
      ctx.rotate(s.rot);
      ctx.scale(scale, scale);
      ctx.drawImage(st.cv, -st.w / 2, -st.h / 2, st.w, st.h);
      ctx.restore();
    }
  },
};

/* =========================================================
   Drops — inked stamps that fall from broken blocks
   ========================================================= */
const DROP_TYPES = {
  split:  { ink: 'b', icon: 'split',  label: 'Split',  weight: 22 },
  wide:   { ink: 'y', icon: 'wide',   label: 'Wide',   weight: 18 },
  slow:   { ink: 'b', icon: 'slow',   label: 'Slow',   weight: 14 },
  margin: { ink: 'y', icon: 'margin', label: 'Margin', weight: 14 },
  flood:  { ink: 'p', icon: 'flood',  label: 'Flood',  weight: 13 },
  tack:   { ink: 'p', icon: 'tack',   label: 'Tack',   weight: 11 },
  life:   { ink: 'k', icon: 'life',   label: '+1 Ball', weight: 6 },
};

function rollDropType(exclude = []) {
  const entries = Object.entries(DROP_TYPES).filter(([k]) => !exclude.includes(k));
  let total = 0;
  for (const [, v] of entries) total += v.weight;
  let r = Math.random() * total;
  for (const [k, v] of entries) { r -= v.weight; if (r <= 0) return k; }
  return entries[0][0];
}

class Drop {
  constructor(x, y, type) {
    this.x = x; this.y = y;
    this.type = type;
    this.vy = 125;
    this.t = rand(TAU);
    this.r = 13;
    this.dead = false;
  }
  update(dt) {
    this.t += dt;
    this.y += this.vy * dt;
    this.x += Math.sin(this.t * 3) * 14 * dt;
    if (perk('magnet') && this.y > GRID.y + 200) {
      this.x = approach(this.x, Paddle.x, 170 * dt);
    }
    this.x = clamp(this.x, FIELD.x + this.r, FIELD.r - this.r);
  }
  draw(ctx) {
    const d = DROP_TYPES[this.type];
    const rot = Math.sin(this.t * 2.4) * 0.25;
    // halftone shadow
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = rgba(INK.k, 0.5);
    halftoneDisc(ctx, this.x + 4, this.y + 5, this.r, 3.2, 0.3, () => 0.55);
    ctx.restore();
    const pl = Plates[d.ink];
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(rot);
    ctx.fillStyle = INK[d.ink];
    ctx.beginPath(); ctx.arc(pl.x, pl.y, this.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = INK.k;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, this.r, 0, TAU); ctx.stroke();
    drawIcon(ctx, d.icon, 0, 0, this.r * 1.55, d.ink === 'k' ? PAPER : INK.k);
    ctx.restore();
  }
}

/* =========================================================
   Ink wells — pass-through pots that re-ink the ball
   ========================================================= */
class Well {
  constructor(col, row, ink) {
    this.x = GRID.x + col * GRID.cw;
    this.y = GRID.y + row * GRID.ch;
    this.ink = ink;
    this.r = 17;
    this.pulse = 0;
    this.t = rand(TAU);
  }
  update(dt) {
    this.t += dt;
    this.pulse = Math.max(0, this.pulse - dt * 3);
  }
  draw(ctx) {
    const pl = Plates[this.ink];
    const bob = Math.sin(this.t * 1.6) * 1.5;
    const R = this.r * (1 + this.pulse * 0.25);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = INK[this.ink];
    halftoneDisc(ctx, this.x + pl.x, this.y + bob + pl.y, R - 1, 5.2, 0.26 + this.t * 0.15, (d) => 1.05 - d * 0.65);
    ctx.restore();
    ctx.strokeStyle = INK.k;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y + bob, R, 0, TAU);
    ctx.stroke();
    if (this.pulse > 0) {
      ctx.save();
      ctx.globalAlpha = this.pulse;
      ctx.strokeStyle = INK[this.ink];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y + bob, R + (1 - this.pulse) * 16, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/* =========================================================
   The moth — flutters across now and then. Hit it.
   ========================================================= */
class Moth {
  constructor() {
    const fromLeft = chance(0.5);
    this.dir = fromLeft ? 1 : -1;
    this.x = fromLeft ? FIELD.x - 24 : FIELD.r + 24;
    this.baseY = rand(GRID.y + 330, PADDLE_Y - 250);
    this.y = this.baseY;
    this.t = 0;
    this.speed = rand(72, 96);
    this.r = 15;
    this.gone = false;
    this.vx = 0;
    this.vy = 0;
  }
  update(dt) {
    this.t += dt;
    const px = this.x, py = this.y;
    this.x += this.dir * this.speed * dt;
    this.y = this.baseY + Math.sin(this.t * 1.7) * 36 + Math.sin(this.t * 4.6) * 7;
    this.vx = (this.x - px) / dt;
    this.vy = (this.y - py) / dt;
    if ((this.dir > 0 && this.x > FIELD.r + 30) || (this.dir < 0 && this.x < FIELD.x - 30)) this.gone = true;
  }
  draw(ctx, time) {
    const flap = 0.35 + 0.65 * Math.abs(Math.sin(this.t * 13));
    const pp = Plates.p, py = Plates.y;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(Math.sin(this.t * 4.6) * 0.12);
    ctx.globalCompositeOperation = 'multiply';
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.scale(s, 1);
      ctx.fillStyle = INK.y;
      ctx.beginPath();
      ctx.ellipse(9 + py.x, 6 + py.y, 7 * flap + 1, 6, 0.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = INK.p;
      ctx.beginPath();
      ctx.ellipse(10 + pp.x, -4 + pp.y, 11 * flap + 1.5, 8, -0.35, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = INK.k;
    ctx.beginPath();
    ctx.ellipse(0, 1, 3, 9, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = INK.k;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-1, -7); ctx.quadraticCurveTo(-4, -14, -8, -15);
    ctx.moveTo(1, -7); ctx.quadraticCurveTo(4, -14, 8, -15);
    ctx.stroke();
    ctx.restore();
  }
}

/* =========================================================
   Hazards — what bosses throw at the roller
   ========================================================= */
class Hazard {
  constructor(kind, x, y, vx, vy, ink, o = {}) {
    this.kind = kind;              // 'drip' | 'slug' | 'dot' | 'shard' | 'chip'
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.ink = ink;
    this.g = o.g ?? 0;
    this.r = o.r ?? 6;
    this.t = 0;
    this.rot = rand(TAU);
    this.dead = false;
  }
  update(dt) {
    this.t += dt;
    this.vy += this.g * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += dt * 4;
    if (this.x < FIELD.x + this.r) { this.x = FIELD.x + this.r; this.vx = Math.abs(this.vx); }
    if (this.x > FIELD.r - this.r) { this.x = FIELD.r - this.r; this.vx = -Math.abs(this.vx); }
  }
  draw(ctx) {
    const pl = Plates[this.ink];
    ctx.save();
    ctx.translate(this.x + pl.x, this.y + pl.y);
    ctx.fillStyle = INK[this.ink];
    if (this.kind === 'drip') {
      const st = clamp(this.vy / 500, 0, 0.8);
      ctx.beginPath();
      ctx.moveTo(0, -this.r * (1.6 + st * 1.5));
      ctx.quadraticCurveTo(this.r * 1.05, -this.r * 0.2, this.r, this.r * 0.25);
      ctx.arc(0, this.r * 0.25, this.r, 0, Math.PI);
      ctx.quadraticCurveTo(-this.r * 1.05, -this.r * 0.2, 0, -this.r * (1.6 + st * 1.5));
      ctx.fill();
    } else if (this.kind === 'slug') {
      ctx.rotate(Math.sin(this.t * 6) * 0.3);
      ctx.fillRect(-4, -8, 8, 16);
      ctx.fillStyle = PAPER;
      ctx.fillRect(-1.5, -5, 3, 10);
    } else if (this.kind === 'shard') {
      ctx.rotate(Math.atan2(this.vy, this.vx) + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, 11); ctx.lineTo(5, -7); ctx.lineTo(-5, -7); ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = INK.k; ctx.lineWidth = 1.4; ctx.stroke();
    } else if (this.kind === 'chip') {
      ctx.rotate(this.rot);
      ctx.fillRect(-6, -6, 12, 12);
      ctx.strokeStyle = INK.k; ctx.lineWidth = 1.4; ctx.strokeRect(-6, -6, 12, 12);
    } else {
      ctx.beginPath(); ctx.arc(0, 0, this.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = INK.k; ctx.lineWidth = 1.4; ctx.stroke();
    }
    ctx.restore();
  }
}
