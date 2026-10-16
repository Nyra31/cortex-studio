// Modelo del proyecto y operaciones de edición (funciones puras).
//
// project = {
//   media:  [{ id, path, name, duration, width, height, fps, hasVideo, hasAudio, isImage, thumb, peaks, peaksPerSecond, missing }],
//   tracks: [{ id, type: 'video' | 'audio', name, muted }],          // ordenadas como se ven, de arriba a abajo
//   events: [{ id, trackId, mediaId, start, inPoint, duration, groupId }], // tiempos en segundos
// }

export const MIN_EVENT = 0.04;
export const IMAGE_DURATION = 5;

let counter = 0;
export const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;

export function emptyProject() {
  return {
    media: [],
    tracks: [
      { id: uid('t'), type: 'video', name: 'Video 1', muted: false },
      { id: uid('t'), type: 'audio', name: 'Audio 1', muted: false },
    ],
    events: [],
  };
}

export function projectDuration(project) {
  return project.events.reduce((max, e) => Math.max(max, e.start + e.duration), 0);
}

export function mediaLength(media) {
  return media.isImage ? IMAGE_DURATION : media.duration;
}

// Las pistas de video van siempre arriba y las de audio abajo.
export function addTrack(project, type) {
  const count = project.tracks.filter((t) => t.type === type).length + 1;
  const track = { id: uid('t'), type, name: `${type === 'video' ? 'Video' : 'Audio'} ${count}`, muted: false };
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
  if (wantVideo) {
    const track = pickTrack('video');
    events.push({ id: uid('e'), trackId: track.id, mediaId: media.id, start, inPoint: 0, duration, groupId });
  }
  if (wantAudio) {
    const track = pickTrack('audio');
    events.push({ id: uid('e'), trackId: track.id, mediaId: media.id, start, inPoint: 0, duration, groupId });
  }
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
    added.push({ ...e, id: uid('e'), start: t, inPoint: e.inPoint + left, duration: e.duration - left, groupId });
    return { ...e, duration: left };
  });
  return { ...project, events: [...events, ...added] };
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
    version: 1,
    media: project.media.map(({ id, path, name }) => ({ id, path, name })),
    tracks: project.tracks,
    events: project.events,
  };
}

// Lo mínimo que necesita el proceso principal para renderizar.
export function renderPayload(project) {
  return {
    media: project.media.map(({ id, path, isImage, hasVideo, hasAudio, missing }) => ({ id, path, isImage, hasVideo, hasAudio, missing })),
    tracks: project.tracks,
    events: project.events,
  };
}
