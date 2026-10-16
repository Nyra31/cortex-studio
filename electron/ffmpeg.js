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
  return {
    path: file,
    name: path.basename(file),
    isImage,
    hasVideo: !!video,
    hasAudio: !!audio && !isImage,
    duration: isImage ? null : duration,
    width: video ? video.width : null,
    height: video ? video.height : null,
    fps: video ? parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) : null,
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

// Construye los argumentos de FFmpeg y el grafo de filtros para renderizar la línea de tiempo.
function buildRender(project, settings, outPath) {
  const { width: W, height: H, crf } = settings;
  const fps = frameRate(settings.fps);
  const media = new Map(project.media.map((m) => [m.id, m]));
  const tracks = new Map(project.tracks.map((t, i) => [t.id, { ...t, index: i }]));
  const usable = project.events.filter((e) => {
    const t = tracks.get(e.trackId);
    const m = media.get(e.mediaId);
    return t && !t.muted && m && !m.missing && e.duration > 0;
  });
  const duration = Math.max(0.1, ...project.events.map((e) => e.start + e.duration));

  const inputs = [];
  const filters = [`color=c=black:s=${W}x${H}:r=${fps}:d=${num(duration)}[base]`];
  let last = 'base';
  let n = 0;

  // Pistas de video: la pista de más arriba en la línea de tiempo se dibuja al final (queda encima).
  const videoEvents = usable
    .filter((e) => tracks.get(e.trackId).type === 'video')
    .sort((a, b) => tracks.get(b.trackId).index - tracks.get(a.trackId).index || a.start - b.start);
  for (const e of videoEvents) {
    const m = media.get(e.mediaId);
    if (m.isImage) inputs.push('-loop', '1', '-framerate', fps, '-t', num(e.duration), '-i', m.path);
    else inputs.push('-ss', num(e.inPoint), '-t', num(e.duration), '-i', m.path);
    const i = n++;
    filters.push(
      `[${i}:v]setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},setpts=PTS+${num(e.start)}/TB[v${i}]`,
      `[${last}][v${i}]overlay=eof_action=pass:enable='between(t,${num(e.start)},${num(e.start + e.duration)})'[o${i}]`,
    );
    last = `o${i}`;
  }
  filters.push(`[${last}]format=yuv420p[vout]`);

  // Pistas de audio: cada evento se recorta, se retrasa a su posición y se mezcla.
  filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${num(duration)}[abase]`);
  const mix = ['[abase]'];
  for (const e of usable.filter((ev) => tracks.get(ev.trackId).type === 'audio')) {
    const m = media.get(e.mediaId);
    const gain = tracks.get(e.trackId).gain ?? 1;
    if (!m.hasAudio || gain === 0) continue;
    inputs.push('-ss', num(e.inPoint), '-t', num(e.duration), '-i', m.path);
    const i = n++;
    const delay = Math.round(e.start * 1000);
    filters.push(
      `[${i}:a]asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
        `adelay=delays=${delay}:all=1${gain === 1 ? '' : `,volume=${gain.toFixed(4)}`}[a${i}]`,
    );
    mix.push(`[a${i}]`);
  }
  filters.push(
    mix.length === 1
      ? '[abase]anull[aout]'
      : `${mix.join('')}amix=inputs=${mix.length}:duration=first:normalize=0[aout]`,
  );

  const args = [
    '-y', '-nostdin', '-v', 'error', '-progress', 'pipe:1', '-nostats',
    ...inputs,
    '-filter_complex_script', null, // se completa con la ruta del archivo temporal
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', fps,
    '-c:a', 'aac', '-b:a', '192k',
    '-t', num(duration), '-movflags', '+faststart',
    outPath,
  ];
  return { args, filterGraph: filters.join(';\n'), duration };
}

async function render(project, settings, outPath, { onProgress, onSpawn } = {}) {
  const { args, filterGraph, duration } = buildRender(project, settings, outPath);
  const scriptPath = path.join(os.tmpdir(), `cortex-filtros-${Date.now()}.txt`);
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
    fs.promises.unlink(scriptPath).catch(() => {});
  }
}

module.exports = { analyze, render, buildRender, ffmpegPath, ffprobePath };
