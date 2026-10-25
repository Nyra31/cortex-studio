import { useEffect, useRef, useState } from 'react';
import { ColorWheel, CurveEditor } from './ColorControls.jsx';
import Icon from './Icon.jsx';
import {
  EFFECTS, addFxKey, canAnimate, effectDefaults, effectGroups, fxKeyAt, fxParamsAt, hasKeyframes, isAnimatable, moveFxKey, newEffect,
  removeFxKey, setFxValues,
} from '../state/effects.js';
import { tx } from '../i18n/index.js';

// Ventana flotante con los efectos de un evento (como «FX de evento» de VEGAS); kind = 'video' o 'audio'
// según la pista. Arriba la cadena (en el orden en que se aplican), abajo los controles del efecto elegido.
// Los cambios se ven (y se oyen) al momento en la vista previa; un arrastre de control es un solo paso de deshacer.
// Los efectos de video se pueden animar con fotogramas clave (tira como la de la panorámica): con ellos, los
// controles muestran y cambian los valores en el cursor (time); onSeek lleva el cursor a un fotograma clave.
export default function EventFxDialog({ event, kind, mediaName, fps = 30, time = 0, onSeek = () => {}, onChange, onClose }) {
  const effects = event.effects || [];
  const [selectedId, setSelectedId] = useState(effects[0]?.id ?? null);
  const [pos, setPos] = useState({ x: 16, y: 120 });
  const first = useRef(true); // el primer cambio de cada arrastre crea un paso de deshacer
  const selected = effects.find((fx) => fx.id === selectedId) || effects[0] || null;
  const def = selected && EFFECTS.get(selected.type);
  const local = Math.min(event.duration, Math.max(0, time - event.start));
  const animatable = !!def && isAnimatable(def);
  const kfs = selected?.keyframes?.length > 1 ? selected.keyframes : [];
  const at = selected ? fxKeyAt(selected, local, fps) : -1;
  const stripRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.target.closest?.('input, select')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (fn, record = true) => onChange((list) => fn(list || []), record);
  const changeSelected = (fn, record = true) => update((list) => list.map((fx) => (fx.id === selected.id ? fn(fx) : fx)), record);
  const setParam = (id, value, record) => changeSelected((fx) => setFxValues(fx, local, { [id]: value }, fps), record);

  // Tira de fotogramas clave: clic para mover el cursor; arrastrar un rombo lo cambia de momento.
  const stripTime = (clientX) => {
    const r = stripRef.current.getBoundingClientRect();
    return Math.min(event.duration, Math.max(0, ((clientX - r.left) / r.width) * event.duration));
  };
  const onKeyDown = (e, index) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSeek(event.start + kfs[index].t);
    const startX = e.clientX;
    let moved = false;
    const moveKey = (me) => {
      if (!moved && Math.abs(me.clientX - startX) < 3) return;
      const t = Math.round(stripTime(me.clientX) * fps) / fps;
      changeSelected((fx) => moveFxKey(fx, index, t, event.duration), !moved);
      moved = true;
      onSeek(event.start + t);
    };
    const up = () => {
      window.removeEventListener('pointermove', moveKey);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', moveKey);
    window.addEventListener('pointerup', up);
  };
  const jump = (dir) => {
    const list = kfs.map((k) => k.t);
    const t = dir > 0 ? list.find((x) => x > local + 1e-6) : [...list].reverse().find((x) => x < local - 1e-6);
    if (t !== undefined) onSeek(event.start + t);
  };
  const move = (dir) =>
    update((list) => {
      const i = list.findIndex((fx) => fx.id === selected.id);
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const add = (type) => {
    const fx = newEffect(type);
    update((list) => [...list, fx]);
    setSelectedId(fx.id);
  };
  const remove = () => {
    const i = effects.findIndex((fx) => fx.id === selected.id);
    update((list) => list.filter((fx) => fx.id !== selected.id));
    setSelectedId(effects[i + 1]?.id ?? effects[i - 1]?.id ?? null);
  };

  // Arrastrar la ventana por su título.
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

  const values = selected ? fxParamsAt(selected, local) : {};

  return (
    <div className="fx-window" style={{ left: pos.x, top: pos.y }}>
      <div className="fx-title" onPointerDown={startDrag}>
        <span>{tx('Efectos {n} del evento: {mediaName}', { n: kind === 'audio' ? tx('de audio') : tx('de video'), mediaName })}</span>
        <button className="track-btn" title={tx('Cerrar (Esc)')} onClick={onClose}>
          <Icon name="close" size={11} />
        </button>
      </div>

      <div className="fx-chain">
        {effects.map((fx) => (
          <div
            key={fx.id}
            className={`fx-chip${fx.id === selected?.id ? ' active' : ''}${fx.enabled === false ? ' off' : ''}`}
            onClick={() => setSelectedId(fx.id)}
            title={tx('Clic para ver sus controles; la casilla lo activa o desactiva')}
          >
            <input
              type="checkbox"
              checked={fx.enabled !== false}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => update((list) => list.map((x) => (x.id === fx.id ? { ...x, enabled: e.target.checked } : x)))}
            />
            {EFFECTS.get(fx.type)?.name ?? fx.type}
          </div>
        ))}
        <select
          className="fx-add"
          value=""
          onChange={(e) => e.target.value && add(e.target.value)}
          title={tx('Añadir un efecto al final de la cadena')}
        >
          <option value="">{tx('+ Añadir efecto…')}</option>
          {effectGroups(kind).map((g) => (
            <optgroup key={g.name} label={g.name}>
              {g.items.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {selected && def ? (
        <div className="fx-params">
          <div className="fx-params-head">
            <strong>{def.name}</strong>
            <span className="fx-buttons">
              <button onClick={() => move(-1)} disabled={effects[0]?.id === selected.id} title={tx('Aplicar antes')}>◀</button>
              <button onClick={() => move(1)} disabled={effects.at(-1)?.id === selected.id} title={tx('Aplicar después')}>▶</button>
              <button
                onClick={() => changeSelected((fx) => ({ ...fx, params: effectDefaults(fx.type), keyframes: null }))}
                title={tx('Valores por defecto (y quita la animación)')}
              >
               {tx('Restablecer')}
              </button>
              <button onClick={remove}>{tx('Quitar')}</button>
            </span>
          </div>
          {kind === 'video' && (animatable ? (
            <>
              <div className="pan-strip" ref={stripRef} onPointerDown={(e) => e.button === 0 && onSeek(event.start + stripTime(e.clientX))} title={tx('Clic: llevar el cursor ahí')}>
                {kfs.map((k, i) => (
                  <span
                    key={i}
                    className={`pan-key${i === at ? ' active' : ''}`}
                    style={{ left: `${(k.t / event.duration) * 100}%` }}
                    title={tx('Fotograma clave (arrastra para moverlo)')}
                    onPointerDown={(e) => onKeyDown(e, i)}
                  />
                ))}
                {time >= event.start && time <= event.start + event.duration && (
                  <span className="pan-cursor" style={{ left: `${(local / event.duration) * 100}%` }} />
                )}
              </div>
              <div className="text-row pan-keys">
                <button title={tx('Fotograma clave anterior')} onClick={() => jump(-1)} disabled={!kfs.some((k) => k.t < local - 1e-6)}>◀</button>
                <button title={tx('Fotograma clave siguiente')} onClick={() => jump(1)} disabled={!kfs.some((k) => k.t > local + 1e-6)}>▶</button>
                <button onClick={() => changeSelected((fx) => addFxKey(fx, local, fps))} disabled={at >= 0}>{tx('+ Fotograma clave')}</button>
                <button onClick={() => changeSelected((fx) => removeFxKey(fx, at))} disabled={at < 0 || !hasKeyframes(selected)}>{tx('Quitar')}</button>
              </div>
              <p className="pan-hint">
                {kfs.length
                  ? tx('Animado con {length} fotogramas clave: los controles muestran los valores en el cursor y, al cambiarlos donde no hay ninguno, se crea uno nuevo.', { length: kfs.length })
                  : tx('Sin animación: los valores valen para todo el evento. Para animarlo, lleva el cursor a otro momento del evento y pulsa «+ Fotograma clave».')}
              </p>
            </>
          ) : (
            <p className="pan-hint">{tx('Este efecto no se puede animar con fotogramas clave.')}</p>
          ))}
          {def.params.some((p) => p.type === 'curve') && (
            <CurveEditor
              values={values}
              onChange={(id, value, record) => setParam(id, value, record)}
            />
          )}
          {def.params.filter((p) => !p.hidden && p.type !== 'curve').map((p) => (p.wheel ? (
            <div key={p.id} className="fx-param wheel-param">
              <span className="fx-param-label">{p.label}</span>
              <ColorWheel
                x={values[p.id]}
                y={values[p.wheel]}
                onChange={(x, y, record) => changeSelected((fx) => setFxValues(fx, local, { [p.id]: x, [p.wheel]: y }, fps), record)}
              />
            </div>
          ) : p.type === 'file' ? (
            <div key={p.id} className="fx-param">
              <span className="fx-param-label">{p.label}</span>
              <button
                onClick={async () => {
                  const file = await window.api.pickLut();
                  if (file) setParam(p.id, file, true);
                }}
              >
               {tx('Elegir…')}
              </button>
              <span className="fx-param-value fx-file" title={values[p.id] || ''}>
                {values[p.id] ? values[p.id].split(/[\\/]/).pop() : 'ninguno'}
              </span>
            </div>
          ) : (
            <label key={p.id} className="fx-param" title={kfs.length && !canAnimate(def, p) ? tx('Este valor no se anima: vale para todo el evento') : undefined}>
              <span className="fx-param-label">{p.label}</span>
              {p.type === 'range' && (
                <>
                  <input
                    type="range"
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={values[p.id]}
                    onPointerDown={() => (first.current = true)}
                    onKeyDown={() => (first.current = true)}
                    onChange={(e) => {
                      setParam(p.id, Number(e.target.value), first.current);
                      first.current = false;
                    }}
                    onDoubleClick={() => setParam(p.id, p.default, true)}
                    title={tx('Doble clic: valor por defecto')}
                  />
                  <span className="fx-param-value">{p.format ? p.format(values[p.id]) : values[p.id]}</span>
                </>
              )}
              {p.type === 'bool' && (
                <input type="checkbox" checked={!!values[p.id]} onChange={(e) => setParam(p.id, e.target.checked, true)} />
              )}
              {p.type === 'color' && (
                <input
                  type="color"
                  value={values[p.id]}
                  onFocus={() => (first.current = true)}
                  onChange={(e) => {
                    setParam(p.id, e.target.value, first.current);
                    first.current = false;
                  }}
                />
              )}
            </label>
          )))}
        </div>
      ) : (
        <div className="fx-empty">
         {tx('Este evento no tiene efectos. Añade uno con «+ Añadir efecto…» o arrastrándolo desde la ventana {n}', { n: kind === 'audio' ? tx(' Efectos de audio.') : tx(' Efectos de video (Alt+8).') })}
        </div>
      )}
    </div>
  );
}
