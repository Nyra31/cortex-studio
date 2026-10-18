// Panorámica/recorte del evento (como «Panorámica/recorte del evento» de VEGAS), con fotogramas clave.
//
// event.pan = null (sin cambios) o { keyframes: [{ t, x, y, scale, rotation, smooth }], crop: { left, top, right, bottom } }
//   t: segundos desde el principio del evento (tiempo de la línea de tiempo).
//   x, y: dónde queda el centro de la imagen, en fracciones del cuadro (0,5 = centro).
//   scale: tamaño respecto a la imagen encajada en el cuadro (1 = normal, 2 = el doble).
//   rotation: grados en el sentido de las agujas del reloj.
//   smooth: el tramo que empieza en este fotograma clave acelera y frena (si no, es lineal).
//   crop: fracciones de la imagen que se quitan de cada lado (fijo, no se anima).
// Con un solo fotograma clave los valores son fijos; con varios, se interpolan entre ellos.
// Lo que queda fuera de la imagen es transparente (se ve la pista de debajo), para poder hacer imagen
// sobre imagen. La vista previa (compositor.js) y el render (perspective en electron/ffmpeg.js) usan
// las mismas fórmulas: centro P, escala S y giro R llevan el punto q de la imagen (en px del cuadro,
// relativo al centro de la imagen encajada) a P + S·R·q.

export const PAN_VALUES = { x: 0.5, y: 0.5, scale: 1, rotation: 0 };
export const NO_CROP = { left: 0, top: 0, right: 0, bottom: 0 };
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 10;

export const newPan = () => ({ keyframes: [{ t: 0, ...PAN_VALUES, smooth: true }], crop: { ...NO_CROP } });

const smoothstep = (s) => s * s * (3 - 2 * s);

// Valores en el instante local t (segundos desde el principio del evento).
export function panAt(pan, t) {
  const kfs = pan?.keyframes;
  if (!kfs?.length) return { ...PAN_VALUES };
  if (t <= kfs[0].t || kfs.length === 1) return pick(kfs[0]);
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t < b.t) {
      let s = (t - a.t) / (b.t - a.t || 1);
      if (a.smooth) s = smoothstep(s);
      return {
        x: a.x + (b.x - a.x) * s,
        y: a.y + (b.y - a.y) * s,
        scale: a.scale + (b.scale - a.scale) * s,
        rotation: a.rotation + (b.rotation - a.rotation) * s,
      };
    }
  }
  return pick(kfs[kfs.length - 1]);
}

const pick = ({ x, y, scale, rotation }) => ({ x, y, scale, rotation });

const near = (a, b) => Math.abs(a - b) < 1e-6;

// ¿Cambia algo la panorámica? (si no, el evento se dibuja y se renderiza como siempre)
export function panActive(pan) {
  if (!pan) return false;
  const c = pan.crop || NO_CROP;
  if (c.left || c.top || c.right || c.bottom) return true;
  return pan.keyframes.some((k) => !near(k.x, 0.5) || !near(k.y, 0.5) || !near(k.scale, 1) || !near(k.rotation, 0));
}

// Índice del fotograma clave en t (con una tolerancia de medio fotograma) o -1.
export function keyframeAt(pan, t, fps) {
  return pan?.keyframes.findIndex((k) => Math.abs(k.t - t) < 0.5 / fps) ?? -1;
}

// Cambia los valores en el instante t, como en VEGAS: con un solo fotograma clave se cambian los valores
// fijos; si hay varios, se cambia el que está en t o se crea uno nuevo ahí.
export function setPanValues(pan, t, changes, fps) {
  const base = pan || newPan();
  const kfs = base.keyframes;
  if (kfs.length === 1) return { ...base, keyframes: [{ ...kfs[0], ...changes }] };
  const i = keyframeAt(base, t, fps);
  if (i >= 0) return { ...base, keyframes: kfs.map((k, j) => (j === i ? { ...k, ...changes } : k)) };
  return addKeyframe(base, t, changes);
}

// Añade un fotograma clave en t con los valores que hay ahí (más los cambios) o devuelve el mismo si ya hay uno.
export function addKeyframe(pan, t, changes = {}) {
  const base = pan || newPan();
  const prev = [...base.keyframes].reverse().find((k) => k.t <= t);
  const kf = { t, ...panAt(base, t), smooth: prev ? prev.smooth : true, ...changes };
  return { ...base, keyframes: [...base.keyframes, kf].sort((a, b) => a.t - b.t) };
}

export function removeKeyframe(pan, index) {
  if (!pan || pan.keyframes.length <= 1) return pan;
  return { ...pan, keyframes: pan.keyframes.filter((_, j) => j !== index) };
}

// Mueve un fotograma clave a otro instante (sin pasar a sus vecinos).
export function moveKeyframe(pan, index, t, duration) {
  const kfs = pan.keyframes;
  const lo = index > 0 ? kfs[index - 1].t + 1e-3 : 0;
  const hi = index < kfs.length - 1 ? kfs[index + 1].t - 1e-3 : duration;
  return { ...pan, keyframes: kfs.map((k, j) => (j === index ? { ...k, t: Math.min(hi, Math.max(lo, t)) } : k)) };
}

// El evento empieza dt segundos más tarde en su medio (recortar por la izquierda, la parte derecha al dividir):
// los fotogramas clave se desplazan con la imagen y los que quedan antes del principio se resumen en uno en 0.
export function shiftPan(pan, dt) {
  if (!pan || Math.abs(dt) < 1e-9) return pan;
  const moved = pan.keyframes.map((k) => ({ ...k, t: k.t - dt }));
  const after = moved.filter((k) => k.t > 1e-6);
  if (after.length === moved.length) return { ...pan, keyframes: moved };
  const prev = [...pan.keyframes].reverse().find((k) => k.t <= dt);
  return { ...pan, keyframes: [{ t: 0, ...panAt(pan, dt), smooth: prev?.smooth ?? true }, ...after] };
}

// El evento cambia de duración sin cambiar el trozo de medio (velocidad): los tiempos se escalan igual.
export function scalePanTime(pan, k) {
  if (!pan || Math.abs(k - 1) < 1e-9) return pan;
  return { ...pan, keyframes: pan.keyframes.map((kf) => ({ ...kf, t: kf.t * k })) };
}

// ---- Render (FFmpeg) ----

const num = (v) => Number(v).toFixed(6);

// Expresión de FFmpeg para una propiedad en el instante T (otra expresión), con las mismas curvas que panAt.
export function panExpr(pan, prop, T) {
  const kfs = pan.keyframes;
  const v = (k) => num(prop === 'rotation' ? (k.rotation * Math.PI) / 180 : k[prop]);
  if (kfs.length === 1) return v(kfs[0]);
  let expr = v(kfs[kfs.length - 1]);
  for (let i = kfs.length - 2; i >= 0; i--) {
    const a = kfs[i];
    const b = kfs[i + 1];
    const s = `clip((${T}-${num(a.t)})/${num(b.t - a.t || 1)},0,1)`;
    const curve = a.smooth ? `(${s}*${s}*(3-2*${s}))` : s;
    expr = `if(lt(${T},${num(b.t)}),${v(a)}+(${v(b)}-${v(a)})*${curve},${expr})`;
  }
  return expr;
}
