import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { FRAME_RATES, formatFps } from '../state/project.js';

const PRESETS = [
  { name: '4K UHD', long: 3840, short: 2160 },
  { name: 'QHD', long: 2560, short: 1440 },
  { name: 'Full HD', long: 1920, short: 1080 },
  { name: 'HD', long: 1280, short: 720 },
  { name: 'SD', long: 854, short: 480 },
];
const CUSTOM = -1;
const even = (v) => Math.max(16, Math.min(7680, Math.round(v / 2) * 2));

function initialState({ width, height, fps }) {
  const vertical = height > width;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const preset = PRESETS.findIndex((p) => p.long === long && p.short === short);
  return { vertical, preset, width, height, fps };
}

// Ventana de proyecto nuevo y de propiedades del proyecto (mode: 'startup' | 'new' | 'edit').
export default function ProjectDialog({ mode, initial, onAccept, onCancel }) {
  const [state, setState] = useState(() => initialState(initial));
  const { vertical, preset, fps } = state;

  let width = state.width;
  let height = state.height;
  if (preset !== CUSTOM) {
    const p = PRESETS[preset];
    width = vertical ? p.short : p.long;
    height = vertical ? p.long : p.short;
  }
  const valid = width >= 16 && height >= 16;

  const accept = () => valid && onAccept({ width: even(width), height: even(height), fps });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && !['SELECT', 'BUTTON'].includes(e.target.tagName)) accept();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const setOrientation = (v) => {
    if (v === vertical) return;
    // En personalizada se intercambian ancho y alto.
    setState((s) => ({ ...s, vertical: v, width: s.height, height: s.width }));
  };

  const box = vertical ? { width: 54 * (width / height), height: 54 } : { width: 96, height: 96 * (height / width) };

  return (
    <div className="modal-backdrop">
      <div className="modal project-dialog">
        <div className="modal-title">{mode === 'edit' ? 'Propiedades del proyecto' : 'Nuevo proyecto'}</div>
        <div className="modal-content">
          <div className="field-label">Orientación</div>
          <div className="orientation">
            <button className={!vertical ? 'choice active' : 'choice'} onClick={() => setOrientation(false)}>
              <Icon name="landscape" size={22} />
              Horizontal
            </button>
            <button className={vertical ? 'choice active' : 'choice'} onClick={() => setOrientation(true)}>
              <Icon name="portrait" size={22} />
              Vertical
            </button>
          </div>

          <label>
            <span className="field-label">Resolución</span>
            <select
              value={preset}
              onChange={(e) => {
                const value = Number(e.target.value);
                setState((s) => ({ ...s, preset: value, width, height }));
              }}
            >
              {PRESETS.map((p, i) => (
                <option key={p.name} value={i}>
                  {vertical ? `${p.short} × ${p.long}` : `${p.long} × ${p.short}`} ({p.name})
                </option>
              ))}
              <option value={CUSTOM}>Personalizada…</option>
            </select>
          </label>
          {preset === CUSTOM && (
            <div className="custom-size">
              <label>
                <span className="field-label">Ancho</span>
                <input
                  type="number"
                  min="16"
                  max="7680"
                  step="2"
                  value={state.width}
                  onChange={(e) => setState((s) => ({ ...s, width: Number(e.target.value) }))}
                  onBlur={() => setState((s) => ({ ...s, width: even(s.width) }))}
                />
              </label>
              <span className="times">×</span>
              <label>
                <span className="field-label">Alto</span>
                <input
                  type="number"
                  min="16"
                  max="7680"
                  step="2"
                  value={state.height}
                  onChange={(e) => setState((s) => ({ ...s, height: Number(e.target.value) }))}
                  onBlur={() => setState((s) => ({ ...s, height: even(s.height) }))}
                />
              </label>
            </div>
          )}

          <label>
            <span className="field-label">Velocidad de fotogramas</span>
            <select value={fps} onChange={(e) => setState((s) => ({ ...s, fps: Number(e.target.value) }))}>
              {FRAME_RATES.map((f) => (
                <option key={f} value={f}>
                  {formatFps(f)} fps{f === 29.97 ? ' (NTSC)' : f === 25 ? ' (PAL)' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="frame-preview">
            <div className="frame-box" style={valid ? box : undefined} />
            <div>
              <strong>{valid ? `${even(width)} × ${even(height)}` : 'Tamaño no válido'}</strong>
              <div className="note">
                {formatFps(fps)} fps · {vertical ? 'vertical' : 'horizontal'}
              </div>
            </div>
          </div>
          {mode === 'edit' && (
            <p className="note">Los cambios afectan a la vista previa y al renderizado; los eventos no se modifican.</p>
          )}
        </div>
        <div className="modal-actions">
          <button onClick={onCancel}>{mode === 'startup' ? 'Usar valores por defecto' : 'Cancelar'}</button>
          <button className="primary" onClick={accept} disabled={!valid}>
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
