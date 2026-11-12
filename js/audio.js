'use strict';
/* =========================================================
   MISPRINT — sound
   Everything is synthesised with WebAudio. Each ink has its
   own instrument: yellow rings like a bell, blue knocks like
   a marimba, pink plucks. Peels climb a pentatonic scale as
   the volley grows, so a Bleed plays as an arpeggio.
   ========================================================= */

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

const Sound = {
  ctx: null,
  out: null,
  sfx: null,
  music: null,
  verb: null,
  noise: null,
  scale: [0, 2, 4, 7, 9],        // major pentatonic; bosses swap to minor
  root: 62,                       // D4
  last: Object.create(null),
  quiet: false,                   // silences effects (not music) — used by the title demo

  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let c;
    try { c = new AC(); } catch (e) { return; }
    this.ctx = c;

    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    this.out = c.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(comp);
    comp.connect(c.destination);

    this.sfx = c.createGain();
    this.sfx.connect(this.out);
    this.music = c.createGain();
    this.music.connect(this.out);

    // a short, dark echo gives bells and plucks some room
    const dl = c.createDelay(1);
    dl.delayTime.value = 0.19;
    const fb = c.createGain();
    fb.gain.value = 0.3;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    this.verb = c.createGain();
    this.verb.gain.value = 0.5;
    this.verb.connect(dl);
    dl.connect(lp);
    lp.connect(fb);
    fb.connect(dl);
    const wet = c.createGain();
    wet.gain.value = 0.35;
    lp.connect(wet);
    wet.connect(this.out);

    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    this.noise = buf;

    this.apply();
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(Settings.sfx ? 0.85 : 0, t, 0.02);
    this.music.gain.setTargetAtTime(Settings.music ? 0.42 : 0, t, 0.08);
  },

  limit(name, gap) {
    const now = performance.now();
    const l = this.last[name];
    if (l !== undefined && now - l < gap * 1000) return false;
    this.last[name] = now;
    return true;
  },

  panX(x) {
    if (x === undefined) return 0;
    return clamp((x - FIELD.cx) / (FIELD.w / 2), -1, 1) * 0.55;
  },

  note(step, octShift = 0) {
    const n = this.scale.length;
    const oct = Math.floor(step / n);
    const deg = ((step % n) + n) % n;
    return midiHz(this.root + (oct + octShift) * 12 + this.scale[deg]);
  },

  /* ---------- primitives ---------- */
  _end(env, o, t0) {
    const c = this.ctx;
    let node = env;
    if (o.pan) {
      const p = c.createStereoPanner ? c.createStereoPanner() : null;
      if (p) { p.pan.value = o.pan; env.connect(p); node = p; }
    }
    node.connect(o.bus || this.sfx);
    if (o.verb) {
      const s = c.createGain();
      s.gain.value = o.verb;
      node.connect(s);
      s.connect(this.verb);
    }
  },

  _env(o, t0) {
    const c = this.ctx;
    const a = o.a ?? 0.004;
    const sus = o.sus ?? 0;
    const d = o.d ?? 0.2;
    const g = Math.max(0.0002, o.g ?? 0.2);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(g, t0 + a);
    if (sus > 0) env.gain.setValueAtTime(g, t0 + a + sus);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + a + sus + d);
    return { env, end: t0 + a + sus + d + 0.04 };
  },

  tone(o) {
    const c = this.ctx;
    if (!c) return;
    if (this.quiet && (!o.bus || o.bus === this.sfx)) return;
    const t0 = o.at ?? c.currentTime + (o.t || 0);
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + (o.glide ?? (o.a ?? 0.004) + (o.d ?? 0.2)));
    if (o.det) osc.detune.setValueAtTime(o.det, t0);
    const { env, end } = this._env(o, t0);
    let n = osc;
    if (o.lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.lp, t0);
      if (o.lp2) f.frequency.exponentialRampToValueAtTime(o.lp2, end);
      f.Q.value = o.q ?? 0.7;
      n.connect(f);
      n = f;
    }
    n.connect(env);
    this._end(env, o, t0);
    osc.start(t0);
    osc.stop(end);
  },

  hiss(o) {
    const c = this.ctx;
    if (!c) return;
    if (this.quiet && (!o.bus || o.bus === this.sfx)) return;
    const t0 = o.at ?? c.currentTime + (o.t || 0);
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = o.rate || 1;
    const f = c.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f || 1200, t0);
    const { env, end } = this._env(o, t0);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, end);
    f.Q.value = o.q ?? 1;
    src.connect(f);
    f.connect(env);
    this._end(env, o, t0);
    src.start(t0, Math.random() * 0.9);
    src.stop(end);
  },

  /* ---------- effects ---------- */
  paddle(x) {
    const pan = this.panX(x);
    this.tone({ f: 230, f2: 92, d: 0.12, g: 0.34, pan });
    this.tone({ f: 460, type: 'triangle', d: 0.035, g: 0.05, pan });
    this.hiss({ f: 1500, q: 1.2, d: 0.03, g: 0.1, pan });
  },

  wall(x) {
    if (!this.limit('wall', 0.035)) return;
    const pan = this.panX(x);
    this.hiss({ type: 'highpass', f: 2600, d: 0.022, g: 0.06, pan });
    this.tone({ f: 1180, type: 'triangle', d: 0.026, g: 0.022, pan });
  },

  peel(ink, step, x) {
    if (!this.limit('peel', 0.014)) return;
    const f = this.note(Math.min(step, 13));
    const pan = this.panX(x);
    this.hiss({ f: 2400 + rand(-300, 400), q: 0.8, d: 0.045, g: 0.08, pan });
    if (ink === 'y') {
      this.tone({ f, d: 0.6, g: 0.11, pan, verb: 0.55 });
      this.tone({ f: f * 2.76, d: 0.22, g: 0.03, pan });
      this.tone({ f: f * 5.4, d: 0.07, g: 0.012, pan });
    } else if (ink === 'b') {
      this.tone({ f, d: 0.3, g: 0.19, pan, verb: 0.25 });
      this.tone({ f: f * 3.99, d: 0.045, g: 0.05, pan });
    } else {
      this.tone({ f, type: 'triangle', d: 0.26, g: 0.15, pan, lp: 3400, lp2: 500, verb: 0.3 });
      this.tone({ f: f * 2, type: 'square', d: 0.05, g: 0.016, pan, lp: 2400 });
    }
  },

  keyHit(x) {
    if (!this.limit('key', 0.04)) return;
    const pan = this.panX(x);
    this.tone({ f: 1760, type: 'square', d: 0.03, g: 0.025, lp: 5200, pan });
    this.tone({ f: 2637, d: 0.14, g: 0.035, pan, verb: 0.3 });
    this.tone({ f: 3951, d: 0.06, g: 0.016, pan });
    this.hiss({ type: 'highpass', f: 5000, d: 0.02, g: 0.045, pan });
  },

  keyBreak(x) {
    const pan = this.panX(x);
    this.hiss({ type: 'lowpass', f: 3000, f2: 300, d: 0.22, g: 0.3, pan });
    this.tone({ f: 180, f2: 60, d: 0.2, g: 0.3, pan });
    this.tone({ f: 2093, d: 0.2, g: 0.035, pan, verb: 0.4 });
  },

  smash(x) {
    const pan = this.panX(x);
    this.tone({ f: 155, f2: 40, d: 0.34, g: 0.55, pan });
    this.hiss({ type: 'lowpass', f: 3600, f2: 160, d: 0.3, g: 0.32, pan });
    this.tone({ f: 82, type: 'square', d: 0.12, g: 0.06, lp: 700, pan });
    this.hiss({ f: 5200, q: 0.7, d: 0.05, g: 0.1, pan });
  },

  whiff() {
    if (!this.limit('whiff', 0.1)) return;
    this.hiss({ f: 900, f2: 1800, q: 0.8, a: 0.01, d: 0.07, g: 0.035 });
  },

  bleed(n, x) {
    const pan = this.panX(x);
    this.hiss({ f: 420, f2: 4400, q: 1.3, a: 0.02, d: 0.26 + Math.min(n, 20) * 0.012, g: 0.07, pan });
    this.tone({ f: this.note(-5), type: 'triangle', d: 0.45, g: 0.11, lp: 900, pan });
  },

  bomb(x) {
    const pan = this.panX(x);
    this.tone({ f: 120, f2: 30, d: 0.55, g: 0.6, pan });
    this.hiss({ type: 'lowpass', f: 4200, f2: 110, d: 0.55, g: 0.45, pan });
    this.hiss({ f: 900, q: 0.6, d: 0.12, g: 0.18, pan });
  },

  well(x) {
    if (!this.limit('well', 0.08)) return;
    const pan = this.panX(x);
    this.tone({ f: 330, f2: 760, glide: 0.1, d: 0.13, g: 0.12, pan });
    this.tone({ f: 990, type: 'triangle', t: 0.03, d: 0.08, g: 0.03, pan });
  },

  volley(v) {
    const top = Math.min(4 + Math.floor(v / 3), 13);
    this.tone({ f: this.note(top - 2), type: 'triangle', d: 0.16, g: 0.1, verb: 0.4 });
    this.tone({ f: this.note(top), type: 'triangle', t: 0.06, d: 0.3, g: 0.11, verb: 0.5 });
    this.tone({ f: this.note(top + 5), t: 0.12, d: 0.5, g: 0.05, verb: 0.6 });
    this.hiss({ type: 'highpass', f: 6000, t: 0.02, d: 0.06, g: 0.04 });
  },

  collect() {
    this.tone({ f: this.note(7), type: 'triangle', d: 0.18, g: 0.12, verb: 0.4 });
    this.tone({ f: this.note(9), type: 'triangle', t: 0.07, d: 0.26, g: 0.12, verb: 0.4 });
    this.tone({ f: this.note(12), t: 0.14, d: 0.4, g: 0.07, verb: 0.5 });
  },

  lose() {
    this.tone({ f: 2200, type: 'square', d: 0.025, g: 0.04 });
    this.hiss({ type: 'highpass', f: 3200, d: 0.1, g: 0.09 });
    this.tone({ f: 480, f2: 70, type: 'sawtooth', t: 0.05, d: 0.7, g: 0.12, lp: 1600, lp2: 180 });
  },

  stamp() {
    this.tone({ f: 115, f2: 46, d: 0.24, g: 0.6 });
    this.hiss({ type: 'lowpass', f: 1000, d: 0.09, g: 0.32 });
    this.hiss({ f: 3000, q: 0.6, d: 0.03, g: 0.08 });
  },

  serve(x) {
    const pan = this.panX(x);
    this.tone({ f: this.note(4), type: 'triangle', d: 0.1, g: 0.08, pan });
    this.hiss({ f: 3000, q: 1, d: 0.025, g: 0.05, pan });
  },

  clear() {
    const steps = [0, 2, 4, 5, 7, 9, 10, 12];
    steps.forEach((s, i) => this.tone({ f: this.note(s), t: i * 0.065, d: 0.7, g: 0.08, verb: 0.6 }));
  },

  smudge(x) {
    const pan = this.panX(x);
    this.hiss({ type: 'lowpass', f: 1100, f2: 180, d: 0.2, g: 0.26, pan });
    this.tone({ f: 190, f2: 80, d: 0.16, g: 0.2, pan });
  },

  drip(x) {
    if (!this.limit('drip', 0.06)) return;
    this.tone({ f: 980, f2: 420, d: 0.08, g: 0.045, pan: this.panX(x) });
  },

  bossHit(x, big) {
    const pan = this.panX(x);
    this.tone({ f: big ? 220 : 300, f2: big ? 70 : 130, type: 'square', d: big ? 0.24 : 0.12, g: big ? 0.11 : 0.07, lp: 1500, pan });
    this.hiss({ type: 'lowpass', f: big ? 2400 : 1600, f2: 200, d: big ? 0.2 : 0.08, g: big ? 0.26 : 0.14, pan });
    if (big) this.tone({ f: this.note(9), t: 0.02, d: 0.4, g: 0.07, verb: 0.5, pan });
  },

  soak(x) {
    if (!this.limit('soak', 0.05)) return;
    this.tone({ f: 260, f2: 520, glide: 0.06, d: 0.09, g: 0.09, type: 'triangle', pan: this.panX(x) });
  },

  bossDie() {
    this.tone({ f: 90, f2: 26, d: 1.4, g: 0.7 });
    this.hiss({ type: 'lowpass', f: 5000, f2: 80, d: 1.3, g: 0.5 });
    [0, 4, 7, 9, 12, 14].forEach((s, i) => this.tone({ f: this.note(s), t: 0.25 + i * 0.08, d: 0.9, g: 0.08, verb: 0.6 }));
  },

  slam() {
    this.tone({ f: 80, f2: 28, d: 0.6, g: 0.75 });
    this.hiss({ type: 'lowpass', f: 900, f2: 90, d: 0.4, g: 0.55 });
    this.tone({ f: 1320, type: 'square', d: 0.04, g: 0.03, lp: 3000 });
  },

  creak() {
    this.tone({ f: 82, f2: 104, type: 'sawtooth', a: 0.08, d: 0.5, g: 0.05, lp: 700 });
    this.hiss({ f: 600, q: 6, a: 0.05, d: 0.4, g: 0.04 });
  },

  moth(x) {
    const pan = this.panX(x);
    this.tone({ f: this.note(12), d: 0.25, g: 0.08, verb: 0.5, pan });
    this.tone({ f: this.note(14), t: 0.06, d: 0.3, g: 0.07, verb: 0.5, pan });
  },

  ui() {
    this.hiss({ type: 'highpass', f: 4200, d: 0.014, g: 0.05 });
  },

  uiGo() {
    this.tone({ f: this.note(5), type: 'triangle', d: 0.14, g: 0.09, verb: 0.3 });
    this.hiss({ type: 'highpass', f: 3800, d: 0.02, g: 0.05 });
  },
};

/* =========================================================
   Music — a small step sequencer. A soft kick and the clack
   of a press on the backbeat; hats and a music-box sparkle
   come in as play heats up.
   ========================================================= */
const Music = {
  on: false,
  name: null,
  step: 0,
  next: 0,
  timer: 0,
  energy: 0,          // 0 calm · 1 playing · 2 hot
  heat: 0,            // decays; game pushes it up

  TRACKS: {
    title: {
      bpm: 78, scale: [0, 2, 4, 7, 9], drums: 0,
      bars: [
        { pad: [62, 66, 69, 76], bass: 50 },
        { pad: [59, 62, 66, 69], bass: 47 },
        { pad: [55, 59, 62, 66], bass: 43 },
        { pad: [57, 61, 64, 66], bass: 45 },
      ],
      bassSteps: [0, 10],
    },
    plate: {
      bpm: 100, scale: [0, 2, 4, 7, 9], drums: 1,
      bars: [
        { pad: [62, 66, 69, 76], bass: 50 },
        { pad: [59, 62, 66, 69], bass: 47 },
        { pad: [55, 59, 62, 66], bass: 43 },
        { pad: [57, 61, 64, 66], bass: 45 },
      ],
      bassSteps: [0, 3, 6, 8, 12, 14],
      kick: [0, 8],
      clack: [4, 12],
    },
    boss: {
      bpm: 116, scale: [0, 3, 5, 7, 10], drums: 2,
      bars: [
        { pad: [62, 65, 69, 76], bass: 50 },
        { pad: [58, 62, 65, 69], bass: 46 },
        { pad: [55, 58, 62, 65], bass: 43 },
        { pad: [57, 61, 64, 67], bass: 45 },
      ],
      bassSteps: [0, 2, 4, 6, 8, 10, 12, 14],
      kick: [0, 4, 8, 12],
      clack: [4, 12],
    },
  },

  start(name) {
    if (!Sound.ctx) return;
    const tr = this.TRACKS[name];
    if (!tr) return;
    Sound.scale = tr.scale;
    if (this.on && this.name === name) return;
    this.name = name;
    this.on = true;
    this.step = 0;
    this.next = Sound.ctx.currentTime + 0.1;
    if (!this.timer) this.timer = setInterval(() => this.tick(), 25);
  },

  stop() {
    this.on = false;
    this.name = null;
  },

  push(amount) {
    this.heat = Math.min(1, this.heat + amount);
  },

  tick() {
    if (!this.on || !Sound.ctx || Sound.ctx.state !== 'running') return;
    const tr = this.TRACKS[this.name];
    const spb = 60 / tr.bpm / 4;
    const now = Sound.ctx.currentTime;
    if (this.next < now - 0.2) this.next = now + 0.05;   // fell behind (tab was hidden)
    this.heat = Math.max(0, this.heat - 0.004);
    while (this.next < now + 0.14) {
      this.play(tr, this.step, this.next, spb);
      this.next += spb;
      this.step++;
    }
  },

  play(tr, step, at, spb) {
    const s16 = step % 16;
    const bar = tr.bars[Math.floor(step / 16) % tr.bars.length];
    const bus = Sound.music;
    const hot = this.energy + this.heat * 1.4;

    if (s16 === 0) {
      const dur = spb * 16;
      for (const m of bar.pad) {
        Sound.tone({ at, f: midiHz(m), type: 'triangle', a: 0.35, sus: dur * 0.55, d: dur * 0.6, g: 0.022, det: -7, lp: 1300, bus });
        Sound.tone({ at, f: midiHz(m), type: 'triangle', a: 0.35, sus: dur * 0.55, d: dur * 0.6, g: 0.022, det: 7, lp: 1300, bus });
      }
    }

    if (tr.bassSteps.includes(s16)) {
      let m = bar.bass;
      if (tr.drums === 2 && (s16 / 2) % 2 === 1) m += 12;
      if (tr.drums === 1 && s16 === 14) m += 7;
      Sound.tone({ at, f: midiHz(m), type: 'triangle', a: 0.006, d: tr.drums ? 0.22 : 0.9, g: tr.drums ? 0.2 : 0.12, lp: 900, bus });
      Sound.tone({ at, f: midiHz(m - 12), a: 0.006, d: tr.drums ? 0.18 : 0.8, g: 0.12, bus });
    }

    if (!tr.drums) {
      // the title gets an occasional, gently random bell
      if (s16 % 4 === 2 && Math.random() < 0.28) {
        const st = randInt(5, 12);
        Sound.tone({ at, f: Sound.note(st), d: 0.9, g: 0.03, bus, verb: 0.5 });
      }
      return;
    }

    if (tr.kick.includes(s16)) {
      Sound.tone({ at, f: 128, f2: 44, glide: 0.09, d: 0.22, g: 0.42, bus });
    }
    if (tr.clack.includes(s16)) {
      Sound.hiss({ at, f: 1900, q: 2.6, d: 0.05, g: 0.1, bus });
      Sound.tone({ at, f: 262, type: 'square', d: 0.02, g: 0.016, lp: 2000, bus });
    }
    if ((hot >= 1 || tr.drums === 2) && s16 % 2 === 0 && s16 % 4 !== 0) {
      Sound.hiss({ at, type: 'highpass', f: 7600, d: 0.024, g: 0.04, bus });
    }
    if (hot >= 1.7 && s16 % 2 === 1) {
      Sound.hiss({ at, type: 'highpass', f: 9000, d: 0.012, g: 0.018, bus });
    }
    if (hot >= 1.5 && s16 % 2 === 0) {
      const tones = bar.pad;
      const m = tones[(step / 2) % tones.length | 0] + 24;
      Sound.tone({ at, f: midiHz(m), d: 0.3, g: 0.016, bus, verb: 0.4 });
    }
  },
};
