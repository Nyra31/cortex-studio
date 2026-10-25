import { useCallback, useEffect, useRef, useState } from 'react';
import MenuBar from './components/MenuBar.jsx';
import Toolbar from './components/Toolbar.jsx';
import Dock from './components/Dock.jsx';
import MediaPool from './components/MediaPool.jsx';
import TransitionsPanel from './components/TransitionsPanel.jsx';
import EffectsPanel from './components/EffectsPanel.jsx';
import EventFxDialog from './components/EventFxDialog.jsx';
import TextDialog from './components/TextDialog.jsx';
import PanDialog from './components/PanDialog.jsx';
import Preview from './components/Preview.jsx';
import Transport from './components/Transport.jsx';
import Timeline, { MAX_PPS, MIN_PPS, gridStep } from './components/Timeline.jsx';
import { quantize } from './util/time.js';
import RenderDialog from './components/RenderDialog.jsx';
import QueueDialog from './components/QueueDialog.jsx';
import YoutubeDialog, { youtubeProgressText, cleanError } from './components/YoutubeDialog.jsx';
import CompressDialog, { compressProgressText } from './components/CompressDialog.jsx';
import Scopes from './components/Scopes.jsx';
import SubtitlesPanel from './components/SubtitlesPanel.jsx';
import { addCue, importCues, parseSubtitles, tidyCues } from './state/subtitles.js';
import TranscribeDialog from './components/TranscribeDialog.jsx';
import ProjectDialog from './components/ProjectDialog.jsx';
import ShortcutsDialog from './components/ShortcutsDialog.jsx';
import RecordDialog from './components/RecordDialog.jsx';
import { useHistory } from './state/useHistory.js';
import ContextMenu from './components/ContextMenu.jsx';
import {
  EVENT_DEFAULTS, FADE_CURVES, IMAGE_DURATION, MIN_EVENT, addMarker, addRegion, addTrack, copyEvents, deleteMark, deleteRange, emptyProject, markPoints, fitSize, groupEvents, loadProject, loadView, mediaLength, pasteEvents,
  freezeFrame as freezeFrameAt, setReversed, setStabilized, setDenoised, splitAtSourceTimes, placeMedia, projectDuration, removeMedia, sourceTime, renderPayload, rippleDelete, rippleShift, serializeProject, splitEvents, uid,
  moveTrack, splitRange, trimToCursor, ungroupEvents, updateEvents,
} from './state/project.js';
import { TEXT_DEFAULTS, isText, newTextMedia, withTextThumb } from './state/text.js';
import { panActive, setPanValues } from './state/pan.js';
import { hasRamp, shiftSpeed, sourceOffset } from './state/speed.js';
import { transitionLabel } from './state/transitions.js';
import { Recorder, loadRecordSettings, micError } from './preview/recorder.js';
import { LANGUAGES, lang, locale, tx } from './i18n/index.js';

const api = window.api;
const FREEZE_S = 2; // duración del fotograma congelado
const AUTOSAVE_MS = 60 * 1000; // guardado automático (copia de recuperación) cada minuto si hay cambios

// Escala con la que la imagen del evento llena todo el cuadro (sin bandas), para «Llenar el cuadro».
function panFill(project, e) {
  const m = project.media.find((x) => x.id === e.mediaId);
  const { width: W, height: H } = project.settings;
  const fit = m && (isText(m) ? { w: W, h: H } : fitSize(m.width, m.height, W, H));
  return fit ? Math.max(W / fit.w, H / fit.h) : null;
}
const baseName = (p) => (p ? p.split(/[\\/]/).pop().replace(/\.cortex$/i, '') : tx('Sin título'));

export default function App() {
  const history = useHistory(emptyProject());
  const project = history.state;
  const setProject = history.set;
  const [savedProject, setSavedProject] = useState(project);
  const [projectPath, setProjectPath] = useState(null);
  const [selection, setSelection] = useState([]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playToken, setPlayToken] = useState(0);
  const [pps, setPps] = useState(40);
  const [snap, setSnap] = useState(true);
  // Edición en cascada (Ctrl+L): null (desactivada), 'tracks' (pistas afectadas) o 'all' (todas las pistas).
  const [ripple, setRipple] = useState(null);
  const [rippleMode, setRippleMode] = useState('tracks'); // modo que se usa al activarla
  const [upperHeight, setUpperHeight] = useState(Math.round(window.innerHeight * 0.44));
  const [renderOpen, setRenderOpen] = useState(false);
  // Cola de render: trabajos { id, name, outPath, payload, settings, status, progress, error } (no se guarda).
  const [queue, setQueue] = useState([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [youtubeJob, setYoutubeJob] = useState(null); // { status, title, progress, files, imported, error }
  const [compressOpen, setCompressOpen] = useState(false);
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [compressQueue, setCompressQueue] = useState([]); // { id, path, status, progress, result, error }
  const [compressRunning, setCompressRunning] = useState(false);
  const compressRef = useRef({ queue: [], stop: false });
  compressRef.current.queue = compressQueue;
  const [projectDialog, setProjectDialog] = useState('startup'); // null | 'startup' | 'new' | 'edit'
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [leftTab, setLeftTab] = useState('media'); // 'media' | 'transitions' | 'effects' | 'audioEffects' | 'subtitles' | 'scopes'
  const [focusCue, setFocusCue] = useState(null); // subtítulo cuyo texto se va a editar en su pestaña
  const clearFocusCue = useCallback(() => setFocusCue(null), []);
  const editSubtitle = useCallback((id) => {
    setLeftTab('subtitles');
    setFocusCue(id);
  }, []);
  const [fxEventId, setFxEventId] = useState(null); // evento cuya ventana de efectos está abierta
  const [textMediaId, setTextMediaId] = useState(null); // medio de texto cuya ventana de edición está abierta
  const [panEventId, setPanEventId] = useState(null); // evento cuya ventana de panorámica/recorte está abierta
  const [region, setRegion] = useState(null); // selección de tiempo { start, end } (la región de bucle de VEGAS)
  const [loop, setLoop] = useState(false); // reproducción en bucle de la selección de tiempo (Q)
  const [fullScreen, setFullScreen] = useState(false); // pantalla completa (F11), lo avisa el proceso principal
  const [clipboard, setClipboard] = useState(null); // eventos copiados (copyEvents)
  const [contextMenu, setContextMenu] = useState(null); // { x, y, items }
  // Actualizaciones: estado que manda el proceso principal y si el aviso de «lista para instalar» está cerrado.
  const [update, setUpdate] = useState({ status: 'idle' });
  const [updateHidden, setUpdateHidden] = useState(false);
  const [version, setVersion] = useState('');
  // Grabación de voz en off: pista preparada (armada) para grabar, grabación en curso y ventana de ajustes.
  const [armedTrackId, setArmedTrackId] = useState(null);
  const [recording, setRecording] = useState(null); // { trackId, start } mientras se graba
  const [recordDialog, setRecordDialog] = useState(false);
  const recorderRef = useRef(null);
  const previewCommands = useRef(null); // { toggleFullScreen } (los pone la vista previa)
  const togglePreviewFull = useCallback(() => previewCommands.current?.toggleFullScreen(), []);
  const timelineRef = useRef(null);

  const duration = projectDuration(project);
  const dirty = project !== savedProject;
  const live = useRef(null);
  live.current = { project, time, playing, duration, dirty, selection, clipboard, pps, region, loop, ripple, projectPath, recording, armedTrackId };
  const playStart = useRef(0);

  useEffect(() => {
    document.title = tx('{baseName}{n} - Cortex Studio', { baseName: baseName(projectPath), n: dirty ? ' *' : '' });
  }, [projectPath, dirty]);

  // Reloj de reproducción: avanza desde playStart y se reinicia cuando el usuario busca otra posición.
  // Si empieza dentro de la selección de tiempo, se para al final de ella o, en bucle (Q), vuelve a su principio.
  // Grabando, sigue después del final del proyecto (y sin bucle).
  useEffect(() => {
    if (!playing) return undefined;
    const from = playStart.current;
    const t0 = performance.now();
    recorderRef.current?.begin(); // la grabación empieza a la vez que el reloj
    let raf;
    const tick = () => {
      const t = from + (performance.now() - t0) / 1000;
      const { region: r, loop: looping, duration: d, recording: rec } = live.current;
      const inRegion = r && from >= r.start - 1e-6 && from < r.end;
      const end = inRegion ? r.end : rec ? Infinity : d;
      if (t >= end) {
        if (inRegion && looping && !rec) {
          playStart.current = r.start;
          setTime(r.start);
          setPlayToken((n) => n + 1);
          return;
        }
        setTime(end);
        setPlaying(false);
        return;
      }
      setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, playToken]);

  const seek = useCallback((t) => {
    const clamped = Math.max(0, t);
    setTime(clamped);
    if (live.current.recording) {
      setPlaying(false); // ir a otro sitio termina la grabación
    } else if (live.current.playing) {
      playStart.current = clamped;
      setPlayToken((n) => n + 1);
    }
  }, []);
  // Para las pruebas automáticas (llevar el cursor a un instante exacto).
  useEffect(() => {
    if (window.cortexPruebas) window.cortexPruebas.seek = seek;
  }, [seek]);

  // Con selección de tiempo, si el cursor está fuera de ella, se reproduce desde su principio (como en VEGAS).
  const play = useCallback(() => {
    const { playing: isPlaying, time: t, duration: d, region: r } = live.current;
    if (isPlaying || (d <= 0 && !r)) return;
    let from = t >= d - 0.01 ? 0 : t;
    if (r && (t < r.start || t >= r.end - 1e-6)) from = r.start;
    playStart.current = from;
    setTime(from);
    setPlaying(true);
  }, []);

  // Al pausar, el cursor se queda en el fotograma que se estaba viendo.
  const pause = useCallback(() => {
    setPlaying(false);
    setTime((t) => quantize(t, live.current.project.settings.fps));
  }, []);

  // Detener: vuelve a donde empezó la reproducción (o al inicio si ya estaba detenido).
  const stop = useCallback(() => {
    if (live.current.playing) {
      setPlaying(false);
      setTime(playStart.current);
    } else {
      setTime(0);
    }
  }, []);

  const stepFrame = useCallback((direction) => {
    setPlaying(false);
    const step = 1 / live.current.project.settings.fps;
    setTime((t) => Math.max(0, Math.round(t / step + direction) * step));
  }, []);

  // Siguiente/anterior punto de edición (principio o final de un evento), como Ctrl+←/→ en VEGAS.
  const jumpToEdit = useCallback((direction) => {
    const { project: p, time: t } = live.current;
    const points = [...new Set([0, ...markPoints(p), ...p.events.flatMap((e) => [e.start, e.start + e.duration])])].sort((a, b) => a - b);
    const target = direction > 0 ? points.find((x) => x > t + 1e-6) : points.reverse().find((x) => x < t - 1e-6);
    if (target !== undefined) {
      setPlaying(false);
      setTime(target);
    }
  }, []);

  // Re Pág / Av Pág: una marca de la rejilla de la regla (depende del zoom).
  const stepGrid = useCallback((direction) => {
    const { time: t, project: p } = live.current;
    const step = gridStep(live.current.pps);
    setPlaying(false);
    setTime(quantize(Math.max(0, (Math.round(t / step) + direction) * step), p.settings.fps));
  }, []);

  // ---- Cola de render ----
  const setJob = useCallback((id, changes) => setQueue((q) => q.map((j) => (j.id === id ? { ...j, ...changes } : j))), []);
  const enqueueRenders = useCallback((jobs, startNow) => {
    setQueue((q) => [...q, ...jobs.map((j) => ({ ...j, id: uid('r'), status: 'waiting', progress: 0, error: null }))]);
    if (startNow) setQueueRunning(true);
    setStatus(startNow ? tx('Renderizando {length} archivo(s) con la cola de render.', { length: jobs.length }) : tx('Añadido a la cola de render (Archivo → Cola de render…).'));
  }, []);
  // Con la cola en marcha, se renderiza el siguiente trabajo en espera; al acabarse, se para.
  useEffect(() => {
    if (!queueRunning || queue.some((j) => j.status === 'rendering')) return;
    const next = queue.find((j) => j.status === 'waiting');
    if (!next) {
      setQueueRunning(false);
      const failed = queue.filter((j) => j.status === 'error').length;
      setStatus(failed ? tx('Cola de render terminada con {failed} error(es).', { failed }) : tx('Cola de render terminada.'));
      return;
    }
    setJob(next.id, { status: 'rendering', progress: 0 });
    const off = api.onRenderProgress((p) => setJob(next.id, { progress: p }));
    api.startRender(next.payload, next.settings, next.outPath)
      .then((res) => setJob(next.id, res.ok ? { status: 'done', progress: 1 } : res.canceled ? { status: 'canceled' } : { status: 'error', error: res.error || tx('Error desconocido') }))
      .catch((err) => setJob(next.id, { status: 'error', error: err.message }))
      .finally(off);
  }, [queue, queueRunning, setJob]);

  // ---- Proxies de la vista previa ----
  // Copias ligeras (H.264, ≤720 líneas) de los archivos que el reproductor de la vista previa no puede abrir o que
  // pesan demasiado. proxies: ruta del original → ruta del proxy (no se guarda en el proyecto: al abrirlo, el
  // análisis encuentra los que ya están hechos). proxyJobs: ruta → porcentaje de los que se están creando.
  const [proxies, setProxies] = useState({});
  const [strips, setStrips] = useState({}); // ruta del video → tira de miniaturas (ver Filmstrip)
  const [proxyJobs, setProxyJobs] = useState({});
  const proxyRef = useRef({ ready: {}, busy: new Set() });
  const setProxy = useCallback((filePath, proxy) => {
    const ready = { ...proxyRef.current.ready };
    if (proxy) ready[filePath] = proxy;
    else delete ready[filePath];
    proxyRef.current.ready = ready;
    setProxies(ready);
  }, []);
  const requestProxy = useCallback((filePath, message) => {
    const { ready, busy } = proxyRef.current;
    if (ready[filePath] || busy.has(filePath)) return;
    busy.add(filePath);
    setProxyJobs((j) => ({ ...j, [filePath]: 0 }));
    if (message) setStatus(message);
    api.makeProxy(filePath)
      .then((proxy) => {
        setProxy(filePath, proxy);
        setStatus(tx('Proxy listo: «{baseName}» ya se ve en la vista previa (el render usa el original).', { baseName: baseName(filePath) }));
      })
      .catch((err) => setStatus(tx('No se pudo crear el proxy de «{baseName}»: {message}', { baseName: baseName(filePath), message: err.message })))
      .finally(() => {
        busy.delete(filePath);
        setProxyJobs(({ [filePath]: _done, ...rest }) => rest);
      });
  }, [setProxy]);
  useEffect(() => api.onProxyProgress?.(({ path: p, percent }) => setProxyJobs((j) => (p in j ? { ...j, [p]: percent } : j))), []);
  const removeProxy = useCallback((filePath) => {
    setProxy(filePath, null);
    setTimeout(() => api.removeProxy(filePath), 1500); // cuando la vista previa haya soltado el archivo
  }, [setProxy]);
  // Resultado del análisis de un medio: apunta su proxy si ya existe o lo pide si la vista previa no puede
  // reproducir el archivo. Devuelve los datos del medio (sin los del proxy).
  const noteAnalyzed = useCallback(({ proxy, needsProxy, ...info }) => {
    // Tira de miniaturas para la línea de tiempo (en segundo plano; la primera vez tarda un poco).
    if (info.hasVideo && !info.isImage) {
      api.filmstrip(info.path).then((strip) => setStrips((s) => ({ ...s, [info.path]: strip }))).catch(() => {});
    }
    if (proxy) setProxy(info.path, proxy);
    else if (needsProxy) requestProxy(info.path, tx('La vista previa no puede reproducir «{name}»: creando una copia ligera (proxy)…', { name: info.name }));
    return info;
  }, [requestProxy, setProxy]);
  // La vista previa no ha podido abrir un medio (códec que el equipo no admite, p. ej. algunos HEVC).
  const onMediaError = useCallback((mediaId) => {
    const m = live.current.project.media.find((x) => x.id === mediaId);
    if (!m || m.isImage || isText(m) || m.missing) return;
    requestProxy(m.path, tx('La vista previa no puede reproducir «{name}»: creando una copia ligera (proxy)…', { name: m.name }));
  }, [requestProxy]);
  // Clic derecho en un medio de la ventana de medios.
  const mediaMenu = useCallback((e, m) => {
    const video = !m.isImage && !isText(m) && !m.missing;
    const { ready, busy } = proxyRef.current;
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: tx('Añadir en el cursor'), action: () => setProject((p) => placeMedia(p, m, live.current.time, null)), disabled: m.missing },
        'separator',
        ready[m.path]
          ? { label: tx('Quitar el proxy (la vista previa usará el original)'), action: () => removeProxy(m.path) }
          : {
            label: busy.has(m.path) ? tx('Creando el proxy…') : tx('Crear un proxy para la vista previa'),
            action: () => requestProxy(m.path, tx('Creando una copia ligera (proxy) de «{name}» para la vista previa…', { name: m.name })),
            disabled: !video || busy.has(m.path),
          },
        ...(video ? [{ label: tx('Comprimir…'), action: () => { addToCompress([m.path]); setCompressOpen(true); } }] : []),
        ...(!isText(m) ? [{ label: tx('Abrir la ubicación del archivo'), action: () => api.revealFile(m.path), disabled: m.missing }] : []),
      ],
    });
  }, [removeProxy, requestProxy, setProject]);
  const clearProxies = useCallback(async () => {
    const { count, bytes } = await api.proxyUsage();
    if (!count) {
      window.alert(tx('No hay proxies guardados.'));
      return;
    }
    const mb = (bytes / 1048576).toLocaleString(locale, { maximumFractionDigits: 0 });
    if (!window.confirm(tx('Hay {count} proxies ({mb} MB). ¿Borrarlos? Se volverán a crear cuando hagan falta.', { count, mb }))) return;
    proxyRef.current.ready = {};
    setProxies({});
    setTimeout(() => api.clearProxies().then(() => setStatus(tx('Proxies borrados.'))), 1500);
  }, []);

  // ---- Medios ----

  const importPaths = useCallback(async (paths) => {
    const imported = [];
    const failed = [];
    for (const filePath of paths) {
      const existing = live.current.project.media.find((m) => m.path === filePath);
      if (existing) {
        imported.push(existing);
        continue;
      }
      setStatus(tx('Importando {baseName}…', { baseName: baseName(filePath) }));
      try {
        const media = { id: uid('m'), ...noteAnalyzed(await api.analyzeMedia(filePath)) };
        setProject((p) => ({ ...p, media: [...p.media, media] }));
        imported.push(media);
      } catch {
        failed.push(filePath.split(/[\\/]/).pop());
      }
    }
    setStatus(failed.length ? tx('No se pudieron importar: {join}', { join: failed.join(', ') }) : '');
    return imported;
  }, [noteAnalyzed, setProject]);

  const importDialog = useCallback(async () => {
    const paths = await api.pickMedia();
    if (paths.length) await importPaths(paths);
  }, [importPaths]);

  // Compresor de video (CompressDialog): la lista se comprime de uno en uno con los ajustes del momento de empezar;
  // sigue aunque se cierre la ventana.
  useEffect(() => api.onCompressProgress?.((p) => {
    if (!p.sample) setCompressQueue((q) => q.map((j) => (j.status === 'running' ? { ...j, progress: p } : j)));
  }), []);
  const addToCompress = useCallback((paths) => {
    setCompressQueue((q) => [
      ...q,
      ...[...new Set(paths)].filter((p) => !q.some((j) => j.path === p && j.status === 'waiting')).map((p) => ({ id: uid('c'), path: p, status: 'waiting', progress: null })),
    ]);
  }, []);
  const setCompressJob = (id, patch) => setCompressQueue((q) => q.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  const startCompress = useCallback(async (settings) => {
    compressRef.current.stop = false;
    setCompressRunning(true);
    const outs = [];
    let failed = 0;
    for (;;) {
      const job = compressRef.current.stop ? null : compressRef.current.queue.find((j) => j.status === 'waiting');
      if (!job) break;
      setCompressJob(job.id, { status: 'running', progress: null, error: null });
      compressRef.current.queue = compressRef.current.queue.map((j) => (j.id === job.id ? { ...j, status: 'running' } : j));
      try {
        const r = await api.compressRun(job.path, settings);
        if (r.canceled) {
          setCompressJob(job.id, { status: 'canceled' });
          break;
        }
        setCompressJob(job.id, { status: 'done', result: r });
        outs.push(r.outPath);
      } catch (err) {
        failed++;
        setCompressJob(job.id, { status: 'error', error: cleanError(err) });
      }
      await new Promise((res) => setTimeout(res, 50)); // deja que la lista se actualice antes de buscar el siguiente
    }
    setCompressRunning(false);
    const imported = settings.importAfter && outs.length ? await importPaths(outs) : [];
    if (outs.length || failed) {
      setStatus(tx('Compresión terminada: {length} video{n}{n2}{n3}', { length: outs.length, n: outs.length === 1 ? '' : 's', n2: failed ? tx(', {failed} con error', { failed }) : '', n3: imported.length ? tx(' (importados al proyecto)') : '' }));
    }
  }, [importPaths]);
  const stopCompress = useCallback(() => {
    compressRef.current.stop = true;
    api.compressCancel();
  }, []);

  // Subtítulos automáticos (TranscribeDialog): mezcla el sonido del proyecto (o de la selección) a un WAV temporal
  // con el render de siempre, Whisper lo transcribe y los subtítulos se añaden en tiempos de la línea de tiempo.
  const transcribeCancel = useRef(null);
  const transcribe = useCallback(async (opts, onStatus) => {
    const { project: p, region: r } = live.current;
    const range = opts.what === 'selection' && r ? { start: r.start, end: r.end } : null;
    const size = { width: p.settings.width, height: p.settings.height };
    const target = await api.whisperTempPath();
    transcribeCancel.current = () => api.cancelRender();
    const offMix = api.onRenderProgress((f) => onStatus({ stage: 'mix', percent: f * 100 }));
    let res;
    try {
      res = await api.startRender(renderPayload(p, size, range, { subtitles: 'none' }), { ...size, fps: p.settings.fps, format: 'wav' }, target);
    } finally {
      offMix();
    }
    if (res.canceled) return null;
    if (!res.ok) throw new Error(res.error || tx('No se pudo mezclar el sonido'));
    transcribeCancel.current = () => api.whisperCancel();
    const offW = api.onWhisperProgress(onStatus);
    let srt;
    try {
      srt = await api.whisperTranscribe(target, { model: opts.model, language: opts.language, translate: opts.translate });
    } finally {
      offW();
      transcribeCancel.current = null;
    }
    if (srt === null) return null;
    const offset = range ? Math.ceil(range.start * p.settings.fps - 1e-6) / p.settings.fps : 0; // el render empieza en un fotograma
    const list = tidyCues(parseSubtitles(srt)).map((c) => ({ ...c, start: c.start + offset, end: c.end + offset }));
    if (list.length) setProject((cur) => importCues(cur, list, opts.replace));
    setStatus(list.length ? tx('{length} subtítulos automáticos añadidos.', { length: list.length }) : tx('No se ha reconocido ninguna frase.'));
    if (list.length) setLeftTab('subtitles');
    return list.length;
  }, [setProject]);

  // Descargas de YouTube (YoutubeDialog). Siguen aunque se cierre la ventana; al terminar se importan si se pidió.
  useEffect(() => api.onYoutubeProgress?.((p) => setYoutubeJob((j) => (j?.status === 'running' ? { ...j, progress: p } : j))), []);
  const startDownload = useCallback(async (opts, importAfter, title) => {
    setYoutubeJob({ status: 'running', title, progress: null, files: [] });
    try {
      const r = await api.youtubeDownload(opts);
      if (r.canceled) {
        setYoutubeJob((j) => ({ ...j, status: 'canceled' }));
        setStatus(tx('Descarga cancelada.'));
        return;
      }
      setYoutubeJob((j) => ({ ...j, status: 'done', files: r.files, error: r.error }));
      const imported = importAfter ? await importPaths(r.files) : [];
      if (imported.length) setYoutubeJob((j) => ({ ...j, imported: true }));
      setStatus(tx('Descargado: {what}{n}', { what: r.files.length === 1 ? baseName(r.files[0]) : tx('{length} archivos', { length: r.files.length }), n: imported.length ? tx(' (importado al proyecto)') : '' }));
    } catch (err) {
      setYoutubeJob((j) => ({ ...j, status: 'error', error: cleanError(err) }));
      setStatus(tx('No se pudo descargar: {cleanError}', { cleanError: cleanError(err) }));
    }
  }, [importPaths]);

  const filesToPaths = (files) => files.map((f) => api.getPathForFile(f)).filter(Boolean);

  const dropFilesOnPool = useCallback((files) => importPaths(filesToPaths(files)), [importPaths]);

  const dropFilesOnTimeline = useCallback(async (files, t, target) => {
    const media = await importPaths(filesToPaths(files));
    if (!media.length) return;
    setProject((p) => {
      let next = p;
      let at = t;
      for (const m of media) {
        next = placeMedia(next, m, at, target);
        at += mediaLength(m);
      }
      return next;
    });
  }, [importPaths, setProject]);

  const addAtCursor = useCallback((media) => {
    setProject((p) => placeMedia(p, media, live.current.time, null));
  }, [setProject]);

  const removeMediaItem = useCallback((mediaId) => {
    const used = live.current.project.events.some((e) => e.mediaId === mediaId);
    if (used && !window.confirm(tx('Este medio se usa en la línea de tiempo. ¿Quitarlo junto con sus eventos?'))) return;
    setProject((p) => removeMedia(p, mediaId));
  }, [setProject]);

  // ---- Edición ----

  // S: en el cursor o, con selección de tiempo, en sus dos extremos (como en VEGAS).
  const split = useCallback(() => {
    const r = live.current.region;
    setProject((p) => (r ? splitRange(p, r.start, r.end, selection) : splitEvents(p, live.current.time, selection)));
  }, [selection, setProject]);

  // Alt+[ / Alt+]: recortar el principio o el final del evento seleccionado (y su grupo) hasta el cursor.
  const trimCursor = useCallback((side) => {
    const { selection: sel, time: t, project: p } = live.current;
    const ids = sel.length ? sel : p.events.filter((e) => e.start < t && t < e.start + e.duration).map((e) => e.id);
    const next = trimToCursor(p, ids, t, side);
    if (next === p) setStatus(tx('Para recortar hasta el cursor, el cursor tiene que estar dentro del evento seleccionado.'));
    else setProject(next);
  }, [setProject]);

  // Congelar fotograma: el del evento de video seleccionado en el cursor (o el de más arriba que se vea ahí) pasa a
  // ser una imagen fija de FREEZE_S segundos insertada en el cursor (lo de detrás de esas pistas se aparta).
  const freezeFrame = useCallback(async () => {
    const { project: p, time: t, selection: sel, projectPath: file } = live.current;
    const types = new Map(p.tracks.map((tr) => [tr.id, tr.type]));
    const mediaOf = (e) => p.media.find((m) => m.id === e.mediaId);
    const fits = (e) => types.get(e.trackId) === 'video' && e.start <= t && t < e.start + e.duration
      && mediaOf(e) && !mediaOf(e).isImage && !mediaOf(e).missing;
    const order = new Map(p.tracks.map((tr, i) => [tr.id, i]));
    const candidates = p.events.filter(fits).sort((a, b) => order.get(a.trackId) - order.get(b.trackId));
    const ev = candidates.find((e) => sel.includes(e.id)) || candidates[0];
    if (!ev) {
      setStatus(tx('Para congelar un fotograma, pon el cursor sobre un evento de video.'));
      return;
    }
    setPlaying(false);
    const fps = p.settings.fps;
    const at = Math.floor(t * fps + 1e-6) / fps; // el fotograma que se ve
    try {
      setStatus(tx('Extrayendo el fotograma…'));
      const path = await api.extractFrame(mediaOf(ev).path, sourceTime(ev, at), file);
      const media = { id: uid('m'), ...noteAnalyzed(await api.analyzeMedia(path)) };
      setProject((cur) => freezeFrameAt(cur, ev.id, at, media, FREEZE_S));
      setStatus(tx('Fotograma congelado ({FREEZE_S} s), guardado en {path}. Arrastra su borde para cambiar la duración.', { FREEZE_S, path }));
    } catch (err) {
      setStatus(tx('No se pudo congelar el fotograma: {message}', { message: err.message }));
    }
  }, [noteAnalyzed, setProject]);

  // Invertir un evento (y su grupo): FFmpeg genera el trozo de medio que usa al revés (en «Invertidos») y el evento
  // pasa a usarlo; si ya estaba invertido, vuelve al original.
  const reverseEvent = useCallback(async (ev) => {
    if (ev.reversed) {
      setProject((cur) => setReversed(cur, ev.id, null));
      setStatus(tx('El evento vuelve a reproducirse hacia delante.'));
      return;
    }
    const { project: p, projectPath: file } = live.current;
    const m = p.media.find((x) => x.id === ev.mediaId);
    if (!m || m.isImage || m.missing || isText(m)) return;
    setPlaying(false);
    const span = sourceOffset(ev, ev.duration);
    const off = api.onReverseProgress((f) => setStatus(tx('Invirtiendo «{name}»: {round} %…', { name: m.name, round: Math.round(f * 100) })));
    try {
      setStatus(tx('Invirtiendo «{name}»…', { name: m.name }));
      const out = await api.reverseClip(m.path, ev.inPoint, span, file, { hasVideo: !!m.hasVideo, hasAudio: !!m.hasAudio, fps: m.fps || null });
      const media = { id: uid('m'), ...noteAnalyzed(await api.analyzeMedia(out)) };
      setProject((cur) => setReversed(cur, ev.id, media, ev.inPoint, span));
      setStatus(tx('Evento invertido (guardado en {out}).', { out }));
    } catch (err) {
      setStatus(tx('No se pudo invertir: {message}', { message: err.message }));
    } finally {
      off();
    }
  }, [noteAnalyzed, setProject]);

  // Estabilizar un evento de video (y su sonido): vid.stab genera el trozo que usa estabilizado (en «Estabilizados») y
  // el evento pasa a usarlo; smoothing = null lo devuelve al de antes.
  const stabilizeEvent = useCallback(async (ev, smoothing) => {
    if (smoothing === null) {
      setProject((cur) => setStabilized(cur, ev.id, null));
      setStatus(tx('Se ha quitado la estabilización.'));
      return;
    }
    const { project: p, projectPath: file } = live.current;
    const m = p.media.find((x) => x.id === ev.mediaId);
    if (!m || m.isImage || m.missing || !m.hasVideo) return;
    setPlaying(false);
    // Un poco de medio de más a cada lado (si lo hay): vid.stab necesita fotogramas vecinos para suavizar los bordes.
    const pad = 1;
    const start = Math.max(0, ev.inPoint - pad);
    const end = Math.min(m.duration || Infinity, ev.inPoint + sourceOffset(ev, ev.duration) + pad);
    const off = api.onStabilizeProgress((f) => setStatus(tx('Estabilizando «{name}»: {round} %…', { name: m.name, round: Math.round(f * 100) })));
    try {
      setStatus(tx('Estabilizando «{name}»…', { name: m.name }));
      const out = await api.stabilizeClip(m.path, start, end - start, file, { hasAudio: !!m.hasAudio, smoothing });
      const media = { id: uid('m'), ...noteAnalyzed(await api.analyzeMedia(out)) };
      setProject((cur) => setStabilized(cur, ev.id, media, start));
      setStatus(tx('Evento estabilizado (guardado en {out}).', { out }));
    } catch (err) {
      setStatus(tx('No se pudo estabilizar: {message}', { message: err.message }));
    } finally {
      off();
    }
  }, [noteAnalyzed, setProject]);

  // Reducir el ruido de un evento de audio: FFmpeg (afftdn) genera el sonido del trozo que usa, limpio (en «Sin
  // ruido»), y el evento pasa a usarlo; strength = null lo devuelve al de antes.
  const denoiseEvent = useCallback(async (ev, strength) => {
    if (strength === null) {
      setProject((cur) => setDenoised(cur, ev.id, null));
      setStatus(tx('Se ha quitado la reducción de ruido.'));
      return;
    }
    const { project: p, projectPath: file } = live.current;
    const m = p.media.find((x) => x.id === ev.mediaId);
    if (!m || m.missing || !m.hasAudio) return;
    setPlaying(false);
    // Un poco de medio de más a cada lado: afftdn aprende el ruido sobre la marcha.
    const start = Math.max(0, ev.inPoint - 1);
    const end = Math.min(m.duration || Infinity, ev.inPoint + sourceOffset(ev, ev.duration) + 1);
    const off = api.onDenoiseProgress((f) => setStatus(tx('Reduciendo el ruido de «{name}»: {round} %…', { name: m.name, round: Math.round(f * 100) })));
    try {
      setStatus(tx('Reduciendo el ruido de «{name}»…', { name: m.name }));
      const out = await api.denoiseClip(m.path, start, end - start, file, strength);
      const media = { id: uid('m'), ...noteAnalyzed(await api.analyzeMedia(out)) };
      setProject((cur) => setDenoised(cur, ev.id, media, start));
      setStatus(tx('Ruido reducido (guardado en {out}).', { out }));
    } catch (err) {
      setStatus(tx('No se pudo reducir el ruido: {message}', { message: err.message }));
    } finally {
      off();
    }
  }, [noteAnalyzed, setProject]);

  // Detectar escenas: divide el evento de video (y su grupo) en cada cambio de plano del trozo de medio que usa.
  const detectScenes = useCallback(async (ev) => {
    const m = live.current.project.media.find((x) => x.id === ev.mediaId);
    if (!m || m.isImage || m.missing) return;
    setPlaying(false);
    const off = api.onScenesProgress((p) => setStatus(tx('Buscando cambios de plano en «{name}»: {round} %…', { name: m.name, round: Math.round(p * 100) })));
    try {
      setStatus(tx('Buscando cambios de plano en «{name}»…', { name: m.name }));
      const times = await api.detectScenes(m.path, ev.inPoint, sourceOffset(ev, ev.duration));
      const res = splitAtSourceTimes(live.current.project, ev.id, times);
      if (res.cuts) setProject(res.project);
      setStatus(res.cuts ? tx('{cuts} cambio(s) de plano: el evento queda dividido en {n} partes.', { cuts: res.cuts, n: res.cuts + 1 }) : tx('No se han encontrado cambios de plano en el evento.'));
    } catch (err) {
      setStatus(tx('No se pudieron detectar las escenas: {message}', { message: err.message }));
    } finally {
      off();
    }
  }, [setProject]);

  // Exportar el fotograma del cursor como PNG, al tamaño del proyecto (se renderiza con FFmpeg: sale igual
  // que en el render, con efectos, textos y transiciones).
  const exportFrame = useCallback(async () => {
    const { project: p, time: t, projectPath: file } = live.current;
    const fps = p.settings.fps;
    const frame = Math.min(Math.floor(t * fps + 1e-6), Math.max(0, Math.ceil(projectDuration(p) * fps) - 1));
    if (projectDuration(p) <= 0) return;
    const name = `${baseName(file)} ${String(frame).padStart(5, '0')}.png`;
    const target = await api.pickRenderPath(name, { name: tx('Imagen PNG'), ext: 'png' });
    if (!target) return;
    setStatus(tx('Exportando el fotograma…'));
    const size = { width: p.settings.width, height: p.settings.height };
    const range = { start: frame / fps, end: (frame + 1) / fps };
    const res = await api.startRender(renderPayload(p, size, range), { ...size, fps, format: 'png' }, target);
    setStatus(res.ok ? tx('Fotograma {frame} guardado en {target}', { frame, target }) : tx('No se pudo exportar el fotograma: {n}', { n: res.error || '' }));
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selection.length) return;
    setProject((p) => rippleDelete(p, selection, live.current.ripple));
    setSelection([]);
  }, [selection, setProject]);

  const toggleRipple = useCallback(() => setRipple((r) => (r ? null : rippleMode)), [rippleMode]);
  const chooseRippleMode = useCallback((mode) => {
    setRippleMode(mode);
    setRipple(mode);
  }, []);

  // Marcadores (M, en el cursor) y regiones (R, de la selección de tiempo), como en VEGAS.
  const insertMarker = useCallback(() => {
    const res = addMarker(live.current.project, quantize(live.current.time, live.current.project.settings.fps));
    if (!res.marker) return;
    setProject(res.project);
    setStatus(tx('Marcador {number} añadido{n}. Doble clic en él para ponerle nombre.', { number: res.marker.number, n: res.marker.number <= 9 ? tx(' (tecla {number} para volver a él)', { number: res.marker.number }) : '' }));
  }, [setProject]);
  const insertRegion = useCallback(() => {
    const r = live.current.region;
    if (!r) {
      setStatus(tx('Para crear una región, primero marca una selección de tiempo en la barra de arriba de la regla.'));
      return;
    }
    const res = addRegion(live.current.project, r.start, r.end);
    setProject(res.project);
    setStatus(tx('Región {number} añadida. Doble clic en ella para ponerle nombre.', { number: res.region.number }));
  }, [setProject]);
  const goToMarker = useCallback((number) => {
    const m = (live.current.project.markers || []).find((x) => x.number === number);
    if (m) seek(m.time);
  }, [seek]);

  // Eliminar el tramo de la selección de tiempo en todas las pistas y cerrar el hueco.
  const deleteRegion = useCallback(() => {
    const r = live.current.region;
    if (!r) return;
    setProject((p) => deleteRange(p, r.start, r.end));
    setSelection([]);
    setRegion(null);
    seek(r.start);
    setStatus(tx('Tramo eliminado: lo de detrás se ha adelantado para cerrar el hueco.'));
  }, [seek, setProject]);

  const selectAll = useCallback(() => setSelection(live.current.project.events.map((e) => e.id)), []);

  const insertTrack = useCallback((type) => setProject((p) => addTrack(p, type).project), [setProject]);

  // Insertar → Medio de texto: un texto nuevo de 5 s en el cursor, en la pista de video de más arriba si
  // está libre o en una pista nueva encima de todas (para que se vea sobre el video), y se abre su ventana.
  const insertText = useCallback(() => {
    const { project: p, time: t } = live.current;
    const media = withTextThumb(newTextMedia(), p.settings.width / p.settings.height);
    let next = { ...p, media: [...p.media, media] };
    const top = next.tracks.find((tr) => tr.type === 'video');
    const free = top && !next.events.some((e) => e.trackId === top.id && e.start < t + IMAGE_DURATION && e.start + e.duration > t);
    let trackId = top?.id;
    if (!free) {
      const res = addTrack(next, 'video');
      next = res.project;
      trackId = res.track.id;
    }
    next = placeMedia(next, media, t, trackId);
    setProject(next);
    setSelection([next.events[next.events.length - 1].id]);
    setFxEventId(null);
    setPanEventId(null);
    setTextMediaId(media.id);
  }, [setProject]);

  // ---- Grabación de voz en off ----

  // Graba desde el cursor (o desde el principio de la selección de tiempo, y hasta su final) en la pista
  // armada mientras se reproduce el proyecto. Sin pista armada, crea una pista de audio abajo del todo.
  // Se termina como la reproducción (Espacio, Intro, el botón de grabar o Ctrl+R).
  const startRecording = useCallback(async () => {
    if (recorderRef.current || live.current.recording) return;
    setPlaying(false);
    const recorder = new Recorder();
    recorderRef.current = recorder;
    setStatus(tx('Abriendo el micrófono…'));
    try {
      await recorder.prepare(loadRecordSettings(), live.current.projectPath);
    } catch (err) {
      recorder.close();
      recorderRef.current = null;
      setStatus(micError(err));
      window.alert(micError(err));
      return;
    }
    const { project: p, time: t, region: r, armedTrackId: armed } = live.current;
    let trackId = p.tracks.some((tr) => tr.id === armed && tr.type === 'audio') ? armed : null;
    if (!trackId) {
      const res = addTrack(p, 'audio');
      trackId = res.track.id;
      setProject({ ...res.project, tracks: res.project.tracks.map((tr) => (tr.id === trackId ? { ...tr, name: tx('Voz en off') } : tr)) });
      setArmedTrackId(trackId);
    }
    const from = r && (t < r.start || t >= r.end - 1e-6) ? r.start : t;
    playStart.current = from;
    setTime(from);
    setRecording({ trackId, start: from });
    setPlaying(true);
    setStatus(tx('● Grabando{n}… Espacio o Ctrl+R para terminar.', { n: recorder.label ? tx(' con «{label}»', { label: recorder.label }) : '' }));
  }, [setProject]);

  // Al parar la reproducción (por cualquier vía) mientras se graba: se cierra el archivo, se importa y se
  // coloca en la pista. Si la pista ya tiene algo en ese tramo, en una pista nueva justo debajo (no se pisa).
  const finishRecording = useCallback(async () => {
    const rec = live.current.recording;
    const recorder = recorderRef.current;
    setRecording(null);
    recorderRef.current = null;
    if (!recorder || !rec) return;
    setStatus(tx('Guardando la grabación…'));
    let result;
    let media;
    try {
      result = await recorder.stop();
      if (!result) {
        setStatus(tx('No se ha grabado nada.'));
        return;
      }
      media = { id: uid('m'), ...noteAnalyzed(await api.analyzeMedia(result.path)) };
    } catch (err) {
      setStatus(tx('No se pudo guardar la grabación: {message}', { message: err.message }));
      return;
    }
    const skip = Math.min(result.latency, Math.max(0, media.duration - MIN_EVENT));
    const length = media.duration - skip;
    let next = { ...live.current.project, media: [...live.current.project.media, media] };
    let trackId = next.tracks.some((tr) => tr.id === rec.trackId) ? rec.trackId : null;
    const busy = !!trackId && next.events.some((e) => e.trackId === trackId && e.start < rec.start + length - 1e-6 && e.start + e.duration > rec.start + 1e-6);
    if (!trackId || busy) {
      const res = addTrack(next, 'audio');
      next = res.project;
      if (busy) next = moveTrack(next, res.track.id, next.tracks.findIndex((tr) => tr.id === trackId) + 1);
      trackId = res.track.id;
    }
    const ev = { id: uid('e'), trackId, mediaId: media.id, start: rec.start, inPoint: skip, duration: length, groupId: null, ...EVENT_DEFAULTS };
    setProject({ ...next, events: [...next.events, ev] });
    setSelection([ev.id]);
    setStatus(tx('Grabación guardada en {path}{n}', { path: result.path, n: busy ? tx(' (en una pista nueva: la pista armada ya tenía eventos en ese tramo)') : '' }));
  }, [noteAnalyzed, setProject]);
  useEffect(() => {
    if (!playing && live.current.recording) finishRecording();
  }, [playing, finishRecording]);

  const toggleRecording = useCallback(() => {
    if (live.current.recording) setPlaying(false);
    else startRecording();
  }, [startRecording]);
  const armTrack = useCallback((trackId) => setArmedTrackId((cur) => (cur === trackId ? null : trackId)), []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Ventana de efectos del evento: se cierra sola si el evento desaparece (borrado, deshacer…).
  const fxEvent = fxEventId ? project.events.find((e) => e.id === fxEventId) : null;
  const closeFx = useCallback(() => setFxEventId(null), []);
  const updateFxEffects = useCallback((fn, record) => {
    setProject((p) => updateEvents(p, [fxEventId], (e) => ({ effects: fn(e.effects) })), record);
  }, [fxEventId, setProject]);

  // Ventana del texto: edita el medio de texto (todos los eventos que lo usan). Se cierra sola si el medio desaparece.
  const textMedia = textMediaId ? project.media.find((m) => m.id === textMediaId && isText(m)) : null;
  const closeText = useCallback(() => setTextMediaId(null), []);
  const updateTextMedia = useCallback((mediaId, fn, record) => {
    setProject((p) => ({
      ...p,
      media: p.media.map((m) => (m.id === mediaId
        ? withTextThumb({ ...m, text: fn({ ...TEXT_DEFAULTS, ...m.text }) }, p.settings.width / p.settings.height)
        : m)),
    }), record);
  }, [setProject]);
  const updateText = useCallback((fn, record) => updateTextMedia(textMediaId, fn, record), [textMediaId, updateTextMedia]);
  // Clic en un texto de la vista previa: se selecciona su evento (con su grupo).
  const selectEvent = useCallback((eventId) => {
    const p = live.current.project;
    const ev = p.events.find((e) => e.id === eventId);
    if (ev) setSelection(ev.groupId ? p.events.filter((e) => e.groupId === ev.groupId).map((e) => e.id) : [ev.id]);
  }, []);
  const openTextEditor = useCallback((mediaId) => {
    setFxEventId(null);
    setPanEventId(null);
    setTextMediaId(mediaId);
  }, []);
  const editTextOf = useCallback((eventId) => {
    const ev = live.current.project.events.find((e) => e.id === eventId);
    if (!ev) return;
    setFxEventId(null);
    setPanEventId(null);
    setTextMediaId(ev.mediaId);
  }, []);

  // Ventana de panorámica/recorte del evento (una sola ventana flotante abierta a la vez).
  const panEvent = panEventId ? project.events.find((e) => e.id === panEventId) : null;
  // Estable (useCallback): la línea de tiempo memoriza las pistas y los eventos, y una función nueva en cada dibujado
  // haría que se volvieran a dibujar todos en cada fotograma de la reproducción.
  const openFx = useCallback((id) => {
    setTextMediaId(null);
    setPanEventId(null);
    setFxEventId(id);
  }, []);

  const openPan = useCallback((eventId) => {
    setFxEventId(null);
    setTextMediaId(null);
    setPanEventId(eventId);
  }, []);
  const closePan = useCallback(() => setPanEventId(null), []);
  const updatePan = useCallback((fn, record) => {
    setProject((p) => updateEvents(p, [panEventId], (e) => {
      const pan = fn(e.pan || null);
      return { pan: pan && panActive(pan) || pan?.keyframes.length > 1 ? pan : null };
    }), record);
  }, [panEventId, setProject]);
  // Cambios hechos con el ratón en la vista previa: en el instante del cursor (crea fotograma clave si hace falta).
  const changePanAtCursor = useCallback((changes, record) => {
    const { project: p, time: t } = live.current;
    const ev = p.events.find((e) => e.id === panEventId);
    if (!ev) return;
    updatePan((pan) => setPanValues(pan, Math.min(ev.duration, Math.max(0, t - ev.start)), changes, p.settings.fps), record);
  }, [panEventId, updatePan]);

  // Portapapeles. Las acciones reciben los ids explícitamente porque el menú contextual puede
  // cambiar la selección justo antes de llamarlas.
  const copyIds = useCallback((ids) => {
    const clip = copyEvents(live.current.project, ids);
    if (!clip) return false;
    setClipboard(clip);
    setStatus(`${clip.events.length} ${clip.events.length === 1 ? tx('evento copiado') : tx('eventos copiados')}`);
    return true;
  }, []);

  const deleteIds = useCallback((ids) => {
    if (!ids.length) return;
    setProject((p) => rippleDelete(p, ids, live.current.ripple));
    setSelection((sel) => sel.filter((id) => !ids.includes(id)));
  }, [setProject]);

  const cutIds = useCallback((ids) => {
    if (copyIds(ids)) deleteIds(ids);
  }, [copyIds, deleteIds]);

  // Pega en el cursor (o en el instante y la pista indicados), selecciona lo pegado y lleva el cursor
  // a su final, para que al pegar varias veces seguidas los eventos queden uno detrás de otro.
  const paste = useCallback((at = live.current.time, trackId = null) => {
    const clip = live.current.clipboard;
    if (!clip) return;
    const res = pasteEvents(live.current.project, clip, at, trackId);
    if (!res.ids.length) {
      setStatus(tx('No se puede pegar: los medios de lo copiado ya no están en el proyecto.'));
      return;
    }
    // En cascada, lo pegado se inserta: lo que había desde ese punto se aparta lo que dura lo pegado.
    const pasted = new Set(res.ids);
    const tracks = [...new Set(res.project.events.filter((e) => pasted.has(e.id)).map((e) => e.trackId))];
    setProject(rippleShift(res.project, tracks, at, clip.duration, live.current.ripple, pasted));
    setSelection(res.ids);
    seek(res.end);
  }, [seek, setProject]);

  const groupIds = useCallback((ids) => setProject((p) => groupEvents(p, ids)), [setProject]);
  const ungroupIds = useCallback((ids) => setProject((p) => ungroupEvents(p, ids)), [setProject]);

  const openRender = useCallback(() => {
    if (live.current.duration <= 0) return;
    setPlaying(false);
    setRenderOpen(true);
  }, []);

  // Menú del clic derecho en un evento o en una zona vacía de una pista (lo pide la línea de tiempo).
  const openContextMenu = useCallback((info) => {
    const { project: p, time: t, clipboard: clip } = live.current;
    let items;
    if (info.kind === 'custom') {
      items = info.items; // menús que monta la propia línea de tiempo (envolventes, cabecera de pista)
    } else if (info.kind === 'marker' || info.kind === 'region') {
      const { mark } = info;
      const isRegion = info.kind === 'region';
      items = [
        { label: tx('Cambiar el nombre…'), action: info.rename },
        ...(isRegion
          ? [
            { label: tx('Seleccionar la región'), action: () => setRegion({ start: mark.start, end: mark.end }) },
            {
              label: tx('Renderizar la región…'),
              action: () => {
                setRegion({ start: mark.start, end: mark.end });
                openRender();
              },
            },
          ]
          : [{ label: tx('Ir al marcador'), shortcut: mark.number <= 9 ? String(mark.number) : undefined, action: () => seek(mark.time) }]),
        'separator',
        { label: isRegion ? tx('Eliminar la región') : tx('Eliminar el marcador'), action: () => setProject((cur) => deleteMark(cur, info.kind, mark.id)) },
      ];
    } else if (info.kind === 'event') {
      const ids = info.selection;
      const selected = p.events.filter((e) => ids.includes(e.id));
      const types = new Map(p.tracks.map((tr) => [tr.id, tr.type]));
      const audio = selected.filter((e) => types.get(e.trackId) === 'audio');
      const media = p.media.find((m) => m.id === info.event.mediaId);
      const isVideo = types.get(info.event.trackId) === 'video';
      // Clic derecho sobre un fundido: su curva (en el evento y su grupo; en un fundido cruzado de audio,
      // también en el fundido del otro evento), como «Tipo de fundido» en VEGAS.
      const zone = info.fadeZone;
      const field = zone === 'in' ? 'fadeInCurve' : 'fadeOutCurve';
      const curveItems = zone
        ? [
          ...FADE_CURVES.map((c) => ({
            label: `${zone === 'in' ? tx('Fundido de entrada') : tx('Fundido de salida')}: ${c.label.toLowerCase()}`,
            checked: (info.event[field] || 'linear') === c.id,
            action: () => setProject((cur) => {
              const ev = info.event;
              const otherField = zone === 'in' ? 'fadeOutCurve' : 'fadeInCurve';
              const targets = new Set(cur.events.filter((x) => x.id === ev.id || (ev.groupId && x.groupId === ev.groupId)).map((x) => x.id));
              return {
                ...cur,
                events: cur.events.map((x) => {
                  if (targets.has(x.id)) return { ...x, [field]: c.id };
                  if (info.partner && x.id === info.partner.id && !isVideo) return { ...x, [otherField]: c.id };
                  return x;
                }),
              };
            }),
          })),
          // Transición del fundido hacia la pista de debajo (se pone soltando una transición sobre el fundido).
          ...(isVideo && info.event[zone === 'in' ? 'fadeInTransition' : 'fadeOutTransition']
            ? [{
              label: tx('Quitar la transición ({transitionLabel})', { transitionLabel: transitionLabel(info.event[zone === 'in' ? 'fadeInTransition' : 'fadeOutTransition']) }),
              action: () => setProject((cur) => ({
                ...cur,
                events: cur.events.map((x) => (x.id === info.event.id
                  ? { ...x, [zone === 'in' ? 'fadeInTransition' : 'fadeOutTransition']: null }
                  : x)),
              })),
            }]
            : []),
          'separator',
        ]
        : [];
      items = [
        ...curveItems,
        { label: tx('Cortar'), shortcut: tx('Ctrl+X'), action: () => cutIds(ids) },
        { label: tx('Copiar'), shortcut: tx('Ctrl+C'), action: () => copyIds(ids) },
        { label: tx('Pegar'), shortcut: tx('Ctrl+V'), action: () => paste(), disabled: !clip },
        { label: tx('Eliminar'), shortcut: tx('Supr'), action: () => deleteIds(ids) },
        'separator',
        {
          label: tx('Dividir en el cursor'),
          shortcut: 'S',
          action: () => setProject((cur) => splitEvents(cur, live.current.time, ids)),
          disabled: !selected.some((e) => e.start < t && t < e.start + e.duration),
        },
        ...(media && !media.isImage && !isText(media) && !media.missing
          ? [{
            label: info.event.reversed ? tx('Quitar la inversión (reproducir hacia delante)') : tx('Invertir (reproducir hacia atrás)'),
            action: () => reverseEvent(info.event),
            disabled: !!(info.event.reversed && info.event.stabilized),
          }]
          : []),
        ...(!isVideo && media && !media.missing && media.hasAudio
          ? info.event.denoised
            ? [{ label: tx('Quitar la reducción de ruido'), action: () => denoiseEvent(info.event, null) }]
            : [
              { label: tx('Reducir el ruido de fondo'), action: () => denoiseEvent(info.event, 'light') },
              { label: tx('Reducir mucho el ruido de fondo'), action: () => denoiseEvent(info.event, 'strong') },
            ]
          : []),
        ...(isVideo && media && !media.isImage && !isText(media) && !media.missing
          ? info.event.stabilized
            ? [{ label: tx('Quitar la estabilización'), action: () => stabilizeEvent(info.event, null) }]
            : [
              { label: tx('Estabilizar'), action: () => stabilizeEvent(info.event, 15) },
              { label: tx('Estabilizar mucho (más zoom)'), action: () => stabilizeEvent(info.event, 40) },
            ]
          : []),
        ...(isVideo && media && !media.isImage
          ? [
            { label: tx('Congelar fotograma en el cursor'), shortcut: tx('Ctrl+Mayús+F'), action: freezeFrame, disabled: !(info.event.start <= t && t < info.event.start + info.event.duration) },
            { label: tx('Detectar escenas y dividir'), action: () => detectScenes(info.event) },
          ]
          : []),
        'separator',
        { label: tx('Agrupar'), shortcut: 'G', action: () => groupIds(ids), disabled: ids.length < 2 },
        { label: tx('Quitar del grupo'), shortcut: 'U', action: () => ungroupIds(ids), disabled: !selected.some((e) => e.groupId) },
        'separator',
        {
          label: tx('Velocidad normal (100 %)'),
          action: () => setProject((cur) => updateEvents(cur, ids, (e) => ({ duration: sourceOffset(e, e.duration), rate: 1, speed: null }))),
          disabled: !selected.some((e) => (e.rate || 1) !== 1 || hasRamp(e)),
        },
        {
          // Rampa: envolvente de velocidad en el evento y su grupo, que empieza plana (100 %) con un punto en cada extremo.
          label: tx('Rampa de velocidad (envolvente)'),
          checked: hasRamp(info.event),
          disabled: !media || media.isImage,
          action: () => setProject((cur) => {
            const ev = info.event;
            const on = !hasRamp(ev);
            const points = [{ t: 0, v: 1 }, { t: ev.duration, v: 1 }];
            return {
              ...cur,
              events: cur.events.map((x) => (x.id === ev.id || (ev.groupId && x.groupId === ev.groupId)
                ? { ...x, speed: on ? shiftSpeed(points, x.start - ev.start) : null }
                : x)),
            };
          }),
        },
        {
          label: tx('Quitar fundidos'),
          action: () => setProject((cur) => updateEvents(cur, ids, { fadeIn: 0, fadeOut: 0 })),
          disabled: !selected.some((e) => e.fadeIn > 0 || e.fadeOut > 0),
        },
        ...(audio.length
          ? [{
            label: tx('Volumen del evento a 0 dB'),
            action: () => setProject((cur) => updateEvents(cur, audio.map((e) => e.id), { volume: 0 })),
            disabled: !audio.some((e) => (e.volume ?? 0) !== 0),
          }]
          : []),
        ...(isVideo && info.event.transition
          ? [{
            label: tx('Volver a disolución cruzada'),
            action: () => setProject((cur) => updateEvents(cur, [info.event.id], { transition: null })),
          }]
          : []),
        'separator',
        ...(isText(media) ? [{ label: tx('Editar texto…'), action: () => openTextEditor(media.id) }] : []),
        ...(isVideo
          ? [
            { label: tx('Panorámica/recorte del evento…'), action: () => openPan(info.event.id) },
            {
              label: tx('Quitar panorámica y recorte'),
              action: () => setProject((cur) => updateEvents(cur, ids, { pan: null })),
              disabled: !selected.some((e) => e.pan),
            },
          ]
          : []),
        { label: tx('Efectos del evento…'), action: () => { setPanEventId(null); setTextMediaId(null); setFxEventId(info.event.id); } },
        {
          label: tx('Quitar efectos'),
          action: () => setProject((cur) => updateEvents(cur, ids, { effects: [] })),
          disabled: !selected.some((e) => e.effects?.length),
        },
        'separator',
        {
          label: tx('Seleccionar el tramo del evento'),
          action: () => setRegion({ start: info.event.start, end: info.event.start + info.event.duration }),
        },
        {
          label: tx('Abrir la ubicación del archivo'),
          action: () => api.revealFile(media.path),
          disabled: !media || media.missing || isText(media),
        },
      ];
    } else {
      items = [
        { label: tx('Pegar aquí'), action: () => paste(info.time, info.trackId), disabled: !clip },
        { label: tx('Pegar en el cursor'), shortcut: tx('Ctrl+V'), action: () => paste(), disabled: !clip },
        'separator',
        { label: tx('Seleccionar todo'), shortcut: tx('Ctrl+A'), action: selectAll },
        { label: tx('Quitar la selección de tiempo'), shortcut: tx('Esc'), action: () => setRegion(null), disabled: !live.current.region },
        { label: tx('Eliminar el tramo seleccionado y cerrar el hueco'), shortcut: tx('Ctrl+Supr'), action: deleteRegion, disabled: !live.current.region },
        'separator',
        { label: tx('Insertar medio de texto'), action: insertText },
        { label: tx('Insertar pista de video'), shortcut: tx('Ctrl+Mayús+Q'), action: () => insertTrack('video') },
        { label: tx('Insertar pista de audio'), shortcut: tx('Ctrl+Q'), action: () => insertTrack('audio') },
      ];
    }
    setContextMenu({ x: info.x, y: info.y, items });
  }, [copyIds, cutIds, deleteIds, deleteRegion, detectScenes, freezeFrame, groupIds, insertText, insertTrack, openPan, openRender, openTextEditor, paste, seek, selectAll, setProject, ungroupIds]);

  const zoom = useCallback((factor) => setPps((v) => Math.min(MAX_PPS, Math.max(MIN_PPS, v * factor))), []);

  // ---- Proyecto ----

  // Cambiar el idioma reinicia la aplicación (el cierre pregunta si guardar los cambios, como siempre).
  const changeLanguage = (id) => {
    if (id === lang) return;
    if (window.confirm(tx('Cortex Studio se reiniciará para cambiar el idioma. ¿Continuar?'))) api.setLanguage(id);
  };
  const confirmDiscard = () => !live.current.dirty || window.confirm(tx('Hay cambios sin guardar. ¿Descartarlos?'));

  const newProject = useCallback(() => {
    if (confirmDiscard()) setProjectDialog('new');
  }, []);

  // Pantalla de inicio: proyectos recientes (los guarda main.js al abrir y al guardar).
  const [recents, setRecents] = useState(null);
  const startScreen = projectDialog === 'startup' || projectDialog === 'recent';
  useEffect(() => {
    if (!startScreen) return;
    setRecents(null);
    api.recentProjects().then(setRecents).catch(() => setRecents([]));
  }, [startScreen]);
  const showRecent = useCallback(() => {
    if (confirmDiscard()) setProjectDialog('recent');
  }, []);

  const acceptProjectDialog = (settings) => {
    if (projectDialog === 'edit') {
      // Las miniaturas de los textos dependen de la proporción del proyecto.
      const aspect = settings.width / settings.height;
      setProject((p) => ({ ...p, settings, media: p.media.map((m) => (isText(m) ? withTextThumb(m, aspect) : m)) }));
    } else {
      const fresh = emptyProject(settings);
      history.reset(fresh);
      setSavedProject(fresh);
      setProjectPath(null);
      setSelection([]);
      setRegion(null);
      setTextMediaId(null);
      setPlaying(false);
      setTime(0);
    }
    setProjectDialog(null);
  };

  // Selección de tiempo y cursor, que se guardan con el proyecto y se recuperan al abrirlo.
  const viewState = () => ({ timeSelection: live.current.region, cursor: live.current.time });

  // Devuelve true si se ha guardado (false si se cancela el diálogo o falla).
  const save = useCallback(async (saveAs = false) => {
    const current = live.current.project;
    try {
      const saved = await api.saveProject(serializeProject(current, viewState()), saveAs ? null : projectPath);
      if (!saved) return false;
      setProjectPath(saved);
      setSavedProject(current);
      setStatus(tx('Proyecto guardado en {saved}', { saved }));
      api.clearAutosave(); // guardado de verdad: la copia de recuperación ya no hace falta
      return true;
    } catch (err) {
      window.alert(tx('No se pudo guardar: {message}', { message: err.message }));
      return false;
    }
  }, [projectPath]);

  // Recopilar medios: copia el proyecto y todos sus archivos a una carpeta (para llevarlo a otro equipo o guardarlo
  // completo) y sigue trabajando con esa copia, como «Guardar como» con «Copiar medios» de VEGAS.
  const collect = useCallback(async () => {
    const { project: current, projectPath: file } = live.current;
    const off = api.onCollectProgress(({ name, percent }) => setStatus(tx('Recopilando medios: {percent} % ({name})…', { percent, name })));
    let res;
    try {
      res = await api.collectProject(serializeProject(current, viewState()), file);
    } catch (err) {
      window.alert(tx('No se pudieron recopilar los medios: {message}', { message: err.message }));
      return;
    } finally {
      off();
    }
    if (!res) {
      setStatus('');
      return;
    }
    const moved = (p) => res.map[p] ?? p;
    const next = { ...current, media: current.media.map((m) => (m.path ? { ...m, path: moved(m.path) } : m)) };
    history.reset(next);
    setSavedProject(next);
    setProjectPath(res.path);
    // Proxies y miniaturas sirven igual para las copias (misma clave: nombre, tamaño y fecha).
    const remap = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [moved(k), v]));
    proxyRef.current.ready = remap(proxyRef.current.ready);
    setProxies(proxyRef.current.ready);
    setStrips(remap);
    api.clearAutosave();
    setStatus(tx('Proyecto y medios copiados en {path}{n}. Ahora trabajas con esa copia.', { path: res.path, n: res.missing.length ? tx(' (faltan {missing} archivo(s) que no se encontraron)', { missing: res.missing.length }) : '' }));
  }, [history]);

  // Carga un proyecto leído de disco (o una copia de recuperación: recovered = true, queda como modificado
  // y, al guardar, se guarda en su archivo de siempre).
  const loadData = useCallback(async (data, filePath, recovered = false) => {
    if (data?.format !== 'cortex-studio' || !Array.isArray(data.tracks) || !Array.isArray(data.events)) {
      window.alert(tx('El archivo no es un proyecto válido de Cortex Studio.'));
      return;
    }
    setPlaying(false);
    const media = [];
    const aspect = (data.settings?.width || 16) / (data.settings?.height || 9);
    for (const m of data.media) {
      if (m.kind === 'text') {
        media.push(withTextThumb({ ...newTextMedia(m.text), id: m.id }, aspect));
        continue;
      }
      setStatus(tx('Cargando {name}…', { name: m.name }));
      try {
        media.push({ ...noteAnalyzed(await api.analyzeMedia(m.path)), id: m.id });
      } catch {
        media.push({ ...m, missing: true, hasVideo: true, hasAudio: true });
      }
    }
    const loaded = loadProject(data, media);
    history.reset(loaded);
    setSavedProject(recovered ? null : loaded);
    setProjectPath(filePath || null);
    const view = loadView(data);
    setSelection([]);
    setRegion(view.timeSelection);
    setTextMediaId(null);
    setFxEventId(null);
    setPanEventId(null);
    setTime(Math.min(view.cursor, projectDuration(loaded)));
    const missing = media.filter((m) => m.missing).length;
    const what = recovered ? tx('Proyecto recuperado (aún sin guardar)') : tx('Proyecto abierto');
    setStatus(missing ? tx('{what}. Faltan {missing} archivo(s) de medios.', { what, missing }) : what);
  }, [history, noteAnalyzed]);

  const openRecent = useCallback(async (filePath) => {
    let result;
    try {
      result = await api.openProjectPath(filePath);
    } catch (err) {
      window.alert(tx('No se pudo abrir el proyecto: {replace}', { replace: String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }));
      setRecents(await api.recentProjects());
      return;
    }
    setProjectDialog(null);
    await loadData(result.data, result.path);
  }, [loadData]);

  const open = useCallback(async () => {
    if (!confirmDiscard()) return;
    let result;
    try {
      result = await api.openProject();
    } catch (err) {
      window.alert(tx('No se pudo abrir el proyecto: {message}', { message: err.message }));
      return;
    }
    if (result) await loadData(result.data, result.path);
  }, [loadData]);

  // Guardado automático: cada minuto, si hay cambios sin guardar, una copia de recuperación (no toca el
  // archivo del proyecto). Al arrancar, si quedó una (la aplicación se cerró de golpe), se ofrece recuperarla.
  const autosaved = useRef(null);
  useEffect(() => {
    const id = setInterval(() => {
      const { project: p, dirty: changed, projectPath: file } = live.current;
      if (!changed || p === autosaved.current) return;
      autosaved.current = p;
      api.autosave(serializeProject(p, viewState()), file).catch(() => {});
    }, AUTOSAVE_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    api.checkAutosave().then((rec) => {
      if (!rec?.data) return;
      const when = new Date(rec.savedAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
      const ok = window.confirm(
        tx('Cortex Studio no se cerró correctamente la última vez.\n\nHay una copia de recuperación de «{baseName}» ', { baseName: baseName(rec.projectPath) }) +
          tx('guardada automáticamente el {when}.\n\n¿Quieres recuperarla?', { when }),
      );
      if (ok) {
        setProjectDialog(null);
        loadData(rec.data, rec.projectPath, true);
      } else {
        api.clearAutosave();
      }
    });
  }, []);

  // Al cerrar la ventana con cambios sin guardar, el proceso principal pregunta (Guardar / No guardar /
  // Cancelar). Necesita saber si hay cambios y, si se elige Guardar, pide guardar antes de cerrar.
  useEffect(() => {
    api.setDirty(dirty);
  }, [dirty]);
  const saveRef = useRef(null);
  saveRef.current = save;
  useEffect(() => api.onSaveBeforeClose(async () => {
    if (await saveRef.current(false)) api.closeWindow();
  }), []);

  useEffect(() => api.onFullScreenChange(setFullScreen), []);

  // Actualizaciones automáticas: el proceso principal busca, descarga y avisa; aquí se enseña el aviso.
  useEffect(() => {
    api.getVersion().then(setVersion);
    api.getUpdateState().then(setUpdate);
    return api.onUpdateState((state) => {
      setUpdate(state);
      if (state.status === 'ready') setUpdateHidden(false);
      if (state.manual && state.status === 'latest') setStatus(tx('Ya tienes la última versión de Cortex Studio.'));
      if (state.manual && state.status === 'error') setStatus(tx('No se pudo buscar actualizaciones: {message}', { message: state.message }));
    });
  }, []);
  const checkForUpdates = useCallback(async () => {
    setStatus(tx('Buscando actualizaciones…'));
    const state = await api.checkForUpdates();
    if (state.status === 'unavailable') setStatus(tx('Las actualizaciones automáticas solo funcionan en la aplicación instalada.'));
    else if (state.status === 'downloading') setStatus(tx('Descargando la versión {version}…', { version: state.version }));
    else if (state.status === 'ready') setUpdateHidden(false);
  }, []);


  const openProperties = useCallback(() => setProjectDialog('edit'), []);

  // ---- Menús ----

  const menus = [
    {
      label: tx('Archivo'),
      items: [
        { label: tx('Nuevo…'), shortcut: tx('Ctrl+N'), action: newProject },
        { label: tx('Abrir…'), shortcut: tx('Ctrl+O'), action: open },
        { label: tx('Proyectos recientes…'), action: showRecent },
        { label: tx('Guardar'), shortcut: tx('Ctrl+S'), action: () => save(false) },
        { label: tx('Guardar como…'), shortcut: tx('Ctrl+Mayús+S'), action: () => save(true) },
        { label: tx('Recopilar medios y guardar en una carpeta…'), action: collect },
        'separator',
        { label: tx('Importar medios…'), shortcut: tx('Ctrl+I'), action: importDialog },
        { label: tx('Descargar de YouTube…'), shortcut: tx('Ctrl+Mayús+D'), action: () => setYoutubeOpen(true) },
        { label: tx('Comprimir videos…{n}', { n: compressRunning ? tx(' (comprimiendo)') : '' }), shortcut: tx('Ctrl+Mayús+C'), action: () => setCompressOpen(true) },
        { label: tx('Renderizar como…'), shortcut: tx('Ctrl+M'), action: openRender, disabled: duration <= 0 },
        { label: tx('Cola de render…{n}', { n: queue.length ? ` (${queue.filter((j) => j.status === 'waiting' || j.status === 'rendering').length})` : '' }), action: () => setQueueOpen(true) },
        { label: tx('Exportar el fotograma como imagen…'), shortcut: tx('Ctrl+Mayús+E'), action: exportFrame, disabled: duration <= 0 },
        'separator',
        { label: tx('Propiedades del proyecto…'), shortcut: tx('Alt+Intro'), action: openProperties },
        'separator',
        { label: tx('Salir'), action: () => window.close() },
      ],
    },
    {
      label: tx('Edición'),
      items: [
        { label: tx('Deshacer'), shortcut: tx('Ctrl+Z'), action: history.undo, disabled: !history.canUndo },
        { label: tx('Rehacer'), shortcut: tx('Ctrl+Y'), action: history.redo, disabled: !history.canRedo },
        'separator',
        { label: tx('Cortar'), shortcut: tx('Ctrl+X'), action: () => cutIds(selection), disabled: !selection.length },
        { label: tx('Copiar'), shortcut: tx('Ctrl+C'), action: () => copyIds(selection), disabled: !selection.length },
        { label: tx('Pegar'), shortcut: tx('Ctrl+V'), action: () => paste(), disabled: !clipboard },
        'separator',
        { label: region ? tx('Dividir en los extremos de la selección') : tx('Dividir'), shortcut: 'S', action: split },
        { label: tx('Recortar el principio hasta el cursor'), shortcut: tx('Alt+['), action: () => trimCursor('start') },
        { label: tx('Recortar el final hasta el cursor'), shortcut: tx('Alt+]'), action: () => trimCursor('end') },
        { label: tx('Congelar fotograma en el cursor'), shortcut: tx('Ctrl+Mayús+F'), action: freezeFrame, disabled: duration <= 0 },
        { label: tx('Eliminar'), shortcut: tx('Supr'), action: deleteSelected, disabled: !selection.length },
        { label: tx('Seleccionar todo'), shortcut: tx('Ctrl+A'), action: selectAll },
        'separator',
        { label: tx('Agrupar'), shortcut: 'G', action: () => groupIds(selection), disabled: selection.length < 2 },
        { label: tx('Quitar del grupo'), shortcut: 'U', action: () => ungroupIds(selection), disabled: !selection.length },
        'separator',
        { label: tx('Ajuste activado'), shortcut: 'F8', action: () => setSnap((v) => !v), checked: snap },
        { label: tx('Edición en cascada'), shortcut: tx('Ctrl+L'), action: toggleRipple, checked: !!ripple },
        { label: tx('    Solo en las pistas afectadas'), action: () => chooseRippleMode('tracks'), checked: rippleMode === 'tracks' },
        { label: tx('    En todas las pistas'), action: () => chooseRippleMode('all'), checked: rippleMode === 'all' },
        { label: tx('Reproducción en bucle'), shortcut: 'Q', action: () => setLoop((v) => !v), checked: loop },
        { label: tx('Quitar la selección de tiempo'), shortcut: tx('Esc'), action: () => setRegion(null), disabled: !region },
        { label: tx('Eliminar el tramo seleccionado y cerrar el hueco'), shortcut: tx('Ctrl+Supr'), action: deleteRegion, disabled: !region },
      ],
    },
    {
      label: tx('Ver'),
      items: [
        { label: tx('Acercar'), shortcut: '↑', action: () => zoom(1.25) },
        { label: tx('Alejar'), shortcut: '↓', action: () => zoom(0.8) },
        { label: tx('Ajustar el proyecto a la ventana'), action: () => timelineRef.current?.zoomToFit() },
        'separator',
        { label: tx('Pantalla completa'), shortcut: 'F11', action: api.toggleFullScreen, checked: fullScreen },
        { label: tx('Vista previa a pantalla completa'), shortcut: tx('Alt+Mayús+4'), action: togglePreviewFull },
        'separator',
        { label: tx('Medios del proyecto'), shortcut: tx('Alt+4'), action: () => setLeftTab('media'), checked: leftTab === 'media' },
        { label: tx('Transiciones'), shortcut: tx('Alt+7'), action: () => setLeftTab('transitions'), checked: leftTab === 'transitions' },
        { label: tx('Efectos de video'), shortcut: tx('Alt+8'), action: () => setLeftTab('effects'), checked: leftTab === 'effects' },
        { label: tx('Efectos de audio'), action: () => setLeftTab('audioEffects'), checked: leftTab === 'audioEffects' },
        { label: tx('Subtítulos'), action: () => setLeftTab('subtitles'), checked: leftTab === 'subtitles' },
        { label: tx('Monitores de video'), shortcut: tx('Ctrl+Alt+2'), action: () => setLeftTab('scopes'), checked: leftTab === 'scopes' },
        'separator',
        { label: tx('Ir al inicio'), shortcut: tx('Inicio'), action: () => seek(0) },
        { label: tx('Ir al final'), shortcut: tx('Fin'), action: () => seek(duration) },
        { label: tx('Punto de edición anterior'), shortcut: tx('Ctrl+←'), action: () => jumpToEdit(-1) },
        { label: tx('Punto de edición siguiente'), shortcut: tx('Ctrl+→'), action: () => jumpToEdit(1) },
        { label: tx('Fotograma anterior'), shortcut: '←', action: () => stepFrame(-1) },
        { label: tx('Fotograma siguiente'), shortcut: '→', action: () => stepFrame(1) },
      ],
    },
    {
      label: tx('Insertar'),
      items: [
        { label: tx('Medio de texto'), action: insertText },
        {
          label: tx('Subtítulo'),
          action: () => {
            const { region: r, time: t } = live.current;
            const res = addCue(live.current.project, r ? r.start : t, r ? r.end : t + 2, '');
            setProject(res.project);
            editSubtitle(res.cue.id);
          },
        },
        'separator',
        { label: tx('Marcador'), shortcut: 'M', action: insertMarker },
        { label: tx('Región (de la selección de tiempo)'), shortcut: 'R', action: insertRegion, disabled: !region },
        'separator',
        { label: tx('Pista de video'), shortcut: tx('Ctrl+Mayús+Q'), action: () => insertTrack('video') },
        { label: tx('Pista de audio'), shortcut: tx('Ctrl+Q'), action: () => insertTrack('audio') },
      ],
    },
    {
      label: tx('Herramientas'),
      items: [
        { label: recording ? tx('Terminar la grabación') : tx('Grabar voz en off'), shortcut: tx('Ctrl+R'), action: toggleRecording },
        { label: tx('Opciones de grabación…'), action: () => setRecordDialog(true), disabled: !!recording },
        'separator',
        { label: tx('Subtítulos automáticos…'), action: () => setTranscribeOpen(true), disabled: duration <= 0 },
        'separator',
        { label: tx('Borrar los proxies de la vista previa…'), action: clearProxies },
        'separator',
        { label: tx('Renderizar como…'), shortcut: tx('Ctrl+M'), action: openRender, disabled: duration <= 0 },
        { label: tx('Herramientas de desarrollo'), shortcut: 'F12', action: api.toggleDevTools },
      ],
    },
    {
      label: tx('Ayuda'),
      items: [
        { label: tx('Atajos de teclado'), shortcut: 'F1', action: () => setShortcutsOpen(true) },
        'separator',
        { label: tx('Idioma'), disabled: true },
        ...LANGUAGES.map((l) => ({ label: `    ${l.name}`, checked: l.id === lang, action: () => changeLanguage(l.id) })),
        'separator',
        { label: tx('Buscar actualizaciones…'), action: checkForUpdates },
        { label: tx('Abrir la carpeta de registros'), action: () => api.openLogs() },
        { label: tx('Cortex Studio {version}', { version }), disabled: true },
      ],
    },
  ];

  // ---- Atajos de teclado (los de Vegas cuando existen) ----

  const modalOpen = renderOpen || queueOpen || youtubeOpen || compressOpen || transcribeOpen || projectDialog !== null || shortcutsOpen || recordDialog;
  const floatingOpen = !!fxEventId || !!textMediaId || !!panEventId; // sus ventanas usan Esc para cerrarse
  const keyHandler = useRef(null);
  keyHandler.current = (e) => {
    if (modalOpen || e.target.closest?.('input, select, textarea')) return;
    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    let action;
    if (e.altKey && e.shiftKey && e.code === 'Digit4') {
      action = togglePreviewFull; // como la vista previa externa de VEGAS
    } else if (e.altKey && !ctrl && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
      action = () => trimCursor(e.code === 'BracketLeft' ? 'start' : 'end'); // por la tecla, no por el carácter
    } else if (ctrl && e.shiftKey && key === 'e') {
      action = exportFrame;
    } else if (ctrl && e.shiftKey && key === 'f') {
      action = freezeFrame;
    } else if (ctrl && e.shiftKey && key === 'd') {
      action = () => setYoutubeOpen(true);
    } else if (ctrl && e.shiftKey && key === 'c') {
      action = () => setCompressOpen(true);
    } else if (ctrl && e.altKey && e.code === 'Digit2') {
      action = () => setLeftTab('scopes'); // como en VEGAS
    } else if (ctrl) {
      action = {
        z: e.shiftKey ? history.redo : history.undo,
        y: history.redo,
        s: () => save(e.shiftKey),
        o: open,
        n: newProject,
        i: importDialog,
        m: openRender,
        a: selectAll,
        l: toggleRipple,
        r: toggleRecording,
        delete: deleteRegion,
        q: () => insertTrack(e.shiftKey ? 'video' : 'audio'),
        c: () => copyIds(selection),
        x: () => cutIds(selection),
        v: () => paste(),
        arrowleft: () => jumpToEdit(-1),
        arrowright: () => jumpToEdit(1),
        home: () => seek(0),
        end: () => seek(live.current.duration),
      }[key];
    } else if (e.altKey) {
      action = {
        arrowleft: () => stepFrame(-1),
        arrowright: () => stepFrame(1),
        enter: openProperties,
        4: () => setLeftTab('media'),
        7: () => setLeftTab('transitions'),
        8: () => setLeftTab('effects'),
      }[key];
    } else {
      action = {
        ' ': () => (live.current.playing ? stop() : play()),
        enter: () => (live.current.playing ? pause() : play()),
        s: split,
        delete: deleteSelected,
        g: () => groupIds(selection),
        u: () => ungroupIds(selection),
        home: () => seek(0),
        end: () => seek(live.current.duration),
        arrowleft: () => stepFrame(-1),
        arrowright: () => stepFrame(1),
        pageup: () => stepGrid(-1),
        pagedown: () => stepGrid(1),
        arrowup: () => zoom(1.25),
        arrowdown: () => zoom(0.8),
        f1: () => setShortcutsOpen(true),
        f8: () => setSnap((v) => !v),
        q: () => setLoop((v) => !v),
        m: insertMarker,
        r: insertRegion,
        ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), () => goToMarker(n)])),
        escape: floatingOpen || !region ? null : () => setRegion(null),
        f11: api.toggleFullScreen,
        f12: api.toggleDevTools,
      }[key];
    }
    if (!action) return;
    e.preventDefault();
    if (e.target.tagName === 'BUTTON') e.target.blur(); // que Espacio/Intro no pulsen también el botón con foco
    action();
  };
  useEffect(() => {
    const onKey = (e) => keyHandler.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Divisor arrastrable entre el área superior y la línea de tiempo.
  const startResize = (e) => {
    const startY = e.clientY;
    const startH = upperHeight;
    const move = (me) => setUpperHeight(Math.min(window.innerHeight - 240, Math.max(180, startH + me.clientY - startY)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="app">
      <MenuBar menus={menus} />
      <Toolbar
        onNew={newProject}
        onOpen={open}
        onSave={() => save(false)}
        onImport={importDialog}
        onYoutube={() => setYoutubeOpen(true)}
        onProperties={openProperties}
        onRender={openRender}
        canRender={duration > 0}
        onUndo={history.undo}
        onRedo={history.redo}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onSplit={split}
        onDelete={deleteSelected}
        hasSelection={selection.length > 0}
        snap={snap}
        onToggleSnap={() => setSnap((v) => !v)}
        ripple={ripple}
        onToggleRipple={toggleRipple}
      />
      <div className="upper" style={{ height: upperHeight }}>
        <Dock
          className="media-dock"
          tabs={[
            { id: 'media', title: tx('Medios del proyecto') },
            { id: 'transitions', title: tx('Transiciones') },
            { id: 'effects', title: tx('Efectos de video') },
            { id: 'audioEffects', title: tx('Efectos de audio') },
            { id: 'subtitles', title: tx('Subtítulos') },
            { id: 'scopes', title: tx('Monitores de video') },
          ]}
          active={leftTab}
          onTab={setLeftTab}
        >
          {leftTab === 'media' && (
            <MediaPool
              media={project.media}
              onImport={importDialog}
              onYoutube={() => setYoutubeOpen(true)}
              onNewText={insertText}
              onDropFiles={dropFilesOnPool}
              onRemove={removeMediaItem}
              onAdd={addAtCursor}
              proxies={proxies}
              proxyJobs={proxyJobs}
              onMenu={mediaMenu}
            />
          )}
          {leftTab === 'transitions' && <TransitionsPanel />}
          {leftTab === 'effects' && <EffectsPanel key="video" kind="video" />}
          {leftTab === 'audioEffects' && <EffectsPanel key="audio" kind="audio" />}
          {leftTab === 'scopes' && <Scopes />}
          {leftTab === 'subtitles' && (
            <SubtitlesPanel
              project={project}
              setProject={setProject}
              time={time}
              seek={seek}
              region={region}
              focusId={focusCue}
              onFocused={clearFocusCue}
              onMessage={setStatus}
              defaultName={baseName(projectPath)}
              onTranscribe={() => setTranscribeOpen(true)}
            />
          )}
        </Dock>
        <Dock title={tx('Vista previa de video')} className="preview-dock">
          <Preview
            project={project}
            time={time}
            playing={playing}
            selection={selection}
            editTextId={textMediaId}
            onSelectEvent={selectEvent}
            onTextChange={updateTextMedia}
            onEditText={openTextEditor}
            panEventId={panEventId}
            onPanChange={changePanAtCursor}
            onOpenProperties={openProperties}
            commands={previewCommands}
            onMessage={setStatus}
            onExportFrame={exportFrame}
            proxies={proxies}
            onMediaError={onMediaError}
          />
        </Dock>
      </div>
      <div className="splitter" onPointerDown={startResize} />
      <Timeline
        ref={timelineRef}
        strips={strips}
        onEditSubtitle={editSubtitle}
        project={project}
        setProject={setProject}
        selection={selection}
        setSelection={setSelection}
        time={time}
        seek={seek}
        playing={playing}
        region={region}
        setRegion={setRegion}
        ripple={ripple}
        pps={pps}
        setPps={setPps}
        snap={snap}
        onDropFiles={dropFilesOnTimeline}
        onMessage={setStatus}
        onContextMenu={openContextMenu}
        onOpenFx={openFx}
        onEditText={editTextOf}
        onOpenPan={openPan}
        onAddTrack={insertTrack}
        armedTrackId={armedTrackId}
        onArmTrack={armTrack}
        recording={recording}
        footer={
          <Transport
            playing={playing}
            recording={!!recording}
            recorder={recorderRef}
            onRecord={toggleRecording}
            onRecordMenu={() => setRecordDialog(true)}
            loop={loop}
            onToggleLoop={() => setLoop((v) => !v)}
            onPlay={play}
            onPause={pause}
            onStop={stop}
            onStart={() => seek(0)}
            onEnd={() => seek(duration)}
            onPrevFrame={() => stepFrame(-1)}
            onNextFrame={() => stepFrame(1)}
          />
        }
      />
      {update.status === 'ready' && !updateHidden && (
        <div className="update-banner">
          <span>
           {tx('La versión')} <strong>{update.version}</strong> {tx('de Cortex Studio está lista para instalar.')}
          </span>
          <button className="primary" onClick={() => api.installUpdate()}>{tx('Reiniciar y actualizar')}</button>
          <button onClick={() => setUpdateHidden(true)} title={tx('Se instalará sola al cerrar Cortex Studio')}>{tx('Al cerrar')}</button>
        </div>
      )}
      <div className="statusbar">
        <span>
          {status || tx('Listo')}
          {update.status === 'downloading' && tx(' · Descargando la versión {version} ({round} %)', { version: update.version, round: Math.round(update.percent || 0) })}
          {update.status === 'ready' && updateHidden && tx(' · Versión {version} lista: se instalará al cerrar', { version: update.version })}
          {queueRunning && (() => {
            const current = queue.find((j) => j.status === 'rendering');
            const done = queue.filter((j) => j.status === 'done').length;
            return tx(' · Cola de render: {n}/{length}{n2}', { n: done + 1, length: queue.length, n2: current ? ` (${Math.floor(current.progress * 100)} %)` : '' });
          })()}
          {youtubeJob?.status === 'running' && !youtubeOpen && ` · ${youtubeProgressText(youtubeJob.progress)}`}
          {compressRunning && !compressOpen && (() => {
            const j = compressQueue.find((x) => x.status === 'running');
            const done = compressQueue.filter((x) => x.status === 'done' || x.status === 'error').length;
            return j ? ` · Comprimiendo ${done + 1}/${done + compressQueue.filter((x) => x.status === 'waiting' || x.status === 'running').length}: ${compressProgressText(j.progress)}` : '';
          })()}
        </span>
        <span>
          {baseName(projectPath)}{dirty ? tx(' (modificado)') : ''}
          {' · '}{tx(project.events.length === 1 ? '{n} evento' : '{n} eventos', { n: project.events.length })}
          {' · '}{tx(project.tracks.length === 1 ? '{n} pista' : '{n} pistas', { n: project.tracks.length })}
        </span>
      </div>
      {renderOpen && (
        <RenderDialog
          makePayload={(size, range, opts) => renderPayload(project, size, range, opts)}
          hasSubtitles={(project.subtitles?.cues || []).some((c) => c.text.trim())}
          settings={project.settings}
          region={region}
          regions={project.regions || []}
          projectLength={duration}
          defaultName={`${baseName(projectPath)}.mp4`}
          onClose={() => setRenderOpen(false)}
          onEnqueue={enqueueRenders}
        />
      )}
      {transcribeOpen && (
        <TranscribeDialog
          hasRegion={!!region}
          cueCount={project.subtitles?.cues?.length || 0}
          onTranscribe={transcribe}
          onCancel={() => transcribeCancel.current?.()}
          onClose={() => setTranscribeOpen(false)}
        />
      )}
      {compressOpen && (
        <CompressDialog
          queue={compressQueue}
          running={compressRunning}
          projectVideos={project.media.filter((m) => m.path && m.hasVideo && !m.isImage && !m.missing).map((m) => m.path)}
          onAdd={addToCompress}
          onRemove={(id) => setCompressQueue((q) => q.filter((j) => j.id !== id))}
          onClearDone={() => setCompressQueue((q) => q.filter((j) => j.status === 'waiting' || j.status === 'running'))}
          onStart={startCompress}
          onCancel={stopCompress}
          onClose={() => setCompressOpen(false)}
        />
      )}
      {youtubeOpen && (
        <YoutubeDialog
          job={youtubeJob}
          onDownload={startDownload}
          onCancel={() => api.youtubeCancel()}
          onClose={() => setYoutubeOpen(false)}
        />
      )}
      {queueOpen && (
        <QueueDialog
          queue={queue}
          running={queueRunning}
          onStart={() => setQueueRunning(true)}
          onStop={() => {
            setQueueRunning(false);
            api.cancelRender();
          }}
          onRemove={(id) => setQueue((q) => q.filter((j) => j.id !== id))}
          onRetry={(id) => setJob(id, { status: 'waiting', progress: 0, error: null })}
          onClearDone={() => setQueue((q) => q.filter((j) => j.status !== 'done'))}
          onClose={() => setQueueOpen(false)}
        />
      )}
      {projectDialog && (
        <ProjectDialog
          mode={projectDialog}
          initial={project.settings}
          onAccept={acceptProjectDialog}
          onCancel={() => setProjectDialog(null)}
          recents={recents}
          onOpenRecent={openRecent}
          onOpenOther={async () => {
            let result;
            try {
              result = await api.openProject();
            } catch (err) {
              window.alert(tx('No se pudo abrir el proyecto: {message}', { message: err.message }));
              return;
            }
            if (result) {
              setProjectDialog(null);
              await loadData(result.data, result.path);
            }
          }}
          onRemoveRecent={async (p) => {
            await api.removeRecent(p);
            setRecents(await api.recentProjects());
          }}
        />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {recordDialog && <RecordDialog projectPath={projectPath} onClose={() => setRecordDialog(false)} />}
      {contextMenu && <ContextMenu {...contextMenu} onClose={closeContextMenu} />}
      {fxEvent && (
        <EventFxDialog
          key={fxEvent.id}
          event={fxEvent}
          fps={project.settings.fps}
          time={time}
          onSeek={seek}
          kind={project.tracks.find((t) => t.id === fxEvent.trackId)?.type ?? 'video'}
          mediaName={project.media.find((m) => m.id === fxEvent.mediaId)?.name ?? ''}
          onChange={updateFxEffects}
          onClose={closeFx}
        />
      )}
      {panEvent && (
        <PanDialog
          key={panEvent.id}
          event={panEvent}
          mediaName={project.media.find((m) => m.id === panEvent.mediaId)?.name ?? ''}
          fps={project.settings.fps}
          time={time}
          fill={panFill(project, panEvent)}
          onChange={updatePan}
          onSeek={seek}
          onClose={closePan}
        />
      )}
      {textMedia && (
        <TextDialog
          key={textMedia.id}
          media={textMedia}
          height={project.settings.height}
          onChange={updateText}
          onClose={closeText}
        />
      )}
    </div>
  );
}
