import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Waveform from './Waveform.jsx';
import Icon from './Icon.jsx';
import { formatRuler, formatTimecode, quantize } from '../util/time.js';
import {
  EVENT_DEFAULTS, MAX_RATE, MAX_TRACK_VOLUME_DB, MIN_EVENT, MIN_RATE, MIN_VOLUME_DB, deleteTrack, eventFades, formatRate, formatVolume, gainToVolume, isTrackActive,
  overlapAt, placeMedia, resolveTimeline, setTransitionAt, trackColor, volumeToGain,
} from '../state/project.js';
import { TRANSITION_MIME, transitionLabel } from '../state/transitions.js';
import { isText } from '../state/text.js';
import { EFFECTS, EFFECT_MIME, newEffect } from '../state/effects.js';

export const MEDIA_MIME = 'application/x-cortex-media';
const HEADER_W = 230;
const TRACK_H = { video: 64, audio: 72 };
const TITLE_H = 16;
const bodyHeight = (type) => TRACK_H[type] - TITLE_H - 6;
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

const majorStep = (pps) => TICK_STEPS.find((s) => s * pps >= 90) ?? 3600;
// Separación de las marcas pequeñas de la regla (la "rejilla"): Re Pág / Av Pág mueven el cursor esto.
export const gridStep = (pps) => majorStep(pps) / 5;

// Selección de tiempo en la barra de arriba de la regla, como la región de bucle de VEGAS: la línea azul
// (con su duración) se arrastra para moverla y los triángulos amarillos, para cambiar sus extremos.
function RegionBar({ region, pps, fps, onDown }) {
  if (!region) return null;
  const left = region.start * pps;
  const width = Math.max(1, (region.end - region.start) * pps);
  return (
    <>
      <div className="region-line" style={{ left, width }} onPointerDown={(e) => onDown(e, 'move')} title="Arrastra para mover la selección">
        <span className="region-length">+{formatTimecode(region.end - region.start, fps)}</span>
      </div>
      <div className="region-handle" style={{ left }} onPointerDown={(e) => onDown(e, 'start')} title="Principio de la selección" />
      <div className="region-handle" style={{ left: left + width }} onPointerDown={(e) => onDown(e, 'end')} title="Final de la selección" />
    </>
  );
}

const Ruler = memo(function Ruler({ pps, fps, time, scrollLeft, viewWidth, laneWidth, region, onPointerDown, onRegionDown }) {
  const step = majorStep(pps);
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
      {region && <div className="region-shade" style={{ left: region.start * pps, width: (region.end - region.start) * pps }} />}
      <div
        className="marker-bar"
        title="Arrastra para seleccionar un tramo de tiempo (clic: quitar la selección)"
        onPointerDown={(e) => onRegionDown(e, 'new')}
      >
        <RegionBar region={region} pps={pps} fps={fps} onDown={onRegionDown} />
      </div>
      {ticks}
      <div className="cursor-head" style={{ left: time * pps }} title="Arrastra para ajustar el cursor (Mayús: sin ajuste)" />
    </div>
  );
});

// Envolvente del evento: fundidos en las esquinas y, en audio, la línea de ganancia. Lo que queda por encima se oscurece.
function Envelope({ width, height, gainY, fadeIn, fadeOut }) {
  const a = fadeIn;
  const b = width - fadeOut;
  const line = `0,${height} ${a},${gainY} ${b},${gainY} ${width},${height}`;
  return (
    <svg className="envelope" width={width} height={height}>
      <polygon points={`0,0 ${line} ${width},0`} />
      <polyline points={line} />
    </svg>
  );
}

const HANDLE_TITLE = 'Arrastra para recortar (Ctrl: cambiar la velocidad, como en VEGAS)';

// Zona de solapamiento al principio del evento que entra: aspa de la transición y su nombre.
function TransitionZone({ width, height, label, onReset }) {
  return (
    <div
      className="transition-zone"
      style={{ top: TITLE_H, width, height }}
      title={onReset ? `${label} (doble clic: volver a disolución cruzada)` : label}
      onDoubleClick={onReset}
    >
      <svg width={width} height={height}>
        <line x1={0} y1={0} x2={width} y2={height} />
        <line x1={0} y1={height} x2={width} y2={0} />
      </svg>
      {width > 40 && <span>{label}</span>}
    </div>
  );
}

// fadeIn/fadeOut: fundidos efectivos (en audio incluyen los fundidos cruzados de los solapamientos).
// overlapIn/overlapOut: segundos solapados con el evento anterior/siguiente de la pista.
const EventView = memo(function EventView({
  ev, media, type, selected, pps, fadeIn, fadeOut, overlapIn, overlapOut, transition, onDown, onReset, onMenu, onFx, onText, onDouble,
}) {
  const width = Math.max(3, ev.duration * pps);
  const height = bodyHeight(type);
  const volume = ev.volume ?? 0;
  const gain = type === 'audio' ? volumeToGain(volume) : 1;
  const gainY = (1 - gain) * height;
  const showEnvelope = fadeIn > 0 || fadeOut > 0 || gain < 1;
  const bodyStyle = type === 'video' && media?.thumb ? { backgroundImage: `url(${media.thumb})` } : undefined;
  const name = media ? media.name : '?';
  const rate = ev.rate || 1;
  const fadeHandleX = (x) => Math.min(width - 8, Math.max(0, x - 4));
  return (
    <div
      className={`event ${type}${selected ? ' selected' : ''}${media?.missing ? ' missing' : ''}${rate !== 1 ? ' stretched' : ''}`}
      style={{ left: ev.start * pps, width }}
      onPointerDown={(e) => onDown(e, ev, 'move')}
      onContextMenu={(e) => onMenu(e, ev)}
      onDoubleClick={(e) => !e.target.closest('.fade-handle, .gain-handle, .transition-zone, button') && onDouble(ev)}
      data-event={ev.id}
      title={media?.missing ? `Archivo no encontrado: ${media.path}` : media?.name}
    >
      <div className="event-title">
        {name}
        {rate !== 1 && <span className="event-rate"> · {formatRate(rate)}</span>}
        {type === 'audio' && volume !== 0 && <span className="event-gain"> · {formatVolume(volume)}</span>}
      </div>
      {isText(media) && width > 70 && (
        <button
          className="event-fx event-text"
          title="Editar el texto"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onText(ev.id)}
        >
          T
        </button>
      )}
      {width > 46 && (
        <button
          className={`event-fx${ev.effects?.length ? ' active' : ''}`}
          title={
            ev.effects?.length
              ? `Efectos del evento: ${ev.effects.map((fx) => EFFECTS.get(fx.type)?.name ?? fx.type).join(', ')}`
              : 'Efectos del evento'
          }
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onFx(ev.id)}
        >
          fx
        </button>
      )}
      <div className="event-body" style={bodyStyle}>
        {type === 'audio' && media?.peaks && (
          <Waveform
            peaks={media.peaks}
            peaksPerSecond={media.peaksPerSecond}
            inPoint={ev.inPoint}
            duration={ev.duration}
            rate={rate}
            width={width}
            height={height}
            gain={gain}
            fadeIn={fadeIn}
            fadeOut={fadeOut}
          />
        )}
        {showEnvelope && <Envelope width={width} height={height} gainY={gainY} fadeIn={fadeIn * pps} fadeOut={fadeOut * pps} />}
      </div>
      {overlapIn > 0 && (
        <TransitionZone
          width={Math.min(width, overlapIn * pps)}
          height={height}
          label={type === 'video' ? transitionLabel(transition) : 'Fundido cruzado'}
          onReset={type === 'video' && transition ? () => onReset(ev, 'transition') : undefined}
        />
      )}
      <div className="handle left" title={HANDLE_TITLE} onPointerDown={(e) => onDown(e, ev, 'trimL')} />
      <div className="handle right" title={HANDLE_TITLE} onPointerDown={(e) => onDown(e, ev, 'trimR')} />
      {type === 'audio' && (
        <div
          className="gain-handle"
          style={{ top: TITLE_H + gainY - 3 }}
          title={`Volumen del evento: ${formatVolume(volume)} (doble clic: 0 dB)`}
          onPointerDown={(e) => onDown(e, ev, 'gain')}
          onDoubleClick={() => onReset(ev, 'gain')}
        />
      )}
      {!overlapIn && (
        <div
          className={`fade-handle${fadeIn > 0 ? ' active' : ''}`}
          style={{ left: fadeHandleX(fadeIn * pps) }}
          title="Fundido de entrada (doble clic: quitar)"
          onPointerDown={(e) => onDown(e, ev, 'fadeIn')}
          onDoubleClick={() => onReset(ev, 'fadeIn')}
        />
      )}
      {!overlapOut && (
        <div
          className={`fade-handle${fadeOut > 0 ? ' active' : ''}`}
          style={{ left: fadeHandleX(width - fadeOut * pps) }}
          title="Fundido de salida (doble clic: quitar)"
          onPointerDown={(e) => onDown(e, ev, 'fadeOut')}
          onDoubleClick={() => onReset(ev, 'fadeOut')}
        />
      )}
    </div>
  );
});

// Fondo azul de la selección de tiempo en las pistas (debajo de los eventos, como en VEGAS).
function RegionShade({ region, pps }) {
  if (!region) return null;
  return <div className="region-shade" style={{ left: region.start * pps, width: (region.end - region.start) * pps }} />;
}

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
  const label = formatVolume(value);
  return (
    <div className="track-slider" title="Volumen de la pista (doble clic: 0 dB)">
      <span className="slider-label">Vol:</span>
      <input
        type="range"
        min={MIN_VOLUME_DB}
        max={MAX_TRACK_VOLUME_DB}
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
  track, number, color, inactive, events, resolved, mediaById, selectedSet, pps, laneWidth, rowRef, region,
  onLaneDown, onEventDown, onEventReset, onEventMenu, onLaneMenu, onOpenFx, onEditText, onEventDouble, onDrop, onUpdateTrack, onDelete,
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
        onContextMenu={(e) => onLaneMenu(e, track.id)}
        onDragOver={allowDrop}
        onDrop={(e) => onDrop(e, track.id)}
      >
        <RegionShade region={region} pps={pps} />
        {events.map((ev) => {
          const fades = resolved.fades.get(ev.id);
          const inc = resolved.incoming.get(ev.id);
          return (
            <EventView
              key={ev.id}
              ev={ev}
              media={mediaById.get(ev.mediaId)}
              type={track.type}
              selected={selectedSet.has(ev.id)}
              pps={pps}
              fadeIn={fades.fadeIn}
              fadeOut={fades.fadeOut}
              overlapIn={inc ? inc.duration : 0}
              overlapOut={resolved.outgoing.get(ev.id)?.duration ?? 0}
              transition={inc ? ev.transition : null}
              onDown={onEventDown}
              onReset={onEventReset}
              onMenu={onEventMenu}
              onFx={onOpenFx}
              onText={onEditText}
              onDouble={onEventDouble}
            />
          );
        })}
      </div>
    </div>
  );
});

const Timeline = forwardRef(function Timeline({
  project, setProject, selection, setSelection, time, seek, playing, region, setRegion,
  pps, setPps, snap, onDropFiles, onMessage, onContextMenu, onOpenFx, onEditText, footer,
}, ref) {
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const rowRefs = useRef(new Map());
  const rowRefCallbacks = useRef(new Map());
  const zoomAnchor = useRef(null);
  const prevPps = useRef(pps);
  const [view, setView] = useState({ left: 0, width: 1200 });
  const [marquee, setMarquee] = useState(null); // rectángulo de selección { left, right, top, bottom } en px del contenido
  const fps = project.settings.fps;

  // Valores actuales para manejadores estables (evita re-renderizar todas las pistas a cada fotograma).
  const live = useRef(null);
  live.current = { project, selection, time, pps, snap, playing, region };

  const mediaById = useMemo(() => new Map(project.media.map((m) => [m.id, m])), [project.media]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const eventsByTrack = useMemo(() => {
    const map = new Map(project.tracks.map((t) => [t.id, []]));
    for (const e of project.events) map.get(e.trackId)?.push(e);
    // El que empieza más tarde se dibuja encima, igual que en la vista previa y el render.
    for (const list of map.values()) list.sort((a, b) => a.start - b.start);
    return map;
  }, [project.events, project.tracks]);
  const resolved = useMemo(() => resolveTimeline(project), [project.events, project.tracks]);
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

  // Dónde queda el cursor al colocarlo con el ratón, como en VEGAS: con el ajuste activado se pega al
  // principio o al final de los eventos cercanos (8 px); si no, cae en el fotograma más próximo.
  // free (Mayús pulsada) desactiva el ajuste en ese momento. offset desplaza respecto al puntero.
  const snapTime = useCallback((time, free = false) => {
    const { project: p, snap: enabled, pps: scale } = live.current;
    const t = Math.max(0, time);
    if (enabled && !free) {
      let best = null;
      for (const x of [0, ...p.events.flatMap((e) => [e.start, e.start + e.duration])]) {
        if (Math.abs(x - t) < 8 / scale && (best === null || Math.abs(x - t) < Math.abs(best - t))) best = x;
      }
      if (best !== null) return best;
    }
    return quantize(t, p.settings.fps);
  }, []);
  const cursorTime = useCallback((clientX, free = false, offset = 0) => snapTime(timeAt(clientX) + offset, free), [snapTime, timeAt]);

  // Selección de tiempo (barra de arriba de la regla). part: 'new' (arrastrar en la barra vacía),
  // 'move' (la línea azul), 'start' o 'end' (los triángulos). Se ajusta igual que el cursor (Mayús: sin ajuste).
  const onRegionDown = useCallback((e, part) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const orig = live.current.region;
    const startX = e.clientX;
    const anchor = cursorTime(e.clientX, e.shiftKey);
    const frame = 1 / live.current.project.settings.fps;
    let moved = false;
    const move = (me) => {
      if (!moved && Math.abs(me.clientX - startX) < 3) return;
      moved = true;
      const t = cursorTime(me.clientX, me.shiftKey);
      if (part === 'new') {
        setRegion(t === anchor ? null : { start: Math.min(anchor, t), end: Math.max(anchor, t) });
      } else if (part === 'move') {
        // Se mueve entera; se ajusta el extremo que quede más cerca de un punto de ajuste.
        const len = orig.end - orig.start;
        const raw = Math.max(0, orig.start + timeAt(me.clientX) - timeAt(startX));
        const a = snapTime(raw, me.shiftKey);
        const b = snapTime(raw + len, me.shiftKey) - len;
        const start = Math.max(0, Math.abs(b - raw) < Math.abs(a - raw) ? b : a);
        setRegion({ start, end: start + len });
      } else {
        const other = part === 'start' ? orig.end : orig.start;
        const a = Math.min(t, other);
        const b = Math.max(t, other);
        setRegion({ start: a, end: Math.max(b, a + frame) });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved && part === 'new') setRegion(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [cursorTime, setRegion, snapTime, timeAt]);

  // Doble clic en un evento: la selección de tiempo pasa a ser el tramo del evento (como en VEGAS).
  const onEventDouble = useCallback((ev) => setRegion({ start: ev.start, end: ev.start + ev.duration }), [setRegion]);

  // Arrastrar el cursor. Desde el triángulo de arriba (keepOffset) no salta a la posición del puntero:
  // se desplaza lo que se mueva el ratón, para hacer ajustes pequeños.
  const startScrub = useCallback((e, keepOffset = false) => {
    if (e.button !== 0) return;
    const offset = keepOffset ? live.current.time - timeAt(e.clientX) : 0;
    if (!keepOffset) seek(cursorTime(e.clientX, e.shiftKey, offset)); // agarrar el triángulo no lo mueve
    const move = (me) => seek(cursorTime(me.clientX, me.shiftKey, offset));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [cursorTime, seek, timeAt]);

  const onRulerDown = useCallback((e) => startScrub(e, e.target.classList.contains('cursor-head')), [startScrub]);

  // Zona vacía de una pista: un clic coloca el cursor (y quita la selección, salvo con Ctrl); arrastrar
  // dibuja un rectángulo que selecciona los eventos que toca (con Ctrl se añaden a los ya seleccionados).
  // Se selecciona siempre el grupo entero, para que el audio no se separe de su video al moverlos.
  const onLaneDown = useCallback((e) => {
    if (e.button !== 0) return;
    const at = (ev) => {
      const r = contentRef.current.getBoundingClientRect();
      return { x: Math.max(HEADER_W, ev.clientX - r.left), y: ev.clientY - r.top };
    };
    const start = at(e);
    const base = e.ctrlKey ? live.current.selection : [];
    let dragging = false;

    const move = (me) => {
      const cur = at(me);
      if (!dragging && Math.abs(cur.x - start.x) < 4 && Math.abs(cur.y - start.y) < 4) return;
      dragging = true;
      const box = {
        left: Math.min(start.x, cur.x),
        right: Math.max(start.x, cur.x),
        top: Math.min(start.y, cur.y),
        bottom: Math.max(start.y, cur.y),
      };
      setMarquee(box);
      const { project: p, pps: scale } = live.current;
      const t1 = (box.left - HEADER_W) / scale;
      const t2 = (box.right - HEADER_W) / scale;
      const contentTop = contentRef.current.getBoundingClientRect().top;
      const tracks = new Set(
        p.tracks
          .filter((t) => {
            const row = rowRefs.current.get(t.id)?.getBoundingClientRect();
            return row && row.bottom - contentTop > box.top && row.top - contentTop < box.bottom;
          })
          .map((t) => t.id),
      );
      const hits = p.events.filter((ev) => tracks.has(ev.trackId) && ev.start < t2 && ev.start + ev.duration > t1);
      const groups = new Set(hits.map((ev) => ev.groupId).filter(Boolean));
      const ids = p.events.filter((ev) => hits.includes(ev) || groups.has(ev.groupId)).map((ev) => ev.id);
      setSelection([...new Set([...base, ...ids])]);
    };
    const up = (ue) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMarquee(null);
      if (dragging) return;
      if (!e.ctrlKey) setSelection([]);
      seek(cursorTime(e.clientX, ue.shiftKey));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [cursorTime, seek, setSelection]);

  const onEventDown = useCallback((e, ev, mode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const { project: p, selection: sel, pps: scale } = live.current;
    const group = ev.groupId ? p.events.filter((x) => x.groupId === ev.groupId).map((x) => x.id) : [ev.id];

    const stretch = e.ctrlKey && (mode === 'trimL' || mode === 'trimR');
    if (e.ctrlKey && !stretch) {
      setSelection(sel.includes(ev.id) ? sel.filter((id) => !group.includes(id)) : [...new Set([...sel, ...group])]);
      return;
    }
    const alreadySelected = sel.includes(ev.id);
    const activeSelection = alreadySelected ? sel : group;
    if (!alreadySelected) setSelection(group);

    // Mover afecta a toda la selección; recortar y fundir, al evento y a su grupo; el volumen, solo al evento.
    const affected = new Set(mode === 'move' ? activeSelection : mode === 'gain' ? [ev.id] : group);
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
        dt = snapDelta(dt, [primary.start, primary.start + primary.duration], me.shiftKey ? [] : points, threshold);
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
      } else if (stretch) {
        // Ctrl + borde: el evento se estira o se encoge sin cambiar el trozo de medio que usa, así que
        // cambia la velocidad (más largo = más lento). Las imágenes solo cambian de duración.
        const left = mode === 'trimL';
        dt = snapDelta(dt, [left ? primary.start : primary.start + primary.duration], me.shiftKey ? [] : points, threshold);
        const sign = left ? -1 : 1; // cuánto crece la duración por cada segundo que se mueve el borde
        for (const o of origin.values()) {
          let lo = MIN_EVENT - o.duration;
          let hi = Infinity;
          if (!mediaOf(o)?.isImage) {
            const length = o.duration * (o.rate || 1); // segundos de medio que usa el evento
            lo = Math.max(lo, length / MAX_RATE - o.duration);
            hi = length / MIN_RATE - o.duration;
          }
          if (left) hi = Math.min(hi, o.start);
          dt = sign * Math.min(hi, Math.max(lo, sign * dt));
        }
        update = (o) => {
          const duration = o.duration + sign * dt;
          const rate = mediaOf(o)?.isImage ? 1 : (o.duration * (o.rate || 1)) / duration;
          return { start: left ? o.start + dt : o.start, duration, rate };
        };
      } else if (mode === 'trimL') {
        dt = snapDelta(dt, [primary.start], me.shiftKey ? [] : points, threshold);
        for (const o of origin.values()) {
          if (!mediaOf(o)?.isImage) dt = Math.max(dt, -o.inPoint / (o.rate || 1));
          dt = Math.max(dt, -o.start);
          dt = Math.min(dt, o.duration - MIN_EVENT);
        }
        update = (o) => ({
          start: o.start + dt,
          inPoint: mediaOf(o)?.isImage ? 0 : o.inPoint + dt * (o.rate || 1),
          duration: o.duration - dt,
        });
      } else if (mode === 'fadeIn' || mode === 'fadeOut') {
        update = (o) => {
          const fades = eventFades(o);
          return mode === 'fadeIn'
            ? { fadeIn: Math.min(o.duration - fades.fadeOut, Math.max(0, fades.fadeIn + dt)) }
            : { fadeOut: Math.min(o.duration - fades.fadeIn, Math.max(0, fades.fadeOut - dt)) };
        };
      } else if (mode === 'gain') {
        const dy = (me.clientY - startY) / bodyHeight(primaryType);
        update = (o) => ({ volume: gainToVolume(Math.min(1, Math.max(0, volumeToGain(o.volume ?? 0) - dy))) });
      } else {
        dt = snapDelta(dt, [primary.start + primary.duration], me.shiftKey ? [] : points, threshold);
        for (const o of origin.values()) {
          const m = mediaOf(o);
          dt = Math.max(dt, MIN_EVENT - o.duration);
          if (m && !m.isImage && m.duration) dt = Math.min(dt, (m.duration - o.inPoint) / (o.rate || 1) - o.duration);
        }
        update = (o) => ({ duration: o.duration + dt });
      }

      setProject(
        (cur) => ({ ...cur, events: cur.events.map((x) => (origin.has(x.id) ? { ...x, ...update(origin.get(x.id)) } : x)) }),
        record,
      );
    };
    const onUp = (ue) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) return;
      if (alreadySelected) setSelection(group);
      // Un clic (sin arrastrar) en el cuerpo del evento también coloca el cursor ahí, como en VEGAS.
      if (mode === 'move') seek(cursorTime(startX, ue.shiftKey));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [cursorTime, seek, setProject, setSelection, snapPoints, trackAt]);

  // Clic derecho en un evento: si no estaba seleccionado, se selecciona (con su grupo) y se abre su menú.
  const onEventMenu = useCallback((e, ev) => {
    e.preventDefault();
    e.stopPropagation();
    const { project: p, selection: sel } = live.current;
    let selected = sel;
    if (!sel.includes(ev.id)) {
      selected = ev.groupId ? p.events.filter((x) => x.groupId === ev.groupId).map((x) => x.id) : [ev.id];
      setSelection(selected);
    }
    onContextMenu({ kind: 'event', x: e.clientX, y: e.clientY, event: ev, selection: selected, time: timeAt(e.clientX) });
  }, [onContextMenu, setSelection, timeAt]);

  // Clic derecho en una zona vacía de una pista.
  const onLaneMenu = useCallback((e, trackId) => {
    e.preventDefault();
    onContextMenu({ kind: 'track', x: e.clientX, y: e.clientY, trackId, time: timeAt(e.clientX) });
  }, [onContextMenu, timeAt]);

  // Doble clic en un tirador: quita el fundido (en todo el grupo) o devuelve el volumen a 0 dB.
  const onEventReset = useCallback((ev, mode) => {
    const field = mode === 'gain' ? 'volume' : mode;
    const onlyEvent = mode === 'gain' || mode === 'transition';
    const isTarget = (x) => x.id === ev.id || (!onlyEvent && ev.groupId && x.groupId === ev.groupId);
    setProject((p) => {
      if (!p.events.some((x) => isTarget(x) && x[field] !== EVENT_DEFAULTS[field])) return p;
      return { ...p, events: p.events.map((x) => (isTarget(x) ? { ...x, [field]: EVENT_DEFAULTS[field] } : x)) };
    });
  }, [setProject]);

  const onDrop = useCallback((e, target) => {
    e.preventDefault();
    // Efecto soltado sobre un evento de su tipo (video o audio): se añade al final de su cadena y se abre su ventana de efectos.
    const effect = e.dataTransfer.getData(EFFECT_MIME);
    if (effect) {
      const id = e.target.closest?.('[data-event]')?.dataset.event;
      const { project: p } = live.current;
      const ev = p.events.find((x) => x.id === id);
      const type = ev && p.tracks.find((tr) => tr.id === ev.trackId)?.type;
      const kind = EFFECTS.get(effect)?.kind;
      if (type !== kind) {
        onMessage(`Suelta el efecto encima de un evento de una pista de ${kind === 'audio' ? 'audio' : 'video'}.`);
        return;
      }
      setProject((cur) => ({
        ...cur,
        events: cur.events.map((x) => (x.id === id ? { ...x, effects: [...(x.effects || []), newEffect(effect)] } : x)),
      }));
      onMessage('');
      onOpenFx(id);
      return;
    }
    const transition = e.dataTransfer.getData(TRANSITION_MIME);
    if (transition) {
      const { project: p } = live.current;
      const at = timeAt(e.clientX);
      const track = p.tracks.find((tr) => tr.id === target);
      if (!track || track.type !== 'video') {
        onMessage('Las transiciones se colocan en pistas de video. En audio, los solapamientos ya son fundidos cruzados.');
      } else if (!overlapAt(p, target, at)) {
        onMessage('Para crear una transición, solapa el final de un evento con el principio de otro en la misma pista y suéltala sobre el solapamiento.');
      } else {
        setProject((cur) => setTransitionAt(cur, target, at, transition));
        onMessage('');
      }
      return;
    }
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
  }, [onDropFiles, onMessage, onOpenFx, setProject, snapPoints, timeAt]);

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

  // En pausa, si el cursor sale de la vista (con las flechas o arrastrándolo fuera), la vista se
  // desplaza lo justo para enseñarlo. Solo al cambiar el tiempo: al hacer zoom manda el ancla del zoom.
  useEffect(() => {
    if (live.current.playing) return;
    const el = scrollRef.current;
    const x = HEADER_W + time * live.current.pps;
    if (x > el.scrollLeft + el.clientWidth - 20) el.scrollLeft = x - el.clientWidth + 60;
    else if (x < el.scrollLeft + HEADER_W) el.scrollLeft = Math.max(0, x - HEADER_W - 40);
  }, [time]);

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
              fps={fps}
              region={region}
              onRegionDown={onRegionDown}
              time={time}
              scrollLeft={view.left}
              viewWidth={view.width}
              laneWidth={laneWidth}
              onPointerDown={onRulerDown}
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
              resolved={resolved}
              mediaById={mediaById}
              selectedSet={selectedSet}
              pps={pps}
              laneWidth={laneWidth}
              rowRef={rowRefFor(track.id)}
              region={region}
              onLaneDown={onLaneDown}
              onEventDown={onEventDown}
              onEventReset={onEventReset}
              onEventMenu={onEventMenu}
              onLaneMenu={onLaneMenu}
              onOpenFx={onOpenFx}
              onEditText={onEditText}
              onEventDouble={onEventDouble}
              onDrop={onDrop}
              onUpdateTrack={onUpdateTrack}
              onDelete={onDeleteTrack}
            />
          ))}
          <div className="track-row empty" onDragOver={allowDrop} onDrop={(e) => onDrop(e, 'new')}>
            <div className="track-header">Suelta aquí para crear pistas nuevas</div>
            <div className="track-lane" style={{ width: laneWidth }} onPointerDown={onLaneDown}>
              <RegionShade region={region} pps={pps} />
            </div>
          </div>
          <div className="cursor-line" style={{ left: HEADER_W + time * pps }} />
          {marquee && (
            <div
              className="marquee"
              style={{
                left: marquee.left,
                top: marquee.top,
                width: marquee.right - marquee.left,
                height: marquee.bottom - marquee.top,
              }}
            />
          )}
        </div>
      </div>
      <div className="timeline-footer">
        {footer}
        <span className="footer-spacer" />
        {region && (
          <span className="footer-info">
            Selección: <strong>{formatTimecode(region.start, fps)}</strong> – <strong>{formatTimecode(region.end, fps)}</strong>
            {' '}({formatTimecode(region.end - region.start, fps)})
          </span>
        )}
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
