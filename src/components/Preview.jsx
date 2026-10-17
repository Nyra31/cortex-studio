import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { mediaUrl, frameNumber, formatTimecode } from '../util/time.js';
import { fadeFactor, formatFps, isTrackActive, volumeToGain } from '../state/project.js';

const DRIFT = 0.3;

// Capas visibles en t, de arriba a abajo: en cada pista de video activa, el evento que empieza más tarde.
// Se baja de pista mientras la capa de encima esté fundiéndose (opacidad < 1).
function visibleLayers(project, mediaById, t) {
  const layers = [];
  for (const track of project.tracks) {
    if (track.type !== 'video' || !isTrackActive(track, project.tracks)) continue;
    let best = null;
    for (const e of project.events) {
      if (e.trackId === track.id && e.start <= t && t < e.start + e.duration && (!best || e.start >= best.start)) best = e;
    }
    const media = best && mediaById.get(best.mediaId);
    if (!media || media.missing) continue;
    // Un mismo archivo solo tiene un <video>: si ya está en una capa superior, no se repite.
    if (!media.isImage && layers.some((l) => l.media.id === media.id)) continue;
    const opacity = fadeFactor(best, t);
    layers.push({ event: best, media, opacity });
    if (opacity >= 1) break;
  }
  return layers;
}

function audibleEvents(project, mediaById, t) {
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
    .map((e) => ({ event: e, gain: gains.get(e.trackId) * volumeToGain(e.volume ?? 0) * fadeFactor(e, t) }));
}

function sync(el, target, playing) {
  if (playing) {
    if (!el.seeking && Math.abs(el.currentTime - target) > DRIFT) el.currentTime = target;
    if (el.paused) el.play().catch(() => {});
  } else {
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
  }
}

export default function Preview({ project, time, playing, onOpenProperties }) {
  const videoEls = useRef(new Map());
  const audioEls = useRef(new Map());
  const screenRef = useRef(null);
  const [display, setDisplay] = useState({ width: 0, height: 0 });
  const { width, height, fps } = project.settings;
  const mediaById = useMemo(() => new Map(project.media.map((m) => [m.id, m])), [project.media]);

  // Un elemento <video> por archivo usado en pistas de video (silenciado: el sonido sale de las pistas de audio).
  const videoMedia = useMemo(() => {
    const videoTracks = new Set(project.tracks.filter((t) => t.type === 'video').map((t) => t.id));
    const used = new Set(project.events.filter((e) => videoTracks.has(e.trackId)).map((e) => e.mediaId));
    return project.media.filter((m) => used.has(m.id) && m.hasVideo && !m.isImage && !m.missing);
  }, [project.media, project.events, project.tracks]);

  const layers = visibleLayers(project, mediaById, time);
  const layerOf = (mediaId) => layers.find((l) => l.media.id === mediaId);
  const layerStyle = (layer) => ({ opacity: layer.opacity, zIndex: layers.length - layers.indexOf(layer) });

  useEffect(() => {
    for (const [id, el] of videoEls.current) {
      const layer = layerOf(id);
      if (layer) sync(el, layer.event.inPoint + time - layer.event.start, playing);
      else if (!el.paused) el.pause();
    }

    const audible = audibleEvents(project, mediaById, time);
    const audibleIds = new Set(audible.map(({ event }) => event.id));
    for (const { event: e, gain } of audible) {
      const url = mediaUrl(mediaById.get(e.mediaId).path);
      let el = audioEls.current.get(e.id);
      if (!el || el.dataset.url !== url) {
        el = new Audio(url);
        el.dataset.url = url;
        el.preload = 'auto';
        audioEls.current.set(e.id, el);
      }
      el.volume = Math.min(1, gain);
      if (playing) sync(el, e.inPoint + time - e.start, true);
      else if (!el.paused) el.pause();
    }
    const existing = new Set(project.events.map((e) => e.id));
    for (const [id, el] of audioEls.current) {
      if (audibleIds.has(id)) continue;
      if (!el.paused) el.pause();
      if (!existing.has(id)) {
        el.removeAttribute('src');
        audioEls.current.delete(id);
      }
    }
  });

  useEffect(() => () => {
    for (const el of audioEls.current.values()) el.pause();
  }, []);

  useEffect(() => {
    const el = screenRef.current;
    const ro = new ResizeObserver(() => setDisplay({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="preview-window">
      <div className="dock-toolbar">
        <button className="tool" title="Propiedades del proyecto (Alt+Intro)" onClick={onOpenProperties}>
          <Icon name="properties" />
        </button>
        <span className="dock-toolbar-label">Vista previa: completa</span>
      </div>
      <div className="preview">
        <div className="screen" ref={screenRef} style={{ '--aspect': width / height }}>
          {videoMedia.map((m) => {
            const layer = layerOf(m.id);
            return (
              <video
                key={m.id}
                ref={(el) => (el ? videoEls.current.set(m.id, el) : videoEls.current.delete(m.id))}
                src={mediaUrl(m.path)}
                muted
                preload="auto"
                className={layer ? 'visible' : ''}
                style={layer ? layerStyle(layer) : undefined}
              />
            );
          })}
          {layers
            .filter((l) => l.media.isImage)
            .map((l) => (
              <img key={l.event.id} className="visible" style={layerStyle(l)} src={mediaUrl(l.media.path)} alt="" />
            ))}
        </div>
      </div>
      <div className="preview-info">
        <div>
          Proyecto: <span>{width}×{height}, {formatFps(fps)}p</span>
        </div>
        <div>
          Fotograma: <span>{frameNumber(time, fps)}</span>
        </div>
        <div>
          Vista previa: <span>{width}×{height}, {formatFps(fps)}p</span>
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
