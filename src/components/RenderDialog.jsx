import { useEffect, useState } from 'react';
import { formatFps } from '../state/project.js';
import { formatTimecode } from '../util/time.js';
import {
  AUDIO_KBPS, FORMATS, FRAME_RATE_CHOICES, QUALITY_LEVELS, SIZES, TEMPLATES, formatInfo, outputSize,
} from '../state/render-formats.js';

const STORAGE_KEY = 'cortex-render'; // últimos ajustes (comodidad: si no se pueden leer, se usa la primera plantilla)
const defaults = (t = TEMPLATES[0]) => ({
  template: t.id,
  format: t.format,
  size: t.size || 'p100',
  custom: { w: 1920, h: 1080 },
  fps: t.fps ?? null,
  quality: t.quality || { mode: 'crf', level: 'normal' },
  audioKbps: t.audioKbps || 192,
  loudness: t.loudness ?? null,
});
// Normalizar la sonoridad del render (LUFS integrados), como piden las plataformas.
const LOUDNESS = [
  { value: '', label: 'Sin normalizar' },
  { value: '-14', label: '−14 LUFS: YouTube, Spotify, redes sociales' },
  { value: '-16', label: '−16 LUFS: pódcast, Apple' },
  { value: '-23', label: '−23 LUFS: televisión (EBU R128)' },
];
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved?.format ? { ...defaults(), ...saved } : defaults();
  } catch {
    return defaults();
  }
}

// Ventana de render (como «Renderizar como» de VEGAS): plantilla, formato, tamaño, velocidad de fotogramas,
// calidad y qué renderizar. makePayload(size, range): datos para el proceso principal, calculados para el
// tamaño al que se monta el proyecto (los efectos y los textos dependen de él); range = tramo o null.
// region: selección de tiempo ({ start, end }) o null; regions: regiones con nombre del proyecto.
export default function RenderDialog({ makePayload, settings, region, regions = [], projectLength, defaultName, onClose }) {
  // Qué renderizar: 'all', 'selection' o el id de una región. Como en VEGAS: con selección, se ofrece esa parte.
  const [what, setWhat] = useState(region ? 'selection' : 'all');
  const range = what === 'all' ? null : what === 'selection' ? region : regions.find((r) => r.id === what) || null;
  const [opts, setOpts] = useState(loadSettings);
  const [phase, setPhase] = useState('settings'); // settings | rendering | done | error
  const [progress, setProgress] = useState(0);
  const [outPath, setOutPath] = useState(null);
  const [error, setError] = useState('');

  const format = formatInfo(opts.format);
  const fps = opts.fps ?? settings.fps;
  const { out, inner, bands } = outputSize(opts.size, opts.custom, settings);
  const length = range ? range.end - range.start : projectLength;
  // Cambiar algo a mano deja la plantilla como «personalizada».
  const change = (changes) => setOpts((o) => ({ ...o, ...changes, template: 'custom' }));
  const applyTemplate = (id) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (t) setOpts((o) => ({ ...defaults(t), custom: o.custom, loudness: t.loudness !== undefined ? t.loudness : o.loudness }));
  };

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
    } catch {
      // sin almacenamiento: no se recuerdan los ajustes
    }
  }, [opts]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && phase !== 'rendering') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  // Tamaño aproximado del archivo, si se puede saber (tasa de bits fija o audio).
  const estimate = (() => {
    let kbps = 0;
    if (format.quality && opts.quality.mode === 'bitrate') kbps += opts.quality.mbps * 1000;
    else if (format.video) return null;
    if (format.audioKbps) kbps += opts.audioKbps;
    else if (format.id === 'wav') kbps += 1536;
    const mb = (kbps * length) / 8 / 1000;
    return mb >= 1000 ? `${(mb / 1000).toFixed(1).replace('.', ',')} GB` : `${Math.max(0.1, mb).toFixed(1).replace('.', ',')} MB`;
  })();

  async function start() {
    const name = defaultName.replace(/\.[^.]+$/, '');
    const target = await window.api.pickRenderPath(`${name}.${format.ext}`, { name: format.name, ext: format.ext });
    if (!target) return;
    setOutPath(target);
    setProgress(0);
    setPhase('rendering');
    const off = window.api.onRenderProgress(setProgress);
    try {
      const result = await window.api.startRender(
        makePayload({ width: inner.w, height: inner.h }, range ? { start: range.start, end: range.end } : null),
        {
          width: inner.w,
          height: inner.h,
          outWidth: out.w,
          outHeight: out.h,
          fps,
          format: format.id,
          quality: opts.quality,
          audioKbps: opts.audioKbps,
          loudness: format.id !== 'gif' ? opts.loudness : null,
        },
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
      <div className="modal render-dialog">
        <div className="modal-title">Renderizar como</div>
        <div className="modal-content">
          {phase === 'settings' && (
            <>
              <label>
                <span className="field-label">Plantilla</span>
                <select value={opts.template} onChange={(e) => applyTemplate(e.target.value)}>
                  {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  {opts.template === 'custom' && <option value="custom">Personalizada</option>}
                </select>
              </label>
              <div className="render-grid">
                <label className="wide">
                  <span className="field-label">Formato</span>
                  <select value={opts.format} onChange={(e) => change({ format: e.target.value })}>
                    {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
                {format.video && (
                  <>
                    <label>
                      <span className="field-label">Tamaño</span>
                      <select value={opts.size} onChange={(e) => change({ size: e.target.value })}>
                        {SIZES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.scale ? `${s.label}: ${outputSize(s.id, opts.custom, settings).out.w} × ${outputSize(s.id, opts.custom, settings).out.h}` : s.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="field-label">Velocidad de fotogramas</span>
                      <select value={opts.fps ?? ''} onChange={(e) => change({ fps: e.target.value === '' ? null : Number(e.target.value) })}>
                        {FRAME_RATE_CHOICES.map((f) => (
                          <option key={f ?? 'p'} value={f ?? ''}>{f === null ? `La del proyecto (${formatFps(settings.fps)} fps)` : `${formatFps(f)} fps`}</option>
                        ))}
                      </select>
                    </label>
                    {opts.size === 'custom' && (
                      <div className="render-custom wide">
                        <span className="field-label">Ancho × alto (px)</span>
                        <input
                          type="number" min={16} max={7680} step={2} value={opts.custom.w}
                          onChange={(e) => change({ custom: { ...opts.custom, w: Number(e.target.value) } })}
                        />
                        <span>×</span>
                        <input
                          type="number" min={16} max={4320} step={2} value={opts.custom.h}
                          onChange={(e) => change({ custom: { ...opts.custom, h: Number(e.target.value) } })}
                        />
                      </div>
                    )}
                  </>
                )}
                {format.quality && (
                  <label>
                    <span className="field-label">Calidad del video</span>
                    <select
                      value={opts.quality.mode === 'bitrate' ? 'bitrate' : opts.quality.level}
                      onChange={(e) => change({
                        quality: e.target.value === 'bitrate'
                          ? { mode: 'bitrate', mbps: opts.quality.mbps || 10 }
                          : { mode: 'crf', level: e.target.value },
                      })}
                    >
                      {QUALITY_LEVELS.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
                      <option value="bitrate">Tasa de bits fija…</option>
                    </select>
                  </label>
                )}
                {format.quality && opts.quality.mode === 'bitrate' && (
                  <label>
                    <span className="field-label">Tasa de bits (Mbps)</span>
                    <input
                      type="number" min={0.5} max={200} step={0.5} value={opts.quality.mbps}
                      onChange={(e) => change({ quality: { mode: 'bitrate', mbps: Math.max(0.1, Number(e.target.value) || 1) } })}
                    />
                  </label>
                )}
                {format.audioKbps && (
                  <label>
                    <span className="field-label">Audio</span>
                    <select value={opts.audioKbps} onChange={(e) => change({ audioKbps: Number(e.target.value) })}>
                      {AUDIO_KBPS.map((k) => <option key={k} value={k}>{k} kbps</option>)}
                    </select>
                  </label>
                )}
                {format.id !== 'gif' && (
                  <label title="Sube o baja el volumen de todo el render para que suene tan fuerte como pide la plataforma (mide antes el sonido: tarda un poco más)">
                    <span className="field-label">Sonoridad</span>
                    <select value={opts.loudness ?? ''} onChange={(e) => change({ loudness: e.target.value ? Number(e.target.value) : null })}>
                      {LOUDNESS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </label>
                )}
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

              <div className="render-summary">
                <div>Archivo: <strong>.{format.ext}</strong>{format.video ? '' : ' (solo audio)'}{format.id === 'gif' ? ' (sin sonido)' : ''}</div>
                {format.video && (
                  <div>
                    Imagen: <strong>{out.w} × {out.h}, {formatFps(fps)} fps</strong>
                    {bands && <span className="note"> (el proyecto, {inner.w} × {inner.h}, va con bandas negras)</span>}
                  </div>
                )}
                <div>Duración: <strong>{formatTimecode(length, settings.fps)}</strong></div>
                {estimate && <div>Tamaño aproximado: <strong>{estimate}</strong></div>}
              </div>
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
