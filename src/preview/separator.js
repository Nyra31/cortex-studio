// Quitar las voces de un trozo de medio (ver electron/separate.js y separator.worker.js). Devuelve
// { rest, vocals, backend } con las rutas de los dos FLAC (sin voces y solo las voces) o null si se canceló.
// onStatus recibe { stage: 'model' | 'decode' | 'load' | 'separate', percent, backend }.
import { mediaUrl } from '../util/time.js';

const api = window.api;

export async function separateVoices(filePath, start, length, projectPath, modelId, onStatus, cancelRef) {
  const off = api.onSeparateProgress(onStatus);
  let job;
  try {
    job = await api.separateStart(filePath, start, length, modelId);
  } finally {
    off();
  }
  if (cancelRef.canceled) {
    api.separateCancel(job.id);
    return null;
  }
  onStatus({ stage: 'load', percent: null });
  const worker = new Worker(new URL('./separator.worker.js', import.meta.url), { type: 'module' });
  let backend = null;
  const ok = await new Promise((resolve, reject) => {
    cancelRef.cancel = () => {
      worker.terminate();
      resolve(false);
    };
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'backend') backend = m.name;
      else if (m.type === 'chunk') api.separateWrite(job.id, m.data.buffer);
      else if (m.type === 'progress') onStatus({ stage: 'separate', percent: m.value * 100, backend });
      else if (m.type === 'done') resolve(true);
      else if (m.type === 'error') reject(new Error(m.message));
    };
    worker.onerror = (e) => reject(new Error(e.message || 'worker'));
    worker.postMessage({ model: job.engine, modelUrl: mediaUrl(job.model), inputUrl: mediaUrl(job.input), frames: job.frames });
  }).finally(() => {
    worker.terminate();
    cancelRef.cancel = null;
  }).catch(async (err) => {
    await api.separateCancel(job.id);
    throw err;
  });
  if (!ok) {
    await api.separateCancel(job.id);
    return null;
  }
  const files = await api.separateFinish(job.id, filePath, projectPath);
  return { ...files, backend };
}
