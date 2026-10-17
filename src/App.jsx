import { useCallback, useEffect, useRef, useState } from 'react';
import MenuBar from './components/MenuBar.jsx';
import Toolbar from './components/Toolbar.jsx';
import Dock from './components/Dock.jsx';
import MediaPool from './components/MediaPool.jsx';
import TransitionsPanel from './components/TransitionsPanel.jsx';
import Preview from './components/Preview.jsx';
import Transport from './components/Transport.jsx';
import Timeline, { MAX_PPS, MIN_PPS } from './components/Timeline.jsx';
import RenderDialog from './components/RenderDialog.jsx';
import ProjectDialog from './components/ProjectDialog.jsx';
import ShortcutsDialog from './components/ShortcutsDialog.jsx';
import { useHistory } from './state/useHistory.js';
import {
  addTrack, deleteEvents, emptyProject, loadProject, mediaLength, placeMedia, projectDuration,
  removeMedia, renderPayload, serializeProject, splitEvents, uid,
} from './state/project.js';

const api = window.api;
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
  const [upperHeight, setUpperHeight] = useState(Math.round(window.innerHeight * 0.44));
  const [renderOpen, setRenderOpen] = useState(false);
  const [projectDialog, setProjectDialog] = useState('startup'); // null | 'startup' | 'new' | 'edit'
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [leftTab, setLeftTab] = useState('media'); // 'media' | 'transitions'
  const timelineRef = useRef(null);

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

  const play = useCallback(() => {
    const { playing: isPlaying, time: t, duration: d } = live.current;
    if (isPlaying || d <= 0) return;
    const from = t >= d - 0.01 ? 0 : t;
    playStart.current = from;
    setTime(from);
    setPlaying(true);
  }, []);

  const pause = useCallback(() => setPlaying(false), []);

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

  const selectAll = useCallback(() => setSelection(live.current.project.events.map((e) => e.id)), []);

  const insertTrack = useCallback((type) => setProject((p) => addTrack(p, type).project), [setProject]);

  const zoom = useCallback((factor) => setPps((v) => Math.min(MAX_PPS, Math.max(MIN_PPS, v * factor))), []);

  // ---- Proyecto ----

  const confirmDiscard = () => !live.current.dirty || window.confirm('Hay cambios sin guardar. ¿Descartarlos?');

  const newProject = useCallback(() => {
    if (confirmDiscard()) setProjectDialog('new');
  }, []);

  const acceptProjectDialog = (settings) => {
    if (projectDialog === 'edit') {
      setProject((p) => ({ ...p, settings }));
    } else {
      const fresh = emptyProject(settings);
      history.reset(fresh);
      setSavedProject(fresh);
      setProjectPath(null);
      setSelection([]);
      setPlaying(false);
      setTime(0);
    }
    setProjectDialog(null);
  };

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
    const loaded = loadProject(data, media);
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
        { label: 'Dividir', shortcut: 'S', action: split },
        { label: 'Eliminar', shortcut: 'Supr', action: deleteSelected, disabled: !selection.length },
        { label: 'Seleccionar todo', shortcut: 'Ctrl+A', action: selectAll },
        'separator',
        { label: 'Ajuste activado', shortcut: 'F8', action: () => setSnap((v) => !v), checked: snap },
      ],
    },
    {
      label: 'Ver',
      items: [
        { label: 'Acercar', shortcut: '↑', action: () => zoom(1.25) },
        { label: 'Alejar', shortcut: '↓', action: () => zoom(0.8) },
        { label: 'Ajustar el proyecto a la ventana', action: () => timelineRef.current?.zoomToFit() },
        'separator',
        { label: 'Medios del proyecto', shortcut: 'Alt+4', action: () => setLeftTab('media'), checked: leftTab === 'media' },
        { label: 'Transiciones', shortcut: 'Alt+8', action: () => setLeftTab('transitions'), checked: leftTab === 'transitions' },
        'separator',
        { label: 'Ir al inicio', shortcut: 'Inicio', action: () => seek(0) },
        { label: 'Ir al final', shortcut: 'Fin', action: () => seek(duration) },
      ],
    },
    {
      label: 'Insertar',
      items: [
        { label: 'Pista de video', shortcut: 'Ctrl+Mayús+Q', action: () => insertTrack('video') },
        { label: 'Pista de audio', shortcut: 'Ctrl+Q', action: () => insertTrack('audio') },
      ],
    },
    {
      label: 'Herramientas',
      items: [
        { label: 'Renderizar como…', shortcut: 'Ctrl+M', action: openRender, disabled: duration <= 0 },
        { label: 'Herramientas de desarrollo', shortcut: 'F12', action: api.toggleDevTools },
      ],
    },
    {
      label: 'Ayuda',
      items: [{ label: 'Atajos de teclado', shortcut: 'F1', action: () => setShortcutsOpen(true) }],
    },
  ];

  // ---- Atajos de teclado (los de Vegas cuando existen) ----

  const modalOpen = renderOpen || projectDialog !== null || shortcutsOpen;
  const keyHandler = useRef(null);
  keyHandler.current = (e) => {
    if (modalOpen || e.target.closest?.('input, select, textarea')) return;
    const key = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    let action;
    if (ctrl) {
      action = {
        z: e.shiftKey ? history.redo : history.undo,
        y: history.redo,
        s: () => save(e.shiftKey),
        o: open,
        n: newProject,
        i: importDialog,
        m: openRender,
        a: selectAll,
        q: () => insertTrack(e.shiftKey ? 'video' : 'audio'),
      }[key];
    } else if (e.altKey) {
      action = {
        enter: openProperties,
        4: () => setLeftTab('media'),
        8: () => setLeftTab('transitions'),
      }[key];
    } else {
      action = {
        ' ': () => (live.current.playing ? stop() : play()),
        enter: () => (live.current.playing ? pause() : play()),
        s: split,
        delete: deleteSelected,
        home: () => seek(0),
        end: () => seek(live.current.duration),
        arrowleft: () => stepFrame(-1),
        arrowright: () => stepFrame(1),
        arrowup: () => zoom(1.25),
        arrowdown: () => zoom(0.8),
        f1: () => setShortcutsOpen(true),
        f8: () => setSnap((v) => !v),
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
      />
      <div className="upper" style={{ height: upperHeight }}>
        <Dock
          className="media-dock"
          tabs={[
            { id: 'media', title: 'Medios del proyecto' },
            { id: 'transitions', title: 'Transiciones' },
          ]}
          active={leftTab}
          onTab={setLeftTab}
        >
          {leftTab === 'media' ? (
            <MediaPool
              media={project.media}
              onImport={importDialog}
              onDropFiles={dropFilesOnPool}
              onRemove={removeMediaItem}
              onAdd={addAtCursor}
            />
          ) : (
            <TransitionsPanel />
          )}
        </Dock>
        <Dock title="Vista previa de video" className="preview-dock">
          <Preview project={project} time={time} playing={playing} onOpenProperties={openProperties} />
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
        pps={pps}
        setPps={setPps}
        snap={snap}
        onDropFiles={dropFilesOnTimeline}
        onMessage={setStatus}
        footer={
          <Transport
            playing={playing}
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
      <div className="statusbar">
        <span>{status || 'Listo'}</span>
        <span>
          {baseName(projectPath)}
          {dirty ? ' (modificado)' : ''} · {project.events.length} eventos · {project.tracks.length} pistas
        </span>
      </div>
      {renderOpen && (
        <RenderDialog
          payload={renderPayload(project)}
          settings={project.settings}
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
    </div>
  );
}
