// Envolventes de pista (como en VEGAS): volumen y panorámica que cambian a lo largo del tiempo en una pista
// de audio. track.envelopes = { volume?: [{ t, v }], pan?: [{ t, v }] }, con t en segundos de la línea de
// tiempo, ordenados. Volumen en dB (MIN_VOLUME_DB = silencio, hasta +6 dB); panorámica de −1 (izquierda) a
// 1 (derecha). Entre dos puntos el cambio es lineal (en amplitud, para el volumen); antes del primero y
// después del último se mantiene su valor. La envolvente se suma a la panorámica fija de la pista y
// multiplica su volumen. Ley de panorámica «balance»: hacia la derecha se baja el canal izquierdo y al revés.
import { MIN_VOLUME_DB, volumeToGain } from './project.js';

export const ENVELOPE_MAX_DB = 6;
export const ENVELOPE_KINDS = {
  volume: { name: 'Volumen', initial: 0 },
  pan: { name: 'Panorámica', initial: 0 },
};

// Valor de un punto en las unidades con las que se interpola (ganancia lineal para el volumen).
const unit = (kind, v) => (kind === 'volume' ? volumeToGain(v) : v);

// Valor interpolado en t (ganancia lineal para el volumen, −1…1 para la panorámica) o null si no hay envolvente.
export function envelopeAt(points, kind, t) {
  if (!points?.length) return null;
  if (t <= points[0].t || points.length === 1) return unit(kind, points[0].v);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (t < b.t) {
      const s = (t - a.t) / (b.t - a.t || 1);
      return unit(kind, a.v) + (unit(kind, b.v) - unit(kind, a.v)) * s;
    }
  }
  return unit(kind, points[points.length - 1].v);
}

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

export function addEnvelopePoint(points, t, v) {
  return [...(points || []).filter((p) => Math.abs(p.t - t) > 1e-6), { t, v }].sort((a, b) => a.t - b.t);
}

// ---- Render (FFmpeg) ----

const num = (v) => Number(v).toFixed(6);

// Expresión de FFmpeg (en función de T) con las mismas cuentas que envelopeAt.
function envelopeExpr(points, kind, T) {
  const u = (p) => num(unit(kind, p.v));
  if (points.length === 1) return u(points[0]);
  let expr = u(points[points.length - 1]);
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i];
    const b = points[i + 1];
    const s = `clip((${T}-${num(a.t)})/${num(b.t - a.t || 1)},0,1)`;
    expr = `if(lt(${T},${num(b.t)}),${u(a)}+(${u(b)}-${u(a)})*${s},${expr})`;
  }
  return expr;
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
