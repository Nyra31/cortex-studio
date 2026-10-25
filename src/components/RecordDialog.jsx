import { useEffect, useRef, useState } from 'react';
import { LevelMeter } from './Transport.jsx';
import { Recorder, listInputs, loadRecordSettings, micError, saveRecordSettings } from '../preview/recorder.js';
import { tx } from '../i18n/index.js';

// Opciones de grabación de voz en off: micrófono, procesado del navegador y dónde se guardan los archivos.
// Mientras está abierta, el medidor enseña el nivel del micrófono elegido para poder probarlo.
export default function RecordDialog({ projectPath, onClose }) {
  const [settings, setSettings] = useState(loadRecordSettings);
  const [inputs, setInputs] = useState([]);
  const [error, setError] = useState('');
  const test = useRef(null);

  // Abre el micrófono para el medidor (se vuelve a abrir al cambiar de dispositivo o de procesado).
  useEffect(() => {
    let alive = true;
    const rec = new Recorder();
    test.current = rec;
    setError('');
    rec.open(settings)
      .then(() => listInputs())
      .then((list) => alive && setInputs(list))
      .catch((err) => alive && setError(micError(err)));
    return () => {
      alive = false;
      rec.close();
    };
  }, [settings.deviceId, settings.processing]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const change = (changes) => {
    const next = { ...settings, ...changes };
    setSettings(next);
    saveRecordSettings(next);
  };
  const folder = projectPath
    ? `${projectPath.replace(/[\\/][^\\/]*$/, '')}\\Grabaciones`
    : tx('Documentos\\Cortex Studio\\Grabaciones (guarda el proyecto para que vayan a su carpeta)');

  return (
    <div className="modal-backdrop">
      <div className="modal record-dialog">
        <div className="modal-title">{tx('Opciones de grabación')}</div>
        <div className="modal-content">
          <label>
            <span className="field-label">{tx('Micrófono')}</span>
            <select value={settings.deviceId} onChange={(e) => change({ deviceId: e.target.value })}>
              <option value="">{tx('El predeterminado de Windows')}</option>
              {inputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || tx('Micrófono {n}', { n: i + 1 })}</option>)}
            </select>
          </label>
          <div className="record-level">
            <span className="field-label">{tx('Nivel')}</span>
            {error ? <span className="error-text">{error}</span> : <LevelMeter source={() => test.current?.level} />}
          </div>
          <label className="check">
            <input type="checkbox" checked={settings.processing} onChange={(e) => change({ processing: e.target.checked })} />
           {tx('Cancelación de eco, reducción de ruido y control de ganancia automático')}
          </label>
          <p className="note">
           {tx('Desactivado, se graba el sonido tal cual (lo mejor para voz en off, con auriculares). Actívalo si grabas con altavoces y se cuela el sonido del proyecto.')}
          </p>
          <p className="note">{tx('Las grabaciones se guardan en WAV en:')} <strong>{folder}</strong></p>
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>{tx('Aceptar')}</button>
        </div>
      </div>
    </div>
  );
}
