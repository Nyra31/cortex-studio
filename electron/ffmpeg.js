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

function run(bin, args, { onLine, onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
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
  };
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
  if (e.fadeIn > 0) {
    out.push(CURVE_EXPR[e.curveIn] ? curveFade(e.curveIn, 0, e.fadeIn, false) : `fade=t=in:st=0:d=${num(e.fadeIn)}:alpha=1`);
  }
  if (e.fadeOut > 0) {
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
  let n = 0;

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
      inputs.push('-ss', num(seek), '-t', num(srcOffset(ev, local0 + length) - s0), '-i', m.path);
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
    const v = addVideoInput(media.get(e.mediaId), e, e.start, e.duration);
    filters.push(`${v.chain}${videoFades(e)},${placeAt(v.first)}[v${v.i}]`);
    overlayAt(`v${v.i}`, v.first, v.count);

    const tr = transitionInto.get(e.id);
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
      overlayAt(`tr${b.i}`, b.first, b.count);
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
  filters.push(
    mix.length === 1
      ? `[abase]anull${cut}[aout]`
      : `${mix.join('')}amix=inputs=${mix.length}:duration=first:normalize=0${cut}[aout]`,
  );
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
    if (!m.png) return m;
    const file = path.join(os.tmpdir(), `cortex-texto-${stamp}-${m.id}.png`);
    await fs.promises.writeFile(file, Buffer.from(m.png.slice(m.png.indexOf(',') + 1), 'base64'));
    temp.push(file);
    return { ...m, png: undefined, path: file, isImage: true };
  }));
  const { args, filterGraph, duration } = buildRender({ ...project, media }, settings, outPath);
  const scriptPath = path.join(os.tmpdir(), `cortex-filtros-${stamp}.txt`);
  temp.push(scriptPath);
  await fs.promises.writeFile(scriptPath, filterGraph, 'utf8');
  args[args.indexOf(null)] = scriptPath;
  try {
    const result = await run(ffmpegPath, args, {
      onSpawn,
      onLine: (line) => {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && onProgress) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration));
      },
    });
    return result;
  } finally {
    for (const file of temp) fs.promises.unlink(file).catch(() => {});
  }
}

module.exports = { analyze, render, buildRender, ffmpegPath, ffprobePath };
