import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Waveform from './Waveform.jsx';
import Icon from './Icon.jsx';
import { formatRuler, formatTimecode } from '../util/time.js';
import { MIN_EVENT, MIN_VOLUME_DB, deleteTrack, isTrackActive, placeMedia, trackColor } from '../state/project.js';

export const MEDIA_MIME = 'application/x-cortex-media';
const HEADER_W = 230;
const TRACK_H = { video: 64, audio: 72 };
const TITLE_H = 16;
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
export const MIN_PPS = 1;
export const MAX_PPS = 800;
const clampPps = (v) => Math.min(MAX_PPS, Math.max(MIN_PPS, v));

// Ajusta dt para que alguna referencia (borde de evento) caiga sobre un punto de anclaje cercano.
function snapDelta(dt, refs, points, threshold) {
  let best = null;
  for (const r of refs) {
    for (const p of points) {
      const d = p - (r + dt);
      if (Math.abs(d) < threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best === null ? dt : dt + best;
}

const allowDrop = (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
};

const Ruler = memo(function Ruler({ pps, time, scrollLeft, viewWidth, laneWidth, onPointerDown }) {
  const step = TICK_STEPS.find((s) => s * pps >= 90) ?? 3600;
  const minor = step / 5;
  const ticks = [];
  const first = Math.max(0, Math.floor(scrollLeft / pps / minor));
  const lastTime = (scrollLeft + viewWidth) / pps;
  for (let i = first; i * minor <= lastTime; i++) {
    const t = i * minor;
    const major = i % 5 === 0;
    ticks.push(
      <div key={i} className={major ? 'tick major' : 'tick'} style={{ left: t * pps }}>
        {major && <span>{formatRuler(t, step)}</span>}
      </div>,
    );
  }
  return (
    <div className="ruler" style={{ width: laneWidth }} onPointerDown={onPointerDown}>
      <div className="marker-bar" />
      {ticks}
      <div className="cursor-head" style={{ left: time * pps }} />
    </div>
  );
});

const EventView = memo(function EventView({ ev, media, type, selected, pps, onDown }) {
  const width = Math.max(3, ev.duration * pps);
  const bodyStyle = type === 'video' && media?.thumb ? { backgroundImage: `url(${media.thumb})` } : undefined;
  return (
    <div
      className={`event ${type}${selected ? ' selected' : ''}${media?.missing ? ' missing' : ''}`}
      style={{ left: ev.start * pps, width }}
      onPointerDown={(e) => onDown(e, ev, 'move')}
      title={media?.missing ? `Archivo no encontrado: ${media.path}` : media?.name}
    >
      <div className="event-title">{media ? media.name : '?'}</div>
      <div className="event-body" style={bodyStyle}>
        {type === 'audio' && media?.peaks && (
          <Waveform
            peaks={media.peaks}
            peaksPerSecond={media.peaksPerSecond}
            inPoint={ev.inPoint}
            duration={ev.duration}
            width={width}
            height={TRACK_H.audio - TITLE_H - 6}
          />
        )}
      </div>
      <div className="handle left" onPointerDown={(e) => onDown(e, ev, 'trimL')} />
      <div className="handle right" onPointerDown={(e) => onDown(e, ev, 'trimR')} />
    </div>
  );
});

function TrackName({ name, onRename }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        className="track-name-input"
        autoFocus
        defaultValue={name}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          setEditing(false);
          const value = e.target.value.trim();
          if (value && value !== name) onRename(value);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.currentTarget.value = name;
            e.currentTarget.blur();
          }
        }}
      />
    );
  }
  return (
    <span className="track-name" title="Doble clic para cambiar el nombre" onDoubleClick={() => setEditing(true)}>
      {name}
    </span>
  );
}

function VolumeSlider({ value, onChange }) {
  const first = useRef(true);
  const label = value <= MIN_VOLUME_DB ? '-∞ dB' : `${value.toFixed(1).replace('.', ',')} dB`;
  return (
    <div className="track-slider" title="Volumen de la pista (doble clic: 0 dB)">
      <span className="slider-label">Vol:</span>
      <input
        type="range"
        min={MIN_VOLUME_DB}
        max={0}
        step={0.1}
        value={value}
        onPointerDown={() => (first.current = true)}
        onKeyDown={() => (first.current = true)}
        onChange={(e) => {
          onChange(Number(e.target.value), first.current);
          first.current = false;
        }}
        onDoubleClick={() => onChange(0, true)}
      />
      <span className="slider-value">{label}</span>
    </div>
  );
}

const TrackRow = memo(function TrackRow({
  track, number, color, inactive, events, mediaById, selectedSet, pps, laneWidth, rowRef,
  onLaneDown, onEventDown, onDrop, onUpdateTrack, onDelete,
}) {
  const update = (changes, record = true) => onUpdateTrack(track.id, changes, record);
  return (
    <div className={`track-row ${track.type}`} ref={rowRef} style={{ height: TRACK_H[track.type], '--track-color': color }}>
      <div className="track-header">
        <div className="track-strip">{number}</div>
        <div className="track-main">
          <div className="track-top">
            <Icon name={track.type === 'video' ? 'film' : 'speaker'} size={13} />
            <TrackName name={track.name} onRename={(name) => update({ name })} />
            <button
              className={`track-btn mute${track.muted ? ' active' : ''}`}
              title={track.type === 'video' ? 'Ocultar pista' : 'Silenciar pista'}
              onClick={() => update({ muted: !track.muted })}
            >
              <Icon name="mute" size={12} />
            </button>
            <button
              className={`track-btn solo${track.solo ? ' active' : ''}`}
              title="Solo"
              onClick={() => update({ solo: !track.solo })}
            >
              <Icon name="solo" size={12} />
            </button>
            <button className="track-btn" title="Eliminar pista" onClick={() => onDelete(track.id)}>
              <Icon name="close" size={11} />
            </button>
          </div>
          {track.type === 'audio' && (
            <VolumeSlider value={track.volume ?? 0} onChange={(volume, record) => update({ volume }, record)} />
          )}
        </div>
      </div>
      <div
        className={`track-lane${inactive ? ' muted' : ''}`}
        style={{ width: laneWidth }}
        onPointerDown={onLaneDown}
        onDragOver={allowDrop}
        onDrop={(e) => onDrop(e, track.id)}
      >
        {events.map((ev) => (
          <EventView
            key={ev.id}
            ev={ev}
            media={mediaById.get(ev.mediaId)}
            type={track.type}
            selected={selectedSet.has(ev.id)}
            pps={pps}
            onDown={onEventDown}
          />
        ))}
      </div>
    </div>
  );
});

const Timeline = forwardRef(function Timeline({
  project, setProject, selection, setSelection, time, seek, playing,
  pps, setPps, snap, onDropFiles, footer,
}, ref) {
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const rowRefs = useRef(new Map());
  const rowRefCallbacks = useRef(new Map());
  const zoomAnchor = useRef(null);
  const prevPps = useRef(pps);
  const [view, setView] = useState({ left: 0, width: 1200 });
  const fps = project.settings.fps;

  // Valores actuales para manejadores estables (evita re-renderizar todas las pistas a cada fotograma).
  const live = useRef(null);
  live.current = { project, selection, time, pps, snap };

  const mediaById = useMemo(() => new Map(project.media.map((m) => [m.id, m])), [project.media]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const eventsByTrack = useMemo(() => {
    const map = new Map(project.tracks.map((t) => [t.id, []]));
    for (const e of project.events) map.get(e.trackId)?.push(e);
    // El que empieza más tarde se dibuja encima, igual que en la vista previa y el render.
    for (const list of map.values()) list.sort((a, b) => a.start - b.start);
    return map;
  }, [project.events, project.tracks]);
  const duration = useMemo(() => project.events.reduce((m, e) => Math.max(m, e.start + e.duration), 0), [project.events]);
  const laneWidth = Math.max(view.width - HEADER_W, (duration + 60) * pps);

  const zoomToFit = useCallback(() => {
    const d = live.current.project.events.reduce((m, e) => Math.max(m, e.start + e.duration), 0);
    if (d <= 0) return;
    zoomAnchor.current = { t: 0, offsetX: HEADER_W };
    setPps(clampPps((scrollRef.current.clientWidth - HEADER_W - 30) / d));
  }, [setPps]);
  useImperativeHandle(ref, () => ({ zoomToFit }), [zoomToFit]);

  const rowRefFor = (id) => {
    if (!rowRefCallbacks.current.has(id)) {
      rowRefCallbacks.current.set(id, (el) => (el ? rowRefs.current.set(id, el) : rowRefs.current.delete(id)));
    }
    return rowRefCallbacks.current.get(id);
  };

  const timeAt = useCallback((clientX) => {
    const rect = contentRef.current.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left - HEADER_W) / live.current.pps);
  }, []);

  const trackAt = useCallback((clientY) => {
    for (const t of live.current.project.tracks) {
      const el = rowRefs.current.get(t.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) return t;
    }
    return null;
  }, []);

  const snapPoints = useCallback((exclude = new Set()) => {
    const { project: p, time: t, snap: enabled } = live.current;
    if (!enabled) return [];
    return [0, t, ...p.events.filter((e) => !exclude.has(e.id)).flatMap((e) => [e.start, e.start + e.duration])];
  }, []);

  const startScrub = useCallback((e) => {
    if (e.button !== 0) return;
    seek(timeAt(e.clientX));
    const move = (me) => seek(timeAt(me.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [seek, timeAt]);

  const onLaneDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (!e.ctrlKey) setSelection([]);
    startScrub(e);
  }, [setSelection, startScrub]);

  const onEventDown = useCallback((e, ev, mode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const { project: p, selection: sel, pps: scale } = live.current;
    const group = ev.groupId ? p.events.filter((x) => x.groupId === ev.groupId).map((x) => x.id) : [ev.id];

    if (e.ctrlKey) {
      setSelection(sel.includes(ev.id) ? sel.filter((id) => !group.includes(id)) : [...new Set([...sel, ...group])]);
      return;
    }
    const alreadySelected = sel.includes(ev.id);
    const activeSelection = alreadySelected ? sel : group;
    if (!alreadySelected) setSelection(group);

    // Mover afecta a toda la selección; recortar solo al evento y a su grupo.
    const affected = new Set(mode === 'move' ? activeSelection : group);
    const origin = new Map(p.events.filter((x) => affected.has(x.id)).map((x) => [x.id, x]));
    const primary = origin.get(ev.id);
    const mediaOf = (o) => p.media.find((m) => m.id === o.mediaId);
    const trackType = new Map(p.tracks.map((t) => [t.id, t.type]));
    const primaryType = trackType.get(primary.trackId);
    const sameType = p.tracks.filter((t) => t.type === primaryType).map((t) => t.id);
    const points = snapPoints(new Set(origin.keys()));
    const threshold = 8 / scale;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    const onMove = (me) => {
      if (!moved && Math.abs(me.clientX - startX) < 3 && Math.abs(me.clientY - startY) < 3) return;
      const record = !moved;
      moved = true;
      let dt = (me.clientX - startX) / scale;
      let update;

      if (mode === 'move') {
        dt = snapDelta(dt, [primary.start, primary.start + primary.duration], points, threshold);
        const minStart = Math.min(...[...origin.values()].map((o) => o.start));
        if (minStart + dt < 0) dt = -minStart;
        let shift = 0;
        const hover = trackAt(me.clientY);
        if (hover && hover.type === primaryType) {
          shift = sameType.indexOf(hover.id) - sameType.indexOf(primary.trackId);
          for (const o of origin.values()) {
            if (trackType.get(o.trackId) !== primaryType) continue;
            const idx = sameType.indexOf(o.trackId) + shift;
            if (idx < 0 || idx >= sameType.length) {
              shift = 0;
              break;
            }
          }
        }
        update = (o) => ({
          start: o.start + dt,
          trackId: shift && trackType.get(o.trackId) === primaryType ? sameType[sameType.indexOf(o.trackId) + shift] : o.trackId,
        });
      } else if (mode === 'trimL') {
        dt = snapDelta(dt, [primary.start], points, threshold);
        for (const o of origin.values()) {
          if (!mediaOf(o)?.isImage) dt = Math.max(dt, -o.inPoint);
          dt = Math.max(dt, -o.start);
          dt = Math.min(dt, o.duration - MIN_EVENT);
        }
        update = (o) => ({
          start: o.start + dt,
          inPoint: mediaOf(o)?.isImage ? 0 : o.inPoint + dt,
          duration: o.duration - dt,
        });
      } else {
        dt = snapDelta(dt, [primary.start + primary.duration], points, threshold);
        for (const o of origin.values()) {
          const m = mediaOf(o);
          dt = Math.max(dt, MIN_EVENT - o.duration);
          if (m && !m.isImage && m.duration) dt = Math.min(dt, m.duration - o.inPoint - o.duration);
        }
        update = (o) => ({ duration: o.duration + dt });
      }

      setProject(
        (cur) => ({ ...cur, events: cur.events.map((x) => (origin.has(x.id) ? { ...x, ...update(origin.get(x.id)) } : x)) }),
        record,
      );
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved && alreadySelected) setSelection(group);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [setProject, setSelection, snapPoints, trackAt]);

  const onDrop = useCallback((e, target) => {
    e.preventDefault();
    let t = timeAt(e.clientX);
    const points = snapPoints();
    const threshold = 8 / live.current.pps;
    const near = points.find((p) => Math.abs(p - t) < threshold);
    if (near !== undefined) t = near;
    const mediaId = e.dataTransfer.getData(MEDIA_MIME);
    if (mediaId) {
      const media = live.current.project.media.find((m) => m.id === mediaId);
      if (media) setProject((p) => placeMedia(p, media, t, target));
    } else if (e.dataTransfer.files.length) {
      onDropFiles([...e.dataTransfer.files], t, target);
    }
  }, [onDropFiles, setProject, snapPoints, timeAt]);

  const onUpdateTrack = useCallback((trackId, changes, record) => {
    setProject((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, ...changes } : t)) }), record);
  }, [setProject]);

  const onDeleteTrack = useCallback((trackId) => {
    const hasEvents = live.current.project.events.some((e) => e.trackId === trackId);
    if (hasEvents && !window.confirm('La pista contiene eventos. ¿Eliminarla de todos modos?')) return;
    setProject((p) => deleteTrack(p, trackId));
  }, [setProject]);

  // Zoom con Ctrl + rueda, manteniendo fijo el punto bajo el puntero.
  useEffect(() => {
    const el = scrollRef.current;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const t = Math.max(0, (el.scrollLeft + offsetX - HEADER_W) / live.current.pps);
      zoomAnchor.current = { t, offsetX };
      setPps((v) => clampPps(v * (e.deltaY < 0 ? 1.25 : 0.8)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setPps]);

  // Tras cambiar el zoom, conserva la posición en pantalla del ancla (puntero o cursor de reproducción).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = zoomAnchor.current || {
      t: live.current.time,
      offsetX: HEADER_W + live.current.time * prevPps.current - el.scrollLeft,
    };
    zoomAnchor.current = null;
    prevPps.current = pps;
    el.scrollLeft = Math.max(0, HEADER_W + anchor.t * pps - anchor.offsetX);
  }, [pps]);

  useEffect(() => {
    const el = scrollRef.current;
    const update = () => setView({ left: el.scrollLeft, width: el.clientWidth });
    update();
    el.addEventListener('scroll', update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  // Durante la reproducción, la vista sigue al cursor.
  useEffect(() => {
    if (!playing) return;
    const el = scrollRef.current;
    const x = HEADER_W + time * pps;
    if (x > el.scrollLeft + el.clientWidth - 30 || x < el.scrollLeft + HEADER_W) {
      el.scrollLeft = Math.max(0, x - HEADER_W - 20);
    }
  }, [time, playing, pps]);

  let videoCount = 0;
  let audioCount = 0;

  return (
    <div className="timeline">
      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-content" ref={contentRef} style={{ width: HEADER_W + laneWidth }}>
          <div className="ruler-row">
            <div className="ruler-corner">
              <div className="big-timecode">{formatTimecode(time, fps)}</div>
            </div>
            <Ruler
              pps={pps}
              time={time}
              scrollLeft={view.left}
              viewWidth={view.width}
              laneWidth={laneWidth}
              onPointerDown={startScrub}
            />
          </div>
          {project.tracks.map((track, index) => (
            <TrackRow
              key={track.id}
              track={track}
              number={track.type === 'video' ? ++videoCount : ++audioCount}
              color={trackColor(index)}
              inactive={!isTrackActive(track, project.tracks)}
              events={eventsByTrack.get(track.id)}
              mediaById={mediaById}
              selectedSet={selectedSet}
              pps={pps}
              laneWidth={laneWidth}
              rowRef={rowRefFor(track.id)}
              onLaneDown={onLaneDown}
              onEventDown={onEventDown}
              onDrop={onDrop}
              onUpdateTrack={onUpdateTrack}
              onDelete={onDeleteTrack}
            />
          ))}
          <div className="track-row empty" onDragOver={allowDrop} onDrop={(e) => onDrop(e, 'new')}>
            <div className="track-header">Suelta aquí para crear pistas nuevas</div>
            <div className="track-lane" style={{ width: laneWidth }} onPointerDown={onLaneDown} />
          </div>
          <div className="cursor-line" style={{ left: HEADER_W + time * pps }} />
        </div>
      </div>
      <div className="timeline-footer">
        {footer}
        <span className="footer-spacer" />
        <span className="footer-info">
          Duración: <strong>{formatTimecode(duration, fps)}</strong>
        </span>
        <div className="zoom-buttons">
          <button className="transport-btn" title="Alejar (↓)" onClick={() => setPps((v) => clampPps(v * 0.8))}>
            <Icon name="zoomOut" size={14} />
          </button>
          <button className="transport-btn" title="Acercar (↑)" onClick={() => setPps((v) => clampPps(v * 1.25))}>
            <Icon name="zoomIn" size={14} />
          </button>
          <button className="transport-btn" title="Ajustar el proyecto a la ventana" onClick={zoomToFit}>
            <Icon name="fit" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
});

export default Timeline;
