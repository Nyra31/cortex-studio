import { useEffect, useState } from 'react';

const RESOLUTIONS = [
  { label: '3840 × 2160 (4K UHD)', width: 3840, height: 2160 },
  { label: '1920 × 1080 (Full HD)', width: 1920, height: 1080 },
  { label: '1280 × 720 (HD)', width: 1280, height: 720 },
  { label: '854 × 480', width: 854, height: 480 },
  { label: '1080 × 1920 (vertical)', width: 1080, height: 1920 },
  { label: '1080 × 1080 (cuadrado)', width: 1080, height: 1080 },
];
const FRAME_RATES = [24, 25, 30, 50, 60];
const QUALITIES = [
  { label: 'Alta', crf: 18 },
  { label: 'Normal', crf: 22 },
  { label: 'Ligera (archivo pequeño)', crf: 28 },
];

export default function RenderDialog({ payload, defaultName, onClose }) {
  const [resolution, setResolution] = useState(1);
  const [fps, setFps] = useState(30);
  const [quality, setQuality] = useState(1);
  const [phase, setPhase] = useState('settings'); // settings | rendering | done | error
  const [progress, setProgress] = useState(0);
  const [outPath, setOutPath] = useState(null);
  const [error, setError] = useState('');

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
      const { width, height } = RESOLUTIONS[resolution];
      const result = await window.api.startRender(payload, { width, height, fps, crf: QUALITIES[quality].crf }, target);
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
        <h2>Renderizar como MP4</h2>
        {phase === 'settings' && (
          <>
            <label>
              Resolución
              <select value={resolution} onChange={(e) => setResolution(Number(e.target.value))}>
                {RESOLUTIONS.map((r, i) => (
                  <option key={r.label} value={i}>{r.label}</option>
                ))}
              </select>
            </label>
            <label>
              Fotogramas por segundo
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                {FRAME_RATES.map((f) => (
                  <option key={f} value={f}>{f} fps</option>
                ))}
              </select>
            </label>
            <label>
              Calidad
              <select value={quality} onChange={(e) => setQuality(Number(e.target.value))}>
                {QUALITIES.map((q, i) => (
                  <option key={q.label} value={i}>{q.label}</option>
                ))}
              </select>
            </label>
            <p className="note">Video H.264 y audio AAC, compatible con YouTube, redes sociales y la mayoría de reproductores.</p>
            <div className="modal-actions">
              <button onClick={onClose}>Cancelar</button>
              <button className="primary" onClick={start}>Elegir destino y renderizar</button>
            </div>
          </>
        )}
        {phase === 'rendering' && (
          <>
            <p className="note">Renderizando en {outPath}</p>
            <div className="progress"><div style={{ width: `${(progress * 100).toFixed(1)}%` }} /></div>
            <p className="progress-label">{Math.floor(progress * 100)} %</p>
            <div className="modal-actions">
              <button onClick={() => window.api.cancelRender()}>Cancelar renderizado</button>
            </div>
          </>
        )}
        {phase === 'done' && (
          <>
            <p>Renderizado completado.</p>
            <p className="note">{outPath}</p>
            <div className="modal-actions">
              <button onClick={() => window.api.revealFile(outPath)}>Mostrar en la carpeta</button>
              <button className="primary" onClick={onClose}>Cerrar</button>
            </div>
          </>
        )}
        {phase === 'error' && (
          <>
            <p>No se pudo renderizar:</p>
            <pre className="error">{error}</pre>
            <div className="modal-actions">
              <button onClick={() => setPhase('settings')}>Volver</button>
              <button className="primary" onClick={onClose}>Cerrar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
