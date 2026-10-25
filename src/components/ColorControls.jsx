import { useRef, useState } from 'react';
import { curveString, curveTable, parseCurve } from '../state/effects.js';
import { tx } from '../i18n/index.js';

// Rueda de color (corrector de tres vías): el punto marca hacia qué color se lleva el tramo y cuánto. Arrastrar lo
// mueve (Mayús: más fino); doble clic vuelve al centro. onChange(x, y, record): record = primer cambio del arrastre.
export function ColorWheel({ x, y, onChange, size = 96 }) {
  const ref = useRef(null);
  const R = size / 2;
  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = ref.current.getBoundingClientRect();
    let first = true;
    let last = { x, y, cx: e.clientX, cy: e.clientY };
    const set = (me) => {
      let nx;
      let ny;
      if (me.shiftKey) {
        nx = last.x + (me.clientX - last.cx) / R / 5;
        ny = last.y - (me.clientY - last.cy) / R / 5;
      } else {
        nx = (me.clientX - rect.left - R) / R;
        ny = -(me.clientY - rect.top - R) / R;
      }
      const r = Math.hypot(nx, ny);
      if (r > 1) {
        nx /= r;
        ny /= r;
      }
      last = { x: nx, y: ny, cx: me.clientX, cy: me.clientY };
      onChange(Math.round(nx * 100) / 100, Math.round(ny * 100) / 100, first);
      first = false;
    };
    set(e);
    const up = () => {
      window.removeEventListener('pointermove', set);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', set);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      ref={ref}
      className="color-wheel"
      style={{ width: size, height: size }}
      onPointerDown={down}
      onDoubleClick={() => onChange(0, 0, true)}
      title={tx('Arrastra hacia un color (Mayús: más fino); doble clic: sin cambio')}
    >
      <span className="color-wheel-dot" style={{ left: R + x * R, top: R - y * R }} />
    </div>
  );
}

// Editor de curvas (Todos, R, G, B): doble clic en un sitio libre añade un punto; los puntos se arrastran (los de los
// extremos, solo en vertical); doble clic en un punto lo quita. values: { master, red, green, blue } en «x/y x/y …».
const CHANNELS = [
  { id: 'master', label: tx('Todos'), color: '#e8e8e8' },
  { id: 'red', label: 'R', color: '#ff6b6b' },
  { id: 'green', label: 'G', color: '#6bdc6b' },
  { id: 'blue', label: 'B', color: '#6b9bff' },
];
export function CurveEditor({ values, onChange, size = 200 }) {
  const [channel, setChannel] = useState('master');
  const ref = useRef(null);
  const pts = parseCurve(values[channel]);
  const toPx = (p) => [p.x * size, (1 - p.y) * size];
  const fromEvent = (e) => {
    const r = ref.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / size)), y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / size)) };
  };
  const commit = (list, record) => onChange(channel, curveString([...list].sort((a, b) => a.x - b.x)), record);
  const startDrag = (e, index) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    let first = true;
    const move = (me) => {
      const q = fromEvent(me);
      const list = pts.map((p, i) => {
        if (i !== index) return p;
        const edge = i === 0 || i === pts.length - 1;
        const lo = i > 0 ? pts[i - 1].x + 0.01 : 0;
        const hi = i < pts.length - 1 ? pts[i + 1].x - 0.01 : 1;
        return { x: edge ? p.x : Math.min(hi, Math.max(lo, q.x)), y: q.y };
      });
      commit(list, first);
      first = false;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const table = curveTable(values[channel], 101);
  const line = [...table].map((v, i) => `${(i / 100) * size},${(1 - v) * size}`).join(' ');
  const color = CHANNELS.find((c) => c.id === channel).color;
  return (
    <div className="curve-editor">
      <div className="curve-tabs">
        {CHANNELS.map((c) => (
          <button key={c.id} className={`text-toggle${channel === c.id ? ' active' : ''}`} onClick={() => setChannel(c.id)} style={{ color: c.color }}>
            {c.label}
          </button>
        ))}
        <button className="text-toggle wide" title={tx('Volver a la línea recta')} onClick={() => onChange(channel, '0/0 1/1', true)}>{tx('Recta')}</button>
      </div>
      <svg
        ref={ref}
        className="curve-area"
        width={size}
        height={size}
        onDoubleClick={(e) => {
          const q = fromEvent(e);
          if (pts.some((p) => Math.abs(p.x - q.x) < 0.02)) return;
          commit([...pts, q], true);
        }}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f} className="curve-grid">
            <line x1={f * size} y1={0} x2={f * size} y2={size} />
            <line x1={0} y1={f * size} x2={size} y2={f * size} />
          </g>
        ))}
        <line className="curve-diagonal" x1={0} y1={size} x2={size} y2={0} />
        <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} />
        {pts.map((p, i) => {
          const [cx, cy] = toPx(p);
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={5}
              className="curve-point"
              onPointerDown={(e) => startDrag(e, i)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (i > 0 && i < pts.length - 1) commit(pts.filter((_, k) => k !== i), true);
              }}
            >
              <title>{`${Math.round(p.x * 255)} → ${Math.round(p.y * 255)} (doble clic: quitar)`}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
