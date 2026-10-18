import { useEffect, useState } from 'react';
import { formatFps } from '../state/project.js';
import { formatTimecode } from '../util/time.js';

const SCALES = [
  { label: 'Tamaño del proyecto (100 %)', factor: 1 },
  { label: '75 %', factor: 0.75 },
  { label: '50 %', factor: 0.5 },
];
const QUALITIES = [
  { label: 'Alta', crf: 18 },
  { label: 'Normal', crf: 22 },
  { label: 'Ligera (archivo pequeño)', crf: 28 },
];
const even = (v) => Math.max(2, Math.round(v / 2) * 2);

// makePayload(size, range): datos para el proceso principal, calculados para el tamaño final (los efectos
// y los textos dependen de él); range = tramo a renderizar o null. region: selección de tiempo ({ start, end })
// o null; regions: regiones con nombre del proyecto (se pueden renderizar una a una).
export default function RenderDialog({ makePayload, settings, region, regions = [], projectLength, defaultName, onClose }) {
  // Qué renderizar: 'all', 'selection' o el id de una región. Como en VEGAS: con selección, se ofrece esa parte.
  const [what, setWhat] = useState(region ? 'selection' : 'all');
  const range = what === 'all' ? null : what === 'selection' ? region : regions.find((r) => r.id === what) || null;
  const [scale, setScale] = useState(0);
  const [quality, setQuality] = useState(1);
  const [phase, setPhase] = useState('settings'); // settings | rendering | done | error
  const [progress, setProgress] = useState(0);
  const [outPath, setOutPath] = useState(null);
  const [error, setError] = useState('');

  const width = even(settings.width * SCALES[scale].factor);
  const height = even(settings.height * SCALES[scale].factor);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && phase !== 'rendering') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  async function start() {
    const target = await window.api.pickRenderPath(defaultName);
    if (!target) return;
    setOutPath(target);
    setProgress(0);
    setPhase('rendering');
    const off = window.api.onRenderProgress(setProgress);
    try {
      const result = await window.api.startRender(
        makePayload({ width, height }, range ? { start: range.start, end: range.end } : null),
        { width, height, fps: settings.fps, crf: QUALITIES[quality].crf },
        target,
      );
      if (result.ok) setPhase('done');
      else if (result.canceled) setPhase('settings');
      else {
        setError(result.error || 'Error desconocido');
        setPhase('error');
      }
    } finally {
      off();
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">Renderizar como MP4</div>
        <div className="modal-content">
          {phase === 'settings' && (
            <>
              <div className="render-summary">
                <div>Formato: <strong>MP4 (H.264 + AAC)</strong></div>
                <div>Tamaño: <strong>{width} × {height}</strong></div>
                <div>Velocidad: <strong>{formatFps(settings.fps)} fps</strong></div>
                <div>
                  Duración:{' '}
                  <strong>{formatTimecode(range ? range.end - range.start : projectLength, settings.fps)}</strong>
                </div>
              </div>
              <div className="render-range">
                <span className="field-label">Qué renderizar</span>
                <label>
                  <input type="radio" checked={what === 'all'} onChange={() => setWhat('all')} />
                  Todo el proyecto
                </label>
                <label className={region ? '' : 'disabled'}>
                  <input type="radio" checked={what === 'selection'} disabled={!region} onChange={() => setWhat('selection')} />
                  {region
                    ? `Solo la selección de tiempo (${formatTimecode(region.start, settings.fps)} – ${formatTimecode(region.end, settings.fps)})`
                    : 'Solo la selección de tiempo (no hay ninguna: arrástrala en la barra de arriba de la regla)'}
                </label>
                {regions.map((r) => (
                  <label key={r.id}>
                    <input type="radio" checked={what === r.id} onChange={() => setWhat(r.id)} />
                    {`Región ${r.number}${r.name ? ` «${r.name}»` : ''} (${formatTimecode(r.start, settings.fps)} – ${formatTimecode(r.end, settings.fps)})`}
                  </label>
                ))}
              </div>
              <label>
                <span className="field-label">Tamaño de salida</span>
                <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                  {SCALES.map((s, i) => (
                    <option key={s.label} value={i}>{s.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">Calidad</span>
                <select value={quality} onChange={(e) => setQuality(Number(e.target.value))}>
                  {QUALITIES.map((q, i) => (
                    <option key={q.label} value={i}>{q.label}</option>
                  ))}
                </select>
              </label>
              <p className="note">La resolución y la velocidad salen de las propiedades del proyecto (Alt+Intro).</p>
            </>
          )}
          {phase === 'rendering' && (
            <>
              <p className="note">Renderizando en {outPath}</p>
              <div className="progress"><div style={{ width: `${(progress * 100).toFixed(1)}%` }} /></div>
              <p className="progress-label">{Math.floor(progress * 100)} %</p>
            </>
          )}
          {phase === 'done' && (
            <>
              <p>Renderizado completado.</p>
              <p className="note">{outPath}</p>
            </>
          )}
          {phase === 'error' && (
            <>
              <p>No se pudo renderizar:</p>
              <pre className="error">{error}</pre>
            </>
          )}
        </div>
        <div className="modal-actions">
          {phase === 'settings' && (
            <>
              <button onClick={onClose}>Cancelar</button>
              <button className="primary" onClick={start}>Elegir destino y renderizar</button>
            </>
          )}
          {phase === 'rendering' && <button onClick={() => window.api.cancelRender()}>Cancelar renderizado</button>}
          {phase === 'done' && (
            <>
              <button onClick={() => window.api.revealFile(outPath)}>Mostrar en la carpeta</button>
              <button className="primary" onClick={onClose}>Cerrar</button>
            </>
          )}
          {phase === 'error' && (
            <>
              <button onClick={() => setPhase('settings')}>Volver</button>
              <button className="primary" onClick={onClose}>Cerrar</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
