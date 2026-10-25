// Compresor de video: ajustes por defecto, preajustes y los del usuario (localStorage `cortex-compress`).
// Los argumentos de FFmpeg los monta electron/compressor.js.

import { tx } from '../i18n/index.js';
export const DEFAULT_SETTINGS = {
  encoder: 'x264',
  mode: 'quality', // 'quality' (calidad constante) | 'bitrate' | 'size' (tamaño de archivo, a dos pasadas)
  quality: 22,
  kbps: 2500,
  sizeMB: 25,
  twoPass: true,
  speed: 5, // índice en la lista de velocidades del codificador (0 = la más rápida)
  tune: '',
  tenBit: false,
  container: 'mp4',
  webOptimized: true,
  maxSize: 1080, // lado corto máximo (0 = como el original)
  crop: 'auto',
  deinterlace: 'auto',
  denoise: 'off',
  sharpen: 'off',
  rotate: 0,
  hdr: 'sdr',
  fps: 0,
  fpsPeak: true,
  audio: { tracks: 'all', codec: 'aac', kbps: 160, mix: 'stereo' },
  subtitles: 'all',
  chapters: true,
  metadata: true,
  dir: '', // '' = junto al original
  importAfter: false,
};

// Preajustes incluidos. `gpu: true` usa el primer codificador H.265 de la tarjeta gráfica que funcione.
export const PRESETS = [
  { id: 'general', name: tx('Equilibrado (H.264, hasta 1080p)'), settings: {} },
  { id: 'fast', name: tx('Rápido (H.264, hasta 1080p)'), settings: { quality: 23, speed: 2 } },
  { id: 'hq', name: tx('Alta calidad (H.265, tamaño original)'), settings: { encoder: 'x265', quality: 20, speed: 6, maxSize: 0, audio: { tracks: 'all', codec: 'aac', kbps: 192, mix: 'stereo' } } },
  { id: 'small', name: tx('Pequeño (H.265, hasta 1080p)'), settings: { encoder: 'x265', quality: 26, audio: { tracks: 'all', codec: 'aac', kbps: 128, mix: 'stereo' } } },
  { id: 'tiny', name: tx('Muy pequeño (H.265, 720p)'), settings: { encoder: 'x265', quality: 28, maxSize: 720, audio: { tracks: 'first', codec: 'aac', kbps: 96, mix: 'stereo' } } },
  { id: 'send', name: tx('Para enviar (cabe en 10 MB, 720p)'), settings: { mode: 'size', sizeMB: 10, maxSize: 720, speed: 4, audio: { tracks: 'first', codec: 'aac', kbps: 96, mix: 'stereo' }, subtitles: 'none' } },
  { id: 'gpu', name: tx('Con la tarjeta gráfica (H.265, muy rápido)'), gpu: true, settings: { quality: 26, maxSize: 0 } },
  { id: 'web', name: tx('Web (WebM VP9 + Opus)'), settings: { encoder: 'vp9', quality: 32, speed: 2, container: 'webm', audio: { tracks: 'first', codec: 'opus', kbps: 128, mix: 'stereo' } } },
  { id: 'archive', name: tx('Archivo (AV1 + Opus, lento)'), settings: { encoder: 'av1', quality: 30, speed: 2, container: 'mkv', maxSize: 0, audio: { tracks: 'all', codec: 'opus', kbps: 128, mix: 'keep' } } },
];

// Ajustes de un preajuste sobre los de por defecto (sin tocar carpeta ni importar). `encoders` = los disponibles.
export function presetSettings(preset, encoders, current = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...preset.settings, audio: { ...DEFAULT_SETTINGS.audio, ...preset.settings.audio }, dir: current.dir, importAfter: current.importAfter };
  if (preset.gpu) {
    const hw = encoders.find((e) => e.hw && e.codec === 'hevc') || encoders.find((e) => e.hw);
    if (hw) Object.assign(s, { encoder: hw.id, speed: hw.defSpeed, quality: hw.quality.def });
  }
  return fitEncoder(s, encoders);
}

// Corrige los ajustes que no valen para el codificador (velocidad, contenedor, 10 bits…).
export function fitEncoder(s, encoders) {
  const enc = encoders.find((e) => e.id === s.encoder) || encoders[0];
  if (!enc) return s;
  const next = { ...s, encoder: enc.id };
  if (next.speed >= enc.speeds.length) next.speed = enc.defSpeed;
  if (!enc.containers.includes(next.container)) next.container = enc.containers[0];
  if (!enc.tenBit) next.tenBit = false;
  if (!enc.tunes?.some(([id]) => id === next.tune)) next.tune = '';
  next.quality = Math.min(enc.quality.max, Math.max(enc.quality.min, next.quality));
  if (next.container === 'webm' && !['opus', 'copy'].includes(next.audio.codec)) next.audio = { ...next.audio, codec: 'opus' };
  return next;
}

const STORE = 'cortex-compress';
export function loadStore() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) || '{}');
    return { settings: { ...DEFAULT_SETTINGS, ...d.settings, audio: { ...DEFAULT_SETTINGS.audio, ...d.settings?.audio } }, preset: d.preset || 'general', user: d.user || [] };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, preset: 'general', user: [] };
  }
}
export function saveStore(d) {
  try {
    localStorage.setItem(STORE, JSON.stringify(d));
  } catch {}
}

export const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|mkv|webm|avi|wmv|flv|mpg|mpeg|ts|mts|m2ts|3gp|ogv|vob|mxf)$/i;
