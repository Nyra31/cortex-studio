import { useEffect, useMemo, useRef } from 'react';
import { mediaUrl } from '../util/time.js';

const DRIFT = 0.3;

// El evento visible en t: el de la pista de video más alta; dentro de una pista, el que empieza más tarde.
function activeVisual(project, mediaById, t) {
  for (const track of project.tracks) {
    if (track.type !== 'video' || track.muted) continue;
    let best = null;
    for (const e of project.events) {
      if (e.trackId === track.id && e.start <= t && t < e.start + e.duration && (!best || e.start >= best.start)) best = e;
    }
    const media = best && mediaById.get(best.mediaId);
    if (media && !media.missing) return { event: best, media };
  }
  return null;
}

function audibleEvents(project, mediaById, t) {
  const audioTracks = new Set(project.tracks.filter((tr) => tr.type === 'audio' && !tr.muted).map((tr) => tr.id));
  return project.events.filter((e) => {
    const m = mediaById.get(e.mediaId);
    return audioTracks.has(e.trackId) && m && m.hasAudio && !m.missing && e.start <= t && t < e.start + e.duration;
  });
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

export default function Preview({ project, time, playing }) {
  const videoEls = useRef(new Map());
  const audioEls = useRef(new Map());
  const mediaById = useMemo(() => new Map(project.media.map((m) => [m.id, m])), [project.media]);

  // Un elemento <video> por archivo usado en pistas de video (silenciado: el sonido sale de las pistas de audio).
  const videoMedia = useMemo(() => {
    const videoTracks = new Set(project.tracks.filter((t) => t.type === 'video').map((t) => t.id));
    const used = new Set(project.events.filter((e) => videoTracks.has(e.trackId)).map((e) => e.mediaId));
    return project.media.filter((m) => used.has(m.id) && m.hasVideo && !m.isImage && !m.missing);
  }, [project.media, project.events, project.tracks]);

  const active = activeVisual(project, mediaById, time);

  useEffect(() => {
    for (const [id, el] of videoEls.current) {
      if (active && active.media.id === id) sync(el, active.event.inPoint + time - active.event.start, playing);
      else if (!el.paused) el.pause();
    }

    const audible = audibleEvents(project, mediaById, time);
    const audibleIds = new Set(audible.map((e) => e.id));
    for (const e of audible) {
      const url = mediaUrl(mediaById.get(e.mediaId).path);
      let el = audioEls.current.get(e.id);
      if (!el || el.dataset.url !== url) {
        el = new Audio(url);
        el.dataset.url = url;
        el.preload = 'auto';
        audioEls.current.set(e.id, el);
      }
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

  return (
    <div className="preview">
      <div className="screen">
        {videoMedia.map((m) => (
          <video
            key={m.id}
            ref={(el) => (el ? videoEls.current.set(m.id, el) : videoEls.current.delete(m.id))}
            src={mediaUrl(m.path)}
            muted
            preload="auto"
            className={active && active.media.id === m.id ? 'visible' : ''}
          />
        ))}
        {active && active.media.isImage && <img className="visible" src={mediaUrl(active.media.path)} alt="" />}
      </div>
    </div>
  );
}
