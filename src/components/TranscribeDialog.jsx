import { useEffect, useState } from 'react';
import { lang, tx } from '../i18n/index.js';

const LANGUAGES = [
  ['auto', tx('Detectar automáticamente')], ['es', tx('Español')], ['en', tx('Inglés')], ['ca', tx('Catalán')], ['eu', tx('Euskera')], ['gl', tx('Gallego')],
  ['pt', tx('Portugués')], ['fr', tx('Francés')], ['it', tx('Italiano')], ['de', tx('Alemán')], ['nl', tx('Neerlandés')], ['pl', tx('Polaco')],
  ['ru', tx('Ruso')], ['uk', tx('Ucraniano')], ['ar', tx('Árabe')], ['tr', tx('Turco')], ['hi', tx('Hindi')], ['zh', tx('Chino')], ['ja', tx('Japonés')], ['ko', tx('Coreano')],
];
const STORE = 'cortex-transcribe';
const load = () => {
  try {
    return { language: lang, model: 'small', translate: false, ...JSON.parse(localStorage.getItem(STORE) || '{}') };
  } catch {
    return { language: lang, model: 'small', translate: false };
  }
};

const STAGES = {
  mix: tx('Mezclando el sonido del proyecto'),
  program: tx('Descargando whisper.cpp (solo la primera vez)'),
  model: tx('Descargando el modelo de idioma (solo la primera vez)'),
  audio: tx('Preparando el sonido'),
  transcribe: tx('Transcribiendo'),
};

// Subtítulos automáticos: transcribe el sonido del proyecto (o de la selección de tiempo) con Whisper en el propio
// equipo y añade los subtítulos. onTranscribe(opts, onStatus) → número de subtítulos (null si se cancela).
export default function TranscribeDialog({ hasRegion, cueCount, onTranscribe, onCancel, onClose }) {
  const [opts, setOpts] = useState(load);
  const [what, setWhat] = useState(hasRegion ? 'selection' : 'all');
  const [replace, setReplace] = useState(false);
  const [models, setModels] = useState(null);
  const [status, setStatus] = useState(null); // { stage, percent } mientras trabaja
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const busy = !!status;

  useEffect(() => {
    window.api.whisperModels().then(setModels).catch(() => setModels([]));
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const change = (patch) => setOpts((o) => {
    const next = { ...o, ...patch };
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {}
    return next;
  });

  const start = async () => {
    setError('');
    setResult(null);
    setStatus({ stage: 'mix', percent: 0 });
    try {
      const n = await onTranscribe({ ...opts, what, replace }, setStatus);
      if (n !== null) setResult(n);
    } catch (err) {
      setError(String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
    setStatus(null);
    window.api.whisperModels().then(setModels).catch(() => {});
  };

  const model = models?.find((m) => m.id === opts.model);

  return (
    <div className="modal-backdrop">
      <div className="modal transcribe-dialog">
        <div className="modal-title">{tx('Subtítulos automáticos')}</div>
        <div className="modal-content">
          <p className="note">
           {tx('Whisper escucha el sonido del proyecto y escribe los subtítulos con sus tiempos. Funciona en este equipo: no se envía nada a Internet (solo se descargan el programa y el modelo la primera vez).')}
          </p>
          <div className="render-grid">
            <label>
              <span className="field-label">{tx('Idioma')}</span>
              <select value={opts.language} disabled={busy} onChange={(e) => change({ language: e.target.value })}>
                {LANGUAGES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label>
              <span className="field-label">{tx('Modelo')}</span>
              <select value={opts.model} disabled={busy || !models} onChange={(e) => change({ model: e.target.value })}>
                {(models || []).map((m) => <option key={m.id} value={m.id}>{m.name}{m.ready ? ' ✓' : ''}</option>)}
              </select>
            </label>
          </div>
          {model && !model.ready && <p className="note">{tx('Este modelo se descargará la primera vez ({mb} MB).', { mb: model.mb })}</p>}
          <div className="render-range">
            <span className="field-label">{tx('Qué transcribir')}</span>
            <label>
              <input type="radio" checked={what === 'all'} disabled={busy} onChange={() => setWhat('all')} />
             {tx('Todo el proyecto')}
            </label>
            <label className={hasRegion ? '' : 'disabled'}>
              <input type="radio" checked={what === 'selection'} disabled={busy || !hasRegion} onChange={() => setWhat('selection')} />
             {tx('Solo la selección de tiempo')}
            </label>
          </div>
          <div className="render-range">
            <label title={tx('Escribe los subtítulos en inglés, sea cual sea el idioma en que se habla')}>
              <input type="checkbox" checked={opts.translate} disabled={busy} onChange={(e) => change({ translate: e.target.checked })} />
             {tx('Traducir al inglés')}
            </label>
            {cueCount > 0 && (
              <label>
                <input type="checkbox" checked={replace} disabled={busy} onChange={(e) => setReplace(e.target.checked)} />
               {tx('Sustituir los {cueCount} subtítulos que hay (si no, se añaden)', { cueCount })}
              </label>
            )}
          </div>
          {status && (
            <>
              <div className="progress"><div style={{ width: `${status.percent ?? 0}%` }} /></div>
              <p className="progress-label">
                {STAGES[status.stage] || tx('Trabajando')}
                {status.percent != null ? ` · ${Math.floor(status.percent)} %` : '…'}
              </p>
            </>
          )}
          {result !== null && (
            <p className="note">
              {result ? tx('Se han añadido {result} subtítulos. Revísalos en el panel de subtítulos: Whisper se equivoca a veces con nombres propios y palabras poco comunes.', { result }) : tx('No se ha reconocido ninguna frase (¿hay voz en el sonido del proyecto?).')}
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal-actions">
          {busy && <button onClick={onCancel}>{tx('Cancelar')}</button>}
          <span className="footer-spacer" />
          <button onClick={onClose} disabled={busy}>{tx('Cerrar')}</button>
          <button className="primary" onClick={start} disabled={busy || !models?.length}>{tx('Transcribir')}</button>
        </div>
      </div>
    </div>
  );
}
