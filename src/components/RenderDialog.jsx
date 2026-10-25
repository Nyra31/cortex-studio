import { useEffect, useState } from 'react';
import { formatFps } from '../state/project.js';
import { formatTimecode } from '../util/time.js';
import {
  AUDIO_KBPS, FORMATS, FRAME_RATE_CHOICES, QUALITY_LEVELS, SIZES, TEMPLATES, formatInfo, outputSize,
} from '../state/render-formats.js';
import { decimal, tx } from '../i18n/index.js';

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
  subtitles: 'burn',
  hw: '',
});
// Normalizar la sonoridad del render (LUFS integrados), como piden las plataformas.
const LOUDNESS = [
  { value: '', label: tx('Sin normalizar') },
  { value: '-14', label: tx('−14 LUFS: YouTube, Spotify, redes sociales') },
  { value: '-16', label: tx('−16 LUFS: pódcast, Apple') },
  { value: '-23', label: tx('−23 LUFS: televisión (EBU R128)') },
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
// onEnqueue(trabajos, empezar): añade trabajos a la cola de render (ver QueueDialog).
export default function RenderDialog({ makePayload, settings, region, regions = [], projectLength, defaultName, onClose, onEnqueue, hasSubtitles = false }) {
  // Qué renderizar: 'all', 'selection' o el id de una región. Como en VEGAS: con selección, se ofrece esa parte.
  const [what, setWhat] = useState(region ? 'selection' : 'all');
  const range = what === 'all' || what === 'eachRegion' ? null : what === 'selection' ? region : regions.find((r) => r.id === what) || null;
  const [opts, setOpts] = useState(loadSettings);
  const [phase, setPhase] = useState('settings'); // settings | rendering | done | error
  const [progress, setProgress] = useState(0);
  const [outPath, setOutPath] = useState(null);
  const [error, setError] = useState('');
  const [fallback, setFallback] = useState(null); // la tarjeta gráfica falló y se usó el procesador
  // Tarjetas gráficas que pueden codificar H.264/H.265 en este equipo (la misma prueba que el compresor).
  const [gpus, setGpus] = useState([]);
  useEffect(() => {
    window.api.compressEncoders?.().then((list) => {
      const fams = [...new Set(list.filter((e) => e.hw && (e.codec === 'h264' || e.codec === 'hevc')).map((e) => e.id.split('_')[1]))];
      setGpus(fams);
    }).catch(() => {});
  }, []);

  const format = formatInfo(opts.format);
  const fps = opts.fps ?? settings.fps;
  const { out, inner, bands } = outputSize(opts.size, opts.custom, settings);
  const length = what === 'eachRegion' ? regions.reduce((s, r) => s + r.end - r.start, 0) : range ? range.end - range.start : projectLength;
  // Cambiar algo a mano deja la plantilla como «personalizada».
  const change = (changes) => setOpts((o) => ({ ...o, ...changes, template: 'custom' }));
  const applyTemplate = (id) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (t) setOpts((o) => ({ ...defaults(t), custom: o.custom, hw: o.hw, loudness: t.loudness !== undefined ? t.loudness : o.loudness }));
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
    return mb >= 1000 ? `${decimal(mb / 1000, 1)} GB` : `${decimal(Math.max(0.1, mb), 1)} MB`;
  })();

  // Subtítulos: quemados en la imagen, como pista aparte (MP4, MOV y WebM) o fuera. Sin imagen, nunca.
  const softOk = ['mp4-h264', 'mp4-h265', 'mov-prores', 'webm'].includes(format.id);
  const wanted = opts.subtitles || 'burn';
  const subtitleMode = !hasSubtitles || !format.video ? 'none' : wanted === 'soft' && !softOk ? 'burn' : wanted;
  const GPU_NAMES = { nvenc: tx('Tarjeta gráfica NVIDIA (NVENC)'), qsv: tx('Gráfica Intel (Quick Sync)'), amf: tx('Tarjeta gráfica AMD (AMF)') };
  const hwFormat = format.id === 'mp4-h264' || format.id === 'mp4-h265';
  const hw = hwFormat && gpus.includes(opts.hw) ? opts.hw : null;
  const renderSettings = {
    width: inner.w,
    height: inner.h,
    outWidth: out.w,
    outHeight: out.h,
    fps,
    format: format.id,
    quality: opts.quality,
    audioKbps: opts.audioKbps,
    loudness: format.id !== 'gif' ? opts.loudness : null,
    hw,
  };
  const baseFile = defaultName.replace(/\.[^.]+$/, '');
  const regionLabel = (r) => (r.name ? r.name : tx('Región {number}', { number: r.number }));
  // Trabajo para la cola: el proyecto tal como está ahora (se puede seguir editando mientras se renderiza).
  const job = (r, target, name) => ({
    name,
    outPath: target,
    payload: makePayload({ width: inner.w, height: inner.h }, r ? { start: r.start, end: r.end } : null, { subtitles: subtitleMode }),
    settings: renderSettings,
  });
  // Añadir a la cola lo elegido (con «cada región», un archivo por región en la carpeta del primero).
  async function enqueue(startNow) {
    if (what === 'eachRegion') {
      const first = await window.api.pickRenderPath(`${baseFile} - ${regionLabel(regions[0])}.${format.ext}`, { name: format.name, ext: format.ext });
      if (!first) return;
      const dir = first.slice(0, Math.max(first.lastIndexOf('\\'), first.lastIndexOf('/')) + 1);
      const safe = (s) => s.replace(/[\\/:*?"<>|]/g, '_');
      onEnqueue(regions.map((r, i) => job(r, i === 0 ? first : `${dir}${safe(`${baseFile} - ${regionLabel(r)}`)}.${format.ext}`, tx('Región {number}{n}', { number: r.number, n: r.name ? ` «${r.name}»` : '' }))), startNow);
    } else {
      const target = await window.api.pickRenderPath(`${baseFile}.${format.ext}`, { name: format.name, ext: format.ext });
      if (!target) return;
      onEnqueue([job(range, target, what === 'all' ? tx('Todo el proyecto') : what === 'selection' ? tx('Selección de tiempo') : tx('Región {number}', { number: range.number }))], startNow);
    }
    onClose();
  }

  async function start() {
    if (what === 'eachRegion') {
      enqueue(true);
      return;
    }
    const target = await window.api.pickRenderPath(`${baseFile}.${format.ext}`, { name: format.name, ext: format.ext });
    if (!target) return;
    setOutPath(target);
    setProgress(0);
    setPhase('rendering');
    const off = window.api.onRenderProgress(setProgress);
    try {
      const result = await window.api.startRender(
        makePayload({ width: inner.w, height: inner.h }, range ? { start: range.start, end: range.end } : null, { subtitles: subtitleMode }),
        renderSettings,
        target,
      );
      if (result.ok) {
        setFallback(result.cpuFallback || null);
        setPhase('done');
      }
      else if (result.canceled) setPhase('settings');
      else {
        setError(result.error || tx('Error desconocido'));
        setPhase('error');
      }
    } finally {
      off();
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal render-dialog">
        <div className="modal-title">{tx('Renderizar como')}</div>
        <div className="modal-content">
          {phase === 'settings' && (
            <>
              <label>
                <span className="field-label">{tx('Plantilla')}</span>
                <select value={opts.template} onChange={(e) => applyTemplate(e.target.value)}>
                  {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  {opts.template === 'custom' && <option value="custom">{tx('Personalizada')}</option>}
                </select>
              </label>
              <div className="render-grid">
                <label className="wide">
                  <span className="field-label">{tx('Formato')}</span>
                  <select value={opts.format} onChange={(e) => change({ format: e.target.value })}>
                    {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
                {format.video && (
                  <>
                    <label>
                      <span className="field-label">{tx('Tamaño')}</span>
                      <select value={opts.size} onChange={(e) => change({ size: e.target.value })}>
                        {SIZES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.scale ? `${s.label}: ${outputSize(s.id, opts.custom, settings).out.w} × ${outputSize(s.id, opts.custom, settings).out.h}` : s.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="field-label">{tx('Velocidad de fotogramas')}</span>
                      <select value={opts.fps ?? ''} onChange={(e) => change({ fps: e.target.value === '' ? null : Number(e.target.value) })}>
                        {FRAME_RATE_CHOICES.map((f) => (
                          <option key={f ?? 'p'} value={f ?? ''}>{f === null ? tx('La del proyecto ({formatFps} fps)', { formatFps: formatFps(settings.fps) }) : `${formatFps(f)} fps`}</option>
                        ))}
                      </select>
                    </label>
                    {opts.size === 'custom' && (
                      <div className="render-custom wide">
                        <span className="field-label">{tx('Ancho × alto (px)')}</span>
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
                {hwFormat && gpus.length > 0 && (
                  <label className="wide" title={tx('Con la tarjeta gráfica, el render en 4K o en H.265 es varias veces más rápido (en 1080p la diferencia es menor). Si la tarjeta falla, se renderiza con el procesador.')}>
                    <span className="field-label">{tx('Codificar con')}</span>
                    <select value={hw || ''} onChange={(e) => setOpts((o) => ({ ...o, hw: e.target.value }))}>
                      <option value="">{tx('El procesador (mejor calidad por tamaño)')}</option>
                      {gpus.map((g) => <option key={g} value={g}>{tx('{n} (más rápido, sobre todo en 4K y H.265)', { n: GPU_NAMES[g] })}</option>)}
                    </select>
                  </label>
                )}
                {format.quality && (
                  <label>
                    <span className="field-label">{tx('Calidad del video')}</span>
                    <select
                      value={opts.quality.mode === 'bitrate' ? 'bitrate' : opts.quality.level}
                      onChange={(e) => change({
                        quality: e.target.value === 'bitrate'
                          ? { mode: 'bitrate', mbps: opts.quality.mbps || 10 }
                          : { mode: 'crf', level: e.target.value },
                      })}
                    >
                      {QUALITY_LEVELS.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
                      <option value="bitrate">{tx('Tasa de bits fija…')}</option>
                    </select>
                  </label>
                )}
                {format.quality && opts.quality.mode === 'bitrate' && (
                  <label>
                    <span className="field-label">{tx('Tasa de bits (Mbps)')}</span>
                    <input
                      type="number" min={0.5} max={200} step={0.5} value={opts.quality.mbps}
                      onChange={(e) => change({ quality: { mode: 'bitrate', mbps: Math.max(0.1, Number(e.target.value) || 1) } })}
                    />
                  </label>
                )}
                {format.audioKbps && (
                  <label>
                    <span className="field-label">{tx('Audio')}</span>
                    <select value={opts.audioKbps} onChange={(e) => change({ audioKbps: Number(e.target.value) })}>
                      {AUDIO_KBPS.map((k) => <option key={k} value={k}>{tx('{k} kbps', { k })}</option>)}
                    </select>
                  </label>
                )}
                {hasSubtitles && format.video && (
                  <label title={tx('Quemados: forman parte de la imagen. Como pista aparte: el reproductor los puede activar y desactivar.')}>
                    <span className="field-label">{tx('Subtítulos')}</span>
                    <select value={subtitleMode} onChange={(e) => change({ subtitles: e.target.value })}>
                      <option value="burn">{tx('Quemados en la imagen')}</option>
                      <option value="soft" disabled={!softOk}>{tx('Como pista aparte (se activan en el reproductor){n}', { n: softOk ? '' : tx(': no en este formato') })}</option>
                      <option value="none">{tx('No incluir')}</option>
                    </select>
                  </label>
                )}
                {format.id !== 'gif' && (
                  <label title={tx('Sube o baja el volumen de todo el render para que suene tan fuerte como pide la plataforma (mide antes el sonido: tarda un poco más)')}>
                    <span className="field-label">{tx('Sonoridad')}</span>
                    <select value={opts.loudness ?? ''} onChange={(e) => change({ loudness: e.target.value ? Number(e.target.value) : null })}>
                      {LOUDNESS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </label>
                )}
              </div>

              <div className="render-range">
                <span className="field-label">{tx('Qué renderizar')}</span>
                <label>
                  <input type="radio" checked={what === 'all'} onChange={() => setWhat('all')} />
                 {tx('Todo el proyecto')}
                </label>
                <label className={region ? '' : 'disabled'}>
                  <input type="radio" checked={what === 'selection'} disabled={!region} onChange={() => setWhat('selection')} />
                  {region
                    ? tx('Solo la selección de tiempo ({formatTimecode} – {formatTimecode2})', { formatTimecode: formatTimecode(region.start, settings.fps), formatTimecode2: formatTimecode(region.end, settings.fps) })
                    : tx('Solo la selección de tiempo (no hay ninguna: arrástrala en la barra de arriba de la regla)')}
                </label>
                {regions.map((r) => (
                  <label key={r.id}>
                    <input type="radio" checked={what === r.id} onChange={() => setWhat(r.id)} />
                    {tx('Región {number}{n} ({formatTimecode} – {formatTimecode2})', { number: r.number, n: r.name ? ` «${r.name}»` : '', formatTimecode: formatTimecode(r.start, settings.fps), formatTimecode2: formatTimecode(r.end, settings.fps) })}
                  </label>
                ))}
                {regions.length > 1 && (
                  <label>
                    <input type="radio" checked={what === 'eachRegion'} onChange={() => setWhat('eachRegion')} />
                    {tx('Cada región en su archivo ({length} archivos, con la cola de render)', { length: regions.length })}
                  </label>
                )}
              </div>

              <div className="render-summary">
                <div>{tx('Archivo:')} <strong>.{format.ext}</strong>{format.video ? '' : tx(' (solo audio)')}{format.id === 'gif' ? tx(' (sin sonido)') : ''}</div>
                {format.video && (
                  <div>
                   {tx('Imagen:')} <strong>{tx('{w} × {h}, {formatFps} fps', { w: out.w, h: out.h, formatFps: formatFps(fps) })}</strong>
                    {bands && <span className="note"> {tx('(el proyecto, {w} × {h}, va con bandas negras)', { w: inner.w, h: inner.h })}</span>}
                  </div>
                )}
                <div>{tx('Duración:')} <strong>{formatTimecode(length, settings.fps)}</strong></div>
                {estimate && <div>{tx('Tamaño aproximado:')} <strong>{estimate}</strong></div>}
              </div>
            </>
          )}
          {phase === 'rendering' && (
            <>
              <p className="note">{tx('Renderizando en {outPath}', { outPath })}</p>
              <div className="progress"><div style={{ width: `${(progress * 100).toFixed(1)}%` }} /></div>
              <p className="progress-label">{Math.floor(progress * 100)} %</p>
            </>
          )}
          {phase === 'done' && (
            <>
              <p>{tx('Renderizado completado.')}</p>
              <p className="note">{outPath}</p>
              {fallback && <p className="note">{tx('La tarjeta gráfica dio un error ({fallback}) y se ha renderizado con el procesador.', { fallback })}</p>}
            </>
          )}
          {phase === 'error' && (
            <>
              <p>{tx('No se pudo renderizar:')}</p>
              <pre className="error">{error}</pre>
            </>
          )}
        </div>
        <div className="modal-actions">
          {phase === 'settings' && (
            <>
              <button onClick={onClose}>{tx('Cancelar')}</button>
              <button onClick={() => enqueue(false)} title={tx('Guarda este render (con el proyecto tal como está ahora) para hacerlo después con otros: Archivo → Cola de render')}>{tx('Añadir a la cola')}</button>
              <button className="primary" onClick={start}>{tx('Elegir destino y renderizar')}</button>
            </>
          )}
          {phase === 'rendering' && <button onClick={() => window.api.cancelRender()}>{tx('Cancelar renderizado')}</button>}
          {phase === 'done' && (
            <>
              <button onClick={() => window.api.revealFile(outPath)}>{tx('Mostrar en la carpeta')}</button>
              <button className="primary" onClick={onClose}>{tx('Cerrar')}</button>
            </>
          )}
          {phase === 'error' && (
            <>
              <button onClick={() => setPhase('settings')}>{tx('Volver')}</button>
              <button className="primary" onClick={onClose}>{tx('Cerrar')}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
