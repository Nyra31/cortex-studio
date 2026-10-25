// Envolventes de pista (como en VEGAS): valores que cambian a lo largo del tiempo en una pista. En las de
// audio, volumen y panorámica; en las de video, opacidad (el «nivel de composición» de VEGAS).
// track.envelopes = { volume?: [{ t, v, c? }], pan?: [...], opacity?: [...] }, con t en segundos de la línea de
// tiempo, ordenados. Volumen en dB (MIN_VOLUME_DB = silencio, hasta +6 dB); panorámica de −1 (izquierda) a
// 1 (derecha); opacidad de 0 a 1. c = curva del tramo que empieza en ese punto (ENVELOPE_CURVES; sin c, lineal,
// en amplitud para el volumen); antes del primero y después del último se mantiene su valor. La envolvente se
// suma a la panorámica fija de la pista y multiplica su volumen o la opacidad de sus eventos.
// Ley de panorámica «balance»: hacia la derecha se baja el canal izquierdo y al revés.
import { MIN_VOLUME_DB, eventFades, fadeAt, fadeCurve, sourceTime, volumeToGain } from './project.js';
import { tx } from '../i18n/index.js';

export const ENVELOPE_MAX_DB = 6;
export const ENVELOPE_KINDS = {
  volume: { name: tx('Volumen'), initial: 0, track: 'audio' },
  pan: { name: tx('Panorámica'), initial: 0, track: 'audio' },
  opacity: { name: tx('Opacidad'), initial: 1, track: 'video' },
};
export const envelopeKinds = (trackType) => Object.keys(ENVELOPE_KINDS).filter((k) => ENVELOPE_KINDS[k].track === trackType);

// Curvas de los tramos: las de los fundidos (mismas fórmulas, aplicadas de un punto al siguiente) y
// «mantener», que conserva el valor hasta el punto siguiente y salta en él. (Lista escrita aquí y no copiada de
// FADE_CURVES al cargar: project.js importa este archivo y aún no estaría definida.)
export const ENVELOPE_CURVES = [
  { id: 'linear', label: tx('Lineal') },
  { id: 'fast', label: tx('Rápido') },
  { id: 'slow', label: tx('Lento') },
  { id: 'smooth', label: tx('Suave') },
  { id: 'sharp', label: tx('Brusco') },
  { id: 'hold', label: tx('Mantener') },
];
const shape = (c, s) => (c === 'hold' ? 0 : fadeCurve(c, s));

// Valor de un punto en las unidades con las que se interpola (ganancia lineal para el volumen).
const unit = (kind, v) => (kind === 'volume' ? volumeToGain(v) : v);

// Valor interpolado en t (ganancia lineal para el volumen, −1…1 para la panorámica, 0…1 para la opacidad) o
// null si no hay envolvente.
export function envelopeAt(points, kind, t) {
  if (!points?.length) return null;
  if (t <= points[0].t || points.length === 1) return unit(kind, points[0].v);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (t < b.t) {
      const s = (t - a.t) / (b.t - a.t || 1);
      return unit(kind, a.v) + (unit(kind, b.v) - unit(kind, a.v)) * shape(a.c, s);
    }
  }
  return unit(kind, points[points.length - 1].v);
}

// Opacidad de la pista de video en t (1 sin envolvente).
export const trackOpacityAt = (track, t) => Math.min(1, Math.max(0, envelopeAt(track.envelopes?.opacity, 'opacity', t) ?? 1));


// Ganancia de cada canal (izquierdo, derecho) para una panorámica de −1 a 1.
export const panGains = (p) => [Math.min(1, 1 - p), Math.min(1, 1 + p)];

// Volumen (ganancia) y panorámica de la pista en el instante t, con su control fijo y sus envolventes.
export function trackMixAt(track, t) {
  const env = track.envelopes || {};
  const gain = volumeToGain(track.volume ?? 0) * (envelopeAt(env.volume, 'volume', t) ?? 1);
  const pan = Math.max(-1, Math.min(1, (track.pan ?? 0) + (envelopeAt(env.pan, 'pan', t) ?? 0)));
  return { gain, pan };
}

// Valor de la envolvente (en sus unidades: dB o −1…1) en t, para crear un punto nuevo sobre la línea.
export function envelopeValueAt(points, kind, t) {
  const u = envelopeAt(points, kind, t);
  if (u === null) return ENVELOPE_KINDS[kind].initial;
  return kind === 'volume' ? (u <= volumeToGain(MIN_VOLUME_DB) ? MIN_VOLUME_DB : 20 * Math.log10(u)) : u;
}

// Punto nuevo en t con valor v; hereda la curva del tramo en el que cae (el tramo partido conserva su forma).
export function addEnvelopePoint(points, t, v) {
  const list = (points || []).filter((p) => Math.abs(p.t - t) > 1e-6);
  const before = [...list].reverse().find((p) => p.t < t);
  const point = before?.c ? { t, v, c: before.c } : { t, v };
  return [...list, point].sort((a, b) => a.t - b.t);
}

// Cambia la curva del tramo que empieza en el punto index ('linear' la quita).
export const setEnvelopeCurve = (points, index, c) =>
  points.map((p, i) => {
    if (i !== index) return p;
    const { c: _old, ...rest } = p;
    return c && c !== 'linear' ? { ...rest, c } : rest;
  });

// Ducking automático: envolvente de volumen para una pista (la música) que baja `depth` dB mientras suena la voz
// de la pista voiceTrackId. La voz se detecta con los picos de la forma de onda de sus eventos (con su volumen y
// fundidos): por encima de `threshold` dBFS hay voz; las pausas de menos de `hold` s no cuentan. Baja en `attack`
// s antes de que empiece y sube en `release` s después, con curva suave. Devuelve los puntos (o null sin voz).
export function duckingEnvelope(project, voiceTrackId, { depth = -12, threshold = -36, attack = 0.25, release = 0.6, hold = 0.8 } = {}) {
  const STEP = 0.02;
  const limit = 255 * 10 ** (threshold / 20);
  const media = new Map(project.media.map((m) => [m.id, m]));
  const regions = [];
  for (const e of [...project.events].filter((x) => x.trackId === voiceTrackId).sort((a, b) => a.start - b.start)) {
    const m = media.get(e.mediaId);
    if (!m?.peaks) continue;
    const fades = eventFades(e);
    for (let t = e.start; t < e.start + e.duration; t += STEP) {
      const src = sourceTime(e, t);
      const level = (m.peaks[Math.floor(src * m.peaksPerSecond)] ?? 0) * volumeToGain(e.volume ?? 0)
        * fadeAt(t - e.start, e.duration, { ...fades, curveIn: e.fadeInCurve, curveOut: e.fadeOutCurve });
      if (level < limit) continue;
      const last = regions[regions.length - 1];
      if (last && t - last[1] <= hold) last[1] = t + STEP;
      else regions.push([t, t + STEP]);
    }
  }
  // Tramos cuya subida llegaría después de la bajada del siguiente: uno solo (se queda abajo entre los dos).
  const voiced = [];
  for (const r of regions.filter(([a, b]) => b - a >= 0.15)) {
    const last = voiced[voiced.length - 1];
    if (last && r[0] - attack <= last[1] + release) last[1] = r[1];
    else voiced.push([...r]);
  }
  if (!voiced.length) return null;
  const points = [{ t: 0, v: 0 }];
  for (const [a, b] of voiced) {
    const down = Math.max(0.001, a - attack);
    if (down > points[points.length - 1].t) points.push({ t: down, v: 0, c: 'smooth' });
    else points[points.length - 1].c = 'smooth';
    points.push({ t: Math.max(down + 0.01, a), v: depth }, { t: b, v: depth, c: 'smooth' }, { t: b + release, v: 0 });
  }
  return points;
}

// ---- Render (FFmpeg) ----

const num = (v) => Number(v).toFixed(6);

// Curvas en FFmpeg (mismas fórmulas que fadeCurve; @S@ = progreso del tramo de 0 a 1).
const CURVE_EXPR = {
  fast: '(1-(1-@S@)*(1-@S@))',
  slow: '(@S@*@S@)',
  smooth: '((1-cos(PI*@S@))/2)',
  sharp: '(acos(1-2*@S@)/PI)',
  hold: '0',
};

// Expresión de FFmpeg (en función de T) con las mismas cuentas que envelopeAt.
function envelopeExpr(points, kind, T) {
  const u = (p) => num(unit(kind, p.v));
  if (points.length === 1) return u(points[0]);
  let expr = u(points[points.length - 1]);
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i];
    const b = points[i + 1];
    const s = `clip((${T}-${num(a.t)})/${num(b.t - a.t || 1)},0,1)`;
    const f = CURVE_EXPR[a.c] ? CURVE_EXPR[a.c].replaceAll('@S@', s) : s;
    expr = `if(lt(${T},${num(b.t)}),${u(a)}+(${u(b)}-${u(a)})*${f},${expr})`;
  }
  return expr;
}

// Opacidad de una pista de video en función de @T@ (tiempo de la línea de tiempo), o null sin envolvente.
export function trackOpacityExpr(track) {
  const points = track.envelopes?.opacity;
  return points?.length ? `clip(${envelopeExpr(points, 'opacity', '@T@')},0,1)` : null;
}

// Expresiones de la ganancia de cada canal de la pista en función de @T@ (el tiempo de la línea de tiempo,
// que pone el proceso principal), sin el volumen fijo de la pista (ese ya va en el render), o null si la
// pista no tiene envolventes ni panorámica.
export function trackMixExpr(track) {
  const env = track.envelopes || {};
  const hasVol = env.volume?.length > 0;
  const hasPan = env.pan?.length > 0 || (track.pan ?? 0) !== 0;
  if (!hasVol && !hasPan) return null;
  const G = hasVol ? `(${envelopeExpr(env.volume, 'volume', '@T@')})` : '1';
  const P = env.pan?.length
    ? `clip(${num(track.pan ?? 0)}+${envelopeExpr(env.pan, 'pan', '@T@')},-1,1)`
    : num(track.pan ?? 0);
  return { left: `${G}*min(1,1-(${P}))`, right: `${G}*min(1,1+(${P}))` };
}
