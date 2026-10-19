// Rampas de velocidad: envolvente de velocidad del evento (como la «envolvente de velocidad» de VEGAS).
// event.speed = [{ t, v }] o null: t en segundos desde el principio del evento (tiempo de la línea de tiempo),
// v = factor de velocidad (1 = 100 %), lineal entre puntos y constante antes del primero y después del último.
// Se multiplica por event.rate (la velocidad fija, Ctrl + arrastrar un borde): velocidad(t) = rate × v(t).
// Del medio se usa la integral: sourceOffset(e, t) = ∫₀ᵗ velocidad. Los puntos pueden quedar fuera del evento
// (al recortar o dividir se desplazan, como los fotogramas clave de la panorámica) y siguen contando.
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 4;

export const hasRamp = (e) => Array.isArray(e?.speed) && e.speed.length > 0;
const clampV = (v) => Math.min(MAX_SPEED, Math.max(MIN_SPEED, v));

// Valor de la envolvente (sin rate) en el tiempo local t.
export function rampAt(points, t) {
  if (!points?.length) return 1;
  if (t <= points[0].t) return points[0].v;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (t <= b.t) return b.t - a.t < 1e-9 ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  }
  return points[points.length - 1].v;
}

// Tramos con velocidad lineal: [{ t0, t1, base, s0, a, m }]: entre t0 y t1, velocidad a + m·(t − base) y
// segundos de medio s(t) = s0 + a·(t − base) + m·(t − base)²/2 (desde el principio del evento: s(0) = 0).
// El primer tramo empieza en −∞ y el último acaba en +∞ (velocidad constante).
export function speedSegments(e) {
  const rate = e.rate || 1;
  const pts = hasRamp(e) ? e.speed : [{ t: 0, v: 1 }];
  const n = pts.length;
  const segs = [{ t0: -Infinity, t1: pts[0].t, base: pts[0].t, a: rate * pts[0].v, m: 0 }];
  for (let i = 1; i < n; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    if (q.t - p.t < 1e-9) continue;
    segs.push({ t0: p.t, t1: q.t, base: p.t, a: rate * p.v, m: (rate * (q.v - p.v)) / (q.t - p.t) });
  }
  segs.push({ t0: pts[n - 1].t, t1: Infinity, base: pts[n - 1].t, a: rate * pts[n - 1].v, m: 0 });
  // s en la base de cada tramo (acumulado desde el primer punto), y después se resta s(0).
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const k = segs[i];
    if (i === 0) {
      k.s0 = 0; // en la base (el primer punto)
      continue;
    }
    const prev = segs[i - 1];
    if (i > 1) acc += prev.a * (prev.t1 - prev.base) + (prev.m * (prev.t1 - prev.base) ** 2) / 2;
    k.s0 = acc;
  }
  const k0 = segs.find((k) => 0 < k.t1) || segs[segs.length - 1];
  const zero = segValue(k0, 0);
  for (const k of segs) k.s0 -= zero;
  return segs;
}

const segValue = (k, t) => k.s0 + k.a * (t - k.base) + (k.m * (t - k.base) ** 2) / 2;

// Velocidad real (rate × envolvente) en el tiempo local t.
export function speedAt(e, t) {
  return (e.rate || 1) * rampAt(hasRamp(e) ? e.speed : null, t);
}

// Segundos de medio usados desde el principio del evento hasta el tiempo local t.
export function sourceOffset(e, t) {
  if (!hasRamp(e)) return t * (e.rate || 1);
  const segs = speedSegments(e);
  const k = segs.find((s) => t < s.t1) || segs[segs.length - 1];
  return segValue(k, t);
}

// Inversa: tiempo local en el que se llega a s segundos de medio (la velocidad siempre es positiva).
export function localForSource(e, s) {
  if (!hasRamp(e)) return s / (e.rate || 1);
  const segs = speedSegments(e);
  const k = segs.find((x) => x.t1 === Infinity || s < segValue(x, x.t1)) || segs[segs.length - 1];
  const d = s - segValue(k, k.base);
  return k.base + (2 * d) / (k.a + Math.sqrt(Math.max(0, k.a * k.a + 2 * k.m * d)));
}

// ---- Edición de la envolvente (funciones puras) ----

export function addSpeedPoint(points, t, v) {
  const list = (points || []).filter((p) => Math.abs(p.t - t) > 1e-6);
  list.push({ t, v: clampV(v) });
  return list.sort((a, b) => a.t - b.t);
}
export function moveSpeedPoint(points, index, t, v) {
  const lo = index > 0 ? points[index - 1].t + 0.01 : -Infinity;
  const hi = index < points.length - 1 ? points[index + 1].t - 0.01 : Infinity;
  return points.map((p, i) => (i === index ? { t: Math.min(hi, Math.max(lo, t)), v: clampV(v) } : p));
}
export function removeSpeedPoint(points, index) {
  const list = points.filter((_, i) => i !== index);
  return list.length ? list : null;
}
// Al recortar por la izquierda o dividir, los puntos se desplazan (cuentan desde el nuevo principio).
export const shiftSpeed = (points, dt) => (points?.length ? points.map((p) => ({ ...p, t: p.t - dt })) : points ?? null);
// Al cambiar la duración con Ctrl (velocidad fija), la envolvente se estira con el evento.
export const scaleSpeedTime = (points, k) => (points?.length ? points.map((p) => ({ ...p, t: p.t * k })) : points ?? null);

// Tramos para el render: los mismos que speedSegments, con números finitos (el proceso principal construye
// con ellos las expresiones de FFmpeg).
export function speedPayload(e) {
  if (!hasRamp(e)) return null;
  return speedSegments(e).map(({ t1, s0, a, m, base }) => ({ t1: Number.isFinite(t1) ? t1 : null, s0, a, m, base }));
}
