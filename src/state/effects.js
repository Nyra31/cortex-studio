// Catálogo de efectos de video de evento (FX de evento), agrupados como en la ventana de efectos de VEGAS.
//
// Cada efecto: { id, name, group, alpha?, params, ffmpeg | graph }
//   params: [{ id, label, type: 'range' | 'bool' | 'color', min, max, step, default, format? }]
//   ffmpeg(p, ctx) → cadena de filtros lineal (o '' si con esos valores no hace nada)
//   graph(p, ctx, inL, outL, tag) → subgrafo con ramas (etiquetas de entrada/salida dadas)
//   ctx = { w, h }: tamaño en píxeles de la imagen encajada a la que se aplica (sin las bandas negras).
// Las medidas (radios, tamaños de bloque) son relativas a la altura de la imagen, para que la vista
// previa (a menos resolución) y el render den el mismo resultado. La vista previa aplica las mismas
// fórmulas con shaders: ver preview/effects-gl.js.
import { uid } from './project.js';

export const EFFECT_MIME = 'application/x-cortex-effect';

const n = (v) => Number(v).toFixed(4);
const odd = (v) => Math.max(3, Math.min(23, Math.round(v) | 1));
const hex = (c) => `0x${c.replace('#', '')}`;
const pct = (v) => `${Math.round(v * 100)} %`;
const deg = (v) => `${Math.round(v)}°`;

// Radio del desenfoque (sigma en px) para una cantidad de 0 a 1: hasta el 3 % de la altura de la imagen.
export const blurSigma = (amount, h) => amount * h * 0.03;
// Lado del bloque de Pixelar: del 0,5 % al 10,5 % de la altura (proporcional, para que la vista previa
// a menos resolución quede igual; el render lo redondea a píxeles enteros).
export const pixelBlock = (size, h) => Math.max(1, h * (0.005 + size * 0.1));

export const EFFECT_GROUPS = [
  {
    name: 'Color',
    items: [
      {
        id: 'brightness',
        name: 'Brillo y contraste',
        params: [
          { id: 'brightness', label: 'Brillo', type: 'range', min: -1, max: 1, step: 0.01, default: 0, format: pct },
          { id: 'contrast', label: 'Contraste', type: 'range', min: -1, max: 1, step: 0.01, default: 0, format: pct },
        ],
        ffmpeg: (p) => (p.brightness || p.contrast ? `eq=brightness=${n(p.brightness)}:contrast=${n(1 + p.contrast)}` : ''),
      },
      {
        id: 'colorcorrect',
        name: 'Corrección de color',
        params: [
          { id: 'red', label: 'Rojo', type: 'range', min: 0, max: 2, step: 0.01, default: 1, format: pct },
          { id: 'green', label: 'Verde', type: 'range', min: 0, max: 2, step: 0.01, default: 1, format: pct },
          { id: 'blue', label: 'Azul', type: 'range', min: 0, max: 2, step: 0.01, default: 1, format: pct },
          { id: 'saturation', label: 'Saturación', type: 'range', min: 0, max: 2, step: 0.01, default: 1, format: pct },
        ],
        ffmpeg: (p) =>
          [
            p.red !== 1 || p.green !== 1 || p.blue !== 1 ? `colorchannelmixer=rr=${n(p.red)}:gg=${n(p.green)}:bb=${n(p.blue)}` : '',
            p.saturation !== 1 ? `hue=s=${n(p.saturation)}` : '',
          ].filter(Boolean).join(','),
      },
      {
        id: 'hsl',
        name: 'Tono, saturación y luminosidad',
        params: [
          { id: 'hue', label: 'Tono', type: 'range', min: -180, max: 180, step: 1, default: 0, format: deg },
          { id: 'saturation', label: 'Saturación', type: 'range', min: 0, max: 2, step: 0.01, default: 1, format: pct },
          { id: 'lightness', label: 'Luminosidad', type: 'range', min: -1, max: 1, step: 0.01, default: 0, format: pct },
        ],
        ffmpeg: (p) =>
          p.hue || p.saturation !== 1 || p.lightness ? `hue=h=${n(p.hue)}:s=${n(p.saturation)}:b=${n(p.lightness * 10)}` : '',
      },
      {
        id: 'blackwhite',
        name: 'Blanco y negro',
        params: [{ id: 'amount', label: 'Cantidad', type: 'range', min: 0, max: 1, step: 0.01, default: 1, format: pct }],
        ffmpeg: (p) => (p.amount ? `hue=s=${n(1 - p.amount)}` : ''),
      },
      {
        id: 'sepia',
        name: 'Sepia',
        params: [{ id: 'amount', label: 'Cantidad', type: 'range', min: 0, max: 1, step: 0.01, default: 1, format: pct }],
        ffmpeg: (p) => {
          if (!p.amount) return '';
          const m = sepiaMatrix(p.amount);
          const k = ['rr', 'rg', 'rb', 'gr', 'gg', 'gb', 'br', 'bg', 'bb'];
          return `colorchannelmixer=${k.map((key, i) => `${key}=${n(m[i])}`).join(':')}`;
        },
      },
      {
        id: 'invert',
        name: 'Invertir',
        params: [{ id: 'amount', label: 'Cantidad', type: 'range', min: 0, max: 1, step: 0.01, default: 1, format: pct }],
        ffmpeg: (p) => {
          if (!p.amount) return '';
          const e = `val*${n(1 - p.amount)}+negval*${n(p.amount)}`;
          return `lutrgb=r=${e}:g=${e}:b=${e}`;
        },
      },
    ],
  },
  {
    name: 'Desenfoque y nitidez',
    items: [
      {
        id: 'blur',
        name: 'Desenfoque gaussiano',
        params: [
          { id: 'horizontal', label: 'Horizontal', type: 'range', min: 0, max: 1, step: 0.01, default: 0.2, format: pct },
          { id: 'vertical', label: 'Vertical', type: 'range', min: 0, max: 1, step: 0.01, default: 0.2, format: pct },
        ],
        ffmpeg: (p, ctx) => {
          const sx = blurSigma(p.horizontal, ctx.h);
          const sy = blurSigma(p.vertical, ctx.h);
          return sx < 0.05 && sy < 0.05 ? '' : `format=gbrap,gblur=sigma=${n(sx)}:sigmaV=${n(sy)}`;
        },
      },
      {
        id: 'sharpen',
        name: 'Enfocar',
        params: [{ id: 'amount', label: 'Cantidad', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, format: pct }],
        ffmpeg: (p, ctx) => {
          const size = odd(ctx.h * 0.005);
          return p.amount ? `unsharp=lx=${size}:ly=${size}:la=${n(p.amount * 2)}:cx=3:cy=3:ca=0` : '';
        },
      },
      {
        id: 'glow',
        name: 'Brillo difuso',
        params: [
          { id: 'threshold', label: 'Umbral', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6, format: pct },
          { id: 'intensity', label: 'Intensidad', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6, format: pct },
          { id: 'radius', label: 'Radio', type: 'range', min: 0, max: 1, step: 0.01, default: 0.3, format: pct },
        ],
        // Las zonas por encima del umbral se desenfocan y se suman en modo "trama" (screen).
        graph: (p, ctx, inL, outL, tag) => {
          if (!p.intensity) return `[${inL}]null[${outL}]`;
          const t = Math.round(p.threshold * 255);
          const keep = `'if(gt(val,${t}),val,0)'`;
          const sigma = Math.max(0.05, blurSigma(p.radius, ctx.h));
          return (
            `[${inL}]format=gbrap,split[${tag}a][${tag}b];` +
            `[${tag}b]lutrgb=r=${keep}:g=${keep}:b=${keep},gblur=sigma=${n(sigma)}[${tag}c];` +
            `[${tag}a][${tag}c]blend=all_mode=screen:all_opacity=${n(p.intensity)}[${outL}]`
          );
        },
      },
    ],
  },
  {
    name: 'Estilizar',
    items: [
      {
        id: 'pixelate',
        name: 'Pixelar',
        params: [{ id: 'size', label: 'Tamaño', type: 'range', min: 0, max: 1, step: 0.01, default: 0.2, format: pct }],
        ffmpeg: (p, ctx) => {
          const b = Math.max(2, Math.round(pixelBlock(p.size, ctx.h)));
          return `pixelize=width=${b}:height=${b}:mode=avg`;
        },
      },
      {
        id: 'vignette',
        name: 'Viñeta',
        params: [{ id: 'amount', label: 'Intensidad', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, format: pct }],
        ffmpeg: (p) => (p.amount ? `vignette=angle=${n((p.amount * Math.PI) / 2)}` : ''),
      },
      {
        id: 'mirror',
        name: 'Espejo',
        params: [
          { id: 'horizontal', label: 'Voltear en horizontal', type: 'bool', default: true },
          { id: 'vertical', label: 'Voltear en vertical', type: 'bool', default: false },
        ],
        ffmpeg: (p) => [p.horizontal ? 'hflip' : '', p.vertical ? 'vflip' : ''].filter(Boolean).join(','),
      },
    ],
  },
  {
    name: 'Composición',
    items: [
      {
        id: 'chromakey',
        name: 'Croma',
        alpha: true,
        params: [
          { id: 'color', label: 'Color', type: 'color', default: '#00ff00' },
          { id: 'similarity', label: 'Similitud', type: 'range', min: 0.01, max: 1, step: 0.01, default: 0.3, format: pct },
          { id: 'blend', label: 'Suavizado', type: 'range', min: 0, max: 1, step: 0.01, default: 0.1, format: pct },
        ],
        ffmpeg: (p) => `format=rgba,colorkey=color=${hex(p.color)}:similarity=${n(p.similarity)}:blend=${n(p.blend)}`,
      },
    ],
  },
];

// Matriz sepia clásica mezclada con la identidad según la cantidad (por filas: r, g, b).
export function sepiaMatrix(a) {
  const s = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return s.map((v, i) => id[i] + (v - id[i]) * a);
}

// id → definición (con group e index para la interfaz)
export const EFFECTS = new Map();
for (const group of EFFECT_GROUPS) {
  for (const item of group.items) EFFECTS.set(item.id, { ...item, group: group.name, index: EFFECTS.size });
}

export function effectDefaults(type) {
  return Object.fromEntries(EFFECTS.get(type).params.map((p) => [p.id, p.default]));
}

export const newEffect = (type) => ({ id: uid('x'), type, enabled: true, params: effectDefaults(type) });

// Efectos que de verdad hay que aplicar, con los parámetros completos (los que falten, por defecto).
export function activeEffects(effects) {
  return (effects || [])
    .filter((fx) => fx.enabled !== false && EFFECTS.has(fx.type))
    .map((fx) => ({ ...fx, params: { ...effectDefaults(fx.type), ...fx.params } }));
}

// Subgrafo de FFmpeg con toda la cadena de efectos de un evento, entre las etiquetas @IN@ y @OUT@
// (@N@ es un prefijo único que pone el proceso principal). alpha: si deja transparencia (croma).
export function effectsGraph(effects, ctx) {
  const list = activeEffects(effects);
  if (!list.length) return null;
  const parts = [];
  let chain = [];
  let cur = '@IN@';
  let k = 0;
  let alpha = false;
  const flush = (out) => {
    parts.push(`[${cur}]${chain.length ? chain.join(',') : 'null'}[${out}]`);
    chain = [];
    cur = out;
  };
  for (const fx of list) {
    const def = EFFECTS.get(fx.type);
    if (def.alpha) alpha = true;
    if (def.graph) {
      flush(`@N@s${k++}`);
      const out = `@N@s${k++}`;
      parts.push(def.graph(fx.params, ctx, cur, out, `@N@g${k}`));
      cur = out;
    } else {
      const f = def.ffmpeg(fx.params, ctx);
      if (f) chain.push(f);
    }
  }
  flush('@OUT@');
  return { graph: parts.join(';'), alpha };
}
