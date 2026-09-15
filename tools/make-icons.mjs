#!/usr/bin/env node
// Generates the PWA icons in the app palette with zero dependencies
// (hand-rolled PNG encoder + supersampled signed-distance shapes).
// Usage: node tools/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../icons');
mkdirSync(out, { recursive: true });

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const CREAM = hex('#FFF9F2'), SAGE = hex('#C7D9A0'), BLUSH = hex('#EBCFD1'), SAND = hex('#E6D9BC'), SAGE_DEEP = hex('#5C7038');

// ---- PNG encoder ----
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- the mark: a sage disc with a blush "baby" disc tucked inside, on cream ----
// Layers are (shape, color) in paint order; shapes return signed distance in unit space.
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const ring = (cx, cy, r, w) => (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) - w / 2;
const layers = (pad) => {
  // pad shrinks the mark toward the centre (maskable icons need a safe zone)
  const s = 1 - pad * 2, o = pad;
  const u = (v) => o + v * s;
  return [
    [ring(u(0.5), u(0.5), 0.40 * s, 0.05 * s), SAND],
    [circle(u(0.5), u(0.5), 0.30 * s), SAGE],
    [circle(u(0.5), u(0.5), 0.30 * s), SAGE],
    [circle(u(0.59), u(0.41), 0.115 * s), BLUSH],
    [circle(u(0.59), u(0.41), 0.045 * s), CREAM],
    [ring(u(0.5), u(0.5), 0.30 * s, 0.018 * s), SAGE_DEEP],
  ];
};

function render(size, pad, roundBackground) {
  const buf = Buffer.alloc(size * size * 4);
  const L = layers(pad);
  const SS = 4; // 4x4 supersampling
  const bgR = 0.22; // corner radius (fraction) when the background itself is rounded
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
        let cr = CREAM[0], cg = CREAM[1], cb = CREAM[2], ca = 1;
        if (roundBackground) {
          // rounded-square background; transparent outside
          const qx = Math.abs(x - 0.5) - (0.5 - bgR), qy = Math.abs(y - 0.5) - (0.5 - bgR);
          const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - bgR;
          if (d > 0) ca = 0;
        }
        if (ca) for (const [sdf, col] of L) if (sdf(x, y) <= 0) { [cr, cg, cb] = col; }
        r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
      }
      const n = SS * SS, i = (py * size + px) * 4;
      buf[i] = a ? Math.round(r / a) : 0; buf[i + 1] = a ? Math.round(g / a) : 0; buf[i + 2] = a ? Math.round(b / a) : 0;
      buf[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, size, buf);
}

const files = [
  ['icon-192.png', 192, 0, false],
  ['icon-512.png', 512, 0, false],
  ['icon-maskable-512.png', 512, 0.1, false],
  ['apple-touch-icon.png', 180, 0.02, false],
  ['favicon-64.png', 64, 0, true],
];
for (const [name, size, pad, round] of files) {
  writeFileSync(resolve(out, name), render(size, pad, round));
  console.error(`wrote icons/${name}`);
}

// SVG twin of the same mark, for the favicon + settings page
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#FFF9F2"/>
<circle cx="50" cy="50" r="40" fill="none" stroke="#E6D9BC" stroke-width="5"/>
<circle cx="50" cy="50" r="30" fill="#C7D9A0" stroke="#5C7038" stroke-width="1.8"/>
<circle cx="59" cy="41" r="11.5" fill="#EBCFD1"/>
<circle cx="59" cy="41" r="4.5" fill="#FFF9F2"/>
</svg>
`;
writeFileSync(resolve(out, 'icon.svg'), svg);
console.error('wrote icons/icon.svg');
