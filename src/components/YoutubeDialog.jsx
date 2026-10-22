import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../util/time.js';

const VIDEO_FORMATS = [
  { id: 'mp4', name: 'MP4' },
  { id: 'mkv', name: 'MKV' },
  { id: 'webm', name: 'WebM (VP9/AV1 + Opus)' },
  { id: 'mov', name: 'MOV (H.264 + AAC)' },
];
const AUDIO_FORMATS = [
  { id: 'mp3', name: 'MP3' },
  { id: 'm4a', name: 'M4A (AAC)' },
  { id: 'opus', name: 'Opus' },
  { id: 'flac', name: 'FLAC (sin pérdida)' },
  { id: 'wav', name: 'WAV (sin comprimir)' },
];
const AUDIO_QUALITY = [
  { id: '0', name: 'La mejor' },
  { id: '320K', name: '320 kbps' },
  { id: '192K', name: '192 kbps' },
  { id: '128K', name: '128 kbps' },
];
const LIST_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];
const THUMB_VIDEO = ['mp4', 'mkv', 'mov'];
const THUMB_AUDIO = ['mp3', 'm4a', 'opus', 'flac'];

const DEFAULTS = {
  kind: 'video', container: 'mp4', compat: true, height: 0, audioFormat: 'mp3', audioQuality: '0',
  metadata: true, thumbnail: true, chapters: true, subtitles: false, dir: '', importAfter: true,
};
const STORE = 'cortex-youtube';
function loadOptions() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveOptions(o) {
  try {
    localStorage.setItem(STORE, JSON.stringify(o));
  } catch {}
}

const heightName = (h) => `${h}p${h >= 2160 ? ' (4K)' : h >= 1440 ? ' (2K)' : ''}`;
const isUrl = (s) => /^https?:\/\/\S+$/i.test(s.trim());
const fileName = (p) => p.split(/[\\/]/).pop();
const mb = (bytes) => (bytes / 1048576).toLocaleString('es-ES', { maximumFractionDigits: 1 });
const ytDate = (d) => (d && d.length === 8 ? `${d.slice(6)}/${d.slice(4, 6)}/${d.slice(0, 4)}` : '');

// Texto del progreso de una descarga (también lo usa la barra de estado).
export function youtubeProgressText(p) {
  if (!p) return 'Empezando…';
  if (p.stage === 'install') return `Instalando yt-dlp (solo la primera vez)${p.percent != null ? ` · ${Math.floor(p.percent)} %` : '…'}`;
  if (p.stage === 'update') return 'Buscando actualizaciones de yt-dlp…';
  const item = p.count > 1 ? `Video ${p.index} de ${p.count} · ` : '';
  if (p.stage === 'processing') return `${item}Procesando (uniendo, convirtiendo y añadiendo los metadatos)…`;
  const what = p.part === 'audio' ? 'Descargando el audio' : p.part === 'video' ? 'Descargando la imagen' : 'Descargando';
  const pct = p.percent != null ? ` · ${Math.floor(p.percent)} %` : '';
  const speed = p.speed ? ` · ${mb(p.speed)} MB/s` : '';
  const eta = p.eta != null && p.eta > 0 ? ` · quedan ${formatDuration(p.eta)}` : '';
  return `${item}${what}${pct}${speed}${eta}`;
}

// Descargar de YouTube (o de otro sitio que admita yt-dlp) a cualquier formato, con los metadatos, la portada, los
// capítulos y los subtítulos dentro del archivo. La descarga la lleva App (`job`): sigue aunque se cierre la ventana.
export default function YoutubeDialog({ job, onDownload, onCancel, onClose }) {
  const [url, setUrl] = useState('');
  const [playlist, setPlaylist] = useState(false);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(null); // texto mientras se busca
  const [error, setError] = useState('');
  const [opts, setOpts] = useState(loadOptions);
  const urlRef = useRef(null);
  const running = job?.status === 'running';

  const change = (patch) => setOpts((o) => {
    const next = { ...o, ...patch };
    saveOptions(next);
    return next;
  });

  useEffect(() => {
    if (!opts.dir) window.api.youtubeDefaultDir().then((dir) => change({ dir }));
    // Si hay un enlace en el portapapeles, se pone solo.
    navigator.clipboard?.readText().then((t) => {
      if (isUrl(t || '')) setUrl((u) => u || t.trim());
    }).catch(() => {});
    urlRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Mientras se busca, la instalación o actualización de yt-dlp avisa por el mismo canal que la descarga.
  useEffect(() => {
    if (!loading) return undefined;
    return window.api.onYoutubeProgress((p) => {
      if (p.stage === 'install' || p.stage === 'update') setLoading(youtubeProgressText(p));
    });
  }, [!!loading]);

  const search = async (list = playlist) => {
    if (!isUrl(url)) {
      setError('Pega un enlace de YouTube (https://…).');
      return;
    }
    setError('');
    setInfo(null);
    setLoading(list ? 'Leyendo la lista…' : 'Buscando el video…');
    try {
      setInfo(await window.api.youtubeInfo(url.trim(), list));
    } catch (err) {
      setError(cleanError(err));
    }
    setLoading(null);
  };

  const togglePlaylist = (on) => {
    setPlaylist(on);
    if (info) search(on);
  };

  const pickDir = async () => {
    const dir = await window.api.pickFolder('Carpeta de las descargas', opts.dir);
    if (dir) change({ dir });
  };

  const download = () => {
    const { importAfter, ...rest } = opts;
    onDownload({ ...rest, url: url.trim(), playlist: !!info?.playlist }, importAfter, info?.title || url);
  };

  const audio = opts.kind === 'audio';
  const ext = audio ? opts.audioFormat : opts.container;
  const canThumb = (audio ? THUMB_AUDIO : THUMB_VIDEO).includes(ext);
  const canSubs = !audio && ext !== 'mov';
  const heights = info?.playlist ? LIST_HEIGHTS : (info?.heights || []).filter((h) => h >= 144);
  const hasList = /[?&]list=/.test(url);

  return (
    <div className="modal-backdrop">
      <div className="modal youtube-dialog">
        <div className="modal-title">Descargar de YouTube</div>
        <div className="modal-content">
          <label>
            <span className="field-label">Enlace del video o de la lista</span>
            <div className="youtube-url">
              <input
                ref={urlRef}
                type="text"
                value={url}
                placeholder="https://www.youtube.com/watch?v=…"
                spellCheck={false}
                onChange={(e) => { setUrl(e.target.value); setInfo(null); setError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
              />
              <button onClick={() => search()} disabled={!!loading || !url.trim()}>Buscar</button>
            </div>
          </label>
          {hasList && (
            <div className="render-range">
              <label>
                <input type="checkbox" checked={playlist} onChange={(e) => togglePlaylist(e.target.checked)} disabled={!!loading} />
                Descargar la lista entera (si no, solo este video)
              </label>
            </div>
          )}
          {loading && <p className="note">{loading}</p>}
          {error && <p className="error">{error}</p>}

          {info && (
            <div className="youtube-info">
              {info.thumbnail && <img src={info.thumbnail} alt="" referrerPolicy="no-referrer" />}
              <div>
                <div className="youtube-title">{info.title}</div>
                <div className="note">
                  {[
                    info.uploader,
                    info.playlist ? `Lista · ${info.count} videos` : info.duration ? formatDuration(info.duration) : '',
                    ytDate(info.date),
                    info.chapters ? `${info.chapters} capítulos` : '',
                    info.subtitles?.length ? `subtítulos: ${info.subtitles.slice(0, 6).join(', ')}${info.subtitles.length > 6 ? '…' : ''}` : '',
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
          )}

          {info && (
            <>
              <div className="render-grid">
                <label>
                  <span className="field-label">Descargar</span>
                  <select value={opts.kind} onChange={(e) => change({ kind: e.target.value })}>
                    <option value="video">Video con sonido</option>
                    <option value="audio">Solo el audio</option>
                  </select>
                </label>
                <label>
                  <span className="field-label">Formato</span>
                  {audio ? (
                    <select value={opts.audioFormat} onChange={(e) => change({ audioFormat: e.target.value })}>
                      {AUDIO_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  ) : (
                    <select value={opts.container} onChange={(e) => change({ container: e.target.value })}>
                      {VIDEO_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  )}
                </label>
                {audio ? (
                  <label className={['flac', 'wav'].includes(opts.audioFormat) ? 'disabled' : ''}>
                    <span className="field-label">Calidad</span>
                    <select value={opts.audioQuality} disabled={['flac', 'wav'].includes(opts.audioFormat)} onChange={(e) => change({ audioQuality: e.target.value })}>
                      {AUDIO_QUALITY.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <>
                    <label>
                      <span className="field-label">Resolución máxima</span>
                      <select value={opts.height} onChange={(e) => change({ height: Number(e.target.value) })}>
                        <option value={0}>La mejor{!info.playlist && heights[0] ? ` (${heightName(heights[0])})` : ''}</option>
                        {heights.map((h) => <option key={h} value={h}>{heightName(h)}</option>)}
                      </select>
                    </label>
                    {(opts.container === 'mp4' || opts.container === 'mkv') && (
                      <label title="H.264 se reproduce en cualquier sitio, pero YouTube solo lo da hasta 1080p. VP9 y AV1 llegan a 4K u 8K.">
                        <span className="field-label">Códec de video</span>
                        <select value={opts.compat ? 'h264' : 'best'} onChange={(e) => change({ compat: e.target.value === 'h264' })}>
                          <option value="h264">H.264 (el más compatible, hasta 1080p)</option>
                          <option value="best">El mejor (VP9 o AV1, hasta 4K)</option>
                        </select>
                      </label>
                    )}
                  </>
                )}
              </div>

              <div className="render-range">
                <span className="field-label">Incluir en el archivo</span>
                <label>
                  <input type="checkbox" checked={opts.metadata} onChange={(e) => change({ metadata: e.target.checked })} />
                  Metadatos (título, autor, fecha, descripción y enlace)
                </label>
                <label className={canThumb ? '' : 'disabled'}>
                  <input type="checkbox" checked={opts.thumbnail && canThumb} disabled={!canThumb} onChange={(e) => change({ thumbnail: e.target.checked })} />
                  {canThumb ? 'Portada (la miniatura del video)' : `Portada (no se puede en ${ext.toUpperCase()})`}
                </label>
                <label>
                  <input type="checkbox" checked={opts.chapters} onChange={(e) => change({ chapters: e.target.checked })} />
                  Capítulos
                </label>
                <label className={canSubs ? '' : 'disabled'}>
                  <input type="checkbox" checked={opts.subtitles && canSubs} disabled={!canSubs} onChange={(e) => change({ subtitles: e.target.checked })} />
                  Subtítulos en español e inglés, si los hay
                </label>
              </div>

              <div className="youtube-dir">
                <span className="field-label">Carpeta</span>
                <div className="youtube-url">
                  <input type="text" value={opts.dir} readOnly title={opts.dir} />
                  <button onClick={pickDir}>Cambiar…</button>
                </div>
              </div>
              <div className="render-range">
                <label>
                  <input type="checkbox" checked={opts.importAfter} onChange={(e) => change({ importAfter: e.target.checked })} />
                  Importar al proyecto al terminar
                </label>
              </div>
            </>
          )}

          {job && (
            <div className="youtube-job">
              <div className="note"><strong>{job.title}</strong></div>
              {job.status === 'running' && (
                <>
                  <div className="progress"><div style={{ width: `${job.progress?.percent ?? 0}%` }} /></div>
                  <p className="progress-label">{youtubeProgressText(job.progress)}</p>
                </>
              )}
              {job.status === 'done' && (
                <p className="note">
                  {job.files.length === 1 ? `Descargado: ${fileName(job.files[0])}` : `Descargados ${job.files.length} archivos`}
                  {job.imported ? ' (importado al proyecto)' : ''}
                  {' · '}
                  <a href="#" onClick={(e) => { e.preventDefault(); window.api.revealFile(job.files[0]); }}>Mostrar en la carpeta</a>
                </p>
              )}
              {job.error && <p className="error">{job.status === 'done' ? `Alguno ha fallado: ${job.error}` : job.error}</p>}
              {job.status === 'canceled' && <p className="note">Descarga cancelada.</p>}
            </div>
          )}

          <p className="note">Descarga solo contenido que tengas derecho a usar. También funciona con muchos otros sitios de video.</p>
        </div>
        <div className="modal-actions">
          {running && <button onClick={onCancel}>Cancelar la descarga</button>}
          <span className="footer-spacer" />
          <button onClick={onClose} title={running ? 'La descarga sigue; el progreso sale en la barra de estado' : ''}>Cerrar</button>
          <button className="primary" onClick={download} disabled={!info || running || !opts.dir}>Descargar</button>
        </div>
      </div>
    </div>
  );
}

// Los errores de ipcRenderer.invoke llegan como «Error invoking remote method 'x': Error: …».
export function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
