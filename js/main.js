'use strict';
/* =========================================================
   MISPRINT — boot & loop
   ========================================================= */

const Main = {
  last: 0,
  started: false,

  boot() {
    Gfx.init();
    Decal.init();
    Backdrop.init();
    Input.init();
    UI.init();
    Title.init();

    const go = () => {
      if (this.started) return;
      this.started = true;
      StampCache.clear();
      Title.layout();
      toTitle();
      requestAnimationFrame((t) => { this.last = t; this.frame(t); });
    };
    if (document.fonts && document.fonts.load) {
      Promise.race([
        Promise.all([
          document.fonts.load(fDisplay(40)),
          document.fonts.load(fMono(14, 500)),
          document.fonts.load(fMono(14, 600)),
          document.fonts.load(fMono(14, 700)),
        ]),
        new Promise((r) => setTimeout(r, 2500)),
      ]).then(go, go);
    } else {
      go();
    }
    // fonts that arrive late: refresh anything measured with a fallback
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { StampCache.clear(); Title.layout(); });
    }

    const unlock = () => {
      Sound.init();
      Sound.resume();
      if (G.mode === 'title') Music.start('title');
    };
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
  },

  frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.input();
    Plates.update(dt);
    if (G.mode === 'title') Title.update(dt);
    else if (G.stage) updateRun(dt);
    if (G.toast) {
      G.toast.t += dt;
      if (G.toast.t > G.toast.life) G.toast = null;
    }
    this.render();
    Wipe.update(dt);
    requestAnimationFrame((t) => this.frame(t));
  },

  render() {
    const ctx = Gfx.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, Gfx.cv.width, Gfx.cv.height);
    if (G.mode === 'title') Title.draw(ctx);
    else if (G.stage) renderRun(ctx);
  },

  input() {
    for (const ev of Input.take()) {
      if (ev === 'press' || ev === 'tap') {
        if (G.mode === 'run') gamePress();
        else if (G.mode === 'title' && ev === 'press' && !UI.cur?.match(/howto|settings/)) Title.poke();
      } else if (ev === 'pause') {
        togglePause();
      } else if (ev === 'mute') {
        toggleMute();
      } else if (ev === 'blur') {
        autoPause();
      }
    }
  },
};

Main.boot();
