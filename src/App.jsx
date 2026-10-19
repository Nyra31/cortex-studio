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
import ProjectDialog from './components/ProjectDialog.jsx';
import ShortcutsDialog from './components/ShortcutsDialog.jsx';
import RecordDialog from './components/RecordDialog.jsx';
import { useHistory } from './state/useHistory.js';
import ContextMenu from './components/ContextMenu.jsx';
import {
  EVENT_DEFAULTS, FADE_CURVES, IMAGE_DURATION, MIN_EVENT, addMarker, addRegion, addTrack, copyEvents, deleteMark, deleteRange, emptyProject, markPoints, fitSize, groupEvents, loadProject, loadView, mediaLength, pasteEvents,
  placeMedia, projectDuration, removeMedia, renderPayload, rippleDelete, rippleShift, serializeProject, splitEvents, uid,
  moveTrack, splitRange, trimToCursor, ungroupEvents, updateEvents,
} from './state/project.js';
import { TEXT_DEFAULTS, isText, newTextMedia, withTextThumb } from './state/text.js';
import { panActive, setPanValues } from './state/pan.js';
import { hasRamp, shiftSpeed, sourceOffset } from './state/speed.js';
import { transitionLabel } from './state/transitions.js';
import { Recorder, loadRecordSettings, micError } from './preview/recorder.js';

const api = window.api;
const AUTOSAVE_MS = 60 * 1000; // guardado automático (copia de recuperación) cada minuto si hay cambios

// Escala con la que la imagen del evento llena todo el cuadro (sin bandas), para «Llenar el cuadro».
function panFill(project, e) {
  const m = project.media.find((x) => x.id === e.mediaId);
  const { width: W, height: H } = project.settings;
  const fit = m && (isText(m) ? { w: W, h: H } : fitSize(m.width, m.height, W, H));
  return fit ? Math.max(W / fit.w, H / fit.h) : null;
}
const baseName = (p) => (p ? p.split(/[\\/]/).pop().replace(/\.cortex$/i, '') : 'Sin título');

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
  const [projectDialog, setProjectDialog] = useState('startup'); // null | 'startup' | 'new' | 'edit'
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [leftTab, setLeftTab] = useState('media'); // 'media' | 'transitions' | 'effects' | 'audioEffects'
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
    document.title = `${baseName(projectPath)}${dirty ? ' *' : ''} - Cortex Studio`;
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
      setStatus(`Importando ${baseName(filePath)}…`);
      try {
        const media = { id: uid('m'), ...(await api.analyzeMedia(filePath)) };
        setProject((p) => ({ ...p, media: [...p.media, media] }));
        imported.push(media);
      } catch {
        failed.push(filePath.split(/[\\/]/).pop());
      }
    }
    setStatus(failed.length ? `No se pudieron importar: ${failed.join(', ')}` : '');
    return imported;
  }, [setProject]);

  const importDialog = useCallback(async () => {
    const paths = await api.pickMedia();
    if (paths.length) await importPaths(paths);
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
    if (used && !window.confirm('Este medio se usa en la línea de tiempo. ¿Quitarlo junto con sus eventos?')) return;
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
    if (next === p) setStatus('Para recortar hasta el cursor, el cursor tiene que estar dentro del evento seleccionado.');
    else setProject(next);
  }, [setProject]);

  // Exportar el fotograma del cursor como PNG, al tamaño del proyecto (se renderiza con FFmpeg: sale igual
  // que en el render, con efectos, textos y transiciones).
  const exportFrame = useCallback(async () => {
    const { project: p, time: t, projectPath: file } = live.current;
    const fps = p.settings.fps;
    const frame = Math.min(Math.floor(t * fps + 1e-6), Math.max(0, Math.ceil(projectDuration(p) * fps) - 1));
    if (projectDuration(p) <= 0) return;
    const name = `${baseName(file)} ${String(frame).padStart(5, '0')}.png`;
    const target = await api.pickRenderPath(name, { name: 'Imagen PNG', ext: 'png' });
    if (!target) return;
    setStatus('Exportando el fotograma…');
    const size = { width: p.settings.width, height: p.settings.height };
    const range = { start: frame / fps, end: (frame + 1) / fps };
    const res = await api.startRender(renderPayload(p, size, range), { ...size, fps, format: 'png' }, target);
    setStatus(res.ok ? `Fotograma ${frame} guardado en ${target}` : `No se pudo exportar el fotograma: ${res.error || ''}`);
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
    setStatus(`Marcador ${res.marker.number} añadido${res.marker.number <= 9 ? ` (tecla ${res.marker.number} para volver a él)` : ''}. Doble clic en él para ponerle nombre.`);
  }, [setProject]);
  const insertRegion = useCallback(() => {
    const r = live.current.region;
    if (!r) {
      setStatus('Para crear una región, primero marca una selección de tiempo en la barra de arriba de la regla.');
      return;
    }
    const res = addRegion(live.current.project, r.start, r.end);
    setProject(res.project);
    setStatus(`Región ${res.region.number} añadida. Doble clic en ella para ponerle nombre.`);
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
    setStatus('Tramo eliminado: lo de detrás se ha adelantado para cerrar el hueco.');
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
    setStatus('Abriendo el micrófono…');
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
      setProject({ ...res.project, tracks: res.project.tracks.map((tr) => (tr.id === trackId ? { ...tr, name: 'Voz en off' } : tr)) });
      setArmedTrackId(trackId);
    }
    const from = r && (t < r.start || t >= r.end - 1e-6) ? r.start : t;
    playStart.current = from;
    setTime(from);
    setRecording({ trackId, start: from });
    setPlaying(true);
    setStatus(`● Grabando${recorder.label ? ` con «${recorder.label}»` : ''}… Espacio o Ctrl+R para terminar.`);
  }, [setProject]);

  // Al parar la reproducción (por cualquier vía) mientras se graba: se cierra el archivo, se importa y se
  // coloca en la pista. Si la pista ya tiene algo en ese tramo, en una pista nueva justo debajo (no se pisa).
  const finishRecording = useCallback(async () => {
    const rec = live.current.recording;
    const recorder = recorderRef.current;
    setRecording(null);
    recorderRef.current = null;
    if (!recorder || !rec) return;
    setStatus('Guardando la grabación…');
    let result;
    let media;
    try {
      result = await recorder.stop();
      if (!result) {
        setStatus('No se ha grabado nada.');
        return;
      }
      media = { id: uid('m'), ...(await api.analyzeMedia(result.path)) };
    } catch (err) {
      setStatus(`No se pudo guardar la grabación: ${err.message}`);
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
    setStatus(`Grabación guardada en ${result.path}${busy ? ' (en una pista nueva: la pista armada ya tenía eventos en ese tramo)' : ''}`);
  }, [setProject]);
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
    setStatus(`${clip.events.length} ${clip.events.length === 1 ? 'evento copiado' : 'eventos copiados'}`);
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
      setStatus('No se puede pegar: los medios de lo copiado ya no están en el proyecto.');
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
        { label: 'Cambiar el nombre…', action: info.rename },
        ...(isRegion
          ? [
            { label: 'Seleccionar la región', action: () => setRegion({ start: mark.start, end: mark.end }) },
            {
              label: 'Renderizar la región…',
              action: () => {
                setRegion({ start: mark.start, end: mark.end });
                openRender();
              },
            },
          ]
          : [{ label: 'Ir al marcador', shortcut: mark.number <= 9 ? String(mark.number) : undefined, action: () => seek(mark.time) }]),
        'separator',
        { label: isRegion ? 'Eliminar la región' : 'Eliminar el marcador', action: () => setProject((cur) => deleteMark(cur, info.kind, mark.id)) },
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
            label: `${zone === 'in' ? 'Fundido de entrada' : 'Fundido de salida'}: ${c.label.toLowerCase()}`,
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
              label: `Quitar la transición (${transitionLabel(info.event[zone === 'in' ? 'fadeInTransition' : 'fadeOutTransition'])})`,
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
        { label: 'Cortar', shortcut: 'Ctrl+X', action: () => cutIds(ids) },
        { label: 'Copiar', shortcut: 'Ctrl+C', action: () => copyIds(ids) },
        { label: 'Pegar', shortcut: 'Ctrl+V', action: () => paste(), disabled: !clip },
        { label: 'Eliminar', shortcut: 'Supr', action: () => deleteIds(ids) },
        'separator',
        {
          label: 'Dividir en el cursor',
          shortcut: 'S',
          action: () => setProject((cur) => splitEvents(cur, live.current.time, ids)),
          disabled: !selected.some((e) => e.start < t && t < e.start + e.duration),
        },
        'separator',
        { label: 'Agrupar', shortcut: 'G', action: () => groupIds(ids), disabled: ids.length < 2 },
        { label: 'Quitar del grupo', shortcut: 'U', action: () => ungroupIds(ids), disabled: !selected.some((e) => e.groupId) },
        'separator',
        {
          label: 'Velocidad normal (100 %)',
          action: () => setProject((cur) => updateEvents(cur, ids, (e) => ({ duration: sourceOffset(e, e.duration), rate: 1, speed: null }))),
          disabled: !selected.some((e) => (e.rate || 1) !== 1 || hasRamp(e)),
        },
        {
          // Rampa: envolvente de velocidad en el evento y su grupo, que empieza plana (100 %) con un punto en cada extremo.
          label: 'Rampa de velocidad (envolvente)',
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
          label: 'Quitar fundidos',
          action: () => setProject((cur) => updateEvents(cur, ids, { fadeIn: 0, fadeOut: 0 })),
          disabled: !selected.some((e) => e.fadeIn > 0 || e.fadeOut > 0),
        },
        ...(audio.length
          ? [{
            label: 'Volumen del evento a 0 dB',
            action: () => setProject((cur) => updateEvents(cur, audio.map((e) => e.id), { volume: 0 })),
            disabled: !audio.some((e) => (e.volume ?? 0) !== 0),
          }]
          : []),
        ...(isVideo && info.event.transition
          ? [{
            label: 'Volver a disolución cruzada',
            action: () => setProject((cur) => updateEvents(cur, [info.event.id], { transition: null })),
          }]
          : []),
        'separator',
        ...(isText(media) ? [{ label: 'Editar texto…', action: () => openTextEditor(media.id) }] : []),
        ...(isVideo
          ? [
            { label: 'Panorámica/recorte del evento…', action: () => openPan(info.event.id) },
            {
              label: 'Quitar panorámica y recorte',
              action: () => setProject((cur) => updateEvents(cur, ids, { pan: null })),
              disabled: !selected.some((e) => e.pan),
            },
          ]
          : []),
        { label: 'Efectos del evento…', action: () => { setPanEventId(null); setTextMediaId(null); setFxEventId(info.event.id); } },
        {
          label: 'Quitar efectos',
          action: () => setProject((cur) => updateEvents(cur, ids, { effects: [] })),
          disabled: !selected.some((e) => e.effects?.length),
        },
        'separator',
        {
          label: 'Seleccionar el tramo del evento',
          action: () => setRegion({ start: info.event.start, end: info.event.start + info.event.duration }),
        },
        {
          label: 'Abrir la ubicación del archivo',
          action: () => api.revealFile(media.path),
          disabled: !media || media.missing || isText(media),
        },
      ];
    } else {
      items = [
        { label: 'Pegar aquí', action: () => paste(info.time, info.trackId), disabled: !clip },
        { label: 'Pegar en el cursor', shortcut: 'Ctrl+V', action: () => paste(), disabled: !clip },
        'separator',
        { label: 'Seleccionar todo', shortcut: 'Ctrl+A', action: selectAll },
        { label: 'Quitar la selección de tiempo', shortcut: 'Esc', action: () => setRegion(null), disabled: !live.current.region },
        { label: 'Eliminar el tramo seleccionado y cerrar el hueco', shortcut: 'Ctrl+Supr', action: deleteRegion, disabled: !live.current.region },
        'separator',
        { label: 'Insertar medio de texto', action: insertText },
        { label: 'Insertar pista de video', shortcut: 'Ctrl+Mayús+Q', action: () => insertTrack('video') },
        { label: 'Insertar pista de audio', shortcut: 'Ctrl+Q', action: () => insertTrack('audio') },
      ];
    }
    setContextMenu({ x: info.x, y: info.y, items });
  }, [copyIds, cutIds, deleteIds, deleteRegion, groupIds, insertText, insertTrack, openPan, openRender, openTextEditor, paste, seek, selectAll, setProject, ungroupIds]);

  const zoom = useCallback((factor) => setPps((v) => Math.min(MAX_PPS, Math.max(MIN_PPS, v * factor))), []);

  // ---- Proyecto ----

  const confirmDiscard = () => !live.current.dirty || window.confirm('Hay cambios sin guardar. ¿Descartarlos?');

  const newProject = useCallback(() => {
    if (confirmDiscard()) setProjectDialog('new');
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
      setStatus(`Proyecto guardado en ${saved}`);
      api.clearAutosave(); // guardado de verdad: la copia de recuperación ya no hace falta
      return true;
    } catch (err) {
      window.alert(`No se pudo guardar: ${err.message}`);
      return false;
    }
  }, [projectPath]);

  // Carga un proyecto leído de disco (o una copia de recuperación: recovered = true, queda como modificado
  // y, al guardar, se guarda en su archivo de siempre).
  const loadData = useCallback(async (data, filePath, recovered = false) => {
    if (data?.format !== 'cortex-studio' || !Array.isArray(data.tracks) || !Array.isArray(data.events)) {
      window.alert('El archivo no es un proyecto válido de Cortex Studio.');
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
      setStatus(`Cargando ${m.name}…`);
      try {
        media.push({ ...(await api.analyzeMedia(m.path)), id: m.id });
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
    const what = recovered ? 'Proyecto recuperado (aún sin guardar)' : 'Proyecto abierto';
    setStatus(missing ? `${what}. Faltan ${missing} archivo(s) de medios.` : what);
  }, [history]);

  const open = useCallback(async () => {
    if (!confirmDiscard()) return;
    let result;
    try {
      result = await api.openProject();
    } catch (err) {
      window.alert(`No se pudo abrir el proyecto: ${err.message}`);
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
      const when = new Date(rec.savedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
      const ok = window.confirm(
        `Cortex Studio no se cerró correctamente la última vez.

Hay una copia de recuperación de «${baseName(rec.projectPath)}» ` +
          `guardada automáticamente el ${when}.

¿Quieres recuperarla?`,
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
      if (state.manual && state.status === 'latest') setStatus('Ya tienes la última versión de Cortex Studio.');
      if (state.manual && state.status === 'error') setStatus(`No se pudo buscar actualizaciones: ${state.message}`);
    });
  }, []);
  const checkForUpdates = useCallback(async () => {
    setStatus('Buscando actualizaciones…');
    const state = await api.checkForUpdates();
    if (state.status === 'unavailable') setStatus('Las actualizaciones automáticas solo funcionan en la aplicación instalada.');
    else if (state.status === 'downloading') setStatus(`Descargando la versión ${state.version}…`);
    else if (state.status === 'ready') setUpdateHidden(false);
  }, []);


  const openProperties = useCallback(() => setProjectDialog('edit'), []);

  // ---- Menús ----

  const menus = [
    {
      label: 'Archivo',
      items: [
        { label: 'Nuevo…', shortcut: 'Ctrl+N', action: newProject },
        { label: 'Abrir…', shortcut: 'Ctrl+O', action: open },
        { label: 'Guardar', shortcut: 'Ctrl+S', action: () => save(false) },
        { label: 'Guardar como…', shortcut: 'Ctrl+Mayús+S', action: () => save(true) },
        'separator',
        { label: 'Importar medios…', shortcut: 'Ctrl+I', action: importDialog },
        { label: 'Renderizar como…', shortcut: 'Ctrl+M', action: openRender, disabled: duration <= 0 },
        { label: 'Exportar el fotograma como imagen…', shortcut: 'Ctrl+Mayús+E', action: exportFrame, disabled: duration <= 0 },
        'separator',
        { label: 'Propiedades del proyecto…', shortcut: 'Alt+Intro', action: openProperties },
        'separator',
        { label: 'Salir', action: () => window.close() },
      ],
    },
    {
      label: 'Edición',
      items: [
        { label: 'Deshacer', shortcut: 'Ctrl+Z', action: history.undo, disabled: !history.canUndo },
        { label: 'Rehacer', shortcut: 'Ctrl+Y', action: history.redo, disabled: !history.canRedo },
        'separator',
        { label: 'Cortar', shortcut: 'Ctrl+X', action: () => cutIds(selection), disabled: !selection.length },
        { label: 'Copiar', shortcut: 'Ctrl+C', action: () => copyIds(selection), disabled: !selection.length },
        { label: 'Pegar', shortcut: 'Ctrl+V', action: () => paste(), disabled: !clipboard },
        'separator',
        { label: region ? 'Dividir en los extremos de la selección' : 'Dividir', shortcut: 'S', action: split },
        { label: 'Recortar el principio hasta el cursor', shortcut: 'Alt+[', action: () => trimCursor('start') },
        { label: 'Recortar el final hasta el cursor', shortcut: 'Alt+]', action: () => trimCursor('end') },
        { label: 'Eliminar', shortcut: 'Supr', action: deleteSelected, disabled: !selection.length },
        { label: 'Seleccionar todo', shortcut: 'Ctrl+A', action: selectAll },
        'separator',
        { label: 'Agrupar', shortcut: 'G', action: () => groupIds(selection), disabled: selection.length < 2 },
        { label: 'Quitar del grupo', shortcut: 'U', action: () => ungroupIds(selection), disabled: !selection.length },
        'separator',
        { label: 'Ajuste activado', shortcut: 'F8', action: () => setSnap((v) => !v), checked: snap },
        { label: 'Edición en cascada', shortcut: 'Ctrl+L', action: toggleRipple, checked: !!ripple },
        { label: '    Solo en las pistas afectadas', action: () => chooseRippleMode('tracks'), checked: rippleMode === 'tracks' },
        { label: '    En todas las pistas', action: () => chooseRippleMode('all'), checked: rippleMode === 'all' },
        { label: 'Reproducción en bucle', shortcut: 'Q', action: () => setLoop((v) => !v), checked: loop },
        { label: 'Quitar la selección de tiempo', shortcut: 'Esc', action: () => setRegion(null), disabled: !region },
        { label: 'Eliminar el tramo seleccionado y cerrar el hueco', shortcut: 'Ctrl+Supr', action: deleteRegion, disabled: !region },
      ],
    },
    {
      label: 'Ver',
      items: [
        { label: 'Acercar', shortcut: '↑', action: () => zoom(1.25) },
        { label: 'Alejar', shortcut: '↓', action: () => zoom(0.8) },
        { label: 'Ajustar el proyecto a la ventana', action: () => timelineRef.current?.zoomToFit() },
        'separator',
        { label: 'Pantalla completa', shortcut: 'F11', action: api.toggleFullScreen, checked: fullScreen },
        { label: 'Vista previa a pantalla completa', shortcut: 'Alt+Mayús+4', action: togglePreviewFull },
        'separator',
        { label: 'Medios del proyecto', shortcut: 'Alt+4', action: () => setLeftTab('media'), checked: leftTab === 'media' },
        { label: 'Transiciones', shortcut: 'Alt+7', action: () => setLeftTab('transitions'), checked: leftTab === 'transitions' },
        { label: 'Efectos de video', shortcut: 'Alt+8', action: () => setLeftTab('effects'), checked: leftTab === 'effects' },
        { label: 'Efectos de audio', action: () => setLeftTab('audioEffects'), checked: leftTab === 'audioEffects' },
        'separator',
        { label: 'Ir al inicio', shortcut: 'Inicio', action: () => seek(0) },
        { label: 'Ir al final', shortcut: 'Fin', action: () => seek(duration) },
        { label: 'Punto de edición anterior', shortcut: 'Ctrl+←', action: () => jumpToEdit(-1) },
        { label: 'Punto de edición siguiente', shortcut: 'Ctrl+→', action: () => jumpToEdit(1) },
        { label: 'Fotograma anterior', shortcut: '←', action: () => stepFrame(-1) },
        { label: 'Fotograma siguiente', shortcut: '→', action: () => stepFrame(1) },
      ],
    },
    {
      label: 'Insertar',
      items: [
        { label: 'Medio de texto', action: insertText },
        'separator',
        { label: 'Marcador', shortcut: 'M', action: insertMarker },
        { label: 'Región (de la selección de tiempo)', shortcut: 'R', action: insertRegion, disabled: !region },
        'separator',
        { label: 'Pista de video', shortcut: 'Ctrl+Mayús+Q', action: () => insertTrack('video') },
        { label: 'Pista de audio', shortcut: 'Ctrl+Q', action: () => insertTrack('audio') },
      ],
    },
    {
      label: 'Herramientas',
      items: [
        { label: recording ? 'Terminar la grabación' : 'Grabar voz en off', shortcut: 'Ctrl+R', action: toggleRecording },
        { label: 'Opciones de grabación…', action: () => setRecordDialog(true), disabled: !!recording },
        'separator',
        { label: 'Renderizar como…', shortcut: 'Ctrl+M', action: openRender, disabled: duration <= 0 },
        { label: 'Herramientas de desarrollo', shortcut: 'F12', action: api.toggleDevTools },
      ],
    },
    {
      label: 'Ayuda',
      items: [
        { label: 'Atajos de teclado', shortcut: 'F1', action: () => setShortcutsOpen(true) },
        'separator',
        { label: 'Buscar actualizaciones…', action: checkForUpdates },
        { label: `Cortex Studio ${version}`, disabled: true },
      ],
    },
  ];

  // ---- Atajos de teclado (los de Vegas cuando existen) ----

  const modalOpen = renderOpen || projectDialog !== null || shortcutsOpen || recordDialog;
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
            { id: 'media', title: 'Medios del proyecto' },
            { id: 'transitions', title: 'Transiciones' },
            { id: 'effects', title: 'Efectos de video' },
            { id: 'audioEffects', title: 'Efectos de audio' },
          ]}
          active={leftTab}
          onTab={setLeftTab}
        >
          {leftTab === 'media' && (
            <MediaPool
              media={project.media}
              onImport={importDialog}
              onNewText={insertText}
              onDropFiles={dropFilesOnPool}
              onRemove={removeMediaItem}
              onAdd={addAtCursor}
            />
          )}
          {leftTab === 'transitions' && <TransitionsPanel />}
          {leftTab === 'effects' && <EffectsPanel key="video" kind="video" />}
          {leftTab === 'audioEffects' && <EffectsPanel key="audio" kind="audio" />}
        </Dock>
        <Dock title="Vista previa de video" className="preview-dock">
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
          />
        </Dock>
      </div>
      <div className="splitter" onPointerDown={startResize} />
      <Timeline
        ref={timelineRef}
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
        onOpenFx={(id) => {
          setTextMediaId(null);
          setPanEventId(null);
          setFxEventId(id);
        }}
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
            La versión <strong>{update.version}</strong> de Cortex Studio está lista para instalar.
          </span>
          <button className="primary" onClick={() => api.installUpdate()}>Reiniciar y actualizar</button>
          <button onClick={() => setUpdateHidden(true)} title="Se instalará sola al cerrar Cortex Studio">Al cerrar</button>
        </div>
      )}
      <div className="statusbar">
        <span>
          {status || 'Listo'}
          {update.status === 'downloading' && ` · Descargando la versión ${update.version} (${Math.round(update.percent || 0)} %)`}
          {update.status === 'ready' && updateHidden && ` · Versión ${update.version} lista: se instalará al cerrar`}
        </span>
        <span>
          {baseName(projectPath)}
          {dirty ? ' (modificado)' : ''} · {project.events.length} eventos · {project.tracks.length} pistas
        </span>
      </div>
      {renderOpen && (
        <RenderDialog
          makePayload={(size, range) => renderPayload(project, size, range)}
          settings={project.settings}
          region={region}
          regions={project.regions || []}
          projectLength={duration}
          defaultName={`${baseName(projectPath)}.mp4`}
          onClose={() => setRenderOpen(false)}
        />
      )}
      {projectDialog && (
        <ProjectDialog
          mode={projectDialog}
          initial={project.settings}
          onAccept={acceptProjectDialog}
          onCancel={() => setProjectDialog(null)}
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
