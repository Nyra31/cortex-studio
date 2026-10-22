// Catálogo de efectos de video de evento (FX de evento), agrupados como en la ventana de efectos de VEGAS.
//
// Cada efecto: { id, name, group, alpha?, params, ffmpeg | graph }
//   params: [{ id, label, type: 'range' | 'bool' | 'color', min, max, step, default, format? }]
//   ffmpeg(p, ctx) → cadena de filtros lineal (o '' si con esos valores no hace nada)
//   graph(p, ctx, inL, outL, tag) → subgrafo con ramas (etiquetas de entrada/salida dadas)
//   ctx = { w, h, alpha, keep }: tamaño en píxeles de la imagen encajada a la que se aplica (sin las bandas
//   negras) y si tiene transparencia (textos, PNG con alfa): entonces los filtros que no la admiten la conservan
//   aparte. keep: con fotogramas clave, los filtros se ponen siempre (aunque con esos valores no hagan nada),
//   para que el grafo sea el mismo en todo el evento y el render solo les cambie los valores.
//   animatable: false (en el efecto o en un parámetro) = no se puede animar con fotogramas clave: su filtro no
//   admite cambios en marcha (unsharp, vignette) o el valor no se puede mandar como comando (umbral del brillo difuso).
// Fotogramas clave del efecto (fx.keyframes, como en VEGAS): [{ t, params }] con t desde el principio del
// evento; con dos o más, los valores numéricos se interpolan linealmente y los demás cambian al llegar al
// fotograma clave. Ver fxParamsAt y, para el render, effectsGraph (comandos de sendcmd).
// Las medidas (radios, tamaños de bloque) son relativas a la altura de la imagen, para que la vista
// previa (a menos resolución) y el render den el mismo resultado. La vista previa aplica las mismas
// fórmulas con shaders: ver preview/effects-gl.js.
import { uid } from './project.js';
import { AUDIO_EFFECT_GROUPS } from './audio-effects.js';

export { AUDIO_EFFECT_GROUPS };

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

// ---- Corrector de color de tres vías, curvas y LUT ----

// Ruedas de color: el punto (x, y) de la rueda (radio 1) es un desplazamiento de color de media cero: hacia el rojo
// (ángulo 0), el verde (120°) o el azul (240°), con la fuerza de su distancia al centro.
export function wheelShift(x, y) {
  const r = Math.min(1, Math.hypot(x, y));
  const a = Math.atan2(y, x);
  return [0, 1, 2].map((k) => r * Math.cos(a - (k * 2 * Math.PI) / 3));
}
// Valores por canal (R, G, B) del corrector: sombras (lift: se suma, sobre todo a lo oscuro), medios (gamma:
// exponente) y luces (gain: multiplica).
export function gradeChannels(p) {
  const L = wheelShift(p.liftX, p.liftY);
  const G = wheelShift(p.gammaX, p.gammaY);
  const K = wheelShift(p.gainX, p.gainY);
  return {
    lift: L.map((s) => p.lift + 0.25 * s),
    gamma: G.map((s) => 2 ** (p.gamma + 0.5 * s)),
    gain: K.map((s) => 1 + p.gain + 0.5 * s),
  };
}

// Curvas: puntos «x/y x/y …» (de 0 a 1, como el filtro curves de FFmpeg) → tabla de n valores de 0 a 1 con la
// misma spline cúbica natural que usa FFmpeg (antes del primer punto y después del último, su valor).
export function parseCurve(s) {
  const pts = String(s || '').trim().split(/\s+/).map((t) => t.split('/').map(Number))
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y]) => ({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }))
    .sort((a, b) => a.x - b.x);
  return pts.length ? pts : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
}
export const curveString = (pts) => pts.map((p) => `${p.x.toFixed(3)}/${p.y.toFixed(3)}`).join(' ');
export function curveTable(s, n = 256) {
  const pts = parseCurve(s);
  const m = pts.length;
  const out = new Float32Array(n);
  if (m === 1) return out.fill(pts[0].y);
  // Segundas derivadas (spline natural: 0 en los extremos), sistema tridiagonal.
  const h = pts.slice(0, -1).map((p, i) => pts[i + 1].x - p.x || 1e-6);
  const d = new Float64Array(m);
  if (m > 2) {
    const a = new Float64Array(m);
    const b = new Float64Array(m);
    const c = new Float64Array(m);
    const r = new Float64Array(m);
    b[0] = 1;
    b[m - 1] = 1;
    for (let i = 1; i < m - 1; i++) {
      a[i] = h[i - 1];
      b[i] = 2 * (h[i - 1] + h[i]);
      c[i] = h[i];
      r[i] = 6 * ((pts[i + 1].y - pts[i].y) / h[i] - (pts[i].y - pts[i - 1].y) / h[i - 1]);
    }
    for (let i = 1; i < m; i++) {
      const w = a[i] / b[i - 1];
      b[i] -= w * c[i - 1];
      r[i] -= w * r[i - 1];
    }
    d[m - 1] = r[m - 1] / b[m - 1];
    for (let i = m - 2; i >= 0; i--) d[i] = (r[i] - c[i] * d[i + 1]) / b[i];
  }
  let k = 0;
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    let y;
    if (x <= pts[0].x) y = pts[0].y;
    else if (x >= pts[m - 1].x) y = pts[m - 1].y;
    else {
      while (k < m - 2 && x > pts[k + 1].x) k++;
      const t = x - pts[k].x;
      const hk = h[k];
      const a3 = (d[k + 1] - d[k]) / (6 * hk);
      const a2 = d[k] / 2;
      const a1 = (pts[k + 1].y - pts[k].y) / hk - (hk * (2 * d[k] + d[k + 1])) / 6;
      y = pts[k].y + a1 * t + a2 * t * t + a3 * t * t * t;
    }
    out[i] = Math.min(1, Math.max(0, y));
  }
  return out;
}
const IDENTITY_CURVE = '0/0 1/1';
const isIdentityCurve = (s) => curveString(parseCurve(s)) === curveString(parseCurve(IDENTITY_CURVE));

// LUT .cube: el render la copia a la carpeta temporal con este nombre (FFmpeg trabaja allí), para no tener que
// escapar la ruta dentro del filtro.
export function lutName(file) {
  let h = 2166136261;
  for (const ch of String(file)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `cortex-lut-${h.toString(16)}.cube`;
}

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
        ffmpeg: (p, ctx) => (ctx.keep || p.brightness || p.contrast ? `eq=brightness=${n(p.brightness)}:contrast=${n(1 + p.contrast)}` : ''),
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
        ffmpeg: (p, ctx) =>
          [
            ctx.keep || p.red !== 1 || p.green !== 1 || p.blue !== 1 ? `colorchannelmixer=rr=${n(p.red)}:gg=${n(p.green)}:bb=${n(p.blue)}` : '',
            ctx.keep || p.saturation !== 1 ? `hue=s=${n(p.saturation)}` : '',
          ].filter(Boolean).join(','),
      },
      {
        // Como el «Corrector de color (tres vías)» de VEGAS: una rueda y un nivel para sombras, medios y luces.
        id: 'colorwheels',
        name: 'Corrector de color (tres vías)',
        animatable: false, // las expresiones de lutrgb llevan comas y no se pueden mandar como comando
        params: [
          { id: 'liftX', label: 'Sombras', type: 'range', min: -1, max: 1, step: 0.01, default: 0, wheel: 'liftY' },
          { id: 'liftY', type: 'range', min: -1, max: 1, step: 0.01, default: 0, hidden: true },
          { id: 'lift', label: 'Nivel de sombras', type: 'range', min: -0.5, max: 0.5, step: 0.005, default: 0, format: pct },
          { id: 'gammaX', label: 'Medios', type: 'range', min: -1, max: 1, step: 0.01, default: 0, wheel: 'gammaY' },
          { id: 'gammaY', type: 'range', min: -1, max: 1, step: 0.01, default: 0, hidden: true },
          { id: 'gamma', label: 'Nivel de medios', type: 'range', min: -1, max: 1, step: 0.01, default: 0, format: pct },
          { id: 'gainX', label: 'Luces', type: 'range', min: -1, max: 1, step: 0.01, default: 0, wheel: 'gainY' },
          { id: 'gainY', type: 'range', min: -1, max: 1, step: 0.01, default: 0, hidden: true },
          { id: 'gain', label: 'Nivel de luces', type: 'range', min: -1, max: 1, step: 0.01, default: 0, format: pct },
          { id: 'saturation', label: 'Saturación', type: 'range', min: 0, max: 2, step: 0.01, default: 1, format: pct },
        ],
        ffmpeg: (p) => {
          const { lift, gamma, gain } = gradeChannels(p);
          const graded = [lift, gamma, gain].some((v, j) => v.some((x) => x !== [0, 1, 1][j]));
          const expr = (c) => `'255*clip(pow(clip(val/255+${n(lift[c])}*(1-val/255),0,1),${n(1 / gamma[c])})*${n(gain[c])},0,1)'`;
          return [
            graded ? `lutrgb=r=${expr(0)}:g=${expr(1)}:b=${expr(2)}` : '',
            p.saturation !== 1 ? `hue=s=${n(p.saturation)}` : '',
          ].filter(Boolean).join(',');
        },
      },
      {
        id: 'curves',
        name: 'Curvas',
        animatable: false,
        params: [
          { id: 'master', label: 'Todos', type: 'curve', default: IDENTITY_CURVE },
          { id: 'red', label: 'Rojo', type: 'curve', default: IDENTITY_CURVE },
          { id: 'green', label: 'Verde', type: 'curve', default: IDENTITY_CURVE },
          { id: 'blue', label: 'Azul', type: 'curve', default: IDENTITY_CURVE },
        ],
        ffmpeg: (p) => {
          const parts = [['m', p.master], ['r', p.red], ['g', p.green], ['b', p.blue]]
            .filter(([, s]) => !isIdentityCurve(s))
            .map(([k, s]) => `${k}='${curveString(parseCurve(s))}'`);
          return parts.length ? `curves=${parts.join(':')}` : '';
        },
      },
      {
        id: 'lut',
        name: 'LUT (.cube)',
        animatable: false,
        params: [
          { id: 'file', label: 'Archivo', type: 'file', default: '', filter: { name: 'LUT 3D (.cube)', extensions: ['cube'] } },
          { id: 'intensity', label: 'Intensidad', type: 'range', min: 0, max: 1, step: 0.01, default: 1, format: pct },
        ],
        // Con intensidad parcial, la imagen con la LUT se mezcla con la original.
        graph: (p, ctx, inL, outL, tag) => {
          if (!p.file || !p.intensity) return `[${inL}]null[${outL}]`;
          const lut = `lut3d=file=${lutName(p.file)}:interp=trilinear`;
          if (p.intensity >= 1) return `[${inL}]${lut}[${outL}]`;
          return (
            `[${inL}]format=gbrap,split[${tag}a][${tag}b];[${tag}b]${lut}[${tag}c];` +
            `[${tag}c][${tag}a]blend=all_mode=normal:all_opacity=${n(p.intensity)}[${outL}]`
          );
        },
      },
      {
        id: 'hsl',
        name: 'Tono, saturación y luminosidad',
        params: [
          { id: 'hue', label: 'Tono', type: 'range', min: -180, max: 180, step: 1, default: 0, format: deg },
          { id: 'saturation', label: 'Saturación', type: 'range', min: 0, max: 2, step: 0.01, default: 1, format: pct },
          { id: 'lightness', label: 'Luminosidad', type: 'range', min: -1, max: 1, step: 0.01, default: 0, format: pct },
        ],
        ffmpeg: (p, ctx) =>
          ctx.keep || p.hue || p.saturation !== 1 || p.lightness ? `hue=h=${n(p.hue)}:s=${n(p.saturation)}:b=${n(p.lightness * 10)}` : '',
      },
      {
        id: 'blackwhite',
        name: 'Blanco y negro',
        params: [{ id: 'amount', label: 'Cantidad', type: 'range', min: 0, max: 1, step: 0.01, default: 1, format: pct }],
        ffmpeg: (p, ctx) => (ctx.keep || p.amount ? `hue=s=${n(1 - p.amount)}` : ''),
      },
      {
        id: 'sepia',
        name: 'Sepia',
        params: [{ id: 'amount', label: 'Cantidad', type: 'range', min: 0, max: 1, step: 0.01, default: 1, format: pct }],
        ffmpeg: (p, ctx) => {
          if (!p.amount && !ctx.keep) return '';
          const m = sepiaMatrix(p.amount);
          const k = ['rr', 'rg', 'rb', 'gr', 'gg', 'gb', 'br', 'bg', 'bb'];
          return `colorchannelmixer=${k.map((key, i) => `${key}=${n(m[i])}`).join(':')}`;
        },
      },
      {
        id: 'invert',
        name: 'Invertir',
        params: [{ id: 'amount', label: 'Cantidad', type: 'range', min: 0, max: 1, step: 0.01, default: 1, format: pct }],
        ffmpeg: (p, ctx) => {
          if (!p.amount && !ctx.keep) return '';
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
          return sx < 0.05 && sy < 0.05 && !ctx.keep ? '' : `format=gbrap,gblur=sigma=${n(sx)}:sigmaV=${n(sy)}`;
        },
      },
      {
        id: 'sharpen',
        name: 'Enfocar',
        animatable: false,
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
          { id: 'threshold', label: 'Umbral', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6, format: pct, animatable: false },
          { id: 'intensity', label: 'Intensidad', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6, format: pct },
          { id: 'radius', label: 'Radio', type: 'range', min: 0, max: 1, step: 0.01, default: 0.3, format: pct },
        ],
        // Las zonas por encima del umbral se desenfocan y se suman en modo "trama" (screen).
        graph: (p, ctx, inL, outL, tag) => {
          if (!p.intensity && !ctx.keep) return `[${inL}]null[${outL}]`;
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
        animatable: false,
        params: [{ id: 'amount', label: 'Intensidad', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, format: pct }],
        // vignette no admite alfa: con transparencia se aparta el alfa y se vuelve a poner después.
        graph: (p, ctx, inL, outL, tag) => {
          if (!p.amount) return `[${inL}]null[${outL}]`;
          const f = `vignette=angle=${n((p.amount * Math.PI) / 2)}`;
          if (!ctx.alpha) return `[${inL}]${f}[${outL}]`;
          return `[${inL}]format=yuva420p,split[${tag}a][${tag}b];[${tag}a]format=yuv420p,${f}[${tag}v];[${tag}b]alphaextract[${tag}m];[${tag}v][${tag}m]alphamerge[${outL}]`;
        },
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
        // colorkey sustituye el alfa; si la imagen ya tenía transparencia, se multiplica por la de antes
        // (igual que la vista previa), para que lo transparente siga siéndolo.
        graph: (p, ctx, inL, outL, tag) => {
          const f = `colorkey=color=${hex(p.color)}:similarity=${n(p.similarity)}:blend=${n(p.blend)}`;
          if (!ctx.alpha) return `[${inL}]format=rgba,${f}[${outL}]`;
          return (
            `[${inL}]format=rgba,split[${tag}a][${tag}b];[${tag}a]${f},split[${tag}k][${tag}c];` +
            `[${tag}b]alphaextract[${tag}m];[${tag}c]alphaextract[${tag}n];` +
            `[${tag}m][${tag}n]blend=all_mode=multiply[${tag}p];[${tag}k][${tag}p]alphamerge[${outL}]`
          );
        },
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

// id → definición, con group, index (para la interfaz) y kind: 'video' o 'audio' (el tipo de pista en que se usa).
export const EFFECTS = new Map();
for (const [kind, groups] of [['video', EFFECT_GROUPS], ['audio', AUDIO_EFFECT_GROUPS]]) {
  for (const group of groups) {
    for (const item of group.items) EFFECTS.set(item.id, { ...item, kind, group: group.name, index: EFFECTS.size });
  }
}
export const effectGroups = (kind) => (kind === 'audio' ? AUDIO_EFFECT_GROUPS : EFFECT_GROUPS);

export function effectDefaults(type) {
  return Object.fromEntries(EFFECTS.get(type).params.map((p) => [p.id, p.default]));
}

export const newEffect = (type) => ({ id: uid('x'), type, enabled: true, params: effectDefaults(type) });

// ---- Fotogramas clave de los efectos ----

export const isAnimatable = (def) => def.kind === 'video' && def.animatable !== false && def.params.some((p) => canAnimate(def, p));
export const canAnimate = (def, p) => def.animatable !== false && p.type === 'range' && p.animatable !== false;
export const hasKeyframes = (fx) => (fx?.keyframes?.length ?? 0) > 1;

// Valores del efecto en el tiempo local t (con los que falten por defecto).
export function fxParamsAt(fx, t) {
  const base = { ...effectDefaults(fx.type), ...fx.params };
  if (!hasKeyframes(fx)) return base;
  const def = EFFECTS.get(fx.type);
  const kfs = fx.keyframes;
  const full = (k) => ({ ...base, ...k.params });
  if (t <= kfs[0].t) return full(kfs[0]);
  const j = kfs.findIndex((k) => k.t > t);
  if (j < 0) return full(kfs[kfs.length - 1]);
  const a = full(kfs[j - 1]);
  const b = full(kfs[j]);
  const f = (t - kfs[j - 1].t) / (kfs[j].t - kfs[j - 1].t);
  const out = { ...a };
  for (const p of def.params) if (canAnimate(def, p)) out[p.id] = a[p.id] + (b[p.id] - a[p.id]) * f;
  return out;
}

// Índice del fotograma clave en t (a menos de medio fotograma) o −1.
export const fxKeyAt = (fx, t, fps) => (fx.keyframes || []).findIndex((k) => Math.abs(k.t - t) < 0.5 / fps);

// Cambiar valores en el instante t: sin animación, valen para todo el evento; con fotogramas clave, se cambia
// el que haya en t o se crea uno nuevo ahí (los parámetros que no se pueden animar valen siempre para todo).
export function setFxValues(fx, t, changes, fps) {
  const def = EFFECTS.get(fx.type);
  const fixed = Object.fromEntries(Object.entries(changes).filter(([id]) => !canAnimate(def, def.params.find((p) => p.id === id))));
  const params = { ...fx.params, ...changes };
  if (!hasKeyframes(fx)) return { ...fx, params, keyframes: null };
  const animated = Object.fromEntries(Object.entries(changes).filter(([id]) => !(id in fixed)));
  let kfs = fx.keyframes.map((k) => ({ ...k, params: { ...k.params, ...fixed } }));
  const i = fxKeyAt(fx, t, fps);
  if (i >= 0) kfs = kfs.map((k, j) => (j === i ? { ...k, params: { ...k.params, ...animated } } : k));
  else kfs = [...kfs, { t, params: { ...fxParamsAt(fx, t), ...animated } }].sort((a, b) => a.t - b.t);
  return { ...fx, params: { ...fx.params, ...fixed }, keyframes: kfs };
}

// Añadir un fotograma clave en t con los valores que hay ahí. El primero también crea uno al principio del
// evento (si t no es 0), con los valores de siempre, para que haya animación desde el principio.
export function addFxKey(fx, t, fps) {
  if (fxKeyAt(fx, t, fps) >= 0) return fx;
  const now = fxParamsAt(fx, t);
  const kfs = hasKeyframes(fx) ? fx.keyframes : t > 0.5 / fps ? [{ t: 0, params: now }] : [];
  const list = [...kfs, { t, params: now }].sort((a, b) => a.t - b.t);
  return list.length > 1 ? { ...fx, keyframes: list } : { ...fx, params: now, keyframes: null };
}
// Quitar uno: si queda solo uno, el efecto deja de estar animado y se queda con sus valores.
export function removeFxKey(fx, index) {
  const list = fx.keyframes.filter((_, i) => i !== index);
  return list.length > 1 ? { ...fx, keyframes: list } : { ...fx, params: { ...fx.params, ...list[0]?.params }, keyframes: null };
}
export function moveFxKey(fx, index, t, duration) {
  const kfs = fx.keyframes;
  const lo = index > 0 ? kfs[index - 1].t + 0.001 : 0;
  const hi = index < kfs.length - 1 ? kfs[index + 1].t - 0.001 : duration;
  return { ...fx, keyframes: kfs.map((k, i) => (i === index ? { ...k, t: Math.min(hi, Math.max(lo, t)) } : k)) };
}
// Al recortar por la izquierda o dividir (los fotogramas clave cuentan desde el principio del evento) y al
// cambiar la duración con Ctrl, como los de la panorámica.
export const shiftFxKeys = (effects, dt) => (effects || []).map((fx) => (hasKeyframes(fx) ? { ...fx, keyframes: fx.keyframes.map((k) => ({ ...k, t: k.t - dt })) } : fx));
export const scaleFxKeys = (effects, f) => (effects || []).map((fx) => (hasKeyframes(fx) ? { ...fx, keyframes: fx.keyframes.map((k) => ({ ...k, t: k.t * f })) } : fx));

// Efectos que de verdad hay que aplicar, con los parámetros completos (los que falten, por defecto) y, si
// están animados, con sus valores en el tiempo local t.
export function activeEffects(effects, t = 0) {
  return (effects || [])
    .filter((fx) => fx.enabled !== false && EFFECTS.has(fx.type))
    .map((fx) => ({ ...fx, params: fxParamsAt(fx, t) }));
}

// ---- Render de efectos animados: filtros con nombre y comandos de sendcmd ----

// Parte una cadena por un separador fuera de comillas y corchetes.
function splitTop(s, sep) {
  const out = [];
  let cur = '';
  let quote = false;
  for (const ch of s) {
    if (ch === "'") quote = !quote;
    if (ch === sep && !quote) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
// Filtros de un subgrafo: [{ pre, name, args: [[clave, valor] | [null, texto]], post }] por cadena.
function parseGraph(g) {
  return splitTop(g, ';').map((chain) => splitTop(chain, ',').map((spec) => {
    const m = /^((?:\[[^\]]*\])*)([A-Za-z0-9_]+)(?:=(.*?))?((?:\[[^\]]*\])*)$/s.exec(spec.trim());
    if (!m) return { raw: spec };
    const args = m[3] === undefined ? [] : splitTop(m[3], ':').map((a) => {
      const i = a.indexOf('=');
      return i > 0 && !a.startsWith("'") ? [a.slice(0, i), a.slice(i + 1)] : [null, a];
    });
    return { pre: m[1], name: m[2], args, post: m[4] };
  }));
}
const printGraph = (chains) => chains.map((c) => c.map((f) => (f.raw !== undefined ? f.raw
  : `${f.pre}${f.name}${f.inst ? `@${f.inst}` : ''}${f.args.length ? `=${f.args.map(([k, v]) => (k ? `${k}=${v}` : v)).join(':')}` : ''}${f.post}`)).join(',')).join(';');

// Grafo de un efecto con fotogramas clave para el render: los filtros llevan nombre (@N@k…) y, para cada
// fotograma del evento (tiempo local), los comandos que cambian los valores que varían.
function animatedGraph(fx, def, ctx, build, timing, tag) {
  const kctx = { ...ctx, keep: true };
  const at = (t) => parseGraph(build(def, fxParamsAt(fx, t), kctx));
  const base = at(0);
  let k = 0;
  for (const chain of base) for (const f of chain) if (f.name) f.inst = `${tag}k${k++}`;
  const cmds = [];
  let prev = base;
  const frames = Math.ceil(timing.duration * timing.fps) + 1;
  for (let i = 1; i <= frames; i++) {
    const t = i / timing.fps;
    const cur = at(t);
    const list = [];
    cur.forEach((chain, c) => chain.forEach((f, j) => {
      const b = base[c]?.[j];
      if (!b?.inst || b.name !== f.name) return;
      f.args.forEach(([key, v], a) => {
        if (key && prev[c][j].args[a]?.[1] !== v) list.push(`${b.name}@${b.inst} ${key} ${v}`);
      });
    }));
    // Medio fotograma antes: el fotograma de t ya lleva sus valores aunque su instante no caiga justo en la
    // rejilla (los tiempos se redondean al escribirlos).
    if (list.length) cmds.push([t - 0.5 / timing.fps, list.join(',')]);
    prev = cur;
  }
  return { graph: printGraph(base), cmds };
}


// Subgrafo de FFmpeg con toda la cadena de efectos de un evento, entre las etiquetas @IN@ y @OUT@
// (@N@ es un prefijo único que pone el proceso principal). alpha: si deja transparencia (croma).
// kind: 'video' o 'audio' (solo cambia el filtro que no hace nada: null / anull).
// timing = { duration, fps }: con efectos animados, cmds = [[t local, 'filtro@nombre opción valor,…'], …]
// para sendcmd (el proceso principal los pasa al tiempo de cada trozo).
export function effectsGraph(effects, ctx, kind = 'video', timing = null) {
  const list = activeEffects(effects).filter((fx) => EFFECTS.get(fx.type).kind === kind);
  if (!list.length) return null;
  const source = new Map((effects || []).map((fx) => [fx.id, fx]));
  const cmds = [];
  const parts = [];
  let chain = [];
  let cur = '@IN@';
  let k = 0;
  let alpha = false;
  const flush = (out) => {
    parts.push(`[${cur}]${chain.length ? chain.join(',') : kind === 'audio' ? 'anull' : 'null'}[${out}]`);
    chain = [];
    cur = out;
  };
  for (const fx of list) {
    const def = EFFECTS.get(fx.type);
    if (def.alpha) alpha = true;
    const original = source.get(fx.id);
    if (timing && kind === 'video' && hasKeyframes(original) && isAnimatable(def)) {
      // Animado: un trozo de grafo propio con nombres y comandos.
      const tag = `@N@a${k++}`;
      if (def.graph) {
        flush(`@N@s${k++}`);
        const out = `@N@s${k++}`;
        const res = animatedGraph(original, def, ctx, (d, p, c) => d.graph(p, c, cur, out, `@N@g${k}`), timing, tag);
        parts.push(res.graph);
        cmds.push(...res.cmds);
        cur = out;
      } else {
        const res = animatedGraph(original, def, ctx, (d, p, c) => d.ffmpeg(p, c), timing, tag);
        if (res.graph) chain.push(res.graph);
        cmds.push(...res.cmds);
      }
      continue;
    }
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
  // Comandos de todos los efectos animados, juntos por instante.
  const byTime = new Map();
  for (const [t, c] of cmds) byTime.set(t, byTime.has(t) ? `${byTime.get(t)},${c}` : c);
  const merged = [...byTime].sort((a, b) => a[0] - b[0]);
  return { graph: parts.join(';'), alpha, ...(merged.length ? { cmds: merged } : {}) };
}
