import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import TextOverlay from './TextOverlay.jsx';
import PanOverlay from './PanOverlay.jsx';
import { mediaUrl, frameNumber, formatTimecode } from '../util/time.js';
import {
  eventPeak, fadeFactor, fitSize, formatFps, isTrackActive, resolveTimeline, sourceTime, volumeToGain,
} from '../state/project.js';
import { transitionInfo } from '../state/transitions.js';
import { EFFECTS, activeEffects } from '../state/effects.js';
import { Compositor } from '../preview/compositor.js';
import { drawText, isText } from '../state/text.js';
import { NO_CROP, panActive, panAt } from '../state/pan.js';
import { AudioEngine, renderOfflineAudio } from '../preview/audio-engine.js';

// Para las pruebas automáticas: procesar un sonido con la misma cadena de efectos que la vista previa.
window.cortexPruebas = { renderOfflineAudio, activeEffects };

const DRIFT = 0.3;
const PRELOAD = 2; // segundos antes de que empiece un evento se prepara su <video>
const KEEP = 1; // y después de que termine se conserva

// Panorámica del evento en el instante t de la línea de tiempo (para el compositor), o null si no cambia nada.
export function panLayer(e, t) {
  if (!panActive(e.pan)) return null;
  return { ...panAt(e.pan, t - e.start), crop: e.pan.crop || NO_CROP };
}

// Capas de video en t, de abajo a arriba. En cada pista activa: la transición en curso o,
// si no hay, el evento que empieza más tarde con la opacidad de sus fundidos.
function videoLayers(project, mediaById, resolved, eventsById, t) {
  const usable = (e) => {
    const m = e && mediaById.get(e.mediaId);
    return m && !m.missing ? m : null;
  };
  const layers = [];
  const tracks = project.tracks.filter((tr) => tr.type === 'video' && isTrackActive(tr, project.tracks)).reverse();
  for (const track of tracks) {
    const tr = resolved.transitions.find((x) => x.trackId === track.id && x.start <= t && t < x.start + x.duration);
    if (tr) {
      const from = eventsById.get(tr.from);
      const to = eventsById.get(tr.to);
      if (usable(from) && usable(to)) {
        layers.push({ from, to, type: transitionInfo(tr.type).index, progress: 1 - (t - tr.start) / tr.duration });
        continue;
      }
    }
    let best = null;
    for (const e of project.events) {
      if (e.trackId === track.id && e.start <= t && t < e.start + e.duration && (!best || e.start >= best.start)) best = e;
    }
    if (!usable(best)) continue;
    const opacity = fadeFactor(best, t, resolved.fades.get(best.id));
    if (opacity > 0) layers.push({ event: best, opacity });
  }
  return layers;
}

function audibleEvents(project, mediaById, resolved, t) {
  const gains = new Map(
    project.tracks
      .filter((tr) => tr.type === 'audio' && isTrackActive(tr, project.tracks))
      .map((tr) => [tr.id, volumeToGain(tr.volume ?? 0)]),
  );
  return project.events
    .filter((e) => {
      const m = mediaById.get(e.mediaId);
      return gains.get(e.trackId) > 0 && m && m.hasAudio && !m.missing && e.start <= t && t < e.start + e.duration;
    })
    .map((e) => ({
      event: e,
      gain: gains.get(e.trackId) * volumeToGain(e.volume ?? 0) * fadeFactor(e, t, resolved.fades.get(e.id)),
    }));
}

// Reproductor que usa cada evento. Los eventos seguidos de una pista que continúan el mismo archivo
// (por ejemplo, las dos partes de un evento dividido con S) comparten reproductor: al pasar de uno
// a otro el video sigue reproduciéndose sin buscar ni arrancar de nuevo, y el corte no se nota.
function playerKeys(events) {
  const keys = new Map();
  const byTrack = new Map();
  for (const e of events) {
    if (!byTrack.has(e.trackId)) byTrack.set(e.trackId, []);
    byTrack.get(e.trackId).push(e);
  }
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.start - b.start);
    list.forEach((e, i) => {
      const prev = list[i - 1];
      const continues =
        prev &&
        prev.mediaId === e.mediaId &&
        (prev.rate || 1) === (e.rate || 1) &&
        Math.abs(prev.start + prev.duration - e.start) < 0.002 &&
        Math.abs(sourceTime(prev, prev.start + prev.duration) - e.inPoint) < 0.002;
      keys.set(e.id, continues ? keys.get(prev.id) : e.id);
    });
  }
  return keys;
}

// Prepara un reproductor que aún no suena: en pausa y, si el evento está por llegar, en su primer fotograma.
function prepare(el, e, time) {
  if (!el.paused) el.pause();
  if (!el.seeking && time < e.start && Math.abs(el.currentTime - e.inPoint) > 0.05) el.currentTime = e.inPoint;
}

// target: instante del medio; rate: velocidad del evento (el navegador conserva el tono, igual que atempo).
function sync(el, target, playing, rate = 1) {
  if (el.playbackRate !== rate) el.playbackRate = rate;
  if (playing) {
    if (!el.seeking && Math.abs(el.currentTime - target) > DRIFT) el.currentTime = target;
    if (el.paused) el.play().catch(() => {});
  } else {
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
  }
}

// selection, editTextId, onSelectEvent, onTextChange, onEditText: para colocar los textos con el ratón (TextOverlay).
// panEventId, onPanChange: evento con la ventana de panorámica abierta, que se coloca con el ratón (PanOverlay).
export default function Preview({
  project, time, playing, selection, editTextId, onSelectEvent, onTextChange, onEditText, panEventId, onPanChange,
  onOpenProperties,
}) {
  const canvasRef = useRef(null);
  const sourcesRef = useRef(null);
  const videoEls = useRef(new Map()); // reproductor (ver playerKeys) → <video> (silenciado: el sonido sale de las pistas de audio)
  const imageEls = useRef(new Map()); // id de medio → <img>
  const textEls = useRef(new Map()); // id de medio de texto → <canvas> (se redibuja si cambia el texto)
  const audio = useRef(null); // AudioEngine
  const draw = useRef({ dirty: 0, playing: false, layers: [], frame: null });
  const [display, setDisplay] = useState({ width: 0, height: 0 });
  const [backing, setBacking] = useState({ width: 0, height: 0 });
  const [glError, setGlError] = useState(null);
  const { width, height, fps } = project.settings;
  const mediaById = useMemo(() => new Map(project.media.map((m) => [m.id, m])), [project.media]);
  const eventsById = useMemo(() => new Map(project.events.map((e) => [e.id, e])), [project.events]);
  const resolved = useMemo(() => resolveTimeline(project), [project.events, project.tracks]);
  const players = useMemo(() => playerKeys(project.events), [project.events]);

  const layers = videoLayers(project, mediaById, resolved, eventsById, time);

  // Evento con la ventana de panorámica abierta, si se ve ahora (en pausa): su recuadro sustituye al de los textos.
  const panEvent = !playing && panEventId
    ? layers.flatMap((l) => (l.event ? [l.event] : [l.from, l.to])).find((e) => e.id === panEventId)
    : null;
  const panMedia = panEvent && mediaById.get(panEvent.mediaId);
  const panFit = panMedia && (isText(panMedia) ? { w: width, h: height } : fitSize(panMedia.width, panMedia.height, width, height));

  // Textos que se ven ahora (del de más arriba al de más abajo); en pausa se pueden mover con el ratón.
  const textItems = playing || panEventId
    ? []
    : layers
      // (los que tienen panorámica se colocan con ella: su recuadro de texto no coincidiría con lo que se ve)
      .filter((l) => l.event && isText(mediaById.get(l.event.mediaId)) && !panActive(l.event.pan))
      .map((l) => ({ event: l.event, media: mediaById.get(l.event.mediaId) }))
      .reverse();
  const textTarget =
    textItems.find((it) => it.media.id === editTextId) || textItems.find((it) => selection.includes(it.event.id)) || null;

  const invalidate = () => {
    draw.current.dirty = Math.max(draw.current.dirty, 3);
  };

  // Elemento que da la imagen de un evento: un <video> propio por evento o un <img> compartido por medio.
  const sourceFor = (e, create) => {
    const media = mediaById.get(e.mediaId);
    if (isText(media)) {
      // Canvas a la resolución del proyecto, el mismo dibujo que el PNG del render.
      let canvas = textEls.current.get(media.id);
      const key = `${width}x${height}:${JSON.stringify(media.text)}`;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.cortexVersion = 0;
        textEls.current.set(media.id, canvas);
      }
      if (canvas.cortexKey !== key) {
        canvas.width = width;
        canvas.height = height;
        drawText(canvas.getContext('2d'), media.text, width, height);
        canvas.cortexKey = key;
        canvas.cortexVersion++;
      }
      return canvas;
    }
    if (media.isImage) {
      let img = imageEls.current.get(media.id);
      if (!img && create) {
        img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = invalidate;
        img.src = mediaUrl(media.path);
        imageEls.current.set(media.id, img);
      }
      return img;
    }
    const key = players.get(e.id);
    let el = videoEls.current.get(key);
    if (!el && create) {
      el = document.createElement('video');
      el.crossOrigin = 'anonymous';
      el.muted = true;
      el.preload = 'auto';
      el.playsInline = true;
      el.addEventListener('loadeddata', invalidate);
      el.addEventListener('seeked', invalidate);
      el.src = mediaUrl(media.path);
      el.currentTime = e.inPoint;
      sourcesRef.current.appendChild(el);
      videoEls.current.set(key, el);
    }
    return el;
  };

  // Eventos cuyo reproductor hay que tener listo: los que suenan o se ven ahora y los que empiezan en
  // los próximos segundos (así el siguiente clip ya está cargado y en su primer fotograma al llegar).
  const isNear = (e) => time >= e.start - PRELOAD && time <= e.start + e.duration + KEEP;
  const isNow = (e) => e.start <= time && time < e.start + e.duration;

  useEffect(() => {
    // Videos: se preparan los eventos cercanos al cursor, se sincronizan los visibles y se liberan los demás.
    const sorted = [...project.events].sort((a, b) => a.start - b.start);
    const visible = new Set();
    for (const l of layers) {
      for (const e of l.event ? [l.event] : [l.from, l.to]) visible.add(e.id);
    }
    const busy = new Set([...visible].map((id) => players.get(id))); // reproductores que se están viendo
    const videoTracks = new Set(project.tracks.filter((t) => t.type === 'video' && isTrackActive(t, project.tracks)).map((t) => t.id));
    const needed = new Set();
    for (const e of sorted) {
      const m = mediaById.get(e.mediaId);
      if (!videoTracks.has(e.trackId) || !m || m.missing || m.isImage || !isNear(e)) continue;
      const key = players.get(e.id);
      const el = sourceFor(e, true);
      if (visible.has(e.id)) sync(el, sourceTime(e, time), playing, e.rate || 1);
      else if (!busy.has(key) && !needed.has(key)) prepare(el, e, time);
      needed.add(key);
    }
    for (const [id, el] of videoEls.current) {
      if (needed.has(id)) continue;
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
      videoEls.current.delete(id);
    }
    for (const l of layers) if (l.event && mediaById.get(l.event.mediaId).isImage) sourceFor(l.event, true);
    for (const id of textEls.current.keys()) if (!mediaById.has(id)) textEls.current.delete(id);

    draw.current.layers = layers.map((l) =>
      l.event
        ? { a: sourceFor(l.event, false), opacity: l.opacity, fxA: activeEffects(l.event.effects), panA: panLayer(l.event, time) }
        : {
          a: sourceFor(l.from, false),
          b: sourceFor(l.to, false),
          type: l.type,
          progress: l.progress,
          fxA: activeEffects(l.from.effects),
          fxB: activeEffects(l.to.effects),
          panA: panLayer(l.from, time),
          panB: panLayer(l.to, time),
        },
    );
    draw.current.frame = { width, height };
    draw.current.playing = playing;
    invalidate();

    // Audio: un reproductor por grupo de eventos seguidos (como el video), que pasa por los efectos del
    // evento y por el volumen de pista × evento × fundidos (Web Audio, ver AudioEngine). Los de los eventos
    // que están por llegar se cargan y se montan por adelantado, en silencio.
    const engine = audio.current;
    if (!engine) return;
    if (playing) engine.resume();
    const audioFor = (e) => {
      const p = engine.player(players.get(e.id), mediaUrl(mediaById.get(e.mediaId).path), e.inPoint);
      const effects = activeEffects(e.effects).filter((fx) => EFFECTS.get(fx.type).kind === 'audio');
      engine.setEffects(p, effects, { peak: eventPeak(mediaById.get(e.mediaId), e) });
      return p;
    };
    const audible = audibleEvents(project, mediaById, resolved, time);
    const neededAudio = new Set(audible.map(({ event }) => players.get(event.id)));
    for (const { event: e, gain } of audible) {
      const p = audioFor(e);
      engine.setGain(p, gain);
      if (playing) sync(p.el, sourceTime(e, time), true, e.rate || 1);
      else if (!p.el.paused) p.el.pause();
    }
    const audioTracks = new Set(project.tracks.filter((t) => t.type === 'audio' && isTrackActive(t, project.tracks)).map((t) => t.id));
    for (const e of sorted) {
      const m = mediaById.get(e.mediaId);
      if (!audioTracks.has(e.trackId) || !m || !m.hasAudio || m.missing || !isNear(e) || isNow(e)) continue;
      const key = players.get(e.id);
      if (neededAudio.has(key)) continue;
      neededAudio.add(key);
      const p = audioFor(e);
      engine.setGain(p, 0);
      prepare(p.el, e, time);
    }
    for (const key of [...engine.players.keys()]) {
      if (!neededAudio.has(key)) engine.remove(key);
    }
  });

  // Motor de audio de la vista previa (uno por ventana).
  useEffect(() => {
    audio.current = new AudioEngine();
    window.cortexPruebas.audio = audio.current;
    return () => {
      audio.current.close();
      audio.current = null;
    };
  }, []);

  // Bucle de dibujo: cada fotograma mientras se reproduce; en pausa, solo cuando algo cambia.
  useEffect(() => {
    let compositor;
    try {
      compositor = new Compositor(canvasRef.current);
    } catch (err) {
      setGlError(err.message);
      return undefined;
    }
    let raf;
    const loop = () => {
      const d = draw.current;
      if (d.frame && (d.playing || d.dirty > 0)) {
        d.dirty = Math.max(0, d.dirty - 1);
        compositor.render(d.frame, d.layers);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      for (const el of videoEls.current.values()) {
        el.pause();
        el.remove();
      }
      videoEls.current.clear();
    };
  }, []);

  // Resolución interna del lienzo: la del proyecto, sin pasar de la que ocupa en pantalla.
  useEffect(() => {
    const canvas = canvasRef.current;
    const update = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(2, Math.min(width, Math.round(canvas.clientWidth * dpr)));
      const h = Math.max(2, Math.round((w * height) / width));
      canvas.width = w;
      canvas.height = h;
      setDisplay({ width: canvas.clientWidth, height: canvas.clientHeight });
      setBacking({ width: w, height: h });
      invalidate();
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [width, height]);

  return (
    <div className="preview-window">
      <div className="dock-toolbar">
        <button className="tool" title="Propiedades del proyecto (Alt+Intro)" onClick={onOpenProperties}>
          <Icon name="properties" />
        </button>
        <span className="dock-toolbar-label">Vista previa: completa</span>
      </div>
      <div className="preview">
        <div className="screen" style={{ '--aspect': width / height }}>
          <canvas ref={canvasRef} />
          <TextOverlay
            items={textItems}
            target={textTarget}
            width={width}
            height={height}
            onSelect={onSelectEvent}
            onChange={onTextChange}
            onEdit={onEditText}
          />
          {panEvent && panFit && (
            <PanOverlay
              values={panAt(panEvent.pan, time - panEvent.start)}
              crop={panEvent.pan?.crop || NO_CROP}
              fit={panFit}
              width={width}
              height={height}
              onChange={onPanChange}
            />
          )}
          {glError && <div className="preview-error">No se puede mostrar la vista previa: {glError}</div>}
        </div>
        <div className="preview-sources" ref={sourcesRef} />
      </div>
      <div className="preview-info">
        <div>
          Proyecto: <span>{width}×{height}, {formatFps(fps)}p</span>
        </div>
        <div>
          Fotograma: <span>{frameNumber(time, fps)}</span>
        </div>
        <div>
          Vista previa: <span>{backing.width}×{backing.height}, {formatFps(fps)}p</span>
        </div>
        <div>
          Pantalla: <span>{display.width}×{display.height}</span>
        </div>
        <div>
          Tiempo: <span>{formatTimecode(time, fps)}</span>
        </div>
        <div>
          Orientación: <span>{height > width ? 'vertical' : width === height ? 'cuadrada' : 'horizontal'}</span>
        </div>
      </div>
    </div>
  );
}
