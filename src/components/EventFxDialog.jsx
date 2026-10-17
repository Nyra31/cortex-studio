import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { EFFECTS, effectDefaults, effectGroups, newEffect } from '../state/effects.js';

// Ventana flotante con los efectos de un evento (como «FX de evento» de VEGAS); kind = 'video' o 'audio'
// según la pista. Arriba la cadena (en el orden en que se aplican), abajo los controles del efecto elegido.
// Los cambios se ven (y se oyen) al momento en la vista previa; un arrastre de control es un solo paso de deshacer.
export default function EventFxDialog({ event, kind, mediaName, onChange, onClose }) {
  const effects = event.effects || [];
  const [selectedId, setSelectedId] = useState(effects[0]?.id ?? null);
  const [pos, setPos] = useState({ x: 16, y: 120 });
  const first = useRef(true); // el primer cambio de cada arrastre crea un paso de deshacer
  const selected = effects.find((fx) => fx.id === selectedId) || effects[0] || null;
  const def = selected && EFFECTS.get(selected.type);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.target.closest?.('input, select')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (fn, record = true) => onChange((list) => fn(list || []), record);
  const setParam = (id, value, record) =>
    update((list) => list.map((fx) => (fx.id === selected.id ? { ...fx, params: { ...fx.params, [id]: value } } : fx)), record);
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

  const values = selected ? { ...effectDefaults(selected.type), ...selected.params } : {};

  return (
    <div className="fx-window" style={{ left: pos.x, top: pos.y }}>
      <div className="fx-title" onPointerDown={startDrag}>
        <span>Efectos {kind === 'audio' ? 'de audio' : 'de video'} del evento: {mediaName}</span>
        <button className="track-btn" title="Cerrar (Esc)" onClick={onClose}>
          <Icon name="close" size={11} />
        </button>
      </div>

      <div className="fx-chain">
        {effects.map((fx) => (
          <div
            key={fx.id}
            className={`fx-chip${fx.id === selected?.id ? ' active' : ''}${fx.enabled === false ? ' off' : ''}`}
            onClick={() => setSelectedId(fx.id)}
            title="Clic para ver sus controles; la casilla lo activa o desactiva"
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
          title="Añadir un efecto al final de la cadena"
        >
          <option value="">+ Añadir efecto…</option>
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
              <button onClick={() => move(-1)} disabled={effects[0]?.id === selected.id} title="Aplicar antes">◀</button>
              <button onClick={() => move(1)} disabled={effects.at(-1)?.id === selected.id} title="Aplicar después">▶</button>
              <button onClick={() => update((list) => list.map((fx) => (fx.id === selected.id ? { ...fx, params: effectDefaults(fx.type) } : fx)))}>
                Restablecer
              </button>
              <button onClick={remove}>Quitar</button>
            </span>
          </div>
          {def.params.map((p) => (
            <label key={p.id} className="fx-param">
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
                    title="Doble clic: valor por defecto"
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
          ))}
        </div>
      ) : (
        <div className="fx-empty">
          Este evento no tiene efectos. Añade uno con «+ Añadir efecto…» o arrastrándolo desde la ventana
          {kind === 'audio' ? ' Efectos de audio.' : ' Efectos de video (Alt+8).'}
        </div>
      )}
    </div>
  );
}
