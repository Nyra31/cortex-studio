// Grabación de voz en off desde el micrófono. Un AudioWorklet recoge las muestras (mono, 16 bits) y las manda
// al proceso principal a trozos, que las va escribiendo en un WAV: si la grabación es larga no se acumula en
// memoria, y lo grabado queda en disco aunque algo falle a medias.
// Se abre el micrófono antes de empezar (prepare) y las muestras se guardan desde begin(), que App llama justo
// cuando arranca el reloj de reproducción: así el principio del archivo coincide con el instante de partida.

const WORKLET_SOURCE = `
class CortexRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.buf = new Int16Array(8192);
    this.n = 0;
    this.peak = 0;
    this.count = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'start') this.on = true;
      if (e.data === 'stop') {
        this.flush();
        this.on = false;
        this.port.postMessage({ done: true });
      }
    };
  }
  flush() {
    if (!this.n) return;
    const chunk = this.buf.slice(0, this.n);
    this.port.postMessage({ chunk: chunk.buffer }, [chunk.buffer]);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        const v = ch[i];
        const a = v < 0 ? -v : v;
        if (a > this.peak) this.peak = a;
        if (this.on) {
          const s = v < -1 ? -1 : v > 1 ? 1 : v;
          this.buf[this.n++] = s < 0 ? s * 32768 : s * 32767;
          if (this.n === this.buf.length) this.flush();
        }
      }
    }
    // Nivel para el medidor, unas 20 veces por segundo.
    this.count += 128;
    if (this.count >= sampleRate / 20) {
      this.port.postMessage({ level: this.peak });
      this.peak = 0;
      this.count = 0;
    }
    return true;
  }
}
registerProcessor('cortex-recorder', CortexRecorder);
`;
const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));

// Ajustes de grabación (dispositivo y procesado del navegador), recordados entre sesiones.
const STORAGE_KEY = 'cortex-record';
export function loadRecordSettings() {
  try {
    return { deviceId: '', processing: false, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    return { deviceId: '', processing: false };
  }
}
export function saveRecordSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // sin almacenamiento: no se recuerdan
  }
}

// Micrófonos disponibles (los nombres solo aparecen después de haber dado permiso una vez).
export async function listInputs() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
}

// Mensaje entendible para los errores de getUserMedia.
export function micError(err) {
  if (err?.name === 'NotAllowedError') {
    return 'Windows no deja usar el micrófono. Actívalo en Configuración > Privacidad y seguridad > Micrófono (también «Permitir que las aplicaciones de escritorio accedan al micrófono»).';
  }
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return 'No se ha encontrado ningún micrófono.';
  if (err?.name === 'NotReadableError') return 'El micrófono está ocupado por otra aplicación o no responde.';
  return `No se pudo abrir el micrófono: ${err?.message || err}`;
}

export class Recorder {
  constructor() {
    this.level = 0; // pico reciente (0…1), para el medidor
    this.state = 'idle'; // idle | ready | recording
  }

  // Abre el micrófono (con el medidor funcionando) sin guardar nada todavía.
  async open({ deviceId, processing }) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        // Para voz en off, por defecto el sonido tal cual: la cancelación de eco y la reducción de ruido del
        // navegador están pensadas para llamadas y cambian el timbre.
        echoCancellation: processing,
        noiseSuppression: processing,
        autoGainControl: processing,
        channelCount: { ideal: 1 },
      },
    });
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule(workletUrl);
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'cortex-recorder', {
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit', // estéreo → mono
      channelInterpretation: 'speakers',
    });
    this.node.port.onmessage = (e) => this.onMessage(e.data);
    this.source.connect(this.node);
    // Conectado a la salida (en silencio) para que el navegador lo procese siempre.
    this.mute = this.ctx.createGain();
    this.mute.gain.value = 0;
    this.node.connect(this.mute).connect(this.ctx.destination);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.state = 'ready';
    this.label = this.stream.getAudioTracks()[0]?.label || '';
  }

  onMessage(msg) {
    if (msg.level !== undefined) this.level = Math.max(msg.level, this.level * 0.6);
    if (msg.chunk && this.file) {
      this.samples += msg.chunk.byteLength / 2;
      window.api.recordWrite(this.file.id, msg.chunk);
    }
    if (msg.done && this.onDone) this.onDone();
  }

  // Abre el micrófono y crea el archivo de destino. projectPath: la grabación va a su carpeta.
  async prepare(settings, projectPath) {
    await this.open(settings);
    this.file = await window.api.recordStart(projectPath, this.ctx.sampleRate);
    this.samples = 0;
  }

  // Empieza a guardar muestras (en el instante en que arranca la reproducción).
  begin() {
    if (this.state !== 'ready' || !this.file) return;
    this.state = 'recording';
    this.node.port.postMessage('start');
  }

  // Retardo aproximado de lo grabado respecto a lo que se oía: lo que tarda el sonido en salir por los altavoces
  // más lo que tarda el micrófono en entregarlo. Se descuenta del principio de la grabación.
  latency() {
    const out = (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0);
    const input = this.stream.getAudioTracks()[0]?.getSettings().latency || 0;
    return Math.min(0.5, Math.max(0, out + input));
  }

  // Termina: { path, duration, latency } o null si no se llegó a grabar nada.
  async stop() {
    if (!this.file) {
      this.close();
      return null;
    }
    if (this.state === 'recording') {
      await new Promise((resolve) => {
        this.onDone = resolve;
        this.node.port.postMessage('stop');
        setTimeout(resolve, 1000); // por si el procesador ya no responde
      });
    }
    const latency = this.latency();
    const rate = this.ctx.sampleRate;
    const { file, samples } = this;
    this.file = null;
    this.close();
    const filePath = await window.api.recordStop(file.id);
    if (!filePath || !samples) return null;
    return { path: filePath, duration: samples / rate, latency };
  }

  close() {
    this.state = 'idle';
    this.level = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
  }
}
