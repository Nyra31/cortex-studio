// Editar con el texto: transcripción palabra a palabra de los medios y cortes a partir de ella (funciones puras).
//
// project.transcripts = { [mediaId]: { language, model, words: [[t0, t1, texto]] } }, en tiempo del medio (no de la
// línea de tiempo), así sigue valiendo aunque se corten, muevan o cambien de velocidad los eventos. t0 y t1 son los
// instantes DTW de Whisper del principio y el final de la palabra (ver wordsOf en electron/whisper.js): caen dentro de
// la palabra, no en sus bordes. Los bordes se buscan con la forma de onda del medio (m.peaks): entre dos palabras,
// la parte más silenciosa (`wordBounds`). Un evento muestra las palabras de su medio que caen en el trozo que usa.
//
// Borrar texto = quitar ese tramo de todas las pistas y cerrar el hueco (deleteRange, como la cascada en todas las
// pistas), igual que en los editores que editan con el texto: lo que suena debajo (música) se corta también.
import { deleteRange } from './project.js';
import { localForSource, sourceOffset } from './speed.js';

const SILENT_DB = -38; // por debajo, pausa (en los picos de 0 a 255 de la forma de onda)
const EDGE_SEARCH = 0.8; // s antes de la primera palabra y después de la última en los que se busca el borde
export const PAUSE_MIN = 0.7; // pausas más largas se ven en el texto (y se pueden borrar)

// Muletillas (en minúsculas y sin signos). Solo sonidos que no son palabras en ninguno de los idiomas de Cortex.
const FILLERS = new Set([
  'eh', 'ehh', 'em', 'emm', 'ehm', 'mm', 'mmm', 'hm', 'hmm', 'um', 'umm', 'uh', 'uhh', 'uhm', 'erm',
  'euh', 'heu', 'äh', 'ähm', 'öhm', 'hum', 'ahn', 'hã', 'ãh',
]);
const bare = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const isFiller = (text) => FILLERS.has(bare(text));

export const transcriptOf = (project, mediaId) => project.transcripts?.[mediaId] || null;

// Las transcripciones de un .cortex, comprobadas (las que no tienen forma de lista de palabras se descartan).
export function cleanTranscripts(data) {
  if (!data || typeof data !== 'object') return {};
  const ok = (w) => Array.isArray(w) && Number.isFinite(w[0]) && Number.isFinite(w[1]) && typeof w[2] === 'string';
  return Object.fromEntries(Object.entries(data)
    .filter(([, t]) => Array.isArray(t?.words))
    .map(([id, t]) => [id, { ...t, words: t.words.filter(ok) }]));
}

export function setTranscript(project, mediaId, transcript) {
  const all = { ...(project.transcripts || {}) };
  if (transcript) all[mediaId] = transcript;
  else delete all[mediaId];
  return { ...project, transcripts: all };
}

// Copia la transcripción de un medio a otro hecho a partir de él desde `start` (reducir el ruido, quitar las voces:
// el mismo sonido, desplazado), para no tener que volver a transcribir.
export function copyTranscript(project, fromId, toMedia, start) {
  const tr = transcriptOf(project, fromId);
  if (!tr || transcriptOf(project, toMedia.id)) return project;
  const end = toMedia.duration ?? Infinity;
  const words = tr.words
    .map(([a, b, w]) => [a - start, b - start, w])
    .filter(([a, b]) => b >= 0 && a <= end);
  return setTranscript(project, toMedia.id, { ...tr, words });
}

// ---- Bordes de las palabras con la forma de onda ----

const bounds = new WeakMap(); // words → { peaks, out }: bordes calculados con esa forma de onda

function levelAt(m, s) {
  return m.peaks?.[Math.floor(s * m.peaksPerSecond)] ?? 0;
}

// En [a, b] (tiempo del medio): el tramo en silencio más largo (la pausa entre dos palabras; los silencios cortos
// dentro de una palabra, como el de una «t», no cuentan), o el instante más bajo si no hay silencio.
function quietSpan(m, a, b) {
  if (!m?.peaks || b <= a) return [(a + b) / 2, (a + b) / 2];
  const step = 1 / m.peaksPerSecond;
  const limit = 255 * 10 ** (SILENT_DB / 20);
  let best = null;
  let run = null;
  let min = Infinity;
  let minAt = (a + b) / 2;
  // Por bloques de la forma de onda (cada pico vale para [i·step, (i+1)·step)).
  for (let i = Math.floor(a / step); i * step <= b; i++) {
    const v = m.peaks[i] ?? 0;
    const s0 = Math.max(a, i * step);
    const s1 = Math.min(b, (i + 1) * step);
    if (v <= limit) {
      if (!run) run = [s0, s1];
      run[1] = s1;
      if (!best || run[1] - run[0] > best[1] - best[0]) best = [...run];
    } else {
      run = null;
    }
    if (v < min) {
      min = v;
      minAt = (s0 + s1) / 2;
    }
  }
  return best || [minAt, minAt];
}

// [[inicio, fin]] de cada palabra en tiempo del medio: el fin de una palabra es donde empieza el silencio que la
// sigue y el inicio de la siguiente, donde acaba (si no hay silencio, los dos en el punto más bajo).
export function wordBounds(m, words) {
  const cached = bounds.get(words);
  if (cached && cached.peaks === m.peaks) return cached.out;
  const out = words.map(([t0, t1]) => [t0, t1]);
  for (let i = 0; i <= words.length; i++) {
    const a = i === 0 ? Math.max(0, words[0][0] - EDGE_SEARCH) : words[i - 1][1];
    const b = i === words.length ? words[i - 1][1] + EDGE_SEARCH : words[i][0];
    const [q0, q1] = quietSpan(m, Math.min(a, b), Math.max(a, b));
    if (i > 0) out[i - 1][1] = Math.max(out[i - 1][0], q0);
    if (i < words.length) out[i][0] = Math.min(q1, words[i][1]);
  }
  bounds.set(words, { peaks: m.peaks, out });
  return out;
}

// ---- Palabras en la línea de tiempo ----

// Lista ordenada de lo que se ve en el panel: palabras { kind: 'word', key, eventId, start, end, text, filler } y
// pausas largas { kind: 'pause', … } entre palabras seguidas del mismo evento, en tiempo de la línea de tiempo.
export function timelineWords(project) {
  const audio = new Set(project.tracks.filter((t) => t.type === 'audio').map((t) => t.id));
  const media = new Map(project.media.map((m) => [m.id, m]));
  const items = [];
  for (const e of project.events) {
    if (!audio.has(e.trackId)) continue;
    const tr = transcriptOf(project, e.mediaId);
    const m = media.get(e.mediaId);
    if (!tr?.words.length || !m) continue;
    const span = wordBounds(m, tr.words);
    const srcA = e.inPoint;
    const srcB = e.inPoint + sourceOffset(e, e.duration);
    const toTimeline = (s) => e.start + Math.min(e.duration, Math.max(0, localForSource(e, s - srcA)));
    let prev = null;
    tr.words.forEach(([t0, t1, text], i) => {
      const mid = (t0 + t1) / 2;
      if (mid < srcA || mid >= srcB) return;
      const word = {
        kind: 'word', key: `${e.id}:${i}`, eventId: e.id,
        start: toTimeline(span[i][0]), end: toTimeline(span[i][1]), text, filler: isFiller(text),
      };
      if (prev && word.start - prev.end >= PAUSE_MIN) {
        items.push({ kind: 'pause', key: `${e.id}:p${i}`, eventId: e.id, start: prev.end, end: word.start, text: '' });
      }
      items.push(word);
      prev = word;
    });
  }
  return items.sort((x, y) => x.start - y.start || (x.kind === 'pause' ? -1 : 1));
}

// Tramo [a, b) de la línea de tiempo que se quita al borrar los elementos items[i..j]: desde el principio del
// primero hasta el principio de la palabra siguiente del mismo evento (así se va también la pausa de detrás y queda
// la de delante, como al hablar: entre lo de antes y lo de después queda la pausa que había antes de lo borrado);
// si no hay palabra siguiente en ese evento, hasta el final del último. Una pausa sola se acorta y deja 0,1 s a
// cada lado.
export function cutRange(items, i, j) {
  const first = items[i];
  const last = items[j];
  if (items.slice(i, j + 1).every((x) => x.kind === 'pause')) {
    return first.end - first.start > 0.3 ? [first.start + 0.1, last.end - 0.1] : null;
  }
  const next = items.slice(j + 1).find((x) => x.kind === 'word' && x.eventId === last.eventId);
  const b = next ? next.start : last.end;
  return b - first.start > 0.01 ? [first.start, b] : null;
}

// Quita varios tramos [a, b) de todas las pistas (de atrás adelante, para que los de antes no se muevan).
export function cutRanges(project, ranges) {
  const merged = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  let p = project;
  for (let k = merged.length - 1; k >= 0; k--) p = deleteRange(p, merged[k][0], merged[k][1]);
  return p;
}

// Tramos de las muletillas (cada una con la pausa que la sigue).
export function fillerRanges(items) {
  const out = [];
  items.forEach((x, i) => {
    if (x.kind !== 'word' || !x.filler) return;
    const r = cutRange(items, i, i);
    if (r) out.push(r);
  });
  return out;
}

// ---- Silencios (no hace falta la transcripción) ----

// Tramos [a, b) de la línea de tiempo en los que los eventos de la pista trackId están en silencio (por debajo de
// thresholdDb) durante al menos minDur s, dejando `keep` s de silencio a cada lado. Solo dentro de los eventos:
// los huecos de la pista no se tocan.
export function silenceRanges(project, trackId, { thresholdDb = -40, minDur = 0.6, keep = 0.15 } = {}) {
  const media = new Map(project.media.map((m) => [m.id, m]));
  const limit = 255 * 10 ** (thresholdDb / 20);
  const out = [];
  for (const e of project.events.filter((x) => x.trackId === trackId)) {
    const m = media.get(e.mediaId);
    if (!m?.peaks) continue;
    const step = 1 / m.peaksPerSecond;
    let from = null;
    const close = (t) => {
      if (from !== null && t - from >= minDur) {
        const a = e.start + from + (from > 0 ? keep : 0);
        const b = e.start + t - (t < e.duration ? keep : 0);
        if (b - a > 0.05) out.push([a, b]);
      }
      from = null;
    };
    for (let t = 0; t < e.duration; t += step / 2) {
      const quiet = levelAt(m, e.inPoint + sourceOffset(e, t)) <= limit;
      if (quiet && from === null) from = t;
      else if (!quiet) close(t);
    }
    close(e.duration);
  }
  return out;
}
