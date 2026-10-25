import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import {
  MAX_SCALE, MIN_SCALE, NO_CROP, addKeyframe, keyframeAt, moveKeyframe, newPan, panAt, removeKeyframe, setPanValues,
} from '../state/pan.js';
import { point, tx } from '../i18n/index.js';

const pct = (v) => `${Math.round(v * 100)} %`;
const deg = (v) => `${point(Math.round(v * 10) / 10)}°`;

// Ventana de panorámica/recorte del evento (como en VEGAS). Arriba, la tira de fotogramas clave del evento
// (clic: llevar el cursor ahí; arrastrar un rombo: cambiarlo de momento); debajo, los valores en el cursor.
// Con varios fotogramas clave, cambiar un valor donde no hay ninguno crea uno nuevo ahí.
// La imagen también se mueve, se escala y se gira con el ratón en la vista previa (PanOverlay).
// time: cursor; fill: escala con la que la imagen llena todo el cuadro (sin bandas).
export default function PanDialog({ event, mediaName, fps, time, fill, onChange, onSeek, onClose }) {
  const [pos, setPos] = useState({ x: 16, y: 110 });
  const first = useRef(true);
  const stripRef = useRef(null);
  const pan = event.pan || newPan();
  const local = Math.min(event.duration, Math.max(0, time - event.start));
  const values = panAt(pan, local);
  const crop = pan.crop || NO_CROP;
  const kfs = pan.keyframes;
  const at = keyframeAt(pan, local, fps);
  const segment = [...kfs.keys()].reverse().find((i) => kfs[i].t <= local + 0.5 / fps) ?? 0; // tramo del cursor

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.target.closest?.('input, select, textarea')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const change = (fn, record = true) => onChange((cur) => fn(cur || newPan()), record);
  const setValues = (changes, record) => change((p) => setPanValues(p, local, changes, fps), record);
  const live = (apply) => ({
    onPointerDown: () => (first.current = true),
    onKeyDown: () => (first.current = true),
    onChange: (e) => {
      apply(Number(e.target.value), first.current);
      first.current = false;
    },
  });

  const range = (label, value, min, max, step, format, apply, reset) => (
    <label key={label} className="fx-param">
      <span className="fx-param-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} {...live(apply)} onDoubleClick={reset} title={tx('Doble clic: valor por defecto')} />
      <span className="fx-param-value">{format}</span>
    </label>
  );

  // Tira de fotogramas clave: clic para mover el cursor; arrastrar un rombo lo cambia de momento.
  const stripTime = (clientX) => {
    const r = stripRef.current.getBoundingClientRect();
    return Math.min(event.duration, Math.max(0, ((clientX - r.left) / r.width) * event.duration));
  };
  const onStripDown = (e) => {
    if (e.button !== 0) return;
    onSeek(event.start + stripTime(e.clientX));
  };
  const onKeyframeDown = (e, index) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSeek(event.start + kfs[index].t);
    const startX = e.clientX;
    let moved = false;
    const move = (me) => {
      if (!moved && Math.abs(me.clientX - startX) < 3) return;
      const t = Math.round(stripTime(me.clientX) * fps) / fps;
      change((p) => moveKeyframe(p, index, t, event.duration), !moved);
      moved = true;
      onSeek(event.start + t);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const jump = (dir) => {
    const list = kfs.map((k) => k.t);
    const t = dir > 0 ? list.find((x) => x > local + 1e-6) : [...list].reverse().find((x) => x < local - 1e-6);
    if (t !== undefined) onSeek(event.start + t);
  };

  const startDrag = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const dx = e.clientX - pos.x;
    const dy = e.clientY - pos.y;
    const moveWin = (me) => setPos({
      x: Math.min(window.innerWidth - 120, Math.max(0, me.clientX - dx)),
      y: Math.min(window.innerHeight - 40, Math.max(0, me.clientY - dy)),
    });
    const up = () => {
      window.removeEventListener('pointermove', moveWin);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', moveWin);
    window.addEventListener('pointerup', up);
  };

  const logScale = Math.log2(values.scale);
  return (
    <div className="fx-window pan-window" style={{ left: pos.x, top: pos.y }}>
      <div className="fx-title" onPointerDown={startDrag}>
        <span>{tx('Panorámica/recorte del evento: {mediaName}', { mediaName })}</span>
        <button className="track-btn" title={tx('Cerrar (Esc)')} onClick={onClose}>
          <Icon name="close" size={11} />
        </button>
      </div>
      <div className="fx-params">
        <div className="pan-strip" ref={stripRef} onPointerDown={onStripDown} title={tx('Clic: llevar el cursor ahí')}>
          {kfs.map((k, i) => (
            <span
              key={i}
              className={`pan-key${i === at ? ' active' : ''}`}
              style={{ left: `${(k.t / event.duration) * 100}%` }}
              title={tx('Fotograma clave (arrastra para moverlo)')}
              onPointerDown={(e) => onKeyframeDown(e, i)}
            />
          ))}
          {time >= event.start && time <= event.start + event.duration && (
            <span className="pan-cursor" style={{ left: `${(local / event.duration) * 100}%` }} />
          )}
        </div>
        <div className="text-row pan-keys">
          <button title={tx('Fotograma clave anterior')} onClick={() => jump(-1)} disabled={!kfs.some((k) => k.t < local - 1e-6)}>◀</button>
          <button title={tx('Fotograma clave siguiente')} onClick={() => jump(1)} disabled={!kfs.some((k) => k.t > local + 1e-6)}>▶</button>
          <button onClick={() => change((p) => addKeyframe(p, local))} disabled={at >= 0}>{tx('+ Fotograma clave')}</button>
          <button onClick={() => change((p) => removeKeyframe(p, at))} disabled={at < 0 || kfs.length < 2}>{tx('Quitar')}</button>
          <label className="pan-smooth" title={tx('El movimiento desde este fotograma clave acelera y frena (si no, es uniforme)')}>
            <input
              type="checkbox"
              checked={!!kfs[segment]?.smooth}
              disabled={kfs.length < 2}
              onChange={(e) => change((p) => ({ ...p, keyframes: p.keyframes.map((k, i) => (i === segment ? { ...k, smooth: e.target.checked } : k)) }))}
            />
           {tx('Suave')}
          </label>
        </div>
        <p className="pan-hint">
          {tx('{n} En la vista previa: arrastra la imagen para moverla, las esquinas para el zoom y el círculo para girarla.', { n: kfs.length < 2
            ? tx('Sin animación: los valores valen para todo el evento. Para animarlo, añade fotogramas clave en otros momentos.')
            : tx('{length} fotogramas clave. Al cambiar un valor donde no hay ninguno, se crea uno nuevo.', { length: kfs.length }) })}
        </p>

        {range(tx('Horizontal'), values.x, -0.5, 1.5, 0.001, pct(values.x), (v, r) => setValues({ x: v }, r), () => setValues({ x: 0.5 }, true))}
        {range(tx('Vertical'), values.y, -0.5, 1.5, 0.001, pct(values.y), (v, r) => setValues({ y: v }, r), () => setValues({ y: 0.5 }, true))}
        {range(tx('Zoom'), logScale, Math.log2(MIN_SCALE), Math.log2(MAX_SCALE), 0.01, pct(values.scale),
          (v, r) => setValues({ scale: Math.round(2 ** v * 1000) / 1000 }, r), () => setValues({ scale: 1 }, true))}
        {range(tx('Rotación'), values.rotation, -180, 180, 0.5, deg(values.rotation), (v, r) => setValues({ rotation: v }, r), () => setValues({ rotation: 0 }, true))}
        <div className="text-row">
          <button className="text-toggle wide" onClick={() => setValues({ x: 0.5, y: 0.5, scale: 1, rotation: 0 }, true)}>
           {tx('Encajar en el cuadro')}
          </button>
          <button className="text-toggle wide" onClick={() => setValues({ x: 0.5, y: 0.5, scale: Math.round(fill * 1000) / 1000, rotation: 0 }, true)} disabled={!fill}>
           {tx('Llenar el cuadro')}
          </button>
        </div>

        <div className="text-section">{tx('Recorte (para todo el evento)')}</div>
        {['left', 'right', 'top', 'bottom'].map((side) => range(
          { left: tx('Izquierda'), right: tx('Derecha'), top: tx('Arriba'), bottom: tx('Abajo') }[side],
          crop[side], 0, 0.45, 0.001, pct(crop[side]),
          (v, r) => change((p) => ({ ...p, crop: { ...NO_CROP, ...p.crop, [side]: v } }), r),
          () => change((p) => ({ ...p, crop: { ...NO_CROP, ...p.crop, [side]: 0 } })),
        ))}
        <div className="text-actions">
          <button onClick={() => onChange(() => null, true)}>{tx('Quitar panorámica y recorte')}</button>
        </div>
      </div>
    </div>
  );
}
