// Utilidades de FFmpeg/FFprobe: análisis de medios, miniaturas, formas de onda y renderizado.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// En la app empaquetada los binarios viven fuera del archivo asar.
const unpacked = (p) => p.replace('app.asar', 'app.asar.unpacked');
const ffmpegPath = unpacked(require('ffmpeg-static'));
const ffprobePath = unpacked(require('@ffprobe-installer/ffprobe').path);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.tif', '.tiff']);
const PEAKS_PER_SECOND = 50;
const PEAK_SAMPLE_RATE = 4000;

function run(bin, args, { onLine, onSpawn, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true, cwd });
    const chunks = [];
    let stderr = '';
    let pending = '';
    proc.stdout.on('data', (data) => {
      if (!onLine) {
        chunks.push(data);
        return;
      }
      pending += data.toString();
      let i;
      while ((i = pending.indexOf('\n')) >= 0) {
        onLine(pending.slice(0, i).trim());
        pending = pending.slice(i + 1);
      }
    });
    proc.stderr.on('data', (data) => {
      stderr = (stderr + data.toString()).slice(-20000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stdout: Buffer.concat(chunks), stderr }));
    if (onSpawn) onSpawn(proc);
  });
}

function parseRate(rate) {
  if (!rate) return null;
  const [num, den] = rate.split('/').map(Number);
  return den ? num / den : num || null;
}

async function probe(file) {
  const { code, stdout, stderr } = await run(ffprobePath, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ]);
  if (code !== 0) throw new Error(stderr.trim() || 'No se pudo leer el archivo');
  const info = JSON.parse(stdout.toString());
  const streams = info.streams || [];
  const video = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const audio = streams.find((s) => s.codec_type === 'audio');
  const isImage = IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase());
  if (!video && !audio) throw new Error('El archivo no contiene video ni audio');
  const duration = parseFloat(info.format && info.format.duration) || parseFloat(video && video.duration) || 0;
  // Videos de móvil grabados en vertical: ancho y alto vienen antes de girar; FFmpeg y el navegador
  // los muestran ya girados, así que se intercambian para trabajar siempre con las medidas reales.
  const rotation = video
    ? Number((video.side_data_list || []).find((d) => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0)
    : 0;
  const turned = Math.abs(rotation) % 180 === 90;
  return {
    path: file,
    name: path.basename(file),
    isImage,
    hasVideo: !!video,
    hasAudio: !!audio && !isImage,
    duration: isImage ? null : duration,
    width: video ? (turned ? video.height : video.width) : null,
    height: video ? (turned ? video.width : video.height) : null,
    fps: video ? parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) : null,
    // Imágenes con transparencia (PNG con alfa…): sus efectos deben conservarla en el render.
    hasAlpha: !!video && /^(rgba|bgra|argb|abgr|ya|yuva|gbrap|pal8)/.test(video.pix_fmt || ''),
    // La vista previa (Chromium) no lo puede reproducir: hace falta un proxy (ver makeProxy).
    needsProxy: !isImage && needsProxy(info.format?.format_name || '', video?.codec_name, audio?.codec_name),
  };
}

// Formatos que reproduce el navegador de la vista previa. Lo demás (ProRes, DNxHD, MPEG-2, AVI, MPEG-TS, WMV,
// AC-3, PCM fuera de WAV…) necesita un proxy. HEVC depende del equipo: si no se ve, la vista previa lo detecta
// (error del reproductor) y pide el proxy entonces.
const BROWSER_VIDEO = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1', 'theora']);
const BROWSER_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
const BROWSER_CONTAINERS = ['mov', 'mp4', 'matroska', 'webm', 'ogg', 'wav', 'mp3', 'flac', 'aac'];
function needsProxy(format, videoCodec, audioCodec) {
  if (!BROWSER_CONTAINERS.some((c) => format.split(',').includes(c))) return true;
  if (videoCodec && !BROWSER_VIDEO.has(videoCodec)) return true;
  if (audioCodec && !BROWSER_AUDIO.has(audioCodec) && !(format === 'wav' && audioCodec.startsWith('pcm_'))) return true;
  return false;
}

// Tira de miniaturas para dibujar a lo largo de los eventos de video: una imagen JPEG con `count` miniaturas de
// tw×th en `cols` columnas; la i es el fotograma del instante i·step del medio. Hasta 200 (cada 0,5 s como poco).
// En los videos largos solo se decodifican los fotogramas clave (mucho más rápido; la miniatura puede ser de
// un fotograma algo anterior). Devuelve los datos de la tira (sin la ruta).
const STRIP_H = 72;
async function filmstrip(file, out) {
  const info = await probe(file);
  if (!info.hasVideo || info.isImage || !info.duration) throw new Error('No es un video');
  const step = Math.max(0.5, info.duration / 200);
  const count = Math.max(1, Math.ceil(info.duration / step));
  const th = STRIP_H;
  const tw = Math.max(2, Math.round((th * info.width) / info.height / 2) * 2);
  const cols = Math.min(count, 10);
  const rows = Math.ceil(count / cols);
  const fast = info.duration > 120 ? ['-skip_frame', 'nokey'] : [];
  const r = await run(ffmpegPath, [
    '-y', '-v', 'error', ...fast, '-i', file, '-an', '-sn',
    '-vf', `fps=1/${step},scale=${tw}:${th},setsar=1,tile=${cols}x${rows}`, '-frames:v', '1', '-q:v', '5', out,
  ]);
  if (r.code !== 0 || !fs.existsSync(out)) throw new Error(r.stderr.trim().split('\n').pop() || 'No se pudo hacer la tira');
  return { step, count, tw, th, cols };
}

// Cambios de plano en el tramo [start, start + length) del medio: instantes (s desde `start`) del primer fotograma
// de cada plano nuevo, según la puntuación «scene» de FFmpeg (0 = igual, 1 = todo distinto) sobre una copia
// pequeña de la imagen. threshold: a partir de qué diferencia hay corte (0,3 suele ir bien).
async function detectScenes(file, start, length, threshold = 0.3, { onProgress, onSpawn } = {}) {
  // La lista sale por el filtro metadata a un archivo temporal (nombre relativo, con la carpeta temporal como
  // carpeta de trabajo: así no hay que escapar los «:» de la ruta de Windows dentro del filtro).
  const name = `cortex-escenas-${Date.now()}.txt`;
  const listPath = path.join(os.tmpdir(), name);
  try {
    const r = await run(ffmpegPath, [
      '-v', 'error', '-nostats', '-progress', 'pipe:1', '-ss', start.toFixed(6), '-t', length.toFixed(6), '-i', file, '-an', '-sn',
      '-vf', `scale=192:-2,select='gt(scene,${threshold})',metadata=mode=print:file=${name}`, '-f', 'null', '-',
    ], {
      cwd: os.tmpdir(),
      onSpawn,
      onLine: (line) => {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && onProgress) onProgress(Math.min(1, Number(m[1]) / 1e6 / length));
      },
    });
    if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').pop() || 'No se pudieron detectar las escenas');
    let text = '';
    try {
      text = await fs.promises.readFile(listPath, 'utf8');
    } catch {
      return []; // ningún corte
    }
    return [...text.matchAll(/pts_time:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  } finally {
    fs.promises.unlink(listPath).catch(() => {});
  }
}

// Un fotograma del medio en `time` (s, búsqueda exacta) como PNG del tamaño original (ya girado si el video es
// vertical), para congelar fotograma.
async function extractFrame(file, time, out) {
  const r = await run(ffmpegPath, ['-y', '-v', 'error', '-ss', time.toFixed(6), '-i', file, '-frames:v', '1', '-update', '1', out]);
  if (r.code !== 0 || !fs.existsSync(out)) throw new Error(r.stderr.trim().split('\n').pop() || 'No se pudo extraer el fotograma');
}

// Proxy para la vista previa: copia ligera en H.264 (como mucho 720 líneas, un fotograma clave cada 15 para
// buscar rápido) y AAC, con los mismos tiempos que el original (empieza donde él y conserva los fotogramas).
// El render usa siempre el original.
async function makeProxy(file, out, { onProgress, onSpawn } = {}) {
  const info = await probe(file);
  const video = info.hasVideo
    ? ['-map', '0:v:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-g', '15',
      '-vf', "scale=-2:'trunc(min(720,ih)/2)*2'", '-fps_mode', 'passthrough']
    : [];
  const audio = info.hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '160k', '-ac', '2'] : [];
  const args = ['-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-i', file, ...video, ...audio, '-movflags', '+faststart', out];
  return run(ffmpegPath, args, {
    onSpawn,
    onLine: (line) => {
      const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
      if (m && onProgress && info.duration) onProgress(Math.min(1, Number(m[1]) / 1e6 / info.duration));
    },
  });
}

async function thumbnail(file, info) {
  const seek = info.isImage ? [] : ['-ss', String(Math.min(1, (info.duration || 0) * 0.1))];
  const { code, stdout } = await run(ffmpegPath, [
    '-v', 'error', ...seek, '-i', file, '-frames:v', '1', '-vf', 'scale=192:-2',
    '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1',
  ]);
  if (code !== 0 || !stdout.length) return null;
  return `data:image/jpeg;base64,${stdout.toString('base64')}`;
}

// Devuelve picos de amplitud (0-255) a PEAKS_PER_SECOND por segundo para dibujar la forma de onda.
async function peaks(file) {
  const { code, stdout } = await run(ffmpegPath, [
    '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(PEAK_SAMPLE_RATE),
    '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1',
  ]);
  if (code !== 0) return null;
  const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
  const window = PEAK_SAMPLE_RATE / PEAKS_PER_SECOND;
  const out = new Uint8Array(Math.ceil(samples.length / window));
  for (let i = 0; i < out.length; i++) {
    let max = 0;
    const end = Math.min(samples.length, (i + 1) * window);
    for (let j = i * window; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > max) max = v;
    }
    out[i] = Math.min(255, Math.round((max / 32768) * 255));
  }
  return Array.from(out);
}

async function analyze(file) {
  const info = await probe(file);
  const [thumb, peakData] = await Promise.all([
    info.hasVideo ? thumbnail(file, info) : null,
    info.hasAudio ? peaks(file) : null,
  ]);
  return { ...info, thumb, peaks: peakData, peaksPerSecond: PEAKS_PER_SECOND };
}

const num = (x) => Number(x).toFixed(3);

// 29,97 → 30000/1001, etc. (FFmpeg necesita la fracción exacta para las velocidades NTSC).
function frameRate(fps) {
  const n = Math.round(fps);
  if (Math.abs(fps - n) > 0.001 && Math.abs(fps - (n * 1000) / 1001) < 0.01) return `${n * 1000}/1001`;
  return String(fps);
}

// Fundidos del evento en su tiempo local (empieza en 0). En video se funde la transparencia,
// así que el evento aparece sobre lo que haya debajo (otra pista o negro).
// Con curva (no lineal), fade no sirve: geq multiplica el alfa por la curva, solo en los fotogramas del fundido.
// Mismas fórmulas que fadeCurve en src/state/project.js (P = progreso del fundido, de 0 a 1).
const CURVE_EXPR = {
  fast: '(1-(1-@P@)*(1-@P@))',
  slow: '(@P@*@P@)',
  smooth: '((1-cos(PI*@P@))/2)',
  sharp: '(acos(1-2*@P@)/PI)',
};
function curveFade(curve, start, d, out) {
  const P = `min(1,max(0,(T-${num(start)})/${num(d)}))`;
  const f = CURVE_EXPR[curve].replaceAll('@P@', P);
  const factor = out ? `(1-${f})` : f;
  return `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*${factor}':enable='between(t,${num(start - 0.001)},${num(start + d + 0.001)})'`;
}
function videoFades(e) {
  const out = [];
  if (e.fadeIn > 0 && !e.transIn) {
    out.push(CURVE_EXPR[e.curveIn] ? curveFade(e.curveIn, 0, e.fadeIn, false) : `fade=t=in:st=0:d=${num(e.fadeIn)}:alpha=1`);
  }
  if (e.fadeOut > 0 && !e.transOut) {
    const st = e.duration - e.fadeOut;
    out.push(CURVE_EXPR[e.curveOut] ? curveFade(e.curveOut, st, e.fadeOut, true) : `fade=t=out:st=${num(st)}:d=${num(e.fadeOut)}:alpha=1`);
  }
  return out.length ? `,format=yuva420p,${out.join(',')}` : '';
}

// Cambio de velocidad del audio sin cambiar el tono (como el navegador en la vista previa). Cada atempo
// admite de 0,5 a 100, así que las velocidades más lentas se encadenan.
function atempo(rate) {
  if (Math.abs(rate - 1) < 1e-6) return '';
  const parts = [];
  let r = rate;
  while (r < 0.5) {
    parts.push('atempo=0.5');
    r /= 0.5;
  }
  parts.push(`atempo=${r.toFixed(6)}`);
  return `,${parts.join(',')}`;
}

// Curvas de afade equivalentes a fadeCurve (src/state/project.js). En la salida afade usa curva(1 − progreso),
// y nuestra salida es 1 − curva(progreso): por eso rápido y lento se intercambian.
const AFADE_IN = { linear: 'tri', fast: 'ipar', slow: 'qua', smooth: 'hsin', sharp: 'ihsin' };
const AFADE_OUT = { linear: 'tri', fast: 'qua', slow: 'ipar', smooth: 'hsin', sharp: 'ihsin' };
// Rampas de velocidad (ver src/state/speed.js). speedMap = tramos [{ t1, s0, a, m, base }] (t1 null = sin fin):
// entre tramos la velocidad es a + m·(t − base) y los segundos de medio usados, s0 + a·(t − base) + m·(t − base)²/2.
const segOf = (map, t) => map.find((k) => k.t1 === null || t < k.t1) || map[map.length - 1];
const segValue = (k, t) => k.s0 + k.a * (t - k.base) + (k.m * (t - k.base) ** 2) / 2;
// Segundos de medio usados desde el principio del evento hasta su tiempo local t.
function srcOffset(e, t) {
  if (!e.speedMap) return t * (e.rate || 1);
  return segValue(segOf(e.speedMap, t), t);
}
function speedAtLocal(e, t) {
  if (!e.speedMap) return e.rate || 1;
  const k = segOf(e.speedMap, t);
  return k.a + k.m * (t - k.base);
}
function localForSrc(e, s) {
  if (!e.speedMap) return s / (e.rate || 1);
  const k = e.speedMap.find((x) => x.t1 === null || s < segValue(x, x.t1)) || e.speedMap[e.speedMap.length - 1];
  const d = s - k.s0;
  return k.base + (2 * d) / (k.a + Math.sqrt(Math.max(0, k.a * k.a + 2 * k.m * d)));
}
// Expresión de FFmpeg del tiempo local para S (segundos de medio desde el principio del evento): la inversa
// de srcOffset, tramo a tramo.
function localExpr(map, S) {
  const inv = (k) => {
    const d = `(${S}-(${k.s0.toFixed(9)}))`;
    if (Math.abs(k.m) < 1e-12) return `(${k.base.toFixed(9)}+${d}/${k.a.toFixed(9)})`;
    return `(${k.base.toFixed(9)}+2*${d}/(${k.a.toFixed(9)}+sqrt(max(0,${(k.a * k.a).toFixed(9)}+${(2 * k.m).toFixed(9)}*${d}))))`;
  };
  let expr = inv(map[map.length - 1]);
  for (let i = map.length - 2; i >= 0; i--) expr = `if(lt(${S},${segValue(map[i], map[i].t1).toFixed(9)}),${inv(map[i])},${expr})`;
  return expr;
}
// Audio con rampa: rubberband cambia de velocidad cada 20 ms de medio (comandos de asendcmd), conservando el
// tono como el navegador. No sirve atempo: pierde unos milisegundos de sonido en cada cambio y la rampa se
// adelanta. Se le da algo más de medio al final (rubberband se come el último trozo) y luego se corta a la
// duración exacta. Comprobado: los cambios de sonido caen a menos de 20 ms de su sitio.
const RAMP_TAIL = 0.5;
function audioRamp(e, i) {
  const total = srcOffset(e, e.duration);
  const steps = [];
  for (let s = 0; s < total + RAMP_TAIL; s += 0.02) steps.push([s, speedAtLocal(e, localForSrc(e, s))]);
  const name = `rubberband@r${i}`;
  const cmds = steps.map(([s, v]) => `${s.toFixed(3)} ${name} tempo ${v.toFixed(6)}`).join(';');
  return `,asendcmd=c='${cmds}',${name}=tempo=${steps[0][1].toFixed(6)}`;
}

// Comandos de los efectos animados (fx.cmds: [[t local del evento, 'filtro@nombre opción valor,…']], ver
// effectsGraph) para un trozo que empieza en el tiempo local local0 y dura length s: al principio, los últimos
// valores de antes del trozo; después, los cambios con el tiempo del trozo.
function fxCommands(fx, local0, length) {
  if (!fx.cmds) return '';
  const state = new Map();
  const later = [];
  for (const [t, c] of fx.cmds) {
    if (t <= local0 + 1e-6) {
      for (const cmd of c.split(',')) state.set(cmd.split(' ').slice(0, 2).join(' '), cmd);
    } else if (t < local0 + length + 1e-6) {
      later.push([t - local0, c]);
    }
  }
  const intervals = [...(state.size ? [[0, [...state.values()].join(',')]] : []), ...later];
  return intervals.length ? `,sendcmd=c='${intervals.map(([t, c]) => `${t.toFixed(4)} ${c}`).join(';')}'` : '';
}

function audioFades(e) {
  let out = '';
  if (e.fadeIn > 0) out += `,afade=t=in:st=0:d=${num(e.fadeIn)}:curve=${AFADE_IN[e.curveIn] || 'tri'}`;
  if (e.fadeOut > 0) out += `,afade=t=out:st=${num(e.duration - e.fadeOut)}:d=${num(e.fadeOut)}:curve=${AFADE_OUT[e.curveOut] || 'tri'}`;
  return out;
}

// Formatos de salida (los mismos ids que src/state/render-formats.js, que tiene sus nombres y opciones).
// quality = { mode: 'crf', level: 'high' | 'normal' | 'light' } o { mode: 'bitrate', mbps }; audioKbps.
const CRF = {
  h264: { high: 18, normal: 22, light: 28 },
  h265: { high: 20, normal: 24, light: 30 },
  vp9: { high: 24, normal: 32, light: 40 },
};
function videoArgs(codec, quality = { mode: 'crf', level: 'normal' }) {
  const crf = CRF[codec][quality.level] ?? CRF[codec].normal;
  const kbps = Math.round((quality.mbps || 8) * 1000);
  const rate = quality.mode === 'bitrate'
    ? ['-b:v', `${kbps}k`, ...(codec === 'vp9' ? [] : ['-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${kbps * 2}k`])]
    : codec === 'vp9' ? ['-crf', String(crf), '-b:v', '0'] : ['-crf', String(crf)];
  if (codec === 'h264') return ['-c:v', 'libx264', '-preset', 'medium', ...rate, '-pix_fmt', 'yuv420p'];
  if (codec === 'h265') return ['-c:v', 'libx265', '-preset', 'medium', '-x265-params', 'log-level=error', '-tag:v', 'hvc1', ...rate, '-pix_fmt', 'yuv420p'];
  return ['-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', ...rate, '-pix_fmt', 'yuv420p'];
}
const OUTPUT_FORMATS = {
  'mp4-h264': { video: (q) => videoArgs('h264', q), audio: (k) => ['-c:a', 'aac', '-b:a', `${k}k`], extra: ['-movflags', '+faststart'] },
  'mp4-h265': { video: (q) => videoArgs('h265', q), audio: (k) => ['-c:a', 'aac', '-b:a', `${k}k`], extra: ['-movflags', '+faststart'] },
  webm: { video: (q) => videoArgs('vp9', q), audio: (k) => ['-c:a', 'libopus', '-b:a', `${k}k`], extra: [] },
  'mov-prores': {
    video: () => ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0'],
    audio: () => ['-c:a', 'pcm_s16le'],
    extra: [],
  },
  gif: { gif: true, extra: ['-loop', '0'] },
  png: { still: true, extra: ['-frames:v', '1', '-update', '1', '-c:v', 'png'] }, // un fotograma (exportar imagen)
  mp3: { audioOnly: true, audio: (k) => ['-c:a', 'libmp3lame', '-b:a', `${k}k`], extra: [] },
  wav: { audioOnly: true, audio: () => ['-c:a', 'pcm_s16le'], extra: [] },
};

// Construye los argumentos de FFmpeg y el grafo de filtros para renderizar la línea de tiempo.
// settings: { width, height (tamaño al que se monta el proyecto), outWidth, outHeight (tamaño del archivo:
// si la proporción es otra, el proyecto se encaja con bandas negras), fps, format, quality, audioKbps }.
function buildRender(project, settings, outPath) {
  const { width: W, height: H } = settings;
  const format = OUTPUT_FORMATS[settings.format] || OUTPUT_FORMATS['mp4-h264'];
  const outW = settings.outWidth || W;
  const outH = settings.outHeight || H;
  const fps = frameRate(settings.fps);
  const media = new Map(project.media.map((m) => [m.id, m]));
  const tracks = new Map(project.tracks.map((t, i) => [t.id, { ...t, index: i }]));
  const usable = project.events.filter((e) => {
    const t = tracks.get(e.trackId);
    const m = media.get(e.mediaId);
    return t && !t.muted && m && !m.missing && e.duration > 0;
  });
  // Todo el video se coloca sobre la rejilla de fotogramas del proyecto: un fragmento que va de
  // start a start+dur ocupa los fotogramas cuyo instante cae en ese intervalo. Así, al dividir un
  // evento o pegar dos seguidos, cada fotograma de salida pertenece a uno solo y no quedan huecos negros.
  const [rateNum, rateDen = 1] = fps.split('/').map(Number);
  const rate = rateNum / rateDen;

  // Tramo que se renderiza: todo el proyecto o la selección de tiempo (project.range). Con selección,
  // todo se monta en los tiempos de la línea de tiempo y al final se quita lo de antes de rangeStart,
  // así que el resultado es exactamente ese trozo del render completo.
  const range = project.range;
  const end = range ? range.end : Math.max(0.1, ...project.events.map((e) => e.start + e.duration));
  const firstFrame = range ? Math.ceil(range.start * rate - 1e-6) : 0;
  const rangeStart = firstFrame / rate;
  const duration = range ? Math.max(1, Math.ceil(end * rate - 1e-6) - firstFrame) / rate : end;

  const inputs = [];
  const filters = format.audioOnly
    ? []
    : [`color=c=black:s=${W}x${H}:r=${fps}:d=${num(duration)}${firstFrame ? `,setpts=PTS+${firstFrame}` : ''}[base]`];
  let last = 'base';
  let n = 0; // entradas (-i)
  let tag = 0; // etiquetas propias de los fundidos con transición, la opacidad y los modos de fusión

  const frameSpan = (start, dur) => {
    const first = Math.ceil(start * rate - 1e-6);
    const end = Math.ceil((start + dur) * rate - 1e-6);
    return { first, count: Math.max(1, end - first) };
  };

  // Añade un fragmento de un medio como entrada y devuelve su cadena de filtros: escalado con bandas
  // negras, a la velocidad del proyecto y con exactamente `count` fotogramas (si fps se come el último,
  // tpad lo repite). Empieza en el tiempo local 0, que corresponde al fotograma `first` del proyecto.
  // Con efectos (fx, calculado en la interfaz por renderPayload), la imagen se escala a su tamaño
  // encajado, pasa por el subgrafo de efectos y después se le ponen las bandas negras.
  // speed: velocidad del evento (inPoint es tiempo del medio; start y dur, de la línea de tiempo).
  // pan: panorámica/recorte del evento ({ keyframes, crop, w, h }, ver src/state/pan.js) y origin, el
  // principio del evento (los fotogramas clave cuentan desde ahí).
  // ev: el evento (inPoint, start, rate, speedMap, fx, pan); start y dur: el trozo de la línea de tiempo.
  const addVideoInput = (m, ev, start, dur) => {
    const { fx = null, pan = null } = ev;
    const origin = ev.start;
    const speed = ev.rate || 1;
    const { first, count } = frameSpan(start, dur);
    const length = (count + 1) / rate;
    let pts = 'setpts=PTS-STARTPTS';
    if (m.isImage) {
      inputs.push('-loop', '1', '-framerate', fps, '-t', num(length), '-i', m.path);
    } else {
      const local0 = first / rate - origin; // tiempo local del evento en el primer fotograma del trozo
      const s0 = srcOffset(ev, local0);
      const seek = Math.max(0, ev.inPoint + s0);
      inputs.push(...(m.sequence ? ['-f', 'concat', '-safe', '0'] : []), '-ss', num(seek), '-t', num(srcOffset(ev, local0 + length) - s0), '-i', m.path);
      if (ev.speedMap) {
        // Rampa: cada fotograma del medio va al instante local en que se llega a él (inversa exacta).
        const S = `(${(seek - ev.inPoint).toFixed(9)}+(PTS-STARTPTS)*TB)`;
        pts = `setpts='(${localExpr(ev.speedMap, S)}-(${local0.toFixed(9)}))/TB'`;
      } else if (speed !== 1) {
        pts = `setpts=(PTS-STARTPTS)/${speed.toFixed(6)}`;
      }
    }
    const i = n++;
    const tail =
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},` +
      `tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${count}`;
    const panTail = () => `${panChain(pan, first / rate - origin)},tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${count}`;
    if (!fx) {
      if (pan) return { i, first, count, chain: `[${i}:v]${pts},scale=${pan.w}:${pan.h},setsar=1,${panTail()}` };
      return { i, first, count, chain: `[${i}:v]${pts},scale=${W}:${H}:force_original_aspect_ratio=decrease,${tail}` };
    }
    // Efectos animados: sendcmd cambia los valores de sus filtros en cada fotograma (tiempos del trozo).
    const local0 = first / rate - origin; // tiempo local del evento en el primer fotograma del trozo
    filters.push(
      `[${i}:v]${pts},scale=${fx.w}:${fx.h},setsar=1${fxCommands(fx, local0, length).replaceAll('@N@', `fx${i}_`)}[fxin${i}]`,
      fx.graph.replaceAll('@IN@', `fxin${i}`).replaceAll('@OUT@', `fxout${i}`).replaceAll('@N@', `fx${i}_`),
    );
    if (pan) return { i, first, count, chain: `[fxout${i}]${panTail()}` };
    return { i, first, count, chain: `[fxout${i}]format=${fx.alpha ? 'yuva420p' : 'yuv420p'},${tail}` };
  };
  // Cadena de la panorámica (ver addVideoInput). offset: tiempo local del evento en el primer fotograma.
  // La imagen encajada (con el recorte transparente) se centra en un lienzo transparente 2 px más grande que
  // el cuadro; perspective la lleva a su sitio en cada fotograma (fuera queda el borde transparente) y se quita
  // el borde. En YUV con alfa: pasar por RGB cambiaría los colores de los videos marcados como BT.709.
  const panChain = (pan, offset) => {
    const { w, h } = pan;
    const c = pan.crop || {};
    const cl = Math.round((c.left || 0) * w);
    const ct = Math.round((c.top || 0) * h);
    const cw = Math.max(2, w - cl - Math.round((c.right || 0) * w));
    const ch = Math.max(2, h - ct - Math.round((c.bottom || 0) * h));
    const crop = cw < w || ch < h ? `crop=${cw}:${ch}:${cl}:${ct},pad=${w}:${h}:${cl}:${ct}:color=black@0,` : '';
    const Wp = W + 4;
    const Hp = H + 4;
    // Tiempo local del evento en cada fotograma de este fragmento (después de fps). En perspective,
    // `in` vale 1 en el primer fotograma.
    const T = `((in-1)/${rate.toFixed(9)}+${offset.toFixed(6)})`;
    const at = (expr) => expr.replaceAll('@T@', T);
    const X = `(2+${W}*${at(pan.x)})`;
    const Y = `(2+${H}*${at(pan.y)})`;
    const S = `(${at(pan.scale)})`;
    const R = `(${at(pan.rotation)})`;
    // Esquina del lienzo (dx, dy desde su centro) → P + S·R·(dx, dy).
    const corner = (dx, dy) => [
      `${X}+${S}*(${dx}*cos(${R})-(${dy})*sin(${R}))`,
      `${Y}+${S}*(${dx}*sin(${R})+(${dy})*cos(${R}))`,
    ];
    const pts = [corner(-Wp / 2, -Hp / 2), corner(Wp / 2, -Hp / 2), corner(-Wp / 2, Hp / 2), corner(Wp / 2, Hp / 2)];
    const coords = pts.map(([x, y], k) => `x${k}='${x}':y${k}='${y}'`).join(':');
    return (
      `format=yuva444p,${crop}pad=${Wp}:${Hp}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,fps=${fps},` +
      `perspective=${coords}:sense=destination:eval=frame,crop=${W}:${H}:2:2`
    );
  };

  // Desplaza el fragmento a su fotograma (la base de tiempo tras fps es 1/fps) y lo superpone solo en sus fotogramas.
  const placeAt = (first) => `setpts=PTS-STARTPTS+${first}`;
  const overlayAt = (label, first, count) => {
    const out = `o${n}_${filters.length}`;
    const from = (first - 0.5) / rate;
    const to = (first + count - 0.5) / rate;
    filters.push(`[${last}][${label}]overlay=eof_action=pass:enable='between(t,${from.toFixed(6)},${to.toFixed(6)})'[${out}]`);
    last = out;
  };

  // Fundidos con transición (e.transIn / e.transOut: id de xfade, ver edgeAt en src/state/project.js): xfade
  // entre el evento y una copia suya transparente (mismo color, alfa 0), en yuva420p, así que la transición
  // descubre lo que hay debajo. label: el evento con sus efectos y fundidos (count fotogramas desde el primero,
  // first); devuelve la etiqueta del resultado. En la salida, el desfase d0 (el evento puede empezar entre dos
  // fotogramas) entra en el offset y el progreso coincide con el de la vista previa.
  const edgeTransitions = (label, e, first, count) => {
    if (!e.transIn && !e.transOut) return label;
    const k = tag++;
    let cur = `ed${k}`;
    filters.push(`[${label}]format=yuva420p[${cur}]`);
    if (e.transIn) {
      filters.push(
        `[${cur}]split[ei${k}a][ei${k}b]`,
        `[ei${k}b]lutyuv=a=0[ei${k}t]`,
        `[ei${k}t][ei${k}a]xfade=transition=${e.transIn}:duration=${num(e.fadeIn)}:offset=0,trim=end_frame=${count}[ei${k}]`,
      );
      cur = `ei${k}`;
    }
    if (e.transOut) {
      const d0 = first / rate - e.start;
      const off = Math.max(0, e.duration - e.fadeOut - d0);
      const offFrame = Math.ceil(off * rate - 1e-6);
      filters.push(
        `[${cur}]split[eo${k}a][eo${k}b]`,
        `[eo${k}b]trim=start_frame=${offFrame},setpts=PTS-STARTPTS,lutyuv=a=0[eo${k}t]`,
        `[eo${k}a][eo${k}t]xfade=transition=${e.transOut}:duration=${num(e.fadeOut)}:offset=${num(off)},trim=end_frame=${count}[eo${k}]`,
      );
      cur = `eo${k}`;
    }
    return cur;
  };

  // Envolvente de opacidad de la pista (track.opacity: expresión en función de @T@, el tiempo de la línea de
  // tiempo) en un fragmento ya colocado (label, fotogramas first … first+count−1): una máscara gris con el
  // factor de cada fotograma (geq en un cuadro de 2×2, calculado con el instante de ese fotograma, y escalada)
  // multiplica el alfa. Devuelve la etiqueta del resultado. (No con sendcmd: los comandos llegan al filtro antes
  // que los fotogramas que aún esperan en la cola y el valor se adelanta.)
  const applyLevel = (label, track, first, count) => {
    if (!track.opacity) return label;
    const k = tag++;
    const expr = track.opacity.replaceAll('@T@', 'T');
    filters.push(
      `color=c=black:s=2x2:r=${fps}:d=${num((count + 1) / rate)},setpts=PTS-STARTPTS+${first},format=gray,` +
        `geq=lum='round(255*(${expr}))',scale=${W}:${H}:flags=neighbor,trim=end_frame=${count}[lm${k}]`,
      `[${label}]format=yuva420p,split[lv${k}][lw${k}]`,
      `[lw${k}]alphaextract[la${k}]`,
      `[la${k}][lm${k}]blend=all_mode=multiply[lb${k}]`,
      `[lv${k}][lb${k}]alphamerge[lo${k}]`,
    );
    return `lo${k}`;
  };

  // Superpone un fragmento colocado con el modo de fusión de su pista (track.blend): fuera de 'normal', el trozo
  // de lo de debajo y la capa pasan a RGB (BT.601 de rango limitado en los dos sentidos, así lo que no cambia
  // vuelve igual), blend los mezcla ([debajo][capa], como el compositor de la vista previa) y el resultado se
  // pone encima con el alfa de la capa. Solo en los fotogramas first … first+count−1.
  const compositeAt = (label, first, count, mode) => {
    if (!mode || mode === 'normal') {
      overlayAt(label, first, count);
      return;
    }
    const k = tag++;
    const from = ((first - 0.5) / rate).toFixed(6);
    const to = ((first + count - 0.5) / rate).toFixed(6);
    const toRgb = 'scale=in_color_matrix=bt601:in_range=tv';
    filters.push(
      `[${last}]split[bk${k}][bu${k}]`,
      `[bu${k}]trim=start=${from}:end=${to},${toRgb},format=gbrp[bb${k}]`,
      `[${label}]trim=start=${from}:end=${to},${toRgb},format=gbrap,split[lc${k}][la${k}]`,
      `[lc${k}]format=gbrp[lr${k}]`,
      `[bb${k}][lr${k}]blend=all_mode=${mode}[bm${k}]`,
      `[la${k}]alphaextract[lal${k}]`,
      `[bm${k}][lal${k}]alphamerge,scale=out_color_matrix=bt601:out_range=tv,format=yuva420p[bl${k}]`,
    );
    last = `bk${k}`;
    overlayAt(`bl${k}`, first, count);
  };

  // Transiciones de video: se dibujan encima del evento que entra, dentro de su misma pista.
  const usableIds = new Set(usable.map((e) => e.id));
  const eventsById = new Map(project.events.map((e) => [e.id, e]));
  const transitionInto = new Map(
    (project.transitions || [])
      .filter((tr) => usableIds.has(tr.from) && usableIds.has(tr.to) && /^[a-z]+$/.test(tr.type))
      .map((tr) => [tr.to, tr]),
  );

  // Pistas de video: la pista de más arriba en la línea de tiempo se dibuja al final (queda encima).
  const videoEvents = format.audioOnly ? [] : usable
    .filter((e) => tracks.get(e.trackId).type === 'video')
    .sort((a, b) => tracks.get(b.trackId).index - tracks.get(a.trackId).index || a.start - b.start);
  for (const e of videoEvents) {
    const track = tracks.get(e.trackId);
    const v = addVideoInput(media.get(e.mediaId), e, e.start, e.duration);
    filters.push(`${v.chain}${videoFades(e)}[vf${v.i}]`);
    filters.push(`[${edgeTransitions(`vf${v.i}`, e, v.first, v.count)}]${placeAt(v.first)}[v${v.i}]`);
    const tr = transitionInto.get(e.id);
    // Con modo de fusión, los fotogramas de la transición de entrada no se mezclan dos veces: el evento se
    // superpone desde que acaba la transición.
    const skip = tr && track.blend && track.blend !== 'normal' ? Math.min(v.count - 1, frameSpan(tr.start, tr.duration).count) : 0;
    compositeAt(applyLevel(`v${v.i}`, track, v.first, v.count), v.first + skip, v.count - skip, track.blend);

    if (tr) {
      // Final del evento que sale y principio del que entra, mezclados con xfade.
      const from = eventsById.get(tr.from);
      const a = addVideoInput(media.get(from.mediaId), from, tr.start, tr.duration);
      const b = addVideoInput(media.get(e.mediaId), e, tr.start, tr.duration);
      filters.push(
        `${a.chain},format=yuv420p[ta${a.i}]`,
        `${b.chain},format=yuv420p[tb${b.i}]`,
        `[ta${a.i}][tb${b.i}]xfade=transition=${tr.type}:duration=${(b.count / rate).toFixed(6)}:offset=0,` +
          `trim=end_frame=${b.count},${placeAt(b.first)}[tr${b.i}]`,
      );
      compositeAt(applyLevel(`tr${b.i}`, track, b.first, b.count), b.first, b.count, track.blend);
    }
  }
  if (!format.audioOnly) {
    // Bandas negras si el archivo tiene otra proporción que el proyecto; GIF: paleta propia en dos pasadas.
    const pad = outW !== W || outH !== H ? `,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:color=black` : '';
    const vfinal = format.gif ? 'vgif' : 'vout';
    filters.push(`[${last}]format=yuv420p${firstFrame ? ',setpts=PTS-STARTPTS' : ''}${pad}[${vfinal}]`);
    if (format.gif) {
      filters.push('[vgif]split[g1][g2]', '[g1]palettegen=stats_mode=diff[gpal]', '[g2][gpal]paletteuse=dither=bayer:bayer_scale=4[vout]');
    }
  }

  // Pistas de audio: cada evento se recorta, se retrasa a su posición y se mezcla.
  filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${num(rangeStart + duration)}[abase]`);
  const mix = ['[abase]'];
  for (const e of usable.filter((ev) => tracks.get(ev.trackId).type === 'audio')) {
    const m = media.get(e.mediaId);
    const gain = (tracks.get(e.trackId).gain ?? 1) * (e.gain ?? 1);
    if (!m.hasAudio || gain === 0) continue;
    const speed = e.rate || 1;
    inputs.push('-ss', num(e.inPoint), '-t', num(srcOffset(e, e.duration) + (e.speedMap ? RAMP_TAIL : 0)), '-i', m.path);
    const i = n++;
    const delay = Math.round(e.start * 1000);
    const format = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
    let head = `[${i}:a]asetpts=PTS-STARTPTS,${format}${e.speedMap ? audioRamp(e, i) : atempo(speed)}`;
    if (e.speedMap) head += `,atrim=duration=${num(e.duration)},asetpts=PTS-STARTPTS`;
    if (e.afx) {
      // Efectos del evento (subgrafo calculado en la interfaz). Las colas (eco, reverberación) se cortan
      // al final del evento, igual que en la vista previa.
      filters.push(
        `${head}[afxin${i}]`,
        e.afx.graph.replaceAll('@IN@', `afxin${i}`).replaceAll('@OUT@', `afxout${i}`).replaceAll('@N@', `afx${i}_`),
      );
      head = `[afxout${i}]${format},atrim=duration=${num(e.duration)},asetpts=PTS-STARTPTS`;
    }
    // Envolventes y panorámica de la pista: ganancia de cada canal en el tiempo de la línea de tiempo,
    // muestra a muestra (antes de adelay, así que el tiempo es t + el principio del evento).
    const trackMix = tracks.get(e.trackId).mix;
    const at = (expr) => expr.replaceAll('@T@', `(t+${num(e.start)})`);
    const env = trackMix ? `,aeval=exprs='val(0)*(${at(trackMix.left)})|val(1)*(${at(trackMix.right)})'` : '';
    filters.push(
      `${head}${audioFades(e)}${env},adelay=delays=${delay}:all=1${gain === 1 ? '' : `,volume=${gain.toFixed(4)}`}[a${i}]`,
    );
    mix.push(`[a${i}]`);
  }
  const cut = rangeStart ? `,atrim=start=${rangeStart.toFixed(6)},asetpts=PTS-STARTPTS` : '';
  // Normalizar la sonoridad (settings.loudness = LUFS integrados): loudnorm con lo medido en la primera pasada
  // (settings.loudnessMeasured, ver render) y linear=true, que solo sube o baja el volumen (sin comprimir) si el
  // pico verdadero queda por debajo de −1,5 dBTP. Sin medidas es la propia pasada de medida (print_format=json).
  const norm = settings.loudness && !format.gif && !format.still;
  const mixOut = norm ? 'amixed' : 'aout';
  filters.push(
    mix.length === 1
      ? `[abase]anull${cut}[${mixOut}]`
      : `${mix.join('')}amix=inputs=${mix.length}:duration=first:normalize=0${cut}[${mixOut}]`,
  );
  if (norm) {
    const m = settings.loudnessMeasured;
    const measured = m
      ? `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=none`
      : ':print_format=json';
    filters.push(`[amixed]loudnorm=I=${settings.loudness}:TP=-1.5:LRA=11${measured},aresample=48000[aout]`);
  }
  if (format.gif || format.still) filters.push('[aout]anullsink'); // el GIF y la imagen no llevan sonido

  const args = [
    '-y', '-nostdin', '-v', 'error', '-progress', 'pipe:1', '-nostats',
    ...inputs,
    '-filter_complex_script', null, // se completa con la ruta del archivo temporal
    ...(format.audioOnly ? [] : ['-map', '[vout]']),
    ...(format.gif || format.still ? [] : ['-map', '[aout]']),
    ...(format.video ? [...format.video(settings.quality), '-r', fps] : format.gif ? ['-r', fps] : []),
    ...(format.audio ? format.audio(settings.audioKbps || 192) : []),
    '-t', num(duration), ...format.extra,
    outPath,
  ];
  return { args, filterGraph: filters.join(';\n'), duration };
}

async function render(project, settings, outPath, { onProgress, onSpawn } = {}) {
  // Los textos llegan dibujados como PNG (data URL): se guardan en archivos temporales y se usan como imágenes.
  const stamp = Date.now();
  const temp = [];
  const media = await Promise.all(project.media.map(async (m) => {
    if (m.sequence) {
      // Texto animado: sus fotogramas como PNG y una lista del demuxer concat con la duración de cada uno (el
      // último se repite sin duración: si no, concat no respeta la suya).
      const safeId = m.id.replace(/[^\w-]/g, '_');
      const entries = [];
      for (const [k, item] of m.sequence.entries()) {
        const file = path.join(os.tmpdir(), `cortex-texto-${stamp}-${safeId}-${k}.png`);
        await fs.promises.writeFile(file, Buffer.from(item.png.slice(item.png.indexOf(',') + 1), 'base64'));
        temp.push(file);
        entries.push([`file '${file.replace(/\\/g, '/')}'`, `duration ${item.dur.toFixed(6)}`]);
      }
      const lines = [...entries.flat(), entries[entries.length - 1][0]];
      const list = path.join(os.tmpdir(), `cortex-texto-${stamp}-${safeId}.txt`);
      await fs.promises.writeFile(list, `ffconcat version 1.0\n${lines.join('\n')}\n`, 'utf8');
      temp.push(list);
      return { ...m, sequence: true, path: list, isImage: false };
    }
    if (!m.png) return m;
    const file = path.join(os.tmpdir(), `cortex-texto-${stamp}-${m.id}.png`);
    await fs.promises.writeFile(file, Buffer.from(m.png.slice(m.png.indexOf(',') + 1), 'base64'));
    temp.push(file);
    return { ...m, png: undefined, path: file, isImage: true };
  }));
  // Una pasada de FFmpeg; el progreso va de `from` a from + share.
  const pass = async (opts, out, from, share, edit = (a) => a) => {
    const { args, filterGraph, duration } = buildRender({ ...project, media }, opts, out);
    const scriptPath = path.join(os.tmpdir(), `cortex-filtros-${stamp}-${temp.length}.txt`);
    temp.push(scriptPath);
    await fs.promises.writeFile(scriptPath, filterGraph, 'utf8');
    args[args.indexOf(null)] = scriptPath;
    return run(ffmpegPath, edit(args), {
      onSpawn,
      onLine: (line) => {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && onProgress) onProgress(from + share * Math.min(1, Number(m[1]) / 1e6 / duration));
      },
    });
  };
  try {
    let opts = settings;
    let from = 0;
    if (settings.loudness && settings.format !== 'gif') {
      // Primera pasada: solo el sonido (como un WAV) a ninguna parte, para medir su sonoridad.
      const measure = await pass({ ...settings, format: 'wav' }, '-', 0, 0.2, (a) => {
        const b = [...a];
        b[b.indexOf('error')] = 'info'; // loudnorm escribe la medida como información
        b.splice(b.length - 1, 0, '-f', 'null');
        return b;
      });
      if (measure.code !== 0) return measure;
      const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(measure.stderr);
      const m = json && JSON.parse(json[0]);
      // Sin sonido (−inf) no hay nada que normalizar.
      opts = m && Number.isFinite(Number(m.input_i)) ? { ...settings, loudnessMeasured: m } : { ...settings, loudness: null };
      from = 0.2;
    }
    return await pass(opts, outPath, from, 1 - from);
  } finally {
    for (const file of temp) fs.promises.unlink(file).catch(() => {});
  }
}

module.exports = { analyze, render, buildRender, makeProxy, extractFrame, filmstrip, detectScenes, ffmpegPath, ffprobePath };
