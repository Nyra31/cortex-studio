// Separación de voces en ONNX Runtime Web: con la tarjeta gráfica (WebGPU) si se puede y si no con el procesador
// (WebAssembly, mucho más lento). Dos modelos (ver MODELS en electron/separate.js), cada uno con su preparación:
//   htdemucs: Demucs v4 de Meta (MIT); pre y posprocesado de demucs-web (MIT). Entra onda + espectrograma; salen
//             las cuatro pistas (batería, bajo, otros, voces) en las dos ramas, temporal y frecuencial.
//   roformer: Mel-Band RoFormer de Kimberley Jensen (MIT), exportación de audiojs/mel-roformer. Entra el
//             espectrograma estéreo (STFT de 2048 con salto de 441, centrada, sin normalizar) y sale el de las voces.
// El resto es común: segmentos solapados con fundido cruzado, leídos a trozos y devueltos en orden.
// Mensajes: entra { model, modelUrl, inputUrl, frames } (PCM 16 bits estéreo intercalado a 44,1 kHz por media://);
// salen { type: 'backend', name }, { type: 'progress', value }, { type: 'chunk', data } (voces, float32 estéreo
// intercalado, en orden y sin huecos), { type: 'done' } y { type: 'error', message }.
import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { CONSTANTS, fft, getHannWindow, ifft, prepareModelInput, reflectPad, standaloneIspec } from 'demucs-web';

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = 1; // sin aislamiento entre orígenes no hay SharedArrayBuffer

// ---- htdemucs ----
const { TRAINING_SAMPLES: HT_SEG, MODEL_SPEC_BINS: HT_BINS, MODEL_SPEC_FRAMES: HT_FRAMES } = CONSTANTS;
const HT_VOCALS = 3; // pistas del modelo: batería, bajo, otros, voces

const htdemucs = {
  seg: HT_SEG,
  stride: Math.floor(HT_SEG * 0.75), // solapados un 25 %, con el fundido en todo el solape
  fade: HT_SEG - Math.floor(HT_SEG * 0.75),
  feeds(session, left, right) {
    const input = prepareModelInput(left, right);
    const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input.waveform, [1, 2, HT_SEG]) };
    if (session.inputNames.length > 1) feeds[session.inputNames[1]] = new ort.Tensor('float32', input.magSpec, [1, 4, HT_BINS, HT_FRAMES]);
    return feeds;
  },
  // Rama temporal + iSTFT de la rama frecuencial, solo de la pista de voces (sus cuatro planos, real e imaginario
  // de cada canal, ya están en el orden [bin][trama] que espera standaloneIspec).
  vocals(session, out) {
    let time = null;
    let freq = null;
    for (const name of session.outputNames) {
      const t = out[name];
      if (t.dims.length === 4 && t.dims[2] === 2) time = t;
      else if (t.dims.length === 5 && t.dims[2] === 4) freq = t;
    }
    if (!time) throw new Error('htdemucs: no hay salida temporal');
    const samples = time.dims[3];
    const base = HT_VOCALS * 2 * samples;
    const l = time.data.slice(base, base + samples);
    const r = time.data.slice(base + samples, base + 2 * samples);
    if (freq) {
      const n = HT_BINS * HT_FRAMES;
      const d = freq.data;
      const fb = HT_VOCALS * 4 * n;
      const spec = standaloneIspec({
        leftReal: d.subarray(fb, fb + n),
        leftImag: d.subarray(fb + n, fb + 2 * n),
        rightReal: d.subarray(fb + 2 * n, fb + 3 * n),
        rightImag: d.subarray(fb + 3 * n, fb + 4 * n),
      }, HT_SEG);
      for (let i = 0; i < samples; i++) {
        l[i] += spec.left[i];
        r[i] += spec.right[i];
      }
    }
    return { l, r };
  },
};

// ---- Mel-Band RoFormer ----
const N_FFT = 2048;
const HOP = 441;
const RF_BINS = N_FFT / 2 + 1; // 1025
const RF_SEG = 352800; // 8 s
const RF_FRAMES = RF_SEG / HOP + 1; // 801 (STFT centrada)
const PLANE = RF_BINS * RF_FRAMES;
const hann = getHannWindow(N_FFT); // periódica, como torch.hann_window
const fr = new Float32Array(N_FFT);
const fi = new Float32Array(N_FFT);
const tmp = new Float32Array(N_FFT);

// STFT de un canal a los planos `re` e `im` de `spec` ([bin][trama]).
function stftInto(x, spec, re, im) {
  const p = reflectPad(x, N_FFT / 2, N_FFT / 2);
  for (let f = 0; f < RF_FRAMES; f++) {
    const o = f * HOP;
    for (let i = 0; i < N_FFT; i++) tmp[i] = p[o + i] * hann[i];
    fft(fr, fi, tmp, N_FFT);
    for (let b = 0; b < RF_BINS; b++) {
      spec[re * PLANE + b * RF_FRAMES + f] = fr[b];
      spec[im * PLANE + b * RF_FRAMES + f] = fi[b];
    }
  }
}

// iSTFT de un canal (planos `re` e `im` de `spec`), con la normalización por la suma de ventanas de torch.istft.
function istftOf(spec, re, im) {
  const len = RF_SEG + N_FFT;
  const out = new Float32Array(len);
  const wsum = new Float32Array(len);
  const xr = new Float32Array(N_FFT);
  const xi = new Float32Array(N_FFT);
  for (let f = 0; f < RF_FRAMES; f++) {
    for (let b = 0; b < RF_BINS; b++) {
      xr[b] = spec[re * PLANE + b * RF_FRAMES + f];
      xi[b] = spec[im * PLANE + b * RF_FRAMES + f];
    }
    for (let b = 1; b < RF_BINS - 1; b++) {
      xr[N_FFT - b] = xr[b];
      xi[N_FFT - b] = -xi[b];
    }
    ifft(fr, fi, xr, xi, N_FFT);
    const o = f * HOP;
    for (let i = 0; i < N_FFT; i++) {
      out[o + i] += fr[i] * hann[i];
      wsum[o + i] += hann[i] * hann[i];
    }
  }
  const y = new Float32Array(RF_SEG);
  for (let i = 0; i < RF_SEG; i++) {
    const w = wsum[i + N_FFT / 2];
    y[i] = w > 1e-8 ? out[i + N_FFT / 2] / w : 0;
  }
  return y;
}

const roformer = {
  seg: RF_SEG,
  stride: RF_SEG / 2, // uno nuevo cada 4 s, con fundidos de 0,8 s (como la inferencia original)
  fade: 35280,
  feeds(session, left, right) {
    const spec = new Float32Array(4 * PLANE); // L re, L im, R re, R im
    stftInto(left, spec, 0, 1);
    stftInto(right, spec, 2, 3);
    return { [session.inputNames[0]]: new ort.Tensor('float32', spec, [1, 4, RF_BINS, RF_FRAMES]) };
  },
  vocals(session, out) {
    const spec = out[session.outputNames[0]].data;
    return { l: istftOf(spec, 0, 1), r: istftOf(spec, 2, 3) };
  },
};

const ENGINES = { htdemucs, roformer };

async function createSession(modelUrl) {
  const model = await (await fetch(modelUrl)).arrayBuffer();
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const session = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
      return { session, backend: 'webgpu' };
    } catch {
      // sin un adaptador válido o sin memoria suficiente: con el procesador
    }
  }
  const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return { session, backend: 'wasm' };
}

// Entradas del modelo para el segmento [start, start + count) del PCM (con ceros detrás hasta el tamaño del segmento).
async function prepare(engine, session, url, start, count) {
  const res = await fetch(url, { headers: { Range: `bytes=${start * 4}-${(start + count) * 4 - 1}` } });
  const pcm = new Int16Array(await res.arrayBuffer());
  const left = new Float32Array(engine.seg);
  const right = new Float32Array(engine.seg);
  for (let i = 0; i < count; i++) {
    left[i] = pcm[2 * i] / 32768;
    right[i] = pcm[2 * i + 1] / 32768;
  }
  return engine.feeds(session, left, right);
}

async function separate({ model, modelUrl, inputUrl, frames }) {
  const engine = ENGINES[model];
  if (!engine) throw new Error(`Modelo desconocido: ${model}`);
  const { seg: SEG, stride: STRIDE, fade: FADE } = engine;
  const { session, backend } = await createSession(modelUrl);
  postMessage({ type: 'backend', name: backend });
  // Acumuladores del segmento actual (empiezan en `start`): suma ponderada y peso.
  const accL = new Float32Array(SEG);
  const accR = new Float32Array(SEG);
  const weight = new Float32Array(SEG);
  let feeds = await prepare(engine, session, inputUrl, 0, Math.min(SEG, frames));
  for (let start = 0; start < frames; start += STRIDE) {
    const count = Math.min(SEG, frames - start);
    const first = start === 0;
    const last = start + SEG >= frames;
    // Mientras la tarjeta calcula este segmento, se prepara el siguiente.
    const running = session.run(feeds);
    const nextStart = start + STRIDE;
    feeds = last ? null : await prepare(engine, session, inputUrl, nextStart, Math.min(SEG, frames - nextStart));
    const out = await running;
    const { l, r } = engine.vocals(session, out);
    for (const t of Object.values(out)) t.dispose?.();
    for (let i = 0; i < count; i++) {
      let w = 1;
      if (!first && i < FADE) w = Math.min(w, (i + 1) / (FADE + 1));
      if (!last && i >= SEG - FADE) w = Math.min(w, (SEG - i) / (FADE + 1));
      accL[i] += l[i] * w;
      accR[i] += r[i] * w;
      weight[i] += w;
    }
    // Lo que ya no va a tocar ningún segmento más está terminado.
    const done = last ? count : STRIDE;
    const chunk = new Float32Array(done * 2);
    for (let i = 0; i < done; i++) {
      const w = weight[i] || 1;
      chunk[2 * i] = accL[i] / w;
      chunk[2 * i + 1] = accR[i] / w;
    }
    postMessage({ type: 'chunk', data: chunk }, [chunk.buffer]);
    postMessage({ type: 'progress', value: Math.min(1, (start + done) / frames) });
    if (last) break;
    for (const a of [accL, accR, weight]) {
      a.copyWithin(0, STRIDE);
      a.fill(0, SEG - STRIDE);
    }
  }
  await session.release();
  postMessage({ type: 'done' });
}

onmessage = (e) => {
  separate(e.data).catch((err) => postMessage({ type: 'error', message: err?.message || String(err) }));
};
