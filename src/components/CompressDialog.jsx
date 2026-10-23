import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration } from '../util/time.js';
import { DEFAULT_SETTINGS, PRESETS, VIDEO_EXTENSIONS, fitEncoder, loadStore, presetSettings, saveStore } from '../state/compress.js';

const MAX_SIZES = [[0, 'Como el original'], [2160, '2160p (4K)'], [1440, '1440p (2K)'], [1080, '1080p'], [720, '720p'], [576, '576p'], [480, '480p'], [360, '360p']];
const FPS = [[0, 'Como el original'], [60, '60'], [50, '50'], [30, '30'], [29.97, '29,97'], [25, '25'], [24, '24'], [23.976, '23,976'], [15, '15']];
const AUDIO_CODECS = [['aac', 'AAC'], ['opus', 'Opus'], ['mp3', 'MP3'], ['ac3', 'AC3 (Dolby Digital)'], ['copy', 'Copiar sin cambios']];
const AUDIO_KBPS = [64, 96, 128, 160, 192, 256, 320];
const CONTAINERS = [['mp4', 'MP4'], ['mkv', 'MKV'], ['webm', 'WebM']];
const STATUS = { waiting: 'En espera', running: 'Comprimiendo', done: 'Terminado', error: 'Error', canceled: 'Cancelado' };

const mb = (b) => `${(b / 1048576).toLocaleString('es-ES', { maximumFractionDigits: b < 10485760 ? 2 : 1 })} MB`;
const pct = (out, inp) => `${out <= inp ? '−' : '+'}${Math.round(Math.abs(1 - out / inp) * 100)} %`;
const fileName = (p) => p.split(/[\\/]/).pop();

// Texto del progreso (también lo usa la barra de estado).
export function compressProgressText(p) {
  if (!p) return 'Empezando…';
  if (p.stage === 'analyzing') return 'Analizando…';
  const pass = p.passes > 1 ? `Pasada ${p.pass} de ${p.passes} · ` : '';
  const speed = p.speed ? ` · ${p.speed.toLocaleString('es-ES', { maximumFractionDigits: 1 })}×` : '';
  const eta = p.eta != null && p.eta > 0.5 ? ` · quedan ${formatDuration(p.eta)}` : '';
  return `${pass}${Math.floor(p.percent || 0)} %${speed}${eta}`;
}

// Compresor de video por lotes (como HandBrake). La lista y la compresión las lleva App (`queue`, `running`): siguen
// aunque se cierre la ventana.
export default function CompressDialog({ queue, running, projectVideos, onAdd, onRemove, onClearDone, onStart, onCancel, onClose }) {
  const [store, setStore] = useState(loadStore);
  const [encoders, setEncoders] = useState(null);
  const [tab, setTab] = useState('video');
  const [selected, setSelected] = useState(null);
  const [info, setInfo] = useState(null); // datos del archivo seleccionado con los ajustes actuales
  const [sample, setSample] = useState(null); // { busy, progress, result, error }
  const [error, setError] = useState('');
  const s = store.settings;
  const enc = encoders?.find((e) => e.id === s.encoder);

  const update = (patch) => setStore((d) => {
    const next = { ...d, ...patch };
    saveStore(next);
    return next;
  });
  const change = (patch) => {
    const settings = encoders ? fitEncoder({ ...s, ...patch }, encoders) : { ...s, ...patch };
    update({ settings, preset: 'custom' });
    setSample(null);
  };
  const changeAudio = (patch) => change({ audio: { ...s.audio, ...patch } });

  useEffect(() => {
    window.api.compressEncoders().then((list) => {
      setEncoders(list);
      setStore((d) => ({ ...d, settings: fitEncoder(d.settings, list) }));
    });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // El archivo seleccionado: el elegido en la lista o el primero.
  const current = queue.find((j) => j.id === selected) || queue[0] || null;
  // Datos del archivo con los ajustes (medidas de salida, recorte detectado…), con un pequeño retraso al cambiar.
  const inspectKey = current ? JSON.stringify([current.path, s.crop, s.maxSize, s.rotate, s.encoder, s.tenBit, s.hdr, s.mode, s.sizeMB, s.audio]) : '';
  useEffect(() => {
    if (!current) {
      setInfo(null);
      return undefined;
    }
    let alive = true;
    const t = setTimeout(() => {
      window.api.compressInspect(current.path, s).then((r) => alive && setInfo(r)).catch((err) => alive && setInfo({ error: cleanError(err) }));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [inspectKey]);

  useEffect(() => {
    if (!sample?.busy) return undefined;
    return window.api.onCompressProgress((p) => {
      if (p.sample) setSample((x) => (x?.busy ? { ...x, progress: p } : x));
    });
  }, [!!sample?.busy]);

  const choosePreset = (id) => {
    if (id === 'custom') return;
    const user = store.user.find((u) => `user:${u.name}` === id);
    const settings = user
      ? fitEncoder({ ...DEFAULT_SETTINGS, ...user.settings, dir: s.dir, importAfter: s.importAfter }, encoders || [])
      : presetSettings(PRESETS.find((p) => p.id === id), encoders || [], s);
    update({ settings, preset: id });
    setSample(null);
  };
  const savePreset = () => {
    const name = window.prompt('Nombre del preajuste:', store.preset.startsWith('user:') ? store.preset.slice(5) : '');
    if (!name?.trim()) return;
    const { dir, importAfter, ...settings } = s;
    const user = [...store.user.filter((u) => u.name !== name.trim()), { name: name.trim(), settings }];
    update({ user, preset: `user:${name.trim()}` });
  };
  const deletePreset = () => {
    const name = store.preset.slice(5);
    if (!window.confirm(`¿Borrar el preajuste «${name}»?`)) return;
    update({ user: store.user.filter((u) => u.name !== name), preset: 'custom' });
  };

  const addFiles = async () => {
    const paths = await window.api.compressPick();
    if (paths.length) onAdd(paths);
  };
  const pickDir = async () => {
    const dir = await window.api.pickFolder('Carpeta de los videos comprimidos', s.dir || undefined);
    if (dir) change({ dir });
  };

  const runSample = async () => {
    if (!current) return;
    setSample({ busy: true, progress: null });
    try {
      const r = await window.api.compressSample(current.path, s);
      setSample(r.canceled ? null : { result: r });
    } catch (err) {
      setSample({ error: cleanError(err) });
    }
  };

  const waiting = queue.filter((j) => j.status === 'waiting').length;
  const busyFile = queue.find((j) => j.status === 'running');
  const hasPresetUser = store.preset.startsWith('user:');
  const containers = CONTAINERS.filter(([id]) => !enc || enc.containers.includes(id));

  const qualityHint = useMemo(() => {
    if (!enc) return '';
    const { min, max } = enc.quality;
    return `${enc.quality.name} ${s.quality} (de ${min} a ${max}: menos = más calidad y más tamaño)`;
  }, [enc, s.quality]);

  return (
    <div className="modal-backdrop">
      <div className="modal compress-dialog">
        <div className="modal-title">Comprimir videos</div>
        <div className="modal-content">
          <div className="compress-files">
            <div className="compress-files-bar">
              <span className="field-label">Videos ({queue.length})</span>
              <span className="footer-spacer" />
              <button onClick={addFiles}>Añadir videos…</button>
              <button onClick={() => onAdd(projectVideos)} disabled={!projectVideos.length} title="Los videos importados en el proyecto">Los del proyecto</button>
              <button onClick={onClearDone} disabled={!queue.some((j) => j.status !== 'waiting' && j.status !== 'running')}>Quitar los terminados</button>
            </div>
            <div
              className="compress-list"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const paths = [...e.dataTransfer.files].map((f) => window.api.getPathForFile(f)).filter((p) => p && VIDEO_EXTENSIONS.test(p));
                if (paths.length) onAdd(paths);
              }}
            >
              {queue.length === 0 && <p className="note">Añade videos con el botón o arrastrándolos aquí desde el Explorador.</p>}
              {queue.map((j) => (
                <div key={j.id} className={`compress-item ${j.status}${current?.id === j.id ? ' selected' : ''}`} onClick={() => setSelected(j.id)}>
                  <div className="compress-name" title={j.path}>{fileName(j.path)}</div>
                  <div className="compress-state">
                    {j.status === 'running' && <div className="progress small"><div style={{ width: `${j.progress?.percent ?? 0}%` }} /></div>}
                    <span>
                      {j.status === 'running' ? compressProgressText(j.progress) : STATUS[j.status]}
                      {j.status === 'done' && ` · ${mb(j.result.inSize)} → ${mb(j.result.size)} (${pct(j.result.size, j.result.inSize)})`}
                      {j.status === 'error' && <span className="queue-error" title={j.error}> · {j.error}</span>}
                    </span>
                  </div>
                  <div className="queue-actions">
                    {j.status === 'done' && <button onClick={(e) => { e.stopPropagation(); window.api.revealFile(j.result.outPath); }}>Mostrar</button>}
                    {j.status !== 'running' && <button onClick={(e) => { e.stopPropagation(); onRemove(j.id); }}>Quitar</button>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="compress-preset">
            <label>
              <span className="field-label">Preajuste</span>
              <select value={store.preset} onChange={(e) => choosePreset(e.target.value)}>
                {PRESETS.filter((p) => !p.gpu || encoders?.some((e) => e.hw)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                {store.user.length > 0 && (
                  <optgroup label="Tus preajustes">
                    {store.user.map((u) => <option key={u.name} value={`user:${u.name}`}>{u.name}</option>)}
                  </optgroup>
                )}
                {store.preset === 'custom' && <option value="custom">Personalizado</option>}
              </select>
            </label>
            <button onClick={savePreset}>Guardar como preajuste…</button>
            {hasPresetUser && <button onClick={deletePreset}>Borrar</button>}
          </div>

          <div className="compress-tabs">
            {[['video', 'Video'], ['picture', 'Imagen y filtros'], ['audio', 'Audio y subtítulos']].map(([id, name]) => (
              <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{name}</button>
            ))}
          </div>

          {!encoders && <p className="note">Comprobando los codificadores…</p>}
          {encoders && tab === 'video' && (
            <div className="render-grid">
              <label className="wide">
                <span className="field-label">Codificador</span>
                <select value={s.encoder} onChange={(e) => {
                  const next = encoders.find((x) => x.id === e.target.value);
                  change({ encoder: next.id, quality: next.quality.def, speed: next.defSpeed });
                }}>
                  <optgroup label="Procesador (mejor calidad por tamaño)">
                    {encoders.filter((e) => !e.hw).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </optgroup>
                  {encoders.some((e) => e.hw) && (
                    <optgroup label="Tarjeta gráfica (mucho más rápido)">
                      {encoders.filter((e) => e.hw).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </optgroup>
                  )}
                </select>
              </label>
              <div className="render-range wide">
                <span className="field-label">Control de la calidad</span>
                <label>
                  <input type="radio" checked={s.mode === 'quality'} onChange={() => change({ mode: 'quality' })} />
                  Calidad constante (recomendado)
                </label>
                {s.mode === 'quality' && enc && (
                  <div className="compress-slider">
                    <input type="range" min={enc.quality.min} max={enc.quality.max} step={1} value={s.quality} onChange={(e) => change({ quality: Number(e.target.value) })} />
                    <span className="note">{qualityHint}</span>
                  </div>
                )}
                <label>
                  <input type="radio" checked={s.mode === 'bitrate'} onChange={() => change({ mode: 'bitrate' })} />
                  Tasa de bits media
                </label>
                {s.mode === 'bitrate' && (
                  <div className="compress-inline">
                    <input type="number" min={100} max={200000} step={100} value={s.kbps} onChange={(e) => change({ kbps: Math.max(100, Number(e.target.value) || 0) })} /> kbps
                    {enc?.twoPass && (
                      <label className="compress-check">
                        <input type="checkbox" checked={s.twoPass} onChange={(e) => change({ twoPass: e.target.checked })} />
                        Dos pasadas (más preciso, tarda el doble)
                      </label>
                    )}
                  </div>
                )}
                <label>
                  <input type="radio" checked={s.mode === 'size'} onChange={() => change({ mode: 'size' })} />
                  Tamaño del archivo
                </label>
                {s.mode === 'size' && (
                  <div className="compress-inline">
                    <input type="number" min={1} max={100000} step={1} value={s.sizeMB} onChange={(e) => change({ sizeMB: Math.max(1, Number(e.target.value) || 0) })} /> MB como máximo
                    <span className="note">
                      {enc?.twoPass ? ' · a dos pasadas' : ' · con la tarjeta gráfica el tamaño es aproximado'}
                      {info?.sizeKbps != null && ` · video a ${info.sizeKbps > 0 ? info.sizeKbps : 0} kbps`}
                    </span>
                  </div>
                )}
              </div>
              <label className="wide">
                <span className="field-label">Velocidad del codificador: {enc?.speeds[s.speed]} (más lento = archivo más pequeño con la misma calidad)</span>
                <input type="range" min={0} max={(enc?.speeds.length || 1) - 1} step={1} value={s.speed} onChange={(e) => change({ speed: Number(e.target.value) })} />
              </label>
              {enc?.tunes && (
                <label>
                  <span className="field-label">Ajustar para</span>
                  <select value={s.tune} onChange={(e) => change({ tune: e.target.value })}>
                    {enc.tunes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </label>
              )}
              <label>
                <span className="field-label">Fotogramas por segundo</span>
                <select value={s.fps} onChange={(e) => change({ fps: Number(e.target.value) })}>
                  {FPS.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
                </select>
              </label>
              {s.fps > 0 && (
                <div className="render-range">
                  <label title="Si el original tiene menos, se deja como está">
                    <input type="checkbox" checked={s.fpsPeak} onChange={(e) => change({ fpsPeak: e.target.checked })} />
                    Como máximo (no subir los de los videos que tengan menos)
                  </label>
                </div>
              )}
              {enc?.tenBit && (
                <div className="render-range">
                  <label title="Menos bandas en los degradados; algunos reproductores antiguos no lo admiten. Necesario para conservar el HDR.">
                    <input type="checkbox" checked={s.tenBit} onChange={(e) => change({ tenBit: e.target.checked })} />
                    10 bits
                  </label>
                </div>
              )}
            </div>
          )}

          {encoders && tab === 'picture' && (
            <div className="render-grid">
              <label>
                <span className="field-label">Resolución máxima</span>
                <select value={s.maxSize} onChange={(e) => change({ maxSize: Number(e.target.value) })}>
                  {MAX_SIZES.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
                </select>
              </label>
              <label>
                <span className="field-label">Recortar las bandas negras</span>
                <select value={s.crop} onChange={(e) => change({ crop: e.target.value })}>
                  <option value="auto">Automático</option>
                  <option value="none">No</option>
                </select>
              </label>
              <label>
                <span className="field-label">Girar</span>
                <select value={s.rotate} onChange={(e) => change({ rotate: Number(e.target.value) })}>
                  <option value={0}>No</option>
                  <option value={90}>90° a la derecha</option>
                  <option value={180}>180°</option>
                  <option value={270}>90° a la izquierda</option>
                </select>
              </label>
              <label>
                <span className="field-label">Desentrelazar</span>
                <select value={s.deinterlace} onChange={(e) => change({ deinterlace: e.target.value })}>
                  <option value="auto">Automático (solo si hace falta)</option>
                  <option value="on">Siempre</option>
                  <option value="off">No</option>
                </select>
              </label>
              <label>
                <span className="field-label">Reducir el ruido</span>
                <select value={s.denoise} onChange={(e) => change({ denoise: e.target.value })}>
                  <option value="off">No</option>
                  <option value="light">Poco</option>
                  <option value="medium">Medio</option>
                  <option value="strong">Mucho</option>
                </select>
              </label>
              <label>
                <span className="field-label">Enfocar</span>
                <select value={s.sharpen} onChange={(e) => change({ sharpen: e.target.value })}>
                  <option value="off">No</option>
                  <option value="light">Poco</option>
                  <option value="medium">Medio</option>
                </select>
              </label>
              <label className="wide" title="Los videos HDR (de móviles recientes, por ejemplo) se ven apagados en pantallas normales si no se convierten">
                <span className="field-label">Videos HDR</span>
                <select value={s.hdr} onChange={(e) => change({ hdr: e.target.value })}>
                  <option value="sdr">Convertir a SDR (se ven bien en cualquier pantalla)</option>
                  <option value="keep">Mantener el HDR (necesita 10 bits)</option>
                </select>
              </label>
            </div>
          )}

          {encoders && tab === 'audio' && (
            <div className="render-grid">
              <label>
                <span className="field-label">Pistas de audio</span>
                <select value={s.audio.tracks} onChange={(e) => changeAudio({ tracks: e.target.value })}>
                  <option value="all">Todas</option>
                  <option value="first">Solo la primera</option>
                  <option value="none">Ninguna (sin sonido)</option>
                </select>
              </label>
              <label className={s.audio.tracks === 'none' ? 'disabled' : ''}>
                <span className="field-label">Códec</span>
                <select value={s.audio.codec} disabled={s.audio.tracks === 'none'} onChange={(e) => changeAudio({ codec: e.target.value })}>
                  {AUDIO_CODECS.filter(([id]) => s.container !== 'webm' || id === 'opus' || id === 'copy').map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
              <label className={s.audio.codec === 'copy' || s.audio.tracks === 'none' ? 'disabled' : ''}>
                <span className="field-label">Tasa de bits (estéreo)</span>
                <select value={s.audio.kbps} disabled={s.audio.codec === 'copy' || s.audio.tracks === 'none'} onChange={(e) => changeAudio({ kbps: Number(e.target.value) })}>
                  {AUDIO_KBPS.map((k) => <option key={k} value={k}>{k} kbps</option>)}
                </select>
              </label>
              <label className={s.audio.codec === 'copy' || s.audio.tracks === 'none' ? 'disabled' : ''}>
                <span className="field-label">Canales</span>
                <select value={s.audio.mix} disabled={s.audio.codec === 'copy' || s.audio.tracks === 'none'} onChange={(e) => changeAudio({ mix: e.target.value })}>
                  <option value="stereo">Estéreo</option>
                  <option value="mono">Mono</option>
                  <option value="51">5.1 (si el original lo tiene)</option>
                  <option value="keep">Como el original</option>
                </select>
              </label>
              <label>
                <span className="field-label">Subtítulos</span>
                <select value={s.subtitles} onChange={(e) => change({ subtitles: e.target.value })}>
                  <option value="all">Todos</option>
                  <option value="first">Solo los primeros</option>
                  <option value="none">Ninguno</option>
                </select>
              </label>
              <div className="render-range">
                <span className="field-label">Conservar</span>
                <label>
                  <input type="checkbox" checked={s.chapters} onChange={(e) => change({ chapters: e.target.checked })} />
                  Capítulos
                </label>
                <label>
                  <input type="checkbox" checked={s.metadata} onChange={(e) => change({ metadata: e.target.checked })} />
                  Metadatos (título, fecha…)
                </label>
              </div>
            </div>
          )}

          {current && (
            <div className="compress-info">
              {!info && <span className="note">Analizando {fileName(current.path)}…</span>}
              {info?.error && <span className="error">{info.error}</span>}
              {info && !info.error && (
                <>
                  <div className="note">
                    <strong>{fileName(current.path)}</strong>
                    {` · ${formatDuration(info.duration)} · ${mb(info.size)} · ${info.video.codec.toUpperCase()} ${info.video.width}×${info.video.height} → ${info.out.width}×${info.out.height}`}
                    {info.crop && ` · bandas recortadas: ${[info.crop.top && `${info.crop.top} arriba`, info.crop.bottom && `${info.crop.bottom} abajo`, info.crop.left && `${info.crop.left} izq.`, info.crop.right && `${info.crop.right} der.`].filter(Boolean).join(', ')}`}
                    {info.video.interlaced && ' · entrelazado'}
                    {info.video.hdr && ` · HDR${info.tonemap ? ' (se convierte a SDR)' : ''}`}
                    {` · ${info.audio.length} pista${info.audio.length === 1 ? '' : 's'} de audio`}
                    {info.subtitles.length > 0 && ` · ${info.subtitles.length} de subtítulos${s.container !== 'mkv' && info.subtitles.some((t) => !t.text) ? ' (los de imagen solo caben en MKV)' : ''}`}
                  </div>
                  <div className="compress-sample">
                    <button onClick={runSample} disabled={!!sample?.busy || running}>Probar 10 s</button>
                    {sample?.busy && <span className="note">Comprimiendo la muestra… {compressProgressText(sample.progress)}</span>}
                    {sample?.result && (
                      <span className="note">
                        Tamaño estimado: <strong>{mb(sample.result.estimate)}</strong> ({pct(sample.result.estimate, sample.result.inSize)})
                        {` · tardará unos ${formatDuration(Math.max(1, sample.result.seconds))} · `}
                        <a href="#" onClick={(e) => { e.preventDefault(); window.api.compressOpenSample(sample.result.path); }}>Ver la muestra</a>
                      </span>
                    )}
                    {sample?.error && <span className="error">{sample.error}</span>}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="compress-output">
            <label>
              <span className="field-label">Formato</span>
              <select value={s.container} onChange={(e) => change({ container: e.target.value })}>
                {containers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <div className="youtube-dir">
              <span className="field-label">Guardar</span>
              <div className="youtube-url">
                <select value={s.dir ? 'dir' : 'same'} title={s.dir || ''} onChange={(e) => (e.target.value === 'same' ? change({ dir: '' }) : pickDir())}>
                  <option value="same">Junto al original («… (comprimido)»)</option>
                  <option value="dir">{s.dir ? `En la carpeta «${fileName(s.dir)}»` : 'En otra carpeta…'}</option>
                </select>
                {s.dir && <button onClick={pickDir}>Cambiar…</button>}
              </div>
            </div>
          </div>
          <div className="render-range compress-checks">
            {s.container === 'mp4' && (
              <label title="Pone el índice al principio del archivo: se puede empezar a ver mientras se descarga">
                <input type="checkbox" checked={s.webOptimized} onChange={(e) => change({ webOptimized: e.target.checked })} />
                Optimizado para la web
              </label>
            )}
            <label>
              <input type="checkbox" checked={s.importAfter} onChange={(e) => change({ importAfter: e.target.checked })} />
              Importar al proyecto al terminar
            </label>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal-actions">
          {running && <button onClick={onCancel}>Detener</button>}
          <span className="footer-spacer" />
          <button onClick={onClose} title={running ? 'La compresión sigue; el progreso sale en la barra de estado' : ''}>Cerrar</button>
          <button
            className="primary"
            disabled={!encoders || running || !waiting}
            onClick={() => {
              setError('');
              onStart(s);
            }}
          >
            {busyFile ? 'Comprimiendo…' : `Comprimir${waiting > 1 ? ` ${waiting} videos` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
