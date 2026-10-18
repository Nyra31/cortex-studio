import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { TEXT_DEFAULTS, TEXT_FONTS } from '../state/text.js';

const pct = (v) => `${Math.round(v * 100)} %`;

// Ventana flotante para editar un medio de texto (como «Títulos y texto» de VEGAS). La posición no está
// aquí: el texto se mueve (y se cambia de tamaño) con el ratón en la vista previa. Los cambios se ven
// al momento en la vista previa; cada arrastre de un control (o cada vez que se escribe en el cuadro de
// texto tras entrar en él) es un solo paso de deshacer. height: alto del proyecto, para mostrar el tamaño en px.
export default function TextDialog({ media, height, onChange, onClose }) {
  const t = { ...TEXT_DEFAULTS, ...media.text };
  const [pos, setPos] = useState({ x: 16, y: 110 });
  const first = useRef(true);
  const area = useRef(null);

  useEffect(() => {
    area.current?.focus();
    area.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.target.closest?.('input, select, textarea')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (changes, record = true) => onChange((cur) => ({ ...cur, ...changes }), record);
  // Controles que cambian sin parar mientras se arrastran: solo el primer cambio crea un paso de deshacer.
  const live = (id) => ({
    onPointerDown: () => (first.current = true),
    onKeyDown: () => (first.current = true),
    onFocus: () => (first.current = true),
    onChange: (e) => {
      const value = e.target.type === 'range' ? Number(e.target.value) : e.target.value;
      set({ [id]: value }, first.current);
      first.current = false;
    },
  });

  const range = (id, label, min, max, step, format) => (
    <label className="fx-param">
      <span className="fx-param-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={t[id]}
        {...live(id)}
        onDoubleClick={() => set({ [id]: TEXT_DEFAULTS[id] })}
        title="Doble clic: valor por defecto"
      />
      <span className="fx-param-value">{format(t[id])}</span>
    </label>
  );

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

  return (
    <div className="fx-window text-window" style={{ left: pos.x, top: pos.y }}>
      <div className="fx-title" onPointerDown={startDrag}>
        <span>Títulos y texto: {media.name}</span>
        <button className="track-btn" title="Cerrar (Esc)" onClick={onClose}>
          <Icon name="close" size={11} />
        </button>
      </div>
      <div className="fx-params">
        <textarea
          ref={area}
          className="text-input"
          rows={3}
          value={t.text}
          spellCheck={false}
          onFocus={() => (first.current = true)}
          onChange={(e) => {
            set({ text: e.target.value }, first.current);
            first.current = false;
          }}
          onKeyDown={(e) => {
            e.stopPropagation(); // que las teclas no lleguen a los atajos del editor
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
        />

        <div className="text-row">
          <input
            className="text-font"
            list="cortex-fonts"
            value={t.font}
            title="Fuente (puedes escribir el nombre de cualquier fuente instalada)"
            {...live('font')}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <datalist id="cortex-fonts">
            {TEXT_FONTS.map((f) => <option key={f} value={f} />)}
          </datalist>
          <button className={`text-toggle${t.bold ? ' active' : ''}`} title="Negrita" onClick={() => set({ bold: !t.bold })}>
            <b>N</b>
          </button>
          <button className={`text-toggle${t.italic ? ' active' : ''}`} title="Cursiva" onClick={() => set({ italic: !t.italic })}>
            <i>K</i>
          </button>
          <input type="color" title="Color del texto" value={t.color} {...live('color')} />
        </div>

        <div className="text-row">
          <span className="fx-param-label">Alineación</span>
          {[['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']].map(([id, label]) => (
            <button key={id} className={`text-toggle wide${t.align === id ? ' active' : ''}`} onClick={() => set({ align: id })}>
              {label}
            </button>
          ))}
        </div>

        {range('size', 'Tamaño', 0.02, 0.4, 0.002, (v) => `${Math.round(v * height)} px`)}

        {range('lineSpacing', 'Interlineado', 0.7, 3, 0.05, (v) => v.toFixed(2).replace('.', ','))}
        {range('tracking', 'Espaciado', -0.1, 0.5, 0.005, pct)}

        <div className="text-section">Contorno</div>
        <div className="text-row">
          {range('outline', 'Grosor', 0, 0.2, 0.005, pct)}
          <input type="color" title="Color del contorno" value={t.outlineColor} {...live('outlineColor')} />
        </div>

        <div className="text-section">
          <label>
            <input type="checkbox" checked={t.shadow} onChange={(e) => set({ shadow: e.target.checked })} /> Sombra
          </label>
          <input type="color" title="Color de la sombra" value={t.shadowColor} {...live('shadowColor')} />
        </div>
        {t.shadow && (
          <>
            {range('shadowOffset', 'Distancia', 0, 0.3, 0.005, pct)}
            {range('shadowBlur', 'Desenfoque', 0, 0.6, 0.01, pct)}
          </>
        )}

        <div className="text-section">Fondo</div>
        <div className="text-row">
          {range('backgroundOpacity', 'Opacidad', 0, 1, 0.01, pct)}
          <input type="color" title="Color del fondo" value={t.background} {...live('background')} />
        </div>
        <div className="text-actions">
          <button onClick={() => onChange(() => ({ ...TEXT_DEFAULTS, text: t.text, x: t.x, y: t.y }), true)}>Restablecer estilo</button>
        </div>
      </div>
    </div>
  );
}
