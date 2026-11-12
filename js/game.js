'use strict';
/* =========================================================
   MISPRINT — the game
   Rules, physics, scoring, the run, and the page HUD.

   The rules in one breath: the ball soaks up the ink of the
   layer it peels. Hit that same ink again and it bleeds —
   the whole connected patch peels. Tap as the ball lands to
   Smash: it punches straight through layers and black
   blocks.
   ========================================================= */

/* ---------- game state ---------- */
const G = {
  mode: 'title',        // 'title' | 'run'
  phase: 'none',        // intro · play · lost · clear · perk · over · won
  paused: false,
  time: 0,
  clock: 0,
  phaseT: 0,
  hitstop: 0,
  slowmo: 0,
  run: null,
  stage: null,
  balls: [],
  drops: [],
  hazards: [],
  wells: [],
  moth: null,
  mothT: 30,
  events: [],
  fx: { wide: 0, slow: 0, flood: 0, tack: 0, margin: 0 },
  fxMax: { wide: 14, slow: 10, flood: 7, tack: 12 },
  marginFlash: 0,
  cutFlash: 0,
  seq: {},
  hint: null,
  scoreShown: 0,
  toast: null,
  stall: 0,
  volShown: 0,
  volPop: 0,
  banked: null,
  demo: false,
};

function after(delay, fn) {
  G.events.push({ t: delay, fn });
}

const roman = (n) => ['I', 'II', 'III', 'IV'][n] || String(n + 1);
const pad2 = (n) => String(n).padStart(2, '0');
const fmt = (n) => Math.round(n).toLocaleString('en-US');

/* ---------- hints (first time only) ---------- */
const HintsSeen = new Set(Store.get('hints', []));
function hint(id, text, life = 4.5) {
  if (G.demo || HintsSeen.has(id)) return;
  HintsSeen.add(id);
  Store.set('hints', [...HintsSeen]);
  G.hint = { text, t: 0, life };
}

/* =========================================================
   Run flow
   ========================================================= */
function newRun() {
  if (typeof Demo !== 'undefined') Demo.stop();
  G.run = {
    stageIndex: 0,
    score: 0,
    lives: 3,
    perks: {},
    prints: [],
    platesCleared: 0,
    bossesBeaten: 0,
    bestVolley: 0,
    bleeds: 0,
    smashes: 0,
    checkpoint: null,
    retries: 0,
  };
  G.scoreShown = 0;
  G.mode = 'run';
  G.paused = false;
  loadStage(0);
}

/** Start the current act over, as it was when you reached it. */
function retryAct() {
  const cp = G.run && G.run.checkpoint;
  if (!cp) { newRun(); return; }
  const r = G.run;
  r.score = cp.score;
  r.perks = Object.assign({}, cp.perks);
  r.prints.length = cp.prints;
  r.platesCleared = cp.platesCleared;
  r.bossesBeaten = cp.bossesBeaten;
  r.lives = 3;
  r.retries++;
  G.scoreShown = r.score;
  G.mode = 'run';
  G.paused = false;
  loadStage(cp.stage);
}

function loadStage(i) {
  const st = RUN_STAGES[i];
  const act = Math.floor(i / 4);
  G.run.stageIndex = i;
  // a boss always gets a fair start: at least two balls, with a Margin under you
  if (st.kind === 'boss' && !G.demo) G.run.lives = Math.max(G.run.lives, 2);
  // checkpoints: the start of each act, and each boss
  if (i % 4 === 0 || st.kind === 'boss') {
    const r = G.run;
    r.checkpoint = { stage: i, score: r.score, perks: Object.assign({}, r.perks), prints: r.prints.length, platesCleared: r.platesCleared, bossesBeaten: r.bossesBeaten };
  }
  G.stage = {
    index: i,
    kind: st.kind,
    act,
    plateNo: st.kind === 'plate' ? st.plate + 1 : 0,
    name: '',
    boss: null,
    lostLife: false,
    rollerX: FIELD.x - 80,
    maxRow: 0,
  };
  Board.clear();
  FX.clear();
  Decal.clear();
  G.balls = [];
  G.drops = [];
  G.hazards = [];
  G.wells = [];
  G.events = [];
  G.moth = null;
  G.mothT = rand(12, 20);
  G.stall = 0;
  G.banked = null;
  // a Margin on the very first plate (to learn with) and at every boss
  const freeMargin = perk('margin') > 0 || st.kind === 'boss' || i === 0;
  G.fx = { wide: 0, slow: 0, flood: 0, tack: 0, margin: freeMargin ? 1 + perk('steel') : 0 };
  G.fxMax = { wide: 14, slow: 10, flood: 7, tack: 12 };
  G.marginFlash = 0;
  G.cutFlash = 0;
  G.hitstop = 0;
  G.slowmo = 0;
  G.hint = null;
  Paddle.reset();

  if (st.kind === 'plate') {
    const def = PLATES[st.plate];
    G.stage.name = def.name;
    G.stage.def = def;
    Board.build(parsePlate(def), def.slide || []);
    for (const b of Board.list) b.appear = 0;
    G.stage.maxRow = Board.list.reduce((m, b) => Math.max(m, b.r), 0);
    G.stage.layers0 = Board.list.reduce((n, b) => n + (b.kind === 'ink' ? b.layers.length : 0), 0);
    G.wells = (def.wells || []).map(([c, r, ink]) => new Well(c, r, ink));
    if (perk('wells')) for (const w of G.wells) w.r *= 2;
    Backdrop.build(def.backdrop);
    if (!G.demo) Music.start('plate');
  } else {
    G.stage.boss = makeBoss(st.boss, act);
    G.stage.name = G.stage.boss.name;
    G.wells = (G.stage.boss.wells || []).map(([c, r, ink]) => new Well(c, r, ink));
    if (perk('wells')) for (const w of G.wells) w.r *= 2;
    Backdrop.build(BOSS_BACKDROPS[st.boss]);
    if (!G.demo) Music.start('boss');
  }

  G.time = 0;
  setPhase('intro');
  serveBall();
}

function setPhase(p) {
  G.phase = p;
  G.phaseT = 0;
  G.seq = {};
  Input.gameActive = G.mode === 'run' && !G.paused && ['intro', 'play', 'lost', 'clear'].includes(p);
  document.body.classList.toggle('playing', Input.gameActive);
}

function finishIntro() {
  for (const b of Board.list) b.appear = 1;
  G.stage.rollerX = FIELD.r + 200;
  if (G.stage.boss) G.stage.boss.skipIntro();
  setPhase('play');
  if (G.stage.index === 0) hint('serve', 'Click or Space to serve — the ball goes the way you move');
}

function baseSpeed() {
  const act = G.stage ? G.stage.act : 0;
  let s = [385, 425, 465][act] || 465;
  s *= 1 + Math.min(G.time / 110, 1) * 0.12;
  return s;
}

function targetSpeed(b) {
  let s = baseSpeed();
  if (G.fx.slow > 0) s *= 0.68;
  s *= b.smashMul;
  return Math.min(s, 920);
}

function serveBall() {
  const b = new Ball(Paddle.x, Paddle.y - PADDLE_H / 2 - BALL_R - 0.5);
  b.held = true;
  b.holdOff = 0;
  b.fresh = true;
  G.balls.push(b);
  return b;
}

function launchAngle(b) {
  if (b.fresh) {
    let a = clamp(Paddle.vx / 950, -1, 1) * 0.62;
    if (Math.abs(a) < 0.05) a = 0.05 * (Math.sign(a) || (Math.random() < 0.5 ? -1 : 1));
    return a;
  }
  const t = clamp(b.holdOff / (Paddle.w / 2), -1, 1);
  return clamp(t * 1.05 + clamp(Paddle.vx / 2600, -0.2, 0.2), -1.1, 1.1);
}

function launch(b) {
  const a = launchAngle(b);
  const sp = targetSpeed(b);
  b.held = false;
  b.vx = Math.sin(a) * sp;
  b.vy = -Math.cos(a) * sp;
  b.sincePaddle = 0;
  b.idle = 0;
  if (b.fresh) { b.servedAt = G.time; b.touched = false; }
  Sound.serve(b.x);
  Paddle.sq = 0.6;
  if (b.fresh && perk('twin')) {
    const t = new Ball(b.x, b.y);
    t.vx = Math.sin(-a * 0.6 - 0.35 * Math.sign(a || 1)) * sp;
    t.vy = -Math.cos(-a * 0.6 - 0.35 * Math.sign(a || 1)) * sp;
    t.servedAt = G.time;
    t.touched = false;
    G.balls.push(t);
  }
  b.fresh = false;
  if (G.hint && G.stage.index === 0) G.hint.t = Math.max(G.hint.t, G.hint.life - 0.4);
}

/* =========================================================
   Input → game
   ========================================================= */
function gamePress() {
  if (G.mode !== 'run' || G.paused) return;
  if (G.phase === 'intro') {
    if (G.phaseT > 0.25) finishIntro();
    return;
  }
  if (G.phase !== 'play') return;

  const held = G.balls.filter((b) => b.held && !b.dead);
  if (held.length) { held.forEach(launch); return; }
  if (Paddle.cd > 0) return;

  Paddle.press = 1;
  const soft = 1 + 0.6 * perk('soft');
  const pre = 0.13 * soft;
  const post = 0.085 * soft;
  const top = Paddle.y - PADDLE_H / 2;
  let ok = false;
  for (const b of G.balls) {
    if (b.dead || b.held) continue;
    if (b.vy > 0) {
      const tc = (top - (b.y + b.r)) / b.vy;
      if (tc >= -0.03 && tc <= pre) {
        const px = b.x + b.vx * Math.max(0, tc);
        if (Math.abs(px - Paddle.x) <= Paddle.w / 2 + 16) {
          b.smashArm = Math.max(0, tc) + 0.07;
          ok = true;
        }
      }
    } else if (!b.smashed && b.sincePaddle <= post) {
      doSmash(b);
      ok = true;
    }
  }
  if (!ok) {
    Paddle.cd = 0.24;
    Sound.whiff();
  }
}

/* =========================================================
   Rules
   ========================================================= */
function addScore(n) {
  if (G.run) G.run.score += n;
}

function doSmash(b) {
  b.smashArm = 0;
  b.smashed = true;
  b.pierce = 3 + 2 * perk('heavy');
  b.smashMul = 1.32;
  b.pierced.clear();
  b.shockReady = perk('shock') > 0;
  b.hotReady = perk('hotpress') > 0;
  G.hitstop = Math.max(G.hitstop, 0.065);
  Plates.kick(1.15, 0.45);
  Sound.smash(b.x);
  FX.ring(b.x, b.y + b.r, 'k', 6, 52, 0.35, 4);
  FX.dots(b.x, b.y + 4, 'p', 42, 0.42);
  FX.sparks(b.x, b.y + b.r, 'k', 7, 340);
  FX.float(b.x, b.y - 18, 'SMASH', 'p', 15, 0.7);
  Paddle.flash = 1;
  G.run.smashes++;
  Music.push(0.3);
  HintsSeen.add('smash');
}

function hitBrick(br, ball, nx, ny, piercing) {
  br.jiggle(nx, ny, piercing ? 1.4 : 1);
  ball.idle = 0;
  ball.touched = true;
  const c = Board.center(br);
  if (br.kind === 'key') {
    if (piercing) { breakKey(br, ball); return; }
    if (perk('cutter')) {
      br.hp--;
      Sound.keyHit(c.x);
      FX.sparks(c.x, c.y, 'k', 4, 220);
      Plates.kick(0.2);
      if (br.hp <= 0) breakKey(br, ball);
      return;
    }
    Sound.keyHit(c.x);
    FX.sparks(c.x - nx * 10, c.y - ny * 8, 'k', 3, 200);
    Plates.kick(0.1);
    hint('key', 'Black blocks only break to a Smash');
    return;
  }
  if (br.kind === 'bomb') { explode(br, ball); return; }

  const top = br.top;
  if (piercing && ball.shockReady) { ball.shockReady = false; shockwave(br, ball); }
  if (piercing && ball.hotReady) {
    ball.hotReady = false;
    FX.float(c.x, c.y - 30, 'HOT PRESS', 'p', 13, 0.9);
    bleed(br, top, ball);
    return;
  }
  if (inkMatches(ball, top)) {
    if (ball.charged) FX.float(c.x, c.y - 30, 'CHARGED', 'y', 13, 0.9);
    bleed(br, top, ball);
    releaseInk(ball);
  } else {
    peel(br, ball, nx, ny);
    soakInk(ball, top);
    if (G.stage.index <= 1) hint('soak', `The ball soaked up ${INK_NAME[top]} — hit ${INK_NAME[top]} again to bleed it`, 5);
  }
}

/** Remove the top layer of a block. Returns points scored. */
function peel(br, ball, nx = 0, ny = 1, o = {}) {
  if (!br.alive || br.kind !== 'ink' || !br.layers.length) return 0;
  const n = br.layers.length;
  const ink = br.layers.pop();
  const body = Board.body(br);
  const fw = BRICK_W - LAYER_STEP * (n - 1);
  const fh = BRICK_H - LAYER_STEP * (n - 1);
  const cx = body.x + fw / 2, cy = body.y + fh / 2;

  FX.flake(cx, cy, fw, fh, ink, nx, ny);
  FX.droplets(cx, cy, ink, o.bleed ? 3 : 6, nx, ny);
  Decal.ghost(body.x, body.y, BRICK_W, BRICK_H, ink);
  if (!o.bleed || chance(0.45)) Decal.splat(cx + rand(-6, 6), cy + rand(-4, 4), ink, rand(5, 10), -nx, -ny, 0.42);
  br.flash = 1;
  br.settle = br.layers.length ? 1 : 0;
  G.stall = 0;

  const v = ball ? ++ball.volley : 1;
  if (ball && o.bleed && perk('pigment')) ball.volley += perk('pigment');
  if (ball && perk('overrun') && ball.volley >= (ball.nextRun || 10)) {
    ball.nextRun = (Math.floor(ball.volley / 10) + 1) * 10;
    setTimed('flood', 2);
    FX.float(cx, cy - 28, 'OVERRUN', 'y', 15, 1);
    Music.push(1);
  }
  if (v > G.run.bestVolley) G.run.bestVolley = v;
  const pts = 10 * Math.min(v, 40);
  addScore(pts);
  if (!o.bleed && !o.quiet) FX.float(cx, cy - 8, '+' + pts, v >= 5 ? ink : 'k', v >= 10 ? 15 : 13);
  Sound.peel(ink, v - 1, cx);
  Plates.kick(o.bleed ? 0.07 : 0.16);
  Music.push(0.035);

  if (!br.layers.length) {
    br.alive = false;
    Board.inkLeft--;
    maybeDrop(cx, cy);
  }
  if (!o.noSplash && perk('splash') && chance(0.08 + 0.12 * perk('splash'))) {
    const nb = pick(Board.neighbours(br, false).filter((x) => x.kind === 'ink'));
    if (nb) {
      after(0.07, () => {
        const nc = Board.center(nb);
        FX.droplets(nc.x, nc.y, ink, 4);
        peel(nb, ball, 0, 1, { noSplash: true });
      });
    }
  }
  checkClear();
  return pts;
}

/** Flood a connected patch of one ink, peeling it outward from the hit. */
function bleed(start, ink, ball, second = false) {
  // Wet Edges lets the ink leak across the corners of the block you hit —
  // only there, or every checkerboard would bleed in one go.
  const wet = perk('wet') > 0;
  const depth = new Map([[start.id, 0]]);
  const queue = [start];
  const order = [{ br: start, d: 0 }];
  if (perk('fullbleed')) {
    // Full Bleed: every block of that colour, joined or not, rippling out from the hit
    for (const b of Board.list) {
      if (b === start || !b.alive || b.kind !== 'ink' || b.top !== ink) continue;
      order.push({ br: b, d: Math.max(Math.abs(b.r - start.r), Math.abs(b.c - start.c)) });
    }
  } else {
    while (queue.length) {
      const cur = queue.shift();
      const d = depth.get(cur.id);
      for (const nb of Board.neighbours(cur, wet && cur === start)) {
        if (nb.kind !== 'ink' || nb.top !== ink || depth.has(nb.id)) continue;
        depth.set(nb.id, d + 1);
        queue.push(nb);
        order.push({ br: nb, d: d + 1 });
      }
    }
  }
  const n = order.length;
  const c = Board.center(start);
  let total = 0;
  let maxD = 0;
  for (const { br, d } of order) {
    maxD = Math.max(maxD, d);
    br.wet = 1;
    after(d * 0.042, () => {
      br.wet = 0;
      if (br.alive && br.kind === 'ink' && br.top === ink) total += peel(br, ball, 0, 1, { bleed: true });
      // Saturate: the block you hit loses a second layer
      if (br === start && perk('saturate') && br.alive && br.kind === 'ink') {
        after(0.06, () => { if (br.alive) total += peel(br, ball, 0, 1, { bleed: true }); });
      }
    });
  }
  G.run.bleeds++;
  Sound.bleed(n, c.x);
  Plates.kick(0.45 + Math.min(n, 24) * 0.035, 0.3);
  G.hitstop = Math.max(G.hitstop, n >= 6 ? 0.05 : 0.03);
  FX.ring(c.x, c.y, ink, 8, 40 + Math.min(n, 30) * 4, 0.45, 4);
  Music.push(0.25);
  HintsSeen.add('soak');
  if (G.hint && /bleed it/.test(G.hint.text)) G.hint.t = Math.max(G.hint.t, G.hint.life - 0.4);
  if (perk('aftershock') && n >= 6 && G.drops.length < 3) {
    after(0.2, () => G.drops.push(new Drop(c.x, c.y, rollDropType(dropExclusions()))));
  }
  after(maxD * 0.042 + 0.07, () => {
    if (perk('spatter')) spatterFrom(c.x, c.y, ink, ball);
    if (total > 0) {
      const label = n > 1 ? `BLEED ×${n}  +${fmt(total)}` : `+${fmt(total)}`;
      FX.float(c.x, c.y - 10, label, ink, n >= 8 ? 19 : 15, 1.2);
    }
    if (!second && perk('coat') && start.alive && start.kind === 'ink' && chance(0.34)) {
      FX.float(c.x, c.y - 34, 'SECOND COAT', 'k', 12, 1);
      bleed(start, start.top, ball, true);
    }
    if (G.stage && G.stage.index === 0 && G.run.bleeds >= 1) {
      hint('smash', 'Tap again just as the ball lands on the roller to Smash', 5);
    }
  });
}

function explode(br, ball) {
  if (!br.alive) return;
  br.alive = false;
  const c = Board.center(br);
  Sound.bomb(c.x);
  Plates.kick(1.5, 0.6);
  G.hitstop = Math.max(G.hitstop, 0.06);
  FX.dots(c.x, c.y, 'k', 66, 0.55);
  FX.ring(c.x, c.y, 'p', 10, 74, 0.4, 5);
  FX.droplets(c.x, c.y, 'k', 10, 0, 0, 280);
  FX.sparks(c.x, c.y, 'y', 8, 400);
  Decal.splat(c.x, c.y, 'k', 22, 0, 0, 0.5);
  Music.push(0.3);
  const reach = perk('bigbang') ? 2 : 1;
  if (reach > 1) FX.ring(c.x, c.y, 'y', 20, 130, 0.5, 5);
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      if (!dr && !dc) continue;
      const nb = Board.at(br.r + dr, br.c + dc);
      if (!nb) continue;
      const delay = 0.05 + (Math.abs(dr) + Math.abs(dc)) * 0.025;
      after(delay, () => {
        if (!nb.alive) return;
        if (nb.kind === 'bomb') explode(nb, ball);
        else if (nb.kind === 'key') breakKey(nb, ball);
        else peel(nb, ball, -dc, -dr, { quiet: true });
      });
    }
  }
  checkClear();
}

function breakKey(br, ball) {
  if (!br.alive) return;
  br.alive = false;
  const body = Board.body(br);
  const c = Board.center(br);
  FX.flake(c.x, c.y, BRICK_W, BRICK_H, 'k', 0, 1);
  FX.droplets(c.x, c.y, 'k', 8);
  FX.sparks(c.x, c.y, 'k', 5, 260);
  Decal.ghost(body.x, body.y, BRICK_W, BRICK_H, 'k', 0.5);
  Sound.keyBreak(c.x);
  Plates.kick(0.6, 0.4);
  const v = ball ? ++ball.volley : 1;
  const pts = 50 * Math.min(v, 40);
  addScore(pts);
  FX.float(c.x, c.y - 8, '+' + pts, 'k', 14);
  if (perk('keyblast')) keyBlast(br, ball);
  checkClear();
}

function maybeDrop(x, y) {
  if (G.drops.length >= 2) return;
  const rate = 0.09 * (1 + 0.5 * perk('lucky'));
  if (!chance(rate)) return;
  G.drops.push(new Drop(x, y, rollDropType(dropExclusions())));
}

function dropExclusions() {
  const ex = [];
  if (G.run.lives >= 6) ex.push('life');
  if (G.balls.length >= 5) ex.push('split');
  if (G.fx.margin) ex.push('margin');
  return ex;
}

function collectDrop(d) {
  const t = DROP_TYPES[d.type];
  Sound.collect();
  FX.ring(d.x, d.y, t.ink, 8, 44, 0.35, 3);
  FX.float(d.x, Paddle.y - 36, t.label.toUpperCase(), t.ink, 14, 1);
  addScore(100);
  switch (d.type) {
    case 'split': splitBalls(); break;
    case 'wide': setTimed('wide', 14); break;
    case 'slow': setTimed('slow', 10); break;
    case 'margin': G.fx.margin = Math.max(G.fx.margin, 1 + perk('steel')); break;
    case 'flood': setTimed('flood', 7); Music.push(1); break;
    case 'tack': setTimed('tack', 12); break;
    case 'life': G.run.lives = Math.min(9, G.run.lives + 1); break;
  }
  if (perk('foil')) {
    setTimed('flood', 4);
    FX.float(d.x, Paddle.y - 58, 'FOIL', 'y', 13, 0.9);
  }
  if (perk('collector')) collectorPeel();
}

function splitBalls() {
  const live = G.balls.filter((b) => !b.dead && !b.held);
  if (!live.length) {
    const h = G.balls.find((b) => !b.dead);
    if (!h) return;
    for (const s of [-1, 1]) {
      const nb = new Ball(h.x, h.y - 2);
      const sp = targetSpeed(nb);
      nb.vx = Math.sin(s * 0.45) * sp;
      nb.vy = -Math.cos(s * 0.45) * sp;
      nb.ink = h.ink;
      G.balls.push(nb);
    }
    return;
  }
  const src = live.reduce((a, b) => (a.y < b.y ? a : b));
  const spread = perk('duplicate') ? [-1, 1, -2, 2] : [-1, 1];
  for (const s of spread) {
    if (G.balls.length >= 10) break;
    const nb = new Ball(src.x, src.y);
    const a = Math.atan2(src.vy, src.vx) + s * 0.36;
    const sp = src.speed() || targetSpeed(src);
    nb.vx = Math.cos(a) * sp;
    nb.vy = Math.sin(a) * sp;
    nb.ink = src.ink;
    nb.volley = src.volley;
    G.balls.push(nb);
  }
}

function touchWell(b, w) {
  if (G.fx.flood > 0) return;
  const charge = perk('charged') > 0 && !b.charged;
  if (b.ink === w.ink && !charge) return;
  if (b.ink !== w.ink) soakInk(b, w.ink);
  if (charge) {
    b.charged = true;
    FX.ring(b.x, b.y, 'y', 6, 30, 0.3, 2);
  }
  w.pulse = 1;
  Sound.well(w.x);
  FX.droplets(b.x, b.y, w.ink, 4, 0, 0, 120);
  hint('well', 'Ink wells re-ink the ball as it passes through');
}

function hitMoth(b) {
  const m = G.moth;
  G.moth = null;
  FX.dots(m.x, m.y, 'p', 48, 0.5);
  FX.droplets(m.x, m.y, 'y', 10, 0, 0, 240);
  FX.droplets(m.x, m.y, 'p', 8, 0, 0, 240);
  Decal.splat(m.x, m.y, 'p', 14);
  Decal.splat(m.x + 6, m.y + 4, 'y', 10);
  Sound.moth(m.x);
  Plates.kick(0.6);
  addScore(500);
  FX.float(m.x, m.y - 14, '+500', 'p', 16, 1);
  G.drops.push(new Drop(m.x, m.y, rollDropType(dropExclusions().concat('life'))));
  b.idle = 0;
}

function useMargin(b) {
  G.fx.margin = Math.max(0, G.fx.margin - 1);
  G.marginFlash = 1;
  Sound.keyBreak(b.x);
  Plates.kick(0.8, 0.4);
  for (let i = 0; i < 10; i++) FX.flake(FIELD.x + 32 + i * 64, FIELD.b - 7, 56, 6, 'y', 0, 1);
}

function smudgePaddle(h) {
  if (perk('tough')) {
    FX.ring(h.x, Paddle.y, 'k', 6, 30, 0.3, 2);
    FX.droplets(h.x, Paddle.y - 6, h.ink, 5, 0, 1, 140);
    return;
  }
  Paddle.smudge = 3;
  Paddle.smudgeInk = h.ink === 'k' ? 'b' : h.ink;
  Sound.smudge(h.x);
  FX.droplets(h.x, Paddle.y, h.ink, 8, 0, 1, 180);
  Plates.kick(0.5);
  hint('smudge', 'Ink on the roller shrinks it for a moment — dodge the drips');
}

function ballLost(b) {
  FX.droplets(b.x, FIELD.b, b.ink, 6, 0, 1, 120);
  Decal.splat(b.x, FIELD.b - 6, b.ink, 9, 0, 1, 0.4, false);
  if (G.balls.some((x) => !x.dead)) {
    Sound.wall(b.x);
    return;
  }
  // a serve that never touched anything comes straight back
  if (b.servedAt !== undefined && !b.touched && G.time - b.servedAt < 3 && G.phase === 'play') {
    G.balls = [];
    serveBall();
    FX.float(Paddle.x, Paddle.y - 44, 'MISFEED — HAVE ANOTHER', 'k', 13, 1.4);
    Sound.whiff();
    return;
  }
  if (perk('reprint') && !G.stage.reprinted && G.phase === 'play') {
    G.stage.reprinted = true;
    G.balls = [];
    serveBall();
    FX.float(Paddle.x, Paddle.y - 44, 'REPRINTED', 'b', 15, 1.4);
    FX.ring(Paddle.x, Paddle.y, 'b', 10, 60, 0.45, 4);
    Sound.collect();
    return;
  }
  loseLife();
}

function loseLife() {
  if (G.phase !== 'play') return;
  G.run.lives--;
  G.stage.lostLife = true;
  for (const b of G.balls) b.dead = true;
  Sound.lose();
  Plates.kick(1.3, 0.6);
  G.cutFlash = 1;
  G.fx.wide = G.fx.slow = G.fx.flood = G.fx.tack = 0;
  Paddle.smudge = 0;
  G.drops = [];
  G.hazards = [];
  setPhase('lost');
}

function checkClear() {
  if (G.phase !== 'play' || !G.stage || G.stage.kind !== 'plate') return;
  if (Board.inkLeft > 0) return;
  stageClear();
}

function stageClear() {
  setPhase('clear');
  G.slowmo = 0.55;
  Plates.kick(1.7, 0.5);
  Sound.clear();
  Music.push(1);
  for (const b of G.balls) {
    if (!b.dead) FX.ring(b.x, b.y, b.ink, 4, 26, 0.3, 2);
  }
  G.balls = [];
  G.drops = [];
  G.hazards = [];
  G.moth = null;
  G.events = [];
  G.fx.flood = G.fx.tack = 0;
  for (const br of Board.list) br.wet = 0;
}

function bossDefeated() {
  if (G.phase !== 'play') return;
  stageClear();
}

function finishStage() {
  const print = { name: G.stage.name, canvas: Decal.snapshot(), boss: G.stage.kind === 'boss', index: G.stage.index };
  G.run.prints.push(print);
  if (G.stage.kind === 'plate') G.run.platesCleared++;
  else G.run.bossesBeaten++;
  if (G.stage.index >= RUN_STAGES.length - 1) {
    endRun(true);
    return;
  }
  if (G.stage.kind === 'boss') G.run.lives = Math.min(9, G.run.lives + 1);
  setPhase('perk');
  Wipe.run(pick(['b', 'p']), () => UI.showPerks(print), null);
}

function choosePerk(id) {
  G.run.perks[id] = (G.run.perks[id] || 0) + 1;
  if (id === 'spare') G.run.lives = Math.min(9, G.run.lives + 1);
  Wipe.run('y', () => {
    UI.hideAll();
    loadStage(G.run.stageIndex + 1);
  }, null);
}

function endRun(won) {
  const best = Store.get('best', 0);
  const isBest = G.run.score > best;
  if (isBest) Store.set('best', G.run.score);
  setPhase(won ? 'won' : 'over');
  Input.gameActive = false;
  document.body.classList.remove('playing');
  Music.stop();
  Wipe.run(won ? 'p' : 'k', () => UI.showOver(won, isBest, best), null);
}

/* =========================================================
   Update
   ========================================================= */
function updateRun(rawDt) {
  G.clock += rawDt;
  if (G.paused) return;

  // UI-time things run even in hitstop
  Paddle.update(rawDt, G.phase === 'intro' || G.phase === 'play' || G.phase === 'lost');
  updateHint(rawDt);
  G.scoreShown += (G.run.score - G.scoreShown) * Math.min(1, rawDt * 10);
  let vol = 0;
  for (const b of G.balls) if (!b.dead && !b.held && b.volley > vol) vol = b.volley;
  if (vol > G.volShown) G.volPop = 1;
  G.volShown = vol;
  G.volPop = Math.max(0, G.volPop - rawDt * 5);
  if (G.banked) G.banked.t += rawDt;
  if (Math.abs(G.run.score - G.scoreShown) < 1) G.scoreShown = G.run.score;
  G.cutFlash = Math.max(0, G.cutFlash - rawDt * 2);
  G.marginFlash = Math.max(0, G.marginFlash - rawDt * 3);
  for (const b of G.balls) if (b.held) { b.x = Paddle.x + b.holdOff; b.y = Paddle.y - PADDLE_H / 2 - b.r - 0.5; }

  if (G.hitstop > 0) {
    G.hitstop -= rawDt;
    return;
  }
  let dt = rawDt;
  if (G.slowmo > 0) {
    G.slowmo -= rawDt;
    dt *= 0.3;
  }
  G.phaseT += rawDt;

  // scheduled events
  if (G.events.length) {
    const due = [];
    for (let i = G.events.length - 1; i >= 0; i--) {
      const e = G.events[i];
      e.t -= dt;
      if (e.t <= 0) { due.push(e); G.events.splice(i, 1); }
    }
    for (let i = due.length - 1; i >= 0; i--) due[i].fn();
  }

  if (G.phase === 'play') G.time += dt;
  Board.update(dt);
  for (const w of G.wells) w.update(dt);
  FX.update(dt);
  if (G.stage.boss) G.stage.boss.update(dt);

  switch (G.phase) {
    case 'intro': updateIntro(dt); break;
    case 'play': updatePlay(dt); break;
    case 'lost':
      if (G.phaseT > 1.1) {
        if (G.run.lives <= 0) {
          endRun(false);
        } else {
          G.balls = [];
          serveBall();
          setPhase('play');
        }
      }
      break;
    case 'clear': updateClear(); break;
    default: break;
  }

  Music.energy = G.phase === 'play' ? 1 : 0;
}

function updateIntro(dt) {
  const t = G.phaseT;
  const sweep = 0.95;
  G.stage.rollerX = lerp(FIELD.x - 70, FIELD.r + 90, Ease.inOutCubic(clamp(t / sweep, 0, 1)));
  for (const b of Board.list) {
    if (b.appear >= 1) continue;
    const cx = Board.cellX(b.r, b.c) + GRID.cw / 2;
    if (cx < G.stage.rollerX - 10) b.appear = Math.min(1, b.appear + dt * 5);
  }
  if (!G.seq.stamp && t > 0.18) {
    G.seq.stamp = true;
    const st = G.stage;
    const big = st.name.toUpperCase();
    const sub = st.kind === 'boss' ? `ACT ${roman(st.act)} · BOSS` : `PLATE ${pad2(st.plateNo)} · ACT ${roman(st.act)}`;
    const y = st.kind === 'boss' ? FIELD.y + FIELD.h * 0.6 : Math.max(GRID.y + (st.maxRow + 1) * GRID.ch + 150, FIELD.y + FIELD.h * 0.55);
    FX.stamp(big, sub, st.kind === 'boss' ? 'p' : 'b', FIELD.cx, Math.min(y, PADDLE_Y - 150), { size: st.kind === 'boss' ? 58 : 54, hold: 1.05 });
  }
  if (t > 1.15) finishIntro();
}

function updateClear() {
  const t = G.phaseT;
  const st = G.stage;
  const act = st.act + 1;
  const y = FIELD.y + FIELD.h * 0.5;
  if (!G.seq.stamp && t > 0.35) {
    G.seq.stamp = true;
    const boss = st.kind === 'boss';
    const finale = st.index === RUN_STAGES.length - 1;
    if (finale) FX.stamp('IN REGISTER', 'THE EDITION IS COMPLETE', 'k', FIELD.cx, y, { size: 58, hold: 1.9, rot: -0.05 });
    else FX.stamp(boss ? 'PULLED' : 'CLEARED', st.name.toUpperCase(), boss ? 'b' : 'p', FIELD.cx, y, { size: 72, hold: 1.9, rot: -0.07 });
  }
  if (!G.seq.b1 && t > 0.95) {
    G.seq.b1 = true;
    const bonus = st.kind === 'boss' ? 3000 * act : 500 * act;
    addScore(bonus);
    FX.float(FIELD.cx, y + 92, `${st.kind === 'boss' ? 'BOSS' : 'PLATE'}  +${fmt(bonus)}`, 'k', 15, 1.6);
    Sound.serve(FIELD.cx);
  }
  if (!G.seq.b3 && t > 1.65 && perk('edition') && !G.demo) {
    G.seq.b3 = true;
    G.run.lives = Math.min(9, G.run.lives + 1);
    FX.float(FIELD.cx, y + 144, 'ENDLESS EDITION  +1 BALL', 'y', 15, 1.4);
    Sound.collect();
  }
  if (!G.seq.b2 && t > 1.3) {
    G.seq.b2 = true;
    if (!st.lostLife) {
      const bonus = 1000 * act;
      addScore(bonus);
      FX.float(FIELD.cx, y + 118, `CLEAN PRINT  +${fmt(bonus)}`, 'p', 15, 1.4);
      Sound.collect();
    }
  }
  if (!G.seq.done && t > 2.6) {
    G.seq.done = true;
    if (G.demo) Demo.next();
    else finishStage();
  }
}

function updatePlay(dt) {
  // timed effects
  for (const k of ['wide', 'slow', 'flood', 'tack']) if (G.fx[k] > 0) G.fx[k] = Math.max(0, G.fx[k] - dt);

  // stall-breaker: a long dry spell earns a helpful stamp from the top
  if (G.stage.kind === 'plate' && G.balls.some((b) => !b.held)) {
    G.stall += dt;
    if (G.stall > 16 && !G.drops.length) {
      G.stall = 0;
      G.drops.push(new Drop(rand(FIELD.x + 60, FIELD.r - 60), FIELD.y + 14, Board.inkLeft <= 6 ? 'flood' : pick(['split', 'flood'])));
    }
  }

  // moth
  if (G.stage.kind === 'plate') {
    if (G.moth) {
      G.moth.update(dt);
      if (G.moth.gone) G.moth = null;
    } else if (G.balls.some((b) => !b.held)) {
      G.mothT -= dt;
      if (G.mothT <= 0) {
        G.moth = new Moth();
        G.mothT = rand(22, 36);
      }
    }
  }

  // drops
  for (const d of G.drops) {
    d.update(dt);
    if (Math.abs(d.x - Paddle.x) < Paddle.w / 2 + d.r * 0.6 && Math.abs(d.y - Paddle.y) < d.r + PADDLE_H / 2) {
      d.dead = true;
      collectDrop(d);
    } else if (d.y > FIELD.b + 20) d.dead = true;
  }
  G.drops = G.drops.filter((d) => !d.dead);

  // hazards
  for (const h of G.hazards) {
    h.update(dt);
    if (Math.abs(h.x - Paddle.x) < Paddle.w / 2 + h.r && Math.abs(h.y - Paddle.y) < h.r + PADDLE_H / 2) {
      h.dead = true;
      smudgePaddle(h);
    } else if (h.y > FIELD.b - 4) {
      h.dead = true;
      Decal.splat(h.x, FIELD.b - 8, h.ink, 7, 0, 1, 0.4, false);
      FX.droplets(h.x, FIELD.b - 4, h.ink, 3, 0, 1, 90);
    }
  }
  G.hazards = G.hazards.filter((h) => !h.dead);

  // balls
  physics(dt);

  // stuck guard, speed, trails
  for (const b of G.balls) {
    if (b.dead || b.held) continue;
    b.smashMul = approach(b.smashMul, b.pierce > 0 ? 1.32 : 1, dt * 0.5);
    const sp = targetSpeed(b);
    b.setSpeed(sp);
    const minVy = sp * 0.24;
    if (Math.abs(b.vy) < minVy) {
      b.vy = (b.vy < 0 ? -1 : 1) * minVy;
      b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(Math.max(0, sp * sp - minVy * minVy));
    }
    if (b.idle > 11) {
      const a = Math.atan2(b.vy, b.vx) + rand(-0.4, 0.4);
      b.vx = Math.cos(a) * sp;
      b.vy = Math.sin(a) * sp;
      b.idle = 0;
    }
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > (b.pierce > 0 ? 12 : 7)) b.trail.shift();
    Decal.line(b.px, b.py, b.x, b.y, G.fx.flood > 0 ? 'p' : b.ink, b.ink === 'k' ? 0.05 : 0.08, 1);
    b.px = b.x;
    b.py = b.y;
    b.cosmetic(dt);
  }
  G.balls = G.balls.filter((b) => !b.dead);
  const lead = G.balls[0];
  Paddle.film = lead ? (G.fx.flood > 0 ? 'p' : lead.ink) : 'k';
}

function physics(dt) {
  let maxV = 0;
  for (const b of G.balls) if (!b.held && !b.dead) maxV = Math.max(maxV, Math.abs(b.vx) + Math.abs(b.vy));
  const n = clamp(Math.ceil((maxV * dt) / 3.2), 1, 30);
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    for (const b of G.balls) {
      if (b.dead || b.held) continue;
      stepBall(b, h);
      if (G.phase !== 'play') return;
    }
  }
}

function stepBall(b, h) {
  if (b.spin) {
    const a = b.spin * h;
    const ca = Math.cos(a), sa = Math.sin(a);
    const vx = b.vx * ca - b.vy * sa;
    b.vy = b.vx * sa + b.vy * ca;
    b.vx = vx;
    b.spin *= 1 - 1.4 * h;
    if (Math.abs(b.spin) < 0.02) b.spin = 0;
  }
  b.x += b.vx * h;
  b.y += b.vy * h;
  b.sincePaddle += h;
  b.idle += h;
  if (b.smashArm > 0) b.smashArm = Math.max(0, b.smashArm - h);

  // walls
  if (b.x < FIELD.x + b.r) {
    b.x = FIELD.x + b.r;
    if (b.vx < 0) { b.vx = -b.vx; onWall(b, 1, 0); }
  } else if (b.x > FIELD.r - b.r) {
    b.x = FIELD.r - b.r;
    if (b.vx > 0) { b.vx = -b.vx; onWall(b, -1, 0); }
  }
  if (b.y < FIELD.y + b.r) {
    b.y = FIELD.y + b.r;
    if (b.vy < 0) { b.vy = -b.vy; onWall(b, 0, 1); }
  }

  if (b.vy > 0) paddleHit(b);
  if (b.held) return;
  collideBricks(b);
  if (G.stage.boss && G.phase === 'play') G.stage.boss.collide(b);
  if (G.moth && circleCircle(b.x, b.y, b.r, G.moth.x, G.moth.y, G.moth.r)) hitMoth(b);
  for (const w of G.wells) {
    const dx = b.x - w.x, dy = b.y - w.y;
    if (dx * dx + dy * dy < w.r * w.r) touchWell(b, w);
  }
  if (G.fx.margin && b.vy > 0 && b.y + b.r > FIELD.b - 7) {
    b.y = FIELD.b - 7 - b.r;
    b.vy = -Math.abs(b.vy);
    useMargin(b);
  }
  if (b.y - b.r > FIELD.b + 4) {
    b.dead = true;
    ballLost(b);
  }
}

function onWall(b, nx, ny) {
  b.squash(nx, ny);
  Sound.wall(b.x);
  if (perk('rico') && b.sincePaddle > 0.05) b.volley++;
}

function paddleHit(b) {
  const top = Paddle.y - PADDLE_H / 2;
  const half = Paddle.w / 2;
  if (b.y + b.r < top || b.y > Paddle.y + 4) return;
  if (b.x < Paddle.x - half - b.r * 0.7 || b.x > Paddle.x + half + b.r * 0.7) return;

  b.y = top - b.r;
  const t = clamp((b.x - Paddle.x) / half, -1, 1);
  let ang = t * 1.06 + clamp(Paddle.vx / 2600, -0.22, 0.22);

  // last few blocks: lean toward them, harder the fewer remain
  if (G.stage.kind === 'plate' && Board.inkLeft > 0 && Board.inkLeft <= 5) {
    const left = Board.list.filter((x) => x.alive && x.kind === 'ink');
    const tgt = left[Math.floor(Math.random() * left.length)];
    if (tgt) {
      const c = Board.center(tgt);
      const want = Math.atan2(c.x - b.x, b.y - c.y);
      ang = lerp(ang, clamp(want, -1.1, 1.1), Board.inkLeft <= 2 ? 0.55 : 0.4);
    }
  }
  // bosses: lean gently toward the target so fights stay about aiming, not luck
  if (G.stage.boss && G.stage.boss.aimPoint) {
    const p = G.stage.boss.aimPoint(b);
    if (p) ang = lerp(ang, clamp(Math.atan2(p.x - b.x, b.y - p.y), -1.1, 1.1), 0.2);
  }
  ang = clamp(ang, -1.12, 1.12);
  const sp = targetSpeed(b);
  b.vx = Math.sin(ang) * sp;
  b.vy = -Math.cos(ang) * sp;
  if (b.volley >= 4) payVolley(b);
  b.volley = 0;
  b.nextRun = 10;
  b.sincePaddle = 0;
  b.idle = 0;
  b.smashed = false;
  b.pierce = 0;
  b.pierced.clear();
  b.squash(0, -1);
  Paddle.sq = 1;
  Sound.paddle(b.x);
  Plates.kick(0.14, 0.2);
  if (perk('english')) b.spin = clamp(Paddle.vx / 1400, -1, 1) * 1.5;

  if (perk('jet')) inkJet(b);
  if (b.smashArm > 0) {
    doSmash(b);
  } else if (G.fx.tack > 0) {
    b.held = true;
    b.holdOff = clamp(b.x - Paddle.x, -half + 4, half - 4);
    b.vx = b.vy = 0;
  }
}

/** A long volley pays out when the ball comes home. */
function payVolley(b) {
  const v = b.volley;
  const bonus = 5 * v * v;
  addScore(bonus);
  const ink = b.ink === 'k' ? 'p' : b.ink;
  FX.float(b.x, Paddle.y - 46, `VOLLEY ${v}  +${fmt(bonus)}`, ink, v >= 12 ? 19 : 15, 1.3);
  FX.ring(b.x, Paddle.y - 8, ink, 10, 40 + Math.min(v, 30) * 2.2, 0.45, 3);
  Sound.volley(v);
  Plates.kick(0.25 + Math.min(v, 24) * 0.03, 0.3);
  G.banked = { v, bonus, t: 0 };
}

function collideBricks(b) {
  if (!Board.list.length) return;
  const r = b.r;
  const row0 = Math.floor((b.y - r - GRID.y) / GRID.ch);
  const row1 = Math.floor((b.y + r - GRID.y) / GRID.ch);
  if (row1 < 0 || row0 >= GRID.rows) {
    if (b.pierced.size) b.pierced.clear();
    return;
  }
  const hits = [];
  for (let row = Math.max(0, row0); row <= Math.min(GRID.rows - 1, row1); row++) {
    const off = Board.rowOff[row];
    const c0 = Math.floor((b.x - r - GRID.x - off) / GRID.cw);
    const c1 = Math.floor((b.x + r - GRID.x - off) / GRID.cw);
    for (let col = Math.max(0, c0); col <= Math.min(GRID.cols - 1, c1); col++) {
      const br = Board.grid[row][col];
      if (!br || !br.alive) continue;
      const x = GRID.x + col * GRID.cw + off;
      const y = GRID.y + row * GRID.ch;
      const hit = circleRect(b.x, b.y, r, x + 0.5, y + 0.5, GRID.cw - 1, GRID.ch - 1);
      if (hit) hits.push({ br, hit });
    }
  }
  if (b.pierced.size) {
    for (const id of b.pierced) if (!hits.some((h) => h.br.id === id)) b.pierced.delete(id);
  }
  if (!hits.length) return;

  if (b.pierce > 0) {
    for (const { br, hit } of hits) {
      if (b.pierced.has(br.id)) continue;
      if (b.pierce <= 0) break;
      b.pierced.add(br.id);
      b.pierce--;
      hitBrick(br, b, hit.nx, hit.ny, true);
    }
    return;
  }

  let nx = 0, ny = 0, deepest = null;
  for (const h of hits) {
    if (b.pierced.has(h.br.id)) continue;
    nx += h.hit.nx * h.hit.pen;
    ny += h.hit.ny * h.hit.pen;
    if (!deepest || h.hit.pen > deepest.hit.pen) deepest = h;
  }
  if (!deepest) return;
  const len = Math.hypot(nx, ny);
  if (len < 1e-6) { nx = deepest.hit.nx; ny = deepest.hit.ny; } else { nx /= len; ny /= len; }
  b.x += nx * deepest.hit.pen;
  b.y += ny * deepest.hit.pen;
  const rowVel = Board.rowVel[deepest.br.r] || 0;
  const vn = (b.vx - rowVel) * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= 2 * vn * nx;
    b.vy -= 2 * vn * ny;
    b.squash(nx, ny);
  }
  hitBrick(deepest.br, b, nx, ny, false);
}

function updateHint(dt) {
  if (!G.hint) return;
  G.hint.t += dt;
  if (G.hint.t > G.hint.life) G.hint = null;
}

/* =========================================================
   Render — the page
   ========================================================= */
function renderRun(ctx, embed = false) {
  const t = G.clock;
  if (!embed) Gfx.page(ctx);
  Backdrop.draw(ctx, 0.2);
  Decal.draw(ctx, 0.5);
  drawFrame(ctx);
  for (const w of G.wells) w.draw(ctx);
  Board.draw(ctx, t);
  if (G.stage.boss) G.stage.boss.draw(ctx, t);
  if (G.phase === 'intro' && G.stage.kind === 'plate') drawIntroRoller(ctx);
  if (G.moth) G.moth.draw(ctx, t);
  for (const d of G.drops) d.draw(ctx);
  for (const h of G.hazards) h.draw(ctx);
  Paddle.draw(ctx);
  drawLandingCue(ctx);
  for (const b of G.balls) if (b.held && G.phase !== 'lost') drawAim(ctx, b);
  const flood = G.fx.flood > 0;
  for (const b of G.balls) if (!b.dead) drawBall(ctx, b, t, flood);
  FX.draw(ctx);
  FX.drawStamps(ctx);
  if (!embed) drawHUD(ctx);
}

function drawFrame(ctx) {
  const k = Plates.k;
  const x0 = FIELD.x + k.x, y0 = FIELD.y + k.y, x1 = FIELD.r + k.x, y1 = FIELD.b + k.y;
  ctx.strokeStyle = INK.k;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(x0, y1 - 1);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x1, y0);
  ctx.lineTo(x1, y1 - 1);
  ctx.stroke();

  // crop marks
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [cx, cy, sx, sy] of [[x0, y0, -1, -1], [x1, y0, 1, -1], [x0, y1, -1, 1], [x1, y1, 1, 1]]) {
    ctx.moveTo(cx + sx * 7, cy); ctx.lineTo(cx + sx * 24, cy);
    ctx.moveTo(cx, cy + sy * 6); ctx.lineTo(cx, cy + sy * 14);
  }
  ctx.stroke();

  // registration marks in the side margins
  for (const rx of [FIELD.x / 2, FIELD.r + FIELD.x / 2]) {
    const ry = FIELD.y + FIELD.h * 0.42;
    ctx.beginPath();
    ctx.arc(rx + k.x, ry + k.y, 5.5, 0, TAU);
    ctx.moveTo(rx - 10 + k.x, ry + k.y); ctx.lineTo(rx + 10 + k.x, ry + k.y);
    ctx.moveTo(rx + k.x, ry - 10 + k.y); ctx.lineTo(rx + k.x, ry + 10 + k.y);
    ctx.stroke();
  }

  // the cut line
  const cutInk = G.cutFlash > 0 ? 'p' : 'k';
  ctx.strokeStyle = INK[cutInk];
  ctx.lineWidth = 1.5 + G.cutFlash * 2;
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  ctx.moveTo(x0 + 26, y1);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.setLineDash([]);
  drawScissors(ctx, x0 + 12, y1, INK[cutInk]);

  // margin shield
  if (G.fx.margin || G.marginFlash > 0) {
    const yp = Plates.y;
    ctx.save();
    ctx.globalAlpha = G.fx.margin ? 1 : G.marginFlash;
    ctx.fillStyle = INK.y;
    ctx.fillRect(FIELD.x + yp.x, FIELD.b - 7 + yp.y, FIELD.w, 6);
    ctx.fillStyle = INK.k;
    for (let x = FIELD.x + 16; x < FIELD.r; x += 16) {
      ctx.fillRect(x, FIELD.b - 7, 1.2, (x / 16) % 4 === 0 ? 6 : 3);
    }
    if (G.fx.margin >= 2) {
      // Steel Rule: a second, steel edge under the first
      ctx.fillStyle = INK.k;
      ctx.fillRect(FIELD.x, FIELD.b - 10, FIELD.w, 2.5);
    }
    ctx.restore();
  }
}

function drawScissors(ctx, x, y, col) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 1.6;
  const open = 0.32 + Math.sin(G.clock * 3) * 0.05;
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.rotate(s * open);
    ctx.beginPath();
    ctx.moveTo(-1, 0);
    ctx.lineTo(13, s * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-5, 0, 3.2, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawIntroRoller(ctx) {
  const x = G.stage.rollerX;
  const top = GRID.y - 18;
  const bot = GRID.y + (G.stage.maxRow + 1) * GRID.ch + 18;
  const k = Plates.k;
  ctx.save();
  ctx.translate(k.x, k.y);
  // frame & handle trailing to the left
  const mid = (top + bot) / 2;
  ctx.strokeStyle = INK.k;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, top + 8);
  ctx.lineTo(x - 34, mid - 10);
  ctx.lineTo(x - 34, mid + 10);
  ctx.lineTo(x, bot - 8);
  ctx.stroke();
  const yp = Plates.y;
  ctx.fillStyle = INK.y;
  roundRectPath(ctx, x - 120 + yp.x, mid - 9 + yp.y, 88, 18, 9);
  ctx.fill();
  ctx.lineWidth = 2.5;
  roundRectPath(ctx, x - 120, mid - 9, 88, 18, 9);
  ctx.stroke();
  // roller
  ctx.fillStyle = INK.k;
  roundRectPath(ctx, x - 15, top, 30, bot - top, 15);
  ctx.fill();
  ctx.fillStyle = rgba(PAPER, 0.25);
  ctx.fillRect(x - 4, top + 14, 2, bot - top - 28);
  ctx.restore();
}

function drawLandingCue(ctx) {
  if (G.phase !== 'play') return;
  const top = Paddle.y - PADDLE_H / 2;
  const pre = 0.13 * (1 + 0.6 * perk('soft'));
  const lead = perk('tracer') ? 1.1 : 0.4;
  for (const b of G.balls) {
    if (b.dead || b.held || b.vy <= 0) continue;
    const tc = (top - (b.y + b.r)) / b.vy;
    if (tc < 0 || tc > lead) continue;
    let px = b.x + b.vx * tc;
    const L = FIELD.x + b.r, R = FIELD.r - b.r, W = R - L;
    let u = (px - L) % (2 * W);
    if (u < 0) u += 2 * W;
    if (u > W) u = 2 * W - u;
    px = L + u;
    if (perk('tracer')) {
      ctx.save();
      ctx.strokeStyle = INK.y;
      ctx.globalAlpha = 0.7 * clamp(1 - tc / lead, 0.2, 1);
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.moveTo(px, top - 4);
      ctx.lineTo(px, Math.max(b.y, top - 160));
      ctx.stroke();
      ctx.restore();
    }
    if (Math.abs(px - Paddle.x) > Paddle.w / 2 && !perk('tracer')) continue;
    const inWin = tc <= pre;
    const a = clamp(1 - tc / lead, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.35 + a * 0.65;
    ctx.fillStyle = inWin ? INK.p : PAPER_HI;
    const w = 3 + a * 8;
    ctx.fillRect(px - w / 2, top - 1, w, 3);
    ctx.restore();
  }
}

function drawAim(ctx, b) {
  const a = launchAngle(b);
  const dx = Math.sin(a), dy = -Math.cos(a);
  ctx.save();
  ctx.strokeStyle = INK.k;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 6]);
  ctx.lineDashOffset = -G.clock * 30;
  ctx.beginPath();
  ctx.moveTo(b.x + dx * 14, b.y + dy * 14);
  ctx.lineTo(b.x + dx * 92, b.y + dy * 92);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  const ex = b.x + dx * 92, ey = b.y + dy * 92;
  const ang = Math.atan2(dy, dx);
  ctx.moveTo(ex + Math.cos(ang + 2.5) * 7, ey + Math.sin(ang + 2.5) * 7);
  ctx.lineTo(ex, ey);
  ctx.lineTo(ex + Math.cos(ang - 2.5) * 7, ey + Math.sin(ang - 2.5) * 7);
  ctx.stroke();
  ctx.restore();
}

function drawHUD(ctx) {
  if (Gfx.mode === 'wide') drawPanels(ctx);
  else drawTallHUD(ctx);
  drawNotes(ctx);
}

function activeStamps() {
  const active = [];
  if (G.fx.margin) active.push({ id: 'margin', f: 1, n: G.fx.margin });
  for (const k of ['tack', 'flood', 'slow', 'wide']) {
    if (G.fx[k] > 0) active.push({ id: k, f: G.fx[k] / (G.fxMax[k] || 1) });
  }
  return active;
}

function leadBall() {
  let best = null;
  for (const b of G.balls) if (!b.dead && (!best || b.volley > best.volley)) best = b;
  return best;
}

function drawRegMark(ctx, x, y, r, filled = true) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.moveTo(x - r * 1.8, y); ctx.lineTo(x + r * 1.8, y);
  ctx.moveTo(x, y - r * 1.8); ctx.lineTo(x, y + r * 1.8);
  ctx.stroke();
  if (filled) { ctx.beginPath(); ctx.arc(x, y, r * 0.48, 0, TAU); ctx.fill(); }
}

/* ---------- portrait layout: HUD in the page margins ---------- */
function drawTallHUD(ctx) {
  const st = G.stage;
  const k = Plates.k;
  ctx.save();
  ctx.translate(k.x * 0.5, k.y * 0.5);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK.k;

  // top-left: what we're printing
  ctx.font = fMono(11, 600);
  ctx.globalAlpha = 0.58;
  const label = st.kind === 'boss' ? `ACT ${roman(st.act)} · BOSS` : `PLATE ${pad2(st.plateNo)} · ACT ${roman(st.act)}`;
  spaced(ctx, label, FIELD.x + 1, 30, 2.2);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  const name = st.name.toUpperCase();
  ctx.font = fDisplay(27);
  const room = FIELD.cx - 108 - FIELD.x;   // stop short of the run marks
  const nw = ctx.measureText(name).width;
  if (nw > room) ctx.font = fDisplay(Math.floor(27 * room / nw));
  ctx.fillText(name, FIELD.x, 62);

  // top-right: score, leading zeros printed lighter
  ctx.font = fMono(11, 600);
  ctx.globalAlpha = 0.58;
  spaced(ctx, 'SCORE', FIELD.r, 30, 2.2, 'right');
  ctx.globalAlpha = 1;
  drawScore(ctx, FIELD.r, 62, 28, 'right');

  // top-centre: the run, as a row of marks
  drawProgress(ctx, FIELD.cx, 48);

  // boss health, or the volley
  if (st.boss) {
    ctx.save();
    st.boss.drawHealth(ctx);
    ctx.restore();
  } else if (G.volShown >= 2) {
    ctx.save();
    ctx.font = fMono(12, 700);
    ctx.textAlign = 'center';
    ctx.fillStyle = INK.k;
    const sc = 1 + G.volPop * 0.25;
    ctx.translate(FIELD.cx, 75);
    ctx.scale(sc, sc);
    spaced(ctx, `VOLLEY ×${G.volShown}`, 0, 0, 2, 'center');
    ctx.restore();
  }

  // bottom-left: balls in hand
  const by = FIELD.b + 31;
  ctx.fillStyle = INK.k;
  ctx.strokeStyle = INK.k;
  ctx.lineWidth = 1.4;
  const lives = Math.max(0, G.run.lives);
  for (let i = 0; i < Math.min(lives, 7); i++) drawRegMark(ctx, FIELD.x + 8 + i * 22, by, 5);
  if (lives > 7) {
    ctx.font = fMono(12, 600);
    ctx.textAlign = 'left';
    ctx.fillText('+' + (lives - 7), FIELD.x + 8 + 7 * 22 - 4, by + 4);
  }

  // bottom-right: active stamps
  let ax = FIELD.r - 12;
  for (const a of activeStamps()) {
    drawStampDot(ctx, a.id, ax, by, 11, a.f);
    ax -= 34;
  }
  ctx.restore();
}

function drawScore(ctx, x, y, size, align = 'left') {
  ctx.font = fMono(size, 600);
  ctx.fillStyle = INK.k;
  const raw = Math.round(G.scoreShown).toString();
  const padded = raw.padStart(7, '0');
  const zeros = padded.length - raw.length;
  const wAll = ctx.measureText(padded).width;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  const sx = align === 'right' ? x - wAll : x;
  if (zeros > 0) {
    ctx.globalAlpha = 0.2;
    ctx.fillText(padded.slice(0, zeros), sx, y);
    ctx.globalAlpha = 1;
  }
  ctx.fillText(raw, sx + ctx.measureText(padded.slice(0, zeros)).width, y);
  ctx.textAlign = prev;
}

function drawStampDot(ctx, id, x, y, r, frac) {
  const d = DROP_TYPES[id];
  const pl = Plates[d.ink];
  ctx.fillStyle = INK[d.ink];
  ctx.beginPath(); ctx.arc(x + pl.x, y + pl.y, r, 0, TAU); ctx.fill();
  drawIcon(ctx, d.icon, x, y, r * 1.36, d.ink === 'k' ? PAPER : INK.k);
  ctx.strokeStyle = INK.k;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
  ctx.stroke();
}

/* ---------- wide layout: designed side panels ---------- */
function panelLabel(ctx, text, x, y) {
  ctx.save();
  ctx.font = fMono(12.5, 600);
  ctx.fillStyle = INK.k;
  ctx.globalAlpha = 0.55;
  spaced(ctx, text, x, y, 2.6);
  ctx.restore();
}

function panelRule(ctx, x, y, w) {
  ctx.fillStyle = INK.k;
  ctx.fillRect(x, y, w, 1.5);
}

/** Blue plate, pink plate, overprinted out of register — like the wordmark. */
function misregText(ctx, text, x, y, fs) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.font = fDisplay(fs);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const pb = Plates.b, pp = Plates.p;
  ctx.fillStyle = INK.b;
  ctx.fillText(text, x + pb.x, y + pb.y);
  ctx.fillStyle = INK.p;
  ctx.fillText(text, x + fs * 0.03 + pp.x * 1.5, y + fs * 0.02 + pp.y * 1.5);
  ctx.restore();
}

function livePrintCrop() {
  if (G.stage.kind === 'plate') {
    const h = clamp(GRID.y - FIELD.y + (G.stage.maxRow + 1) * GRID.ch + 80, 300, 620);
    return { x: 0, y: 0, w: FIELD.w, h };
  }
  return { x: 0, y: 0, w: FIELD.w, h: 600 };
}

/** The print sheet as it builds up, pinned to the panel like a proof. */
function drawLivePrint(ctx, x, y, w, h, crop) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(-0.02);
  ctx.translate(-w / 2, -h / 2);
  ctx.fillStyle = INK.k;
  ctx.fillRect(7, 7, w, h);
  ctx.fillStyle = PAPER_HI;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.globalCompositeOperation = 'multiply';
  if (Backdrop.has) {
    const bk = Backdrop.k;
    ctx.globalAlpha = 0.42;
    ctx.drawImage(Backdrop.cv, crop.x * bk, crop.y * bk, crop.w * bk, crop.h * bk, 0, 0, w, h);
    ctx.globalAlpha = 1;
  }
  const dk = Decal.k;
  ctx.drawImage(Decal.print, crop.x * dk, crop.y * dk, crop.w * dk, crop.h * dk, 0, 0, w, h);
  ctx.restore();
  ctx.strokeStyle = INK.k;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0, 0, w, h);
  ctx.restore();
}

function drawPanels(ctx) {
  const st = G.stage;
  const PW = Gfx.panelW;
  const L = FIELD.x - PANEL_GAP - PW;
  const R = FIELD.r + PANEL_GAP;
  const top = FIELD.y;
  const bottom = FIELD.b;
  const plate = st.kind === 'plate';
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = INK.k;
  ctx.strokeStyle = INK.k;

  /* ===== left: the plate ===== */
  let y = top + 10;
  panelLabel(ctx, plate ? `PLATE ${pad2(st.plateNo)} · ACT ${roman(st.act)}` : `ACT ${roman(st.act)} · BOSS`, L, y);
  const name = st.name.toUpperCase();
  let fs = 82;
  ctx.font = fDisplay(fs);
  const nw = ctx.measureText(name).width;
  if (nw > PW - 8) fs = Math.floor(fs * (PW - 8) / nw);
  y += 14 + fs * 0.74;
  misregText(ctx, name, L - 2, y, fs);
  y += 24;
  if (st.boss) {
    const parts = st.boss.healthParts();
    const gap = 10;
    const gw = (PW - (parts.length - 1) * gap) / parts.length;
    parts.forEach((p, i) => {
      const x = L + i * (gw + gap);
      const pl = Plates[p.ink];
      ctx.fillStyle = INK[p.ink];
      ctx.fillRect(x + pl.x, y + pl.y, gw * clamp(p.frac, 0, 1), 12);
      ctx.strokeStyle = INK.k;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, gw, 12);
      for (let t = 1; t < 6; t++) ctx.fillRect(x + (gw / 6) * t, y, 1.2, 4);
    });
    y += 12 + 24;
  }
  panelRule(ctx, L, y, PW);
  y += 36;

  panelLabel(ctx, 'YOUR PRINT', L, y);
  y += 16;
  const crop = livePrintCrop();
  const pw = PW - 14;
  const ph = pw * crop.h / crop.w;
  drawLivePrint(ctx, L + 2, y, pw, ph, crop);
  y += ph + 30;

  // the run, bottom-aligned
  const rowH = 21, actGap = 9;
  const listH = 28 + RUN_STAGES.length * rowH + 2 * actGap;
  const ly0 = bottom - listH + 14;
  if (ly0 > y + 10) {
    panelLabel(ctx, 'THE RUN', L, ly0);
    let ry = ly0 + 28;
    RUN_STAGES.forEach((s, i) => {
      const nm = (s.kind === 'boss' ? BOSS_NAMES[s.boss] : PLATES[s.plate].name).toUpperCase();
      const cur = i === st.index, done = i < st.index;
      if (cur) {
        const pp = Plates.p;
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = INK.p;
        ctx.fillRect(L - 5 + pp.x, ry - 13 + pp.y, Math.min(PW, 250), 17);
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = done ? 0.4 : cur ? 1 : 0.78;
      ctx.fillStyle = INK.k;
      ctx.font = fMono(13, cur ? 700 : 500);
      ctx.fillText(pad2(i + 1), L, ry);
      ctx.font = s.kind === 'boss' ? fMono(13, 700) : fMono(13, cur ? 700 : 500);
      ctx.fillText(nm, L + 32, ry);
      // status mark
      const mx = L + Math.min(PW, 250) + 18, my = ry - 4.5;
      ctx.translate(mx, my);
      if (s.kind === 'boss') ctx.rotate(Math.PI / 4);
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = INK.k;
      if (done) ctx.fillRect(-4, -4, 8, 8);
      ctx.strokeRect(-4, -4, 8, 8);
      ctx.restore();
      ry += rowH + (s.kind === 'boss' ? actGap : 0);
    });
  }

  /* ===== right: the score, the volley, the ball ===== */
  y = top + 10;
  panelLabel(ctx, 'SCORE', R, y);
  y += 16 + 44;
  drawScore(ctx, R - 2, y, 56);
  y += 28;
  panelRule(ctx, R, y, PW);
  y += 36;

  panelLabel(ctx, 'VOLLEY', R, y);
  y += 14 + 62;
  const v = G.volShown;
  ctx.save();
  const sc = 1 + G.volPop * 0.22;
  ctx.translate(R - 2, y);
  ctx.scale(sc, sc);
  const lb = leadBall();
  const vInk = lb && lb.ink !== 'k' ? lb.ink : 'p';
  if (v >= 5) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.font = fDisplay(76);
    ctx.fillStyle = INK[vInk];
    ctx.fillText('×' + v, 3 + Plates[vInk].x * 2, 2 + Plates[vInk].y * 2);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.font = fDisplay(76);
  ctx.fillStyle = INK.k;
  ctx.globalAlpha = v > 0 ? 1 : 0.2;
  ctx.fillText('×' + v, 0, 0);
  ctx.restore();
  ctx.font = fDisplay(76);
  const vw = ctx.measureText('×' + v).width;
  ctx.font = fMono(13, 600);
  const noteX = R + vw + 18;
  if (G.banked && G.banked.t < 1.8) {
    ctx.fillStyle = INK.p;
    spaced(ctx, 'BANKED', noteX, y - 26, 2);
    ctx.fillStyle = INK.k;
    ctx.font = fMono(17, 700);
    ctx.fillText('+' + fmt(G.banked.bonus), noteX, y - 4);
  } else if (v >= 4) {
    ctx.globalAlpha = 0.75;
    spaced(ctx, 'PAYS ON RETURN', noteX, y - 26, 1.6);
    ctx.globalAlpha = 1;
    ctx.font = fMono(17, 700);
    ctx.fillText('+' + fmt(5 * v * v), noteX, y - 4);
  } else {
    ctx.globalAlpha = 0.5;
    ctx.fillText('4+ in a row', noteX, y - 24);
    ctx.fillText('pays a bonus', noteX, y - 6);
    ctx.globalAlpha = 1;
  }
  y += 30;
  panelRule(ctx, R, y, PW);
  y += 36;

  // the ball's ink — the heart of the rules
  panelLabel(ctx, 'BALL INK', R, y);
  y += 18;
  const flood = G.fx.flood > 0;
  const ink = lb ? lb.ink : 'k';
  const ink2 = lb && perk('dualink') && lb.ink2 !== 'k' && lb.ink2 !== ink && ink !== 'k' ? lb.ink2 : null;
  const charged = lb && lb.charged;
  const dotX = R + 20, dotY = y + 20, dr = 19;
  if (flood) {
    for (let i = 0; i < 3; i++) {
      const a0 = G.clock * 4 + (i / 3) * TAU;
      ctx.fillStyle = INK[COLOR_INKS[i]];
      ctx.beginPath(); ctx.moveTo(dotX, dotY); ctx.arc(dotX, dotY, dr, a0, a0 + TAU / 3); ctx.closePath(); ctx.fill();
    }
  } else if (ink2) {
    ctx.fillStyle = INK[ink];
    ctx.beginPath(); ctx.arc(dotX, dotY, dr, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = INK[ink2];
    ctx.beginPath(); ctx.arc(dotX, dotY, dr, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
  } else {
    const pl = Plates[ink];
    ctx.fillStyle = INK[ink];
    ctx.beginPath(); ctx.arc(dotX + pl.x, dotY + pl.y, dr, 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = INK.k;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(dotX, dotY, dr, 0, TAU); ctx.stroke();
  if (charged) {
    ctx.strokeStyle = INK.y;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(dotX, dotY, dr + 5, 0, TAU); ctx.stroke();
  }
  const inkName = flood ? 'FLOOD' : ink2 ? `${INK_NAME[ink]} + ${INK_NAME[ink2]}`.toUpperCase() : INK_NAME[ink].toUpperCase();
  ctx.fillStyle = INK.k;
  ctx.font = fDisplay(ink2 ? 22 : 32);
  ctx.fillText(inkName, R + 54, y + (ink2 ? 28 : 31));
  ctx.font = fMono(13, 500);
  ctx.globalAlpha = 0.72;
  let help;
  if (flood) help = 'every hit bleeds';
  else if (charged) help = 'charged — the next hit bleeds';
  else if (ink === 'k') help = plate ? 'peel a colour to soak it up' : 'hit something to soak its colour';
  else if (ink2) help = plate ? 'hit either colour to bleed it' : 'hit either colour for a big splash';
  else help = plate ? `hit ${INK_NAME[ink]} again to bleed it` : `hit ${INK_NAME[ink]} again for a big splash`;
  ctx.fillText(help, R + 55, y + 54);
  ctx.globalAlpha = 1;
  y += 78;
  panelRule(ctx, R, y, PW);
  y += 36;

  // ink left on the plate, by colour — the bar empties as you clear it
  if (plate && G.stage.layers0) {
    panelLabel(ctx, 'INK LEFT', R, y);
    y += 16;
    const counts = { p: 0, b: 0, y: 0 };
    let total = 0;
    for (const br of Board.list) {
      if (!br.alive || br.kind !== 'ink') continue;
      for (const l of br.layers) { counts[l]++; total++; }
    }
    const bw = PW - 84;
    let x = R;
    for (const c of COLOR_INKS) {
      const w = bw * counts[c] / G.stage.layers0;
      const pl = Plates[c];
      ctx.fillStyle = INK[c];
      ctx.fillRect(x + pl.x, y + pl.y, w, 16);
      x += w;
    }
    ctx.strokeStyle = INK.k;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(R, y, bw, 16);
    ctx.fillStyle = INK.k;
    ctx.font = fMono(16, 700);
    ctx.fillText(String(total), R + bw + 14, y + 14);
    y += 16 + 30;
    panelRule(ctx, R, y, PW);
    y += 36;
  }

  // stamps in play
  const active = activeStamps();
  if (active.length) {
    panelLabel(ctx, 'STAMPS', R, y);
    y += 22;
    for (const a of active) {
      drawStampDot(ctx, a.id, R + 13, y + 6, 12, a.f);
      ctx.fillStyle = INK.k;
      ctx.font = fMono(14, 600);
      ctx.fillText(DROP_TYPES[a.id].label.toUpperCase(), R + 38, y + 11);
      y += 36;
    }
    y += 12;
  }

  // techniques held — rarest first; pairs marked; a grid when there are many
  const ids = Object.keys(G.run.perks).sort((a, b) => RARITY_ORDER.indexOf(PERK_BY_ID[a].rarity) - RARITY_ORDER.indexOf(PERK_BY_ID[b].rarity));
  const livesTop = bottom - 50;
  if (ids.length && y + 40 < livesTop) {
    panelLabel(ctx, 'TECHNIQUES', R, y);
    y += 30;
    const rowH = 27;
    const rows = Math.floor((livesTop - y + 8) / rowH);
    const disc = (p, x, yy, r) => {
      const ink = p.ink === 'k' ? 'y' : p.ink;
      const pl = Plates[ink];
      ctx.fillStyle = INK[ink];
      ctx.beginPath(); ctx.arc(x + pl.x, yy + pl.y, r, 0, TAU); ctx.fill();
      if (p.rarity === 'proof' || p.rarity === 'signed') {
        ctx.strokeStyle = INK.k;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(x, yy, r + 2.5, 0, TAU); ctx.stroke();
      }
      drawIcon(ctx, p.icon, x, yy, r * 1.45, INK.k);
    };
    const pairMark = (x, yy) => {
      ctx.save();
      ctx.translate(x, yy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = INK.p;
      ctx.fillRect(-3.5, -3.5, 7, 7);
      ctx.strokeStyle = INK.k;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-3.5, -3.5, 7, 7);
      ctx.restore();
    };
    if (ids.length <= rows) {
      ids.forEach((id, i) => {
        const p = PERK_BY_ID[id];
        const n = G.run.perks[id];
        const yy = y + i * rowH;
        disc(p, R + 11, yy - 5, 11);
        ctx.fillStyle = INK.k;
        ctx.font = fMono(14, 600);
        const label = p.name + (n > 1 ? `  ×${n}` : '');
        ctx.fillText(label, R + 32, yy);
        if (ownedPairs(p).length) pairMark(R + 32 + ctx.measureText(label).width + 12, yy - 5);
      });
    } else {
      const cell = 38;
      const cols = Math.max(1, Math.floor(PW / cell));
      ids.forEach((id, i) => {
        const p = PERK_BY_ID[id];
        const cx = R + 14 + (i % cols) * cell;
        const cy = y - 4 + Math.floor(i / cols) * cell;
        if (cy > livesTop - 10) return;
        disc(p, cx, cy, 13);
        const n = G.run.perks[id];
        if (n > 1) {
          ctx.fillStyle = INK.k;
          ctx.font = fMono(10, 700);
          ctx.fillText('×' + n, cx + 9, cy + 16);
        }
        if (ownedPairs(p).length) pairMark(cx + 12, cy - 12);
      });
    }
  }

  // balls in hand
  panelLabel(ctx, 'BALLS', R, bottom - 38);
  ctx.strokeStyle = INK.k;
  ctx.fillStyle = INK.k;
  ctx.lineWidth = 1.6;
  const lives = Math.max(0, G.run.lives);
  for (let i = 0; i < Math.min(lives, 9); i++) drawRegMark(ctx, R + 11 + i * 30, bottom - 8, 7);
  ctx.restore();
}

/* ---------- notes that sit over the field in either layout ---------- */
function drawNotes(ctx) {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  if (G.hint) {
    const h = G.hint;
    const by = FIELD.b + 31;
    const a = Math.min(1, h.t * 4) * Math.min(1, (h.life - h.t) * 3);
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.font = fMono(12.5, 600);
    ctx.textAlign = 'center';
    const w = ctx.measureText(h.text.toUpperCase()).width;
    ctx.fillStyle = INK.y;
    ctx.fillRect(FIELD.cx - w / 2 - 8 + Plates.y.x, by - 11 + Plates.y.y, w + 16, 19);
    ctx.fillStyle = INK.k;
    ctx.fillText(h.text.toUpperCase(), FIELD.cx, by + 4);
    ctx.globalAlpha = 1;
  }
  if (G.toast) {
    const tt = G.toast;
    ctx.globalAlpha = clamp(Math.min(tt.t * 6, (tt.life - tt.t) * 4), 0, 1);
    ctx.font = fMono(12, 700);
    ctx.textAlign = 'center';
    ctx.fillStyle = INK.k;
    ctx.fillText(tt.text, FIELD.cx, FIELD.y + 26);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawProgress(ctx, cx, y) {
  const n = RUN_STAGES.length;
  const sz = 8, gap = 7, actGap = 14;
  const total = n * sz + (n - 1) * gap + 2 * (actGap - gap);
  let x = cx - total / 2;
  const cur = G.stage.index;
  for (let i = 0; i < n; i++) {
    const boss = RUN_STAGES[i].kind === 'boss';
    const done = i < cur;
    const now = i === cur;
    ctx.save();
    ctx.translate(x + sz / 2, y);
    if (boss) ctx.rotate(Math.PI / 4);
    const s = boss ? sz * 0.95 : sz;
    if (now) {
      const pp = Plates.p;
      ctx.fillStyle = INK.p;
      ctx.fillRect(-s / 2 + pp.x, -s / 2 + pp.y, s, s);
    } else if (done) {
      ctx.fillStyle = INK.k;
      ctx.fillRect(-s / 2, -s / 2, s, s);
    }
    ctx.strokeStyle = INK.k;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.restore();
    x += sz + (boss ? actGap : gap);
  }
}

function toast(text) {
  G.toast = { text, t: 0, life: 1.3 };
}
