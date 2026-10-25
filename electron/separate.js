// Quitar las voces (separación de fuentes). Los modelos (MODELS) no van en el instalador: se descargan la primera vez
// que se usan en userData/separacion, con su SHA-256 comprobado. La separación la hace la interfaz
// (preview/separator.worker.js, con WebGPU) y aquí solo se prepara el sonido y se escriben los resultados:
//   start: el trozo del medio → PCM 16 bits estéreo a 44,1 kHz en un archivo temporal, que la interfaz lee por
//          media:// a trozos (así no se carga entero en memoria).
//   write: la interfaz manda la pista de voces a trozos (float32 estéreo intercalado) y se añade a otro temporal.
//   finish: voces → FLAC; sin voces = original − voces (FFmpeg), también FLAC. Las dos suman exactamente el original.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { ffmpegPath, run } = require('./ffmpeg');
const { download } = require('./whisper');
const { tx } = require('./i18n');

// id: el motor del worker (ENGINES en separator.worker.js). Calidad: SDR de las voces en MUSDB18 (según sus autores).
const MODELS = [
  {
    // Demucs v4 de Meta (MIT), exportación ONNX de demucs-web. Medido con una GTX 1060: ~3,4 veces el tiempo real.
    id: 'htdemucs',
    name: tx('Rápido: htdemucs'),
    description: tx('El más ligero. Bueno para la mayoría de los videos; puede dejar algo de voz de fondo.'),
    url: 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx',
    file: 'htdemucs_embedded.onnx',
    mb: 172,
    sha256: 'e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077',
  },
  {
    // Mel-Band RoFormer de Kimberley Jensen (MIT), exportación fp16 de audiojs/mel-roformer (SDR de voces 12,1 dB).
    id: 'roformer',
    name: tx('El mejor: Mel-Band RoFormer'),
    description: tx('Separa las voces mucho mejor (al nivel de las herramientas profesionales), pero pesa más y tarda más. Recomendado con una tarjeta gráfica potente.'),
    url: 'https://huggingface.co/audiojs/mel-roformer/resolve/main/mel-roformer.fp16.onnx',
    file: 'mel-roformer.fp16.onnx',
    mb: 464,
    sha256: 'adcbbb826f12453fbb86652b503242d565a9c81cdef1bca2fe0e54752eba91ef',
  },
];
const RATE = 44100;

const modelById = (id) => MODELS.find((m) => m.id === id) || MODELS[0];
const modelPath = (m) => path.join(app.getPath('userData'), 'separacion', m.file);

// Para la ventana de elegir modelo: los modelos y si ya están descargados.
function models() {
  return MODELS.map(({ id, name, description, mb }) => ({ id, name, description, mb, ready: fs.existsSync(modelPath(modelById(id))) }));
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

const modelJobs = new Map();
function ensureModel(m, onStatus) {
  const target = modelPath(m);
  if (fs.existsSync(target)) return Promise.resolve(target);
  if (!modelJobs.has(m.id)) {
    const job = (async () => {
      const part = `${target}.descarga`;
      await download(m.url, part, (f) => onStatus({ stage: 'model', percent: f == null ? null : f * 100, mb: m.mb }));
      if ((await sha256(part)) !== m.sha256) {
        await fs.promises.unlink(part).catch(() => {});
        throw new Error(tx('El modelo descargado está dañado. Vuelve a intentarlo.'));
      }
      await fs.promises.rename(part, target);
      return target;
    })().finally(() => modelJobs.delete(m.id));
    modelJobs.set(m.id, job);
  }
  return modelJobs.get(m.id);
}

const jobs = new Map(); // id → { dir, input, vocals, stream, frames }

async function start(file, from, length, modelId, onStatus) {
  const m = modelById(modelId);
  const model = await ensureModel(m, onStatus);
  onStatus({ stage: 'decode', percent: null });
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cortex-voces-'));
  const input = path.join(dir, 'original.raw');
  const r = await run(ffmpegPath, [
    '-hide_banner', '-v', 'error', '-y',
    '-ss', from.toFixed(6), '-t', length.toFixed(6), '-i', file,
    '-map', '0:a:0', '-ac', '2', '-ar', String(RATE), '-f', 's16le', input,
  ]);
  if (r.code !== 0) {
    await fs.promises.rm(dir, { recursive: true, force: true });
    throw new Error(r.stderr.trim().split('\n').pop() || tx('FFmpeg terminó con el código {code}', { code: r.code }));
  }
  const frames = (await fs.promises.stat(input)).size / 4;
  if (!frames) {
    await fs.promises.rm(dir, { recursive: true, force: true });
    throw new Error(tx('El evento no tiene sonido'));
  }
  const id = crypto.randomUUID();
  const vocals = path.join(dir, 'voces.raw');
  jobs.set(id, { dir, input, vocals, stream: fs.createWriteStream(vocals), frames });
  return { id, input, model, engine: m.id, frames, rate: RATE };
}

function write(id, chunk) {
  jobs.get(id)?.stream.write(Buffer.from(chunk));
}

// outVocals / outRest: rutas de los FLAC. Devuelve { vocals, rest }.
async function finish(id, outRest, outVocals) {
  const job = jobs.get(id);
  if (!job) throw new Error(tx('Archivo no válido'));
  await new Promise((resolve) => job.stream.end(resolve));
  const raw = (fmt) => ['-f', fmt, '-ar', String(RATE), '-ac', '2'];
  try {
    const flac = ['-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24'];
    let r = await run(ffmpegPath, ['-hide_banner', '-v', 'error', '-y', ...raw('f32le'), '-i', job.vocals, ...flac, outVocals]);
    if (r.code === 0) {
      r = await run(ffmpegPath, [
        '-hide_banner', '-v', 'error', '-y', ...raw('s16le'), '-i', job.input, ...raw('f32le'), '-i', job.vocals,
        '-filter_complex', '[0:a][1:a]amerge=inputs=2,pan=stereo|c0=c0-c2|c1=c1-c3[out]', '-map', '[out]', ...flac, outRest,
      ]);
    }
    if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').pop() || tx('FFmpeg terminó con el código {code}', { code: r.code }));
    return { vocals: outVocals, rest: outRest };
  } finally {
    cancel(id);
  }
}

function cancel(id) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  job.stream.destroy();
  fs.promises.rm(job.dir, { recursive: true, force: true }).catch(() => {});
}

// Temporales de separaciones que no terminaron (la aplicación se cerró de golpe): se borran los de más de un día.
async function cleanStale() {
  const tmp = os.tmpdir();
  const names = await fs.promises.readdir(tmp).catch(() => []);
  for (const name of names.filter((n) => n.startsWith('cortex-voces-'))) {
    const dir = path.join(tmp, name);
    const st = await fs.promises.stat(dir).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 86400000) await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function cancelAll() {
  for (const id of [...jobs.keys()]) cancel(id);
}

module.exports = { models, start, write, finish, cancel, cancelAll, cleanStale };
