// Modelo del proyecto y operaciones de edición (funciones puras).
import { DEFAULT_TRANSITION } from './transitions.js';

//
// project = {
//   settings: { width, height, fps },
//   media:  [{ id, path, name, duration, width, height, fps, hasVideo, hasAudio, isImage, thumb, peaks, peaksPerSecond, missing }],
//   tracks: [{ id, type: 'video' | 'audio', name, muted, solo, volume }],  // ordenadas de arriba a abajo; volume en dB
//   events: [{ id, trackId, mediaId, start, inPoint, duration, groupId, volume, fadeIn, fadeOut, transition }],
// }
// Tiempos en segundos. volume del evento en dB (solo afecta al audio); fadeIn/fadeOut = duración de los fundidos.
// Si un evento empieza encima del final de otro de su misma pista, el solapamiento es una transición:
// en video, la de `transition` del evento que entra (null = disolución cruzada); en audio, un fundido cruzado.

export const MIN_EVENT = 0.04;
export const IMAGE_DURATION = 5;
export const DEFAULT_SETTINGS = { width: 1920, height: 1080, fps: 30 };
export const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
export const MIN_VOLUME_DB = -48; // en el mínimo la pista queda en silencio (-∞)
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
  };
}

// Una pista suena o se ve si no está silenciada y, cuando hay pistas en solo de su tipo, si ella es una.
export function isTrackActive(track, tracks) {
  if (track.muted) return false;
  const anySolo = tracks.some((t) => t.type === track.type && t.solo);
  return anySolo ? !!track.solo : true;
}

export const volumeToGain = (db) => (db <= MIN_VOLUME_DB ? 0 : 10 ** (db / 20));
export const gainToVolume = (gain) => (gain <= volumeToGain(MIN_VOLUME_DB) ? MIN_VOLUME_DB : Math.min(0, 20 * Math.log10(gain)));
export const formatVolume = (db) => (db <= MIN_VOLUME_DB ? '-∞ dB' : `${db.toFixed(1).replace('.', ',')} dB`);

export const EVENT_DEFAULTS = { volume: 0, fadeIn: 0, fadeOut: 0, transition: null };

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

// Las pistas de video van siempre arriba y las de audio abajo.
export function addTrack(project, type) {
  const track = newTrack(type, project.tracks.filter((t) => t.type === type).length + 1);
  const tracks = [...project.tracks];
  if (type === 'video') {
    const lastVideo = tracks.map((t) => t.type).lastIndexOf('video');
    tracks.splice(lastVideo + 1, 0, track);
  } else {
    tracks.push(track);
  }
  return { project: { ...project, tracks }, track };
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
    added.push({ ...e, id: uid('e'), start: t, inPoint: e.inPoint + left, duration: e.duration - left, groupId, fadeIn: 0, transition: null });
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
  return {
    events: events.map((e) => ({ ...e, start: e.start - origin, trackType: types.get(e.trackId) })),
    duration: Math.max(...events.map((e) => e.start + e.duration)) - origin,
  };
}

// Pega en el instante t, en las mismas pistas de donde se copió (creando las que falten).
// Con targetTrackId, los eventos de ese tipo bajan o suben de pista para que el de más arriba caiga en ella.
// Devuelve { project, ids, end }: ids de los eventos nuevos y el final de lo pegado.
export function pasteEvents(project, clip, t, targetTrackId = null) {
  let p = project;
  const mediaIds = new Set(p.media.map((m) => m.id));
  const items = clip ? clip.events.filter((e) => mediaIds.has(e.mediaId)) : [];
  if (!items.length) return { project, ids: [], end: t };

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
      p = addTrack(p, e.trackType).project;
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
    return { ...e, id: uid('e'), trackId: trackFor({ ...e, trackType }), start: t + e.start, groupId };
  });
  return { project: { ...p, events: [...p.events, ...added] }, ids: added.map((e) => e.id), end: t + clip.duration };
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
    version: 3,
    settings: project.settings,
    media: project.media.map(({ id, path, name }) => ({ id, path, name })),
    tracks: project.tracks,
    events: project.events,
  };
}

// Reconstruye un proyecto leído de disco, completando los campos que falten en versiones anteriores.
export function loadProject(data, media) {
  return {
    settings: { ...DEFAULT_SETTINGS, ...data.settings },
    media,
    tracks: data.tracks.map((t) => ({ muted: false, solo: false, volume: 0, ...t })),
    events: data.events.map((e) => ({ ...EVENT_DEFAULTS, ...e })),
  };
}

// Lo mínimo que necesita el proceso principal para renderizar (con el silencio/solo, los fundidos
// y las transiciones ya resueltos).
export function renderPayload(project) {
  const { fades, transitions } = resolveTimeline(project);
  return {
    media: project.media.map(({ id, path, isImage, hasVideo, hasAudio, missing }) => ({ id, path, isImage, hasVideo, hasAudio, missing })),
    tracks: project.tracks.map((t) => ({
      id: t.id,
      type: t.type,
      muted: !isTrackActive(t, project.tracks),
      gain: volumeToGain(t.volume ?? 0),
    })),
    events: project.events.map((e) => ({ ...e, ...fades.get(e.id), gain: volumeToGain(e.volume ?? 0) })),
    transitions,
  };
}
