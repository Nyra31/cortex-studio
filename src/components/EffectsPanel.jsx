import { useEffect, useRef, useState } from 'react';
import { EFFECT_MIME, EFFECTS, activeEffects, effectDefaults, effectGroups } from '../state/effects.js';
import { Compositor } from '../preview/compositor.js';
import { renderOfflineAudio } from '../preview/audio-engine.js';
import { tx } from '../i18n/index.js';

const THUMB_W = 112;
const THUMB_H = 63;
const SAMPLE = { width: 320, height: 180 };
const ALL = tx('Todos');

// Imagen de ejemplo para las miniaturas: cielo, sol, colinas, un recuadro verde (para el croma) y texto.
function sampleImage() {
  const c = document.createElement('canvas');
  c.width = SAMPLE.width;
  c.height = SAMPLE.height;
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, '#2a6fd6');
  sky.addColorStop(0.6, '#f2a35e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#ffe27a';
  ctx.beginPath();
  ctx.arc(230, 70, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2f6b3a';
  ctx.beginPath();
  ctx.moveTo(0, 150);
  ctx.quadraticCurveTo(90, 95, 190, 140);
  ctx.quadraticCurveTo(260, 165, 320, 120);
  ctx.lineTo(320, 180);
  ctx.lineTo(0, 180);
  ctx.fill();
  ctx.fillStyle = '#00ff00';
  ctx.fillRect(20, 20, 70, 50);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 30px Segoe UI, sans-serif';
  ctx.fillText('Cortex', 110, 160);
  return c;
}

// Un único compositor WebGL para todas las miniaturas: dibuja y se copia al lienzo de cada una.
let renderer = null;
function getRenderer() {
  if (renderer !== null) return renderer;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_W * 2;
    canvas.height = THUMB_H * 2;
    renderer = { canvas, compositor: new Compositor(canvas, { preserveDrawingBuffer: true }), sample: sampleImage() };
  } catch {
    renderer = false;
  }
  return renderer;
}

// Sonido de ejemplo para las miniaturas de audio: dos notas que se apagan (0,8 s a 24 kHz).
const AUDIO_RATE = 24000;
function sampleSound() {
  const n = Math.round(0.8 * AUDIO_RATE);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / AUDIO_RATE;
    const local = t % 0.4;
    data[i] = 0.6 * Math.exp(-7 * local) * (Math.sin(2 * Math.PI * 330 * t) + 0.35 * Math.sin(2 * Math.PI * 2100 * t));
  }
  return data;
}

// Forma de onda (envolvente por columnas) del sonido original, en gris, y del procesado, encima.
function drawWave(canvas, original, processed) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.fillStyle = '#151515';
  ctx.fillRect(0, 0, w, h);
  const column = (data, x) => {
    const per = data.length / w;
    let max = 0;
    for (let i = Math.floor(x * per); i < Math.floor((x + 1) * per); i++) max = Math.max(max, Math.abs(data[i]));
    return Math.min(1, max) * (h / 2 - 2);
  };
  for (const [data, color] of [[original, '#4a4a4a'], [processed, '#e0a030']]) {
    ctx.fillStyle = color;
    for (let x = 0; x < w; x++) {
      const a = column(data, x);
      ctx.fillRect(x, h / 2 - a, 1, Math.max(1, a * 2));
    }
  }
}

// Miniaturas ya dibujadas (id del efecto → promesa de un lienzo). Se calculan una sola vez por sesión:
// si se rehicieran en cada redibujado del panel (que ocurre en cada fotograma al reproducir), el editor
// iría a tirones, sobre todo las de audio, que procesan su sonido de ejemplo.
const thumbnails = new Map();
function thumbnail(item) {
  if (thumbnails.has(item.id)) return thumbnails.get(item.id);
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  const effects = activeEffects([{ type: item.id, params: { ...effectDefaults(item.id), ...THUMB_PARAMS[item.id] } }]);
  let promise;
  if (item.kind === 'audio') {
    const sound = sampleSound();
    promise = renderOfflineAudio([sound, sound], AUDIO_RATE, effects, { peak: 0.6 }).then(([left]) => {
      drawWave(canvas, sound, left);
      return canvas;
    });
  } else {
    const r = getRenderer();
    if (r) {
      r.compositor.render(SAMPLE, [{ a: r.sample, opacity: 1, fxA: effects }]);
      canvas.getContext('2d').drawImage(r.canvas, 0, 0, THUMB_W, THUMB_H);
    }
    promise = Promise.resolve(r ? canvas : null);
  }
  promise = promise.catch(() => null);
  thumbnails.set(item.id, promise);
  return promise;
}

function EffectTile({ item }) {
  const ref = useRef(null);
  useEffect(() => {
    let alive = true;
    thumbnail(item).then((canvas) => alive && canvas && ref.current.getContext('2d').drawImage(canvas, 0, 0));
    return () => {
      alive = false;
    };
  }, [item.id]);

  return (
    <div
      className="transition-item"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(EFFECT_MIME, item.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={tx('{group}: {name}\nArrastra sobre un evento de {n} para añadírselo', { group: item.group, name: item.name, n: item.kind === 'audio' ? 'audio' : 'video' })}
    >
      <canvas ref={ref} width={THUMB_W} height={THUMB_H} />
      <div className="transition-name">{item.name}</div>
    </div>
  );
}

// Valores con los que se ve cada efecto en su miniatura (los que por defecto no cambian la imagen).
const THUMB_PARAMS = {
  brightness: { brightness: 0.15, contrast: 0.5 },
  colorcorrect: { red: 1.3, blue: 0.7 },
  hsl: { hue: 120 },
  blur: { horizontal: 0.7, vertical: 0.7 },
  sharpen: { amount: 1 },
  glow: { threshold: 0.5, intensity: 1, radius: 0.6 },
  graphiceq: { g250: 12, g2k: -12 },
  lowpass: { frequency: 500 },
  highpass: { frequency: 1500 },
  compressor: { threshold: -24, ratio: 10 },
  gate: { threshold: -20 },
  echo: { delay: 120, feedback: 0.6 },
  distortion: { drive: 12, output: 0 },
  reverb: { decay: 1, mix: 0.6 },
};

// kind: 'video' o 'audio'. El grupo elegido se recuerda por tipo mientras la app está abierta.
const chosenGroup = { video: ALL, audio: ALL };

export default function EffectsPanel({ kind = 'video' }) {
  const [group, setGroupState] = useState(chosenGroup[kind]);
  const setGroup = (g) => {
    chosenGroup[kind] = g;
    setGroupState(g);
  };
  const items = [...EFFECTS.values()].filter((fx) => fx.kind === kind && (group === ALL || fx.group === group));

  return (
    <div className="transitions-panel">
      <div className="dock-toolbar">
        <span className="dock-toolbar-label">
         {tx('Arrastra un efecto sobre un evento de {n}, o pulsa el botón «fx» del evento para ver y ajustar sus efectos', { n: kind === 'audio' ? 'audio' : 'video' })}
        </span>
      </div>
      <div className="transitions-body">
        <div className="transition-groups">
          {[ALL, ...effectGroups(kind).map((g) => g.name)].map((name) => (
            <div
              key={name}
              className={`transition-group${group === name ? ' active' : ''}`}
              onClick={() => setGroup(name)}
            >
              {name}
            </div>
          ))}
        </div>
        <div className="transition-grid">
          {items.map((item) => (
            <EffectTile key={item.id} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}
