'use strict';
/* =========================================================
   MISPRINT — bosses
   The same ink rule holds: a hit soaks the ball in the
   boss's colour; hitting that colour again releases it for
   big damage.
   ========================================================= */

const BOSS_NAMES = { blot: 'The Blot', press: 'The Press', misreg: 'Misregister' };

const BOSS_BACKDROPS = {
  blot(g) {
    for (const [x, y, s, seed] of [[118, 640, 118, 7], [512, 430, 92, 11], [392, 780, 70, 19]]) {
      g.save();
      g.beginPath();
      splatPath(g, x, y, s, 0, 0, mulberry32(seed));
      g.clip();
      g.fillStyle = INK.b;
      halftoneField(g, x - s * 2.3, y - s * 2.3, s * 4.6, s * 4.6, 9, 0.26, () => 0.9);
      g.restore();
    }
  },
  press(g) {
    g.fillStyle = INK.y;
    halftoneField(g, 0, 540, 640, 328, 11, 0.26, (x, y) => (((x + y) % 90) < 45 ? 0.95 : 0.1) * smooth(560, 690, y));
  },
  misreg(g) {
    g.lineWidth = 12;
    for (const [ink, x, y] of [['p', 304, 560], ['b', 338, 546], ['y', 322, 586]]) {
      g.strokeStyle = INK[ink];
      g.beginPath();
      g.arc(x, y, 150, 0, TAU);
      g.moveTo(x - 250, y); g.lineTo(x + 250, y);
      g.moveTo(x, y - 250); g.lineTo(x, y + 250);
      g.stroke();
    }
  },
};

function makeBoss(id, act) {
  if (id === 'blot') return new BossBlot(act);
  if (id === 'press') return new BossPress(act);
  return new BossMisreg(act);
}

function bossHitFX(x, y, ink, big, nx = 0, ny = 1) {
  FX.droplets(x, y, ink, big ? 11 : 5, nx, ny, big ? 270 : 160);
  if (big) {
    FX.dots(x, y, ink, 44, 0.45);
    FX.ring(x, y, ink, 6, 56, 0.4, 4);
  }
  Decal.splat(x, y, ink, big ? 15 : 8, -nx, -ny, 0.45);
  Sound.bossHit(x, big);
  Plates.kick(big ? 0.95 : 0.35, 0.3);
  if (big) G.hitstop = Math.max(G.hitstop, 0.05);
}

function bossScore(ball, dmg, x, y, ink) {
  const v = ++ball.volley;
  const pts = 25 * dmg * Math.min(v, 40);
  addScore(pts);
  FX.float(x, y - 16, '+' + fmt(pts), dmg >= 3 ? ink : 'k', dmg >= 3 ? 16 : 13, 0.8);
}

function drawBossBar(ctx, label, frac, ink, y = 74) {
  const w = 176;
  const x = FIELD.cx - w / 2;
  ctx.save();
  const pl = Plates[ink];
  ctx.fillStyle = INK[ink];
  ctx.fillRect(x + pl.x, y - 3 + pl.y, w * clamp(frac, 0, 1), 6);
  ctx.strokeStyle = INK.k;
  ctx.lineWidth = 1.3;
  ctx.strokeRect(x, y - 3, w, 6);
  for (let i = 1; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(x + (w / 8) * i, y - 3);
    ctx.lineTo(x + (w / 8) * i, y - 1);
    ctx.stroke();
  }
  ctx.restore();
}

/* smooth closed blob path */
function blobPath(ctx, R, t, seed, sq) {
  const N = 26;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const w = 1 + 0.055 * Math.sin(3 * a + t * 2.1 + seed) + 0.04 * Math.sin(5 * a - t * 1.6 + seed * 2) + 0.022 * Math.sin(8 * a + t * 3.2);
    pts.push([Math.cos(a) * R * w * (1 + sq * 0.14), Math.sin(a) * R * w * (1 - sq * 0.14)]);
  }
  ctx.beginPath();
  const m0x = (pts[N - 1][0] + pts[0][0]) / 2, m0y = (pts[N - 1][1] + pts[0][1]) / 2;
  ctx.moveTo(m0x, m0y);
  for (let i = 0; i < N; i++) {
    const p = pts[i], q = pts[(i + 1) % N];
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  ctx.closePath();
}

function nearestBall(x, y) {
  let best = null, bd = Infinity;
  for (const b of G.balls) {
    if (b.dead) continue;
    const d = (b.x - x) ** 2 + (b.y - y) ** 2;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/* =========================================================
   I · The Blot
   ========================================================= */
class InkBlob {
  constructor(x, y, R, hp, ink, big) {
    this.x = x; this.y = y;
    this.R = R;
    this.hp = hp; this.max = hp;
    this.ink = ink;
    this.big = big;
    this.vx = 0; this.vy = 0;
    this.seed = rand(100);
    this.hurt = 0;
    this.sq = 0; this.sqv = 0;
    this.blinkT = rand(1, 4);
    this.blink = 0;
    this.dripT = rand(1.8, 3.2);
    this.dead = false;
    this.lookX = 0; this.lookY = 0;
    this.wvx = 0; this.wvy = 0;
  }
}

class BossBlot {
  constructor(act) {
    this.act = act;
    this.name = 'The Blot';
    this.wells = [[2.2, 17.6, 'p'], [6.5, 19.2, 'b'], [10.8, 17.6, 'y']];
    this.cx = FIELD.cx;
    this.cy = FIELD.y + 250;
    this.big = new InkBlob(this.cx, FIELD.y - 120, 80, 24, 'p', true);
    this.blobs = [this.big];
    this.t = 0;
    this.ph = 0;
    this.introT = 0;
    this.entering = true;
    this.done = false;
    this.inks = ['p', 'b', 'y'];
    this.moodIdx = 0;
  }

  /** Ink Jet: a blob directly above takes a hit. Returns where the jet stops. */
  jet(x, ball) {
    let best = null;
    for (const bl of this.blobs) {
      if (bl.dead || Math.abs(bl.x - x) > bl.R * 0.85) continue;
      if (!best || bl.y > best.y) best = bl;
    }
    if (!best || this.entering) return null;
    const dmg = 1 + perk('bounty');
    best.hp -= dmg;
    best.hurt = 1;
    best.sqv += 4;
    bossHitFX(x, best.y + best.R * 0.8, best.ink, false, 0, 1);
    if (best.hp <= 0) this.pop(best);
    return best.y + best.R * 0.85;
  }

  /** Where a returning ball should lean: the nearest blob. */
  aimPoint(ball) {
    let best = null, bd = Infinity;
    for (const bl of this.blobs) {
      if (bl.dead) continue;
      const d = (bl.x - ball.x) ** 2 + (bl.y - ball.y) ** 2;
      if (d < bd) { bd = d; best = bl; }
    }
    return best;
  }

  skipIntro() {
    if (!this.entering) return;
    this.entering = false;
    this.big.y = this.cy;
  }

  update(dt) {
    this.t += dt;
    if (this.entering) {
      this.introT += dt;
      const f = clamp(this.introT / 1.0, 0, 1);
      this.big.y = lerp(FIELD.y - 120, this.cy, Ease.outBack(f));
      if (f >= 1) this.entering = false;
    }
    const playing = G.phase === 'play' && !this.entering;
    for (const bl of this.blobs) {
      if (bl.dead) continue;
      const px = bl.x, py = bl.y;
      if (bl.big) {
        const hpF = bl.hp / bl.max;
        this.ph += dt * (1 + (1 - hpF) * 0.55) * (playing ? 1 : 0.4);
        if (!this.entering) {
          bl.x = this.cx + 176 * Math.sin(this.ph * 0.37);
          bl.y = this.cy + 64 * Math.sin(this.ph * 0.6 + 1);
        }
      } else {
        bl.x += bl.wvx * dt;
        bl.y += bl.wvy * dt;
        const minY = FIELD.y + bl.R + 4, maxY = FIELD.y + 470;
        if (bl.x < FIELD.x + bl.R) { bl.x = FIELD.x + bl.R; bl.wvx = Math.abs(bl.wvx); }
        if (bl.x > FIELD.r - bl.R) { bl.x = FIELD.r - bl.R; bl.wvx = -Math.abs(bl.wvx); }
        if (bl.y < minY) { bl.y = minY; bl.wvy = Math.abs(bl.wvy); }
        if (bl.y > maxY) { bl.y = maxY; bl.wvy = -Math.abs(bl.wvy); }
        // gentle steering keeps them lively
        const a = Math.atan2(bl.wvy, bl.wvx) + Math.sin(this.t * 1.3 + bl.seed) * dt * 0.9;
        const sp = Math.hypot(bl.wvx, bl.wvy);
        bl.wvx = Math.cos(a) * sp;
        bl.wvy = Math.sin(a) * sp;
      }
      bl.vx = dt > 0 ? (bl.x - px) / dt : 0;
      bl.vy = dt > 0 ? (bl.y - py) / dt : 0;

      bl.sqv += -220 * bl.sq * dt - 9 * bl.sqv * dt;
      bl.sq += bl.sqv * dt;
      bl.hurt = Math.max(0, bl.hurt - dt * 3);
      bl.blinkT -= dt;
      if (bl.blinkT <= 0) { bl.blink = 0.14; bl.blinkT = rand(2, 5); }
      bl.blink = Math.max(0, bl.blink - dt);

      const nb = nearestBall(bl.x, bl.y);
      if (nb) {
        const dx = nb.x - bl.x, dy = nb.y - bl.y, d = Math.hypot(dx, dy) || 1;
        bl.lookX = damp(bl.lookX, dx / d, 10, dt);
        bl.lookY = damp(bl.lookY, dy / d, 10, dt);
      }

      if (playing) {
        bl.dripT -= dt;
        if (bl.dripT <= 0) {
          const hpF = bl.hp / bl.max;
          bl.dripT = (bl.big ? rand(2.4, 3.8) : rand(4.0, 6.0)) * (0.8 + hpF * 0.2);
          const drips = bl.big && hpF < 0.4 ? 2 : 1;
          for (let i = 0; i < drips; i++) {
            G.hazards.push(new Hazard('drip', bl.x + rand(-bl.R * 0.45, bl.R * 0.45), bl.y + bl.R * 0.85, bl.vx * 0.15, 20, bl.ink, { g: 460, r: 6 }));
          }
          Sound.drip(bl.x);
          bl.sqv -= 3;
        }
      }
    }
  }

  collide(ball) {
    if (this.entering || this.done) return;
    for (const bl of this.blobs) {
      if (bl.dead) continue;
      const hit = circleCircle(ball.x, ball.y, ball.r, bl.x, bl.y, bl.R * 0.93);
      if (!hit) continue;
      reflectBall(ball, hit, bl.vx, bl.vy);
      this.hitBlob(bl, ball, hit);
      return;
    }
  }

  hitBlob(bl, ball, hit) {
    const smash = ball.pierce > 0;
    const match = inkMatches(ball, bl.ink);
    let dmg = (match ? 5 : 2) + perk('bounty');
    if (smash) { dmg += 3; ball.pierce = 0; }
    const before = bl.hp;
    bl.hp -= dmg;
    bl.hurt = 1;
    bl.sqv += match ? 9 : 5;
    ball.idle = 0;
    ball.touched = true;
    const px = ball.x - hit.nx * ball.r, py = ball.y - hit.ny * ball.r;
    bossHitFX(px, py, bl.ink, match || smash, -hit.nx, -hit.ny);
    bossScore(ball, dmg, px, py, bl.ink);
    if (match) {
      releaseInk(ball);
    } else {
      soakInk(ball, bl.ink);
      Sound.soak(ball.x);
      hint('bosssoak', `Soaked ${INK_NAME[bl.ink]} — hit it again while ${INK_NAME[bl.ink]} for a big splash`, 4.5);
    }
    if (bl.hp <= 0) { this.pop(bl); return; }
    // the big blot changes colour at two clear thresholds, never on a timer
    if (bl.big) {
      const step = (h) => (h > bl.max * 2 / 3 ? 0 : h > bl.max / 3 ? 1 : 2);
      if (step(bl.hp) !== step(before)) {
        this.moodIdx = step(bl.hp);
        bl.ink = this.inks[this.moodIdx];
        bl.sqv += 8;
        FX.ring(bl.x, bl.y, bl.ink, bl.R * 0.6, bl.R * 1.7, 0.5, 5);
        FX.float(bl.x, bl.y - bl.R - 12, `NOW ${INK_NAME[bl.ink].toUpperCase()}`, bl.ink, 15, 1.2);
        Sound.soak(bl.x);
      }
    }
  }

  pop(bl) {
    bl.dead = true;
    FX.dots(bl.x, bl.y, bl.ink, bl.R * 1.6, 0.6);
    FX.ring(bl.x, bl.y, 'k', bl.R * 0.5, bl.R * 2, 0.5, 5);
    FX.droplets(bl.x, bl.y, bl.ink, 18, 0, 0, 340);
    FX.droplets(bl.x, bl.y, 'k', 8, 0, 0, 300);
    for (let i = 0; i < 4; i++) Decal.splat(bl.x + rand(-bl.R, bl.R) * 0.6, bl.y + rand(-bl.R, bl.R) * 0.6, bl.ink, bl.R * rand(0.3, 0.55), 0, 0, 0.5);
    Plates.kick(2, 0.7);
    G.hitstop = Math.max(G.hitstop, 0.09);
    if (bl.big) {
      Sound.bomb(bl.x);
      const hp = 6 + this.act;
      this.inks.forEach((ink, i) => {
        const s = new InkBlob(bl.x + (i - 1) * 30, bl.y + rand(-10, 10), 38, hp, ink, false);
        const a = -Math.PI / 2 + (i - 1) * 1.1 + rand(-0.2, 0.2);
        const sp = rand(92, 115);
        s.wvx = Math.cos(a) * sp;
        s.wvy = Math.sin(a) * sp;
        s.sqv = 8;
        this.blobs.push(s);
      });
      FX.float(bl.x, bl.y - 30, 'IT SPLIT', 'k', 15, 1.2);
    } else {
      Sound.bossHit(bl.x, true);
      if (this.blobs.every((b) => b.dead)) {
        this.done = true;
        Sound.bossDie();
        bossDefeated();
      }
    }
  }

  draw(ctx, t) {
    for (const bl of this.blobs) {
      if (bl.dead) continue;
      this.drawBlob(ctx, bl, t);
    }
  }

  drawBlob(ctx, bl, t) {
    const R = bl.R;
    const ink = bl.ink;
    const pl = Plates[ink];
    ctx.save();
    ctx.translate(bl.x, bl.y);

    // halftone shadow on the paper
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = rgba(INK.k, 0.4);
    halftoneDisc(ctx, 10, R * 0.25 + 14, R * 0.95, 6, 0.4, (d) => 0.6 * (1 - d));
    ctx.restore();

    ctx.save();
    ctx.translate(pl.x, pl.y);
    ctx.fillStyle = INK[ink];
    blobPath(ctx, R, t, bl.seed, bl.sq);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = rgba(INK.k, 0.5);
    halftoneDisc(ctx, 0, 0, R * 1.15, 6.5, 0.5, (d, ux, uy) => clamp((ux * 0.55 + uy * 0.85 - 0.05) * 1.4, 0, 0.95));
    ctx.restore();
    if (bl.hurt > 0) {
      ctx.fillStyle = rgba(PAPER_HI, bl.hurt * 0.7);
      blobPath(ctx, R, t, bl.seed, bl.sq);
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = INK.k;
    ctx.lineWidth = bl.big ? 3 : 2.2;
    blobPath(ctx, R, t, bl.seed, bl.sq);
    ctx.stroke();

    // face
    const ex = R * 0.3, ey = -R * 0.16;
    const ew = R * 0.15, eh = R * 0.19 * (bl.blink > 0 ? 0.12 : 1);
    for (const s of [-1, 1]) {
      ctx.fillStyle = PAPER_HI;
      ctx.beginPath();
      ctx.ellipse(s * ex, ey, ew, eh, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = INK.k;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      if (bl.hurt > 0.4) {
        ctx.beginPath();
        ctx.moveTo(s * ex - ew * 0.6, ey - eh * 0.4); ctx.lineTo(s * ex + ew * 0.6, ey + eh * 0.4);
        ctx.moveTo(s * ex + ew * 0.6, ey - eh * 0.4); ctx.lineTo(s * ex - ew * 0.6, ey + eh * 0.4);
        ctx.stroke();
      } else if (bl.blink <= 0) {
        ctx.fillStyle = INK.k;
        ctx.beginPath();
        ctx.arc(s * ex + bl.lookX * ew * 0.45, ey + bl.lookY * eh * 0.45, R * 0.07, 0, TAU);
        ctx.fill();
      }
    }
    ctx.strokeStyle = INK.k;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (bl.hurt > 0.3) {
      ctx.arc(0, R * 0.22, R * 0.08, 0, TAU);
    } else {
      ctx.arc(0, R * 0.12, R * 0.16, 0.25 * Math.PI, 0.75 * Math.PI);
    }
    ctx.stroke();
    ctx.restore();
  }

  healthParts() {
    let frac;
    if (!this.big.dead) frac = 0.5 + 0.5 * clamp(this.big.hp / this.big.max, 0, 1);
    else {
      let hp = 0, max = 0;
      for (const b of this.blobs) if (!b.big) { hp += Math.max(0, b.hp); max += b.max; }
      frac = max ? 0.5 * hp / max : 0;
    }
    return [{ frac, ink: this.big.dead ? 'k' : this.big.ink }];
  }

  drawHealth(ctx) {
    const p = this.healthParts()[0];
    drawBossBar(ctx, this.name, p.frac, p.ink);
  }
}

/* =========================================================
   II · The Press
   ========================================================= */
class BossPress {
  constructor(act) {
    this.act = act;
    this.name = 'The Press';
    this.wells = [];
    this.h = 66;
    this.baseY = FIELD.y + 20;
    this.y = FIELD.y - 200;
    this.vy = 0;
    this.state = 'enter';
    this.stateT = 0;
    this.slamT = 7.5;
    this.slugT = 4;
    this.descend = 5 + act * 1.2;
    this.jit = 0;
    this.done = false;
    this.crushY = PADDLE_Y - 64;
    this.slamFrom = 0;
    const letters = 'MISPRINT'.split('');
    const stacks = [
      ['b', 'y', 'p'], ['y', 'b', 'p'], ['p', 'y', 'b'], ['y', 'p', 'b'],
      ['b', 'p', 'y'], ['p', 'b', 'y'], ['y', 'b', 'p'], ['b', 'y', 'p'],
    ];
    const n = 8, tw = 60, gap = 10;
    const total = n * tw + (n - 1) * gap;
    const x0 = FIELD.cx - total / 2;
    this.types = letters.map((ch, i) => ({
      i, letter: ch,
      x: x0 + i * (tw + gap), w: tw, h: 40,
      layers: stacks[i].slice(),
      alive: true, flash: 0, settle: 0, wet: 0,
      jy: 0, jvy: 0,
    }));
  }

  skipIntro() {
    if (this.state !== 'enter') return;
    this.y = this.baseY;
    this.state = 'idle';
    this.stateT = 0;
  }

  /** Lean returning balls toward the nearest piece of type still hanging. */
  aimPoint(ball) {
    let best = null, bd = Infinity;
    const ty = this.y + this.h + 2 + 20;
    for (const t of this.types) {
      if (!t.alive) continue;
      const cx = t.x + t.w / 2;
      const d = Math.abs(cx - ball.x);
      if (d < bd) { bd = d; best = { x: cx, y: ty }; }
    }
    return best;
  }

  bottom() { return this.y + this.h + 2 + 40; }

  update(dt) {
    const py = this.y;
    this.stateT += dt;
    const playing = G.phase === 'play';
    const alive = this.types.filter((t) => t.alive).length;
    switch (this.state) {
      case 'enter': {
        const f = clamp(this.stateT / 1.0, 0, 1);
        this.y = lerp(FIELD.y - 200, this.baseY, Ease.outCubic(f));
        if (f >= 1) { this.state = 'idle'; this.stateT = 0; Sound.slam(); Plates.kick(1.2, 0.6); }
        break;
      }
      case 'idle':
        if (playing) {
          this.y += this.descend * (1 + (8 - alive) * 0.06) * dt;
          this.slamT -= dt;
          if (this.slamT <= 0) { this.state = 'tele'; this.stateT = 0; Sound.creak(); }
        }
        break;
      case 'tele':
        this.jit = Math.sin(this.stateT * 70) * 2.2;
        if (this.stateT > 0.75) { this.state = 'slam'; this.stateT = 0; this.slamFrom = this.y; this.jit = 0; }
        break;
      case 'slam': {
        const f = clamp(this.stateT / 0.11, 0, 1);
        this.y = this.slamFrom + 64 * Ease.inQuad(f);
        if (f >= 1) {
          this.state = 'rise';
          this.stateT = 0;
          this.slamFrom = this.y;
          Sound.slam();
          Plates.kick(2.1, 0.9);
          G.hitstop = Math.max(G.hitstop, 0.07);
          for (const t of this.types) if (t.alive) t.jvy += 60;
          const live = this.types.filter((t) => t.alive);
          for (let i = 0; i < 2 && live.length; i++) {
            const t = pick(live);
            G.hazards.push(new Hazard('slug', t.x + t.w / 2, this.bottom() + 6, rand(-40, 40), 80, 'k', { g: 520, r: 6 }));
          }
          this.slamT = rand(5.5, 7.5) * (0.6 + alive / 8 * 0.4);
        }
        break;
      }
      case 'rise': {
        const f = clamp(this.stateT / 1.0, 0, 1);
        this.y = this.slamFrom - 44 * Ease.outCubic(f);
        if (f >= 1) { this.state = 'idle'; this.stateT = 0; }
        break;
      }
      case 'reset': {
        const f = clamp(this.stateT / 0.9, 0, 1);
        this.y = lerp(this.slamFrom, this.baseY, Ease.inOutCubic(f));
        if (f >= 1) { this.state = 'idle'; this.stateT = 0; }
        break;
      }
      default: break;
    }
    if (this.y < this.baseY && this.state !== 'enter' && this.state !== 'reset') this.y = this.baseY;
    this.vy = dt > 0 ? (this.y - py) / dt : 0;

    for (const t of this.types) {
      t.flash = Math.max(0, t.flash - dt * 9);
      t.settle = Math.max(0, t.settle - dt * 9);
      t.jvy += (-420 * t.jy - 18 * t.jvy) * Math.min(dt, 1 / 60);
      t.jy += t.jvy * Math.min(dt, 1 / 60);
    }

    if (playing) {
      this.slugT -= dt;
      if (this.slugT <= 0) {
        this.slugT = rand(3.2, 4.6);
        const live = this.types.filter((t) => t.alive);
        if (live.length) {
          const t = pick(live);
          G.hazards.push(new Hazard('slug', t.x + t.w / 2, this.bottom() + 4, rand(-30, 30), 40, 'k', { g: 480, r: 6 }));
        }
      }
      if (this.bottom() >= this.crushY && this.state !== 'enter' && this.state !== 'reset') {
        Sound.slam();
        Plates.kick(2.4, 1);
        FX.float(FIELD.cx, this.bottom() + 30, 'CRUSHED', 'p', 20, 1.2);
        loseLife();
        this.state = 'reset';
        this.stateT = 0;
        this.slamFrom = this.y;
        this.slamT = 7;
      }
    }
  }

  collide(ball) {
    if (this.done || this.state === 'enter') return;
    // type blocks first — they hang below the platen
    for (const t of this.types) {
      if (!t.alive) continue;
      const ty = this.y + this.h + 2;
      const hit = circleRect(ball.x, ball.y, ball.r, t.x, ty, t.w, t.h);
      if (!hit) continue;
      reflectBall(ball, hit, 0, this.vy);
      this.hitType(t, ball, hit);
      return;
    }
    const hit = circleRect(ball.x, ball.y, ball.r, FIELD.x, this.y, FIELD.w, this.h);
    if (hit) {
      ball.touched = true;
      if (reflectBall(ball, hit, 0, this.vy)) {
        Sound.keyHit(ball.x);
        FX.sparks(ball.x, ball.y - ball.r, 'k', 3, 200);
      }
      if (ball.vy < 0 && hit.ny > 0.5) ball.vy = Math.abs(ball.vy);
    }
  }

  hitType(t, ball, hit) {
    ball.idle = 0;
    ball.touched = true;
    t.jvy += 50;
    const smash = ball.pierce > 0;
    const top = t.layers[t.layers.length - 1];
    for (let i = 0; i < perk('bounty'); i++) if (t.alive && t.layers.length > 1) this.peelType(t, ball, false);
    const top2 = t.layers[t.layers.length - 1];
    if (smash) {
      ball.pierce = 0;
      this.peelType(t, ball, true);
      if (t.alive) this.peelType(t, ball, true);
      soakInk(ball, top2);
      return;
    }
    if (inkMatches(ball, top2)) {
      // bleed along the row of type
      const run = [t];
      const top = top2;
      for (let i = t.i - 1; i >= 0 && this.types[i].alive && this.types[i].layers[this.types[i].layers.length - 1] === top; i--) run.push(this.types[i]);
      for (let i = t.i + 1; i < this.types.length && this.types[i].alive && this.types[i].layers[this.types[i].layers.length - 1] === top; i++) run.push(this.types[i]);
      run.forEach((tp) => { tp.wet = 1; });
      run.sort((a, b) => Math.abs(a.i - t.i) - Math.abs(b.i - t.i));
      run.forEach((tp) => after(Math.abs(tp.i - t.i) * 0.06, () => {
        tp.wet = 0;
        if (tp.alive && tp.layers[tp.layers.length - 1] === top) this.peelType(tp, ball, false);
      }));
      Sound.bleed(run.length, ball.x);
      Plates.kick(0.6 + run.length * 0.1, 0.3);
      G.hitstop = Math.max(G.hitstop, 0.04);
      releaseInk(ball);
    } else {
      this.peelType(t, ball, false);
      soakInk(ball, top2);
    }
  }

  /** Ink Jet: peels the piece of type directly above. */
  jet(x, ball) {
    if (this.state === 'enter' || this.done) return null;
    const ty = this.y + this.h + 2;
    for (const t of this.types) {
      if (!t.alive || x < t.x || x > t.x + t.w) continue;
      this.peelType(t, ball, false);
      return ty + t.h;
    }
    return this.y + this.h;
  }

  peelType(t, ball, heavy) {
    if (!t.alive) return;
    const n = t.layers.length;
    const ink = t.layers.pop();
    const fw = t.w - LAYER_STEP * (n - 1), fh = t.h - LAYER_STEP * (n - 1);
    const ty = this.y + this.h + 2;
    const cx = t.x + fw / 2, cy = ty + fh / 2;
    FX.flake(cx, cy, fw, fh, ink, 0, 1);
    FX.droplets(cx, cy, ink, 7, 0, 1, 200);
    Decal.ghost(t.x, ty, t.w, t.h, ink);
    Decal.splat(cx, cy + 10, ink, 9, 0, 1, 0.4);
    t.flash = 1;
    t.settle = t.layers.length ? 1 : 0;
    const v = ball ? ++ball.volley : 1;
    const pts = 30 * Math.min(v, 40);
    addScore(pts);
    FX.float(cx, cy + 34, '+' + pts, ink, 14, 0.8);
    Sound.peel(ink, v - 1, cx);
    Plates.kick(heavy ? 0.8 : 0.3, 0.3);
    this.y = Math.max(this.baseY, this.y - 13);
    if (this.state === 'tele') { this.state = 'idle'; this.stateT = 0; this.slamT = 2.5; this.jit = 0; }
    if (!t.layers.length) {
      t.alive = false;
      FX.flake(t.x + t.w / 2, ty + t.h / 2, 26, 30, 'k', 0, 1);
      if (this.types.every((x) => !x.alive)) this.die();
    }
  }

  die() {
    if (this.done) return;
    this.done = true;
    Sound.bossDie();
    Plates.kick(2.6, 1);
    G.hitstop = Math.max(G.hitstop, 0.12);
    for (let i = 0; i < 16; i++) {
      FX.flake(FIELD.x + rand(FIELD.w), this.y + rand(this.h), rand(30, 70), rand(10, 24), 'k', rand(-1, 1), -1);
    }
    FX.dots(FIELD.cx, this.y + this.h / 2, 'k', 140, 0.7);
    Decal.splat(FIELD.cx, this.y + this.h, 'k', 30, 0, 1, 0.5);
    this.crumble = 1;
    bossDefeated();
  }

  draw(ctx, t) {
    if (this.crumble) return;
    const k = Plates.k;
    const x0 = FIELD.x + this.jit + k.x;
    const y = this.y + k.y;

    // screw rods
    for (const rx of [FIELD.x + 74, FIELD.r - 74]) {
      const top = FIELD.y + 2;
      ctx.fillStyle = INK.k;
      ctx.fillRect(rx - 7 + k.x, top + k.y, 14, Math.max(0, y - top));
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = 1.4;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx - 7 + k.x, top + k.y, 14, Math.max(0, y - top));
      ctx.clip();
      ctx.beginPath();
      const ph = (this.y * 0.5) % 8;
      for (let yy = top - 16 + ph; yy < y; yy += 8) {
        ctx.moveTo(rx - 7 + k.x, yy + k.y);
        ctx.lineTo(rx + 7 + k.x, yy + 5 + k.y);
      }
      ctx.stroke();
      ctx.restore();
    }
    // head beam
    ctx.fillStyle = INK.k;
    ctx.fillRect(FIELD.x + k.x, FIELD.y + k.y, FIELD.w, 10);

    // the platen
    ctx.fillStyle = INK.k;
    ctx.fillRect(x0, y, FIELD.w, this.h);
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 6.5, y + 6.5, FIELD.w - 13, this.h - 13);
    ctx.fillStyle = PAPER;
    for (let i = 0; i < 12; i++) {
      const rx = x0 + 22 + i * ((FIELD.w - 44) / 11);
      ctx.beginPath(); ctx.arc(rx, y + 14, 2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(rx, y + this.h - 14, 2, 0, TAU); ctx.fill();
    }
    const yp = Plates.y;
    ctx.fillStyle = INK.y;
    ctx.fillRect(FIELD.cx - 46 + yp.x + this.jit, y + this.h / 2 - 11 + yp.y, 92, 22);
    ctx.fillStyle = INK.k;
    ctx.font = fMono(11, 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    spaced(ctx, 'NO. 2', FIELD.cx + this.jit, y + this.h / 2 + 1, 2.5, 'center');
    ctx.textBaseline = 'alphabetic';

    // type, hanging from the platen (letters are mirrored, as type is)
    const ty = this.y + this.h + 2;
    for (const tp of this.types) {
      if (!tp.alive) continue;
      const n = tp.layers.length;
      const st = Ease.outCubic(tp.settle);
      const depthCount = n - 1 + st;
      const fw = tp.w - LAYER_STEP * depthCount, fh = tp.h - LAYER_STEP * depthCount;
      const bx = tp.x + this.jit, by = ty + tp.jy;
      for (let i = 0; i < n; i++) {
        const ink = tp.layers[i];
        const d = (n - 1 - i) + st;
        const pl = Plates[ink];
        const x = bx + d * LAYER_STEP + pl.x, yy = by + d * LAYER_STEP + pl.y;
        if (i > 0) { ctx.fillStyle = PAPER; ctx.fillRect(x, yy, fw + 1.5, fh + 1.5); }
        ctx.fillStyle = INK[ink];
        ctx.fillRect(x, yy, fw, fh);
        if (i === n - 1) {
          ctx.save();
          ctx.translate(x + fw / 2, yy + fh / 2 + 1);
          ctx.scale(-1, 1);
          ctx.fillStyle = ink === 'y' ? INK.k : PAPER_HI;
          ctx.font = fDisplay(Math.round(fh * 0.62));
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(tp.letter, 0, 1);
          ctx.restore();
          if (Settings.patterns) drawInkMark(ctx, ink, x + 9, yy + 8, 12);
          if (tp.wet > 0) { ctx.fillStyle = rgba(PAPER, 0.3 + 0.25 * Math.sin(t * 40)); ctx.fillRect(x, yy, fw, fh); }
          if (tp.flash > 0) { ctx.fillStyle = rgba(PAPER_HI, tp.flash); ctx.fillRect(x, yy, fw, fh); }
        }
      }
    }

    // the crush line, when it matters
    const gap = this.crushY - this.bottom();
    if (gap < 150 && G.phase === 'play') {
      const a = clamp(1 - gap / 150, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.25 + a * 0.6;
      ctx.strokeStyle = INK.p;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -t * 30;
      ctx.beginPath();
      ctx.moveTo(FIELD.x, this.crushY);
      ctx.lineTo(FIELD.r, this.crushY);
      ctx.stroke();
      ctx.restore();
    }
  }

  healthParts() {
    let left = 0;
    for (const t of this.types) left += t.layers.length;
    return [{ frac: left / 24, ink: 'k' }];
  }

  drawHealth(ctx) {
    drawBossBar(ctx, this.name, this.healthParts()[0].frac, 'k');
  }
}

/* =========================================================
   III · Misregister — three plates that won't line up
   ========================================================= */
class BossMisreg {
  constructor(act) {
    this.act = act;
    this.name = 'Misregister';
    this.wells = [[1.6, 18.8, 'p'], [6.5, 20.2, 'b'], [11.4, 18.8, 'y']];
    this.cx = FIELD.cx;
    this.cy = FIELD.y + 290;
    this.t = 0;
    this.T = 0;
    this.introT = 0;
    this.entering = true;
    this.done = false;
    const hp = 10;
    this.shapes = [
      { kind: 'circle', ink: 'p', R: 58, hp, max: hp, ax: 190, ay: 105, fx: 0.43, fy: 0.61, p1: 0, p2: 0.5, from: [-260, 0], atkT: 3.5 },
      { kind: 'square', ink: 'b', R: 54, hp, max: hp, ax: 170, ay: 95, fx: 0.37, fy: 0.83, p1: 2.1, p2: 1.7, rot: 0, vr: 0.45, from: [0, -330], atkT: 4.6 },
      { kind: 'tri', ink: 'y', R: 74, hp, max: hp, ax: 205, ay: 120, fx: 0.51, fy: 0.47, p1: 4.2, p2: 3.1, rot: 0, vr: -0.55, from: [260, 0], atkT: 5.5 },
    ];
    for (const s of this.shapes) {
      s.x = this.cx; s.y = this.cy; s.vx = 0; s.vy = 0;
      s.dead = false; s.hurt = 0; s.jx = 0; s.jy = 0; s.pts = null;
      s.rot = s.rot || 0;
    }
    this.place(0);
  }

  skipIntro() {
    if (!this.entering) return;
    this.entering = false;
    this.introT = 2;
    this.place(0);
  }

  /** Lean toward the plate that matches the ball's ink, else the nearest. */
  aimPoint(ball) {
    const live = this.shapes.filter((s) => !s.dead);
    const same = live.find((s) => s.ink === ball.ink);
    if (same) return same;
    let best = null, bd = Infinity;
    for (const s of live) {
      const d = (s.x - ball.x) ** 2 + (s.y - ball.y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  place(dt) {
    const alive = this.shapes.filter((s) => !s.dead).length;
    const sp = 1 + (3 - alive) * 0.32;
    this.T += dt * sp;
    const intro = this.entering ? Ease.outCubic(clamp(this.introT / 1.2, 0, 1)) : 1;
    for (const s of this.shapes) {
      if (s.dead) continue;
      const px = s.x, py = s.y;
      const tx = this.cx + s.ax * Math.sin(this.T * s.fx + s.p1);
      const ty = this.cy + s.ay * Math.sin(this.T * s.fy + s.p2);
      s.x = tx + s.from[0] * (1 - intro);
      s.y = ty + s.from[1] * (1 - intro);
      if (s.vr) s.rot += s.vr * dt * sp;
      s.vx = dt > 0 ? (s.x - px) / dt : 0;
      s.vy = dt > 0 ? (s.y - py) / dt : 0;
      if (s.kind === 'square') {
        const c = Math.cos(s.rot), n = Math.sin(s.rot);
        const h = s.R;
        s.pts = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => [s.x + x * c - y * n, s.y + x * n + y * c]);
      } else if (s.kind === 'tri') {
        s.pts = [0, 1, 2].map((i) => {
          const a = s.rot - Math.PI / 2 + (i / 3) * TAU;
          return [s.x + Math.cos(a) * s.R, s.y + Math.sin(a) * s.R];
        });
      }
    }
  }

  update(dt) {
    this.t += dt;
    if (this.entering) {
      this.introT += dt;
      if (this.introT >= 1.2) this.entering = false;
    }
    const playing = G.phase === 'play' && !this.entering;
    this.place(playing ? dt : dt * 0.3);
    const alive = this.shapes.filter((s) => !s.dead).length;
    for (const s of this.shapes) {
      if (s.dead) continue;
      s.hurt = Math.max(0, s.hurt - dt * 3);
      if (!playing) continue;
      s.atkT -= dt * (1 + (3 - alive) * 0.35);
      if (s.atkT <= 0) {
        s.atkT = rand(4.2, 5.8);
        this.attack(s);
      }
    }
  }

  attack(s) {
    if (s.kind === 'circle') {
      for (const a of [-0.38, 0, 0.38]) {
        G.hazards.push(new Hazard('dot', s.x, s.y + s.R * 0.8, Math.sin(a) * 170, Math.cos(a) * 170, 'p', { r: 6 }));
      }
    } else if (s.kind === 'square') {
      G.hazards.push(new Hazard('chip', s.x, s.y + s.R, (Paddle.x - s.x) * 0.35, 30, 'b', { g: 420, r: 7 }));
    } else {
      const dx = Paddle.x - s.x, dy = Paddle.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      G.hazards.push(new Hazard('shard', s.x, s.y + 20, (dx / d) * 300, (dy / d) * 300, 'y', { r: 6 }));
    }
    Sound.drip(s.x);
  }

  hitShape(s, ball) {
    if (s.kind === 'circle') return circleCircle(ball.x, ball.y, ball.r, s.x, s.y, s.R);
    return circlePoly(ball.x, ball.y, ball.r, s.pts);
  }

  collide(ball) {
    if (this.entering || this.done) return;
    for (const s of this.shapes) {
      if (s.dead) continue;
      const hit = this.hitShape(s, ball);
      if (!hit) continue;
      reflectBall(ball, hit, s.vx, s.vy);
      this.onHit(s, ball, hit);
      return;
    }
  }

  onHit(s, ball, hit) {
    ball.idle = 0;
    ball.touched = true;
    const smash = ball.pierce > 0;
    const match = inkMatches(ball, s.ink);
    const px = ball.x - hit.nx * ball.r, py = ball.y - hit.ny * ball.r;
    if (smash) ball.pierce = 0;
    if (!match) {
      soakInk(ball, s.ink);
      Sound.soak(ball.x);
      FX.droplets(px, py, s.ink, 5, -hit.nx, -hit.ny, 150);
      Plates.kick(0.3);
      s.hurt = 0.3;
      hint('misreg', `Each plate only feels its own ink — hit ${INK_NAME[s.ink]} with ${INK_NAME[s.ink]}`, 4.5);
      return;
    }
    const dmg = (smash ? 4 : 2) + perk('bounty');
    s.hp -= dmg;
    s.hurt = 1;
    releaseInk(ball);
    bossHitFX(px, py, s.ink, true, -hit.nx, -hit.ny);
    bossScore(ball, dmg, px, py, s.ink);
    if (s.hp <= 0) this.kill(s);
  }

  kill(s) {
    s.dead = true;
    FX.dots(s.x, s.y, s.ink, s.R * 2, 0.7);
    FX.ring(s.x, s.y, 'k', s.R * 0.5, s.R * 2.2, 0.55, 5);
    FX.droplets(s.x, s.y, s.ink, 20, 0, 0, 360);
    for (let i = 0; i < 8; i++) FX.flake(s.x + rand(-s.R, s.R) * 0.6, s.y + rand(-s.R, s.R) * 0.6, rand(14, 30), rand(10, 22), s.ink, rand(-1, 1), -1);
    for (let i = 0; i < 4; i++) Decal.splat(s.x + rand(-s.R, s.R) * 0.5, s.y + rand(-s.R, s.R) * 0.5, s.ink, s.R * rand(0.25, 0.5), 0, 0, 0.5);
    Plates.kick(2.2, 0.8);
    G.hitstop = Math.max(G.hitstop, 0.1);
    Sound.bomb(s.x);
    FX.float(s.x, s.y, `${INK_NAME[s.ink].toUpperCase()} IN REGISTER`, s.ink, 14, 1.3);
    if (this.shapes.every((x) => x.dead)) {
      this.done = true;
      Sound.bossDie();
      bossDefeated();
    }
  }

  shapePath(ctx, s, ox = 0, oy = 0) {
    ctx.beginPath();
    if (s.kind === 'circle') {
      ctx.arc(s.x + ox, s.y + oy, s.R, 0, TAU);
    } else {
      ctx.moveTo(s.pts[0][0] + ox, s.pts[0][1] + oy);
      for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0] + ox, s.pts[i][1] + oy);
      ctx.closePath();
    }
  }

  draw(ctx, t) {
    const live = this.shapes.filter((s) => !s.dead);
    // overprinted fills
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (const s of live) {
      const pl = Plates[s.ink];
      ctx.fillStyle = INK[s.ink];
      this.shapePath(ctx, s, pl.x, pl.y);
      ctx.fill();
      ctx.save();
      this.shapePath(ctx, s, pl.x, pl.y);
      ctx.clip();
      ctx.fillStyle = rgba(INK.k, 0.4);
      halftoneDisc(ctx, s.x, s.y, s.R * 1.5, 7, 0.3, (d, ux, uy) => clamp((ux * 0.5 + uy * 0.8) * 1.2, 0, 0.9));
      ctx.restore();
    }
    ctx.restore();
    for (const s of live) {
      if (s.hurt > 0) {
        ctx.save();
        ctx.fillStyle = rgba(PAPER_HI, s.hurt * 0.75);
        this.shapePath(ctx, s);
        ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = INK.k;
      ctx.lineWidth = 2.5;
      this.shapePath(ctx, s);
      ctx.stroke();
      // each plate carries its own registration mark
      const r = 9;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, TAU);
      ctx.moveTo(s.x - r * 1.8, s.y); ctx.lineTo(s.x + r * 1.8, s.y);
      ctx.moveTo(s.x, s.y - r * 1.8); ctx.lineTo(s.x, s.y + r * 1.8);
      ctx.stroke();
      // hp as notches around the mark
      for (let i = 0; i < s.max; i++) {
        const a = -Math.PI / 2 + (i / s.max) * TAU;
        ctx.fillStyle = i < s.hp ? INK.k : PAPER_HI;
        ctx.beginPath();
        ctx.arc(s.x + Math.cos(a) * (r + 13), s.y + Math.sin(a) * (r + 13), 3, 0, TAU);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  healthParts() {
    return this.shapes.map((s) => ({ frac: Math.max(0, s.hp) / s.max, ink: s.ink }));
  }

  drawHealth(ctx) {
    const w = 52, gap = 10;
    const x0 = FIELD.cx - (w * 3 + gap * 2) / 2;
    const y = 74;
    this.shapes.forEach((s, i) => {
      const x = x0 + i * (w + gap);
      const pl = Plates[s.ink];
      ctx.fillStyle = INK[s.ink];
      ctx.fillRect(x + pl.x, y - 3 + pl.y, w * Math.max(0, s.hp) / s.max, 6);
      ctx.strokeStyle = INK.k;
      ctx.lineWidth = 1.3;
      ctx.strokeRect(x, y - 3, w, 6);
    });
  }
}
