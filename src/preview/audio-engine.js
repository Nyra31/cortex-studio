// Audio de la vista previa con Web Audio: cada reproductor (<audio>) pasa por la cadena de efectos de su
// evento y por un control de volumen (pista × evento × fundidos) antes de llegar a los altavoces. Así los
// efectos se oyen al momento y el volumen puede pasar de 0 dB.
import { buildAudioEffect, loadWorklets } from './audio-fx.js';

// Cadena de efectos entre dos nodos. Solo se rehace si cambia la lista de efectos (cuáles y en qué orden);
// si solo cambian los valores, se actualizan sin cortar el sonido.
export class AudioChain {
  constructor(ctx, input, output) {
    this.ctx = ctx;
    this.input = input;
    this.output = output;
    this.key = null;
    this.parts = [];
    input.connect(output);
  }

  set(effects, info) {
    const key = `${effects.map((fx) => `${fx.id}:${fx.type}`).join('|')}#${info.peak ?? ''}#${info.ready ? 1 : 0}`;
    // Se llama en cada fotograma: solo se tocan los efectos cuyos valores han cambiado de verdad
    // (algunos rehacen curvas o envían mensajes a su procesador al actualizarse).
    if (key === this.key) {
      for (const p of this.parts) {
        const params = effects.find((e) => e.id === p.fx.id).params;
        const values = JSON.stringify(params);
        if (values === p.values) continue;
        p.values = values;
        p.part.update(params);
      }
      return;
    }
    this.key = key;
    this.input.disconnect();
    for (const { part } of this.parts) part.dispose();
    this.parts = effects
      .map((fx) => ({ fx, values: JSON.stringify(fx.params), part: buildAudioEffect(this.ctx, fx, info) }))
      .filter(({ part }) => part);
    let node = this.input;
    for (const { part } of this.parts) {
      node.connect(part.input);
      node = part.output;
    }
    node.connect(this.output);
  }

  dispose() {
    this.input.disconnect();
    for (const { part } of this.parts) part.dispose();
    this.parts = [];
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ready = false; // procesadores propios (puerta de ruido, cambio de tono) cargados
    loadWorklets(this.ctx).then(() => (this.ready = true)).catch(() => {});
    this.players = new Map();
    // Buses para los medidores: cada reproductor va al de su pista y las pistas al máster (sin cambiar el
    // sonido). Cada bus mide sus dos canales con un analizador por canal.
    this.master = this.measured(this.ctx.destination);
    this.buses = new Map(); // id de pista → bus
  }

  measured(destination) {
    const gain = this.ctx.createGain();
    gain.channelCount = 2;
    gain.channelCountMode = 'explicit';
    gain.connect(destination);
    const splitter = this.ctx.createChannelSplitter(2);
    gain.connect(splitter);
    const analysers = [0, 1].map((c) => {
      const a = this.ctx.createAnalyser();
      a.fftSize = 1024;
      splitter.connect(a, c);
      return a;
    });
    return { gain, analysers, data: new Float32Array(1024) };
  }

  bus(trackId) {
    if (!this.buses.has(trackId)) this.buses.set(trackId, this.measured(this.master.gain));
    return this.buses.get(trackId);
  }

  // Picos recientes (unos 20 ms) del máster y de cada pista: { master: [l, r], tracks: Map(id → [l, r]) }.
  levels() {
    const peak = (b) => b.analysers.map((a) => {
      a.getFloatTimeDomainData(b.data);
      let m = 0;
      for (let i = 0; i < b.data.length; i++) {
        const v = Math.abs(b.data[i]);
        if (v > m) m = v;
      }
      return m;
    });
    const tracks = new Map();
    for (const [id, b] of this.buses) tracks.set(id, peak(b));
    return { master: peak(this.master), tracks };
  }

  // Reproductor para una clave (ver playerKeys en Preview) y un archivo; se crea la primera vez.
  player(key, url, startAt = 0, trackId = null) {
    let p = this.players.get(key);
    if (p && p.url === url) {
      if (p.trackId !== trackId) {
        // El evento ha cambiado de pista: el sonido va al bus de la nueva.
        p.merger.disconnect();
        p.merger.connect(this.bus(trackId).gain);
        p.trackId = trackId;
      }
      return p;
    }
    if (p) this.remove(key);
    const el = new Audio();
    el.crossOrigin = 'anonymous'; // sin esto Web Audio recibiría silencio
    el.preload = 'auto';
    el.src = url;
    el.currentTime = startAt;
    const source = this.ctx.createMediaElementSource(el);
    const input = this.ctx.createGain();
    const output = this.ctx.createGain();
    output.gain.value = 0;
    // Panorámica de la pista (ley «balance», igual que el render): una ganancia por canal. El audio se pasa
    // siempre a estéreo, para que un archivo mono suene por los dos lados.
    output.channelCount = 2;
    output.channelCountMode = 'explicit';
    output.channelInterpretation = 'speakers';
    const splitter = this.ctx.createChannelSplitter(2);
    const merger = this.ctx.createChannelMerger(2);
    const left = this.ctx.createGain();
    const right = this.ctx.createGain();
    source.connect(input);
    output.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    merger.connect(this.bus(trackId).gain);
    p = { el, url, source, input, output, left, right, merger, trackId, pan: 0, chain: new AudioChain(this.ctx, input, output) };
    this.players.set(key, p);
    return p;
  }

  setEffects(p, effects, info) {
    p.chain.set(effects, { ...info, ready: this.ready });
  }

  // Volumen suavizado (unos milisegundos) para que los cambios fotograma a fotograma no chasqueen.
  setGain(p, value) {
    if (p.gain === value) return;
    p.gain = value;
    p.output.gain.setTargetAtTime(value, this.ctx.currentTime, 0.008);
  }

  // Panorámica de −1 (izquierda) a 1 (derecha), suavizada como el volumen.
  setPan(p, value) {
    if (p.pan === value) return;
    p.pan = value;
    const now = this.ctx.currentTime;
    p.left.gain.setTargetAtTime(Math.min(1, 1 - value), now, 0.008);
    p.right.gain.setTargetAtTime(Math.min(1, 1 + value), now, 0.008);
  }

  remove(key) {
    const p = this.players.get(key);
    if (!p) return;
    p.el.pause();
    p.el.removeAttribute('src');
    p.el.load();
    p.chain.dispose();
    p.source.disconnect();
    p.output.disconnect();
    p.merger.disconnect();
    this.players.delete(key);
  }

  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  close() {
    for (const key of [...this.players.keys()]) this.remove(key);
    this.ctx.close().catch(() => {});
  }
}

// Procesa un sonido sin reproducirlo, con la misma cadena que la vista previa. Lo usan las pruebas
// automáticas para comparar la vista previa con el render (window.cortexPruebas).
export async function renderOfflineAudio(channels, sampleRate, effects, info = {}) {
  const ctx = new OfflineAudioContext(2, channels[0].length, sampleRate);
  await loadWorklets(ctx);
  const buffer = ctx.createBuffer(2, channels[0].length, sampleRate);
  channels.forEach((data, c) => buffer.copyToChannel(data, c));
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const input = ctx.createGain();
  const output = ctx.createGain();
  src.connect(input);
  output.connect(ctx.destination);
  new AudioChain(ctx, input, output).set(effects, { ...info, ready: true });
  src.start();
  const result = await ctx.startRendering();
  return [result.getChannelData(0), result.getChannelData(1)];
}
