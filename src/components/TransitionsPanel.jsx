import { useEffect, useRef, useState } from 'react';
import { TRANSITION_GROUPS, TRANSITION_MIME, TRANSITIONS } from '../state/transitions.js';
import { Compositor } from '../preview/compositor.js';
import { tx } from '../i18n/index.js';

const THUMB_W = 112;
const THUMB_H = 63;
const SAMPLE = { width: 160, height: 90 };
const ALL = tx('Todas');
const STILL = { circlecrop: 0.85, rectcrop: 0.85 };

// Imágenes de ejemplo A (sale) y B (entra) para las miniaturas.
function sampleImage(letter, from, to) {
  const c = document.createElement('canvas');
  c.width = SAMPLE.width;
  c.height = SAMPLE.height;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, c.width, c.height);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.font = 'bold 54px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, c.width / 2, c.height / 2 + 3);
  return c;
}

// Un único compositor WebGL para todas las miniaturas: dibuja y se copia al lienzo de cada una.
let renderer = null;
function getRenderer() {
  if (renderer !== null) return renderer;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    renderer = {
      canvas,
      compositor: new Compositor(canvas, { preserveDrawingBuffer: true }),
      a: sampleImage('A', '#1f4f9c', '#5d9be8'),
      b: sampleImage('B', '#a8501c', '#f0a860'),
    };
  } catch {
    renderer = false;
  }
  return renderer;
}

function drawThumb(target, type, progress) {
  const r = getRenderer();
  if (!r) return;
  r.compositor.render(SAMPLE, [{ a: r.a, b: r.b, type, progress }]);
  const ctx = target.getContext('2d');
  ctx.drawImage(r.canvas, 0, 0, target.width, target.height);
}

function TransitionTile({ item }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(false);

  // Quieta hacia la mitad de la transición (las de "por negro" antes, cuando aún se ve A);
  // al pasar el ratón se reproduce en bucle.
  useEffect(() => {
    const canvas = ref.current;
    if (!hover) {
      drawThumb(canvas, item.index, STILL[item.id] ?? 0.6);
      return undefined;
    }
    let raf;
    const t0 = performance.now();
    const loop = (now) => {
      const cycle = ((now - t0) / 1500) % 1.4; // 1 s de transición y una pausa sobre B
      drawThumb(canvas, item.index, Math.max(0, 1 - cycle));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [hover, item.index]);

  return (
    <div
      className="transition-item"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TRANSITION_MIME, item.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={tx('{group}: {name}\nArrastra sobre el solapamiento de dos eventos de video', { group: item.group, name: item.name })}
    >
      <canvas ref={ref} width={THUMB_W} height={THUMB_H} />
      <div className="transition-name">{item.name}</div>
    </div>
  );
}

export default function TransitionsPanel() {
  const [group, setGroup] = useState(ALL);
  const items = [...TRANSITIONS.values()].filter((t) => group === ALL || t.group === group);

  return (
    <div className="transitions-panel">
      <div className="dock-toolbar">
        <span className="dock-toolbar-label">
         {tx('Arrastra una transición al solapamiento de dos eventos de video (doble clic en él: volver a disolución cruzada)')}
        </span>
      </div>
      <div className="transitions-body">
        <div className="transition-groups">
          {[ALL, ...TRANSITION_GROUPS.map((g) => g.name)].map((name) => (
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
            <TransitionTile key={item.id} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}
