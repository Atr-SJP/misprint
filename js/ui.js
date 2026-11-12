'use strict';
/* =========================================================
   MISPRINT — screens
   Plain DOM buttons on paper. The canvas does the drawing.
   ========================================================= */

const UI = {
  cur: null,
  back: null,

  el(id) { return document.getElementById(id); },

  init() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn) { this.act(btn.dataset.act, btn); return; }
      const opt = e.target.closest('[data-opt]');
      if (opt) { this.toggleOpt(opt.dataset.opt); return; }
      const tk = e.target.closest('[data-perk]');
      if (tk) this.pickPerk(tk.dataset.perk);
    });
    document.addEventListener('pointerover', (e) => {
      const b = e.target.closest('button');
      if (b && b !== this._hover) { this._hover = b; if (Sound.ctx) Sound.ui(); }
    });
    document.addEventListener('keydown', (e) => {
      if (this.cur === 's-perk' && /^Digit[1-3]$|^Numpad[1-3]$/.test(e.code)) {
        const n = Number(e.code.slice(-1));
        const t = this.el('tickets').children[n - 1];
        if (t) t.click();
      }
      if (e.code === 'Escape' && (this.cur === 's-howto' || this.cur === 's-settings')) {
        e.stopPropagation();   // don't let the game also read this as "unpause"
        this.act('back');
      }
      if (this.cur === 's-title' && (e.code === 'Enter' || e.code === 'Space') && !e.repeat &&
          (!document.activeElement || document.activeElement === document.body)) {
        e.preventDefault();
        this.act('start');
      }
    });
    this.refreshSettings();
  },

  show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === id);
    this.cur = id;
    if (id === 's-title') return;
    setTimeout(() => {
      const scr = this.el(id);
      const first = scr && [...scr.querySelectorAll('button')].find((b) => b.offsetParent !== null);
      if (first) first.focus({ preventScroll: true });
    }, 30);
  },

  hideAll() {
    for (const s of document.querySelectorAll('.screen')) s.classList.remove('on');
    this.cur = null;
  },

  act(name) {
    if (Wipe.active) return;
    Sound.init();
    switch (name) {
      case 'start':
        Sound.uiGo();
        Wipe.run('b', () => { this.hideAll(); newRun(); }, null);
        break;
      case 'howto':
        Sound.uiGo();
        this.back = this.cur;
        this.show('s-howto');
        drawRuleArt();
        break;
      case 'settings':
        Sound.uiGo();
        this.back = this.cur;
        this.refreshSettings();
        this.show('s-settings');
        break;
      case 'back':
        Sound.ui();
        this.show(this.back || 's-title');
        if (this.cur === 's-pause') this.fillPause();
        this.back = null;
        break;
      case 'resume':
        resumeGame();
        break;
      case 'restart':
        Sound.uiGo();
        Wipe.run('p', () => { this.hideAll(); newRun(); }, null);
        break;
      case 'retry':
        Sound.uiGo();
        Wipe.run('y', () => { this.hideAll(); retryAct(); }, null);
        break;
      case 'quit':
        Sound.ui();
        Wipe.run('b', () => toTitle(), null);
        break;
      case 'save':
        savePrints();
        break;
      default: break;
    }
  },

  /* ---------- settings ---------- */
  toggleOpt(k) {
    Sound.init();
    if (k === 'shake') Settings.shake = (Settings.shake + 2) % 3;
    else Settings[k] = !Settings[k];
    Settings.save();
    Sound.apply();
    Sound.ui();
    if (k === 'shake' && Settings.shake) Plates.kick(1.2, 0.5);
    this.refreshSettings();
  },

  refreshSettings() {
    for (const b of document.querySelectorAll('[data-opt]')) {
      const k = b.dataset.opt;
      const v = Settings[k];
      let label, state;
      if (k === 'shake') {
        label = ['Off', 'Gentle', 'Full'][v];
        state = v === 2 ? 'on' : v === 1 ? 'mid' : 'off';
      } else {
        label = v ? 'On' : 'Off';
        state = v ? 'on' : 'off';
      }
      b.dataset.state = state;
      b.querySelector('.opt-val').textContent = label;
    }
  },

  /* ---------- technique pick ---------- */
  showPerks(print) {
    const cv = this.el('proof-cv');
    cv.width = print.canvas.width;
    cv.height = print.canvas.height;
    cv.getContext('2d').drawImage(print.canvas, 0, 0);
    const st = G.stage;
    const label = st.kind === 'boss' ? `Act ${roman(st.act)} · ${st.name}` : `Plate ${pad2(st.plateNo)} · ${st.name}`;
    this.el('proof-cap').innerHTML = `<b>${label}</b><br>Your print · edition of one`;
    this.el('perk-kicker').textContent = st.kind === 'boss'
      ? `${st.name} pulled · +1 ball · score ${fmt(G.run.score)}`
      : `Plate cleared · score ${fmt(G.run.score)}`;

    const offers = offerPerks();
    const wrap = this.el('tickets');
    wrap.innerHTML = '';
    this.picking = false;
    offers.forEach((p, i) => {
      const have = perk(p.id);
      const btn = document.createElement('button');
      btn.className = 'ticket';
      btn.dataset.perk = p.id;
      btn.dataset.ink = p.ink;
      btn.dataset.rarity = p.rarity;
      let stack = '';
      if (p.max > 1 && p.max < 9) {
        stack = '<span class="t-stack">' + Array.from({ length: p.max }, (_, j) => `<i class="${j < have ? 'f' : j === have ? 'n' : ''}"></i>`).join('') + '</span>';
      }
      const owned = ownedPairs(p);
      let pairs = '';
      if (p.pairs.length) {
        const names = (owned.length ? owned : p.pairs).slice(0, 2).map((q) => PERK_BY_ID[q].name);
        pairs = `<span class="t-pairs${owned.length ? ' on' : ''}"><i></i><span>Pairs with ${names.join(' & ')}</span></span>`;
      }
      let mark = '';
      if (p.rarity === 'signed') {
        const r = mulberry32([...p.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
        mark = `<span class="t-foot"><span class="t-ed">${1 + Math.floor(r() * 49)}/50</span>${signature(r)}</span>`;
      } else if (p.rarity === 'proof') {
        mark = '<span class="t-foot"><span class="t-ap">A/P</span></span>';
      }
      btn.innerHTML = `<span class="t-band"></span>` +
        `<span class="t-top"><span class="t-num">${pad2(i + 1)}</span><span class="t-rarity">${RARITY[p.rarity].label}</span>${stack}</span>` +
        `<canvas width="152" height="152"></canvas>` +
        `<span class="t-name">${p.name}</span>` +
        `<span class="t-desc">${p.desc}</span>` +
        pairs + mark;
      wrap.appendChild(btn);
      const c = btn.querySelector('canvas');
      const g = c.getContext('2d');
      g.scale(2, 2);
      drawPerkArt(g, p, 76);
    });
    this.show('s-perk');
  },

  pickPerk(id) {
    if (Wipe.active || G.phase !== 'perk' || this.picking) return;
    this.picking = true;
    const p = PERK_BY_ID[id];
    const ticket = this.el('tickets').querySelector(`[data-perk="${id}"]`);
    if (ownedPairs(p).length && ticket) {
      // completing a pair gets stamped
      ticket.classList.add('synergy');
      Sound.stamp();
      Sound.collect();
      setTimeout(() => choosePerk(id), 680);
    } else {
      Sound.uiGo();
      choosePerk(id);
    }
  },

  /* ---------- pause ---------- */
  showPause() {
    this.fillPause();
    this.show('s-pause');
  },

  fillPause() {
    const owned = this.el('owned');
    const ids = Object.keys(G.run ? G.run.perks : {});
    owned.innerHTML = ids.length
      ? ids.map((id) => {
          const p = PERK_BY_ID[id];
          const pair = ownedPairs(p).length ? ' data-pair="1"' : '';
          return `<span data-rarity="${p.rarity}"${pair}>${p.name}${G.run.perks[id] > 1 ? ' ×' + G.run.perks[id] : ''}</span>`;
        }).join('')
      : '';
  },

  /* ---------- end of run ---------- */
  showOver(won, isBest, prevBest) {
    const r = G.run;
    const title = won ? 'Edition complete' : 'Out of ink';
    const h = this.el('over-title');
    h.textContent = title;
    h.dataset.text = title;
    const best = Math.max(prevBest, r.score);
    this.el('over-stats').innerHTML = [
      ['Score', fmt(r.score), isBest && r.score > 0],
      [isBest && r.score > 0 ? 'New best' : 'Best', fmt(best), false],
      ['Plates printed', `${r.platesCleared}/${PLATES.length}`, false],
      ['Longest volley', String(r.bestVolley), false],
    ].map(([k, v, hl]) => `<div><dt>${k}</dt><dd class="${hl ? 'new' : ''}">${v}</dd></div>`).join('');
    const wrap = this.el('prints');
    wrap.innerHTML = '';
    if (!r.prints.length) {
      wrap.innerHTML = '<p class="none">No prints pulled this time. Clear a plate and its print is yours to keep.</p>';
    }
    r.prints.forEach((p) => {
      const fig = document.createElement('figure');
      const c = document.createElement('canvas');
      c.width = p.canvas.width;
      c.height = p.canvas.height;
      c.getContext('2d').drawImage(p.canvas, 0, 0);
      fig.appendChild(c);
      const cap = document.createElement('figcaption');
      cap.textContent = p.name;
      fig.appendChild(cap);
      wrap.appendChild(fig);
    });
    this.el('s-over').querySelector('[data-act="save"]').style.display = r.prints.length ? '' : 'none';
    const retry = this.el('retry-btn');
    const cp = r.checkpoint;
    const canRetry = !won && cp && cp.stage > 0;
    if (retry) {
      retry.style.display = canRetry ? '' : 'none';
      if (canRetry) {
        const stg = RUN_STAGES[cp.stage];
        retry.querySelector('.mi-label').textContent = stg.kind === 'boss'
          ? `Retry ${BOSS_NAMES[stg.boss]}`
          : `Retry Act ${roman(Math.floor(cp.stage / 4))}`;
      }
    }
    this.show('s-over');
  },
};

/* =========================================================
   Run control
   ========================================================= */
function refreshActive() {
  Input.gameActive = G.mode === 'run' && !G.paused && ['intro', 'play', 'lost', 'clear'].includes(G.phase);
  document.body.classList.toggle('playing', Input.gameActive);
}

function pauseGame() {
  if (G.mode !== 'run' || G.paused) return;
  G.paused = true;
  refreshActive();
  UI.showPause();
  if (Sound.ctx) Sound.music.gain.setTargetAtTime(Settings.music ? 0.14 : 0, Sound.ctx.currentTime, 0.1);
}

function resumeGame() {
  if (!G.paused) return;
  G.paused = false;
  UI.hideAll();
  refreshActive();
  Sound.ui();
  Sound.apply();
}

function togglePause() {
  if (Wipe.active) return;
  if (G.mode !== 'run') return;
  if (UI.cur === 's-settings' || UI.cur === 's-howto') return;
  if (!['intro', 'play', 'lost', 'clear'].includes(G.phase)) return;
  if (G.paused) resumeGame(); else pauseGame();
}

function autoPause() {
  if (G.mode === 'run' && !G.paused && ['intro', 'play', 'lost'].includes(G.phase) && !Wipe.active) pauseGame();
}

function toggleMute() {
  Sound.init();
  const on = !(Settings.sfx || Settings.music);
  Settings.sfx = on;
  Settings.music = on;
  Settings.save();
  Sound.apply();
  UI.refreshSettings();
  toast(on ? 'SOUND ON' : 'SOUND OFF');
}

function toTitle() {
  G.mode = 'title';
  G.phase = 'none';
  G.paused = false;
  G.run = null;
  G.stage = null;
  G.balls = [];
  FX.clear();
  refreshActive();
  const best = Store.get('best', 0);
  UI.el('title-best').innerHTML = best > 0 ? `Best <b>${fmt(best)}</b>` : '';
  UI.show('s-title');
  Title.layout();
  Title.reset();
  if (Sound.ctx) Music.start('title');
}

/* =========================================================
   Keep the prints — a poster of the whole run
   ========================================================= */
function savePrints() {
  const prints = G.run ? G.run.prints : [];
  if (!prints.length) return;
  Sound.uiGo();
  // hang the prints like a gallery wall: rows of equal height, widths as they come
  const RH = 340, pad = 70, gap = 40, cap = 46, head = 210, maxRow = 1640;
  const items = prints.map((p, i) => ({ p, i, w: Math.round(p.canvas.width * RH / p.canvas.height) }));
  const rows = [];
  let row = [], rw = 0;
  for (const it of items) {
    if (row.length && rw + gap + it.w > maxRow) { rows.push({ row, rw }); row = []; rw = 0; }
    rw += (row.length ? gap : 0) + it.w;
    row.push(it);
  }
  if (row.length) rows.push({ row, rw });
  const W = Math.max(980, pad * 2 + Math.max(...rows.map((r) => r.rw)));
  const H = head + rows.length * (RH + cap) + (rows.length - 1) * gap + pad;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'multiply';
  g.font = fDisplay(96);
  g.textBaseline = 'alphabetic';
  g.fillStyle = INK.b;
  g.fillText('MISPRINT', pad, pad + 84);
  g.fillStyle = INK.p;
  g.fillText('MISPRINT', pad + 4, pad + 87);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = INK.k;
  g.font = fMono(15, 600);
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  spaced(g, `AN EDITION OF ONE · SCORE ${fmt(G.run.score)} · ${date.toUpperCase()}`, pad + 4, pad + 124, 2.5);
  rows.forEach(({ row: items }, ri) => {
    let x = pad;
    const y = head + ri * (RH + cap + gap);
    for (const { p, i, w } of items) {
      g.drawImage(p.canvas, x, y, w, RH);
      g.strokeStyle = INK.k;
      g.lineWidth = 2;
      g.strokeRect(x, y, w, RH);
      g.fillStyle = INK.k;
      g.font = fMono(13, 600);
      spaced(g, `${pad2(i + 1)} — ${p.name.toUpperCase()}`, x, y + RH + 26, 2.2);
      x += w + gap;
    }
  });
  if (Grain.tile) {
    g.fillStyle = g.createPattern(Grain.tile, 'repeat');
    g.fillRect(0, 0, W, H);
  }
  c.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'misprint-edition.png';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }, 'image/png');
}

/* =========================================================
   Little diagrams for the how-to sheet and the tickets
   ========================================================= */
function stackRect(ctx, x, y, w, h, layers, step = 4) {
  const n = layers.length;
  const fw = w - step * (n - 1), fh = h - step * (n - 1);
  for (let i = 0; i < n; i++) {
    const d = n - 1 - i;
    const pl = Plates[layers[i]];
    const xx = x + d * step + pl.x, yy = y + d * step + pl.y;
    if (i > 0) { ctx.fillStyle = PAPER_HI; ctx.fillRect(xx, yy, fw + 1.5, fh + 1.5); }
    ctx.fillStyle = INK[layers[i]];
    ctx.fillRect(xx, yy, fw, fh);
  }
}

function miniBall(ctx, x, y, ink, r = 7) {
  ctx.fillStyle = INK[ink];
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  if (ink !== 'k') {
    ctx.strokeStyle = INK.k;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, r - 0.4, 0, TAU); ctx.stroke();
  }
}

function dashed(ctx, pts, col = INK.k) {
  ctx.save();
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.stroke();
  ctx.restore();
}

function drawRuleArt() {
  for (const c of document.querySelectorAll('.rule-art')) {
    const g = c.getContext('2d');
    c.width = 480;
    c.height = 300;
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.fillStyle = PAPER_HI;
    g.fillRect(0, 0, 240, 150);
    const kind = c.dataset.art;
    const roller = (x, y, w, film = 'k') => Paddle.draw.call({ x, y, w, sq: 0, press: 0, tilt: 0, roll: 0, film, smudge: 0, smudgeInk: 'b', flash: 0 }, g);
    if (kind === 'roll') {
      roller(120, 104, 92);
      miniBall(g, 120, 89, 'k');
      dashed(g, [126, 80, 176, 22]);
      g.strokeStyle = INK.k; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(170, 22); g.lineTo(176, 22); g.lineTo(176, 29); g.stroke();
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(150, 142); g.lineTo(186, 142); g.moveTo(180, 137); g.lineTo(186, 142); g.lineTo(180, 147); g.stroke();
      for (const x of [20, 66, 172, 218]) stackRect(g, x - 18, 16, 36, 16, ['y', 'b']);
    } else if (kind === 'smash') {
      stackRect(g, 92, 14, 56, 20, ['y', 'b', 'p']);
      stackRect(g, 92, 40, 56, 20, ['b', 'p']);
      g.fillStyle = INK.k;
      g.fillRect(40, 30, 40, 18);
      g.fillRect(160, 30, 40, 18);
      dashed(g, [120, 92, 120, 4], INK.p);
      roller(120, 118, 96);
      miniBall(g, 120, 102, 'k', 8);
      g.save();
      g.strokeStyle = INK.k;
      g.lineWidth = 1.5;
      g.setLineDash([2.5, 3]);
      g.beginPath(); g.arc(120, 102, 13, 0, TAU); g.stroke();
      g.restore();
      g.strokeStyle = INK.p;
      g.lineWidth = 2;
      g.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + 0.2 + (i / 6) * (Math.PI - 0.4);
        g.beginPath();
        g.moveTo(120 + Math.cos(a) * 20, 112 + Math.sin(a) * 9 + 6);
        g.lineTo(120 + Math.cos(a) * 32, 112 + Math.sin(a) * 15 + 6);
        g.stroke();
      }
    } else if (kind === 'bleed') {
      const map = [
        'ppbyy',
        'bppyb',
        'yypbb',
      ];
      map.forEach((row, r) => row.split('').forEach((ink, cc) => {
        const x = 42 + cc * 32, y = 14 + r * 22;
        const lay = ink === 'p' ? ['y', 'p'] : [ink];
        stackRect(g, x, y, 29, 19, lay, 3);
      }));
      // ripples spreading through the pink patch
      g.save();
      g.globalCompositeOperation = 'multiply';
      g.strokeStyle = INK.p;
      g.lineWidth = 2;
      for (const r of [10, 22, 36]) { g.beginPath(); g.arc(122, 60, r, 0, TAU); g.stroke(); }
      g.restore();
      miniBall(g, 112, 110, 'p', 8);
      dashed(g, [114, 100, 120, 70]);
      roller(112, 134, 80);
    } else if (kind === 'clear') {
      stackRect(g, 34, 26, 86, 42, ['b', 'y', 'p'], 7);
      g.fillStyle = INK.k;
      g.font = fMono(10, 600);
      spaced(g, '3 LAYERS', 34, 92, 1.5);
      g.fillRect(140, 26, 70, 42);
      g.strokeStyle = PAPER;
      g.lineWidth = 1;
      g.strokeRect(145.5, 31.5, 59, 31);
      g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(170, 26); g.lineTo(178, 44); g.lineTo(168, 54); g.lineTo(176, 68); g.stroke();
      g.fillStyle = INK.k;
      spaced(g, 'SMASH ONLY', 140, 92, 1.5);
      for (let i = 0; i < 12; i++) {
        const x = 28 + i * 16;
        g.fillStyle = i < 5 ? INK.k : 'transparent';
        g.strokeStyle = INK.k;
        g.lineWidth = 1.2;
        g.save();
        g.translate(x + 4, 124);
        if (i === 3 || i === 7 || i === 11) g.rotate(Math.PI / 4);
        if (i < 5) g.fillRect(-4, -4, 8, 8);
        if (i === 5) { g.fillStyle = INK.p; g.fillRect(-4, -4, 8, 8); }
        g.strokeRect(-4, -4, 8, 8);
        g.restore();
      }
    }
    if (Grain.tile) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = g.createPattern(Grain.tile, 'repeat');
      g.fillRect(0, 0, c.width, c.height);
    }
  }
}

/** A quick pen signature, seeded so each technique always signs the same way. */
function signature(r) {
  let d = `M4 ${18 + r() * 6}`;
  let x = 4;
  for (let i = 0; i < 5; i++) {
    const nx = x + 14 + r() * 10;
    d += ` C ${x + 4 + r() * 6} ${2 + r() * 8}, ${nx - 8 + r() * 4} ${24 + r() * 6}, ${nx} ${10 + r() * 12}`;
    x = nx;
  }
  d += ` M ${8 + r() * 10} ${27 + r() * 3} L ${x - r() * 18} ${24 + r() * 4}`;
  return `<svg class="t-sig" viewBox="0 0 ${Math.ceil(x + 6)} 32" aria-hidden="true"><path d="${d}"/></svg>`;
}

function drawPerkArt(g, p, s) {
  g.clearRect(0, 0, s, s);
  const pl = Plates[p.ink];
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = INK[p.ink === 'k' ? 'y' : p.ink];
  halftoneDisc(g, s / 2 + 3 + pl.x, s / 2 + 3 + pl.y, s * 0.46, 5, 0.3, (d) => 1.05 - d * 0.7);
  g.restore();
  drawIcon(g, p.icon, s / 2, s / 2, s * 0.62, INK.k);
}
