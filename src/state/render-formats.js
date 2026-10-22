// Formatos y plantillas de render (como las plantillas de «Renderizar como» de VEGAS). Los ids de formato son
// los de OUTPUT_FORMATS en electron/ffmpeg.js, que tiene los argumentos de cada codificador.

export const FORMATS = [
  { id: 'mp4-h264', name: 'MP4 (H.264 + AAC)', ext: 'mp4', video: true, quality: true, audioKbps: true },
  { id: 'mp4-h265', name: 'MP4 (H.265/HEVC + AAC): archivos más pequeños', ext: 'mp4', video: true, quality: true, audioKbps: true },
  { id: 'webm', name: 'WebM (VP9 + Opus): para la web', ext: 'webm', video: true, quality: true, audioKbps: true },
  { id: 'mov-prores', name: 'MOV (ProRes 422 HQ + PCM): para seguir editando', ext: 'mov', video: true },
  { id: 'gif', name: 'GIF animado (sin sonido)', ext: 'gif', video: true },
  { id: 'mp3', name: 'MP3 (solo audio)', ext: 'mp3', audioKbps: true },
  { id: 'wav', name: 'WAV (solo audio, sin compresión)', ext: 'wav' },
];
export const formatInfo = (id) => FORMATS.find((f) => f.id === id) || FORMATS[0];

// Tamaño de salida: el del proyecto (escalado) o uno fijo. Si la proporción no es la del proyecto, el proyecto
// se encaja con bandas negras (por ejemplo, un proyecto horizontal en un video vertical).
export const SIZES = [
  { id: 'p100', label: 'Proyecto (100 %)', scale: 1 },
  { id: 'p75', label: 'Proyecto (75 %)', scale: 0.75 },
  { id: 'p50', label: 'Proyecto (50 %)', scale: 0.5 },
  { id: '3840x2160', label: '3840 × 2160 (4K UHD)', w: 3840, h: 2160 },
  { id: '2560x1440', label: '2560 × 1440 (QHD)', w: 2560, h: 1440 },
  { id: '1920x1080', label: '1920 × 1080 (Full HD)', w: 1920, h: 1080 },
  { id: '1280x720', label: '1280 × 720 (HD)', w: 1280, h: 720 },
  { id: '854x480', label: '854 × 480', w: 854, h: 480 },
  { id: '1080x1920', label: '1080 × 1920 (vertical 9:16)', w: 1080, h: 1920 },
  { id: '1080x1350', label: '1080 × 1350 (vertical 4:5)', w: 1080, h: 1350 },
  { id: '1080x1080', label: '1080 × 1080 (cuadrado)', w: 1080, h: 1080 },
  { id: '640w', label: '640 px de ancho', w: 640 },
  { id: '480w', label: '480 px de ancho', w: 480 },
  { id: 'custom', label: 'Personalizado…' },
];

export const FRAME_RATE_CHOICES = [null, 10, 12, 15, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60]; // null = la del proyecto

export const QUALITY_LEVELS = [
  { id: 'high', label: 'Alta' },
  { id: 'normal', label: 'Normal' },
  { id: 'light', label: 'Ligera (archivo pequeño)' },
];
export const AUDIO_KBPS = [96, 128, 192, 256, 320];

// Plantillas: formato, tamaño, velocidad de fotogramas, calidad y audio.
export const TEMPLATES = [
  { id: 'project', name: 'Proyecto: MP4 H.264, calidad alta', format: 'mp4-h264', size: 'p100', fps: null, quality: { mode: 'crf', level: 'high' }, audioKbps: 192 },
  { id: 'yt1080', name: 'YouTube 1080p (H.264, 12 Mbps)', format: 'mp4-h264', size: '1920x1080', fps: null, quality: { mode: 'bitrate', mbps: 12 }, audioKbps: 256, loudness: -14 },
  { id: 'yt4k', name: 'YouTube 4K (H.264, 45 Mbps)', format: 'mp4-h264', size: '3840x2160', fps: null, quality: { mode: 'bitrate', mbps: 45 }, audioKbps: 256, loudness: -14 },
  { id: 'vertical', name: 'Vertical 1080 × 1920: TikTok, Reels, Shorts (H.264, 10 Mbps)', format: 'mp4-h264', size: '1080x1920', fps: null, quality: { mode: 'bitrate', mbps: 10 }, audioKbps: 192, loudness: -14 },
  { id: 'square', name: 'Cuadrado 1080 × 1080: Instagram (H.264, 8 Mbps)', format: 'mp4-h264', size: '1080x1080', fps: null, quality: { mode: 'bitrate', mbps: 8 }, audioKbps: 192, loudness: -14 },
  { id: 'hevc', name: 'Archivo pequeño: MP4 H.265, calidad normal', format: 'mp4-h265', size: 'p100', fps: null, quality: { mode: 'crf', level: 'normal' }, audioKbps: 192 },
  { id: 'web720', name: 'Web ligera 720p (WebM VP9)', format: 'webm', size: '1280x720', fps: null, quality: { mode: 'crf', level: 'normal' }, audioKbps: 128 },
  { id: 'prores', name: 'ProRes 422 HQ para seguir editando (MOV)', format: 'mov-prores', size: 'p100', fps: null },
  { id: 'gif', name: 'GIF animado, 480 px y 15 fps', format: 'gif', size: '480w', fps: 15 },
  { id: 'mp3', name: 'Solo audio: MP3 320 kbps', format: 'mp3', audioKbps: 320 },
  { id: 'wav', name: 'Solo audio: WAV', format: 'wav' },
];

const even = (v) => Math.max(2, Math.round(v / 2) * 2);

// Tamaño del archivo (out) y tamaño al que se monta el proyecto dentro de él (inner, sin bandas).
export function outputSize(sizeId, custom, project) {
  const s = SIZES.find((x) => x.id === sizeId) || SIZES[0];
  const aspect = project.width / project.height;
  let w;
  let h;
  if (s.scale) [w, h] = [project.width * s.scale, project.height * s.scale];
  else if (s.id === 'custom') [w, h] = [custom.w || project.width, custom.h || project.height];
  else if (!s.h) [w, h] = [s.w, s.w / aspect];
  else [w, h] = [s.w, s.h];
  const out = { w: even(w), h: even(h) };
  if (Math.abs(out.w / out.h - aspect) < 0.01 * aspect) return { out, inner: out, bands: false };
  const inner = out.w / out.h > aspect ? { w: even(out.h * aspect), h: out.h } : { w: out.w, h: even(out.w / aspect) };
  return { out, inner, bands: inner.w !== out.w || inner.h !== out.h };
}
