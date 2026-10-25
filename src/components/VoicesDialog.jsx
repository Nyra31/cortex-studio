import { useEffect, useState } from 'react';
import { tx } from '../i18n/index.js';

const STORE = 'cortex-voces';
const loadChoice = () => {
  try {
    return localStorage.getItem(STORE) || 'htdemucs';
  } catch {
    return 'htdemucs';
  }
};

// Quitar las voces: elegir el modelo de separación (ver MODELS en electron/separate.js) antes de empezar. La
// separación sigue después en la barra de estado; onStart(modelId) la lanza. Se recuerda el último elegido.
export default function VoicesDialog({ mediaName, onStart, onClose }) {
  const [models, setModels] = useState(null);
  const [choice, setChoice] = useState(loadChoice);

  useEffect(() => {
    window.api.separateModels().then(setModels).catch(() => setModels([]));
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const start = () => {
    try {
      localStorage.setItem(STORE, choice);
    } catch {
      // sin almacenamiento: no se recuerda
    }
    onStart(choice);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal voices-dialog">
        <div className="modal-title">{tx('Quitar las voces: {mediaName}', { mediaName })}</div>
        <div className="modal-content">
          <p className="note">
            {tx('Separa las voces del resto (música, efectos, ambiente) con inteligencia artificial, en este equipo. El evento se queda sin voces para doblar encima y las voces solas se añaden a los medios del proyecto.')}
          </p>
          <span className="field-label">{tx('Modelo')}</span>
          <div className="model-options">
            {(models || []).map((m) => (
              <button key={m.id} className={`choice model-option${choice === m.id ? ' active' : ''}`} onClick={() => setChoice(m.id)}>
                <strong>{m.name}</strong>
                <span>{m.description}</span>
                <span className="model-size">{m.ready ? tx('Descargado ({mb} MB)', { mb: m.mb }) : tx('Se descargará la primera vez ({mb} MB)', { mb: m.mb })}</span>
              </button>
            ))}
            {models === null && <p className="note">{tx('Cargando…')}</p>}
          </div>
          <p className="note">{tx('Con una tarjeta gráfica compatible va varias veces más rápido; sin ella se hace con el procesador, que es mucho más lento.')}</p>
        </div>
        <div className="modal-actions">
          <span className="footer-spacer" />
          <button onClick={onClose}>{tx('Cancelar')}</button>
          <button className="primary" onClick={start} disabled={!models?.some((m) => m.id === choice)}>{tx('Quitar las voces')}</button>
        </div>
      </div>
    </div>
  );
}
