// Genera build/icon.png (512×512): pistas de colores y un cursor de reproducción sobre fondo oscuro.
// Uso: node scripts/make-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const SAMPLES = 4; // supermuestreo por eje para suavizar bordes

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function roundedRect(x0, y0, x1, y1, r) {
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
}

function triangle([ax, ay], [bx, by], [cx, cy]) {
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  return (x, y) => {
    const d1 = sign(x, y, ax, ay, bx, by);
    const d2 = sign(x, y, bx, by, cx, cy);
    const d3 = sign(x, y, cx, cy, ax, ay);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
}

// Capas de abajo arriba: [forma, color(x, y)]
const background = roundedRect(0.04, 0.04, 0.96, 0.96, 0.2);
const top = hex('#36363c');
const bottom = hex('#17171a');
const layers = [
  [background, (x, y) => top.map((c, i) => c + (bottom[i] - c) * y)],
  [roundedRect(0.14, 0.305, 0.6, 0.415, 0.03), () => hex('#5b80d6')],
  [roundedRect(0.28, 0.465, 0.86, 0.575, 0.03), () => hex('#9b66cf')],
  [roundedRect(0.14, 0.625, 0.5, 0.735, 0.03), () => hex('#d58a48')],
  [roundedRect(0.56, 0.625, 0.86, 0.735, 0.03), () => hex('#5aa86a')],
  [roundedRect(0.537, 0.2, 0.563, 0.82, 0.008), () => [242, 242, 242]],
  [triangle([0.485, 0.15], [0.615, 0.15], [0.55, 0.24]), () => [242, 242, 242]],
];

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const x = (px + (sx + 0.5) / SAMPLES) / SIZE;
        const y = (py + (sy + 0.5) / SAMPLES) / SIZE;
        let color = null;
        for (const [shape, fill] of layers) if (shape(x, y)) color = fill(x, y);
        if (color) {
          acc[0] += color[0];
          acc[1] += color[1];
          acc[2] += color[2];
          acc[3] += 1;
        }
      }
    }
    const o = (py * SIZE + px) * 4;
    const n = SAMPLES * SAMPLES;
    if (acc[3]) for (let i = 0; i < 3; i++) pixels[o + i] = Math.round(acc[i] / acc[3]);
    pixels[o + 3] = Math.round((acc[3] / n) * 255);
  }
}

// Codificación PNG mínima (RGBA de 8 bits, sin entrelazado).
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bits por canal
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`Icono generado: ${out}`);
