// Modelo del proyecto y operaciones de edición (funciones puras).
import { DEFAULT_TRANSITION } from './transitions.js';
import { effectsGraph, fxParamsAt, lutName, scaleFxKeys, shiftFxKeys } from './effects.js';
export { scaleFxKeys, shiftFxKeys };
import { hasTextAnim, isText, textPng, textSequence } from './text.js';
import { hasRamp, localForSource, shiftSpeed, sourceOffset, speedPayload } from './speed.js';
import { panActive, panAt, panExpr, scalePanTime, shiftPan } from './pan.js';
import { trackMixExpr, trackOpacityExpr } from './envelopes.js';
import { SUB_STYLE, emptySubtitles, subtitleParams, toSrt } from './subtitles.js';
import { decimal, point, tx } from '../i18n/index.js';

//
// project = {
//   settings: { width, height, fps },
//   media:  [{ id, path, name, duration, width, height, fps, hasVideo, hasAudio, isImage, thumb, peaks, peaksPerSecond, missing }],
//           o medios de texto generados: { id, kind: 'text', name, text, ... } (ver text.js; sin archivo)
//   markers: [{ id, time, name, number }],         // marcadores (M), como en VEGAS
//   regions: [{ id, start, end, name, number }],   // regiones con nombre (R)
//   tracks: [{ id, type: 'video' | 'audio', name, muted, solo, volume, pan, envelopes, blend }],  // ordenadas de arriba a abajo
//           volume en dB; pan de −1 (izquierda) a 1 (derecha); envelopes: envolventes de volumen, panorámica y
//           opacidad, con curvas (envelopes.js); blend: modo de fusión de una pista de video (BLEND_MODES)
//   events: [{ id, trackId, mediaId, start, inPoint, duration, groupId, volume, fadeIn, fadeOut, fadeInCurve, fadeOutCurve,
//              transition, effects, rate, speed, pan }],
// }
// pan: panorámica/recorte con fotogramas clave (ver pan.js), solo en eventos de video; null o ausente = ninguna.
// effects: cadena [{ id, type, enabled, params }] aplicada en orden; efectos de video en los eventos de video
// y de audio en los de audio (ver effects.js y audio-effects.js).
// Tiempos en segundos. volume del evento en dB (solo afecta al audio); fadeIn/fadeOut = duración de los fundidos.
// rate = velocidad de reproducción (1 = normal, 2 = el doble de rápido) y speed = rampa de velocidad (envolvente
// que la multiplica, ver speed.js). duration es lo que ocupa en la línea de tiempo; del medio se usan
// sourceOffset(e, duration) segundos (duration × rate sin rampa) a partir de inPoint (ver sourceTime).
// Si un evento empieza encima del final de otro de su misma pista, el solapamiento es una transición:
// en video, la de `transition` del evento que entra (null = disolución cruzada); en audio, un fundido cruzado.

export const MIN_EVENT = 0.04;
export const IMAGE_DURATION = 5;
export const DEFAULT_SETTINGS = { width: 1920, height: 1080, fps: 30 };
export const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
export const MIN_VOLUME_DB = -48; // en el mínimo la pista queda en silencio (-∞)
export const MIN_RATE = 0.25; // velocidad de los eventos: de 4 veces más lento a 4 veces más rápido, como en VEGAS
export const MAX_RATE = 4;
export const MAX_TRACK_VOLUME_DB = 12; // las pistas amplifican hasta +12 dB, como en VEGAS (los eventos, hasta 0 dB)
export const TRACK_COLORS = ['#5b80d6', '#9b66cf', '#cf5f80', '#d58a48', '#c4ad45', '#5aa86a', '#47a5b3'];
export const trackColor = (index) => TRACK_COLORS[index % TRACK_COLORS.length];

let counter = 0;
export const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;

const newTrack = (type, number) => ({
  id: uid('t'),
  type,
  name: `${type === 'video' ? 'Video' : 'Audio'} ${number}`,
  muted: false,
  solo: false,
  volume: 0,
  pan: 0,
});

export function emptyProject(settings = DEFAULT_SETTINGS) {
  return {
    settings: { ...settings },
    media: [],
    tracks: [newTrack('video', 1), newTrack('audio', 1)],
    events: [],
    markers: [],
    regions: [],
  };
}

// ---- Marcadores y regiones ----

// Número libre más bajo (como en VEGAS: las teclas 1–9 llevan a los marcadores con ese número).
const nextNumber = (list) => {
  const used = new Set(list.map((x) => x.number));
  let n = 1;
  while (used.has(n)) n++;
  return n;
};

export function addMarker(project, time) {
  const markers = project.markers || [];
  if (markers.some((m) => Math.abs(m.time - time) < 1e-6)) return { project, marker: null };
  const marker = { id: uid('k'), time, name: '', number: nextNumber(markers) };
  return { project: { ...project, markers: [...markers, marker] }, marker };
}

export function addRegion(project, start, end) {
  const regions = project.regions || [];
  const region = { id: uid('r'), start, end, name: '', number: nextNumber(regions) };
  return { project: { ...project, regions: [...regions, region] }, region };
}

// Cambia un marcador o una región (kind: 'marker' | 'region').
export function updateMark(project, kind, id, changes) {
  const key = kind === 'marker' ? 'markers' : 'regions';
  return { ...project, [key]: (project[key] || []).map((x) => (x.id === id ? { ...x, ...changes } : x)) };
}

export function deleteMark(project, kind, id) {
  const key = kind === 'marker' ? 'markers' : 'regions';
  return { ...project, [key]: (project[key] || []).filter((x) => x.id !== id) };
}

// Desplaza marcadores, regiones y los puntos de las envolventes de pista (la cascada en todas las pistas
// los mueve, como en VEGAS). shiftOf(t) → cuánto se mueve algo que está en t.
function shiftMarks(project, shiftOf) {
  const moveEnv = (points) => points?.map((p) => ({ ...p, t: Math.max(0, p.t + shiftOf(p.t)) }));
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.envelopes
      ? { ...t, envelopes: Object.fromEntries(Object.entries(t.envelopes).map(([k, pts]) => [k, moveEnv(pts)])) }
      : t)),
    markers: (project.markers || []).map((m) => ({ ...m, time: Math.max(0, m.time + shiftOf(m.time)) })),
    ...(project.subtitles && {
      subtitles: {
        ...project.subtitles,
        cues: project.subtitles.cues.map((c) => {
          const d = shiftOf(c.start);
          return { ...c, start: Math.max(0, c.start + d), end: Math.max(0, c.start + d) + (c.end - c.start) };
        }),
      },
    }),
    regions: (project.regions || []).map((r) => {
      const d = shiftOf(r.start);
      const e = shiftOf(r.end);
      return { ...r, start: Math.max(0, r.start + d), end: Math.max(0, r.start + d) + Math.max(1e-3, r.end + e - (r.start + d)) };
    }),
  };
}

// Puntos de marcadores y regiones (para el ajuste y para saltar de uno a otro).
export const markPoints = (project) => [
  ...(project.markers || []).map((m) => m.time),
  ...(project.regions || []).flatMap((r) => [r.start, r.end]),
];

// Una pista suena o se ve si no está silenciada y, cuando hay pistas en solo de su tipo, si ella es una.
export function isTrackActive(track, tracks) {
  if (track.muted) return false;
  const anySolo = tracks.some((t) => t.type === track.type && t.solo);
  return anySolo ? !!track.solo : true;
}

export const volumeToGain = (db) => (db <= MIN_VOLUME_DB ? 0 : 10 ** (db / 20));
export const gainToVolume = (gain) => (gain <= volumeToGain(MIN_VOLUME_DB) ? MIN_VOLUME_DB : Math.min(0, 20 * Math.log10(gain)));
export const formatVolume = (db) => (db <= MIN_VOLUME_DB ? '-∞ dB' : `${db > 0 ? '+' : ''}${decimal(db, 1)} dB`);

// Pico (0–1) del audio de un evento según la forma de onda del medio (lo usa el efecto Normalizar).
export function eventPeak(media, e) {
  if (!media?.peaks?.length) return 0;
  const pps = media.peaksPerSecond;
  const from = Math.max(0, Math.floor(e.inPoint * pps));
  const to = Math.min(media.peaks.length, Math.ceil((e.inPoint + sourceOffset(e, e.duration)) * pps));
  let max = 0;
  for (let i = from; i < to; i++) if (media.peaks[i] > max) max = media.peaks[i];
  return max / 255;
}

export const EVENT_DEFAULTS = {
  volume: 0, fadeIn: 0, fadeOut: 0, fadeInCurve: 'linear', fadeOutCurve: 'linear', transition: null, effects: [], rate: 1,
  speed: null, // rampa de velocidad (envolvente, ver speed.js)
  // Transición en un fundido de video (id de transitions.js o null): en vez de transparentarse, el evento entra o
  // sale con esa transición hacia lo que hay debajo, como al soltar una transición sobre un fundido en VEGAS.
  fadeInTransition: null, fadeOutTransition: null,
  // Evento invertido (reproducido hacia atrás): usa un archivo con el trozo al revés y guarda de dónde viene
  // ({ mediaId, start, span }: segundos del medio original) para poder quitar la inversión (ver setReversed).
  reversed: null,
  // Evento estabilizado: usa un archivo con el trozo estabilizado (desde `start` del medio de antes, mediaId).
  stabilized: null,
  // Evento de audio con el ruido reducido: usa un archivo con el sonido limpio (desde `start` del medio de antes).
  denoised: null,
  // Evento de audio sin las voces (para doblar): usa un archivo sin voces (desde `start` del medio de antes).
  devoiced: null,
};

// Modos de fusión de las pistas de video (track.blend; sin él, normal), como los modos de composición de VEGAS.
// Mismas fórmulas que el filtro blend de FFmpeg (ver BLEND_CODE en preview/compositor.js).
export const BLEND_MODES = [
  { id: 'normal', label: tx('Normal') },
  { id: 'multiply', label: tx('Multiplicar') },
  { id: 'screen', label: tx('Trama') },
  { id: 'overlay', label: tx('Superponer') },
  { id: 'hardlight', label: tx('Luz fuerte') },
  { id: 'darken', label: tx('Oscurecer') },
  { id: 'lighten', label: tx('Aclarar') },
  { id: 'addition', label: tx('Sumar') },
  { id: 'subtract', label: tx('Restar') },
  { id: 'difference', label: tx('Diferencia') },
];

// Curvas de los fundidos, como en VEGAS. «Rápido»: el cambio ocurre sobre todo al principio del fundido;
// «lento», al final; «suave», lento-rápido-lento; «brusco», rápido-lento-rápido. Mismas fórmulas que el render
// (afade de FFmpeg en audio: ipar, qua, hsin, ihsin; geq en video).
export const FADE_CURVES = [
  { id: 'linear', label: tx('Lineal') },
  { id: 'fast', label: tx('Rápido') },
  { id: 'slow', label: tx('Lento') },
  { id: 'smooth', label: tx('Suave') },
  { id: 'sharp', label: tx('Brusco') },
];
// Forma del fundido de entrada: progreso p (0…1) → factor. El de salida es 1 − fadeCurve(curva, progreso).
export function fadeCurve(curve, p) {
  const x = Math.min(1, Math.max(0, p));
  if (curve === 'fast') return 1 - (1 - x) * (1 - x);
  if (curve === 'slow') return x * x;
  if (curve === 'smooth') return (1 - Math.cos(Math.PI * x)) / 2;
  if (curve === 'sharp') return Math.acos(1 - 2 * x) / Math.PI;
  return x;
}

export { shiftPan, scalePanTime };

// Instante del medio que se ve o se oye en el instante t de la línea de tiempo.
export const sourceTime = (e, t) => e.inPoint + sourceOffset(e, t - e.start);
export { hasRamp };
export const formatRate = (rate) => `${Math.round(rate * 100)} %`;

// Tamaño de una imagen de mw×mh encajada (sin recortar) en un cuadro de W×H, en píxeles pares.
// Es el mismo encaje que hace la vista previa y el render (bandas negras alrededor).
export function fitSize(mw, mh, W, H) {
  if (!mw || !mh) return null;
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return mw / mh > W / H ? { w: even(W), h: even((W * mh) / mw) } : { w: even((H * mw) / mh), h: even(H) };
}

// Fundidos guardados, reducidos si el evento se ha acortado para que no se solapen.
export function eventFades(e) {
  const fadeIn = Math.min(e.fadeIn || 0, e.duration);
  return { fadeIn, fadeOut: Math.min(e.fadeOut || 0, e.duration - fadeIn) };
}

// Solapamientos entre eventos de una misma pista y fundidos que se aplican de verdad:
// - incoming: B.id → { from: A, duration, type }   (B empieza dentro de A y termina después)
// - outgoing: A.id → { to: B, duration }
// - fades: id → { fadeIn, fadeOut }. En audio el solapamiento es un fundido cruzado; en video
//   la transición sustituye a los fundidos de transparencia de esos bordes.
// - transitions: transiciones de video [{ trackId, from, to, start, duration, type }]
export function resolveTimeline(project) {
  const trackType = new Map(project.tracks.map((t) => [t.id, t.type]));
  const byTrack = new Map();
  for (const e of project.events) {
    if (!byTrack.has(e.trackId)) byTrack.set(e.trackId, []);
    byTrack.get(e.trackId).push(e);
  }
  const incoming = new Map();
  const outgoing = new Map();
  const transitions = [];
  for (const [trackId, list] of byTrack) {
    list.sort((a, b) => a.start - b.start);
    for (let j = 0; j < list.length; j++) {
      const b = list[j];
      let from = null;
      for (let i = 0; i < j; i++) {
        const a = list[i];
        const aEnd = a.start + a.duration;
        if (a.start < b.start && aEnd > b.start + MIN_EVENT / 2 && aEnd < b.start + b.duration) from = a;
      }
      if (!from) continue;
      const duration = from.start + from.duration - b.start;
      const type = b.transition || DEFAULT_TRANSITION;
      incoming.set(b.id, { from, duration, type });
      if (!outgoing.has(from.id) || outgoing.get(from.id).duration < duration) outgoing.set(from.id, { to: b, duration });
      if (trackType.get(trackId) === 'video') transitions.push({ trackId, from: from.id, to: b.id, start: b.start, duration, type });
    }
  }
  const fades = new Map();
  for (const e of project.events) {
    const stored = eventFades(e);
    const audio = trackType.get(e.trackId) === 'audio';
    const inc = incoming.get(e.id);
    const out = outgoing.get(e.id);
    const fadeIn = inc ? (audio ? inc.duration : 0) : stored.fadeIn;
    let fadeOut = out ? (audio ? out.duration : 0) : stored.fadeOut;
    fadeOut = Math.min(fadeOut, e.duration - fadeIn);
    fades.set(e.id, {
      fadeIn, fadeOut, curveIn: e.fadeInCurve || 'linear', curveOut: e.fadeOutCurve || 'linear',
      transIn: !audio && fadeIn > 0 ? e.fadeInTransition || null : null,
      transOut: !audio && fadeOut > 0 ? e.fadeOutTransition || null : null,
    });
  }
  return { incoming, outgoing, fades, transitions };
}

// Factor de 0 a 1 que aplican los fundidos en el instante local (desde el principio del evento), con su curva.
// Un fundido con transición (transIn/transOut) no cambia la opacidad: lo hace la transición (ver edgeAt).
export function fadeAt(local, duration, { fadeIn, fadeOut, curveIn, curveOut, transIn, transOut }) {
  let f = 1;
  if (fadeIn > 0 && local < fadeIn && !transIn) f = Math.min(f, fadeCurve(curveIn, local / fadeIn));
  if (fadeOut > 0 && local > duration - fadeOut && !transOut) f = Math.min(f, 1 - fadeCurve(curveOut, (local - (duration - fadeOut)) / fadeOut));
  return f;
}

// Transición de un fundido en curso en el instante local: { type, side: 'in' | 'out', progress } (progress = P de
// xfade: 1 al principio de la transición, 0 al final; en la entrada, A es transparente y B el evento; en la
// salida, al revés) o null.
export function edgeAt(local, duration, { fadeIn, fadeOut, transIn, transOut }) {
  if (transIn && local < fadeIn) return { type: transIn, side: 'in', progress: 1 - Math.max(0, local) / fadeIn };
  const st = duration - fadeOut;
  if (transOut && local >= st) return { type: transOut, side: 'out', progress: 1 - Math.min(fadeOut, local - st) / fadeOut };
  return null;
}
export function fadeFactor(e, t, fades = { ...eventFades(e), curveIn: e.fadeInCurve, curveOut: e.fadeOutCurve }) {
  return fadeAt(t - e.start, e.duration, fades);
}

export function formatFps(fps) {
  return Number.isInteger(fps) ? String(fps) : point(fps.toFixed(3).replace(/0+$/, ''));
}

export function projectDuration(project) {
  return project.events.reduce((max, e) => Math.max(max, e.start + e.duration), 0);
}

export function mediaLength(media) {
  return media.isImage ? IMAGE_DURATION : media.duration;
}

// Como en VEGAS, una pista de video nueva va arriba del todo (encima de las demás) y una de audio, abajo
// del todo. where: 'top', 'bottom' o 'afterType' (detrás de la última de su tipo, la usa pegar para que las
// pistas creadas queden en el mismo orden que las copiadas). Luego las pistas se pueden reordenar (moveTrack).
export function addTrack(project, type, where = type === 'video' ? 'top' : 'bottom') {
  const track = newTrack(type, project.tracks.filter((t) => t.type === type).length + 1);
  const tracks = [...project.tracks];
  if (where === 'top') {
    tracks.unshift(track);
  } else if (where === 'afterType') {
    const last = tracks.map((t) => t.type).lastIndexOf(type);
    tracks.splice(last >= 0 ? last + 1 : type === 'video' ? 0 : tracks.length, 0, track);
  } else {
    tracks.push(track);
  }
  return { project: { ...project, tracks }, track };
}

// Mueve una pista a la posición index (0 = arriba del todo) de la lista final.
export function moveTrack(project, trackId, index) {
  const from = project.tracks.findIndex((t) => t.id === trackId);
  if (from < 0) return project;
  const tracks = project.tracks.filter((t) => t.id !== trackId);
  const to = Math.max(0, Math.min(tracks.length, index));
  if (to === from) return project;
  tracks.splice(to, 0, project.tracks[from]);
  return { ...project, tracks };
}

// Sustituye el medio de un evento (y de su grupo) conservando posición, duración, efectos y fundidos, como Ctrl +
// soltar en VEGAS. Cada evento del grupo cambia si el medio nuevo tiene lo que muestra (imagen para los de video,
// sonido para los de audio). Se conserva el punto de entrada si cabe; si el medio nuevo es más corto, se acorta.
// Devuelve { project, changed } (changed = número de eventos cambiados).
export function replaceMedia(project, eventId, media) {
  const ev = project.events.find((e) => e.id === eventId);
  if (!ev) return { project, changed: 0 };
  const types = new Map(project.tracks.map((t) => [t.id, t.type]));
  const ids = new Set(project.events.filter((e) => e.id === ev.id || (ev.groupId && e.groupId === ev.groupId)).map((e) => e.id));
  let changed = 0;
  const events = project.events.map((e) => {
    if (!ids.has(e.id)) return e;
    const video = types.get(e.trackId) === 'video';
    if (video ? !media.hasVideo : !media.hasAudio) return e;
    changed++;
    if (media.isImage) return { ...e, mediaId: media.id, inPoint: 0, rate: 1, speed: null };
    const used = sourceOffset(e, e.duration);
    const total = media.duration || used;
    const inPoint = e.inPoint + used <= total ? e.inPoint : Math.max(0, total - used);
    const duration = Math.max(MIN_EVENT, Math.min(e.duration, localForSource(e, total - inPoint)));
    return { ...e, mediaId: media.id, inPoint, duration };
  });
  return { project: changed ? { ...project, events } : project, changed };
}

// Coloca un medio en la línea de tiempo. Un video con sonido genera dos eventos agrupados (video + audio).
// target: id de pista, 'new' para crear pistas nuevas, o null para usar las primeras pistas disponibles.
export function placeMedia(project, media, start, target = null) {
  let p = project;
  const targetTrack = p.tracks.find((t) => t.id === target) || null;
  const wantVideo = media.hasVideo && (!targetTrack || targetTrack.type === 'video');
  const wantAudio = media.hasAudio;
  if (!wantVideo && !wantAudio) return project;

  const pickTrack = (type) => {
    if (target !== 'new') {
      if (targetTrack && targetTrack.type === type) return targetTrack;
      const existing = p.tracks.find((t) => t.type === type);
      if (existing) return existing;
    }
    const res = addTrack(p, type);
    p = res.project;
    return res.track;
  };

  const groupId = wantVideo && wantAudio ? uid('g') : null;
  const duration = mediaLength(media);
  const events = [];
  const newEvent = (track) => ({
    id: uid('e'), trackId: track.id, mediaId: media.id, start, inPoint: 0, duration, groupId, ...EVENT_DEFAULTS,
  });
  if (wantVideo) events.push(newEvent(pickTrack('video')));
  if (wantAudio) events.push(newEvent(pickTrack('audio')));
  return { ...p, events: [...p.events, ...events] };
}

// Divide en el tiempo t los eventos seleccionados (o todos los que cruzan t si no hay selección).
export function splitEvents(project, t, selection) {
  const selected = new Set(selection);
  const targets = new Set(
    project.events
      .filter((e) => (selected.size === 0 || selected.has(e.id)) && e.start + MIN_EVENT < t && t < e.start + e.duration - MIN_EVENT)
      .map((e) => e.id),
  );
  if (!targets.size) return project;
  const newGroups = new Map();
  const added = [];
  const events = project.events.map((e) => {
    if (!targets.has(e.id)) return e;
    const left = t - e.start;
    let groupId = null;
    if (e.groupId) {
      if (!newGroups.has(e.groupId)) newGroups.set(e.groupId, uid('g'));
      groupId = newGroups.get(e.groupId);
    }
    // El fundido de entrada se queda en la parte izquierda y el de salida pasa a la derecha.
    added.push({
      ...e, id: uid('e'), start: t, inPoint: sourceTime(e, t), duration: e.duration - left, groupId, fadeIn: 0, transition: null,
      pan: shiftPan(e.pan, left), // los fotogramas clave siguen a la imagen
      speed: shiftSpeed(e.speed, left),
      effects: shiftFxKeys(e.effects, left),
    });
    return { ...e, duration: left, fadeOut: 0 };
  });
  return { ...project, events: [...events, ...added] };
}

// Recortar hasta el cursor (Alt+[ / Alt+] de VEGAS): quita de los eventos indicados (y de su grupo) lo que hay
// antes (side = 'start') o después ('end') del instante t. Solo cambian los que t corta por dentro.
export function trimToCursor(project, ids, t, side) {
  const chosen = new Set(ids);
  const groups = new Set(project.events.filter((e) => chosen.has(e.id) && e.groupId).map((e) => e.groupId));
  const media = new Map(project.media.map((m) => [m.id, m]));
  let changed = false;
  const events = project.events.map((e) => {
    if (!chosen.has(e.id) && !(e.groupId && groups.has(e.groupId))) return e;
    if (!(e.start + MIN_EVENT <= t && t <= e.start + e.duration - MIN_EVENT)) return e;
    changed = true;
    const left = t - e.start;
    if (side === 'end') return { ...e, duration: left, fadeOut: Math.min(e.fadeOut || 0, left - Math.min(e.fadeIn || 0, left)) };
    const duration = e.duration - left;
    return {
      ...e,
      start: t,
      inPoint: media.get(e.mediaId)?.isImage ? 0 : sourceTime(e, t),
      duration,
      fadeIn: Math.min(e.fadeIn || 0, duration),
      transition: null,
      pan: shiftPan(e.pan, left),
      speed: shiftSpeed(e.speed, left),
      effects: shiftFxKeys(e.effects, left),
    };
  });
  return changed ? { ...project, events } : project;
}

// Dividir con selección de tiempo (S, como en VEGAS): por sus dos extremos. Primero por el final, para que
// las partes izquierdas (que conservan el id) sigan seleccionadas al dividir por el principio.
export function splitRange(project, start, end, selection) {
  return splitEvents(splitEvents(project, end, selection), start, selection);
}

// Evento que entra en el solapamiento de la pista que contiene el instante t (o null si no hay ninguno).
export function overlapAt(project, trackId, t) {
  const { incoming } = resolveTimeline(project);
  let target = null;
  for (const e of project.events) {
    const inc = e.trackId === trackId && incoming.get(e.id);
    if (inc && t >= e.start - 0.05 && t <= e.start + inc.duration + 0.05) target = e;
  }
  return target;
}

// Asigna una transición al solapamiento de la pista que contiene el instante t.
// Devuelve el mismo proyecto si ahí no hay ningún solapamiento.
export function setTransitionAt(project, trackId, t, type) {
  const target = overlapAt(project, trackId, t);
  if (!target) return project;
  const value = type === DEFAULT_TRANSITION ? null : type;
  if ((target.transition || null) === value) return project;
  return { ...project, events: project.events.map((e) => (e.id === target.id ? { ...e, transition: value } : e)) };
}

// Aplica los mismos cambios a varios eventos (o, si changes es una función, los que devuelva para cada uno).
export function updateEvents(project, ids, changes) {
  const set = new Set(ids);
  if (!project.events.some((e) => set.has(e.id))) return project;
  return {
    ...project,
    events: project.events.map((e) => (set.has(e.id) ? { ...e, ...(typeof changes === 'function' ? changes(e) : changes) } : e)),
  };
}

// Agrupa los eventos para que se muevan, recorten y dividan juntos.
export function groupEvents(project, ids) {
  if (ids.length < 2) return project;
  return updateEvents(project, ids, { groupId: uid('g') });
}

export function ungroupEvents(project, ids) {
  return updateEvents(project, ids, { groupId: null });
}

// ---- Portapapeles ----

// Copia los eventos indicados con su posición relativa al primero y el tipo de pista, para pegarlos después.
export function copyEvents(project, ids) {
  const set = new Set(ids);
  const events = project.events.filter((e) => set.has(e.id));
  if (!events.length) return null;
  const origin = Math.min(...events.map((e) => e.start));
  const types = new Map(project.tracks.map((t) => [t.id, t.type]));
  const textIds = new Set(events.map((e) => e.mediaId));
  return {
    events: events.map((e) => ({ ...e, start: e.start - origin, trackType: types.get(e.trackId) })),
    duration: Math.max(...events.map((e) => e.start + e.duration)) - origin,
    texts: project.media.filter((m) => isText(m) && textIds.has(m.id)), // los textos se pegan como copias independientes
  };
}

// Pega en el instante t, en las mismas pistas de donde se copió (creando las que falten).
// Con targetTrackId, los eventos de ese tipo bajan o suben de pista para que el de más arriba caiga en ella.
// Devuelve { project, ids, end }: ids de los eventos nuevos y el final de lo pegado.
export function pasteEvents(project, clip, t, targetTrackId = null) {
  let p = project;
  // Cada texto pegado es un medio nuevo, para poder cambiarlo sin cambiar el original.
  const textCopies = new Map((clip?.texts || []).map((m) => [m.id, { ...m, id: uid('m') }]));
  const mediaIds = new Set([...p.media.map((m) => m.id), ...textCopies.keys()]);
  const items = clip ? clip.events.filter((e) => mediaIds.has(e.mediaId)) : [];
  if (!items.length) return { project, ids: [], end: t };
  if (textCopies.size) p = { ...p, media: [...p.media, ...textCopies.values()] };

  const sameType = (type) => p.tracks.filter((tr) => tr.type === type);
  const target = p.tracks.find((tr) => tr.id === targetTrackId);
  let shift = 0;
  if (target) {
    const list = sameType(target.type).map((tr) => tr.id);
    const used = items.filter((e) => e.trackType === target.type).map((e) => Math.max(0, list.indexOf(e.trackId)));
    if (used.length) shift = list.indexOf(target.id) - Math.min(...used);
  }
  const trackFor = (e) => {
    let list = sameType(e.trackType);
    let i = Math.max(0, list.findIndex((tr) => tr.id === e.trackId)); // si la pista ya no existe, la primera de su tipo
    if (target && e.trackType === target.type) i += shift;
    while (list.length <= i) {
      p = addTrack(p, e.trackType, 'afterType').project;
      list = sameType(e.trackType);
    }
    return list[i].id;
  };

  const groups = new Map();
  const added = items.map(({ trackType, ...e }) => {
    let groupId = null;
    if (e.groupId) {
      if (!groups.has(e.groupId)) groups.set(e.groupId, uid('g'));
      groupId = groups.get(e.groupId);
    }
    const mediaId = textCopies.get(e.mediaId)?.id ?? e.mediaId;
    return { ...e, id: uid('e'), mediaId, trackId: trackFor({ ...e, trackType }), start: t + e.start, groupId };
  });
  return { project: { ...p, events: [...p.events, ...added] }, ids: added.map((e) => e.id), end: t + clip.duration };
}

// ---- Edición en cascada (ripple, como «Auto Ripple» de VEGAS) ----
// ripple: 'tracks' (solo las pistas afectadas) o 'all' (todas). Con null no hay cascada.

const EPS = 1e-6;

// Intervalos [a, b) unidos y ordenados.
function unionOf(intervals) {
  const sorted = intervals.filter(([a, b]) => b > a + EPS).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// Partes de los intervalos U que no tapa ningún intervalo de R.
function subtract(U, R) {
  let parts = U.map(([a, b]) => [a, b]);
  for (const [ra, rb] of R) {
    parts = parts.flatMap(([a, b]) => {
      if (rb <= a || ra >= b) return [[a, b]];
      return [[a, ra], [rb, b]].filter(([x, y]) => y > x + EPS);
    });
  }
  return parts;
}

// Divide un evento (y su grupo) en los instantes del medio `sourceTimes` (s desde su punto de entrada), por
// ejemplo los cambios de plano. Se ajustan a la rejilla de fotogramas y se descartan los que quedarían a menos de
// minGap de otro corte o de un borde. Devuelve { project, cuts }.
export function splitAtSourceTimes(project, eventId, sourceTimes, minGap = 0.5) {
  const ev = project.events.find((e) => e.id === eventId);
  if (!ev) return { project, cuts: 0 };
  const fps = project.settings.fps;
  const ids = project.events.filter((e) => e.id === ev.id || (ev.groupId && e.groupId === ev.groupId)).map((e) => e.id);
  const times = [];
  for (const s of sourceTimes) {
    const t = Math.round((ev.start + localForSource(ev, s)) * fps) / fps;
    if (t - ev.start < minGap || ev.start + ev.duration - t < minGap) continue;
    if (times.length && t - times[times.length - 1] < minGap) continue;
    times.push(t);
  }
  // Del último al primero: la parte izquierda conserva el id, así que el evento original sigue en la selección.
  let next = project;
  for (const t of [...times].reverse()) next = splitEvents(next, t, ids);
  return { project: next, cuts: times.length };
}

// Congelar fotograma: divide el evento de video (y su grupo) en t, aparta lo que sigue en esas pistas `duration`
// segundos y pone en el hueco de la pista de video la imagen fija (media, el fotograma ya extraído) con los efectos
// y la panorámica que tenía el evento en ese instante (fijos, sin animación). El sonido queda en silencio.
export function freezeFrame(project, eventId, t, media, duration) {
  const ev = project.events.find((e) => e.id === eventId);
  if (!ev) return project;
  const group = project.events.filter((e) => e.id === ev.id || (ev.groupId && e.groupId === ev.groupId));
  const tracks = [...new Set(group.map((e) => e.trackId))];
  let next = splitEvents(project, t, group.map((e) => e.id));
  next = rippleShift(next, tracks, t - EPS, duration, 'tracks');
  const local = t - ev.start;
  const still = {
    ...EVENT_DEFAULTS,
    id: uid('e'), trackId: ev.trackId, mediaId: media.id, start: t, inPoint: 0, duration, groupId: null,
    effects: (ev.effects || []).map((fx) => ({ ...fx, id: uid('x'), params: fxParamsAt(fx, local), keyframes: null })),
    pan: panActive(ev.pan) ? { ...ev.pan, keyframes: [{ ...panAt(ev.pan, local), t: 0 }] } : null,
  };
  return { ...next, media: [...next.media, media], events: [...next.events, still] };
}

// Rampa de velocidad reflejada (lo que pasaba en t pasa en duration − t).
const mirrorSpeed = (speed, duration) => (speed?.length ? speed.map((p) => ({ ...p, t: duration - p.t })).reverse() : speed ?? null);

// Invertir el evento eventId y su grupo (los del mismo medio): con `media` (el trozo [start, start + span) del medio
// al revés, ver reverseClip), pasan a usarlo desde el punto equivalente; con media = null, vuelven al original. El
// punto se calcula a partir de lo que usa el evento ahora, así que vale aunque se haya recortado o dividido después.
// Los del grupo de `ev` que usan su mismo medio. Al procesar (`to` = final del trozo procesado, en el medio), solo
// los que usan un trozo dentro de [from, to]: dos eventos agrupados pueden usar partes distintas del mismo archivo, y
// el procesado solo tiene la del evento elegido.
function sameMediaGroup(project, ev, from = -Infinity, to = Infinity) {
  return new Set(project.events
    .filter((e) => e.id === ev.id || (ev.groupId && e.groupId === ev.groupId && e.mediaId === ev.mediaId
      && e.inPoint >= from - 1e-6 && e.inPoint + sourceOffset(e, e.duration) <= to + 1e-6))
    .map((e) => e.id));
}

export function setReversed(project, eventId, media, start, span) {
  const ev = project.events.find((e) => e.id === eventId);
  if (!ev) return project;
  const group = media ? sameMediaGroup(project, ev, start, start + span) : sameMediaGroup(project, ev);
  const events = project.events.map((e) => {
    if (!group.has(e.id)) return e;
    const used = sourceOffset(e, e.duration);
    if (media) {
      // Lo que empezaba en el medio en `a` pasa a empezar en start + span − (a + usado).
      return { ...e, mediaId: media.id, inPoint: Math.max(0, start + span - (e.inPoint + used)), speed: mirrorSpeed(e.speed, e.duration), reversed: { mediaId: e.mediaId, start, span } };
    }
    if (!e.reversed) return e;
    const r = e.reversed;
    return { ...e, mediaId: r.mediaId, inPoint: Math.max(0, r.start + r.span - (e.inPoint + used)), speed: mirrorSpeed(e.speed, e.duration), reversed: null };
  });
  return { ...project, media: media && !project.media.some((m) => m.id === media.id) ? [...project.media, media] : project.media, events };
}

// Estabilizar el evento eventId y su grupo (los del mismo medio): con `media` (el trozo desde `start` del medio,
// estabilizado), pasan a usarlo; con media = null, vuelven al medio de antes. Mismos tiempos (solo se desplazan).
export function setStabilized(project, eventId, media, start) {
  const ev = project.events.find((e) => e.id === eventId);
  if (!ev) return project;
  const group = media ? sameMediaGroup(project, ev, start, start + (media.duration || Infinity)) : sameMediaGroup(project, ev);
  const events = project.events.map((e) => {
    if (!group.has(e.id)) return e;
    if (media) return { ...e, mediaId: media.id, inPoint: Math.max(0, e.inPoint - start), stabilized: { mediaId: e.mediaId, start } };
    if (!e.stabilized) return e;
    return { ...e, mediaId: e.stabilized.mediaId, inPoint: e.stabilized.start + e.inPoint, stabilized: null };
  });
  return { ...project, media: media && !project.media.some((m) => m.id === media.id) ? [...project.media, media] : project.media, events };
}

// Reducir el ruido de un evento de audio (solo ese: el video de su grupo sigue con el original): con `media` (el
// sonido desde `start` del medio, limpio) pasa a usarlo; con media = null vuelve al de antes.
export const setDenoised = (project, eventId, media, start) => swapAudio(project, eventId, media, start, 'denoised');

// Quitar las voces de un evento de audio (para doblar encima), igual que setDenoised. `extra`: medios que se añaden
// también a la ventana de medios (la pista de voces sola, de referencia).
export function setDevoiced(project, eventId, media, start, extra = []) {
  const next = swapAudio(project, eventId, media, start, 'devoiced');
  const add = extra.filter((m) => !next.media.some((x) => x.id === m.id));
  return add.length ? { ...next, media: [...next.media, ...add] } : next;
}

// El evento pasa a usar `media` (un archivo hecho a partir del trozo que usaba, desde `start` del medio de antes) y
// apunta en `field` de dónde venía; con media = null vuelve al medio de antes.
function swapAudio(project, eventId, media, start, field) {
  const events = project.events.map((e) => {
    if (e.id !== eventId) return e;
    if (media) return { ...e, mediaId: media.id, inPoint: Math.max(0, e.inPoint - start), [field]: { mediaId: e.mediaId, start } };
    if (!e[field]) return e;
    return { ...e, mediaId: e[field].mediaId, inPoint: e[field].start + e.inPoint, [field]: null };
  });
  return { ...project, media: media && !project.media.some((m) => m.id === media.id) ? [...project.media, media] : project.media, events };
}

// Cuánto de los huecos G queda antes de t.
const removedBefore = (G, t) => G.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, t + EPS) - a), 0);

// Pistas a las que afecta la cascada al editar en las pistas trackIds.
const rippleTracks = (project, trackIds, ripple) =>
  new Set(ripple === 'all' ? project.tracks.map((t) => t.id) : trackIds);

// Desplaza delta segundos los eventos de las pistas afectadas que empiezan en `from` o después (salvo exclude).
export function rippleShift(project, trackIds, from, delta, ripple, exclude = new Set()) {
  if (!ripple || Math.abs(delta) < EPS) return project;
  const tracks = rippleTracks(project, trackIds, ripple);
  const marks = ripple === 'all' ? shiftMarks(project, (t) => (t >= from - EPS ? delta : 0)) : project;
  return {
    ...marks,
    events: project.events.map((e) => (
      tracks.has(e.trackId) && !exclude.has(e.id) && e.start >= from - EPS ? { ...e, start: Math.max(0, e.start + delta) } : e
    )),
  };
}

// Elimina eventos y, en cascada, cierra los huecos que dejan: lo de detrás se adelanta lo que ocupaban
// (sin contar el tiempo que sigue ocupado por otros eventos de su pista, p. ej. el solapamiento de una transición).
export function rippleDelete(project, ids, ripple) {
  const removed = project.events.filter((e) => ids.includes(e.id));
  const rest = deleteEvents(project, ids);
  if (!ripple || !removed.length) return rest;
  const byTrack = new Map();
  for (const e of removed) {
    if (!byTrack.has(e.trackId)) byTrack.set(e.trackId, []);
    byTrack.get(e.trackId).push([e.start, e.start + e.duration]);
  }
  const gapsOf = (trackId) => {
    const own = rest.events.filter((e) => e.trackId === trackId).map((e) => [e.start, e.start + e.duration]);
    return subtract(unionOf(byTrack.get(trackId)), unionOf(own));
  };
  const gaps = new Map([...byTrack.keys()].map((id) => [id, gapsOf(id)]));
  const allGaps = unionOf([...gaps.values()].flat());
  const marks = ripple === 'all' ? shiftMarks(rest, (t) => -removedBefore(allGaps, t)) : rest;
  return {
    ...marks,
    events: rest.events.map((e) => {
      const G = ripple === 'all' ? allGaps : gaps.get(e.trackId);
      if (!G?.length) return e;
      const shift = removedBefore(G, e.start);
      return shift > EPS ? { ...e, start: Math.max(0, e.start - shift) } : e;
    }),
  };
}

// Elimina el tramo [a, b) de todas las pistas (como cortar la selección de tiempo en VEGAS con la cascada
// activada): divide los eventos en a y en b, quita lo de dentro y adelanta lo de detrás b − a.
export function deleteRange(project, a, b) {
  let p = splitEvents(splitEvents(project, a, []), b, []);
  const inside = p.events.filter((e) => e.start >= a - EPS && e.start + e.duration <= b + EPS).map((e) => e.id);
  p = deleteEvents(p, inside);
  // Los marcadores del tramo quedan en a; los de detrás se adelantan.
  p = shiftMarks(p, (t) => (t >= b - EPS ? -(b - a) : t > a ? a - t : 0));
  return {
    ...p,
    events: p.events.map((e) => (e.start >= b - EPS ? { ...e, start: Math.max(0, e.start - (b - a)) } : e)),
  };
}

export function deleteEvents(project, ids) {
  const remove = new Set(ids);
  return { ...project, events: project.events.filter((e) => !remove.has(e.id)) };
}

// Quita un medio y sus eventos. Los eventos que lo recuerdan para deshacer un proceso (invertir, estabilizar,
// reducir el ruido, quitar las voces) se quedan con el medio procesado y olvidan ese «deshacer»: si no, al
// deshacerlo apuntarían a un medio que ya no existe.
const UNDO_FIELDS = ['reversed', 'stabilized', 'denoised', 'devoiced'];
export function removeMedia(project, mediaId) {
  return {
    ...project,
    media: project.media.filter((m) => m.id !== mediaId),
    events: project.events
      .filter((e) => e.mediaId !== mediaId)
      .map((e) => (UNDO_FIELDS.some((f) => e[f]?.mediaId === mediaId)
        ? { ...e, ...Object.fromEntries(UNDO_FIELDS.filter((f) => e[f]?.mediaId === mediaId).map((f) => [f, null])) }
        : e)),
  };
}

export function deleteTrack(project, trackId) {
  return {
    ...project,
    tracks: project.tracks.filter((t) => t.id !== trackId),
    events: project.events.filter((e) => e.trackId !== trackId),
  };
}

// Versión para guardar en disco: sin miniaturas ni formas de onda (se regeneran al abrir).
// view = estado de la edición que no forma parte del proyecto pero se recupera al abrirlo, como en VEGAS:
// { timeSelection: { start, end } | null, cursor } (no se deshace ni marca el proyecto como modificado).
export function serializeProject(project, view = null) {
  return {
    format: 'cortex-studio',
    version: 10,
    settings: project.settings,
    media: project.media.map(({ id, path, name, kind, text }) => (kind === 'text' ? { id, kind, name, text } : { id, path, name })),
    tracks: project.tracks,
    events: project.events,
    markers: project.markers || [],
    regions: project.regions || [],
    subtitles: project.subtitles || emptySubtitles(),
    ...(view && { view }),
  };
}

// Estado de la edición guardado con el proyecto (ver serializeProject), comprobado.
export function loadView(data) {
  const v = data?.view || {};
  const s = v.timeSelection;
  const ok = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  return {
    timeSelection: s && ok(s.start) && ok(s.end) && s.end > s.start ? { start: s.start, end: s.end } : null,
    cursor: ok(v.cursor) ? v.cursor : 0,
  };
}

// Reconstruye un proyecto leído de disco, completando los campos que falten en versiones anteriores.
export function loadProject(data, media) {
  return {
    settings: { ...DEFAULT_SETTINGS, ...data.settings },
    media,
    tracks: data.tracks.map((t) => ({ muted: false, solo: false, volume: 0, pan: 0, ...t })),
    events: data.events.map((e) => ({ ...EVENT_DEFAULTS, ...e })),
    markers: data.markers || [],
    regions: data.regions || [],
    subtitles: data.subtitles ? { ...emptySubtitles(), ...data.subtitles, style: { ...SUB_STYLE, ...data.subtitles.style } } : emptySubtitles(),
  };
}

// Lo mínimo que necesita el proceso principal para renderizar (con el silencio/solo, los fundidos,
// las transiciones y los efectos ya resueltos). size = { width, height } del video que se va a generar.
// Los eventos de video con efectos llevan fx = { w, h, graph, alpha }: el tamaño encajado y el
// subgrafo de FFmpeg de su cadena de efectos (ver effects.js). Los textos van dibujados como PNG (png).
// range = { start, end }: renderizar solo ese tramo (la selección de tiempo); los eventos de fuera se quitan.
// opts.subtitles: 'burn' (quemados en la imagen: una pista de video más, encima de todo, con un PNG por subtítulo),
// 'soft' (pista de subtítulos aparte: subtitlesSrt) o 'none'.
export function renderPayload(project, size = project.settings, range = null, opts = {}) {
  const { fades, transitions } = resolveTimeline(project);
  const inRange = (e) => !range || (e.start < range.end && e.start + e.duration > range.start);
  const cues = (project.subtitles?.cues || []).filter((c) => c.text.trim() && (!range || (c.start < range.end && c.end > range.start)));
  const burn = opts.subtitles === 'burn' && cues.length > 0;
  const subTrack = { id: '__subtitulos', type: 'video', muted: false, solo: false, volume: 0 };
  const subEvents = burn
    ? cues.map((c) => ({ ...EVENT_DEFAULTS, id: `sub~${c.id}`, trackId: subTrack.id, mediaId: `sub~${c.id}`, start: c.start, duration: c.end - c.start, inPoint: 0, groupId: null }))
    : [];
  if (burn) {
    project = {
      ...project,
      tracks: [subTrack, ...project.tracks],
      events: [...project.events, ...subEvents],
      media: [
        ...project.media,
        ...cues.map((c) => ({ id: `sub~${c.id}`, kind: 'text', name: tx('Subtítulo'), text: subtitleParams(project.subtitles.style, c.text), isImage: true, hasVideo: true, hasAudio: false })),
      ],
    };
  }
  const events = project.events.filter(inRange);
  const kept = new Set(events.map((e) => e.id));
  const used = new Set(events.map((e) => e.mediaId));
  const mediaById = new Map(project.media.map((m) => [m.id, isText(m) ? { ...m, width: size.width, height: size.height } : m]));
  const trackType = new Map(project.tracks.map((t) => [t.id, t.type]));
  const afxOf = (e) => {
    if (trackType.get(e.trackId) !== 'audio' || !e.effects?.length) return null;
    return effectsGraph(e.effects, { peak: eventPeak(mediaById.get(e.mediaId), e) }, 'audio');
  };
  const fxOf = (e) => {
    if (trackType.get(e.trackId) !== 'video' || !e.effects?.length) return null;
    const m = mediaById.get(e.mediaId);
    const fit = m && fitSize(m.width, m.height, size.width, size.height);
    const alpha = !!m && (isText(m) || !!m.hasAlpha); // imagen con transparencia: los efectos la conservan
    const g = fit && effectsGraph(e.effects, { ...fit, alpha }, 'video', { duration: e.duration, fps: project.settings.fps });
    return g ? { ...fit, ...g, alpha: g.alpha || alpha } : null;
  };
  // Panorámica/recorte: tamaño de la imagen encajada, recorte y expresiones de FFmpeg de x, y, escala y giro
  // (radianes) en función de @T@, el tiempo local del evento, que pone el proceso principal (ver pan.js).
  const panOf = (e) => {
    if (trackType.get(e.trackId) !== 'video' || !panActive(e.pan)) return null;
    const m = mediaById.get(e.mediaId);
    const fit = m && fitSize(m.width, m.height, size.width, size.height);
    if (!fit) return null;
    const expr = (prop) => panExpr(e.pan, prop, '@T@');
    return { ...fit, crop: e.pan.crop, x: expr('x'), y: expr('y'), scale: expr('scale'), rotation: expr('rotation') };
  };
  // Textos animados: cada evento lleva sus fotogramas (PNG con su duración, ver textSequence) como un medio propio
  // que el proceso principal monta como video.
  const sequences = new Map();
  for (const e of events) {
    const m = mediaById.get(e.mediaId);
    if (!isText(m) || !hasTextAnim(m.text)) continue;
    sequences.set(e.id, {
      id: `${m.id}~${e.id}`, isImage: false, hasVideo: true, hasAudio: false, duration: e.duration,
      sequence: textSequence(m.text, size.width, size.height, e.duration, project.settings.fps),
    });
  }
  return {
    media: [
      ...project.media
        .filter((m) => used.has(m.id))
        .map(({ id, path, isImage, hasVideo, hasAudio, missing, kind, text }) => ({
          id, path, isImage, hasVideo, hasAudio, missing, png: kind === 'text' ? textPng(text, size.width, size.height) : undefined,
        })),
      ...sequences.values(),
    ],
    tracks: project.tracks.map((t) => ({
      id: t.id,
      type: t.type,
      muted: !isTrackActive(t, project.tracks),
      gain: volumeToGain(t.volume ?? 0),
      mix: t.type === 'audio' ? trackMixExpr(t) : null, // envolventes y panorámica (ganancia de cada canal)
      // Video: modo de fusión y envolvente de opacidad (expresión en función de @T@).
      blend: t.type === 'video' ? t.blend || 'normal' : undefined,
      opacity: t.type === 'video' ? trackOpacityExpr(t) : null,
    })),
    events: events.map(({ effects, ...e }) => ({
      ...e,
      ...fades.get(e.id),
      gain: volumeToGain(e.volume ?? 0),
      fx: fxOf({ ...e, effects }),
      pan: panOf(e),
      speedMap: speedPayload(e),
      afx: afxOf({ ...e, effects }),
      ...(sequences.has(e.id) && { mediaId: sequences.get(e.id).id, inPoint: 0 }),
    })),
    transitions: transitions.filter((tr) => kept.has(tr.from) && kept.has(tr.to)),
    range,
    // LUT de los efectos LUT: el proceso principal las copia a la carpeta temporal con su nombre (lutName).
    luts: [...new Set(events.flatMap((e) => (e.effects || [])
      .filter((fx) => fx.type === 'lut' && fx.enabled !== false && fx.params?.file)
      .map((fx) => fx.params.file)))].map((file) => ({ path: file, name: lutName(file) })),
    subtitlesSrt: opts.subtitles === 'soft' && cues.length ? toSrt(cues, range ? range.start : 0, range ? range.end - range.start : Infinity) : null,
  };
}
