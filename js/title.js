'use strict';
/* =========================================================
   MISPRINT — the title poster
   A misregistered wordmark over a halftone sun, overprinting
   a proof card on which the real game quietly plays itself.
   ========================================================= */

/* ---------- the attract demo: the actual game, run by a bot ---------- */
const Demo = {
  on: false,
  order: [],
  idx: 0,
  launchT: 0,

  start() {
    this.on = true;
    G.demo = true;
    Sound.quiet = true;
    Plates.gain = 0.35;
    G.run = {
      stageIndex: 0, score: 0, lives: 99, perks: {}, prints: [],
      platesCleared: 0, bossesBeaten: 0, bestVolley: 0, bleeds: 0, smashes: 0,
      checkpoint: null, retries: 0,
    };
    G.scoreShown = 0;
    this.order = shuffle(RUN_STAGES.map((s, i) => (s.kind === 'plate' ? i : -1)).filter((i) => i >= 0));
    this.idx = 0;
    this.next();
  },

  stop() {
    if (!this.on) return;
    this.on = false;
    G.demo = false;
    Sound.quiet = false;
    Plates.gain = 1;
  },

  next() {
    if (!this.on) return;
    loadStage(this.order[this.idx % this.order.length]);
    this.idx++;
    this.launchT = 0.9;
    for (const b of G.balls) b.__aim = undefined;
  },

  predict(b) {
    const yT = Paddle.y - PADDLE_H / 2 - b.r;
    const tc = (yT - b.y) / b.vy;
    const L = FIELD.x + b.r, R = FIELD.r - b.r, W = R - L;
    let u = (b.x + b.vx * tc - L) % (2 * W);
    if (u < 0) u += 2 * W;
    if (u > W) u = 2 * W - u;
    return { x: L + u, tc };
  },

  bot(dt) {
    if (G.phase === 'play' && G.balls.some((b) => b.held)) {
      this.launchT -= dt;
      if (this.launchT <= 0) {
        G.balls.filter((b) => b.held).forEach(launch);
        this.launchT = 0.9;
      }
    }
    let best = null;
    for (const b of G.balls) {
      if (b.dead || b.held || b.vy <= 0) continue;
      const p = this.predict(b);
      if (!best || p.tc < best.tc) best = { ...p, b };
    }
    if (best) {
      const b = best.b;
      if (b.__aim === undefined) b.__aim = rand(-0.55, 0.55);
      Paddle.botX = best.x - b.__aim * Paddle.w / 2;
      if (best.tc > 0 && best.tc < 0.05 && !b.__st) {
        b.__st = true;
        if (chance(0.3)) b.smashArm = 0.12;
      }
    } else {
      for (const b of G.balls) { b.__aim = undefined; b.__st = false; }
      const d = G.drops[0];
      Paddle.botX = d ? d.x : lerp(Paddle.x, FIELD.cx, 0.02);
    }
  },

  update(dt) {
    if (!this.on || !G.stage) return;
    if (UI.cur && UI.cur !== 's-title') return;   // a sheet is covering the poster
    this.bot(dt);
    updateRun(dt);
    if (G.phase === 'play' && G.time > 110) this.next();
  },

  /** Render the field onto a proof card in screen space. */
  draw(ctx, card) {
    if (!this.on || !G.stage || !card) return;
    Gfx.screen(ctx);
    ctx.save();
    ctx.translate(card.x + card.w / 2, card.y + card.h / 2);
    ctx.rotate(card.rot);
    ctx.fillStyle = INK.k;
    ctx.fillRect(-card.w / 2 + 12, -card.h / 2 + 12, card.w, card.h);
    ctx.fillStyle = PAPER;
    ctx.fillRect(-card.w / 2, -card.h / 2, card.w, card.h);
    ctx.beginPath();
    ctx.rect(-card.w / 2, -card.h / 2, card.w, card.h);
    ctx.clip();
    const s = card.w / (FIELD.w + 64);
    ctx.scale(s, s);
    ctx.translate(-FIELD.cx, -(FIELD.y + FIELD.h / 2));
    renderRun(ctx, true);
    ctx.restore();
    ctx.save();
    ctx.translate(card.x + card.w / 2, card.y + card.h / 2);
    ctx.rotate(card.rot);
    ctx.strokeStyle = INK.k;
    ctx.lineWidth = 2;
    ctx.strokeRect(-card.w / 2, -card.h / 2, card.w, card.h);
    ctx.restore();
  },
};

const Title = {
  t: 0,
  fs: 120,
  wx: 0,
  wy: 0,
  letters: [],
  sun: { x: 0, y: 0, R: 100 },
  card: null,

  init() {
    this.layout();
  },

  reset() {
    Demo.start();
  },

  layout() {
    const W = Gfx.W, H = Gfx.H;
    const ctx = Gfx.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = fDisplay(100);
    const w100 = ctx.measureText('MISPRINT').width || 560;
    const wide = W / H > 1.1;
    let fs = Math.min(H * 0.27, 250, (W * 0.86) / w100 * 100);
    fs = Math.max(fs, 40);
    this.fs = fs;
    this.wx = Math.max(18, W * 0.06);
    this.wy = Math.round(H * (wide ? 0.5 : 0.3));
    ctx.font = fDisplay(fs);
    let x = this.wx;
    this.letters = [];
    for (const ch of 'MISPRINT') {
      const w = ctx.measureText(ch).width;
      this.letters.push({ ch, x, w, jx: 0, jy: 0, jvx: 0, jvy: 0 });
      x += w;
    }
    const menuTop = Math.round(this.wy + fs * 0.14 + 6);
    const menu = document.getElementById('title-menu');
    if (menu) {
      menu.style.left = Math.round(this.wx - 2) + 'px';
      menu.style.top = menuTop + 'px';
    }

    // the proof card the demo plays on
    const aspect = (FIELD.w + 64) / (FIELD.h + 64);
    if (wide) {
      const ch = H * 0.84;
      const cw = ch * aspect;
      const right = Math.max(28, W * 0.05);
      this.card = { w: cw, h: ch, x: W - right - cw, y: (H - ch) / 2, rot: 0.028 };
      this.sun = { x: this.card.x + cw * 0.3, y: H * 0.3, R: Math.min(W, H) * 0.38 };
    } else {
      const menuH = menu ? menu.offsetHeight || 190 : 190;
      const top = menuTop + menuH + 26;
      const ch = H - top - 58;            // leave the foot clear for the best score
      if (ch >= 220) {
        const cw = Math.min(ch * aspect, W - 48);
        const h2 = cw / aspect;
        this.card = { w: cw, h: h2, x: (W - cw) / 2, y: top + (ch - h2) / 2, rot: 0.02 };
      } else {
        this.card = null;
      }
      this.sun = { x: W * 0.72, y: H * 0.16, R: Math.min(W, H) * 0.46 };
    }
  },

  poke() {
    Plates.kick(0.9, 0.4);
    for (const L of this.letters) { L.jvy -= rand(40, 120); L.jvx += rand(-40, 40); }
  },

  update(dt) {
    this.t += dt;
    Demo.update(dt);
    const h = Math.min(dt, 1 / 60);
    for (const L of this.letters) {
      L.jvx += (-300 * L.jx - 14 * L.jvx) * h;
      L.jvy += (-300 * L.jy - 14 * L.jvy) * h;
      L.jx += L.jvx * h;
      L.jy += L.jvy * h;
    }
  },

  draw(ctx) {
    Gfx.screen(ctx);
    const t = this.t;

    // the sun — yellow halftone, swelling toward the upper right
    const s = this.sun;
    const yp = Plates.y;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = INK.y;
    const step = Math.max(9, s.R / 15);
    halftoneDisc(ctx, s.x + yp.x * 2, s.y + yp.y * 2, s.R, step, 0.26, (d, ux, uy) => clamp(0.64 + 0.42 * (ux - uy) * 0.5 - d * d * 0.32, 0.1, 1.08));
    ctx.restore();

    // the proof card, with the game running on it
    Demo.draw(ctx, this.card);
    Gfx.screen(ctx);

    // the wordmark: blue plate, then pink plate, overprinted out of register
    const fs = this.fs;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.font = fDisplay(fs);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const drift = Math.sin(t * 0.8) * fs * 0.006;
    const plates = [
      { ink: 'b', ox: 0, oy: 0 },
      { ink: 'p', ox: fs * 0.034 + drift, oy: fs * 0.022 - drift * 0.6 },
    ];
    for (const p of plates) {
      const pl = Plates[p.ink];
      ctx.fillStyle = INK[p.ink];
      for (const L of this.letters) {
        ctx.fillText(L.ch, L.x + L.jx + p.ox + pl.x * 2.2, this.wy + L.jy + p.oy + pl.y * 2.2);
      }
    }
    ctx.restore();

    // a colophon line, set above the wordmark
    ctx.save();
    ctx.fillStyle = INK.k;
    ctx.globalAlpha = 0.62;
    ctx.font = fMono(Math.max(10, Math.min(13, fs * 0.07)), 600);
    spaced(ctx, 'BREAKOUT, IN THREE INKS', this.wx + 3, this.wy - fs * 0.86, 2.4);
    ctx.restore();
  },
};
