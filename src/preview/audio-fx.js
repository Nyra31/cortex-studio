// Efectos de audio en la vista previa con Web Audio. Cada efecto de state/audio-effects.js se monta como
// un trozo de grafo { input, output, update(params), dispose() } que imita al filtro de FFmpeg del render:
// los filtros y el ecualizador son los mismos biquad, el eco usa los mismos ecos sucesivos, la distorsión la
// misma curva y la reverberación una respuesta al impulso con la misma forma. La puerta de ruido y el cambio
// de tono no tienen nodo propio, y el compresor de Web Audio no se parece al de FFmpeg: los tres se hacen
// con un AudioWorklet (WORKLET_SOURCE).
import { EQ_BANDS, echoTaps, normalizeGain, reverbShape } from '../state/audio-effects.js';

const dbToGain = (v) => 10 ** (v / 20);

// Procesadores propios. Se cargan desde un Blob (funciona igual en desarrollo y en la app instalada).
export const WORKLET_SOURCE = `
// Puerta de ruido como agate de FFmpeg (detección de pico, coeficientes de ataque y liberación iguales):
// por debajo del umbral, ganancia (nivel/umbral)^(proporción−1), sin bajar de 'range'.
class CortexGate extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.p = options.processorOptions;
    this.env = 0;
    this.port.onmessage = (e) => { this.p = e.data; };
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!inp.length) return true;
    const { threshold, attack, release, ratio, range } = this.p;
    const ac = Math.min(1, 1 / ((attack * sampleRate) / 4000));
    const rc = Math.min(1, 1 / ((release * sampleRate) / 4000));
    for (let i = 0; i < inp[0].length; i++) {
      let level = 0;
      for (let c = 0; c < inp.length; c++) level += Math.abs(inp[c][i]);
      level /= inp.length;
      this.env += (level - this.env) * (level > this.env ? ac : rc);
      const g = this.env >= threshold ? 1 : Math.max(range, Math.pow(this.env / threshold, ratio - 1));
      for (let c = 0; c < out.length; c++) out[c][i] = (inp[c] || inp[0])[i] * g;
    }
    return true;
  }
}
registerProcessor('cortex-gate', CortexGate);

// Compresor como acompressor de FFmpeg: detección RMS (media de canales al cuadrado), los mismos
// coeficientes de ataque y liberación, rodilla suave con interpolación de Hermite y ganancia de salida.
// (El DynamicsCompressorNode de Web Audio añade ganancia automática y suena muy distinto.)
function hermite(x, x0, x1, p0, p1, m0, m1) {
  const width = x1 - x0;
  const t = (x - x0) / width;
  m0 *= width;
  m1 *= width;
  const ct2 = -3 * p0 - 2 * m0 + 3 * p1 - m1;
  const ct3 = 2 * p0 + m0 - 2 * p1 + m1;
  return ct3 * t * t * t + ct2 * t * t + m0 * t + p0;
}
class CortexCompressor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.p = options.processorOptions;
    this.env = 0;
    this.port.onmessage = (e) => { this.p = e.data; };
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!inp.length) return true;
    const { threshold, ratio, attack, release, makeup, knee } = this.p;
    const ac = Math.min(1, 1 / ((attack * sampleRate) / 4000));
    const rc = Math.min(1, 1 / ((release * sampleRate) / 4000));
    const thres = Math.log(threshold);
    const kneeStart = Math.log(threshold / Math.sqrt(knee));
    const kneeStop = Math.log(threshold * Math.sqrt(knee));
    const linKneeStart = (threshold / Math.sqrt(knee)) ** 2;
    const compressedKneeStop = (kneeStop - thres) / ratio + thres;
    for (let i = 0; i < inp[0].length; i++) {
      let level = 0;
      for (let c = 0; c < inp.length; c++) level += Math.abs(inp[c][i]);
      level /= inp.length;
      level *= level;
      this.env += (level - this.env) * (level > this.env ? ac : rc);
      let g = 1;
      if (this.env > 0 && this.env > linKneeStart) {
        const slope = 0.5 * Math.log(this.env);
        let gain = (slope - thres) / ratio + thres;
        if (knee > 1 && slope < kneeStop) gain = hermite(slope, kneeStart, kneeStop, kneeStart, compressedKneeStop, 1, 1 / ratio);
        g = Math.exp(gain - slope);
      }
      for (let c = 0; c < out.length; c++) out[c][i] = (inp[c] || inp[0])[i] * g * makeup;
    }
    return true;
  }
}
registerProcessor('cortex-compressor', CortexCompressor);

// Cambio de tono sin cambiar la duración: dos lecturas de una línea de retardo que se desplazan a otra
// velocidad, con ventanas cruzadas (desplazador de tono clásico por retardo variable).
class CortexPitch extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = options.processorOptions.ratio;
    this.size = 8192;
    this.window = Math.round(0.06 * sampleRate);
    this.buf = [new Float32Array(this.size), new Float32Array(this.size)];
    this.w = 0;
    this.phase = 0;
    this.port.onmessage = (e) => { this.ratio = e.data.ratio; };
  }
  read(ch, delay) {
    const pos = this.w - delay;
    const i = Math.floor(pos);
    const f = pos - i;
    const b = this.buf[ch];
    const a = b[(i + this.size) % this.size], c = b[(i + 1 + this.size) % this.size];
    return a + (c - a) * f;
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!inp.length) return true;
    const step = (1 - this.ratio) / this.window;
    for (let i = 0; i < inp[0].length; i++) {
      for (let c = 0; c < 2; c++) this.buf[c][this.w] = (inp[c] || inp[0])[i];
      for (let c = 0; c < out.length; c++) {
        let v = 0;
        for (let k = 0; k < 2; k++) {
          const ph = (this.phase + k * 0.5) % 1;
          const s = Math.sin(Math.PI * ph);
          v += this.read(c, 1 + ph * this.window) * s * s;
        }
        out[c][i] = v;
      }
      this.phase = (this.phase + step + 1) % 1;
      this.w = (this.w + 1) % this.size;
    }
    return true;
  }
}
registerProcessor('cortex-pitch', CortexPitch);
`;

const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
const loaded = new WeakMap();
// Carga los procesadores en el contexto (una vez por contexto).
export function loadWorklets(ctx) {
  if (!loaded.has(ctx)) loaded.set(ctx, ctx.audioWorklet.addModule(workletUrl));
  return loaded.get(ctx);
}

// Generador pseudoaleatorio con semilla, para que la reverberación suene siempre igual.
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function reverbBuffer(ctx, decay) {
  const { a } = reverbShape(decay, ctx.sampleRate);
  const length = Math.max(1, Math.round(decay * ctx.sampleRate));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const rnd = random(c + 1);
    const data = buffer.getChannelData(c);
    let energy = 0;
    for (let i = 0; i < length; i++) {
      data[i] = (rnd() * 2 - 1) * Math.exp((-a * i) / ctx.sampleRate);
      energy += data[i] * data[i];
    }
    const k = 1 / Math.sqrt(energy); // energía 1, como el render
    for (let i = 0; i < length; i++) data[i] *= k;
  }
  return buffer;
}

const gain = (ctx, v = 1) => {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
};

// Trozo de grafo que solo cambia el volumen.
const gainFx = (ctx, value) => {
  const g = gain(ctx, value);
  return { input: g, output: g, update: () => {}, nodes: [g] };
};

const BUILDERS = {
  graphiceq: (ctx, p) => {
    const filters = EQ_BANDS.map((f) => {
      const b = ctx.createBiquadFilter();
      b.type = 'peaking';
      b.frequency.value = f;
      b.Q.value = Math.SQRT2; // una octava de ancho, como equalizer=t=o:w=1
      return b;
    });
    filters.reduce((a, b) => (a.connect(b), b));
    const update = (q) => EQ_BANDS.forEach((f, i) => (filters[i].gain.value = q[`g${f >= 1000 ? `${f / 1000}k` : f}`]));
    update(p);
    return { input: filters[0], output: filters.at(-1), update, nodes: filters };
  },
  lowpass: (ctx, p) => biquad(ctx, 'lowpass', p),
  highpass: (ctx, p) => biquad(ctx, 'highpass', p),
  compressor: (ctx, p) => {
    const opts = (q) => ({
      threshold: Math.max(0.000977, dbToGain(q.threshold)),
      ratio: q.ratio,
      attack: q.attack,
      release: q.release,
      makeup: dbToGain(q.makeup),
      knee: 2.82843,
    });
    const node = new AudioWorkletNode(ctx, 'cortex-compressor', { outputChannelCount: [2], processorOptions: opts(p) });
    return { input: node, output: node, update: (q) => node.port.postMessage(opts(q)), nodes: [node] };
  },
  gate: (ctx, p) => {
    const opts = (q) => ({ threshold: dbToGain(q.threshold), attack: q.attack, release: q.release, ratio: 10, range: 0.001 });
    const node = new AudioWorkletNode(ctx, 'cortex-gate', { outputChannelCount: [2], processorOptions: opts(p) });
    return { input: node, output: node, update: (q) => node.port.postMessage(opts(q)), nodes: [node] };
  },
  normalize: (ctx, p, info) => {
    const fx = gainFx(ctx, normalizeGain(info.peak, p.target));
    fx.update = (q) => (fx.input.gain.value = normalizeGain(info.peak, q.target));
    return fx;
  },
  amplify: (ctx, p) => {
    const fx = gainFx(ctx, dbToGain(p.gain));
    fx.update = (q) => (fx.input.gain.value = dbToGain(q.gain));
    return fx;
  },
  echo: (ctx, p) => {
    const input = gain(ctx);
    const output = gain(ctx);
    input.connect(output);
    const taps = Array.from({ length: 20 }, () => {
      const d = ctx.createDelay(90);
      const g = gain(ctx, 0);
      input.connect(d).connect(g).connect(output);
      return { d, g };
    });
    const update = (q) => {
      const list = echoTaps(q);
      taps.forEach((t, i) => {
        t.d.delayTime.value = list[i] ? list[i].delay / 1000 : 0;
        t.g.gain.value = list[i] ? list[i].gain : 0;
      });
    };
    update(p);
    return { input, output, update, nodes: [input, output, ...taps.flatMap((t) => [t.d, t.g])] };
  },
  // chorus: seco + una copia retrasada entre retardo y retardo+profundidad (senoidal), todo × 1/(1+mezcla).
  chorus: (ctx, p) => {
    const input = gain(ctx);
    const output = gain(ctx);
    const delay = ctx.createDelay(1);
    const wet = gain(ctx);
    const lfo = ctx.createOscillator();
    const depth = gain(ctx);
    input.connect(output);
    input.connect(delay).connect(wet).connect(output);
    lfo.connect(depth).connect(delay.delayTime);
    lfo.start();
    const update = (q) => {
      const og = 1 / (1 + q.mix);
      input.gain.value = 1;
      output.gain.value = og;
      wet.gain.value = q.mix;
      delay.delayTime.value = (q.delay + q.depth / 2) / 1000;
      depth.gain.value = q.depth / 2000;
      lfo.frequency.value = q.speed;
    };
    update(p);
    return { input, output, update, nodes: [input, output, delay, wet, depth, lfo] };
  },
  // flanger: retardo corto modulado con realimentación, mezclado con la señal seca.
  flanger: (ctx, p) => {
    const input = gain(ctx);
    const output = gain(ctx);
    const dry = gain(ctx);
    const delay = ctx.createDelay(0.05);
    const feedback = gain(ctx);
    const wet = gain(ctx);
    const lfo = ctx.createOscillator();
    const depth = gain(ctx);
    input.connect(dry).connect(output);
    input.connect(delay).connect(wet).connect(output);
    delay.connect(feedback).connect(delay);
    lfo.connect(depth).connect(delay.delayTime);
    lfo.start();
    const update = (q) => {
      const w = q.width / 100;
      const fb = q.regen / 100;
      dry.gain.value = 1 / (1 + w);
      wet.gain.value = (w / (1 + w)) * (1 - Math.abs(fb));
      feedback.gain.value = fb;
      delay.delayTime.value = Math.max(0.0001, q.depth / 2000);
      depth.gain.value = q.depth / 2000;
      lfo.frequency.value = q.speed;
    };
    update(p);
    return { input, output, update, nodes: [input, output, dry, delay, feedback, wet, depth, lfo] };
  },
  pitch: (ctx, p) => {
    const node = new AudioWorkletNode(ctx, 'cortex-pitch', { outputChannelCount: [2], processorOptions: { ratio: 2 ** (p.semitones / 12) } });
    return { input: node, output: node, update: (q) => node.port.postMessage({ ratio: 2 ** (q.semitones / 12) }), nodes: [node] };
  },
  // Misma curva que aeval: tanh(x·saturación) / tanh(saturación), y después el nivel de salida.
  distortion: (ctx, p) => {
    const shaper = ctx.createWaveShaper();
    const out = gain(ctx);
    shaper.connect(out);
    const update = (q) => {
      const curve = new Float32Array(4096);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * q.drive) / Math.tanh(q.drive);
      }
      shaper.curve = curve;
      out.gain.value = dbToGain(q.output);
    };
    update(p);
    return { input: shaper, output: out, update, nodes: [shaper, out] };
  },
  reverb: (ctx, p) => {
    const input = gain(ctx);
    const output = gain(ctx);
    const dry = gain(ctx);
    const wet = gain(ctx);
    const conv = ctx.createConvolver();
    conv.normalize = false;
    input.connect(dry).connect(output);
    input.connect(conv).connect(wet).connect(output);
    let decay = null;
    const update = (q) => {
      if (q.decay !== decay) {
        decay = q.decay;
        conv.buffer = reverbBuffer(ctx, decay);
      }
      dry.gain.value = 1 - q.mix;
      wet.gain.value = q.mix;
    };
    update(p);
    return { input, output, update, nodes: [input, output, dry, wet, conv] };
  },
};

// lowpass/highpass de FFmpeg (2 polos, Q = 0,707): en Web Audio la Q de estos filtros va en dB.
function biquad(ctx, type, p) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.Q.value = 20 * Math.log10(Math.SQRT1_2);
  const update = (q) => (b.frequency.value = q.frequency);
  update(p);
  return { input: b, output: b, update, nodes: [b] };
}

// Monta un efecto (con parámetros completos). info = { peak } del evento. Devuelve null si no se puede.
export function buildAudioEffect(ctx, fx, info) {
  const make = BUILDERS[fx.type];
  if (!make) return null;
  try {
    const part = make(ctx, fx.params, info);
    part.dispose = () => {
      for (const node of part.nodes) {
        try {
          node.disconnect();
          if (node.stop) node.stop();
        } catch {
          // ya estaba desconectado o parado
        }
      }
    };
    return part;
  } catch {
    return null; // por ejemplo, un AudioWorklet que aún no ha cargado
  }
}
