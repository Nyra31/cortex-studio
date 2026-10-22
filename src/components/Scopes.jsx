import { useEffect, useRef, useState } from 'react';
import { setScopeListener } from '../preview/scopes.js';

// Monitores de video (como los de VEGAS): histograma, forma de onda (luma por columnas) y vectorescopio, del
// fotograma de la vista previa. Luma y croma con los coeficientes BT.709 (video HD), en % (0 = negro, 100 = blanco).
const KR = 0.2126;
const KB = 0.0722;
const KG = 1 - KR - KB;
const luma = (r, g, b) => KR * r + KG * g + KB * b;
const chroma = (r, g, b) => {
  const y = luma(r, g, b);
  return [(b - y) / (2 * (1 - KB)), (r - y) / (2 * (1 - KR))]; // Cb, Cr de −0,5 a 0,5 (con r, g, b de 0 a 1)
};
const MODES = [
  { id: 'histogram', label: 'Histograma' },
  { id: 'waveform', label: 'Forma de onda' },
  { id: 'rgbparade', label: 'Desfile RGB' },
  { id: 'vectorscope', label: 'Vectorescopio' },
];
// Colores al 75 % (barras de color) para las casillas del vectorescopio.
const TARGETS = [['R', 0.75, 0, 0], ['Mg', 0.75, 0, 0.75], ['B', 0, 0, 0.75], ['Cy', 0, 0.75, 0.75], ['G', 0, 0.75, 0], ['Yl', 0.75, 0.75, 0]];

export default function Scopes() {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem('cortex-scope') || 'waveform';
    } catch {
      return 'waveform';
    }
  });
  const canvasRef = useRef(null);
  const frame = useRef(null);
  const draw = useRef(() => {});

  useEffect(() => {
    try {
      localStorage.setItem('cortex-scope', mode);
    } catch {
      // sin almacenamiento
    }
    draw.current = () => paint(canvasRef.current, frame.current, mode);
    draw.current();
  }, [mode]);

  useEffect(() => {
    setScopeListener((data) => {
      frame.current = data;
      draw.current();
    });
    const ro = new ResizeObserver(() => draw.current());
    ro.observe(canvasRef.current);
    return () => {
      setScopeListener(null);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="scopes">
      <div className="dock-toolbar">
        <select className="dock-select" value={mode} onChange={(e) => setMode(e.target.value)}>
          {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <span className="dock-toolbar-label">Fotograma de la vista previa</span>
      </div>
      <canvas ref={canvasRef} className="scope-canvas" />
    </div>
  );
}

function paint(canvas, frame, mode) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const H = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, W, H);
  const pad = Math.round(8 * dpr);
  ctx.font = `${Math.round(10 * dpr)}px sans-serif`;
  if (mode === 'vectorscope') vectorscope(ctx, frame, W, H, pad, dpr);
  else if (mode === 'histogram') histogram(ctx, frame, W, H, pad, dpr);
  else waveform(ctx, frame, W, H, pad, dpr, mode === 'rgbparade');
}

// Escala en % a la izquierda (0, 25, 50, 75, 100) y área de dibujo.
function graticule(ctx, W, H, pad, dpr) {
  const left = pad + Math.round(22 * dpr);
  const area = { x: left, y: pad, w: W - left - pad, h: H - pad * 2 };
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  for (const p of [0, 25, 50, 75, 100]) {
    const y = Math.round(area.y + area.h * (1 - p / 100)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(area.x, y);
    ctx.lineTo(area.x + area.w, y);
    ctx.stroke();
    ctx.fillText(String(p), pad, y + 3 * dpr);
  }
  return area;
}

// Forma de onda: cada columna del fotograma, sus niveles de luma (o de R, G y B por separado, en tres partes) de
// abajo (0 %) arriba (100 %); más brillo donde coinciden más píxeles.
function waveform(ctx, frame, W, H, pad, dpr, parade) {
  const area = graticule(ctx, W, H, pad, dpr);
  if (!frame || area.w < 4 || area.h < 4) return;
  const { w, h, data } = frame;
  const levels = Math.min(256, Math.round(area.h));
  const parts = parade ? 3 : 1;
  const cols = Math.min(Math.round(area.w), w * parts); // no más columnas que las del fotograma (si no, quedan huecos)
  const img = ctx.createImageData(cols, levels);
  const counts = new Float32Array(cols * levels * parts);
  const colW = cols / parts;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const values = parade ? [r, g, b] : [luma(r, g, b)];
      for (let k = 0; k < parts; k++) {
        const cx = Math.min(cols - 1, Math.floor(k * colW + (x / w) * colW));
        const lv = Math.min(levels - 1, Math.round(values[k] * (levels - 1)));
        counts[((levels - 1 - lv) * cols + cx) * parts + k]++;
      }
    }
  }
  const scale = (4 * levels) / h; // más píxeles por columna = más brillo; se satura pronto para que se vea
  const tint = parade ? [[255, 80, 80], [80, 255, 80], [90, 140, 255]] : [[170, 255, 170]];
  for (let p = 0; p < cols * levels; p++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let k = 0; k < parts; k++) {
      const c = counts[p * parts + k];
      if (!c) continue;
      const v = Math.min(1, 0.35 + Math.sqrt(c * scale) * 0.6);
      r += tint[k][0] * v;
      g += tint[k][1] * v;
      b += tint[k][2] * v;
    }
    img.data[p * 4] = Math.min(255, r);
    img.data[p * 4 + 1] = Math.min(255, g);
    img.data[p * 4 + 2] = Math.min(255, b);
    img.data[p * 4 + 3] = r + g + b > 0 ? 255 : 0;
  }
  blit(ctx, img, area);
}

// Histograma: cuántos píxeles hay de cada nivel (de 0 % a la izquierda a 100 % a la derecha), de R, G, B y luma.
function histogram(ctx, frame, W, H, pad) {
  const area = { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 };
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  for (const p of [0, 25, 50, 75, 100]) {
    const x = Math.round(area.x + (area.w * p) / 100) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, area.y);
    ctx.lineTo(x, area.y + area.h);
    ctx.stroke();
  }
  if (!frame) return;
  const { data } = frame;
  const bins = [new Float32Array(256), new Float32Array(256), new Float32Array(256), new Float32Array(256)];
  for (let i = 0; i < data.length; i += 4) {
    bins[0][data[i]]++;
    bins[1][data[i + 1]]++;
    bins[2][data[i + 2]]++;
    bins[3][Math.round(luma(data[i], data[i + 1], data[i + 2]))]++;
  }
  // Escala: el máximo sin contar los extremos (negro y blanco puros suelen ser picos que lo aplastarían todo).
  const max = Math.max(1, ...bins.map((b) => Math.max(...b.slice(1, 255))));
  ctx.globalCompositeOperation = 'lighter';
  const colors = ['rgba(255,70,70,0.55)', 'rgba(70,255,70,0.5)', 'rgba(80,130,255,0.6)'];
  const plot = (b, fill, stroke) => {
    ctx.beginPath();
    ctx.moveTo(area.x, area.y + area.h);
    for (let v = 0; v < 256; v++) ctx.lineTo(area.x + (area.w * v) / 255, area.y + area.h * (1 - Math.min(1, b[v] / max)));
    ctx.lineTo(area.x + area.w, area.y + area.h);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  };
  for (let k = 0; k < 3; k++) plot(bins[k], colors[k]);
  ctx.globalCompositeOperation = 'source-over';
  plot(bins[3], null, 'rgba(255,255,255,0.9)');
}

// Vectorescopio: tono (ángulo) y saturación (distancia al centro) de cada píxel, con las casillas de los colores
// al 75 % y la línea del tono de piel.
function vectorscope(ctx, frame, W, H, pad, dpr) {
  const size = Math.min(W, H) - pad * 2;
  if (size < 8) return;
  const cx = W / 2;
  const cy = H / 2;
  const R = size / 2;
  const at = (cb, cr) => [cx + cb * 2 * R * 0.9, cy - cr * 2 * R * 0.9];
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.9, 0, Math.PI * 2);
  ctx.moveTo(cx - R, cy);
  ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R);
  ctx.lineTo(cx, cy + R);
  ctx.stroke();
  if (frame) {
    const n = Math.round(size);
    const img = ctx.createImageData(n, n);
    const counts = new Float32Array(n * n * 4);
    const { data } = frame;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const [cb, cr] = chroma(r, g, b);
      const x = Math.round(n / 2 + cb * n * 0.9);
      const y = Math.round(n / 2 - cr * n * 0.9);
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const p = (y * n + x) * 4;
      counts[p] += r;
      counts[p + 1] += g;
      counts[p + 2] += b;
      counts[p + 3]++;
    }
    const scale = (n * n) / (data.length / 4) / 6;
    for (let p = 0; p < counts.length; p += 4) {
      const c = counts[p + 3];
      if (!c) continue;
      const v = Math.min(1, Math.sqrt(c * scale));
      // Color del propio píxel (más claro), para reconocer qué es cada mancha.
      img.data[p] = Math.min(255, (80 + (175 * counts[p]) / c) * v);
      img.data[p + 1] = Math.min(255, (80 + (175 * counts[p + 1]) / c) * v);
      img.data[p + 2] = Math.min(255, (80 + (175 * counts[p + 2]) / c) * v);
      img.data[p + 3] = 255;
    }
    blit(ctx, img, { x: cx - n / 2, y: cy - n / 2, w: n, h: n });
  }
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (const [name, r, g, b] of TARGETS) {
    const [x, y] = at(...chroma(r, g, b));
    const s = 5 * dpr;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.strokeRect(x - s, y - s, s * 2, s * 2);
    ctx.fillText(name, x + s + 2, y + 3 * dpr);
  }
  // Línea del tono de piel (unos 123° en el vectorescopio, entre el rojo y el amarillo).
  const [sx, sy] = at(...chroma(0.8, 0.55, 0.42));
  const len = Math.hypot(sx - cx, sy - cy) || 1;
  ctx.strokeStyle = 'rgba(255,200,150,0.35)';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + ((sx - cx) / len) * R * 0.9, cy + ((sy - cy) / len) * R * 0.9);
  ctx.stroke();
}

// Dibuja una imagen calculada en un área del lienzo, escalada.
function blit(ctx, img, area) {
  const tmp = document.createElement('canvas');
  tmp.width = img.width;
  tmp.height = img.height;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, area.x, area.y, area.w, area.h);
}
