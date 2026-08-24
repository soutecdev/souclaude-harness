/**
 * Genera un SVG de 1920x1080 por lamina, listo para File > Import en Figma.
 *
 *   node docs/presentacion/build-svg.mjs            # tema claro  -> slides/
 *   node docs/presentacion/build-svg.mjs --dark     # tema oscuro -> slides-dark/
 *
 * Cada lamina entra a Figma como un Frame con capas nombradas. Sin dependencias.
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DARK = process.argv.includes('--dark');
const OUT = join(HERE, DARK ? 'slides-dark' : 'slides');

const W = 1920;
const H = 1080;

/* ── tokens ─────────────────────────────────────────────────────────── */

const light = {
  surface: '#FFFFFF', surface2: '#F2F4F8', surface3: '#E7EAF0',
  ink: '#13171E', ink2: '#39424F', muted: '#5C6573',
  line: '#D2D7DF', line2: '#BBC3CE',
  accent: '#A8761C', accentWash: '#F3E8D2',
  ok: '#0F7A4A', okWash: '#E2F0E9',
  info: '#2F6BA8', infoWash: '#E3ECF7',
  hold: '#B23A26', holdWash: '#F7E4E0'
};

const dark = {
  surface: '#171B22', surface2: '#1E232C', surface3: '#262C36',
  ink: '#E2E6EC', ink2: '#B4BCC7', muted: '#8C95A2',
  line: '#2A303A', line2: '#3A424E',
  accent: '#D9A441', accentWash: '#2C2618',
  ok: '#3EA372', okWash: '#16281F',
  info: '#5A9AD6', infoWash: '#16222E',
  hold: '#DB6A50', holdWash: '#2C1B16'
};

const C = {
  ...(DARK ? dark : light),
  termBg: DARK ? '#0A0D12' : '#14181F',
  termLine: DARK ? '#232932' : '#2B323D',
  termInk: '#DCE2EA', termMuted: '#79838F',
  termAccent: '#D9A441', termOk: '#3EA372'
};

const F = {
  serif: 'Georgia, Constantia, Charter, serif',
  sans: 'Segoe UI, Helvetica Neue, Arial, sans-serif',
  mono: 'Roboto Mono, Cascadia Mono, Consolas, monospace'
};

/* ── geometria ──────────────────────────────────────────────────────── */

const GUT = 88;          // ancho del margen izquierdo
const PAD_X = 68;        // padding horizontal del panel
const PAD_T = 62;
const PAD_B = 52;
const X0 = GUT + PAD_X;
const CW = W - GUT - PAD_X * 2;

/* ── helpers ────────────────────────────────────────────────────────── */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ancho medio por caracter, como fraccion del font-size
const RATIO = { serif: 0.505, sans: 0.515, mono: 0.601 };

const textWidth = (s, size, face) => s.length * size * RATIO[face];

function wrap(str, maxW, size, face) {
  const words = String(str).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const probe = cur ? cur + ' ' + w : w;
    if (cur && textWidth(probe, size, face) > maxW) {
      lines.push(cur);
      cur = w;
    } else {
      cur = probe;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/**
 * Texto con marcado ligero:  *negrita*  y  `mono`.
 * Devuelve <tspan> encadenados dentro de un solo <text> por linea.
 */
function tokenize(str) {
  const out = [];
  const re = /(\*[^*]+\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) out.push({ t: str.slice(last, m.index), k: 'n' });
    const body = m[0].slice(1, -1);
    out.push({ t: body, k: m[0][0] === '*' ? 'b' : 'c' });
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push({ t: str.slice(last), k: 'n' });
  return out;
}

const plain = (str) => str.replace(/[*`]/g, '');

function richLine(x, y, str, { size, face, fill, weight = 400, anchor = 'start' }) {
  const parts = tokenize(str);
  const spans = parts.map((p) => {
    if (p.k === 'b') return `<tspan font-weight="650" fill="${C.ink}">${esc(p.t)}</tspan>`;
    if (p.k === 'c') return `<tspan font-family="${F.mono}" font-size="${(size * 0.9).toFixed(1)}" fill="${C.ink}">${esc(p.t)}</tspan>`;
    return `<tspan>${esc(p.t)}</tspan>`;
  }).join('');
  return `<text x="${x}" y="${y}" font-family="${F[face]}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" xml:space="preserve">${spans}</text>`;
}

function para(x, y, w, str, { size, face = 'sans', fill = C.ink2, lh = 1.45, weight = 400 }) {
  const lines = wrap(plain(str), w, size, face);
  // re-inyecta el marcado linea por linea: se reparte por longitud acumulada
  const marked = remark(str, lines);
  const svg = marked.map((ln, i) =>
    richLine(x, y + size * 0.78 + i * size * lh, ln, { size, face, fill, weight })
  ).join('');
  return { svg, h: lines.length * size * lh };
}

/** Reparte el marcado original sobre las lineas ya cortadas en texto plano. */
function remark(src, plainLines) {
  const parts = tokenize(src);
  const out = [];
  let pi = 0, off = 0;
  for (const target of plainLines) {
    let need = target.length;
    let buf = '';
    while (need > 0 && pi < parts.length) {
      const avail = parts[pi].t.length - off;
      const take = Math.min(avail, need);
      const chunk = parts[pi].t.substr(off, take);
      buf += parts[pi].k === 'b' ? `*${chunk}*` : parts[pi].k === 'c' ? `\`${chunk}\`` : chunk;
      off += take;
      need -= take;
      if (off >= parts[pi].t.length) { pi++; off = 0; }
    }
    // consume el espacio que wrap() se comio entre lineas
    while (pi < parts.length && off < parts[pi].t.length && parts[pi].t[off] === ' ') off++;
    if (pi < parts.length && off >= parts[pi].t.length) { pi++; off = 0; }
    out.push(buf);
  }
  return out;
}

const rect = (x, y, w, h, o = {}) =>
  `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}"` +
  ` fill="${o.fill || 'none'}"` +
  (o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 1}"` : '') +
  ` rx="${o.rx == null ? 2 : o.rx}"/>`;

const line = (x1, y1, x2, y2, stroke = C.line, sw = 1) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"/>`;

const dot = (cx, cy, r, fill) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;

const label = (x, y, str, { size = 13, face = 'mono', fill = C.muted, weight = 600, ls = 1.9, anchor = 'start', upper = true }) =>
  `<text x="${x}" y="${y}" font-family="${F[face]}" font-size="${size}" font-weight="${weight}"` +
  ` letter-spacing="${ls}" fill="${fill}" text-anchor="${anchor}">${esc(upper ? str.toUpperCase() : str)}</text>`;

const g = (id, body) => `<g id="${esc(id)}">${body}</g>`;

/* ── bloques ────────────────────────────────────────────────────────── */
/* Cada renderer: (x, y, w, block) -> { svg, h } */

const B = {};

B.lead = (x, y, w, b) => {
  const size = b.size || 21;
  return para(x, y, Math.min(w, 1180), b.text, { size, fill: C.ink2, lh: 1.5 });
};

B.note = (x, y, w, b) => {
  const size = b.size || 17;
  const inner = w - 34;
  const p = para(x + 22, y + 15, inner, b.text, { size, fill: C.ink2, lh: 1.45 });
  const h = p.h + 30;
  const accent = b.tone ? C[b.tone] : C.accent;
  const wash = b.tone ? C[b.tone + 'Wash'] : C.accentWash;
  return {
    svg: g('note', rect(x, y, w, h, { fill: wash }) + rect(x, y, 3, h, { fill: accent, rx: 0 }) + p.svg),
    h
  };
};

B.bullets = (x, y, w, b) => {
  const size = b.size || 18;
  let cy = y, out = '';
  for (const it of b.items) {
    const p = para(x + 20, cy, w - 20, it, { size, fill: C.ink2, lh: 1.42 });
    out += dot(x + 5, cy + size * 0.5, 3.5, C.accent) + p.svg;
    cy += p.h + 10;
  }
  return { svg: g('bullets', out), h: Math.max(0, cy - y - 10) };
};

B.steps = (x, y, w, b) => {
  const size = b.size || 19;
  let cy = y, out = '';
  b.items.forEach((it, i) => {
    const n = String(i + 1).padStart(2, '0');
    out += `<text x="${x}" y="${cy + size * 0.78}" font-family="${F.mono}" font-size="${size - 4}" font-weight="600" fill="${C.accent}">${n}</text>`;
    const p = para(x + 42, cy, w - 42, it, { size, fill: C.ink2, lh: 1.45 });
    out += p.svg;
    cy += p.h + 13;
  });
  return { svg: g('steps', out), h: Math.max(0, cy - y - 13) };
};

B.cards = (x, y, w, b) => {
  const n = b.items.length;
  const gap = b.gap == null ? 18 : b.gap;
  const cw = (w - gap * (n - 1)) / n;
  const size = b.size || 17;
  let maxH = 0;
  const bodies = b.items.map((it, i) => {
    const cx = x + i * (cw + gap);
    let cy = y + 24;
    let inner = '';
    if (it.tag) {
      inner += label(cx + 24, cy + 10, it.tag, { size: 12.5, fill: it.tone ? C[it.tone] : C.accent, ls: 1.6 });
      cy += 26;
    }
    if (it.h) {
      const hl = wrap(it.h, cw - 48, 21, 'sans');
      hl.forEach((ln, j) => {
        inner += `<text x="${cx + 24}" y="${cy + 16 + j * 27}" font-family="${F.sans}" font-size="21" font-weight="650" fill="${C.ink}">${esc(ln)}</text>`;
      });
      cy += hl.length * 27 + 6;
    }
    for (const pTxt of (it.p || [])) {
      const p = para(cx + 24, cy, cw - 48, pTxt, { size, fill: C.ink2, lh: 1.45 });
      inner += p.svg;
      cy += p.h + 12;
    }
    if (it.bullets) {
      const bl = B.bullets(cx + 24, cy, cw - 48, { items: it.bullets, size: size - 1 });
      inner += bl.svg;
      cy += bl.h + 12;
    }
    const hh = cy - y + 12;
    if (hh > maxH) maxH = hh;
    return { cx, cw, inner, tone: it.top };
  });
  const svg = bodies.map((bd) =>
    rect(bd.cx, y, bd.cw, maxH, { fill: C.surface2, stroke: C.line }) +
    (bd.tone ? rect(bd.cx, y, bd.cw, 3, { fill: C[bd.tone], rx: 0 }) : '') +
    bd.inner
  ).join('');
  return { svg: g('cards', svg), h: maxH };
};

B.table = (x, y, w, b) => {
  const size = b.size || 16.5;
  const cols = b.cols;
  const total = cols.reduce((a, c) => a + c.w, 0);
  const xs = [];
  let acc = 0;
  for (const c of cols) { xs.push(x + (acc / total) * w); acc += c.w; }
  const cwOf = (i) => (cols[i].w / total) * w - 22;

  let out = '';
  let cy = y;
  cols.forEach((c, i) => { out += label(xs[i], cy + 12, c.t, { size: 12, ls: 1.5 }); });
  cy += 24;
  out += line(x, cy, x + w, cy, C.line2);
  cy += 12;

  for (const row of b.rows) {
    let rowH = 0;
    const cells = row.map((cell, i) => {
      if (cell && cell.dot) {
        const t = `<text x="${xs[i] + 15}" y="${cy + 14}" font-family="${F.mono}" font-size="${size}" font-weight="600" fill="${C[cell.dot]}">${esc(cell.t)}</text>`;
        rowH = Math.max(rowH, 26);
        return dot(xs[i] + 5, cy + 8, 4.5, C[cell.dot]) + t;
      }
      const p = para(xs[i], cy, cwOf(i), String(cell == null ? '' : cell), { size, fill: C.ink2, lh: 1.36 });
      rowH = Math.max(rowH, p.h);
      return p.svg;
    }).join('');
    out += cells;
    cy += rowH + 13;
    out += line(x, cy - 6, x + w, cy - 6, C.line);
  }
  return { svg: g('table', out), h: cy - y - 6 };
};

B.term = (x, y, w, b) => {
  const size = b.size || 17;
  const lh = size * 1.62;
  const h = b.lines.length * lh + 40;
  let out = rect(x, y, w, h, { fill: C.termBg, stroke: C.termLine, rx: 3 });
  b.lines.forEach((ln, i) => {
    const yy = y + 20 + size * 0.8 + i * lh;
    const parts = Array.isArray(ln) ? ln : [[ln, 'ink']];
    let cx = x + 22;
    for (const [txt, kind] of parts) {
      const fill = kind === 'p' ? C.termAccent : kind === 'c' ? C.termMuted
        : kind === 'g' ? C.termOk : C.termInk;
      out += `<text x="${cx}" y="${yy}" font-family="${F.mono}" font-size="${size}" fill="${fill}" xml:space="preserve">${esc(txt)}</text>`;
      cx += textWidth(txt, size, 'mono');
    }
  });
  return { svg: g('terminal', out), h };
};

B.tree = (x, y, w, b) => {
  const size = b.size || 16;
  const lh = size * 1.62;
  let out = '';
  b.lines.forEach((ln, i) => {
    const yy = y + size * 0.8 + i * lh;
    const [code, note] = Array.isArray(ln) ? ln : [ln, ''];
    out += `<text x="${x}" y="${yy}" font-family="${F.mono}" font-size="${size}" font-weight="${/^\S/.test(code) ? 600 : 400}" fill="${C.ink}" xml:space="preserve">${esc(code)}</text>`;
    if (note) out += `<text x="${x + 300}" y="${yy}" font-family="${F.mono}" font-size="${size - 1}" fill="${C.muted}">${esc(note)}</text>`;
  });
  return { svg: g('tree', out), h: b.lines.length * lh };
};

B.chain = (x, y, w, b) => {
  const n = b.items.length;
  const arrow = 26;
  const cw = (w - arrow * (n - 1)) / n;
  const h = 92;
  let out = '';
  b.items.forEach((it, i) => {
    const cx = x + i * (cw + arrow);
    out += rect(cx, y, cw, h, { fill: C.surface2, stroke: C.line });
    out += rect(cx, y, cw, 2, { fill: C.accent, rx: 0 });
    out += label(cx + 16, y + 26, it.k, { size: 11.5, ls: 1.4 });
    const vs = wrap(it.v, cw - 32, 16, 'mono');
    vs.slice(0, 2).forEach((ln, j) => {
      out += `<text x="${cx + 16}" y="${y + 50 + j * 21}" font-family="${F.mono}" font-size="16" font-weight="600" fill="${C.ink}">${esc(ln)}</text>`;
    });
    if (i < n - 1) {
      out += `<text x="${cx + cw + arrow / 2}" y="${y + h / 2 + 8}" font-family="${F.sans}" font-size="22" fill="${C.accent}" text-anchor="middle">→</text>`;
    }
  });
  return { svg: g('chain', out), h };
};

B.flow = (x, y, w, b) => {
  const h = 46;
  const gap = 12;
  const sizes = b.items.map((it) => textWidth(it.t, 17, 'mono') + 34);
  const arrows = b.items.length - 1;
  const total = sizes.reduce((a, s) => a + s, 0) + arrows * (gap * 2 + 14);
  const scale = total > w ? w / total : 1;
  let cx = x;
  let out = '';
  b.items.forEach((it, i) => {
    const bw = sizes[i] * scale;
    const isGate = it.k === 'gate';
    out += rect(cx, y, bw, h, {
      fill: isGate ? C.holdWash : C.surface2,
      stroke: isGate ? C.hold : C.line2
    });
    out += `<text x="${cx + bw / 2}" y="${y + 29}" font-family="${F.mono}" font-size="${(17 * scale).toFixed(1)}" font-weight="${isGate ? 700 : 600}" fill="${isGate ? C.hold : C.ink}" text-anchor="middle">${esc(it.t)}</text>`;
    cx += bw;
    if (i < b.items.length - 1) {
      out += `<text x="${cx + (gap * 2 + 14) * scale / 2}" y="${y + 30}" font-family="${F.sans}" font-size="20" fill="${C.accent}" text-anchor="middle">→</text>`;
      cx += (gap * 2 + 14) * scale;
    }
  });
  return { svg: g('flow', out), h };
};

B.kanban = (x, y, w, b) => {
  const n = b.cols.length;
  const gap = 16;
  const cw = (w - gap * (n - 1)) / n;
  const h = b.h || 220;
  let out = '';
  b.cols.forEach((col, i) => {
    const cx = x + i * (cw + gap);
    out += rect(cx, y, cw, h, { fill: C.surface2, stroke: C.line });
    out += label(cx + 16, y + 28, col.t, { size: 12.5, ls: 1.5 });
    out += line(cx + 16, y + 40, cx + cw - 16, y + 40, C.line);
    let ty = y + 54;
    for (const t of col.tasks) {
      const tone = t.tone ? C[t.tone] : C.line2;
      const th = 62;
      out += rect(cx + 14, ty, cw - 28, th, {
        fill: t.tone === 'hold' ? C.holdWash : C.surface,
        stroke: C.line
      });
      out += rect(cx + 14, ty, 2.5, th, { fill: tone, rx: 0 });
      out += `<text x="${cx + 26}" y="${ty + 20}" font-family="${F.mono}" font-size="14.5" font-weight="600" fill="${t.done ? C.muted : C.ink}"${t.done ? ` text-decoration="line-through"` : ''}>${esc(t.id)}</text>`;
      out += `<text x="${cx + 26}" y="${ty + 38}" font-family="${F.sans}" font-size="14.5" fill="${C.ink2}">${esc(t.d)}</text>`;
      out += `<text x="${cx + 26}" y="${ty + 54}" font-family="${F.mono}" font-size="13" fill="${C.muted}">${esc(t.w)}</text>`;
      ty += th + 10;
    }
  });
  return { svg: g('kanban', out), h };
};

B.tiles = (x, y, w, b) => {
  const n = b.items.length;
  const gap = 16;
  const cw = (w - gap * (n - 1)) / n;
  const h = 128;
  let out = '';
  b.items.forEach((it, i) => {
    const cx = x + i * (cw + gap);
    out += rect(cx, y, cw, h, { fill: C.surface2, stroke: C.line });
    out += label(cx + 20, y + 30, it.k, { size: 12, ls: 1.5 });
    out += `<text x="${cx + 20}" y="${y + 84}" font-family="${F.serif}" font-size="46" fill="${C.ink}">${esc(it.n)}` +
      (it.u ? `<tspan font-family="${F.mono}" font-size="19" fill="${C.muted}">${esc(it.u)}</tspan>` : '') +
      `</text>`;
    out += `<text x="${cx + 20}" y="${y + 108}" font-family="${F.sans}" font-size="14" fill="${C.muted}">${esc(it.s)}</text>`;
  });
  return { svg: g('tiles', out), h };
};

B.bars = (x, y, w, b) => {
  const rowH = 30;
  const lbW = 92;
  const vlW = 74;
  const trW = w - lbW - vlW - 28;
  let out = '';
  b.items.forEach((it, i) => {
    const yy = y + i * rowH;
    out += `<text x="${x}" y="${yy + 18}" font-family="${F.mono}" font-size="15.5" fill="${C.ink2}">${esc(it.k)}</text>`;
    out += rect(x + lbW, yy + 5, trW, 16, { fill: C.surface3 });
    const fw = Math.max(3, trW * it.pct);
    out += `<path d="M${x + lbW} ${yy + 5} H${x + lbW + fw - 4} a4 4 0 0 1 4 4 v8 a4 4 0 0 1 -4 4 H${x + lbW} Z" fill="${C.info}"/>`;
    out += `<text x="${x + w}" y="${yy + 18}" font-family="${F.mono}" font-size="15.5" font-weight="600" fill="${C.ink}" text-anchor="end">${esc(it.v)}</text>`;
  });
  return { svg: g('bars', out), h: b.items.length * rowH };
};

B.kv = (x, y, w, b) => {
  const size = b.size || 16.5;
  const kW = b.kw || 168;
  let cy = y, out = '';
  for (const r of b.rows) {
    out += `<text x="${x}" y="${cy + size * 0.8}" font-family="${F.mono}" font-size="${size - 1}" font-weight="600" fill="${C.accent}">${esc(r.k)}</text>`;
    const p = para(x + kW, cy, w - kW, r.v, { size, fill: C.ink2, lh: 1.4 });
    out += p.svg;
    cy += Math.max(p.h, size * 1.4) + 14;
    out += line(x, cy - 8, x + w, cy - 8, C.line);
  }
  return { svg: g('kv', out), h: cy - y - 8 };
};

B.spacer = (x, y, w, b) => ({ svg: '', h: b.h || 16 });

B.row = (x, y, w, b) => {
  const gap = b.gap == null ? 30 : b.gap;
  const weights = b.widths || b.cols.map(() => 1);
  const sum = weights.reduce((a, v) => a + v, 0);
  const avail = w - gap * (b.cols.length - 1);
  let cx = x, maxH = 0, out = '';
  b.cols.forEach((blocks, i) => {
    const cwi = (weights[i] / sum) * avail;
    const r = stack(cx, y, cwi, blocks);
    out += r.svg;
    maxH = Math.max(maxH, r.h);
    cx += cwi + gap;
  });
  return { svg: out, h: maxH };
};

function stack(x, y, w, blocks) {
  let cy = y, out = '';
  for (const b of blocks) {
    const fn = B[b.type];
    if (!fn) throw new Error('bloque desconocido: ' + b.type);
    const r = fn(x, cy, w, b);
    out += r.svg;
    cy += r.h + (b.gap == null ? 22 : b.gap);
  }
  return { svg: out, h: Math.max(0, cy - y - 22) };
}

/* ── chasis de la lamina ────────────────────────────────────────────── */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

const OVERFLOW = [];

function frame(slide, idx, total) {
  let out = rect(0, 0, W, H, { fill: C.surface, rx: 0 });

  if (slide.hero) {
    out += rect(0, 0, W, H, { fill: C.surface, rx: 0 });
    out += `<rect x="${W * 0.42}" y="0" width="${W * 0.58}" height="${H * 0.62}" fill="url(#wash)"/>`;
    return g('slide-' + String(idx + 1).padStart(2, '0'), out + heroBody(slide));
  }

  // margen izquierdo — el borde del instrumento
  out += rect(0, 0, GUT, H, { fill: C.surface2, rx: 0 });
  out += line(GUT, 0, GUT, H, C.line);
  out += `<text transform="translate(${GUT / 2 + 6} 92) rotate(90)" font-family="${F.mono}" font-size="13" font-weight="600" letter-spacing="2.2" fill="${C.accent}">${esc(slide.act.toUpperCase())}</text>`;
  out += line(GUT / 2, 300, GUT / 2, H - 130, C.line2);
  out += `<text transform="translate(${GUT / 2 + 5} ${H - 110}) rotate(90)" font-family="${F.mono}" font-size="12.5" fill="${C.muted}">${ROMAN[slide.actIdx]}</text>`;

  // encabezado
  out += label(X0, PAD_T + 14, slide.eyebrow, { size: 13, fill: C.accent, ls: 2.1 });
  out += `<text x="${W - PAD_X}" y="${PAD_T + 14}" font-family="${F.mono}" font-size="13" fill="${C.muted}" text-anchor="end">${String(idx + 1).padStart(2, '0')} / ${total}</text>`;
  out += line(X0, PAD_T + 36, W - PAD_X, PAD_T + 36, C.line);

  // titulo
  const tSize = 50;
  const tLines = wrap(slide.title, CW - 40, tSize, 'serif');
  let cy = PAD_T + 36 + 46;
  tLines.forEach((ln, i) => {
    out += `<text x="${X0}" y="${cy + i * (tSize * 1.08)}" font-family="${F.serif}" font-size="${tSize}" fill="${C.ink}">${esc(ln)}</text>`;
  });
  cy += (tLines.length - 1) * (tSize * 1.08) + 34;

  // pie
  let footH = 0;
  if (slide.foot) {
    const p = para(X0, 0, CW, slide.foot, { size: 16, fill: C.muted, lh: 1.45 });
    footH = p.h + 22;
  }

  // cuerpo
  const body = stack(X0, cy, CW, slide.body);
  out += body.svg;

  // el contenido tiene que entrar: si no, se avisa con nombre y sobrante
  const techo = H - PAD_B - footH - (slide.foot ? 16 : 0);
  const sobra = cy + body.h - techo;
  if (sobra > 0) OVERFLOW.push({ n: idx + 1, title: slide.title, px: Math.ceil(sobra) });

  if (slide.foot) {
    const fy = H - PAD_B - footH + 22;
    out += line(X0, fy - 16, W - PAD_X, fy - 16, C.line);
    out += para(X0, fy - 4, CW, slide.foot, { size: 16, fill: C.muted, lh: 1.45 }).svg;
  }

  return g('slide-' + String(idx + 1).padStart(2, '0'), out);
}

function heroBody(s) {
  const x = 150;
  let out = label(x, 250, s.eyebrow, { size: 15, fill: C.accent, ls: 2.4 });
  const tLines = wrap(s.title, 1200, 82, 'serif');
  tLines.forEach((ln, i) => {
    out += `<text x="${x}" y="${330 + i * 92}" font-family="${F.serif}" font-size="82" fill="${C.ink}">${esc(ln)}</text>`;
  });
  let cy = 330 + tLines.length * 92 - 30;
  out += rect(x, cy + 4, 112, 3, { fill: C.accent, rx: 0 });
  cy += 46;
  const p = para(x, cy, 1040, s.lead, { size: 25, fill: C.ink2, lh: 1.5 });
  out += p.svg;
  cy += p.h + 40;
  const t = B.term(x, cy, 880, { size: 21, lines: s.term });
  out += t.svg;
  cy += t.h + 42;
  out += `<text x="${x}" y="${cy}" font-family="${F.mono}" font-size="16" letter-spacing="0.9" fill="${C.muted}">${esc(s.meta)}</text>`;
  return out;
}

/* ── contenido ──────────────────────────────────────────────────────── */

const ACTS = ['Qué es', 'Instalar', 'La regla', 'El día', 'Tu código', 'Visibilidad', 'Empezar'];

const slides = [
  {
    hero: true,
    act: ACTS[0], actIdx: 0,
    eyebrow: 'SOUTEC · Metodología de trabajo',
    title: 'El harness, de punta a punta',
    lead: 'Cómo se instala en cualquier repo, cómo se declara el milestone antes de tocar código, y cómo el tablero compartido y el monitor de tokens vuelven visible el trabajo de todo el equipo.',
    term: [
      [['# en cualquier repo, nuevo o legacy', 'c']],
      [['$ ', 'p'], ['npx github:ialvarezsoutec/souclaude-harness#v3', 'ink']]
    ],
    meta: 'souclaude-harness v3.5.0   ·   Node ≥ 22.4 + git   ·   sin registry, sin token'
  },

  {
    act: ACTS[0], actIdx: 0,
    eyebrow: 'Qué es',
    title: 'Tres capas que conviene no confundir',
    body: [
      {
        type: 'cards', items: [
          {
            tag: 'En tu repo', h: 'El harness',
            p: ['Las reglas y las skills que Claude aplica solo cuando el contexto lo amerita. Se commitean con el repo: quien clona, las tiene.',
              'Vive en `CLAUDE.md` y `.claude/skills/`']
          },
          {
            tag: 'Repo aparte', h: 'El Vault',
            p: ['El centro de información de *todos* los proyectos: milestones, planes, kanban y sesiones. Fuera del repo a propósito, para acumular visibilidad sin ensuciarlo.',
              'Vive en `Project-<PREFIJO>/`']
          },
          {
            tag: 'Para la organización', h: 'Jira',
            p: ['El espejo del Vault hacia afuera. Milestone = épica, tarea = issue hijo. Se sincroniza al mover la tarjeta, no al final del día.',
              'Vive en el conector MCP de Atlassian']
          }
        ]
      }
    ],
    foot: 'El Vault manda, Jira refleja. Si el conector no está autorizado, *se avisa y el trabajo local sigue* — Jira nunca bloquea.'
  },

  {
    act: ACTS[1], actIdx: 1,
    eyebrow: 'Instalar',
    title: 'Un comando. Siete verbos.',
    body: [
      {
        type: 'row', widths: [1.05, 1], cols: [
          [
            {
              type: 'table',
              cols: [{ t: 'Comando', w: 28 }, { t: 'Qué hace', w: 72 }],
              rows: [
                [{ dot: 'ok', t: 'init' }, 'Instala. Sirve igual en un repo vacío y en uno con cinco años de código.'],
                [{ dot: 'info', t: 'upgrade' }, 'Actualiza a la última versión y aplica las migraciones.'],
                [{ dot: 'muted', t: 'status' }, 'Solo lectura. Salida 0 al día · 1 hay upgrade · 2 hay drift.'],
                [{ dot: 'hold', t: 'adopt' }, 'Para una estructura hecha a mano. *No toca ningún archivo*: solo escribe el lockfile.'],
                [{ dot: 'muted', t: 'monitor' }, 'Panel de consumo de tokens: límites, sesiones y proyectos.'],
                [{ dot: 'info', t: 'vault-sync' }, 'Sincroniza con el Vault. Jamás `--force`.']
              ]
            },
            { type: 'note', text: 'Sin comando, *se autodetecta*: hay lockfile → `upgrade` · hay estructura previa → `adopt` · repo limpio → `init`.' }
          ],
          [
            {
              type: 'term', size: 16, lines: [
                [['# ver el plan sin escribir un solo byte', 'c']],
                [['$ ', 'p'], ['npx …souclaude-harness#v3 --dry-run', 'ink']],
                [['', 'ink']],
                [['create', 'g'], ['   CLAUDE.md', 'ink']],
                [['create', 'g'], ['   .claude/skills/soutec-github/', 'ink']],
                [['create', 'g'], ['   progress/README.md', 'ink']],
                [['noop', 'c'], ['     .gitignore (bloque ya presente)', 'c']],
                [['', 'ink']],
                [['→ 0 bytes escritos', 'c']]
              ]
            },
            {
              type: 'bullets', items: [
                '*--dry-run* imprime el plan y no escribe nada. El árbol queda byte-idéntico.',
                '*--yes* acepta los defaults; `--name --type --stack --lang` responden sin modo interactivo.'
              ]
            }
          ]
        ]
      }
    ]
  },

  {
    act: ACTS[1], actIdx: 1,
    eyebrow: 'Instalar',
    title: 'Qué queda instalado',
    body: [
      {
        type: 'row', widths: [1, 1.15], cols: [
          [
            {
              type: 'tree', lines: [
                ['CLAUDE.md', 'las reglas del repo'],
                ['.claude/', ''],
                ['  settings.json', 'permisos y hooks'],
                ['  skills/', 'las que elegiste'],
                ['  vault.local.json', 'no se commitea'],
                ['  jira.json', 'proyecto destino'],
                ['.github/', ''],
                ['  pull_request_template.md', ''],
                ['  CODEOWNERS', ''],
                ['progress/', ''],
                ['  README.md', 'el protocolo'],
                ['  history.md', 'append-only'],
                ['docs/decisions/', 'los ADR']
              ]
            }
          ],
          [
            {
              type: 'table',
              cols: [{ t: 'Skill', w: 42 }, { t: 'Para qué', w: 58 }],
              rows: [
                [{ dot: 'ok', t: 'soutec-github' }, '*Obligatoria.* Ramas, commits y PR de SOUTEC.'],
                [{ dot: 'info', t: 'vault-milestones' }, 'Analizar e iterar el tablero de milestones.'],
                [{ dot: 'info', t: 'jira-sync' }, 'Espejar el Vault en Jira al mover la tarjeta.'],
                [{ dot: 'muted', t: 'harness-upgrade' }, 'Actualizar el harness desde Claude.'],
                [{ dot: 'muted', t: 'adr-new' }, 'Documentar decisiones con trade-off.'],
                [{ dot: 'muted', t: 'it-security-review' }, 'Security review para IT.'],
                [{ dot: 'muted', t: 'soutec-md-a-pdf' }, 'Markdown a PDF con identidad Soutec.']
              ]
            },
            { type: 'note', text: 'Al instalar eliges con un checkbox. `soutec-github` se instala *siempre*, esté o no en la lista.' }
          ]
        ]
      }
    ],
    foot: 'Las skills son *project-local*: se commitean con el repo. No hay instalación por persona ni por máquina.'
  },

  {
    act: ACTS[2], actIdx: 2,
    eyebrow: 'La regla',
    title: 'Nada de código sin milestone declarado',
    body: [
      { type: 'lead', text: 'Todo trabajo pertenece a un milestone del Vault. Antes de tocar código, el agente **declara sobre cuál va a trabajar**. Si el pedido no corresponde a ninguno, se da de alta uno en el Backlog *antes* de empezar.' },
      { type: 'spacer', h: 10 },
      {
        type: 'row', widths: [1, 1], cols: [
          [
            {
              type: 'term', size: 15.5, lines: [
                [['# al arrancar la sesión, el hook recuerda el tablero', 'c']],
                [['', 'ink']],
                [['[harness]', 'p'], [' Trazabilidad obligatoria.', 'ink']],
                [['', 'ink']],
                [['En curso (1):', 'ink']],
                [['  SHS-M5 · conexión con el Vault', 'g'], [' @ignacio', 'c']],
                [['', 'ink']],
                [['Backlog: 6 milestone(s) pendiente(s).', 'c']]
              ]
            }
          ],
          [
            {
              type: 'bullets', items: [
                'Trabajo sin milestone declarado es *una violación del protocolo*, no una omisión menor.',
                'El milestone es la **unidad de anti-solapamiento** entre máquinas: si ya está En curso con otro dueño, paras y preguntas.',
                'El hook `SessionStart` lo recuerda solo — no depende de que alguien se acuerde.'
              ]
            }
          ]
        ]
      }
    ],
    foot: 'La skill `vault-milestones` da de alta el milestone que falta, con el estándar del tablero.'
  },

  {
    act: ACTS[2], actIdx: 2,
    eyebrow: 'La regla',
    title: 'Tres niveles: milestone, plan, tarea',
    body: [
      {
        type: 'chain', items: [
          { k: 'Nivel alto', v: 'SHS-M5' },
          { k: 'Cómo llegar', v: 'SHS-M5-P1' },
          { k: 'El día', v: 'SHS-M5-T002' },
          { k: 'El trabajo', v: 'rama + PR' }
        ]
      },
      { type: 'spacer', h: 18 },
      {
        type: 'kv', kw: 150, rows: [
          { k: 'milestones.md', v: 'El tablero de milestones: qué se persigue. La tarjeta lleva dueño, máquina y el plan activo.' },
          { k: 'plans/', v: 'Un archivo por plan: qué se va a hacer, en qué orden y con qué criterio de éxito. Un milestone puede cambiar de plan — el viejo *no se borra*.' },
          { k: 'kanban.md', v: 'Las tareas del milestone en curso, en cuatro columnas: Backlog, En curso, En review, Hecho.' },
          { k: 'sessions.md', v: 'Append-only: una línea por sesión con quién, qué tocó y cuántos tokens costó.' }
        ]
      }
    ],
    foot: 'El milestone es la unidad de anti-solapamiento entre máquinas; la tarea es la unidad de trabajo del día.'
  },

  {
    act: ACTS[3], actIdx: 3,
    eyebrow: 'El día',
    title: 'El ciclo completo, sin saltos',
    body: [
      {
        type: 'steps', size: 18, items: [
          '`git -C "<vault>" pull --rebase` — el tablero primero, siempre. O `npx souclaude vault-sync`.',
          'Lees `milestones.md`. Si el milestone está En curso con *otro dueño u otra máquina*: **paras y preguntas**.',
          'Tomas la tarea, mueves la tarjeta a En curso y **pusheas en ese momento** — no en un push final.',
          'Jira se sincroniza inmediatamente después. Vault primero, Jira detrás.',
          'Rama desde `dev`: `feature/SHS-M5-T002-sembrar-carpeta`. El ID de la tarea va como prefijo del slug.',
          'PR a `dev` con la plantilla completa de verdad. **Nunca** commit directo a `main`.',
          'Al cerrar: tarjeta a Hecho, push inmediato, y tu línea en `sessions.md` con los tokens.'
        ]
      }
    ],
    foot: 'Cada movimiento se pushea al momento: el tablero refleja *el ahora*, no el último merge.'
  },

  {
    act: ACTS[3], actIdx: 3,
    eyebrow: 'El día',
    title: 'Dos repos con reglas opuestas, a propósito',
    body: [
      {
        type: 'table',
        cols: [{ t: '', w: 20 }, { t: 'Repo del proyecto', w: 40 }, { t: 'Repo del Vault', w: 40 }],
        rows: [
          [{ t: 'Qué va' }, 'Código, tests, progreso', 'Milestones, planes, kanban, sesiones'],
          [{ t: 'Cómo se escribe' }, { dot: 'info', t: 'Rama + PR. *Nunca* directo a `main`' }, { dot: 'ok', t: '*Push directo a `main`*, sin PR' }],
          [{ t: 'Por qué' }, 'Todo cambio se revisa', 'El tablero refleja el ahora'],
          [{ t: 'Ramas' }, '`tipo/<ID>-<slug>` desde `dev`', 'No hay: se escribe en `main`'],
          [{ t: 'Release' }, '`dev` → `main` por PR, y recién ahí los tags', 'No aplica']
        ]
      },
      { type: 'spacer', h: 14 },
      { type: 'note', text: 'Nunca se cruzan: código, diffs y tests jamás van al Vault; los artefactos del Vault jamás se commitean en el proyecto. Y en ninguno de los dos: *nunca `git push --force`*.' }
    ]
  },

  {
    act: ACTS[3], actIdx: 3,
    eyebrow: 'El día',
    title: 'Nadie pisa el trabajo de nadie',
    body: [
      {
        type: 'kanban', h: 236, cols: [
          {
            t: 'Backlog', tasks: [
              { id: 'REA-M3-T004', d: 'validar formulario', w: '@pendiente' },
              { id: 'REA-M3-T005', d: 'reintento de envío', w: '@pendiente' }
            ]
          },
          { t: 'En curso', tasks: [{ id: 'REA-M3-T003', d: 'capturar lead al cierre', w: '@sofia · PC04', tone: 'hold' }] },
          { t: 'En review', tasks: [{ id: 'REA-M3-T002', d: 'persistencia del ticket', w: '@nacho · PR #18', tone: 'accent' }] },
          { t: 'Hecho', tasks: [{ id: 'REA-M3-T001', d: 'esqueleto del dominio', w: '@nacho', tone: 'ok', done: true }] }
        ]
      },
      { type: 'spacer', h: 12 },
      {
        type: 'bullets', items: [
          'La tarjeta de *@sofia* está En curso en otra máquina: **no la tomas, no la mueves, no saltas a otra por tu cuenta**. Paras y preguntas.',
          'Una tarjeta = una línea. Al resolver un conflicto en los tableros, se conservan ambas y se ordena.'
        ]
      }
    ]
  },

  {
    act: ACTS[4], actIdx: 4,
    eyebrow: 'Tu código',
    title: 'Un archivo tuyo nunca se sobrescribe en silencio',
    body: [
      {
        type: 'row', widths: [1, 1.02], cols: [
          [
            {
              type: 'term', size: 15, lines: [
                [['$ ', 'p'], ['npx …souclaude-harness#v3 upgrade', 'ink']],
                [['', 'ink']],
                [['update', 'g'], ['   .claude/settings.json', 'ink']],
                [['keep', 'c'], ['     CLAUDE.md', 'c'], ['  (lo editaste tú)', 'c']],
                [['new', 'p'], ['      CLAUDE.md.new', 'ink']],
                [['', 'ink']],
                [['→ tu version intacta', 'c']]
              ]
            },
            {
              type: 'bullets', size: 16.5, items: [
                'Si tocaste un archivo gestionado, el harness **no lo pisa**: deja la versión nueva al lado como `.new`.',
                'Comparas, te quedas con lo que sirve y borras el `.new`. La decisión es tuya.',
                'Antes de sobrescribir cualquier cosa hay copia en `.claude/backup-<ts>/`.'
              ]
            }
          ],
          [
            {
              type: 'table', size: 15,
              cols: [{ t: 'Situación', w: 44 }, { t: 'Veredicto', w: 20 }, { t: 'Qué pasa', w: 36 }],
              rows: [
                ['No está en disco', { dot: 'ok', t: 'create' }, 'Se crea.'],
                ['Está, intacto, cambió el template', { dot: 'info', t: 'update' }, 'Se actualiza.'],
                ['Está, intacto, sin cambios', { dot: 'muted', t: 'noop' }, 'Nada.'],
                ['*Lo editaste tú*, sin cambios', { dot: 'muted', t: 'local-edit' }, 'Se respeta.'],
                ['*Lo editaste tú*, cambió', { dot: 'hold', t: 'conflict' }, '*Nunca se pisa* → `.new`.'],
                ['Existía y lo borraste', { dot: 'ok', t: 'restore' }, 'Se reescribe.'],
                ['Ya no está en el manifest', { dot: 'hold', t: 'obsolete' }, 'Solo con `--prune`.']
              ]
            }
          ]
        ]
      }
    ],
    foot: '`--prune` exige tipear BORRAR y `--force` exige tipear FORCE. La herramienta obedece las mismas reglas que instala.'
  },

  {
    act: ACTS[5], actIdx: 5,
    eyebrow: 'Visibilidad',
    title: 'El tablero, espejado en Jira',
    body: [
      {
        type: 'chain', items: [
          { k: 'Mueves', v: 'la tarjeta' },
          { k: 'Commit', v: 'al Vault' },
          { k: 'Push', v: 'a main' },
          { k: 'Y recién', v: 'Jira' }
        ]
      },
      { type: 'spacer', h: 16 },
      {
        type: 'row', widths: [1, 1], cols: [
          [
            {
              type: 'kv', kw: 150, size: 16, rows: [
                { k: 'Milestone', v: 'Una **épica**, con su descripción y la etiqueta `<PREFIJO>-M<n>`.' },
                { k: 'Tarea', v: 'Un **issue hijo** de esa épica. El ID en el summary es la clave de idempotencia: nunca se duplica.' },
                { k: 'Columna', v: 'Backlog → To Do · En curso → In Progress · En review → In Review · Hecho → Done.' }
              ]
            }
          ],
          [
            {
              type: 'bullets', size: 16.5, items: [
                'Se sincroniza **en el momento** en que mueves la tarjeta, no al final del día.',
                '**Jira nunca es la fuente.** Si alguien mueve un issue allá, se reporta la divergencia — no se toca el Vault para igualar.',
                'Sin conector autorizado: se avisa una vez y el trabajo local sigue.',
                'No se borran issues: una tarea eliminada se comenta y se cierra.'
              ]
            }
          ]
        ]
      }
    ],
    foot: 'Cada proyecto del Vault tiene su propio proyecto en Jira, y la clave es el mismo PREFIJO: `Project-SHS` → `SHS`.'
  },

  {
    act: ACTS[5], actIdx: 5,
    eyebrow: 'Visibilidad',
    title: 'El equipo ve dónde se va el esfuerzo',
    body: [
      {
        type: 'tiles', items: [
          { k: 'Ventana 5h', n: '38', u: '%', s: 'del límite de la cuenta' },
          { k: 'Ventana 7d', n: '61', u: '%', s: 'consumo propio del período' },
          { k: 'Sesiones', n: '3', s: 'activas ahora en el equipo' },
          { k: 'Proyectos', n: '4', s: 'publicando en el Vault' }
        ]
      },
      { type: 'spacer', h: 16 },
      {
        type: 'bullets', items: [
          '`npx souclaude monitor` abre el panel en vivo; `--usage` da el informe completo con filtros por proyecto, contribuyente y cuenta.',
          'Con el panel abierto, **cada sesión publica sola su línea** en `sessions.md` y la actualiza mientras sigue viva.',
          'Una línea que editaste a mano *nunca se pisa*: el monitor solo actualiza la que escribió él, byte a byte.'
        ]
      }
    ],
    foot: 'Las cifras de arriba son de ejemplo, para mostrar la forma del panel. Los datos reales salen del registro del Vault.'
  },

  {
    act: ACTS[6], actIdx: 6,
    eyebrow: 'Empezar',
    title: 'Empezar hoy',
    body: [
      {
        type: 'row', widths: [1, 1], cols: [
          [
            {
              type: 'term', size: 16, lines: [
                [['# repo nuevo o con años de código', 'c']],
                [['$ ', 'p'], ['npx github:…souclaude-harness#v3', 'ink']],
                [['', 'ink']],
                [['# ya lo tenías instalado', 'c']],
                [['$ ', 'p'], ['npx …#v3 upgrade --dry-run', 'ink']],
                [['$ ', 'p'], ['npx …#v3 upgrade --prune', 'ink']]
              ]
            },
            {
              type: 'steps', size: 16.5, items: [
                'Instala y elige tus skills. `soutec-github` viene siempre.',
                'Conecta el Vault: se clona y se declara tu `Project-<PREFIJO>`.',
                'Antes de la primera línea de código: **declara tu milestone**.'
              ]
            }
          ],
          [
            {
              type: 'kv', kw: 190, size: 16, rows: [
                { k: 'progress/README.md', v: 'El protocolo completo: los dos repos, el anti-solapamiento y el formato de los tableros.' },
                { k: 'CLAUDE.md', v: 'Las reglas duras del repo: ramas, commits, PR y qué no se hace nunca.' },
                { k: 'docs/infografias/', v: 'Una master de la metodología y una por caso de adopción, listas para imprimir.' },
                { k: 'docs/decisions/', v: 'Los ADR: por qué las cosas son como son.' }
              ]
            },
            { type: 'note', text: 'Si algo es ambiguo o parece mal: *para y pregunta*. No adivines.' }
          ]
        ]
      }
    ],
    foot: 'Los proyectos instalados antes de la v3 apuntan a `#v1`: editas la ref a `#v3` y corres `upgrade --prune`. El tag móvil `v2` nunca existió.'
  }
];

/* ── salida ─────────────────────────────────────────────────────────── */

const slugs = [
  'portada', 'tres-capas', 'un-comando', 'que-instala',
  'milestone-obligatorio', 'tres-niveles', 'el-ciclo', 'dos-repos',
  'nadie-pisa', 'archivo-new', 'jira-espejo', 'monitor-tokens',
  'empezar-hoy'
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

slides.forEach((s, i) => {
  const defs = `<defs><radialGradient id="wash" cx="70%" cy="12%" r="80%">` +
    `<stop offset="0%" stop-color="${C.accentWash}" stop-opacity="1"/>` +
    `<stop offset="100%" stop-color="${C.accentWash}" stop-opacity="0"/>` +
    `</radialGradient></defs>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    defs + frame(s, i, slides.length) + `</svg>\n`;
  const name = `${String(i + 1).padStart(2, '0')}-${slugs[i]}.svg`;
  writeFileSync(join(OUT, name), svg, 'utf8');
  console.log('  ' + name);
});

if (OVERFLOW.length) {
  console.error('\n  AVISO — contenido que no entra en la lamina:');
  for (const o of OVERFLOW) {
    console.error(`    ${String(o.n).padStart(2, '0')}  ${o.title} — sobra ${o.px}px`);
  }
  console.error('  Recorta el texto o baja el tamano de los bloques.\n');
}

console.log(`\n${slides.length} laminas en ${OUT}`);
console.log('Figma: File > Import > selecciona los .svg (cada uno entra como Frame 1920x1080).');
