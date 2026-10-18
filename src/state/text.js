// Medios de texto generados (como «Títulos y texto» de VEGAS). Un texto es un medio sin archivo:
// { id, kind: 'text', name, text: TEXT_DEFAULTS, hasVideo: true, hasAudio: false, isImage: true }.
// Se dibuja con un canvas a tamaño de cuadro completo y fondo transparente; la vista previa usa ese
// canvas y el render, el mismo dibujo guardado como PNG, así que los dos coinciden.
// Las medidas son relativas: el tamaño de letra, a la altura del cuadro; contorno, sombra y espaciado,
// al tamaño de letra; la posición (x, y) es el centro del bloque de texto en fracciones del cuadro.
import { uid } from './project.js';

export const TEXT_DEFAULTS = {
  text: 'Texto de ejemplo',
  font: 'Arial',
  size: 0.1,
  bold: false,
  italic: false,
  color: '#ffffff',
  align: 'center', // left | center | right
  x: 0.5,
  y: 0.5,
  lineSpacing: 1.2,
  tracking: 0,
  outline: 0,
  outlineColor: '#000000',
  shadow: false,
  shadowColor: '#000000',
  shadowBlur: 0.1,
  shadowOffset: 0.06,
  background: '#000000',
  backgroundOpacity: 0, // fondo de todo el cuadro (0 = transparente, se ve lo de debajo)
};

export const TEXT_FONTS = [
  'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas',
  'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact',
  'Ink Free', 'Lucida Console', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI',
  'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
];

export const isText = (m) => m?.kind === 'text';

// Nombre del medio: la primera línea del texto (como en la lista de medios de VEGAS).
export function textName(params) {
  const line = (params.text || '').split('\n').find((l) => l.trim())?.trim() || 'Texto';
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

export function newTextMedia(params = {}) {
  const text = { ...TEXT_DEFAULTS, ...params };
  return { id: uid('m'), kind: 'text', name: textName(text), text, hasVideo: true, hasAudio: false, isImage: true, duration: null };
}

// Completa un medio de texto (al crearlo, abrirlo o cambiarlo) con su nombre y su miniatura.
export function withTextThumb(media, aspect) {
  const text = { ...TEXT_DEFAULTS, ...media.text };
  return { ...media, text, name: textName(text), thumb: textThumb(text, aspect) };
}

// Dibuja el texto en un contexto 2D de W×H (lo borra antes).
export function drawText(ctx, params, W, H) {
  const p = { ...TEXT_DEFAULTS, ...params };
  ctx.clearRect(0, 0, W, H);
  if (p.backgroundOpacity > 0) {
    ctx.globalAlpha = p.backgroundOpacity;
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  const px = Math.max(1, p.size * H);
  const lines = String(p.text ?? '').split('\n');
  ctx.font = `${p.italic ? 'italic ' : ''}${p.bold ? 'bold ' : ''}${px}px "${p.font}", sans-serif`;
  ctx.letterSpacing = `${p.tracking * px}px`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = p.align;
  ctx.lineJoin = 'round';
  const widths = lines.map((l) => ctx.measureText(l).width);
  const blockW = Math.max(0, ...widths);
  const lineH = px * p.lineSpacing;
  const cx = p.x * W;
  const top = p.y * H - (lineH * lines.length) / 2;
  const lineX = p.align === 'left' ? cx - blockW / 2 : p.align === 'right' ? cx + blockW / 2 : cx;
  const outline = p.outline * px;

  // shift: para dibujar solo la sombra, las letras se dibujan fuera del cuadro y la sombra se desplaza
  // de vuelta a su sitio (así la sombra va debajo de todo y las letras no se dibujan dos veces).
  const pass = (shift) => {
    lines.forEach((line, i) => {
      const y = top + lineH * (i + 0.5);
      if (outline > 0) {
        ctx.strokeStyle = p.outlineColor;
        ctx.lineWidth = outline * 2; // el trazo va centrado en el borde de la letra
        ctx.strokeText(line, lineX - shift, y);
      }
      ctx.fillStyle = p.color;
      ctx.fillText(line, lineX - shift, y);
    });
  };
  if (p.shadow) {
    const shift = W * 3 + 1000;
    ctx.save();
    ctx.shadowColor = p.shadowColor;
    ctx.shadowBlur = p.shadowBlur * px;
    ctx.shadowOffsetX = p.shadowOffset * px + shift;
    ctx.shadowOffsetY = p.shadowOffset * px;
    pass(shift);
    ctx.restore();
  }
  pass(0);
}

// Recuadro que ocupa el bloque de texto (con su contorno), en fracciones del cuadro: { left, top, width, height }.
// Usa las mismas medidas que drawText; sirve para moverlo y cambiar su tamaño en la vista previa.
let measureCtx = null;
export function textBounds(params, W, H) {
  const p = { ...TEXT_DEFAULTS, ...params };
  measureCtx ||= document.createElement('canvas').getContext('2d');
  const ctx = measureCtx;
  const px = Math.max(1, p.size * H);
  const lines = String(p.text ?? '').split('\n');
  ctx.font = `${p.italic ? 'italic ' : ''}${p.bold ? 'bold ' : ''}${px}px "${p.font}", sans-serif`;
  ctx.letterSpacing = `${p.tracking * px}px`;
  const pad = p.outline * px + px * 0.08;
  const w = Math.max(px * 0.5, ...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const h = px * p.lineSpacing * lines.length + pad * 2;
  return { left: p.x - w / W / 2, top: p.y - h / H / 2, width: w / W, height: h / H };
}

export function textCanvas(params, W, H) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  drawText(canvas.getContext('2d'), params, W, H);
  return canvas;
}

// PNG con fondo transparente a W×H para el render.
export const textPng = (params, W, H) => textCanvas(params, W, H).toDataURL('image/png');

// Miniatura (sobre negro, como se vería sin nada debajo) para la línea de tiempo y la lista de medios.
export function textThumb(params, aspect = 16 / 9) {
  const h = 108;
  const w = Math.max(32, Math.round(h * aspect));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const text = textCanvas(params, w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(text, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
}
