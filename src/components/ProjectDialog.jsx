import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { FRAME_RATES, formatFps } from '../state/project.js';
import { locale, tx } from '../i18n/index.js';

const PRESETS = [
  { name: '4K UHD', long: 3840, short: 2160 },
  { name: 'QHD', long: 2560, short: 1440 },
  { name: tx('Full HD'), long: 1920, short: 1080 },
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
const fileName = (p) => p.split(/[\\/]/).pop().replace(/\.cortex$/i, '');
const folderName = (p) => p.split(/[\\/]/).slice(0, -1).join('\\');
const when = (ms) => {
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 1) return tx('hoy, {time}', { time: new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) });
  if (days === 1) return tx('ayer');
  if (days < 7) return tx('hace {days} días', { days });
  return new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
};

// Nuevo proyecto / propiedades. En la pantalla de inicio ('startup', o 'recent' desde el menú), a la izquierda
// están los proyectos recientes (recents = [{ path, openedAt, exists, modifiedAt }] o null mientras se leen).
export default function ProjectDialog({ mode, initial, onAccept, onCancel, recents = null, onOpenRecent, onOpenOther, onRemoveRecent }) {
  const start = mode === 'startup' || mode === 'recent';
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
      if (e.key === 'Enter' && !['SELECT', 'BUTTON', 'LI'].includes(e.target.tagName)) accept();
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
      <div className={`modal project-dialog${start ? ' start-dialog' : ''}`}>
        <div className="modal-title">{mode === 'edit' ? tx('Propiedades del proyecto') : start ? 'Cortex Studio' : tx('Nuevo proyecto')}</div>
        <div className={start ? 'start-columns' : 'start-plain'}>
        {start && (
          <div className="start-recent">
            <div className="field-label">{tx('Proyectos recientes')}</div>
            {recents === null && <p className="note">{tx('Cargando…')}</p>}
            {recents?.length === 0 && <p className="note">{tx('Aún no hay ninguno. Los proyectos que abras o guardes aparecerán aquí.')}</p>}
            <ul className="recent-list">
              {recents?.map((r) => (
                <li
                  key={r.path}
                  tabIndex={0}
                  className={r.exists ? '' : 'missing'}
                  title={r.path}
                  onClick={() => r.exists && onOpenRecent(r.path)}
                  onKeyDown={(e) => e.key === 'Enter' && r.exists && onOpenRecent(r.path)}
                >
                  <div className="recent-name">{fileName(r.path)}</div>
                  <div className="note">
                    {r.exists ? `${when(r.modifiedAt || r.openedAt)} · ${folderName(r.path)}` : tx('No se encuentra (movido o borrado)')}
                  </div>
                  <button
                    className="recent-remove"
                    title={tx('Quitar de la lista (no borra el archivo)')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveRecent(r.path);
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={onOpenOther}>{tx('Abrir otro proyecto…')}</button>
          </div>
        )}
        <div className="modal-content">
          {start && <div className="field-label start-new">{tx('Nuevo proyecto')}</div>}
          <div className="field-label">{tx('Orientación')}</div>
          <div className="orientation">
            <button className={!vertical ? 'choice active' : 'choice'} onClick={() => setOrientation(false)}>
              <Icon name="landscape" size={22} />
             {tx('Horizontal')}
            </button>
            <button className={vertical ? 'choice active' : 'choice'} onClick={() => setOrientation(true)}>
              <Icon name="portrait" size={22} />
             {tx('Vertical')}
            </button>
          </div>

          <label>
            <span className="field-label">{tx('Resolución')}</span>
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
              <option value={CUSTOM}>{tx('Personalizada…')}</option>
            </select>
          </label>
          {preset === CUSTOM && (
            <div className="custom-size">
              <label>
                <span className="field-label">{tx('Ancho')}</span>
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
                <span className="field-label">{tx('Alto')}</span>
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
            <span className="field-label">{tx('Velocidad de fotogramas')}</span>
            <select value={fps} onChange={(e) => setState((s) => ({ ...s, fps: Number(e.target.value) }))}>
              {FRAME_RATES.map((f) => (
                <option key={f} value={f}>
                  {tx('{formatFps} fps{n}', { formatFps: formatFps(f), n: f === 29.97 ? ' (NTSC)' : f === 25 ? ' (PAL)' : '' })}
                </option>
              ))}
            </select>
          </label>

          <div className="frame-preview">
            <div className="frame-box" style={valid ? box : undefined} />
            <div>
              <strong>{valid ? `${even(width)} × ${even(height)}` : tx('Tamaño no válido')}</strong>
              <div className="note">
                {tx('{formatFps} fps · {n}', { formatFps: formatFps(fps), n: vertical ? tx('vertical') : tx('horizontal') })}
              </div>
            </div>
          </div>
          {mode === 'edit' && (
            <p className="note">{tx('Los cambios afectan a la vista previa y al renderizado; los eventos no se modifican.')}</p>
          )}
        </div>
        </div>
        <div className="modal-actions">
          <button onClick={onCancel}>{mode === 'startup' ? tx('Usar valores por defecto') : tx('Cancelar')}</button>
          <button className="primary" onClick={accept} disabled={!valid}>
            {start ? tx('Crear el proyecto') : tx('Aceptar')}
          </button>
        </div>
      </div>
    </div>
  );
}
