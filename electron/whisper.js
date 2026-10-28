// Subtítulos automáticos con whisper.cpp, en el propio equipo (no se envía nada). El programa y los modelos no van
// en el instalador: se descargan la primera vez que se usan en userData/whisper. Programa: versión fija (los
// nombres de los archivos de las releases cambian; no hace falta ir al día como con yt-dlp): Windows x64 y Linux
// x64/arm64. Para macOS las releases no traen el programa (solo la biblioteca): se usa el de Homebrew
// (`brew install whisper-cpp`) si está instalado.
const { app, net } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ffmpegPath, run } = require('./ffmpeg');
const { tx } = require('./i18n');

const RELEASE = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/';
// Programa de cada sistema: archivo de la release y ruta de whisper-cli dentro de él.
const BIN = {
  'win32-x64': { file: 'whisper-bin-x64.zip', cli: ['Release', 'whisper-cli.exe'] },
  'linux-x64': { file: 'whisper-bin-ubuntu-x64.tar.gz', cli: ['whisper-bin-ubuntu-x64', 'whisper-cli'] },
  'linux-arm64': { file: 'whisper-bin-ubuntu-arm64.tar.gz', cli: ['whisper-bin-ubuntu-arm64', 'whisper-cli'] },
}[`${process.platform}-${process.arch}`];
// Homebrew en Mac con Apple Silicon y con Intel (las aplicaciones no heredan el PATH de la terminal).
const BREW_CLI = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'];
const MODEL_URL = (file) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`;
// Medidos con 13 s de voz en un procesador de 20 hilos: base 1,3 s, small 2,7 s, turbo 9 s.
const MODELS = [
  { id: 'base', file: 'ggml-base.bin', mb: 142, dtw: 'base', name: tx('Rápido (base, 142 MB)') },
  { id: 'small', file: 'ggml-small.bin', mb: 466, dtw: 'small', name: tx('Bueno (small, 466 MB)') },
  { id: 'turbo', file: 'ggml-large-v3-turbo-q5_0.bin', mb: 547, dtw: 'large.v3.turbo', name: tx('El mejor (large-v3-turbo, 547 MB, más lento)') },
];

const root = () => path.join(app.getPath('userData'), 'whisper');
const binDir = () => path.join(root(), 'programa');
const cliPath = () => (process.platform === 'darwin'
  ? BREW_CLI.find((p) => fs.existsSync(p)) || BREW_CLI[0]
  : path.join(binDir(), ...(BIN?.cli || ['whisper-cli'])));
const modelPath = (m) => path.join(root(), 'modelos', m.file);
const modelById = (id) => MODELS.find((m) => m.id === id) || MODELS[1];

async function download(url, target, onProgress) {
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(tx('No se pudo descargar {basename} ({status})', { basename: path.basename(target), status: res.status }));
  const total = Number(res.headers.get('content-length')) || 0;
  const part = `${target}.parcial`;
  const file = fs.createWriteStream(part);
  const reader = res.body.getReader();
  let done = 0;
  try {
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      done += value.length;
      if (!file.write(value)) await new Promise((r) => file.once('drain', r));
      onProgress?.(total ? done / total : null);
    }
  } finally {
    await new Promise((r) => file.end(r));
  }
  await fs.promises.rename(part, target);
}

let binReady = null;
function ensureBin(onStatus) {
  if (fs.existsSync(cliPath())) return Promise.resolve();
  if (process.platform === 'darwin') {
    return Promise.reject(new Error(tx('En macOS, los subtítulos automáticos usan whisper.cpp de Homebrew: instálalo con «brew install whisper-cpp» en la Terminal y vuelve a intentarlo.')));
  }
  if (!BIN) return Promise.reject(new Error(tx('Los subtítulos automáticos no funcionan en este sistema')));
  if (!binReady) {
    binReady = (async () => {
      const zip = path.join(root(), BIN.file);
      await download(RELEASE + BIN.file, zip, (f) => onStatus({ stage: 'program', percent: f == null ? null : f * 100 }));
      await fs.promises.mkdir(binDir(), { recursive: true });
      // tar descomprime los dos formatos (el de Windows, bsdtar, también zip).
      const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
      const r = await run(tar, ['-xf', zip, '-C', binDir()]);
      await fs.promises.unlink(zip).catch(() => {});
      if (r.code !== 0 || !fs.existsSync(cliPath())) throw new Error(tx('No se pudo descomprimir whisper.cpp'));
    })();
    binReady.catch(() => { binReady = null; });
  }
  return binReady;
}

const modelJobs = new Map();
function ensureModel(id, onStatus) {
  const m = modelById(id);
  if (fs.existsSync(modelPath(m))) return Promise.resolve(m);
  if (!modelJobs.has(m.id)) {
    const job = download(MODEL_URL(m.file), modelPath(m), (f) => onStatus({ stage: 'model', percent: f == null ? null : f * 100, model: m.name }))
      .then(() => m)
      .finally(() => modelJobs.delete(m.id));
    modelJobs.set(m.id, job);
  }
  return modelJobs.get(m.id);
}

function models() {
  return MODELS.map((m) => ({ id: m.id, name: m.name, mb: m.mb, ready: fs.existsSync(modelPath(m)) }));
}

// Texto de ejemplo para que Whisper escriba las muletillas (si no, las quita) en la transcripción palabra a palabra.
const FILLER_PROMPT = {
  es: 'Eh, bueno, em, pues... mmm, o sea, eh, vale.',
  en: 'Um, so, uh, I mean... hmm, like, uh, okay.',
  fr: 'Euh, bon, ben... hum, euh, voilà.',
  de: 'Äh, also, ähm... hm, äh, ja.',
  it: 'Ehm, allora, eh... mmm, cioè, ok.',
  pt: 'É, tipo, ahn... hum, né, então.',
};

// Palabras del JSON completo de whisper-cli (-ojf con -dtw): [[t0, t1, texto]] en segundos, con t0 y t1 = instantes
// DTW de su primer y su último trozo (no son los bordes: caen dentro de la palabra; la interfaz busca los cortes en
// la parte más silenciosa entre dos palabras, ver transcript.js). Los tiempos de segmento de Whisper pueden fallar
// en casi un segundo (meten las pausas en la palabra siguiente); los de DTW, en unas décimas. Un trozo que no
// empieza por espacio continúa la palabra anterior (signos de puntuación, partes de palabra); los signos solos no
// cuentan para t1 (su instante cae en la pausa de después).
function wordsOf(json) {
  const words = [];
  for (const seg of json.transcription || []) {
    for (const tok of seg.tokens || []) {
      const text = tok.text || '';
      if (!text.trim() || /^\[_/.test(text)) continue; // [_BEG_], [_TT_…]
      const t = tok.t_dtw >= 0 ? tok.t_dtw / 100 : (tok.offsets?.from ?? 0) / 1000;
      const last = words[words.length - 1];
      if (last && !/^\s/.test(text)) {
        if (/[\p{L}\p{N}]/u.test(text)) last[1] = Math.max(last[1], t);
        last[2] += text.trim();
      } else {
        words.push([t, t, text.trim()]);
      }
    }
  }
  return words;
}

let current = null; // { proc, canceled }

// Transcribe `file` (un WAV del sonido del proyecto o un medio importado). opts = { model, language ('auto' o
// código), translate, words }. Devuelve el SRT (texto) o, con words, las palabras (wordsOf); null si se cancela.
// onStatus({ stage: 'program' | 'model' | 'audio' | 'transcribe', percent }).
async function transcribe(file, opts, onStatus = () => {}) {
  if (current) throw new Error(tx('Ya hay una transcripción en marcha'));
  const job = { proc: null, canceled: false };
  current = job;
  const base = path.join(os.tmpdir(), `cortex-whisper-${process.pid}-${Date.now()}`);
  try {
    await ensureBin(onStatus);
    const m = await ensureModel(opts.model, onStatus);
    if (job.canceled) return null;
    onStatus({ stage: 'audio', percent: null });
    const wav = `${base}.wav`;
    const conv = await run(ffmpegPath, ['-hide_banner', '-v', 'error', '-y', '-i', file, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], {
      onSpawn: (p) => { job.proc = p; },
    });
    if (job.canceled) return null;
    if (conv.code !== 0) throw new Error(conv.stderr.trim().split('\n').pop() || tx('No se pudo preparar el sonido'));
    onStatus({ stage: 'transcribe', percent: 0 });
    const threads = String(Math.max(1, Math.min(8, os.cpus().length)));
    // Palabra a palabra (editar con el texto): JSON completo con los tiempos DTW de cada trozo (-dtw con el nombre
    // del modelo; no funciona con flash attention: -nfa) y un texto de ejemplo con muletillas, que Whisper suele
    // omitir si no las ve antes.
    const out = opts.words
      ? ['-ojf', '-dtw', m.dtw, '-nfa', ...(FILLER_PROMPT[opts.language] ? ['--prompt', FILLER_PROMPT[opts.language]] : [])]
      : ['-osrt'];
    const args = ['-m', modelPath(m), '-f', wav, '-l', opts.language || 'auto', ...out, '-of', base, '-pp', '-t', threads, ...(opts.translate && !opts.words ? ['-tr'] : [])];
    const code = await new Promise((resolve, reject) => {
      // En Linux las bibliotecas (.so) van junto al programa.
      const env = process.platform === 'linux' ? { ...process.env, LD_LIBRARY_PATH: [path.dirname(cliPath()), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : process.env;
      const proc = spawn(cliPath(), args, { windowsHide: true, cwd: path.dirname(cliPath()), env });
      job.proc = proc;
      let tail = '';
      proc.stderr.on('data', (d) => {
        const text = d.toString();
        tail = (tail + text).slice(-4000);
        for (const mm of text.matchAll(/progress\s*=\s*(\d+)%/g)) onStatus({ stage: 'transcribe', percent: Number(mm[1]) });
      });
      proc.stdout.on('data', () => {});
      proc.on('error', reject);
      proc.on('close', (c) => {
        job.tail = tail;
        resolve(c);
      });
    });
    if (job.canceled) return null;
    if (code !== 0) throw new Error(job.tail.trim().split('\n').filter((l) => /error|failed/i.test(l)).pop() || tx('whisper terminó con el código {code}', { code }));
    if (opts.words) return wordsOf(JSON.parse(await fs.promises.readFile(`${base}.json`, 'utf8')));
    return await fs.promises.readFile(`${base}.srt`, 'utf8');
  } finally {
    current = null;
    for (const ext of ['.wav', '.srt', '.json']) fs.promises.unlink(`${base}${ext}`).catch(() => {});
  }
}

function cancel() {
  if (!current) return;
  current.canceled = true;
  current.proc?.kill();
}

module.exports = { models, transcribe, cancel, download };
