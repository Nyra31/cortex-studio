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
  animIn: 'none', // animación de entrada (TEXT_ANIMS) y su duración en s
  animInDur: 0.6,
  animOut: 'none',
  animOutDur: 0.6,
};

export const TEXT_FONTS = [
  'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas',
  'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact',
  'Ink Free', 'Lucida Console', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI',
  'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
];

// Plantillas de títulos: un estilo completo (fuente, colores, posición y animaciones) que se aplica al texto que
// ya hay. Lo que no dicen vuelve al valor por defecto.
export const TEXT_TEMPLATES = [
  {
    id: 'title', name: 'Título grande',
    params: { font: 'Montserrat', bold: true, size: 0.12, shadow: true, shadowBlur: 0.15, shadowOffset: 0.04, animIn: 'fade', animInDur: 0.8, animOut: 'fade', animOutDur: 0.8 },
  },
  {
    id: 'lower', name: 'Rótulo inferior (nombre y cargo)',
    params: { font: 'Roboto', bold: true, size: 0.055, align: 'left', x: 0.27, y: 0.83, shadow: true, shadowBlur: 0.2, shadowOffset: 0.05, animIn: 'left', animInDur: 0.6, animOut: 'left', animOutDur: 0.5 },
  },
  {
    id: 'subtitle', name: 'Subtítulo',
    params: { font: 'Open Sans', size: 0.05, y: 0.88, outline: 0.08, animIn: 'fade', animInDur: 0.15, animOut: 'fade', animOutDur: 0.15 },
  },
  {
    id: 'cinema', name: 'Cine',
    params: { font: 'Cinzel', size: 0.08, tracking: 0.25, color: '#f2e6c9', animIn: 'fade', animInDur: 1.5, animOut: 'fade', animOutDur: 1.5 },
  },
  {
    id: 'impact', name: 'Impacto',
    params: { font: 'Anton', size: 0.16, color: '#ffd400', outline: 0.06, animIn: 'zoom', animInDur: 0.35, animOut: 'fade', animOutDur: 0.4 },
  },
  {
    id: 'neon', name: 'Neón',
    params: { font: 'Audiowide', size: 0.1, color: '#c8fbff', shadow: true, shadowColor: '#00e5ff', shadowBlur: 0.5, shadowOffset: 0, animIn: 'reveal', animInDur: 0.8, animOut: 'fade', animOutDur: 0.5 },
  },
  {
    id: 'typewriter', name: 'Máquina de escribir',
    params: { font: 'Special Elite', size: 0.07, color: '#f0f0f0', animIn: 'typewriter', animInDur: 1.5, animOut: 'fade', animOutDur: 0.5 },
  },
  {
    id: 'retro', name: 'Videojuego retro',
    params: { font: 'Press Start 2P', size: 0.06, color: '#39ff14', shadow: true, shadowColor: '#0a3d00', shadowBlur: 0, shadowOffset: 0.12, animIn: 'bottom', animInDur: 0.5, animOut: 'top', animOutDur: 0.5 },
  },
  {
    id: 'handwritten', name: 'Manuscrito',
    params: { font: 'Pacifico', size: 0.1, shadow: true, shadowBlur: 0.2, shadowOffset: 0.03, animIn: 'reveal', animInDur: 1.2, animOut: 'fade', animOutDur: 0.6 },
  },
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

// Animaciones de entrada y salida (TEXT_DEFAULTS.animIn / animOut, con sus duraciones en s). Las de deslizar
// llevan el bloque de texto desde fuera del cuadro (o hasta fuera); la de zoom lo agranda desde el 20 % mientras
// aparece; revelar lo descubre de izquierda a derecha; la máquina de escribir enseña las letras de una en una.
export const TEXT_ANIMS = [
  { id: 'none', in: 'Ninguna', out: 'Ninguna' },
  { id: 'fade', in: 'Aparecer', out: 'Desaparecer' },
  { id: 'left', in: 'Entrar desde la izquierda', out: 'Salir por la izquierda' },
  { id: 'right', in: 'Entrar desde la derecha', out: 'Salir por la derecha' },
  { id: 'top', in: 'Bajar desde arriba', out: 'Salir por arriba' },
  { id: 'bottom', in: 'Subir desde abajo', out: 'Salir por abajo' },
  { id: 'zoom', in: 'Acercar (zoom)', out: 'Alejar (zoom)' },
  { id: 'reveal', in: 'Revelar de izquierda a derecha', out: 'Ocultar de derecha a izquierda' },
  { id: 'typewriter', in: 'Máquina de escribir', out: 'Borrar letra a letra' },
];
export const hasTextAnim = (params) => {
  const p = { ...TEXT_DEFAULTS, ...params };
  return p.animIn !== 'none' || p.animOut !== 'none';
};

// Animaciones en curso en el instante local (s desde el principio del evento, que dura `duration`): lista de
// { type, q } (q = cuánto se ve, de 0 a 1) o null si en ese instante el texto está quieto.
export function textAnimAt(params, local, duration) {
  const p = { ...TEXT_DEFAULTS, ...params };
  const dIn = Math.min(p.animInDur, duration / 2);
  const dOut = Math.min(p.animOutDur, duration / 2);
  const parts = [];
  if (p.animIn !== 'none' && dIn > 0 && local < dIn) parts.push({ type: p.animIn, q: Math.max(0, local) / dIn });
  if (p.animOut !== 'none' && dOut > 0 && local > duration - dOut) parts.push({ type: p.animOut, q: Math.max(0, duration - local) / dOut });
  return parts.length ? parts : null;
}

let scratch = null; // lienzo auxiliar para las animaciones que mueven, escalan o recortan el texto

// Dibuja el texto en un contexto 2D de W×H (lo borra antes). anim: animaciones en curso (textAnimAt) o null.
export function drawText(ctx, params, W, H, anim = null) {
  const p = { ...TEXT_DEFAULTS, ...params };
  ctx.clearRect(0, 0, W, H);
  const px = Math.max(1, p.size * H);
  const lines = String(p.text ?? '').split('\n');
  const font = `${p.italic ? 'italic ' : ''}${p.bold ? 'bold ' : ''}${px}px "${p.font}", sans-serif`;
  ctx.font = font;
  ctx.letterSpacing = `${p.tracking * px}px`;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const blockW = Math.max(0, ...widths);
  const lineH = px * p.lineSpacing;
  const blockH = lineH * lines.length;
  const cx = p.x * W;
  const cy = p.y * H;
  const pad = p.outline * px + (p.shadow ? (p.shadowOffset + p.shadowBlur) * px : 0) + px * 0.1;

  // Estado de la animación en este instante.
  let alpha = 1;
  let dx = 0;
  let dy = 0;
  let scale = 1;
  let reveal = 1;
  let chars = Infinity;
  for (const { type, q } of anim || []) {
    const e = 1 - (1 - q) ** 3; // frena al llegar
    if (type === 'fade') alpha *= q;
    else if (type === 'left') dx -= (1 - e) * (cx + blockW / 2 + pad);
    else if (type === 'right') dx += (1 - e) * (W - (cx - blockW / 2) + pad);
    else if (type === 'top') dy -= (1 - e) * (cy + blockH / 2 + pad);
    else if (type === 'bottom') dy += (1 - e) * (H - (cy - blockH / 2) + pad);
    else if (type === 'zoom') {
      scale *= 0.2 + 0.8 * e;
      alpha *= q;
    } else if (type === 'reveal') reveal = Math.min(reveal, q);
    else if (type === 'typewriter') chars = Math.min(chars, Math.round(q * lines.reduce((n, l) => n + [...l].length, 0)));
  }

  if (p.backgroundOpacity > 0) {
    ctx.globalAlpha = p.backgroundOpacity * alpha;
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  const moved = dx !== 0 || dy !== 0 || scale !== 1 || reveal < 1;
  // Con movimiento, escala o revelado, las letras se dibujan aparte y se copian transformadas (la sombra se
  // dibuja con un desplazamiento que no seguiría a la escala).
  let target = ctx;
  if (moved) {
    scratch ||= document.createElement('canvas');
    if (scratch.width !== W || scratch.height !== H) {
      scratch.width = W;
      scratch.height = H;
    }
    target = scratch.getContext('2d');
    target.clearRect(0, 0, W, H);
  }
  target.font = font;
  target.letterSpacing = `${p.tracking * px}px`;
  target.textBaseline = 'middle';
  target.lineJoin = 'round';
  const top = cy - blockH / 2;
  const lineX = p.align === 'left' ? cx - blockW / 2 : p.align === 'right' ? cx + blockW / 2 : cx;
  const outline = p.outline * px;

  // shift: para dibujar solo la sombra, las letras se dibujan fuera del cuadro y la sombra se desplaza
  // de vuelta a su sitio (así la sombra va debajo de todo y las letras no se dibujan dos veces).
  // Máquina de escribir: cada línea se escribe desde su principio (en su sitio de siempre) hasta la letra que toca.
  const pass = (shift) => {
    let left = chars;
    lines.forEach((line, i) => {
      const y = top + lineH * (i + 0.5);
      let text = line;
      let x = lineX - shift;
      target.textAlign = p.align;
      if (Number.isFinite(chars)) {
        const all = [...line];
        text = all.slice(0, Math.max(0, left)).join('');
        left -= all.length;
        target.textAlign = 'left';
        x = (p.align === 'left' ? lineX : p.align === 'right' ? lineX - widths[i] : lineX - widths[i] / 2) - shift;
      }
      if (!text) return;
      if (outline > 0) {
        target.strokeStyle = p.outlineColor;
        target.lineWidth = outline * 2; // el trazo va centrado en el borde de la letra
        target.strokeText(text, x, y);
      }
      target.fillStyle = p.color;
      target.fillText(text, x, y);
    });
  };
  if (!moved) target.globalAlpha = alpha;
  if (p.shadow) {
    const shift = W * 3 + 1000;
    target.save();
    target.shadowColor = p.shadowColor;
    target.shadowBlur = p.shadowBlur * px;
    target.shadowOffsetX = p.shadowOffset * px + shift;
    target.shadowOffsetY = p.shadowOffset * px;
    pass(shift);
    target.restore();
  }
  pass(0);
  target.globalAlpha = 1;
  if (moved) {
    ctx.save();
    ctx.globalAlpha = alpha;
    if (reveal < 1) {
      const x0 = cx - blockW / 2 - pad;
      ctx.beginPath();
      ctx.rect(x0, 0, (blockW + pad * 2) * reveal, H);
      ctx.clip();
    }
    ctx.translate(cx + dx, cy + dy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
  }
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

export function textCanvas(params, W, H, anim = null) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  drawText(canvas.getContext('2d'), params, W, H, anim);
  return canvas;
}

// PNG con fondo transparente a W×H para el render.
export const textPng = (params, W, H, anim = null) => textCanvas(params, W, H, anim).toDataURL('image/png');

// Texto animado para el render: los fotogramas del evento (duration s a fps) como PNG con su duración, juntando los
// seguidos que son iguales (todo el tramo quieto es uno solo). El fotograma k se dibuja en el instante k/fps.
export function textSequence(params, W, H, duration, fps) {
  const items = [];
  const n = Math.max(1, Math.ceil(duration * fps - 1e-6));
  let lastKey = null;
  for (let k = 0; k < n; k++) {
    const anim = textAnimAt(params, k / fps, duration);
    const key = JSON.stringify(anim);
    if (key === lastKey) {
      items[items.length - 1].dur += 1 / fps;
      continue;
    }
    items.push({ png: textPng(params, W, H, anim), dur: 1 / fps });
    lastKey = key;
  }
  return items;
}

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
