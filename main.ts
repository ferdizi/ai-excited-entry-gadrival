// ai-excited-01 entry for @gadrival — "The Whale in the Fishbowl".
// A giant humpback whale breaches out of a tiny glass fishbowl on a wooden
// table at sunset, while a small child in a yellow raincoat reaches up.
// Pure Node 22 stdlib: the image is drawn procedurally into a supersampled
// RGBA buffer, downsampled to 1024x1024, and encoded as PNG by hand.
// Deterministic: fixed seed, no network, no clock, no randomness outside
// the seeded generator, so both grader runs write identical bytes.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;
const SS = 2; // supersample factor for smooth edges
const SW = W * SS;
const SH = H * SS;

type RGB = [number, number, number];
type Pt = [number, number];

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Deterministic PRNG (mulberry32) — fixed seed, identical every run.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- canvas ---------------------------------------------------------------
const buf = new Uint8Array(SW * SH * 4);

function px(x: number, y: number, c: RGB, alpha: number): void {
  if (x < 0 || y < 0 || x >= SW || y >= SH || alpha <= 0) return;
  const i = (y * SW + x) * 4;
  const a = Math.min(1, Math.max(0, alpha));
  const inv = 1 - a;
  buf[i] = Math.round(c[0] * a + buf[i] * inv);
  buf[i + 1] = Math.round(c[1] * a + buf[i + 1] * inv);
  buf[i + 2] = Math.round(c[2] * a + buf[i + 2] * inv);
  buf[i + 3] = 255;
}

// Coordinates below are in 1024-space; scale by SS when rasterising.
function X(v: number): number {
  return Math.round(v * SS);
}

function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB, alpha = 1): void {
  for (let y = X(y0); y < X(y1); y++) {
    for (let x = X(x0); x < X(x1); x++) px(x, y, c, alpha);
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB, alpha = 1): void {
  const x0 = X(cx - rx);
  const x1 = X(cx + rx);
  const y0 = X(cy - ry);
  const y1 = X(cy + ry);
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5) / SS - cy;
    const t = 1 - (dy * dy) / (ry * ry);
    if (t < 0) continue;
    const dx = rx * Math.sqrt(t);
    for (let x = Math.max(0, X(cx - dx)); x <= Math.min(SW - 1, X(cx + dx)); x++) {
      px(x, y, c, alpha);
    }
  }
}

function circle(cx: number, cy: number, r: number, c: RGB, alpha = 1): void {
  fillEllipse(cx, cy, r, r, c, alpha);
}

// Scanline polygon fill (even-odd) in 1024-space, rasterised at SS.
function fillPolygon(pts: Pt[], c: RGB, alpha = 1): void {
  const P = pts.map(([x, y]) => [X(x), X(y)] as Pt);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of P) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let y = Math.max(0, minY); y <= Math.min(SH - 1, maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < P.length; i++) {
      const [x1, y1] = P[i];
      const [x2, y2] = P[(i + 1) % P.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k]));
      const b = Math.min(SW - 1, Math.floor(xs[k + 1]));
      for (let x = a; x <= b; x++) px(x, y, c, alpha);
    }
  }
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

// Smooth closed shape through a list of cubic segments.
function bezierShape(segments: [Pt, Pt, Pt, Pt][]): Pt[] {
  const out: Pt[] = [];
  for (const [p0, p1, p2, p3] of segments) {
    const pts = cubic(p0, p1, p2, p3, 24);
    out.push(...pts.slice(0, -1));
  }
  return out;
}

// Thick curve: stamp circles along a polyline.
function thickCurve(pts: Pt[], width: number, c: RGB, alpha = 1): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const d = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(d / (width / 3)));
    for (let s = 0; s <= steps; s++) {
      circle(lerp(x1, x2, s / steps), lerp(y1, y2, s / steps), width / 2, c, alpha);
    }
  }
}

// ---- PNG encoding ---------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG(rgba: Uint8Array, w: number, h: number): Buffer {
  // Filter 2 (Up) per row compresses smooth gradients well; first row is 0.
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * 4);
    raw[rowStart] = y === 0 ? 0 : 2;
    for (let x = 0; x < w * 4; x++) {
      const v = rgba[(y * w * 4) + x];
      const up = y === 0 ? 0 : rgba[((y - 1) * w * 4) + x];
      raw[rowStart + 1 + x] = (v - up) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---- scene: The Whale in the Fishbowl -------------------------------------
function draw(): void {
  const rng = mulberry32(20261116);

  // Sky: cold deep teal at the top melting into warm sunset amber at the horizon.
  const skyStops: [number, RGB][] = [
    [0, hex("#082a44")],
    [0.28, hex("#155a7d")],
    [0.5, hex("#3d8aa5")],
    [0.62, hex("#e8873a")],
    [0.74, hex("#ffb347")],
    [1, hex("#ffd166")],
  ];
  for (let y = 0; y < SH; y++) {
    const t = y / SH;
    let c: RGB = skyStops[0][1];
    for (let i = 0; i + 1 < skyStops.length; i++) {
      if (t >= skyStops[i][0] && t <= skyStops[i + 1][0]) {
        c = mix(skyStops[i][1], skyStops[i + 1][1], (t - skyStops[i][0]) / (skyStops[i + 1][0] - skyStops[i][0]));
        break;
      }
    }
    for (let x = 0; x < SW; x++) px(x, y, c, 1);
  }

  // Low warm sun, right of the whale, with a soft glow.
  for (let r = 190; r > 0; r -= 12) {
    circle(775, 625, r, hex("#ff9a3c"), 0.05 + 0.16 * (1 - r / 190));
  }
  circle(775, 625, 108, hex("#ffdf8a"), 1);
  circle(775, 625, 88, hex("#ffe9a8"), 1);

  // Warm clouds, thin and fast.
  const cloud = hex("#ffd9a0");
  for (const [cx, cy, rx, ry, a] of [
    [180, 170, 95, 18, 0.85],
    [225, 158, 65, 13, 0.7],
    [880, 130, 90, 15, 0.8],
    [915, 120, 55, 11, 0.65],
    [120, 330, 90, 15, 0.55],
    [900, 330, 100, 16, 0.6],
  ] as [number, number, number, number, number][]) {
    fillEllipse(cx, cy, rx, ry, cloud, a);
  }

  // Distant birds — tiny dark chevrons, frozen mid-flap.
  const bird = hex("#12324a");
  for (const [bx, by, s] of [
    [250, 210, 16],
    [315, 165, 12],
    [880, 220, 14],
  ] as [number, number, number][]) {
    thickCurve([[bx - s, by + 4], [bx, by - 3], [bx + s, by + 4]], 4, bird, 0.9);
  }

  // Wooden table: warm planks across the bottom third.
  for (let y = 0; y < SH; y++) {
    const t = y / SH;
    if (t < 0.74) continue;
    const c = mix(hex("#7a4a26"), hex("#9c6a38"), (t - 0.74) / 0.26);
    for (let x = 0; x < SW; x++) px(x, y, c, 1);
  }
  fillRect(0, 758, 1024, 766, hex("#c98d4e"), 1); // table top edge highlight
  fillRect(0, 830, 1024, 834, hex("#5e3618"), 0.55);
  fillRect(0, 920, 1024, 924, hex("#5e3618"), 0.55);

  // Fishbowl, back half: glass + water, drawn before the whale so the
  // whale's tail sits inside it.
  const bowlBack = bezierShape([
    [[300, 700], [300, 800], [350, 878], [470, 892]],
    [[470, 892], [590, 878], [640, 800], [640, 700]],
  ]);
  fillPolygon(bowlBack, hex("#7fd4d8"), 0.5);
  // Water inside the bowl.
  const water = bezierShape([
    [[312, 726], [312, 800], [360, 872], [470, 884]],
    [[470, 884], [580, 872], [628, 800], [628, 726]],
  ]);
  fillPolygon(water, hex("#1f8aa0"), 0.85);
  fillEllipse(470, 726, 158, 16, hex("#8fe3e8"), 0.9); // water surface

  // Whale tail flukes, still at the bowl's rim.
  const flukeL: Pt[] = [[452, 792], [380, 730], [330, 668], [392, 700], [440, 748], [460, 786]];
  const flukeR: Pt[] = [[470, 792], [552, 728], [600, 664], [540, 712], [496, 756], [478, 788]];
  fillPolygon(flukeL, hex("#16324f"), 1);
  fillPolygon(flukeR, hex("#16324f"), 1);

  // Whale body: one huge diagonal, dark slate-blue against the warm sky.
  const body = bezierShape([
    [[438, 800], [470, 660], [540, 520], [620, 392]],
    [[620, 392], [660, 310], [700, 262], [752, 240]],
    [[752, 240], [806, 232], [836, 272], [818, 322]],
    [[818, 322], [730, 440], [600, 580], [500, 690]],
    [[500, 690], [470, 740], [450, 780], [430, 802]],
  ]);
  fillPolygon(body, hex("#1d4e6b"), 1);

  // Pale belly along the lower edge.
  const belly = bezierShape([
    [[478, 748], [520, 676], [606, 566], [700, 448]],
    [[700, 448], [756, 372], [796, 318], [806, 330]],
    [[806, 330], [740, 430], [640, 552], [548, 664]],
    [[548, 664], [512, 712], [490, 732], [482, 752]],
  ]);
  fillPolygon(belly, hex("#d7eef2"), 0.95);

  // Long pectoral fin sweeping down toward the bowl.
  const fin: Pt[] = [[606, 536], [572, 636], [516, 722], [494, 732], [542, 700], [600, 604], [626, 544]];
  fillPolygon(fin, hex("#14344e"), 1);

  // Eye, mouth, blowhole.
  circle(738, 296, 8, hex("#ffffff"), 1);
  circle(739, 297, 4, hex("#0a1c2c"), 1);
  thickCurve(cubic([812, 318], [786, 344], [748, 366], [706, 378], 16), 6, hex("#0f2c42"), 0.7);
  fillEllipse(700, 252, 12, 5, hex("#0f2c42"), 1);

  // Spout: one fountain plume bursting from the blowhole, droplets frozen above it.
  const spout = hex("#eafcff");
  thickCurve(cubic([700, 250], [696, 205], [692, 165], [690, 125], 12), 10, spout, 0.75);
  thickCurve(cubic([700, 250], [688, 210], [676, 180], [664, 152], 10), 5, spout, 0.7);
  thickCurve(cubic([700, 250], [714, 208], [726, 178], [738, 150], 10), 5, spout, 0.7);
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI / 2 + (rng() - 0.5) * 1.1;
    const d = 25 + rng() * 70;
    const sx = 694 + Math.cos(a) * d;
    const sy = 240 + Math.sin(a) * d - rng() * 15;
    circle(sx, sy, 3 + rng() * 6, spout, 0.75 + rng() * 0.25);
  }

  // Splash ring where the whale leaves the bowl: white foam + droplets.
  const foam = hex("#ffffff");
  for (let i = 0; i < 34; i++) {
    const a = Math.PI + (rng() * Math.PI); // upper half around the rim
    const rx = 150 + rng() * 40;
    const sx = 470 + Math.cos(a) * rx;
    const sy = 706 - Math.abs(Math.sin(a)) * (18 + rng() * 46);
    circle(sx, sy, 4 + rng() * 9, foam, 0.8 + rng() * 0.2);
  }
  for (const [dx, dy, r] of [
    [330, 660, 14], [610, 655, 16], [300, 690, 10], [640, 688, 11], [470, 640, 9],
  ] as [number, number, number][]) {
    circle(dx, dy, r, foam, 0.95);
  }

  // Bowl front: glass veil over the tail base + rim highlight.
  fillPolygon(bowlBack, hex("#bfeef0"), 0.16);
  thickCurve(cubic([300, 700], [380, 686], [560, 686], [640, 700], 24), 7, hex("#eafcff"), 0.85);
  fillEllipse(470, 700, 170, 20, hex("#9fe8ea"), 0.25);

  // The child: tiny in a yellow raincoat on the table, one arm reaching up.
  const coat = hex("#ffc21c");
  const dark = hex("#1c2b38");
  fillRect(168, 918, 182, 962, dark, 1); // left boot
  fillRect(196, 918, 210, 962, dark, 1); // right boot
  fillRect(170, 872, 208, 920, dark, 1); // legs
  const coatBody: Pt[] = [[162, 868], [166, 812], [182, 796], [198, 796], [214, 812], [218, 868], [208, 876], [172, 876]];
  fillPolygon(coatBody, coat, 1);
  circle(190, 786, 24, coat, 1); // hood
  circle(190, 790, 15, hex("#f2b28a"), 1); // face, turned up to the whale
  // Raised arm, reaching toward the whale.
  thickCurve(cubic([212, 830], [232, 800], [248, 772], [258, 742], 12), 15, coat, 1);
  circle(259, 738, 8, hex("#f2b28a"), 1); // small hand

  // A few droplets scattered on the table, caught mid-bounce.
  for (let i = 0; i < 12; i++) {
    circle(120 + rng() * 780, 800 + rng() * 160, 2 + rng() * 4, hex("#cfeef2"), 0.7);
  }
}

// ---- run ------------------------------------------------------------------
function main(): void {
  draw();

  // Downsample SS buffer to 1024x1024 by averaging each 2x2 block.
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = (((y * SS + dy) * SW) + (x * SS + dx)) * 4;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
        }
      }
      const o = (y * W + x) * 4;
      out[o] = Math.round(r / (SS * SS));
      out[o + 1] = Math.round(g / (SS * SS));
      out[o + 2] = Math.round(b / (SS * SS));
      out[o + 3] = 255;
    }
  }

  const png = encodePNG(out, W, H);
  const dir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "entry.png");
  fs.writeFileSync(file, png);
  console.log(`wrote ${file} ${png.length} bytes ${W}x${H}`);
}

main();
