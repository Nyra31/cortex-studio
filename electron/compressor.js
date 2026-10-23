// Compresor de video por lotes (al estilo de HandBrake, implementación propia sobre FFmpeg): codificadores de software
// y de la tarjeta gráfica, calidad constante, tasa de bits o tamaño de archivo objetivo (a dos pasadas), recorte
// automático de bandas negras, desentrelazado, reducción de ruido, resolución máxima, pistas de audio y subtítulos.
// Los ajustes llegan de CompressDialog.jsx (forma en `DEFAULT_SETTINGS` de src/state/compress.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ffmpegPath, ffprobePath, run } = require('./ffmpeg');

const X26X_SPEEDS = [
  ['ultrafast', 'Ultrarrápido'], ['superfast', 'Superrápido'], ['veryfast', 'Muy rápido'], ['faster', 'Más rápido'],
  ['fast', 'Rápido'], ['medium', 'Medio'], ['slow', 'Lento'], ['slower', 'Más lento'], ['veryslow', 'Muy lento'],
];
const NVENC_SPEEDS = [1, 2, 3, 4, 5, 6, 7].map((n) => [`p${n}`, ['Muy rápido', 'Más rápido', 'Rápido', 'Medio', 'Lento', 'Más lento', 'Muy lento'][n - 1]]);
const QSV_SPEEDS = [['veryfast', 'Muy rápido'], ['faster', 'Más rápido'], ['fast', 'Rápido'], ['medium', 'Medio'], ['slow', 'Lento'], ['slower', 'Más lento'], ['veryslow', 'Muy lento']];
const AMF_SPEEDS = [['speed', 'Rápido'], ['balanced', 'Equilibrado'], ['quality', 'Calidad']];
const VPX_SPEEDS = [5, 4, 3, 2, 1, 0].map((n, i) => [String(n), ['Muy rápido', 'Rápido', 'Medio', 'Lento', 'Más lento', 'Muy lento'][i]]);
const AOM_SPEEDS = [8, 7, 6, 5, 4, 3].map((n, i) => [String(n), ['Muy rápido', 'Rápido', 'Medio', 'Lento', 'Más lento', 'Muy lento'][i]]);

const pixFmt = (o) => (o.tenBit ? 'yuv420p10le' : 'yuv420p');

// Cada codificador: nombre, códec, contenedores, escala de calidad (menor = mejor en todos), velocidades (de la más
// rápida a la más lenta) y `args(o)` con o = { mode: 'quality' | 'bitrate', quality, kbps, speed, tune, tenBit, pass, log }.
const ENCODERS = [
  {
    id: 'x264', name: 'H.264 (x264)', codec: 'h264', lib: 'libx264', containers: ['mp4', 'mkv'],
    quality: { min: 0, max: 51, def: 22, name: 'RF' }, speeds: X26X_SPEEDS, defSpeed: 5, twoPass: true,
    tunes: [['', 'Ninguno'], ['film', 'Película'], ['animation', 'Animación'], ['grain', 'Grano'], ['stillimage', 'Imagen fija'], ['fastdecode', 'Decodificación rápida']],
    args: (o) => [
      '-c:v', 'libx264', '-preset', X26X_SPEEDS[o.speed][0], ...(o.tune ? ['-tune', o.tune] : []),
      ...(o.mode === 'quality' ? ['-crf', String(o.quality)] : ['-b:v', `${o.kbps}k`]),
      ...(o.pass ? ['-pass', String(o.pass), '-passlogfile', o.log] : []),
      '-pix_fmt', 'yuv420p',
    ],
  },
  {
    id: 'x265', name: 'H.265 (x265)', codec: 'hevc', lib: 'libx265', containers: ['mp4', 'mkv'],
    quality: { min: 0, max: 51, def: 24, name: 'RF' }, speeds: X26X_SPEEDS, defSpeed: 5, twoPass: true, tenBit: true,
    tunes: [['', 'Ninguno'], ['animation', 'Animación'], ['grain', 'Grano'], ['fastdecode', 'Decodificación rápida']],
    args: (o) => [
      '-c:v', 'libx265', '-preset', X26X_SPEEDS[o.speed][0], ...(o.tune ? ['-tune', o.tune] : []),
      ...(o.mode === 'quality' ? ['-crf', String(o.quality)] : ['-b:v', `${o.kbps}k`]),
      '-x265-params', ['log-level=error', ...(o.pass ? [`pass=${o.pass}`, `stats=${o.log.replace(/\\/g, '/').replace(/:/g, '\\:')}.log`] : [])].join(':'),
      '-pix_fmt', pixFmt(o), '-tag:v', 'hvc1',
    ],
  },
  {
    id: 'vp9', name: 'VP9', codec: 'vp9', lib: 'libvpx-vp9', containers: ['webm', 'mkv', 'mp4'],
    quality: { min: 0, max: 63, def: 32, name: 'CRF' }, speeds: VPX_SPEEDS, defSpeed: 1, twoPass: true, tenBit: true,
    args: (o) => [
      '-c:v', 'libvpx-vp9', ...(o.mode === 'quality' ? ['-crf', String(o.quality), '-b:v', '0'] : ['-b:v', `${o.kbps}k`]),
      '-deadline', 'good', '-cpu-used', VPX_SPEEDS[o.speed][0], '-row-mt', '1', '-tile-columns', '2',
      ...(o.pass ? ['-pass', String(o.pass), '-passlogfile', o.log] : []),
      '-pix_fmt', pixFmt(o),
    ],
  },
  {
    id: 'av1', name: 'AV1 (libaom, lento)', codec: 'av1', lib: 'libaom-av1', containers: ['mp4', 'mkv', 'webm'],
    quality: { min: 0, max: 63, def: 32, name: 'CRF' }, speeds: AOM_SPEEDS, defSpeed: 2, twoPass: true, tenBit: true,
    args: (o) => [
      '-c:v', 'libaom-av1', ...(o.mode === 'quality' ? ['-crf', String(o.quality), '-b:v', '0'] : ['-b:v', `${o.kbps}k`]),
      '-cpu-used', AOM_SPEEDS[o.speed][0], '-row-mt', '1', '-tiles', '2x2',
      ...(o.pass ? ['-pass', String(o.pass), '-passlogfile', o.log] : []),
      '-pix_fmt', pixFmt(o),
    ],
  },
  ...['h264', 'hevc', 'av1'].map((codec) => ({
    id: `${codec}_nvenc`, name: `${{ h264: 'H.264', hevc: 'H.265', av1: 'AV1' }[codec]} (NVIDIA NVENC)`, codec, lib: `${codec}_nvenc`, hw: true,
    containers: codec === 'av1' ? ['mp4', 'mkv', 'webm'] : ['mp4', 'mkv'],
    quality: { min: 0, max: 51, def: codec === 'h264' ? 23 : 26, name: 'CQ' }, speeds: NVENC_SPEEDS, defSpeed: 4, tenBit: codec !== 'h264',
    args: (o) => [
      '-c:v', `${codec}_nvenc`, '-preset', NVENC_SPEEDS[o.speed][0], '-tune', 'hq', '-rc', 'vbr',
      ...(o.mode === 'quality' ? ['-cq', String(o.quality), '-b:v', '0'] : ['-b:v', `${o.kbps}k`, '-maxrate', `${Math.round(o.kbps * 1.5)}k`, '-bufsize', `${o.kbps * 2}k`, '-multipass', 'fullres']),
      '-pix_fmt', o.tenBit && codec !== 'h264' ? 'p010le' : 'yuv420p', ...(codec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
    ],
  })),
  ...['h264', 'hevc', 'av1'].map((codec) => ({
    id: `${codec}_qsv`, name: `${{ h264: 'H.264', hevc: 'H.265', av1: 'AV1' }[codec]} (Intel Quick Sync)`, codec, lib: `${codec}_qsv`, hw: true,
    containers: codec === 'av1' ? ['mp4', 'mkv', 'webm'] : ['mp4', 'mkv'],
    quality: { min: 1, max: 51, def: codec === 'h264' ? 23 : 26, name: 'ICQ' }, speeds: QSV_SPEEDS, defSpeed: 3, tenBit: codec !== 'h264',
    args: (o) => [
      '-c:v', `${codec}_qsv`, '-preset', QSV_SPEEDS[o.speed][0],
      ...(o.mode === 'quality' ? ['-global_quality', String(o.quality)] : ['-b:v', `${o.kbps}k`]),
      '-pix_fmt', o.tenBit && codec !== 'h264' ? 'p010le' : 'nv12', ...(codec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
    ],
  })),
  ...['h264', 'hevc', 'av1'].map((codec) => ({
    id: `${codec}_amf`, name: `${{ h264: 'H.264', hevc: 'H.265', av1: 'AV1' }[codec]} (AMD AMF)`, codec, lib: `${codec}_amf`, hw: true,
    containers: codec === 'av1' ? ['mp4', 'mkv', 'webm'] : ['mp4', 'mkv'],
    quality: { min: 0, max: 51, def: codec === 'h264' ? 23 : 26, name: 'QP' }, speeds: AMF_SPEEDS, defSpeed: 1,
    args: (o) => [
      '-c:v', `${codec}_amf`, '-quality', AMF_SPEEDS[o.speed][0],
      ...(o.mode === 'quality'
        ? ['-rc', 'cqp', '-qp_i', String(o.quality), '-qp_p', String(o.quality), ...(codec === 'av1' ? [] : ['-qp_b', String(o.quality)])]
        : ['-rc', 'vbr_peak', '-b:v', `${o.kbps}k`, '-maxrate', `${Math.round(o.kbps * 1.5)}k`]),
      '-pix_fmt', 'yuv420p', ...(codec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
    ],
  })),
];
const encoderById = (id) => ENCODERS.find((e) => e.id === id) || ENCODERS[0];

// Los de la tarjeta gráfica solo aparecen si funcionan en este equipo (prueba de unos fotogramas, una vez por sesión).
let hwCache = null;
async function availableEncoders() {
  if (!hwCache) {
    hwCache = {};
    await Promise.all(ENCODERS.filter((e) => e.hw).map(async (e) => {
      const r = await run(ffmpegPath, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x240:d=0.2', '-frames:v', '3', '-c:v', e.lib, '-f', 'null', '-']).catch(() => ({ code: 1 }));
      hwCache[e.id] = r.code === 0;
    }));
  }
  return ENCODERS.filter((e) => !e.hw || hwCache[e.id]).map(({ args, lib, ...rest }) => ({
    ...rest,
    speeds: rest.speeds.map(([, name]) => name),
    tunes: rest.tunes || null,
  }));
}

// ---- Análisis del archivo de origen ----

const TEXT_SUBS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);
const parseRate = (r) => {
  const [n, d] = String(r || '').split('/').map(Number);
  return d ? n / d : n || 0;
};

async function probe(file) {
  const r = await run(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', file]);
  if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').pop() || 'No se pudo leer el archivo');
  const j = JSON.parse(r.stdout.toString('utf8'));
  const v = (j.streams || []).find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!v) throw new Error('El archivo no tiene video');
  const rotation = Math.abs(Number(v.side_data_list?.find((s) => s.rotation != null)?.rotation ?? v.tags?.rotate ?? 0)) % 180 === 90;
  const [sn, sd] = String(v.sample_aspect_ratio || '1:1').split(':').map(Number);
  const sar = sn > 0 && sd > 0 ? sn / sd : 1;
  const lang = (s) => s.tags?.language && s.tags.language !== 'und' ? s.tags.language : '';
  const stat = await fs.promises.stat(file);
  return {
    path: file,
    size: stat.size,
    duration: Number(j.format?.duration) || Number(v.duration) || 0,
    bitrate: Number(j.format?.bit_rate) || 0,
    video: {
      codec: v.codec_name,
      // Medidas tal como se ven (FFmpeg gira solo los videos con rotación).
      width: rotation ? v.height : v.width,
      height: rotation ? v.width : v.height,
      sar,
      fps: parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate),
      interlaced: !!v.field_order && !['progressive', 'unknown'].includes(v.field_order),
      hdr: ['smpte2084', 'arib-std-b67'].includes(v.color_transfer),
      tenBit: /10|12/.test(v.pix_fmt || ''),
    },
    audio: (j.streams || []).filter((s) => s.codec_type === 'audio').map((s, i) => ({
      index: i, codec: s.codec_name, channels: s.channels || 2, lang: lang(s), title: s.tags?.title || '', bitrate: Number(s.bit_rate) || 0,
    })),
    subtitles: (j.streams || []).filter((s) => s.codec_type === 'subtitle').map((s, i) => ({
      index: i, codec: s.codec_name, lang: lang(s), title: s.tags?.title || '', text: TEXT_SUBS.has(s.codec_name),
    })),
    chapters: (j.chapters || []).length,
  };
}

// Recorte automático: cropdetect en 8 puntos del video; se queda con lo que no es negro en ninguno (los fotogramas
// completamente negros no cuentan) y no recorta si quitaría más de la mitad (seguramente es una escena oscura).
async function detectCrop(src) {
  const { width: W, height: H } = src.video;
  const d = src.duration;
  let box = null;
  for (let i = 1; i <= 8; i++) {
    const t = d > 2 ? (d * i) / 9 : 0;
    const r = await run(ffmpegPath, ['-hide_banner', '-ss', t.toFixed(2), '-i', src.path, '-frames:v', '4', '-vf', 'cropdetect=limit=24:round=2:reset=0', '-an', '-sn', '-f', 'null', '-']);
    const all = [...r.stderr.matchAll(/crop=(-?\d+):(-?\d+):(-?\d+):(-?\d+)/g)];
    const m = all.pop();
    if (!m) continue;
    const [w, h, x, y] = m.slice(1).map(Number);
    if (w <= 0 || h <= 0) continue;
    box = box
      ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x + w), y1: Math.max(box.y1, y + h) }
      : { x0: x, y0: y, x1: x + w, y1: y + h };
  }
  if (!box) return null;
  const crop = { top: box.y0, bottom: H - box.y1, left: box.x0, right: W - box.x1 };
  const cw = W - crop.left - crop.right;
  const ch = H - crop.top - crop.bottom;
  if (cw < W / 2 || ch < H / 2) return null;
  return crop.top + crop.bottom + crop.left + crop.right > 0 ? crop : null;
}

// ---- Argumentos de FFmpeg ----

const DENOISE = { light: 'hqdn3d=2:1.5:3:2.5', medium: 'hqdn3d=4:3:6:4.5', strong: 'hqdn3d=7:5:10:8' };
const SHARPEN = { light: 'unsharp=5:5:0.5:5:5:0', medium: 'unsharp=5:5:1.0:5:5:0' };
const ROTATE = { 90: 'transpose=1', 180: 'hflip,vflip', 270: 'transpose=2' };
const TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';
const AUDIO_OK = {
  mp4: new Set(['aac', 'mp3', 'ac3', 'eac3', 'alac', 'opus']),
  webm: new Set(['opus', 'vorbis']),
  mkv: null, // todos
};
const AUDIO_ENCODERS = { aac: 'aac', opus: 'libopus', mp3: 'libmp3lame', ac3: 'ac3' };
const MUXER = { mp4: 'mp4', mkv: 'matroska', webm: 'webm' };

// Medidas de salida: recorte, giro y resolución máxima (lado corto ≤ límite y lado largo ≤ límite·16/9, para que
// funcione igual con videos verticales), con píxeles cuadrados y medidas pares.
function outputSize(src, s, crop) {
  let w = src.video.width - (crop ? crop.left + crop.right : 0);
  let h = src.video.height - (crop ? crop.top + crop.bottom : 0);
  w *= src.video.sar;
  if (s.rotate === 90 || s.rotate === 270) [w, h] = [h, w];
  let f = 1;
  if (s.maxSize) f = Math.min(1, s.maxSize / Math.min(w, h), (s.maxSize * 16) / 9 / Math.max(w, h));
  const even = (n) => Math.max(2, 2 * Math.round(n / 2));
  return { width: even(w * f), height: even(h * f) };
}

function videoFilters(src, s, crop, enc) {
  const f = [];
  if (s.deinterlace === 'on') f.push('bwdif=mode=send_frame:deint=all');
  else if (s.deinterlace === 'auto' && src.video.interlaced) f.push('bwdif=mode=send_frame:deint=interlaced');
  if (crop) f.push(`crop=${src.video.width - crop.left - crop.right}:${src.video.height - crop.top - crop.bottom}:${crop.left}:${crop.top}`);
  const tonemap = src.video.hdr && (s.hdr === 'sdr' || !(s.tenBit && enc.tenBit));
  if (tonemap) f.push(TONEMAP);
  if (ROTATE[s.rotate]) f.push(ROTATE[s.rotate]);
  if (DENOISE[s.denoise]) f.push(DENOISE[s.denoise]);
  const out = outputSize(src, s, crop);
  const rotated = s.rotate === 90 || s.rotate === 270;
  const curW = (rotated ? src.video.height : src.video.width) - (crop ? (rotated ? crop.top + crop.bottom : crop.left + crop.right) : 0);
  const curH = (rotated ? src.video.width : src.video.height) - (crop ? (rotated ? crop.left + crop.right : crop.top + crop.bottom) : 0);
  if (out.width !== curW || out.height !== curH || src.video.sar !== 1) f.push(`scale=${out.width}:${out.height}:flags=lanczos`, 'setsar=1');
  if (SHARPEN[s.sharpen]) f.push(SHARPEN[s.sharpen]);
  if (s.fps && (!s.fpsPeak || src.video.fps > s.fps + 0.01)) f.push(`fps=${s.fps}`);
  return { filters: f, tonemap, out };
}

function audioArgs(src, s) {
  const tracks = s.audio.tracks === 'none' ? [] : s.audio.tracks === 'first' ? src.audio.slice(0, 1) : src.audio;
  const args = [];
  let kbpsTotal = 0;
  const ok = AUDIO_OK[s.container];
  const fallback = s.container === 'webm' ? 'opus' : 'aac';
  tracks.forEach((t, i) => {
    args.push('-map', `0:a:${t.index}`);
    let codec = s.audio.codec;
    if (codec === 'copy' && ok && !ok.has(t.codec)) codec = fallback;
    if (codec !== 'copy' && ok && !ok.has(codec === 'mp3' ? 'mp3' : codec)) codec = fallback;
    if (codec === 'copy') {
      args.push(`-c:a:${i}`, 'copy');
      kbpsTotal += (t.bitrate || 192000) / 1000;
      return;
    }
    let ch = { stereo: 2, mono: 1, '51': Math.min(6, t.channels), keep: t.channels }[s.audio.mix] || 2;
    if (codec === 'mp3') ch = Math.min(ch, 2);
    const kbps = Math.round(s.audio.kbps * (ch > 2 ? 2 : ch === 1 ? 0.5 : 1));
    args.push(`-c:a:${i}`, AUDIO_ENCODERS[codec], `-b:a:${i}`, `${kbps}k`, `-ac:a:${i}`, String(ch));
    kbpsTotal += kbps;
  });
  return { args, kbpsTotal };
}

function subtitleArgs(src, s) {
  const tracks = s.subtitles === 'none' ? [] : s.subtitles === 'first' ? src.subtitles.slice(0, 1) : src.subtitles;
  const args = [];
  let n = 0;
  for (const t of tracks) {
    // MP4 y WebM solo admiten subtítulos de texto (los de imagen, como los de los Blu-ray, se quedan fuera).
    if (s.container !== 'mkv' && !t.text) continue;
    args.push('-map', `0:s:${t.index}`, `-c:s:${n}`, s.container === 'mkv' ? 'copy' : s.container === 'webm' ? 'webvtt' : 'mov_text');
    n++;
  }
  return args;
}

// Tasa de bits del video para un tamaño de archivo (con un 5 % de margen para el contenedor y el control de la tasa,
// que en dos pasadas se pasa un poco en videos cortos).
function sizeKbps(src, s, audioKbps, seconds) {
  const totalKbps = (s.sizeMB * 8 * 1024 * 1024 * 0.95) / 1000 / seconds;
  return Math.floor(totalKbps - audioKbps);
}

// Lista de pasadas (cada una, argumentos de FFmpeg) para `src` con los ajustes `s`. range = { start, length } para
// la muestra.
function buildPasses(src, s, crop, outPath, log, range) {
  const enc = encoderById(s.encoder);
  const { filters, tonemap } = videoFilters(src, s, crop, enc);
  const audio = audioArgs(src, s);
  const seconds = range ? range.length : src.duration;
  let mode = s.mode === 'quality' ? 'quality' : 'bitrate';
  let kbps = s.kbps;
  if (s.mode === 'size') {
    kbps = sizeKbps(src, s, audio.kbpsTotal, src.duration);
    if (kbps < 50) throw new Error(`${s.sizeMB} MB es demasiado poco para ${Math.round(src.duration)} s de video (bajaría a ${Math.max(0, kbps)} kbps)`);
  }
  const twoPass = mode === 'bitrate' && enc.twoPass && (s.mode === 'size' || s.twoPass);
  const input = [...(range ? ['-ss', range.start.toFixed(3), '-t', range.length.toFixed(3)] : []), '-i', src.path];
  const vf = filters.length ? ['-vf', filters.join(',')] : [];
  const color = tonemap ? ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'] : [];
  const o = { mode, quality: s.quality, kbps, speed: Math.min(s.speed, enc.speeds.length - 1), tune: s.tune, tenBit: s.tenBit && enc.tenBit, log };
  const common = ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', ...input, '-map', '0:v:0', ...vf, ...color];
  const passes = [];
  if (twoPass) {
    // x265 deja incompleto su archivo de estadísticas (CU-tree) si la primera pasada va a la salida nula: escribe
    // un .hevc temporal (se borra con los registros de las pasadas).
    const sink = enc.id === 'x265' ? ['-f', 'hevc', `${log}-pasada1.hevc`] : ['-f', 'null', os.platform() === 'win32' ? 'NUL' : '/dev/null'];
    passes.push([...common, ...enc.args({ ...o, pass: 1 }), '-an', '-sn', '-dn', ...sink]);
  }
  passes.push([
    ...common,
    ...enc.args({ ...o, pass: twoPass ? 2 : 0 }),
    ...audio.args,
    ...(range ? [] : subtitleArgs(src, s)),
    '-map_metadata', s.metadata ? '0' : '-1',
    '-map_chapters', s.chapters && !range ? '0' : '-1',
    ...(s.container === 'mp4' && s.webOptimized ? ['-movflags', '+faststart'] : []),
    '-max_muxing_queue_size', '4096',
    '-f', MUXER[s.container], outPath,
  ]);
  return { passes, kbps: mode === 'bitrate' ? kbps : null, audioKbps: audio.kbpsTotal };
}

// ---- Ejecución ----

let current = null; // { proc, canceled }

async function encode(src, s, crop, outPath, range, onProgress) {
  const log = path.join(os.tmpdir(), `cortex-2pasadas-${process.pid}-${Date.now()}`);
  const { passes } = buildPasses(src, s, crop, outPath, log, range);
  const seconds = range ? range.length : src.duration;
  const job = { proc: null, canceled: false };
  current = job;
  try {
    for (let p = 0; p < passes.length; p++) {
      let speed = null;
      const r = await run(ffmpegPath, passes[p], {
        onSpawn: (proc) => { job.proc = proc; },
        onLine: (line) => {
          const sp = /^speed=\s*([\d.]+)x/.exec(line);
          if (sp) speed = Number(sp[1]);
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
          if (!m || !seconds) return;
          const done = Math.min(1, Number(m[1]) / 1e6 / seconds);
          onProgress?.({ percent: ((p + done) / passes.length) * 100, pass: p + 1, passes: passes.length, speed, eta: speed ? ((1 - done) * seconds) / speed + (passes.length - p - 1) * seconds / speed : null });
        },
      });
      if (job.canceled) return { canceled: true };
      if (r.code !== 0) {
        const lines = r.stderr.trim().split('\n').filter((l) => !/^\s*$/.test(l));
        throw new Error(lines.slice(-2).join(' · ') || `FFmpeg terminó con el código ${r.code}`);
      }
    }
    return { canceled: false };
  } finally {
    current = null;
    for (const f of await fs.promises.readdir(os.tmpdir()).catch(() => [])) {
      if (f.startsWith(path.basename(log))) fs.promises.unlink(path.join(os.tmpdir(), f)).catch(() => {});
    }
  }
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const base = p.slice(0, -ext.length);
  for (let i = 2; ; i++) {
    const c = `${base} (${i})${ext}`;
    if (!fs.existsSync(c)) return c;
  }
}

// Nombre de salida: en la carpeta elegida, o junto al original con « (comprimido)».
function outputPathFor(file, s) {
  const name = path.basename(file, path.extname(file));
  const dir = s.dir || path.dirname(file);
  const plain = path.join(dir, `${name}.${s.container}`);
  const same = path.resolve(plain).toLowerCase() === path.resolve(file).toLowerCase();
  return uniquePath(s.dir && !same ? plain : path.join(dir, `${name} (comprimido).${s.container}`));
}

// Análisis y recorte detectado por archivo (cambian solo si cambia el archivo).
const cache = new Map();
async function prepare(file, s) {
  const st = await fs.promises.stat(file);
  const key = `${path.resolve(file)}|${st.size}|${st.mtimeMs}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = { src: await probe(file) };
    cache.set(key, entry);
  }
  if (s.crop === 'auto' && !('crop' in entry)) entry.crop = await detectCrop(entry.src);
  return { src: entry.src, crop: s.crop === 'auto' ? entry.crop : null };
}

// Comprime un archivo. Devuelve { outPath, size, inSize } o { canceled: true }.
async function compress(file, s, onProgress) {
  if (current) throw new Error('Ya hay una compresión en marcha');
  onProgress?.({ percent: 0, stage: 'analyzing' });
  const { src, crop } = await prepare(file, s);
  const enc = encoderById(s.encoder);
  if (!enc.containers.includes(s.container)) throw new Error(`${enc.name} no se puede guardar en ${s.container.toUpperCase()}`);
  const outPath = outputPathFor(file, s);
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  const part = `${outPath}.parcial`;
  try {
    const r = await encode(src, s, crop, part, null, onProgress);
    if (r.canceled) {
      await fs.promises.unlink(part).catch(() => {});
      return { canceled: true };
    }
    await fs.promises.rename(part, outPath);
    const { size } = await fs.promises.stat(outPath);
    return { outPath, size, inSize: src.size };
  } catch (err) {
    await fs.promises.unlink(part).catch(() => {});
    throw err;
  }
}

// Muestra de 10 s desde el 40 % del video con los mismos ajustes: tamaño estimado del archivo completo y la muestra
// para verla en el reproductor del sistema.
async function sample(file, s, onProgress) {
  if (current) throw new Error('Ya hay una compresión en marcha');
  const { src, crop } = await prepare(file, s);
  const length = Math.min(10, src.duration);
  const start = Math.max(0, Math.min(src.duration * 0.4, src.duration - length));
  const out = path.join(os.tmpdir(), `cortex-muestra-${Date.now()}.${s.container}`);
  const t0 = Date.now();
  const r = await encode(src, s, crop, out, { start, length }, onProgress);
  if (r.canceled) {
    await fs.promises.unlink(out).catch(() => {});
    return { canceled: true };
  }
  const { size } = await fs.promises.stat(out);
  const enc = encoderById(s.encoder);
  const { out: dims } = videoFilters(src, s, crop, enc);
  return {
    path: out,
    size,
    estimate: Math.round((size * src.duration) / length),
    inSize: src.size,
    seconds: ((Date.now() - t0) / 1000) * (src.duration / length), // tiempo estimado de la compresión
    width: dims.width,
    height: dims.height,
    crop,
  };
}

function cancel() {
  if (!current?.proc) return;
  current.canceled = true;
  current.proc.kill();
}

// Datos del archivo para el diálogo (pistas, medidas, recorte detectado y medidas de salida con unos ajustes).
async function inspect(file, s) {
  const { src, crop } = await prepare(file, s);
  const enc = encoderById(s.encoder);
  const { out, tonemap } = videoFilters(src, s, crop, enc);
  let kbps = null;
  if (s.mode === 'size') kbps = sizeKbps(src, s, audioArgs(src, s).kbpsTotal, src.duration);
  return { ...src, crop, out, tonemap, sizeKbps: kbps };
}

module.exports = { availableEncoders, inspect, compress, sample, cancel, buildPasses, probe, detectCrop };
