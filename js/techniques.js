'use strict';
/* =========================================================
   MISPRINT — techniques
   Forty techniques in four rarities, named like print runs:
   Open Edition, Limited, Signed, and the Artist's Proof.
   Many pair with others — a pairing is shown on the ticket,
   and completing one is stamped. The effects that need their
   own code live at the bottom of this file.
   ========================================================= */

const RARITY = {
  common:  { label: 'Open edition',   ink: 'k', odds: [0.64, 0.54, 0.46] },
  limited: { label: 'Limited',        ink: 'b', odds: [0.27, 0.31, 0.33] },
  signed:  { label: 'Signed',         ink: 'p', odds: [0.08, 0.12, 0.16] },
  proof:   { label: "Artist's proof", ink: 'y', odds: [0.01, 0.03, 0.05] },
};
const RARITY_ORDER = ['proof', 'signed', 'limited', 'common'];

const PERKS = [
  /* ----- open edition ----- */
  { id: 'wide',      name: 'Wide Roller',   rarity: 'common',  ink: 'y', max: 3, icon: 'wide',      desc: 'Your roller grows wider.', pairs: ['jet'] },
  { id: 'heavy',     name: 'Heavy Ink',     rarity: 'common',  ink: 'p', max: 3, icon: 'heavy',     desc: 'Smashes punch through two more layers.', pairs: ['shock', 'keyblast', 'hotpress'] },
  { id: 'soft',      name: 'Soft Touch',    rarity: 'common',  ink: 'b', max: 2, icon: 'soft',      desc: 'A far more forgiving window to land a Smash.', pairs: ['shock', 'hotpress', 'tracer'] },
  { id: 'spare',     name: 'Spare Sheet',   rarity: 'common',  ink: 'k', max: 9, icon: 'spare',     desc: 'One more ball, right now.', weight: 0.8 },
  { id: 'splash',    name: 'Splash',        rarity: 'common',  ink: 'p', max: 3, icon: 'splash',    desc: 'Peels sometimes splash onto a neighbour.', pairs: ['spatter'] },
  { id: 'lucky',     name: 'Lucky Stamp',   rarity: 'common',  ink: 'y', max: 2, icon: 'lucky',     desc: 'Stamps drop half again as often.', pairs: ['collector', 'magnet', 'foil', 'duplicate', 'aftershock'] },
  { id: 'longstamp', name: 'Slow Drying',   rarity: 'common',  ink: 'b', max: 2, icon: 'longstamp', desc: 'Timed stamps last half again as long.', pairs: ['lucky', 'foil'] },
  { id: 'tracer',    name: 'Tracer',        rarity: 'common',  ink: 'y', max: 1, icon: 'tracer',    desc: 'See where the ball will land far earlier.', pairs: ['soft'] },
  { id: 'bigball',   name: 'Bold Type',     rarity: 'common',  ink: 'k', max: 2, icon: 'bigball',   desc: 'The ball prints a size bigger.' },
  { id: 'wells',     name: 'Deep Wells',    rarity: 'common',  ink: 'b', max: 1, icon: 'wells',     desc: 'Ink wells are twice the size.', pairs: ['charged'] },
  { id: 'pigment',   name: 'Rich Pigment',  rarity: 'common',  ink: 'p', max: 2, icon: 'pigment',   desc: 'Every block in a Bleed adds one more to your volley.', pairs: ['overrun', 'absorb'] },
  { id: 'tough',     name: 'Smudge-Proof',  rarity: 'common',  ink: 'k', max: 1, icon: 'tough',     desc: "Boss ink can't smudge your roller." },
  { id: 'bounty',    name: 'Boss Hunter',   rarity: 'common',  ink: 'p', max: 2, icon: 'bounty',    desc: 'Every hit on a boss does one more damage.' },

  /* ----- limited ----- */
  { id: 'wet',       name: 'Wet Edges',     rarity: 'limited', ink: 'b', max: 1, icon: 'wet',       desc: 'A Bleed also leaks across the corners of the block you hit.', pairs: ['hotpress', 'coat'] },
  { id: 'margin',    name: 'Safety Margin', rarity: 'limited', ink: 'y', max: 1, icon: 'margin',    desc: 'Start every plate with a Margin below the cut line.', pairs: ['steel'] },
  { id: 'magnet',    name: 'Magnet',        rarity: 'limited', ink: 'b', max: 1, icon: 'magnet',    desc: 'Falling stamps drift toward your roller.', pairs: ['lucky', 'collector', 'foil'] },
  { id: 'rico',      name: 'Ricochet',      rarity: 'limited', ink: 'b', max: 1, icon: 'rico',      desc: 'Wall bounces build your volley.', pairs: ['overrun'] },
  { id: 'cutter',    name: 'Key Cutter',    rarity: 'limited', ink: 'k', max: 1, icon: 'cutter',    desc: 'Black blocks crack after three hits.', pairs: ['keyblast'] },
  { id: 'english',   name: 'English',       rarity: 'limited', ink: 'p', max: 1, icon: 'english',   desc: 'Move as you hit to curve the ball.' },
  { id: 'shock',     name: 'Shockwave',     rarity: 'limited', ink: 'p', max: 1, icon: 'shock',     desc: 'A Smash also peels every block around the first one it hits.', pairs: ['heavy', 'soft'] },
  { id: 'steel',     name: 'Steel Rule',    rarity: 'limited', ink: 'k', max: 1, icon: 'steel',     desc: 'Your Margins take an extra hit before they break.', pairs: ['margin'] },
  { id: 'charged',   name: 'Charged Wells', rarity: 'limited', ink: 'y', max: 1, icon: 'charged',   desc: "An ink well makes the ball's next hit a Bleed, whatever the colour.", pairs: ['wells', 'dualink'] },
  { id: 'spatter',   name: 'Spatter',       rarity: 'limited', ink: 'b', max: 1, icon: 'spatter',   desc: 'Bleeds fling ink that peels a few blocks elsewhere.', pairs: ['splash', 'aftershock'] },
  { id: 'bigbang',   name: 'Short Fuse',    rarity: 'limited', ink: 'p', max: 1, icon: 'bigbang',   desc: 'Bombs blast twice as far.', pairs: ['keyblast'] },
  { id: 'duplicate', name: 'Duplicate',     rarity: 'limited', ink: 'b', max: 1, icon: 'duplicate', desc: 'Split stamps make two more balls than usual.', pairs: ['twin', 'lucky'] },
  { id: 'aftershock',name: 'Aftershock',    rarity: 'limited', ink: 'y', max: 1, icon: 'aftershock',desc: 'A Bleed of six or more blocks shakes loose a stamp.', pairs: ['lucky', 'spatter', 'collector'] },

  /* ----- signed ----- */
  { id: 'coat',      name: 'Second Coat',   rarity: 'signed',  ink: 'y', max: 1, icon: 'coat',      desc: 'A Bleed may run again on the colour underneath.', pairs: ['wet', 'saturate', 'absorb'] },
  { id: 'twin',      name: 'Twin Serve',    rarity: 'signed',  ink: 'p', max: 1, icon: 'twin',      desc: 'Every serve launches two balls.', pairs: ['duplicate'] },
  { id: 'hotpress',  name: 'Hot Press',     rarity: 'signed',  ink: 'p', max: 1, icon: 'hotpress',  desc: 'A Smash bleeds the colour of the first block it hits.', pairs: ['heavy', 'soft', 'wet'] },
  { id: 'saturate',  name: 'Saturate',      rarity: 'signed',  ink: 'b', max: 1, icon: 'saturate',  desc: 'A Bleed soaks two layers deep into the block you hit.', pairs: ['coat'] },
  { id: 'keyblast',  name: 'Chain Reaction',rarity: 'signed',  ink: 'k', max: 1, icon: 'keyblast',  desc: 'Breaking a black block sets off a small blast.', pairs: ['cutter', 'heavy', 'bigbang'] },
  { id: 'overrun',   name: 'Overrun',       rarity: 'signed',  ink: 'y', max: 1, icon: 'overrun',   desc: 'Every tenth hit in a volley floods the ball for two seconds.', pairs: ['rico', 'pigment'] },
  { id: 'collector', name: 'Collector',     rarity: 'signed',  ink: 'y', max: 1, icon: 'collector', desc: 'Catching a stamp peels the top layer of five random blocks.', pairs: ['lucky', 'magnet', 'aftershock'] },
  { id: 'reprint',   name: 'Reprint',       rarity: 'signed',  ink: 'b', max: 1, icon: 'reprint',   desc: 'Once per plate, your last lost ball is reprinted for free.' },
  { id: 'absorb',    name: 'Absorbent',     rarity: 'signed',  ink: 'p', max: 1, icon: 'absorb',    desc: 'After a Bleed the ball keeps its ink, ready to bleed again.', pairs: ['coat', 'pigment'] },
  { id: 'jet',       name: 'Ink Jet',       rarity: 'signed',  ink: 'b', max: 1, icon: 'jet',       desc: 'Each return fires a jet of ink straight up at the first block above.', pairs: ['wide'] },

  /* ----- artist's proof ----- */
  { id: 'fullbleed', name: 'Full Bleed',    rarity: 'proof',   ink: 'p', max: 1, icon: 'fullbleed', desc: 'A Bleed takes every block of that colour on the plate, joined or not.', pairs: ['coat', 'absorb'] },
  { id: 'dualink',   name: 'Overprint',     rarity: 'proof',   ink: 'b', max: 1, icon: 'dualink',   desc: 'The ball holds two inks at once, and bleeds either.', pairs: ['charged', 'absorb'] },
  { id: 'foil',      name: 'Foil Stamp',    rarity: 'proof',   ink: 'y', max: 1, icon: 'foil',      desc: 'Every stamp you catch floods the ball for four seconds.', pairs: ['lucky', 'magnet', 'longstamp'] },
  { id: 'edition',   name: 'Endless Edition', rarity: 'proof', ink: 'k', max: 1, icon: 'edition',   desc: 'Every plate you clear gives you another ball.' },
];

const PERK_BY_ID = Object.fromEntries(PERKS.map((p) => [p.id, p]));
// pairings work both ways
for (const p of PERKS) p.pairs = p.pairs || [];
for (const p of PERKS) {
  for (const q of p.pairs) {
    const o = PERK_BY_ID[q];
    if (o && !o.pairs.includes(p.id)) o.pairs.push(p.id);
  }
}

function perk(id) {
  return G.run ? G.run.perks[id] || 0 : 0;
}

/** Techniques you own that pair with this one. */
function ownedPairs(p) {
  return p.pairs.filter((q) => perk(q) > 0);
}

function rollRarity(act) {
  const a = clamp(act, 0, 2);
  let r = Math.random();
  for (const id of ['common', 'limited', 'signed', 'proof']) {
    r -= RARITY[id].odds[a];
    if (r <= 0) return id;
  }
  return 'common';
}

/** Three tickets. Rarer as the run goes on; a boss always leaves something Signed or better. */
function offerPerks() {
  const st = G.stage;
  const act = st ? st.act : 0;
  const afterBoss = st && st.kind === 'boss';
  const avail = PERKS.filter((p) => perk(p.id) < p.max);
  const out = [];
  for (let slot = 0; slot < 3; slot++) {
    const rar = slot === 0 && afterBoss ? (chance(0.24) ? 'proof' : 'signed') : rollRarity(act);
    let pool = [];
    for (let i = RARITY_ORDER.indexOf(rar); i < RARITY_ORDER.length && !pool.length; i++) {
      pool = avail.filter((p) => p.rarity === RARITY_ORDER[i] && !out.includes(p));
    }
    if (!pool.length) pool = avail.filter((p) => !out.includes(p));
    if (!pool.length) break;
    const weights = pool.map((p) => (p.weight ?? 1) * (ownedPairs(p).length ? 1.8 : 1));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let pickIdx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) { pickIdx = i; break; }
    }
    out.push(pool[pickIdx]);
  }
  // show the rarest first
  return out.sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
}

/* =========================================================
   Ink rules shared by blocks and bosses
   ========================================================= */
function inkMatches(ball, ink) {
  if (G.fx.flood > 0 || ball.charged) return true;
  if (ink === 'k') return false;
  return ball.ink === ink || (perk('dualink') > 0 && ball.ink2 === ink);
}

/** After a Bleed (or a big boss hit) the ball lets its ink go — unless Absorbent. */
function releaseInk(ball) {
  ball.charged = false;
  if (G.fx.flood > 0 || perk('absorb')) return;
  ball.setInk('k');
  ball.ink2 = 'k';
}

/** The ball soaks up a colour; with Overprint it keeps the last one too. */
function soakInk(ball, ink) {
  if (perk('dualink') && ball.ink !== 'k' && ball.ink !== ink) ball.ink2 = ball.ink;
  ball.setInk(ink);
}

/* =========================================================
   Effects that need their own code
   ========================================================= */
function stampScale() {
  return 1 + 0.5 * perk('longstamp');
}

function setTimed(k, base) {
  const d = base * stampScale();
  G.fx[k] = Math.max(G.fx[k], d);
  G.fxMax[k] = Math.max(G.fx[k], d);
}

function aliveInk() {
  return Board.list.filter((b) => b.alive && b.kind === 'ink');
}

/** Shockwave: everything around the first block a Smash hits takes a peel. */
function shockwave(br, ball) {
  const c = Board.center(br);
  FX.ring(c.x, c.y, 'p', 10, 70, 0.35, 5);
  FX.dots(c.x, c.y, 'p', 52, 0.4);
  Plates.kick(0.9, 0.4);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nb = Board.at(br.r + dr, br.c + dc);
      if (!nb) continue;
      after(0.04 + (Math.abs(dr) + Math.abs(dc)) * 0.02, () => {
        if (!nb.alive) return;
        if (nb.kind === 'bomb') explode(nb, ball);
        else if (nb.kind === 'ink') peel(nb, ball, -dc, -dr, { quiet: true });
      });
    }
  }
}

/** Chain Reaction: a broken black block blasts its neighbours. */
function keyBlast(br, ball) {
  const c = Board.center(br);
  FX.dots(c.x, c.y, 'k', 54, 0.45);
  FX.ring(c.x, c.y, 'y', 8, 60, 0.35, 4);
  Sound.bomb(c.x);
  Plates.kick(1.1, 0.5);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nb = Board.at(br.r + dr, br.c + dc);
      if (!nb) continue;
      after(0.06 + (Math.abs(dr) + Math.abs(dc)) * 0.03, () => {
        if (!nb.alive) return;
        if (nb.kind === 'bomb') explode(nb, ball);
        else if (nb.kind === 'ink') peel(nb, ball, -dc, -dr, { quiet: true });
      });
    }
  }
}

/** Spatter: a Bleed flings ink across the plate. */
function spatterFrom(x, y, ink, ball) {
  const targets = shuffle(aliveInk()).slice(0, 3);
  targets.forEach((t, i) => {
    const tc = Board.center(t);
    after(0.18 + i * 0.09, () => {
      if (!t.alive) return;
      FX.jet(tc.x, y, tc.y, ink, x);
      FX.droplets(tc.x, tc.y, ink, 5, 0, 0, 140);
      peel(t, ball, 0, 1, { quiet: true, noSplash: true });
    });
  });
}

/** Collector: a caught stamp knocks the top layer off five blocks. */
function collectorPeel() {
  const targets = shuffle(aliveInk()).slice(0, 5);
  targets.forEach((t, i) => {
    after(0.1 + i * 0.07, () => {
      if (!t.alive) return;
      const tc = Board.center(t);
      FX.ring(tc.x, tc.y, 'y', 4, 22, 0.3, 2);
      peel(t, null, 0, 1, { quiet: true, noSplash: true });
    });
  });
}

/** Ink Jet: each return fires straight up at the first thing above. */
function inkJet(b) {
  const x = b.x;
  const y0 = Paddle.y - PADDLE_H / 2;
  if (G.stage.kind === 'boss') {
    if (G.stage.boss.jet) {
      const yHit = G.stage.boss.jet(x, b);
      FX.jet(x, y0, yHit ?? FIELD.y, b.ink === 'k' ? 'b' : b.ink);
    }
    return;
  }
  for (let r = GRID.rows - 1; r >= 0; r--) {
    const c = Math.floor((x - GRID.x - Board.rowOff[r]) / GRID.cw);
    const br = Board.at(r, c);
    if (!br) continue;
    const cy = Board.cellY(r) + GRID.ch;
    FX.jet(x, y0, cy, b.ink === 'k' ? 'b' : b.ink);
    if (br.kind === 'ink') peel(br, b, 0, 1, { quiet: true });
    else if (br.kind === 'bomb') explode(br, b);
    else { br.jiggle(0, 1, 1); Sound.keyHit(x); }
    return;
  }
  FX.jet(x, y0, FIELD.y, b.ink === 'k' ? 'b' : b.ink);
}
