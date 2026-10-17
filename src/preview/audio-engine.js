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
    if (key === this.key) {
      this.parts.forEach(({ part, fx }) => part.update(effects.find((e) => e.id === fx.id).params));
      return;
    }
    this.key = key;
    this.input.disconnect();
    for (const { part } of this.parts) part.dispose();
    this.parts = effects.map((fx) => ({ fx, part: buildAudioEffect(this.ctx, fx, info) })).filter(({ part }) => part);
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
  }

  // Reproductor para una clave (ver playerKeys en Preview) y un archivo; se crea la primera vez.
  player(key, url, startAt = 0) {
    let p = this.players.get(key);
    if (p && p.url === url) return p;
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
    source.connect(input);
    output.connect(this.ctx.destination);
    p = { el, url, source, input, output, chain: new AudioChain(this.ctx, input, output) };
    this.players.set(key, p);
    return p;
  }

  setEffects(p, effects, info) {
    p.chain.set(effects, { ...info, ready: this.ready });
  }

  // Volumen suavizado (unos milisegundos) para que los cambios fotograma a fotograma no chasqueen.
  setGain(p, value) {
    p.output.gain.setTargetAtTime(value, this.ctx.currentTime, 0.008);
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
