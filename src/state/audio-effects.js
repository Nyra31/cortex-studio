// Catálogo de efectos de audio de evento, con el mismo formato que los de video (ver effects.js):
// cada efecto define sus parámetros y su filtro de FFmpeg; la vista previa los reproduce con Web Audio
// (ver preview/audio-fx.js). ctx = { peak }: pico (0–1) del fragmento de audio del evento, para Normalizar.

const n = (v) => Number(v).toFixed(4);
const ms = (v) => `${Math.round(v)} ms`;
const db = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} dB`;
const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')} kHz` : `${Math.round(v)} Hz`);
const pct = (v) => `${Math.round(v * 100)} %`;
const dbToGain = (v) => 10 ** (v / 20);

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const bandId = (f) => `g${f >= 1000 ? `${f / 1000}k` : f}`;

// Normalizar: ganancia para que el pico del fragmento llegue al nivel objetivo (como mucho +24 dB).
export const normalizeGain = (peak, target) => (peak > 0.0001 ? Math.min(dbToGain(24), dbToGain(target) / peak) : 1);

// Eco con realimentación como varios ecos sucesivos (FFmpeg aecho no realimenta): retardo k·d con
// volumen mezcla·realimentación^(k−1), hasta que queda por debajo del 1 %.
export function echoTaps(p) {
  const taps = [];
  for (let k = 1; k <= 20; k++) {
    const gain = p.mix * p.feedback ** (k - 1);
    if (gain < 0.01 || k * p.delay > 90000) break;
    taps.push({ delay: k * p.delay, gain });
  }
  return taps;
}

// Respuesta al impulso de la reverberación: ruido que decae 60 dB en `decay` segundos, normalizado a
// energía 1 para que la señal reverberada suene tan fuerte como la original.
export const reverbShape = (decay, sampleRate = 48000) => {
  const a = 6.9 / decay;
  const energy = (sampleRate / 3) * ((1 - Math.exp(-2 * a * decay)) / (2 * a));
  return { a, scale: 1 / Math.sqrt(energy) };
};

export const AUDIO_EFFECT_GROUPS = [
  {
    name: 'Ecualización',
    items: [
      {
        id: 'graphiceq',
        name: 'Ecualizador gráfico',
        params: EQ_BANDS.map((f) => ({
          id: bandId(f), label: hz(f), type: 'range', min: -12, max: 12, step: 0.5, default: 0, format: db,
        })),
        ffmpeg: (p) =>
          EQ_BANDS.filter((f) => p[bandId(f)])
            .map((f) => `equalizer=f=${f}:t=o:w=1:g=${n(p[bandId(f)])}`)
            .join(','),
      },
      {
        id: 'lowpass',
        name: 'Filtro paso bajo',
        params: [{ id: 'frequency', label: 'Frecuencia', type: 'range', min: 100, max: 20000, step: 10, default: 5000, format: hz }],
        ffmpeg: (p) => `lowpass=f=${n(p.frequency)}:p=2`,
      },
      {
        id: 'highpass',
        name: 'Filtro paso alto',
        params: [{ id: 'frequency', label: 'Frecuencia', type: 'range', min: 20, max: 5000, step: 5, default: 200, format: hz }],
        ffmpeg: (p) => `highpass=f=${n(p.frequency)}:p=2`,
      },
    ],
  },
  {
    name: 'Dinámica',
    items: [
      {
        id: 'compressor',
        name: 'Compresor',
        params: [
          { id: 'threshold', label: 'Umbral', type: 'range', min: -60, max: 0, step: 0.5, default: -20, format: db },
          { id: 'ratio', label: 'Proporción', type: 'range', min: 1, max: 20, step: 0.1, default: 4, format: (v) => `${v.toFixed(1).replace('.', ',')}:1` },
          { id: 'attack', label: 'Ataque', type: 'range', min: 1, max: 200, step: 1, default: 20, format: ms },
          { id: 'release', label: 'Liberación', type: 'range', min: 10, max: 2000, step: 10, default: 250, format: ms },
          { id: 'makeup', label: 'Ganancia', type: 'range', min: 0, max: 24, step: 0.5, default: 0, format: db },
        ],
        ffmpeg: (p) =>
          `acompressor=threshold=${n(Math.max(0.000977, dbToGain(p.threshold)))}:ratio=${n(p.ratio)}:attack=${n(p.attack)}` +
          `:release=${n(p.release)}:makeup=${n(dbToGain(p.makeup))}:knee=2.82843`,
      },
      {
        id: 'gate',
        name: 'Puerta de ruido',
        params: [
          { id: 'threshold', label: 'Umbral', type: 'range', min: -80, max: 0, step: 0.5, default: -40, format: db },
          { id: 'attack', label: 'Ataque', type: 'range', min: 1, max: 200, step: 1, default: 10, format: ms },
          { id: 'release', label: 'Liberación', type: 'range', min: 10, max: 2000, step: 10, default: 250, format: ms },
        ],
        ffmpeg: (p) =>
          `agate=threshold=${n(dbToGain(p.threshold))}:ratio=10:attack=${n(p.attack)}:release=${n(p.release)}:range=0.001:detection=peak`,
      },
      {
        id: 'normalize',
        name: 'Normalizar',
        params: [{ id: 'target', label: 'Pico objetivo', type: 'range', min: -12, max: 0, step: 0.5, default: -1, format: db }],
        ffmpeg: (p, ctx) => `volume=${n(normalizeGain(ctx.peak, p.target))}`,
      },
      {
        id: 'amplify',
        name: 'Amplificar',
        params: [{ id: 'gain', label: 'Ganancia', type: 'range', min: -24, max: 24, step: 0.5, default: 6, format: db }],
        ffmpeg: (p) => (p.gain ? `volume=${n(dbToGain(p.gain))}` : ''),
      },
    ],
  },
  {
    name: 'Retardo y modulación',
    items: [
      {
        id: 'echo',
        name: 'Eco',
        params: [
          { id: 'delay', label: 'Retardo', type: 'range', min: 20, max: 2000, step: 10, default: 300, format: ms },
          { id: 'feedback', label: 'Realimentación', type: 'range', min: 0, max: 0.9, step: 0.01, default: 0.4, format: pct },
          { id: 'mix', label: 'Volumen del eco', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, format: pct },
        ],
        ffmpeg: (p) => {
          const taps = echoTaps(p);
          if (!taps.length) return '';
          return `aecho=in_gain=1:out_gain=1:delays=${taps.map((t) => n(t.delay)).join('|')}:decays=${taps.map((t) => n(t.gain)).join('|')}`;
        },
      },
      {
        id: 'chorus',
        name: 'Chorus',
        params: [
          { id: 'delay', label: 'Retardo', type: 'range', min: 10, max: 60, step: 1, default: 40, format: ms },
          { id: 'depth', label: 'Profundidad', type: 'range', min: 0.5, max: 10, step: 0.1, default: 2, format: (v) => `${v.toFixed(1).replace('.', ',')} ms` },
          { id: 'speed', label: 'Velocidad', type: 'range', min: 0.1, max: 5, step: 0.05, default: 0.5, format: (v) => `${v.toFixed(2).replace('.', ',')} Hz` },
          { id: 'mix', label: 'Mezcla', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, format: pct },
        ],
        ffmpeg: (p) => `chorus=1:${n(1 / (1 + p.mix))}:${n(p.delay)}:${n(p.mix)}:${n(p.speed)}:${n(p.depth)}`,
      },
      {
        id: 'flanger',
        name: 'Flanger',
        params: [
          { id: 'depth', label: 'Profundidad', type: 'range', min: 0, max: 10, step: 0.1, default: 2, format: (v) => `${v.toFixed(1).replace('.', ',')} ms` },
          { id: 'speed', label: 'Velocidad', type: 'range', min: 0.1, max: 10, step: 0.05, default: 0.5, format: (v) => `${v.toFixed(2).replace('.', ',')} Hz` },
          { id: 'regen', label: 'Realimentación', type: 'range', min: -95, max: 95, step: 1, default: 50, format: (v) => `${Math.round(v)} %` },
          { id: 'width', label: 'Mezcla', type: 'range', min: 0, max: 100, step: 1, default: 71, format: (v) => `${Math.round(v)} %` },
        ],
        ffmpeg: (p) => `flanger=delay=0:depth=${n(p.depth)}:regen=${n(p.regen)}:width=${n(p.width)}:speed=${n(p.speed)}:shape=sinusoidal`,
      },
      {
        id: 'pitch',
        name: 'Cambio de tono',
        params: [{ id: 'semitones', label: 'Semitonos', type: 'range', min: -12, max: 12, step: 0.5, default: 4, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}` }],
        ffmpeg: (p) => (p.semitones ? `rubberband=pitch=${n(2 ** (p.semitones / 12))}` : ''),
      },
      {
        id: 'distortion',
        name: 'Distorsión',
        params: [
          { id: 'drive', label: 'Saturación', type: 'range', min: 1, max: 30, step: 0.5, default: 5, format: (v) => `×${v.toFixed(1).replace('.', ',')}` },
          { id: 'output', label: 'Salida', type: 'range', min: -24, max: 0, step: 0.5, default: -6, format: db },
        ],
        ffmpeg: (p) => {
          const curve = (ch) => `tanh(val(${ch})*${n(p.drive)})/${n(Math.tanh(p.drive))}`;
          return `aeval=exprs=${curve(0)}|${curve(1)}:channel_layout=stereo,volume=${n(dbToGain(p.output))}`;
        },
      },
    ],
  },
  {
    name: 'Ambiente',
    items: [
      {
        id: 'reverb',
        name: 'Reverberación',
        params: [
          { id: 'decay', label: 'Tamaño (caída)', type: 'range', min: 0.3, max: 6, step: 0.1, default: 1.8, format: (v) => `${v.toFixed(1).replace('.', ',')} s` },
          { id: 'mix', label: 'Mezcla', type: 'range', min: 0, max: 1, step: 0.01, default: 0.3, format: pct },
        ],
        // Convolución con una respuesta al impulso de ruido que decae (generada aquí mismo con aevalsrc).
        graph: (p, ctx, inL, outL, tag) => {
          if (!p.mix) return `[${inL}]anull[${outL}]`;
          const { a, scale } = reverbShape(p.decay);
          const ir = (k) => `(random(${k})*2-1)*exp(-${n(a)}*t)*${scale.toExponential(6)}`;
          return (
            `[${inL}]asplit[${tag}d][${tag}w];` +
            `aevalsrc=exprs='${ir(0)}|${ir(1)}':s=48000:d=${n(p.decay)},aformat=channel_layouts=stereo[${tag}ir];` +
            `[${tag}w][${tag}ir]afir=dry=1:wet=1:gtype=none:irfmt=input[${tag}r];` +
            `[${tag}d]volume=${n(1 - p.mix)}[${tag}dd];[${tag}r]volume=${n(p.mix)}[${tag}rr];` +
            `[${tag}dd][${tag}rr]amix=inputs=2:normalize=0[${outL}]`
          );
        },
      },
    ],
  },
];
