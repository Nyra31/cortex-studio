// Subtítulos del proyecto: project.subtitles = { cues: [{ id, start, end, text }], style, preview }.
// Los subtítulos (cues) van en tiempos de la línea de tiempo y ordenados. style: aspecto (lo de TEXT_DEFAULTS que
// tiene sentido: fuente, tamaño, color, contorno, caja y altura y); preview: si se ven en la vista previa.
// Se dibujan con drawText (como un medio de texto centrado), así que vista previa y render coinciden. En el render
// se pueden quemar en la imagen o ir como pista de subtítulos aparte (SRT dentro del archivo).
import { uid } from './project.js';
import { TEXT_DEFAULTS } from './text.js';

export const SUB_STYLE = {
  font: 'Open Sans',
  size: 0.05,
  bold: false,
  color: '#ffffff',
  outline: 0.06,
  outlineColor: '#000000',
  box: 0, // caja detrás del texto (opacidad)
  boxColor: '#000000',
  y: 0.88,
};
export const emptySubtitles = () => ({ cues: [], style: { ...SUB_STYLE }, preview: true });
export const subtitlesOf = (project) => project.subtitles || emptySubtitles();

// Parámetros de texto (drawText) de un subtítulo.
export const subtitleParams = (style, text) => ({ ...TEXT_DEFAULTS, ...SUB_STYLE, ...style, text, x: 0.5, align: 'center' });

export const cueAt = (subs, t) => subs?.cues?.find((c) => c.start <= t && t < c.end) || null;

const withCues = (project, cues) => ({
  ...project,
  subtitles: { ...subtitlesOf(project), cues: [...cues].sort((a, b) => a.start - b.start) },
});

// Subtítulo nuevo de start a end (sin pisar al siguiente). Devuelve { project, cue }.
export function addCue(project, start, end, text = '') {
  const subs = subtitlesOf(project);
  const next = subs.cues.find((c) => c.start > start + 1e-6);
  const cue = { id: uid('c'), start, end: Math.max(start + 0.2, next ? Math.min(end, next.start) : end), text };
  return { project: withCues(project, [...subs.cues, cue]), cue };
}
export const updateCue = (project, id, changes) => withCues(project, subtitlesOf(project).cues.map((c) => (c.id === id ? { ...c, ...changes } : c)));
export const removeCue = (project, id) => withCues(project, subtitlesOf(project).cues.filter((c) => c.id !== id));
export const setSubtitleOptions = (project, changes) => ({ ...project, subtitles: { ...subtitlesOf(project), ...changes } });

// ---- SRT y WebVTT ----

const pad = (n, l = 2) => String(n).padStart(l, '0');
function stamp(t, sep) {
  const ms = Math.max(0, Math.round(t * 1000));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`;
}

// cues → texto SRT. offset: se resta a los tiempos (render de una selección); los de fuera de [0, length) se quitan.
export function toSrt(cues, offset = 0, length = Infinity) {
  return cues
    .map((c) => ({ ...c, start: c.start - offset, end: c.end - offset }))
    .filter((c) => c.end > 0 && c.start < length && c.text.trim())
    .map((c, i) => `${i + 1}\n${stamp(Math.max(0, c.start), ',')} --> ${stamp(Math.min(length, c.end), ',')}\n${c.text.trim()}\n`)
    .join('\n');
}

// Lee un SRT o WebVTT: [{ start, end, text }]. Quita las etiquetas de formato (<i>, {\an8}…).
export function parseSubtitles(text) {
  const out = [];
  const blocks = String(text).replace(/^﻿/, '').replace(/\r/g, '').split(/\n{2,}/);
  const time = (s) => {
    const m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(s);
    if (!m) return null;
    return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
  };
  for (const block of blocks) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = time(a);
    const end = time(b);
    if (start === null || end === null || end <= start) continue;
    const body = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
    if (body) out.push({ start, end, text: body });
  }
  return out.sort((x, y) => x.start - y.start);
}

// Añade subtítulos leídos (parseSubtitles) al proyecto, con ids nuevos.
export const importCues = (project, list, replace = false) =>
  withCues(project, [...(replace ? [] : subtitlesOf(project).cues), ...list.map((c) => ({ ...c, id: uid('c') }))]);
