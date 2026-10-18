// Modelo del proyecto y operaciones de edición (funciones puras).
import { DEFAULT_TRANSITION } from './transitions.js';
import { effectsGraph } from './effects.js';
import { isText, textPng } from './text.js';
import { panActive, panExpr, scalePanTime, shiftPan } from './pan.js';

//
// project = {
//   settings: { width, height, fps },
//   media:  [{ id, path, name, duration, width, height, fps, hasVideo, hasAudio, isImage, thumb, peaks, peaksPerSecond, missing }],
//           o medios de texto generados: { id, kind: 'text', name, text, ... } (ver text.js; sin archivo)
//   markers: [{ id, time, name, number }],         // marcadores (M), como en VEGAS
//   regions: [{ id, start, end, name, number }],   // regiones con nombre (R)
//   tracks: [{ id, type: 'video' | 'audio', name, muted, solo, volume }],  // ordenadas de arriba a abajo; volume en dB
//   events: [{ id, trackId, mediaId, start, inPoint, duration, groupId, volume, fadeIn, fadeOut, transition, effects, rate, pan }],
// }
// pan: panorámica/recorte con fotogramas clave (ver pan.js), solo en eventos de video; null o ausente = ninguna.
// effects: cadena [{ id, type, enabled, params }] aplicada en orden; efectos de video en los eventos de video
// y de audio en los de audio (ver effects.js y audio-effects.js).
// Tiempos en segundos. volume del evento en dB (solo afecta al audio); fadeIn/fadeOut = duración de los fundidos.
// rate = velocidad de reproducción (1 = normal, 2 = el doble de rápido). duration es lo que ocupa en la línea
// de tiempo; del medio se usan duration × rate segundos a partir de inPoint (ver sourceTime).
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

// Desplaza marcadores y regiones (la cascada en todas las pistas los mueve, como en VEGAS).
// shiftOf(t) → cuánto se mueve algo que está en t.
function shiftMarks(project, shiftOf) {
  return {
    ...project,
    markers: (project.markers || []).map((m) => ({ ...m, time: Math.max(0, m.time + shiftOf(m.time)) })),
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
export const formatVolume = (db) => (db <= MIN_VOLUME_DB ? '-∞ dB' : `${db > 0 ? '+' : ''}${db.toFixed(1).replace('.', ',')} dB`);

// Pico (0–1) del audio de un evento según la forma de onda del medio (lo usa el efecto Normalizar).
export function eventPeak(media, e) {
  if (!media?.peaks?.length) return 0;
  const pps = media.peaksPerSecond;
  const from = Math.max(0, Math.floor(e.inPoint * pps));
  const to = Math.min(media.peaks.length, Math.ceil((e.inPoint + e.duration * (e.rate || 1)) * pps));
  let max = 0;
  for (let i = from; i < to; i++) if (media.peaks[i] > max) max = media.peaks[i];
  return max / 255;
}

export const EVENT_DEFAULTS = { volume: 0, fadeIn: 0, fadeOut: 0, transition: null, effects: [], rate: 1 };

export { shiftPan, scalePanTime };

// Instante del medio que se ve o se oye en el instante t de la línea de tiempo.
export const sourceTime = (e, t) => e.inPoint + (t - e.start) * (e.rate || 1);
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
    fades.set(e.id, { fadeIn, fadeOut });
  }
  return { incoming, outgoing, fades, transitions };
}

// Factor de 0 a 1 que aplican los fundidos en el instante t (lineal, igual que fade y afade de FFmpeg).
export function fadeFactor(e, t, fades = eventFades(e)) {
  const { fadeIn, fadeOut } = fades;
  const local = t - e.start;
  let f = 1;
  if (fadeIn > 0 && local < fadeIn) f = Math.min(f, Math.max(0, local / fadeIn));
  if (fadeOut > 0 && local > e.duration - fadeOut) f = Math.min(f, Math.max(0, (e.duration - local) / fadeOut));
  return f;
}

export function formatFps(fps) {
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(3).replace(/0+$/, '').replace('.', ',');
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
    });
    return { ...e, duration: left, fadeOut: 0 };
  });
  return { ...project, events: [...events, ...added] };
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

export function removeMedia(project, mediaId) {
  return {
    ...project,
    media: project.media.filter((m) => m.id !== mediaId),
    events: project.events.filter((e) => e.mediaId !== mediaId),
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
export function serializeProject(project) {
  return {
    format: 'cortex-studio',
    version: 7,
    settings: project.settings,
    media: project.media.map(({ id, path, name, kind, text }) => (kind === 'text' ? { id, kind, name, text } : { id, path, name })),
    tracks: project.tracks,
    events: project.events,
    markers: project.markers || [],
    regions: project.regions || [],
  };
}

// Reconstruye un proyecto leído de disco, completando los campos que falten en versiones anteriores.
export function loadProject(data, media) {
  return {
    settings: { ...DEFAULT_SETTINGS, ...data.settings },
    media,
    tracks: data.tracks.map((t) => ({ muted: false, solo: false, volume: 0, ...t })),
    events: data.events.map((e) => ({ ...EVENT_DEFAULTS, ...e })),
    markers: data.markers || [],
    regions: data.regions || [],
  };
}

// Lo mínimo que necesita el proceso principal para renderizar (con el silencio/solo, los fundidos,
// las transiciones y los efectos ya resueltos). size = { width, height } del video que se va a generar.
// Los eventos de video con efectos llevan fx = { w, h, graph, alpha }: el tamaño encajado y el
// subgrafo de FFmpeg de su cadena de efectos (ver effects.js). Los textos van dibujados como PNG (png).
// range = { start, end }: renderizar solo ese tramo (la selección de tiempo); los eventos de fuera se quitan.
export function renderPayload(project, size = project.settings, range = null) {
  const { fades, transitions } = resolveTimeline(project);
  const inRange = (e) => !range || (e.start < range.end && e.start + e.duration > range.start);
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
    const g = fit && effectsGraph(e.effects, { ...fit, alpha });
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
  return {
    media: project.media
      .filter((m) => used.has(m.id))
      .map(({ id, path, isImage, hasVideo, hasAudio, missing, kind, text }) => ({
        id, path, isImage, hasVideo, hasAudio, missing, png: kind === 'text' ? textPng(text, size.width, size.height) : undefined,
      })),
    tracks: project.tracks.map((t) => ({
      id: t.id,
      type: t.type,
      muted: !isTrackActive(t, project.tracks),
      gain: volumeToGain(t.volume ?? 0),
    })),
    events: events.map(({ effects, ...e }) => ({
      ...e,
      ...fades.get(e.id),
      gain: volumeToGain(e.volume ?? 0),
      fx: fxOf({ ...e, effects }),
      pan: panOf(e),
      afx: afxOf({ ...e, effects }),
    })),
    transitions: transitions.filter((tr) => kept.has(tr.from) && kept.has(tr.to)),
    range,
  };
}
