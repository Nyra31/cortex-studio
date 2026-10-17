import { useEffect, useRef, useState } from 'react';
import { EFFECT_GROUPS, EFFECT_MIME, EFFECTS, activeEffects, effectDefaults } from '../state/effects.js';
import { Compositor } from '../preview/compositor.js';

const THUMB_W = 112;
const THUMB_H = 63;
const SAMPLE = { width: 320, height: 180 };
const ALL = 'Todos';

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

function EffectTile({ item }) {
  const ref = useRef(null);
  useEffect(() => {
    const r = getRenderer();
    if (!r) return;
    const effects = activeEffects([{ type: item.id, params: { ...effectDefaults(item.id), ...item.sample } }]);
    r.compositor.render(SAMPLE, [{ a: r.sample, opacity: 1, fxA: effects }]);
    const ctx = ref.current.getContext('2d');
    ctx.drawImage(r.canvas, 0, 0, ref.current.width, ref.current.height);
  }, [item]);

  return (
    <div
      className="transition-item"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(EFFECT_MIME, item.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={`${item.group}: ${item.name}\nArrastra sobre un evento de video para añadírselo`}
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
};

export default function EffectsPanel() {
  const [group, setGroup] = useState(ALL);
  const items = [...EFFECTS.values()]
    .filter((fx) => group === ALL || fx.group === group)
    .map((fx) => ({ ...fx, sample: THUMB_PARAMS[fx.id] }));

  return (
    <div className="transitions-panel">
      <div className="dock-toolbar">
        <span className="dock-toolbar-label">
          Arrastra un efecto sobre un evento de video, o pulsa el botón «fx» del evento para ver y ajustar sus efectos
        </span>
      </div>
      <div className="transitions-body">
        <div className="transition-groups">
          {[ALL, ...EFFECT_GROUPS.map((g) => g.name)].map((name) => (
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
