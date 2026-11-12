'use strict';
/* =========================================================
   MISPRINT — plates
   Each plate is a small poster. `top` is the picture you see
   (p pink · b blue · y yellow · K black block · * bomb).
   `under(r, c, top)` prints the hidden layers beneath each
   block, bottom → top. Peel the picture and a different
   pattern is waiting underneath.
   Wells are pass-through ink pots: [col, row, ink] in grid
   units (col 6.5 is the centre line).
   ========================================================= */

/* ---------- backdrops: pale halftone posters behind each plate ----------
   Painted once per plate in field-local units (x 0..640, y 0..868),
   then printed very lightly under play — and into your print. */
const BD = {
  target(g) {
    g.fillStyle = INK.b;
    halftoneField(g, 60, 320, 520, 520, 13, 0.26, (x, y) => {
      const d = Math.hypot(x - 320, y - 570);
      if (d > 236) return 0;
      return Math.floor(d / 42) % 2 === 0 ? 0.8 : 0.16;
    });
    g.strokeStyle = INK.b;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(320, 300); g.lineTo(320, 840);
    g.moveTo(50, 570); g.lineTo(590, 570);
    g.stroke();
  },

  water(g) {
    g.fillStyle = INK.b;
    halftoneField(g, 0, 300, 640, 568, 12, 0.2, (x, y) => {
      const v = 0.5 + 0.5 * Math.sin((y + 18 * Math.sin(x * 0.018 + y * 0.004)) * 0.065);
      return smooth(310, 470, y) * (0.18 + 0.82 * v * v);
    });
    g.fillStyle = INK.y;
    for (const [x, y, r] of [[96, 360, 26], [70, 290, 16], [118, 250, 11]]) {
      halftoneField(g, x - r, y - r, r * 2, r * 2, 6, 0.3, (px, py) => (Math.hypot(px - x, py - y) < r ? 0.9 : 0));
    }
  },

  sun(g) {
    g.fillStyle = INK.y;
    halftoneField(g, 0, 0, 640, 620, 15, 0.26, (x, y) => {
      const d = Math.hypot(x - 320, y - 290) / 300;
      return d > 1 ? 0 : 1.05 - d * d * 0.78;
    });
    g.fillStyle = INK.p;
    halftoneField(g, 0, 640, 640, 228, 11, 0.4, (x, y) => smooth(700 + 22 * Math.sin(x * 0.03), 820, y) * 0.95);
  },

  space(g) {
    const px = 92, py = 700, R = 210;
    g.fillStyle = INK.p;
    halftoneField(g, 0, 470, 330, 398, 12, 0.3, (x, y) => {
      const dx = (x - px) / R, dy = (y - py) / R;
      if (dx * dx + dy * dy > 1) return 0;
      return clamp(0.28 + 0.75 * (-dx * 0.45 + dy * 0.75 + 0.35), 0.15, 1);
    });
    g.fillStyle = INK.y;
    halftoneField(g, 0, 520, 520, 330, 7, 0.1, (x, y) => {
      const a = -0.32, ca = Math.cos(a), sa = Math.sin(a);
      const ux = (x - px) * ca - (y - py) * sa, uy = (x - px) * sa + (y - py) * ca;
      const e = Math.sqrt((ux / 300) ** 2 + (uy / 66) ** 2);
      const front = uy > 0 || (x - px) ** 2 + (y - py) ** 2 > R * R;
      return Math.abs(e - 1) < 0.07 && front ? 0.95 : 0;
    });
    const r = mulberry32(42);
    for (let i = 0; i < 46; i++) {
      const x = r() * 640, y = 300 + r() * 360, s = 1.4 + r() * r() * 3.6;
      g.fillStyle = r() < 0.7 ? INK.y : INK.b;
      g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill();
    }
  },

  waves(g) {
    g.fillStyle = INK.b;
    halftoneField(g, 0, 380, 640, 488, 12, 0.18, (x, y) => {
      const v = Math.sin((y + 24 * Math.sin(x * 0.015 + y * 0.012)) * 0.075);
      return smooth(390, 520, y) * (v > 0.15 ? 0.8 : 0.16);
    });
    g.fillStyle = INK.y;
    halftoneField(g, 300, 0, 340, 380, 12, 0.26, (x, y) => {
      const dx = x - 560, dy = y - 58, d = Math.hypot(dx, dy);
      if (d < 92 || d > 400) return 0;
      const ray = Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 9)) % 2;
      return ray ? 0.9 * (1 - d / 400) + 0.1 : 0;
    });
  },

  moon(g) {
    g.fillStyle = INK.y;
    const craters = [[230, 160, 46], [400, 330, 34], [300, 360, 22], [420, 150, 26]];
    halftoneField(g, 0, 0, 640, 560, 14, 0.26, (x, y) => {
      const d = Math.hypot(x - 320, y - 230) / 292;
      if (d > 1) return 0;
      let v = 1 - d * d * d * 0.55;
      for (const [cx, cy, cr] of craters) if (Math.hypot(x - cx, y - cy) < cr) v *= 0.45;
      return v;
    });
    g.fillStyle = INK.b;
    halftoneField(g, 0, 560, 640, 308, 11, 0.4, (x, y) => smooth(600, 850, y) * 0.85);
  },

  sunset(g) {
    g.fillStyle = INK.p;
    halftoneField(g, 0, 0, 640, 330, 12, 0.26, (x, y) => 0.15 + 0.85 * smooth(10, 280, y));
    g.fillStyle = INK.y;
    halftoneField(g, 0, 0, 640, 330, 12, 1.31, (x, y) => 0.9 * smooth(320, 90, y) * smooth(0, 120, y));
    g.fillStyle = INK.b;
    halftoneField(g, 0, 540, 640, 328, 10, 0.12, (x, y) => {
      const v = 0.5 + 0.5 * Math.sin(y * 0.16 + Math.sin(x * 0.04) * 2.2);
      return smooth(540, 640, y) * (0.2 + 0.7 * v);
    });
  },

  garden(g) {
    const flower = (cx, cy, rad, ink) => {
      g.fillStyle = INK[ink];
      halftoneField(g, cx - rad * 1.6, cy - rad * 1.6, rad * 3.2, rad * 3.2, 9, 0.3, (x, y) => {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          if (Math.hypot(x - cx - Math.cos(a) * rad * 0.9, y - cy - Math.sin(a) * rad * 0.9) < rad * 0.6) return 0.85;
        }
        return 0;
      });
      g.fillStyle = INK.y;
      halftoneField(g, cx - rad * 0.5, cy - rad * 0.5, rad, rad, 6, 0.3, (x, y) => (Math.hypot(x - cx, y - cy) < rad * 0.42 ? 1 : 0));
    };
    g.strokeStyle = INK.b;
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath();
    for (const [x, y] of [[112, 640], [520, 600], [330, 720]]) { g.moveTo(x, y); g.quadraticCurveTo(x + 20, y + 120, x - 6, 868); }
    g.stroke();
    flower(112, 640, 70, 'p');
    flower(520, 600, 58, 'y');
    flower(330, 720, 48, 'p');
  },

  rings(g) {
    g.fillStyle = INK.p;
    halftoneField(g, 0, 0, 640, 868, 12, 0.26, (x, y) => {
      const d = Math.hypot(x - 320, y - 180);
      return (0.5 + 0.5 * Math.sin(d * 0.085)) * smooth(980, 160, d) * 0.95;
    });
  },
};

const PLATES = [
  {
    name: 'Test Print',
    backdrop: BD.target,
    top: [
      'ppppppppppppp',
      'ppppppppppppp',
      'yyyyyyyyyyyyy',
      'yyyyyyyyyyyyy',
      'bbbbbbbbbbbbb',
      'bbbbbbbbbbbbb',
    ],
    under: (r, c) => (r < 2 ? '' : r < 4 ? (c % 2 ? 'p' : 'b') : (c % 2 ? 'p' : 'y')),
    wells: [],
    hints: true,
  },
  {
    name: 'Fish',
    backdrop: BD.water,
    top: [
      '.....yyy.....',
      '...bbbbbbb...',
      '.bbbbbbbbbb.y',
      'bbKbbbbbbbbyy',
      'pbbbbbbbbbbyy',
      '.bbbbbbbbbb.y',
      '...bbbbbbb...',
      '.....yy......',
    ],
    under: (r, c, t) => {
      if (t === 'b') return ((r + c) % 4) < 2 ? 'p' : 'y';
      if (t === 'y') return r === 0 || r === 7 ? 'b' : 'p';
      return '';
    },
    wells: [[2, 17, 'p'], [6.5, 18.6, 'y'], [11, 17, 'b']],
  },
  {
    name: 'Tulip',
    backdrop: BD.sun,
    top: [
      '..p...p...p..',
      '..pp.ppp.pp..',
      '..ppppppppp..',
      '..pp*ppp*pp..',
      '...ppppppp...',
      '....ppppp....',
      '......b......',
      '.bb...b...bb.',
      '..bbb.b.bbb..',
      '....bbbbb....',
    ],
    under: (r, c, t) => {
      if (t === 'p') return c % 3 === 0 ? 'b' : 'y';
      if (t === 'b') return 'y';
      return '';
    },
    wells: [[2.5, 16.8, 'y'], [10.5, 16.8, 'p']],
  },
  {
    name: 'Rocket',
    backdrop: BD.space,
    top: [
      '.y....p......',
      '.....ppp...y.',
      '.....bbb.....',
      '....bbbbb....',
      'y...bbKbb....',
      '....bbbbb...y',
      '....bbbbb....',
      '...KbbbbbK...',
      '..KKbbbbbKK..',
      '..K.pyyyp.K..',
      '.....pyp.....',
      '......y......',
    ],
    under: (r, c, t) => {
      if (t === 'b') return (c % 2 ? 'y' : 'p') + (r % 2 ? 'p' : 'y');
      if (t === 'p' && r <= 1) return 'y';
      if (r >= 9 && t === 'p') return 'y';
      if (r >= 9 && t === 'y') return 'p';
      return '';
    },
    wells: [[1.5, 16.5, 'p'], [11.5, 16.5, 'y']],
  },
  {
    name: 'Tide',
    backdrop: BD.waves,
    top: [
      '..........yy.',
      '.....K...yyyy',
      '....pK....yy.',
      '...ppKy......',
      '..pppKyy.....',
      '.ppppKyyy....',
      '.....K.......',
      '.KKKKKKKKK...',
      '..ppppppp....',
      '.b.bbb.bbb.b.',
      '.bbbbbbbbbbb.',
      '..bbb.bbb.bb.',
    ],
    under: (r, c, t) => {
      if (r >= 9) return r === 10 ? 'p' : 'y';
      if (r === 8) return 'b';
      if (t === 'p') return 'y';
      if (t === 'y') return r <= 2 ? 'p' : 'b';
      return '';
    },
    slide: [
      { rows: [9, 11], amp: 22, speed: 1.1, phase: 0 },
      { rows: [10], amp: 22, speed: 1.1, phase: Math.PI },
    ],
    wells: [[3, 17.2, 'y'], [10, 17.8, 'p']],
  },
  {
    name: 'Cat',
    backdrop: BD.moon,
    top: [
      '.p.........p.',
      '.yp.......py.',
      '.yyyyyyyyyyy.',
      '.yyyyyyyyyyy.',
      '.yybbyyybbyy.',
      '.yyKbyyyKbyy.',
      'p.yyyypyyyy.p',
      '..yyyyyyyyy..',
      'p..yyyyyyy..p',
      '.....yyy.....',
    ],
    under: (r, c, t) => {
      if (t === 'y') {
        // tabby: short broken stripes, not long bleedable runs
        const stripe = ((c + (r >> 1)) % 3 === 0) ? 'b' : ((c + r) % 2 ? 'p' : 'b');
        return (r >= 2 && r <= 5 ? (c % 2 ? 'b' : 'p') : '') + stripe;
      }
      if (t === 'b') return 'y';
      if (t === 'p') return r <= 1 ? 'y' : '';
      return '';
    },
    wells: [[6.5, 17.5, 'p'], [1.5, 15, 'b'], [11.5, 15, 'b']],
  },
  {
    name: 'Peaks',
    backdrop: BD.sunset,
    top: [
      '.........yy..',
      '........yyyy.',
      '.........yy..',
      '....K........',
      '...KbK.......',
      '..KbbbK..K...',
      '.Kbb*bbK.KbK.',
      'KbbbbbbbKbbbK',
      'bbbbbbbbbbbbb',
      'ppppppppppppp',
    ],
    under: (r, c, t) => {
      if (t === 'y') return 'p';
      if (t === 'b' && r < 8) return 'y' + ((c + r) % 3 === 0 ? 'y' : 'p');
      if (t === 'b') return c % 2 ? 'p' : 'y';
      if (t === 'p') return 'b';
      return '';
    },
    wells: [[2.5, 16.8, 'b'], [10.5, 16.8, 'p']],
  },
  {
    name: 'Wings',
    backdrop: BD.garden,
    top: [
      '.pp.......pp.',
      'pppp.K.K.pppp',
      'pp*pp.K.pp*pp',
      'pppppbKbppppp',
      '.ppppbKbpppp.',
      '..yyybKbyyy..',
      '.yy*yyKyy*yy.',
      '.yyyy.K.yyyy.',
      '..yy..K..yy..',
    ],
    under: (r, c, t) => {
      if (t === 'p') return (c % 2 ? 'y' : 'b') + (r % 2 ? 'y' : 'b');
      if (t === 'y') return c % 2 ? 'p' : 'b';
      if (t === 'b') return 'y';
      return '';
    },
    wells: [[1.5, 15.6, 'y'], [6.5, 17.2, 'b'], [11.5, 15.6, 'y']],
  },
  {
    name: 'Skull',
    backdrop: BD.rings,
    top: [
      '...ppppppp...',
      '..ppppppppp..',
      '.ppppppppppp.',
      '.pp**ppp**pp.',
      '.pp**ppp**pp.',
      '.ppppp.ppppp.',
      '..pppbbbppp..',
      '...pKpKpKp...',
      '...ppppppp...',
      '.............',
      '.K.........K.',
      '..K.......K..',
    ],
    under: (r, c, t) => {
      if (t === 'p') {
        const mid = ((r >> 1) + (c >> 1)) % 2 ? 'y' : 'b';
        const low = r <= 4 ? (c % 2 ? 'p' : 'y') : '';
        return low + mid;
      }
      if (t === 'b') return 'yp';
      return '';
    },
    wells: [[1.5, 17.2, 'y'], [11.5, 17.2, 'b']],
  },
];

/* The run: three acts of three plates, each closed by a boss. */
const RUN_STAGES = [
  { kind: 'plate', plate: 0 },
  { kind: 'plate', plate: 1 },
  { kind: 'plate', plate: 2 },
  { kind: 'boss', boss: 'blot' },
  { kind: 'plate', plate: 3 },
  { kind: 'plate', plate: 4 },
  { kind: 'plate', plate: 5 },
  { kind: 'boss', boss: 'press' },
  { kind: 'plate', plate: 6 },
  { kind: 'plate', plate: 7 },
  { kind: 'plate', plate: 8 },
  { kind: 'boss', boss: 'misreg' },
];

const ACT_NAMES = ['Proof', 'Press Run', 'Final Edition'];

/** Turn a plate definition into block specs. */
function parsePlate(def) {
  const out = [];
  def.top.forEach((row, r) => {
    if (row.length !== GRID.cols) console.warn(`Plate "${def.name}" row ${r} has ${row.length} cells`);
    for (let c = 0; c < GRID.cols; c++) {
      const t = row[c];
      if (!t || t === '.') continue;
      if (t === 'K') { out.push({ r, c, kind: 'key', layers: [] }); continue; }
      if (t === '*') { out.push({ r, c, kind: 'bomb', layers: [] }); continue; }
      const under = def.under ? def.under(r, c, t) : '';
      out.push({ r, c, kind: 'ink', layers: (under + t).split('') });
    }
  });
  return out;
}
