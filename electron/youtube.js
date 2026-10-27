// Descargas de YouTube (y de los demás sitios que admite yt-dlp). yt-dlp no va en el instalador: se descarga la
// primera vez que se usa en userData/yt-dlp y se actualiza solo (como mucho una vez al día), porque YouTube cambia a
// menudo y las versiones viejas dejan de funcionar. Usa el FFmpeg/ffprobe de la aplicación (sus carpetas van delante
// en el PATH del proceso) y el propio Electron como motor de JavaScript (ELECTRON_RUN_AS_NODE), que yt-dlp necesita
// para YouTube.
const { app, net } = require('electron');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ffmpegPath, ffprobePath } = require('./ffmpeg');
const { tx } = require('./i18n');

const ASSET = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: 'yt-dlp_linux' }[process.platform];
const DOWNLOAD_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ASSET}`;
const UPDATE_EVERY_MS = 24 * 3600 * 1000;

const binDir = () => path.join(app.getPath('userData'), 'yt-dlp');
const binPath = () => path.join(binDir(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const stampPath = () => path.join(binDir(), 'comprobado.txt');

function env() {
  const e = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
  const key = Object.keys(e).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  e[key] = [path.dirname(ffmpegPath), path.dirname(ffprobePath), e[key]].filter(Boolean).join(path.delimiter);
  return e;
}

// Opciones comunes: sin la configuración global de yt-dlp del usuario, salida en UTF-8 y Electron como Node.
const BASE = () => ['--ignore-config', '--no-colors', '--encoding', 'utf-8', '--js-runtimes', `node:${process.execPath}`];

function exec(args, { onLine, onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    // En macOS y Linux, en su propio grupo de procesos, para poder cancelarlo con sus hijos (ver cancel).
    const proc = spawn(binPath(), args, { env: env(), windowsHide: true, detached: process.platform !== 'win32' });
    const out = [];
    let err = '';
    let pending = '';
    proc.stdout.on('data', (d) => {
      if (!onLine) return out.push(d);
      pending += d.toString('utf8');
      let i;
      while ((i = pending.indexOf('\n')) >= 0) {
        onLine(pending.slice(0, i).replace(/\r$/, ''));
        pending = pending.slice(i + 1);
      }
    });
    proc.stderr.on('data', (d) => {
      err = (err + d.toString('utf8')).slice(-30000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: err }));
    if (onSpawn) onSpawn(proc);
  });
}

// Último «ERROR: …» de yt-dlp, sin el prefijo del extractor.
function errorText(stderr, code) {
  const lines = stderr.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('ERROR:'));
  const last = lines.pop();
  return last ? last.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?/, '') : tx('yt-dlp terminó con el código {code}', { code });
}

async function install(onStatus) {
  await fs.promises.mkdir(binDir(), { recursive: true });
  const res = await net.fetch(DOWNLOAD_URL);
  if (!res.ok) throw new Error(tx('No se pudo descargar yt-dlp ({status})', { status: res.status }));
  const total = Number(res.headers.get('content-length')) || 0;
  const part = `${binPath()}.parcial`;
  const file = fs.createWriteStream(part);
  let done = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      done += value.length;
      if (!file.write(value)) await new Promise((r) => file.once('drain', r));
      onStatus({ stage: 'install', percent: total ? (done / total) * 100 : null });
    }
  } finally {
    await new Promise((r) => file.end(r));
  }
  if (process.platform !== 'win32') await fs.promises.chmod(part, 0o755);
  await fs.promises.rename(part, binPath());
  await fs.promises.writeFile(stampPath(), String(Date.now()));
}

async function update(onStatus) {
  let last = 0;
  try {
    last = Number(await fs.promises.readFile(stampPath(), 'utf8')) || 0;
  } catch {}
  if (Date.now() - last < UPDATE_EVERY_MS) return;
  onStatus({ stage: 'update' });
  // Sin conexión o si falla, se sigue con la versión que hay.
  await exec(['--ignore-config', '--no-colors', '-U']).catch(() => {});
  await fs.promises.writeFile(stampPath(), String(Date.now())).catch(() => {});
}

let ready = null;
// Instala yt-dlp si falta y lo actualiza si toca (una vez por sesión).
function ensure(onStatus = () => {}) {
  if (!ASSET) return Promise.reject(new Error(tx('Las descargas no funcionan en este sistema')));
  if (!ready) {
    ready = (async () => {
      if (!fs.existsSync(binPath())) await install(onStatus);
      else await update(onStatus);
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

function version() {
  if (!fs.existsSync(binPath())) return null;
  const r = spawnSync(binPath(), ['--version'], { windowsHide: true, encoding: 'utf8' });
  return r.stdout?.trim() || null;
}

// Datos de una URL para el diálogo: un video ({ title, uploader, duration, thumbnail, heights, subtitles, chapters })
// o una lista ({ playlist: true, title, uploader, count, thumbnail, entries }).
async function info(url, playlist) {
  const r = await exec([...BASE(), '-J', '--flat-playlist', playlist ? '--yes-playlist' : '--no-playlist', '--', url]);
  if (r.code !== 0 || !r.stdout.trim()) throw new Error(errorText(r.stderr, r.code));
  const j = JSON.parse(r.stdout);
  const uploader = j.uploader || j.channel || j.uploader_id || '';
  const thumb = (t) => t?.filter((x) => x.url && !/\.webp/.test(x.url)).pop()?.url || t?.at(-1)?.url || null;
  if (j._type === 'playlist') {
    const entries = (j.entries || []).map((e) => ({ title: e.title || e.id, duration: e.duration || null }));
    return { playlist: true, title: j.title || tx('Lista'), uploader, count: j.playlist_count || entries.length, thumbnail: thumb(j.thumbnails) || thumb(j.entries?.[0]?.thumbnails), entries };
  }
  const heights = [...new Set((j.formats || []).filter((f) => f.vcodec && f.vcodec !== 'none' && f.height).map((f) => f.height))].sort((a, b) => b - a);
  return {
    playlist: false,
    title: j.title || j.id,
    uploader,
    duration: j.duration || null,
    date: j.upload_date || null,
    thumbnail: j.thumbnail || thumb(j.thumbnails),
    heights,
    subtitles: Object.keys(j.subtitles || {}).filter((k) => k !== 'live_chat'),
    chapters: (j.chapters || []).length,
    site: j.extractor_key || '',
  };
}

// Contenedores en los que yt-dlp puede meter la portada.
const THUMB_VIDEO = new Set(['mp4', 'mkv', 'mov']);
const THUMB_AUDIO = new Set(['mp3', 'm4a', 'opus', 'flac']);

// Argumentos de la descarga. opts: { url, playlist, kind: 'video' | 'audio', container (mp4, mkv, webm, mov),
// compat (H.264 + AAC), height (0 = la mejor), audioFormat (mp3, m4a, opus, flac, wav), audioQuality ('0' = la mejor
// o '320K'…), metadata, thumbnail, chapters, subtitles, dir }.
function downloadArgs(o) {
  const h = o.height ? `[height<=${o.height}]` : '';
  const args = [...BASE(), o.playlist ? '--yes-playlist' : '--no-playlist'];
  if (o.kind === 'audio') {
    args.push('-f', 'ba/b', '-x', '--audio-format', o.audioFormat);
    if (!['flac', 'wav'].includes(o.audioFormat)) args.push('--audio-quality', o.audioQuality || '0');
  } else {
    let sel;
    if (o.container === 'webm') sel = `bv*${h}[ext=webm]+ba[ext=webm]/b${h}[ext=webm]/bv*${h}+ba/b${h}`;
    else if (o.compat || o.container === 'mov') sel = `bv*${h}[vcodec^=avc1]+ba[ext=m4a]/b${h}[ext=mp4]/bv*${h}+ba[ext=m4a]/bv*${h}+ba/b${h}`;
    else if (o.container === 'mp4') sel = `bv*${h}+ba[ext=m4a]/bv*${h}+ba/b${h}`;
    else sel = `bv*${h}+ba/b${h}`;
    args.push('-f', sel, '--merge-output-format', o.container);
    if (o.container !== 'webm') args.push('--remux-video', o.container);
  }
  const ext = o.kind === 'audio' ? o.audioFormat : o.container;
  if (o.metadata) args.push('--embed-metadata');
  if (o.thumbnail && (o.kind === 'audio' ? THUMB_AUDIO : THUMB_VIDEO).has(ext)) args.push('--embed-thumbnail', '--convert-thumbnails', 'jpg');
  if (o.chapters) args.push('--embed-chapters');
  if (o.subtitles && o.kind === 'video' && ext !== 'mov') args.push('--embed-subs', '--sub-langs', 'es.*,en.*'); // sin --write-subs: así no deja el .vtt suelto
  const name = o.playlist ? '%(playlist_title)s/%(playlist_index)03d - %(title)s.%(ext)s' : '%(title)s.%(ext)s';
  args.push(
    '-P', o.dir, '-o', name, '--trim-filenames', '180',
    '--newline', '--progress',
    '--progress-template', 'download:@@{"p":%(progress)j,"i":%(info.playlist_autonumber)j,"n":%(info.n_entries)j,"t":%(info.title)j,"v":%(info.vcodec)j}',
    '--print', 'after_move:@@FILE %(filepath)s',
    '--', o.url,
  );
  return args;
}

let current = null; // { proc, temps, canceled }

// Descarga y devuelve { files, error } (en una lista, los que se hayan podido bajar aunque falle alguno).
// onProgress({ stage: 'download' | 'processing', percent, speed, eta, index, count, title, part: 'video' | 'audio' }).
async function download(opts, onProgress) {
  if (current) throw new Error(tx('Ya hay una descarga en marcha'));
  await fs.promises.mkdir(opts.dir, { recursive: true });
  const job = { proc: null, temps: new Set(), canceled: false };
  current = job;
  const files = [];
  try {
    const r = await exec(downloadArgs(opts), {
      onSpawn: (p) => { job.proc = p; },
      onLine: (line) => {
        if (line.startsWith('@@FILE ')) {
          files.push(line.slice(7).trim());
          return;
        }
        if (!line.startsWith('@@{')) return;
        let d;
        try {
          d = JSON.parse(line.slice(2).replace(/:NA(?=[,}])/g, ':null'));
        } catch {
          return;
        }
        const p = d.p || {};
        if (p.tmpfilename) job.temps.add(p.tmpfilename);
        if (p.filename) job.temps.add(p.filename);
        const total = p.total_bytes || p.total_bytes_estimate;
        onProgress({
          stage: p.status === 'finished' ? 'processing' : 'download',
          percent: total ? Math.min(100, (p.downloaded_bytes / total) * 100) : null,
          speed: p.speed || null,
          eta: p.eta ?? null,
          index: d.i || 1,
          count: d.n || 1,
          title: d.t || '',
          part: opts.kind === 'audio' ? null : d.v === 'none' ? 'audio' : 'video',
        });
      },
    });
    if (job.canceled) {
      await cleanup(job, files);
      return { files: [], canceled: true };
    }
    const error = r.code !== 0 ? errorText(r.stderr, r.code) : null;
    if (!files.length) throw new Error(error || tx('No se ha descargado nada'));
    return { files, error };
  } finally {
    current = null;
  }
}

// Al cancelar quedan los trozos a medias (.part, .ytdl, los .fNNN de video y audio por separado, .temp) y lo que se
// baja antes para incrustarlo (miniatura, subtítulos). Se borra solo eso, por el nombre de la descarga: nunca un
// archivo terminado con el mismo nombre.
const LEFTOVER = /^\.(f[\w-]+\.\w+(\.part)?|part|ytdl|temp\.\w+|(\w[\w-]*\.)?(jpg|jpeg|webp|png|vtt|srt|ass|lrc)|\w+\.(part|ytdl))(\.ytdl)?$/i;
async function cleanup(job, files) {
  const keep = new Set(files);
  const bases = new Set();
  for (const t of job.temps) {
    const m = path.basename(t).match(/^(.*?)(\.f[\w-]+)?\.\w+(\.part)?$/);
    if (m) bases.add(path.join(path.dirname(t), m[1]));
  }
  for (const base of bases) {
    const dir = path.dirname(base);
    const name = path.basename(base);
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir);
    } catch {}
    for (const e of entries) {
      if (!e.startsWith(name) || !LEFTOVER.test(e.slice(name.length))) continue;
      const f = path.join(dir, e);
      if (!keep.has(f)) await fs.promises.unlink(f).catch(() => {});
    }
  }
}

function cancel() {
  if (!current?.proc) return;
  current.canceled = true;
  const { pid } = current.proc;
  // yt-dlp arranca otro proceso (el empaquetado de PyInstaller) y FFmpeg: hay que matar el árbol (en macOS y Linux,
  // el grupo de procesos que se creó al lanzarlo).
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      current.proc.kill('SIGTERM');
    }
  }
}

module.exports = { ensure, info, download, cancel, version };
