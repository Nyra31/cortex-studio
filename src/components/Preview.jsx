import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import TextOverlay from './TextOverlay.jsx';
import PanOverlay from './PanOverlay.jsx';
import { mediaUrl, frameNumber, formatTimecode } from '../util/time.js';
import {
  edgeAt, eventPeak, fadeFactor, fitSize, formatFps, isTrackActive, resolveTimeline, sourceTime, volumeToGain,
} from '../state/project.js';
import { transitionInfo } from '../state/transitions.js';
import { EFFECTS, activeEffects } from '../state/effects.js';
import { Compositor } from '../preview/compositor.js';
import { drawText, hasTextAnim, isText, textAnimAt } from '../state/text.js';
import { NO_CROP, panActive, panAt } from '../state/pan.js';
import { trackMixAt, trackOpacityAt } from '../state/envelopes.js';
import { publishScope, scopeNeedsFrame, scopeWanted } from '../preview/scopes.js';
import { cueAt, subtitleParams } from '../state/subtitles.js';
import { setLutListener } from '../preview/effects-gl.js';
import { hasRamp, speedAt } from '../state/speed.js';
import { AudioEngine, renderOfflineAudio } from '../preview/audio-engine.js';
import { setMeterEngine } from '../preview/meters.js';
import { tx } from '../i18n/index.js';

// Para las pruebas automáticas: procesar un sonido con la misma cadena de efectos que la vista previa.
window.cortexPruebas = { renderOfflineAudio, activeEffects };

const DRIFT = 0.3;
const PRELOAD = 2; // segundos antes de que empiece un evento se prepara su <video>
const KEEP = 1; // y después de que termine se conserva

// Calidad de la vista previa: factor de la resolución del lienzo.
const QUALITY_SCALE = { draft: 0.25, preview: 0.5, good: 1, best: 1 };
const PREFS_KEY = 'cortex-preview';
function loadPreviewPrefs() {
  let p = {};
  try {
    p = JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    // sin almacenamiento: valores por defecto
  }
  return { quality: QUALITY_SCALE[p.quality] ? p.quality : 'good', guides: ['none', 'safe', 'thirds', 'all'].includes(p.guides) ? p.guides : 'none' };
}
function savePreviewPrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // sin almacenamiento
  }
}

// Guías sobre la imagen: zona segura de acción (90 %) y de títulos (80 %), tercios y centro.
function Guides({ kind, width, height }) {
  const safe = kind === 'safe' || kind === 'all';
  const thirds = kind === 'thirds' || kind === 'all';
  const box = (f) => <rect x={(width * (1 - f)) / 2} y={(height * (1 - f)) / 2} width={width * f} height={height * f} />;
  const c = Math.min(width, height) * 0.03;
  return (
    <svg className="preview-guides" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {safe && (
        <g className="safe">
          {box(0.9)}
          {box(0.8)}
          <path d={`M${width / 2 - c},${height / 2}H${width / 2 + c}M${width / 2},${height / 2 - c}V${height / 2 + c}`} />
        </g>
      )}
      {thirds && (
        <path className="thirds" d={`M${width / 3},0V${height}M${(2 * width) / 3},0V${height}M0,${height / 3}H${width}M0,${(2 * height) / 3}H${width}`} />
      )}
    </svg>
  );
}

// Panorámica del evento en el instante t de la línea de tiempo (para el compositor), o null si no cambia nada.
export function panLayer(e, t) {
  if (!panActive(e.pan)) return null;
  return { ...panAt(e.pan, t - e.start), crop: e.pan.crop || NO_CROP };
}

// Capas de video en t, de abajo a arriba. En cada pista activa: la transición en curso o,
// si no hay, el evento que empieza más tarde con la opacidad de sus fundidos. La envolvente de opacidad de la
// pista multiplica la de las dos; blend = modo de fusión de la pista.
function videoLayers(project, mediaById, resolved, eventsById, t) {
  const usable = (e) => {
    const m = e && mediaById.get(e.mediaId);
    return m && !m.missing ? m : null;
  };
  const layers = [];
  const tracks = project.tracks.filter((tr) => tr.type === 'video' && isTrackActive(tr, project.tracks)).reverse();
  for (const track of tracks) {
    const level = trackOpacityAt(track, t);
    const blend = track.blend || 'normal';
    if (level <= 0) continue;
    const tr = resolved.transitions.find((x) => x.trackId === track.id && x.start <= t && t < x.start + x.duration);
    if (tr) {
      const from = eventsById.get(tr.from);
      const to = eventsById.get(tr.to);
      if (usable(from) && usable(to)) {
        layers.push({ from, to, type: transitionInfo(tr.type).index, progress: 1 - (t - tr.start) / tr.duration, opacity: level, blend });
        continue;
      }
    }
    let best = null;
    for (const e of project.events) {
      if (e.trackId === track.id && e.start <= t && t < e.start + e.duration && (!best || e.start >= best.start)) best = e;
    }
    if (!usable(best)) continue;
    const fades = resolved.fades.get(best.id);
    const opacity = fadeFactor(best, t, fades) * level;
    // Fundido con transición: hacia lo que hay debajo (ver edgeAt).
    const edge = fades && edgeAt(t - best.start, best.duration, fades);
    if (opacity > 0) layers.push({ event: best, opacity, blend, edge: edge && { ...edge, type: transitionInfo(edge.type).index } });
  }
  return layers;
}

// Volumen (pista con su envolvente × evento × fundidos) y panorámica de cada evento que suena en t.
function audibleEvents(project, mediaById, resolved, t) {
  const mixes = new Map(
    project.tracks
      .filter((tr) => tr.type === 'audio' && isTrackActive(tr, project.tracks))
      .map((tr) => [tr.id, trackMixAt(tr, t)]),
  );
  const gains = new Map([...mixes].map(([id, m]) => [id, m.gain]));
  return project.events
    .filter((e) => {
      const m = mediaById.get(e.mediaId);
      return mixes.has(e.trackId) && m && m.hasAudio && !m.missing && e.start <= t && t < e.start + e.duration;
    })
    .map((e) => ({
      event: e,
      gain: gains.get(e.trackId) * volumeToGain(e.volume ?? 0) * fadeFactor(e, t, resolved.fades.get(e.id)),
      pan: mixes.get(e.trackId).pan,
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
        !hasRamp(prev) && !hasRamp(e) &&
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

// target: instante del medio; rate: velocidad del evento en ese instante (con rampa cambia en cada fotograma;
// el navegador conserva el tono, igual que el render). El navegador admite de 0,0625 a 16.
function sync(el, target, playing, speed = 1) {
  const rate = Math.min(16, Math.max(0.0625, speed));
  if (Math.abs(el.playbackRate - rate) > 1e-4) el.playbackRate = rate;
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
  onOpenProperties, commands, onMessage, onExportFrame, proxies = {}, onMediaError = () => {},
}) {
  // Video y audio de los medios: su proxy si lo tienen (copia ligera, ver App) o el original.
  const sourceUrl = (media) => mediaUrl(proxies[media.path] || media.path);
  const mediaErrorRef = useRef(onMediaError);
  mediaErrorRef.current = onMediaError;
  const canvasRef = useRef(null);
  const previewRef = useRef(null);
  const externalWin = useRef(null);
  const [full, setFull] = useState(false); // la vista previa ocupa toda la pantalla (en esta ventana)
  const [external, setExternal] = useState(false); // vista previa en otra pantalla
  const sourcesRef = useRef(null);
  const videoEls = useRef(new Map()); // reproductor (ver playerKeys) → <video> (silenciado: el sonido sale de las pistas de audio)
  const imageEls = useRef(new Map()); // id de medio → <img>
  const subCanvas = useRef(null); // lienzo del subtítulo en curso
  const textEls = useRef(new Map()); // id de medio de texto → <canvas> (se redibuja si cambia el texto)
  const audio = useRef(null); // AudioEngine
  const draw = useRef({ dirty: 0, playing: false, layers: [], frame: null });
  const [display, setDisplay] = useState({ width: 0, height: 0 });
  const [backing, setBacking] = useState({ width: 0, height: 0 });
  // Calidad (resolución del lienzo, como en VEGAS) y guías; se recuerdan en este equipo.
  const [quality, setQuality] = useState(() => loadPreviewPrefs().quality);
  const [guides, setGuides] = useState(() => loadPreviewPrefs().guides);
  useEffect(() => savePreviewPrefs({ quality, guides }), [quality, guides]);
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
  // Al terminar de leer una LUT (efecto LUT), se vuelve a dibujar.
  useEffect(() => {
    setLutListener(() => {
      draw.current.dirty = Math.max(draw.current.dirty, 3);
    });
    return () => setLutListener(null);
  }, []);

  // Elemento que da la imagen de un evento: un <video> propio por evento o un <img> compartido por medio.
  const sourceFor = (e, create) => {
    const media = mediaById.get(e.mediaId);
    if (isText(media)) {
      // Canvas a la resolución del proyecto, el mismo dibujo que el PNG del render. Con animación, uno por evento,
      // redibujado en cada fotograma de la animación (en el instante del fotograma, como el render).
      const animated = hasTextAnim(media.text);
      const local = Math.floor((time - e.start) * fps + 1e-6) / fps;
      const anim = animated ? textAnimAt(media.text, local, e.duration) : null;
      const id = animated ? `${media.id}@${e.id}` : media.id;
      let canvas = textEls.current.get(id);
      const key = `${width}x${height}:${JSON.stringify(media.text)}:${JSON.stringify(anim)}`;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.cortexVersion = 0;
        textEls.current.set(id, canvas);
      }
      if (canvas.cortexKey !== key) {
        canvas.width = width;
        canvas.height = height;
        drawText(canvas.getContext('2d'), media.text, width, height, anim);
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
    const url = sourceUrl(media);
    if (el && el.cortexUrl !== url) {
      // Ha llegado (o se ha quitado) el proxy: otro reproductor con la nueva fuente.
      el.removeAttribute('src');
      el.load();
      el.remove();
      videoEls.current.delete(key);
      el = null;
    }
    if (!el && create) {
      el = document.createElement('video');
      el.crossOrigin = 'anonymous';
      el.muted = true;
      el.preload = 'auto';
      el.playsInline = true;
      el.addEventListener('loadeddata', invalidate);
      el.addEventListener('seeked', invalidate);
      // Si el reproductor no puede abrir el archivo (códec no admitido), App crea un proxy.
      el.addEventListener('error', () => mediaErrorRef.current(media.id));
      el.cortexUrl = url;
      el.src = url;
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
      if (visible.has(e.id)) sync(el, sourceTime(e, time), playing, speedAt(e, time - e.start));
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
    for (const id of textEls.current.keys()) {
      const [mediaId, eventId] = id.split('@');
      if (!mediaById.has(mediaId) || (eventId && !eventsById.has(eventId))) textEls.current.delete(id);
    }

    draw.current.layers = layers.map((l) =>
      l.event
        ? { a: sourceFor(l.event, false), opacity: l.opacity, blend: l.blend, edge: l.edge, fxA: activeEffects(l.event.effects, time - l.event.start), panA: panLayer(l.event, time) }
        : {
          a: sourceFor(l.from, false),
          b: sourceFor(l.to, false),
          type: l.type,
          progress: l.progress,
          opacity: l.opacity,
          blend: l.blend,
          fxA: activeEffects(l.from.effects, time - l.from.start),
          fxB: activeEffects(l.to.effects, time - l.to.start),
          panA: panLayer(l.from, time),
          panB: panLayer(l.to, time),
        },
    );
    // Subtítulo en curso, encima de todo (el mismo dibujo que el render cuando se queman).
    const subs = project.subtitles;
    const cue = subs && subs.preview !== false ? cueAt(subs, time) : null;
    if (cue?.text.trim()) {
      const canvas = (subCanvas.current ||= Object.assign(document.createElement('canvas'), { cortexVersion: 0 }));
      const key = `${width}x${height}:${JSON.stringify(subs.style)}:${cue.text}`;
      if (canvas.cortexKey !== key) {
        canvas.width = width;
        canvas.height = height;
        drawText(canvas.getContext('2d'), subtitleParams(subs.style, cue.text), width, height);
        canvas.cortexKey = key;
        canvas.cortexVersion++;
      }
      draw.current.layers.push({ a: canvas, opacity: 1 });
    }
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
      const m = mediaById.get(e.mediaId);
      const p = engine.player(players.get(e.id), sourceUrl(m), e.inPoint, e.trackId);
      if (!p.watched) {
        p.watched = true;
        p.el.addEventListener('error', () => mediaErrorRef.current(m.id));
      }
      const effects = activeEffects(e.effects).filter((fx) => EFFECTS.get(fx.type).kind === 'audio');
      engine.setEffects(p, effects, { peak: eventPeak(mediaById.get(e.mediaId), e) });
      return p;
    };
    const audible = audibleEvents(project, mediaById, resolved, time);
    const neededAudio = new Set(audible.map(({ event }) => players.get(event.id)));
    for (const { event: e, gain, pan } of audible) {
      const p = audioFor(e);
      engine.setGain(p, gain);
      engine.setPan(p, pan);
      if (playing) sync(p.el, sourceTime(e, time), true, speedAt(e, time - e.start));
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
    setMeterEngine(audio.current);
    return () => {
      setMeterEngine(null);
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
      if (d.frame && (d.playing || d.dirty > 0 || scopeNeedsFrame())) {
        d.dirty = Math.max(0, d.dirty - 1);
        compositor.render(d.frame, d.layers);
        // Monitores de video abiertos: copia pequeña del fotograma recién dibujado.
        if (scopeWanted(d.playing)) publishScope(compositor.readScope(512));
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

  // Resolución interna del lienzo: la del proyecto, sin pasar de la que ocupa en pantalla (con la vista previa
  // en otra pantalla o en calidad óptima, la del proyecto). Borrador y vista previa: un cuarto y la mitad (van más
  // ligeros con efectos; las medidas de los efectos son relativas, así que se ven igual pero con menos detalle).
  useEffect(() => {
    const canvas = canvasRef.current;
    const update = () => {
      const dpr = window.devicePixelRatio || 1;
      const base = external || quality === 'best' ? width : Math.min(width, Math.round(canvas.clientWidth * dpr));
      const w = Math.max(2, Math.round(base * (QUALITY_SCALE[quality] ?? 1)));
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
  }, [width, height, external, quality]);

  // Pantalla completa, como la vista previa externa de VEGAS (Alt+Mayús+4 o doble clic en la imagen). Con
  // otra pantalla conectada, la imagen va a esa pantalla y esta sigue libre para editar; con una sola, la
  // vista previa ocupa toda la pantalla. Se sale igual, o con Esc.
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === previewRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const openExternal = useCallback(() => {
    const win = window.open('', 'cortex-externa');
    if (!win) return false;
    externalWin.current = win;
    const doc = win.document;
    doc.title = tx('Cortex Studio: vista previa');
    doc.body.style.cssText = 'margin:0;background:#000;overflow:hidden;cursor:none';
    const video = doc.createElement('video');
    video.style.cssText = 'width:100vw;height:100vh;object-fit:contain;display:block';
    video.muted = true;
    video.autoplay = true;
    // La imagen del lienzo de la vista previa, tal cual (lleva cada fotograma que dibuja el compositor).
    const stream = canvasRef.current.captureStream();
    video.srcObject = stream;
    doc.body.appendChild(video);
    // Las teclas pulsadas con esa ventana activa funcionan igual que en el editor (Esc la cierra).
    doc.addEventListener('keydown', (e) => {
      e.preventDefault();
      if (e.key === 'Escape') {
        win.close();
        return;
      }
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: e.key, code: e.code, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
      }));
    });
    doc.addEventListener('dblclick', () => win.close());
    win.addEventListener('pagehide', () => {
      stream.getTracks().forEach((t) => t.stop());
      externalWin.current = null;
      setExternal(false);
    });
    setExternal(true);
    invalidate();
    return true;
  }, []);
  const toggleFullScreen = useCallback(async () => {
    if (externalWin.current && !externalWin.current.closed) {
      externalWin.current.close();
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    if ((await window.api.displayCount()) > 1 && openExternal()) {
      onMessage?.(tx('Vista previa en la otra pantalla. Para quitarla: Alt+Mayús+4, Esc o doble clic en ella.'));
      return;
    }
    previewRef.current.requestFullscreen().catch(() => {});
  }, [openExternal, onMessage]);
  if (commands) commands.current = { toggleFullScreen };
  useEffect(() => () => externalWin.current?.close(), []);

  return (
    <div className="preview-window">
      <div className="dock-toolbar">
        <button className="tool" title={tx('Propiedades del proyecto (Alt+Intro)')} onClick={onOpenProperties}>
          <Icon name="properties" />
        </button>
        <select className="dock-select" value={quality} onChange={(e) => setQuality(e.target.value)} title={tx('Calidad de la vista previa (no afecta al render)')}>
          <option value="draft">{tx('Borrador (¼)')}</option>
          <option value="preview">{tx('Vista previa (½)')}</option>
          <option value="good">{tx('Buena')}</option>
          <option value="best">{tx('Óptima (tamaño del proyecto)')}</option>
        </select>
        <select className="dock-select" value={guides} onChange={(e) => setGuides(e.target.value)} title={tx('Guías sobre la imagen (no salen en el render)')}>
          <option value="none">{tx('Sin guías')}</option>
          <option value="safe">{tx('Zona segura')}</option>
          <option value="thirds">{tx('Tercios')}</option>
          <option value="all">{tx('Zona segura y tercios')}</option>
        </select>
        <span className="footer-spacer" />
        <button className="tool" title={tx('Exportar el fotograma como imagen PNG (Ctrl+Mayús+E)')} onClick={onExportFrame}>
          <Icon name="camera" />
        </button>
        <button
          className={`tool${external ? ' active' : ''}`}
          title={tx('Vista previa a pantalla completa (Alt+Mayús+4 o doble clic en la imagen; con dos pantallas, en la otra)')}
          onClick={toggleFullScreen}
        >
          <Icon name="fullscreen" />
        </button>
      </div>
      <div className="preview" ref={previewRef}>
        <div
          className="screen"
          style={{ '--aspect': width / height }}
          onDoubleClick={(e) => !e.target.closest('.pan-overlay') && toggleFullScreen()}
          title={full ? tx('Doble clic o Esc: salir de la pantalla completa') : undefined}
        >
          <canvas ref={canvasRef} />
          {!full && guides !== 'none' && <Guides kind={guides} width={width} height={height} />}
          {!full && (
          <TextOverlay
            items={textItems}
            target={textTarget}
            width={width}
            height={height}
            onSelect={onSelectEvent}
            onChange={onTextChange}
            onEdit={onEditText}
          />
          )}
          {!full && panEvent && panFit && (
            <PanOverlay
              values={panAt(panEvent.pan, time - panEvent.start)}
              crop={panEvent.pan?.crop || NO_CROP}
              fit={panFit}
              width={width}
              height={height}
              onChange={onPanChange}
            />
          )}
          {glError && <div className="preview-error">{tx('No se puede mostrar la vista previa: {glError}', { glError })}</div>}
        </div>
        <div className="preview-sources" ref={sourcesRef} />
      </div>
      <div className="preview-info">
        <div>
         {tx('Proyecto:')} <span>{width}×{height}, {formatFps(fps)}p</span>
        </div>
        <div>
         {tx('Fotograma:')} <span>{frameNumber(time, fps)}</span>
        </div>
        <div>
         {tx('Vista previa:')} <span>{backing.width}×{backing.height}, {formatFps(fps)}p</span>
        </div>
        <div>
         {tx('Pantalla:')} <span>{display.width}×{display.height}</span>
        </div>
        <div>
         {tx('Tiempo:')} <span>{formatTimecode(time, fps)}</span>
        </div>
        <div>
         {tx('Orientación:')} <span>{height > width ? tx('vertical') : width === height ? tx('cuadrada') : tx('horizontal')}</span>
        </div>
      </div>
    </div>
  );
}
