import { useRef } from 'react';
import { MAX_SCALE, MIN_SCALE, NO_CROP } from '../state/pan.js';
import { tx } from '../i18n/index.js';

const SNAP_PX = 6; // el centro se pega al centro del cuadro (Mayús: sin ajuste)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Capa sobre la vista previa para la panorámica del evento con su ventana abierta (en pausa): el recuadro
// de la imagen (ya recortada) en su posición, escala y giro actuales. Arrastrar dentro la mueve, las esquinas
// cambian el zoom y el círculo de arriba la gira (Mayús: de 15 en 15°). Mismas fórmulas que state/pan.js:
// el punto q de la imagen (px del cuadro desde su centro) va a P + S·R·q.
// values: { x, y, scale, rotation } en el cursor; fit: { w, h } de la imagen encajada en px del proyecto;
// width/height: tamaño del proyecto. onChange(changes, record).
export default function PanOverlay({ values, crop = NO_CROP, fit, width: W, height: H, onChange }) {
  const ref = useRef(null);
  const { x, y, scale: S, rotation } = values;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const P = [x * W, y * H];
  const toFrame = ([qx, qy]) => [P[0] + S * (qx * cos - qy * sin), P[1] + S * (qx * sin + qy * cos)];
  const l = -fit.w / 2 + crop.left * fit.w;
  const r = fit.w / 2 - crop.right * fit.w;
  const t = -fit.h / 2 + crop.top * fit.h;
  const b = fit.h / 2 - crop.bottom * fit.h;
  const corners = [[l, t], [r, t], [r, b], [l, b]].map(toFrame);
  // El círculo de giro, por encima del borde de arriba (a un 7 % del alto del cuadro, sin escalar).
  const topMid = toFrame([(l + r) / 2, t]);
  const rotHandle = [topMid[0] + sin * H * 0.07, topMid[1] - cos * H * 0.07];
  const pctPos = ([px, py]) => ({ left: `${(px / W) * 100}%`, top: `${(py / H) * 100}%` });

  // Puntero → px del proyecto (la capa tiene la proporción del cuadro).
  const frameAt = (rect, e) => [((e.clientX - rect.left) / rect.width) * W, ((e.clientY - rect.top) / rect.height) * H];

  const drag = (e, update) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = ref.current.getBoundingClientRect();
    const p0 = frameAt(rect, e);
    let first = true;
    const move = (me) => {
      const changes = update(frameAt(rect, me), p0, rect, me);
      if (!changes) return;
      onChange(changes, first);
      first = false;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onMove = (e) => drag(e, (p, p0, rect, me) => {
    let nx = x + (p[0] - p0[0]) / W;
    let ny = y + (p[1] - p0[1]) / H;
    if (!me.shiftKey && Math.abs(nx - 0.5) * rect.width < SNAP_PX) nx = 0.5;
    if (!me.shiftKey && Math.abs(ny - 0.5) * rect.height < SNAP_PX) ny = 0.5;
    return { x: nx, y: ny };
  });

  const onScale = (e) => drag(e, (p, p0) => {
    const d0 = Math.hypot(p0[0] - P[0], p0[1] - P[1]) || 1;
    const d = Math.hypot(p[0] - P[0], p[1] - P[1]);
    return { scale: Math.round(clamp((S * d) / d0, MIN_SCALE, MAX_SCALE) * 1000) / 1000 };
  });

  const onRotate = (e) => drag(e, (p, p0, rect, me) => {
    const a0 = Math.atan2(p0[1] - P[1], p0[0] - P[0]);
    const a = Math.atan2(p[1] - P[1], p[0] - P[0]);
    let v = rotation + ((a - a0) * 180) / Math.PI;
    v = ((((v + 180) % 360) + 360) % 360) - 180;
    if (me.shiftKey) v = Math.round(v / 15) * 15;
    else if (Math.abs(v - Math.round(v / 90) * 90) < 2) v = Math.round(v / 90) * 90; // se pega a 0°, ±90° y 180°
    return { rotation: Math.round(v * 10) / 10 };
  });

  return (
    <div ref={ref} className="pan-overlay">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <polygon
          className="pan-box"
          points={corners.map((c) => c.join(',')).join(' ')}
          onPointerDown={onMove}
        />
        <line className="pan-rot-line" x1={topMid[0]} y1={topMid[1]} x2={rotHandle[0]} y2={rotHandle[1]} />
        <line className="pan-center" x1={P[0] - W * 0.012} y1={P[1]} x2={P[0] + W * 0.012} y2={P[1]} />
        <line className="pan-center" x1={P[0]} y1={P[1] - W * 0.012} x2={P[0]} y2={P[1] + W * 0.012} />
      </svg>
      {corners.map((c, i) => (
        <div key={i} className="pan-handle" style={pctPos(c)} onPointerDown={onScale} title={tx('Arrastra para cambiar el zoom')} />
      ))}
      <div className="pan-handle rotate" style={pctPos(rotHandle)} onPointerDown={onRotate} title={tx('Arrastra para girar (Mayús: de 15 en 15°)')} />
    </div>
  );
}
