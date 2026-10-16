import { useCallback, useEffect, useRef, useState } from 'react';
import Toolbar from './components/Toolbar.jsx';
import MediaPool from './components/MediaPool.jsx';
import Preview from './components/Preview.jsx';
import Transport from './components/Transport.jsx';
import Timeline, { MAX_PPS, MIN_PPS } from './components/Timeline.jsx';
import RenderDialog from './components/RenderDialog.jsx';
import { useHistory } from './state/useHistory.js';
import {
  deleteEvents, emptyProject, mediaLength, placeMedia, projectDuration,
  removeMedia, renderPayload, serializeProject, splitEvents, uid,
} from './state/project.js';

const api = window.api;
const FRAME = 1 / 30;
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
  const [upperHeight, setUpperHeight] = useState(Math.round(window.innerHeight * 0.46));
  const [renderOpen, setRenderOpen] = useState(false);
  const [status, setStatus] = useState('');

  const duration = projectDuration(project);
  const dirty = project !== savedProject;
  const live = useRef(null);
  live.current = { project, time, playing, duration, dirty };
  const playStart = useRef(0);

  useEffect(() => {
    document.title = `${baseName(projectPath)}${dirty ? ' *' : ''} - Cortex Studio`;
  }, [projectPath, dirty]);

  // Reloj de reproducción: avanza desde playStart y se reinicia cuando el usuario busca otra posición.
  useEffect(() => {
    if (!playing) return undefined;
    const from = playStart.current;
    const t0 = performance.now();
    let raf;
    const tick = () => {
      const t = from + (performance.now() - t0) / 1000;
      if (t >= live.current.duration) {
        setTime(live.current.duration);
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
    if (live.current.playing) {
      playStart.current = clamped;
      setPlayToken((n) => n + 1);
    }
  }, []);

  const togglePlay = useCallback(() => {
    const { playing: isPlaying, time: t, duration: d } = live.current;
    if (isPlaying) {
      setPlaying(false);
      return;
    }
    if (d <= 0) return;
    const from = t >= d - 0.01 ? 0 : t;
    playStart.current = from;
    setTime(from);
    setPlaying(true);
  }, []);

  const stop = useCallback(() => {
    if (live.current.playing) {
      setPlaying(false);
      setTime(playStart.current);
    } else {
      setTime(0);
    }
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

  const split = useCallback(() => {
    setProject((p) => splitEvents(p, live.current.time, selection));
  }, [selection, setProject]);

  const deleteSelected = useCallback(() => {
    if (!selection.length) return;
    setProject((p) => deleteEvents(p, selection));
    setSelection([]);
  }, [selection, setProject]);

  // ---- Proyecto ----

  const confirmDiscard = () => !live.current.dirty || window.confirm('Hay cambios sin guardar. ¿Descartarlos?');

  const newProject = useCallback(() => {
    if (!confirmDiscard()) return;
    const fresh = emptyProject();
    history.reset(fresh);
    setSavedProject(fresh);
    setProjectPath(null);
    setSelection([]);
    setPlaying(false);
    setTime(0);
  }, [history]);

  const save = useCallback(async (saveAs = false) => {
    const current = live.current.project;
    try {
      const saved = await api.saveProject(serializeProject(current), saveAs ? null : projectPath);
      if (!saved) return;
      setProjectPath(saved);
      setSavedProject(current);
      setStatus(`Proyecto guardado en ${saved}`);
    } catch (err) {
      window.alert(`No se pudo guardar: ${err.message}`);
    }
  }, [projectPath]);

  const open = useCallback(async () => {
    if (!confirmDiscard()) return;
    let result;
    try {
      result = await api.openProject();
    } catch (err) {
      window.alert(`No se pudo abrir el proyecto: ${err.message}`);
      return;
    }
    if (!result) return;
    const { data } = result;
    if (data.format !== 'cortex-studio' || !Array.isArray(data.tracks) || !Array.isArray(data.events)) {
      window.alert('El archivo no es un proyecto válido de Cortex Studio.');
      return;
    }
    setPlaying(false);
    const media = [];
    for (const m of data.media) {
      setStatus(`Cargando ${m.name}…`);
      try {
        media.push({ ...(await api.analyzeMedia(m.path)), id: m.id });
      } catch {
        media.push({ ...m, missing: true, hasVideo: true, hasAudio: true });
      }
    }
    const loaded = { media, tracks: data.tracks, events: data.events };
    history.reset(loaded);
    setSavedProject(loaded);
    setProjectPath(result.path);
    setSelection([]);
    setTime(0);
    const missing = media.filter((m) => m.missing).length;
    setStatus(missing ? `Proyecto abierto. Faltan ${missing} archivo(s) de medios.` : 'Proyecto abierto');
  }, [history]);

  const openRender = useCallback(() => {
    if (live.current.duration <= 0) return;
    setPlaying(false);
    setRenderOpen(true);
  }, []);

  // ---- Atajos de teclado ----

  const keyHandler = useRef(null);
  keyHandler.current = (e) => {
    if (renderOpen || e.target.closest?.('input, select, textarea')) return;
    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const actions = {
      ' ': !ctrl && togglePlay,
      z: ctrl && history.undo,
      y: ctrl && history.redo,
      s: ctrl ? () => save(e.shiftKey) : split,
      o: ctrl && open,
      n: ctrl && newProject,
      i: ctrl && importDialog,
      m: ctrl && openRender,
      delete: deleteSelected,
      home: () => seek(0),
      end: () => seek(live.current.duration),
      arrowleft: () => seek(live.current.time - FRAME),
      arrowright: () => seek(live.current.time + FRAME),
      arrowup: () => setPps((v) => Math.min(MAX_PPS, v * 1.25)),
      arrowdown: () => setPps((v) => Math.max(MIN_PPS, v * 0.8)),
      f12: api.toggleDevTools,
    };
    if (ctrl && e.shiftKey && key === 'z') actions.z = history.redo;
    const action = actions[key];
    if (!action) return;
    e.preventDefault();
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
    const move = (me) => setUpperHeight(Math.min(window.innerHeight - 220, Math.max(180, startH + me.clientY - startY)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="app">
      <Toolbar
        title={baseName(projectPath)}
        dirty={dirty}
        onNew={newProject}
        onOpen={open}
        onSave={() => save(false)}
        onSaveAs={() => save(true)}
        onImport={importDialog}
        onUndo={history.undo}
        onRedo={history.redo}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onSplit={split}
        onDelete={deleteSelected}
        hasSelection={selection.length > 0}
        onRender={openRender}
        canRender={duration > 0}
      />
      <div className="upper" style={{ height: upperHeight }}>
        <MediaPool
          media={project.media}
          onImport={importDialog}
          onDropFiles={dropFilesOnPool}
          onRemove={removeMediaItem}
          onAdd={addAtCursor}
        />
        <div className="panel preview-panel">
          <div className="panel-header">
            <span>Vista previa</span>
          </div>
          <Preview project={project} time={time} playing={playing} />
          <Transport
            playing={playing}
            time={time}
            duration={duration}
            onTogglePlay={togglePlay}
            onStop={stop}
            onStart={() => seek(0)}
            onEnd={() => seek(duration)}
          />
        </div>
      </div>
      <div className="splitter" onPointerDown={startResize} />
      <Timeline
        project={project}
        setProject={setProject}
        selection={selection}
        setSelection={setSelection}
        time={time}
        seek={seek}
        playing={playing}
        pps={pps}
        setPps={setPps}
        snap={snap}
        setSnap={setSnap}
        onDropFiles={dropFilesOnTimeline}
      />
      <div className="statusbar">
        <span>{status}</span>
        <span>
          {project.events.length} eventos · {project.tracks.length} pistas
        </span>
      </div>
      {renderOpen && (
        <RenderDialog
          payload={renderPayload(project)}
          defaultName={`${baseName(projectPath)}.mp4`}
          onClose={() => setRenderOpen(false)}
        />
      )}
    </div>
  );
}
