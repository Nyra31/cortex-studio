import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Waveform from './Waveform.jsx';
import Filmstrip from './Filmstrip.jsx';
import Icon from './Icon.jsx';
import Meter from './Meter.jsx';
import { formatRuler, formatTimecode, quantize } from '../util/time.js';
import {
  BLEND_MODES, EVENT_DEFAULTS, MAX_RATE, MAX_TRACK_VOLUME_DB, MIN_EVENT, MIN_RATE, MIN_VOLUME_DB, deleteTrack, eventFades, formatRate, formatVolume, moveTrack,
  markPoints, updateMark, gainToVolume, isTrackActive,
  fadeCurve, overlapAt, placeMedia, replaceMedia, resolveTimeline, scalePanTime, setTransitionAt, shiftPan, trackColor, volumeToGain, scaleFxKeys, shiftFxKeys,
} from '../state/project.js';
import { panActive } from '../state/pan.js';
import {
  MAX_SPEED, MIN_SPEED, addSpeedPoint, hasRamp, localForSource, moveSpeedPoint, rampAt, removeSpeedPoint, scaleSpeedTime, shiftSpeed,
  sourceOffset,
} from '../state/speed.js';
import {
  ENVELOPE_CURVES, ENVELOPE_KINDS, ENVELOPE_MAX_DB, addEnvelopePoint, envelopeAt, envelopeKinds, envelopeValueAt, setEnvelopeCurve,
} from '../state/envelopes.js';
import { TRANSITION_MIME, transitionLabel } from '../state/transitions.js';
import { isText } from '../state/text.js';
import { EFFECTS, EFFECT_MIME, newEffect } from '../state/effects.js';

export const MEDIA_MIME = 'application/x-cortex-media';
const EMPTY = [];
const HEADER_W = 230;
const TRACK_H = { video: 64, audio: 90 };
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

// Franja de marcadores (naranjas, M) y regiones con nombre (verdes, R), como en VEGAS. Se arrastran; doble
// clic: cambiar el nombre (en una región, además, la selecciona); clic derecho: su menú. editing: { kind, id }.
function MarkStrip({ markers, regions, pps, editing, onDown, onDouble, onMenu, onRename }) {
  const label = (x) => (x.name ? `${x.number} · ${x.name}` : String(x.number));
  return (
    <div className="mark-strip">
      {regions.map((r) => (
        <div
          key={r.id}
          className="mark-region"
          style={{ left: r.start * pps, width: Math.max(2, (r.end - r.start) * pps) }}
          title={`Región ${label(r)} (arrastra para moverla; doble clic: seleccionarla y cambiar el nombre)`}
          onPointerDown={(e) => onDown(e, 'region', r, 'move')}
          onDoubleClick={() => onDouble('region', r)}
          onContextMenu={(e) => onMenu(e, 'region', r)}
        >
          <div className="mark-edge start" onPointerDown={(e) => onDown(e, 'region', r, 'start')} />
          <div className="mark-edge end" onPointerDown={(e) => onDown(e, 'region', r, 'end')} />
          {editing?.id === r.id ? <MarkInput value={r.name} onDone={(name) => onRename('region', r.id, name)} /> : <span>{label(r)}</span>}
        </div>
      ))}
      {markers.map((m) => (
        <div
          key={m.id}
          className="mark-marker"
          style={{ left: m.time * pps }}
          title={`Marcador ${label(m)} (tecla ${m.number <= 9 ? m.number : '—'}; arrastra para moverlo; doble clic: cambiar el nombre)`}
          onPointerDown={(e) => onDown(e, 'marker', m, 'move')}
          onDoubleClick={() => onDouble('marker', m)}
          onContextMenu={(e) => onMenu(e, 'marker', m)}
        >
          {editing?.id === m.id ? <MarkInput value={m.name} onDone={(name) => onRename('marker', m.id, name)} /> : <span>{label(m)}</span>}
        </div>
      ))}
    </div>
  );
}

function MarkInput({ value, onDone }) {
  return (
    <input
      className="mark-input"
      autoFocus
      defaultValue={value}
      placeholder="Nombre"
      onFocus={(e) => e.target.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => onDone(e.target.value.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

const Ruler = memo(function Ruler({
  pps, fps, time, scrollLeft, viewWidth, laneWidth, region, onPointerDown, onRegionDown, markers, regions, markProps,
}) {
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
      <MarkStrip markers={markers} regions={regions} pps={pps} {...markProps} />
      {ticks}
      <div className="cursor-head" style={{ left: time * pps }} title="Arrastra para ajustar el cursor (Mayús: sin ajuste)" />
    </div>
  );
});

// Envolvente del evento: fundidos en las esquinas (con su curva) y, en audio, la línea de ganancia. Lo que queda
// por encima se oscurece.
function Envelope({ width, height, gainY, fadeIn, fadeOut, curveIn, curveOut }) {
  const a = fadeIn;
  const b = width - fadeOut;
  const y = (f) => height - (height - gainY) * f;
  const STEPS = 24;
  const pts = [`0,${height}`];
  if (a > 0) for (let i = 1; i <= STEPS; i++) pts.push(`${(a * i) / STEPS},${y(fadeCurve(curveIn, i / STEPS))}`);
  else pts.push(`0,${gainY}`);
  if (fadeOut > 0) for (let i = 0; i < STEPS; i++) pts.push(`${b + (fadeOut * i) / STEPS},${y(1 - fadeCurve(curveOut, i / STEPS))}`);
  else pts.push(`${width},${gainY}`);
  pts.push(`${width},${height}`);
  const line = pts.join(' ');
  return (
    <svg className="envelope" width={width} height={height}>
      <polygon points={`0,0 ${line} ${width},0`} />
      <polyline points={line} />
    </svg>
  );
}

// Momentos con fotograma clave en el evento (panorámica y efectos), para los rombos de la línea de tiempo.
function keyTimes(ev) {
  const list = [
    ...(ev.pan?.keyframes.length > 1 ? ev.pan.keyframes : []),
    ...(ev.effects || []).flatMap((fx) => (fx.keyframes?.length > 1 ? fx.keyframes : [])),
  ].map((k) => Math.round(k.t * 1000) / 1000);
  return [...new Set(list)].filter((t) => t >= 0 && t <= ev.duration);
}

const HANDLE_TITLE = 'Arrastra para recortar (Ctrl: cambiar la velocidad, como en VEGAS)';

// Fundido con transición hacia la pista de debajo: el nombre de la transición en la esquina del fundido.
function FadeTransition({ side, width, height, label }) {
  return (
    <div
      className={`fade-transition ${side}`}
      style={{ top: TITLE_H, width, height }}
      title={`${side === 'in' ? 'Entrada' : 'Salida'} con transición: ${label} (clic derecho sobre el fundido: quitarla)`}
    >
      {width > 30 && <span>{label}</span>}
    </div>
  );
}

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

// Envolvente de velocidad del evento (rampa, en verde como en VEGAS): escala logarítmica de 10 % (abajo) a
// 400 % (arriba), con la línea de 100 % de referencia. Doble clic en la línea: punto nuevo; los puntos se
// arrastran (cerca de 100 % se pegan; Mayús: sin ajuste) y el clic derecho los elimina o los pone a 100 %.
const LOG_MIN = Math.log(MIN_SPEED);
const LOG_SPAN = Math.log(MAX_SPEED) - LOG_MIN;
const speedY = (v, h) => 3 + (1 - (Math.log(v) - LOG_MIN) / LOG_SPAN) * (h - 6);
const speedFromY = (y, h) => Math.exp(LOG_MIN + (1 - (y - 3) / (h - 6)) * LOG_SPAN);
function SpeedEnvelope({ ev, width, height, pps, onPointDown, onLineDouble, onPointMenu }) {
  const pts = ev.speed;
  const times = [0, ...pts.map((p) => p.t).filter((t) => t > 0 && t < ev.duration), ev.duration];
  const line = times.map((t) => `${t * pps},${speedY(rampAt(pts, t), height)}`).join(' ');
  const y100 = speedY(1, height);
  return (
    <svg className="speed-env" width={width} height={height} style={{ top: TITLE_H }}>
      <line className="ref" x1={0} y1={y100} x2={width} y2={y100} />
      <polyline className="line" points={line} />
      <polyline className="hit" points={line} onDoubleClick={(e) => onLineDouble(e, ev)}>
        <title>Envolvente de velocidad (doble clic: añadir un punto)</title>
      </polyline>
      {pts.map((p, i) => (p.t >= -1e-6 && p.t <= ev.duration + 1e-6 ? (
        <circle
          key={i}
          cx={Math.min(width - 4, Math.max(4, p.t * pps))} // los de los extremos, un poco hacia dentro
          cy={speedY(p.v, height)}
          r={4}
          onPointerDown={(e) => onPointDown(e, ev, i)}
          onContextMenu={(e) => onPointMenu(e, ev, i)}
        >
          <title>{`${Math.round(p.v * 100)} % (arrastra; clic derecho: eliminar o 100 %)`}</title>
        </circle>
      ) : null))}
    </svg>
  );
}

// fadeIn/fadeOut: fundidos efectivos (en audio incluyen los fundidos cruzados de los solapamientos).
// overlapIn/overlapOut: segundos solapados con el evento anterior/siguiente de la pista.
const EventView = memo(function EventView({
  ev, media, strip, type, selected, pps, fadeIn, fadeOut, curveIn, curveOut, transIn, transOut, overlapIn, overlapOut, transition, onDown, onReset, onMenu, onFx, onText, onPan, onDouble,
  onSpeedPointDown, onSpeedLineDouble, onSpeedPointMenu,
}) {
  const width = Math.max(3, ev.duration * pps);
  const height = bodyHeight(type);
  const volume = ev.volume ?? 0;
  const gain = type === 'audio' ? volumeToGain(volume) : 1;
  const gainY = (1 - gain) * height;
  const showEnvelope = fadeIn > 0 || fadeOut > 0 || gain < 1;
  // Video con tira de miniaturas: se dibujan a lo largo del evento (Filmstrip); si no, la miniatura del medio repetida.
  const showStrip = type === 'video' && strip && !media?.isImage;
  const bodyStyle = type === 'video' && media?.thumb && !showStrip ? { backgroundImage: `url(${media.thumb})` } : undefined;
  const name = media ? media.name : '?';
  const rate = ev.rate || 1;
  const fadeHandleX = (x) => Math.min(width - 8, Math.max(0, x - 4));
  return (
    <div
      className={`event ${type}${selected ? ' selected' : ''}${media?.missing ? ' missing' : ''}${rate !== 1 || hasRamp(ev) ? ' stretched' : ''}`}
      style={{ left: ev.start * pps, width }}
      onPointerDown={(e) => onDown(e, ev, 'move')}
      onContextMenu={(e) => onMenu(e, ev)}
      onDoubleClick={(e) => !e.target.closest('.fade-handle, .gain-handle, .transition-zone, .speed-env, button') && onDouble(ev)}
      data-event={ev.id}
      title={media?.missing ? `Archivo no encontrado: ${media.path}` : media?.name}
    >
      <div className="event-title">
        {name}
        {rate !== 1 && <span className="event-rate"> · {formatRate(rate)}</span>}
        {hasRamp(ev) && <span className="event-rate"> · rampa</span>}
        {type === 'audio' && volume !== 0 && <span className="event-gain"> · {formatVolume(volume)}</span>}
      </div>
      {type === 'video' && width > 70 && (
        <button
          className={`event-fx event-pan${panActive(ev.pan) ? ' active' : ''}`}
          title="Panorámica/recorte del evento"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onPan(ev.id)}
        >
          <Icon name="crop" size={9} />
        </button>
      )}
      {type === 'video' && keyTimes(ev).length > 0 && (
        <div className="event-keyframes">
          {keyTimes(ev).map((t) => (
            <span key={t} style={{ left: t * pps }} />
          ))}
        </div>
      )}
      {isText(media) && width > 90 && (
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
        {showStrip && (
          <Filmstrip strip={strip} inPoint={ev.inPoint} duration={ev.duration} rate={rate} speed={ev.speed} width={width} height={height} />
        )}
        {type === 'audio' && media?.peaks && (
          <Waveform
            peaks={media.peaks}
            peaksPerSecond={media.peaksPerSecond}
            inPoint={ev.inPoint}
            duration={ev.duration}
            rate={rate}
            speed={ev.speed}
            width={width}
            height={height}
            gain={gain}
            fadeIn={fadeIn}
            fadeOut={fadeOut}
            curveIn={curveIn}
            curveOut={curveOut}
          />
        )}
        {showEnvelope && (
          <Envelope
            width={width} height={height} gainY={gainY} fadeIn={fadeIn * pps} fadeOut={fadeOut * pps} curveIn={curveIn} curveOut={curveOut}
          />
        )}
      </div>
      {hasRamp(ev) && (
        <SpeedEnvelope
          ev={ev} width={width} height={height} pps={pps}
          onPointDown={onSpeedPointDown} onLineDouble={onSpeedLineDouble} onPointMenu={onSpeedPointMenu}
        />
      )}
      {transIn && fadeIn > 0 && <FadeTransition side="in" width={fadeIn * pps} height={height} label={transitionLabel(transIn)} />}
      {transOut && fadeOut > 0 && <FadeTransition side="out" width={fadeOut * pps} height={height} label={transitionLabel(transOut)} />}
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
          title="Fundido de entrada (doble clic: quitar; clic derecho en el fundido: curva)"
          onPointerDown={(e) => onDown(e, ev, 'fadeIn')}
          onDoubleClick={() => onReset(ev, 'fadeIn')}
        />
      )}
      {!overlapOut && (
        <div
          className={`fade-handle${fadeOut > 0 ? ' active' : ''}`}
          style={{ left: fadeHandleX(width - fadeOut * pps) }}
          title="Fundido de salida (doble clic: quitar; clic derecho en el fundido: curva)"
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

// Envolventes de la pista (volumen y opacidad en azul, panorámica en rojo) dibujadas sobre todo el alto de la
// pista. Volumen: 0 dB a un 70 % de la altura desde abajo, +6 dB arriba y −∞ abajo (escala de raíz cuadrada de
// la ganancia, como un fader). Panorámica: izquierda arriba, centro en medio y derecha abajo, como en VEGAS.
// Opacidad: 100 % arriba y 0 % abajo.
const ENV_PAD = 4;
const maxGain = 10 ** (ENVELOPE_MAX_DB / 20);
// Altura de un valor en las unidades de envelopeAt (ganancia lineal para el volumen).
function unitY(kind, u, h) {
  const inner = h - ENV_PAD * 2;
  const f = kind === 'volume' ? Math.sqrt(Math.min(maxGain, u) / maxGain) : kind === 'opacity' ? u : (1 - u) / 2;
  return ENV_PAD + (1 - f) * inner;
}
export const envelopeY = (kind, v, h) => unitY(kind, kind === 'volume' ? volumeToGain(v) : v, h);
export function envelopeValue(kind, y, h) {
  const f = Math.min(1, Math.max(0, 1 - (y - ENV_PAD) / (h - ENV_PAD * 2)));
  if (kind === 'pan') return Math.round((1 - 2 * f) * 100) / 100;
  if (kind === 'opacity') return Math.round(f * 100) / 100;
  const g = f * f * maxGain;
  return g <= volumeToGain(MIN_VOLUME_DB) ? MIN_VOLUME_DB : Math.round(20 * Math.log10(g) * 10) / 10;
}
export const formatPan = (v) => (Math.abs(v) < 0.005 ? 'Centro' : `${Math.round(Math.abs(v) * 100)} % ${v < 0 ? 'I' : 'D'}`);
const formatEnv = (kind, v) => (kind === 'volume' ? formatVolume(v) : kind === 'opacity' ? `${Math.round(v * 100)} %` : formatPan(v));

// Línea de la envolvente en píxeles: los tramos con curva se dibujan a pasos (los de volumen, también los
// lineales: van en amplitud y la escala no lo es); «mantener» es un escalón.
function envelopePath(pts, kind, pps, laneWidth, height) {
  const coords = pts.map((p) => [p.t * pps, envelopeY(kind, p.v, height)]);
  const line = [[0, coords[0][1]], coords[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.c === 'hold') {
      line.push([coords[i + 1][0], coords[i][1]]);
    } else if ((a.c && a.c !== 'linear') || kind === 'volume') {
      const STEPS = Math.max(2, Math.min(24, Math.ceil((coords[i + 1][0] - coords[i][0]) / 3)));
      for (let k = 1; k < STEPS; k++) {
        const t = a.t + ((b.t - a.t) * k) / STEPS;
        line.push([t * pps, unitY(kind, envelopeAt(pts, kind, t), height)]);
      }
    }
    line.push(coords[i + 1]);
  }
  line.push([laneWidth, coords[coords.length - 1][1]]);
  return { coords, d: line.map((c) => c.join(',')).join(' ') };
}

function EnvelopeLines({ track, pps, laneWidth, height, onPointDown, onLineDouble, onPointMenu }) {
  const env = track.envelopes || {};
  return envelopeKinds(track.type).filter((kind) => env[kind]?.length).map((kind) => {
    const pts = env[kind];
    const { coords, d } = envelopePath(pts, kind, pps, laneWidth, height);
    return (
      <svg key={kind} className={`track-envelope ${kind}`} width={laneWidth} height={height}>
        <polyline className="env-hit" points={d} onDoubleClick={(e) => onLineDouble(e, track.id, kind)}>
          <title>{`Envolvente de ${ENVELOPE_KINDS[kind].name.toLowerCase()} (doble clic: añadir un punto)`}</title>
        </polyline>
        <polyline className="env-line" points={d} />
        {coords.map(([x, y], i) => (
          <rect
            key={i}
            className="env-point"
            x={x - 4}
            y={y - 4}
            width={8}
            height={8}
            onPointerDown={(e) => onPointDown(e, track.id, kind, i)}
            onContextMenu={(e) => onPointMenu(e, track.id, kind, i)}
          >
            <title>{`${formatEnv(kind, pts[i].v)} (arrastra para moverlo; clic derecho: eliminar)`}</title>
          </rect>
        ))}
      </svg>
    );
  });
}

function PanSlider({ value, onChange }) {
  const first = useRef(true);
  return (
    <div className="track-slider" title="Panorámica de la pista (doble clic: centro)">
      <span className="slider-label">Pan:</span>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.01}
        value={value}
        onPointerDown={() => (first.current = true)}
        onKeyDown={() => (first.current = true)}
        onChange={(e) => {
          onChange(Number(e.target.value), first.current);
          first.current = false;
        }}
        onDoubleClick={() => onChange(0, true)}
      />
      <span className="slider-value">{formatPan(value)}</span>
    </div>
  );
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
  track, number, color, inactive, events, resolved, mediaById, strips, selectedSet, pps, laneWidth, rowRef, region, dragging,
  armed, recordingBox, onArm, onTrackDown, onTrackMenu, onEnvPointDown, onEnvLineDouble, onEnvPointMenu, onLaneDown, onEventDown, onEventReset, onEventMenu, onLaneMenu, onOpenFx, onEditText, onOpenPan, onEventDouble, onDrop, onUpdateTrack, onDelete,
  onSpeedPointDown, onSpeedLineDouble, onSpeedPointMenu,
}) {
  const update = (changes, record = true) => onUpdateTrack(track.id, changes, record);
  return (
    <div
      className={`track-row ${track.type}${dragging ? ' dragging' : ''}`}
      ref={rowRef}
      style={{ height: TRACK_H[track.type], '--track-color': color }}
    >
      <div
        className="track-header"
        onPointerDown={(e) => onTrackDown(e, track.id)}
        onContextMenu={(e) => onTrackMenu(e, track.id)}
        title="Arrastra para mover la pista; clic derecho: envolventes y más"
      >
        <div className="track-strip">{number}</div>
        <div className="track-main">
          <div className="track-top">
            <Icon name={track.type === 'video' ? 'film' : 'speaker'} size={13} />
            <TrackName name={track.name} onRename={(name) => update({ name })} />
            {track.type === 'audio' && (
              <button
                className={`track-btn arm${armed ? ' active' : ''}`}
                title={armed ? 'Pista armada: aquí se graba la voz en off (Ctrl+R)' : 'Armar para grabar (voz en off desde el micrófono)'}
                onClick={() => onArm(track.id)}
              >
                <Icon name="record" size={11} />
              </button>
            )}
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
          {track.type === 'video' && (
            <label className="track-slider track-blend" title="Modo de fusión con las pistas de debajo" onPointerDown={(e) => e.stopPropagation()}>
              <span className="slider-label">Fusión:</span>
              <select value={track.blend || 'normal'} onChange={(e) => update({ blend: e.target.value === 'normal' ? undefined : e.target.value })}>
                {BLEND_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
          )}
          {track.type === 'audio' && (
            <>
              <VolumeSlider value={track.volume ?? 0} onChange={(volume, record) => update({ volume }, record)} />
              <PanSlider value={track.pan ?? 0} onChange={(pan, record) => update({ pan }, record)} />
              <Meter id={track.id} title="Nivel de la pista (izquierda arriba, derecha abajo)" />
            </>
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
              strip={strips[mediaById.get(ev.mediaId)?.path]}
              type={track.type}
              selected={selectedSet.has(ev.id)}
              pps={pps}
              fadeIn={fades.fadeIn}
              fadeOut={fades.fadeOut}
              curveIn={fades.curveIn}
              curveOut={fades.curveOut}
              transIn={fades.transIn}
              transOut={fades.transOut}
              overlapIn={inc ? inc.duration : 0}
              overlapOut={resolved.outgoing.get(ev.id)?.duration ?? 0}
              transition={inc ? ev.transition : null}
              onDown={onEventDown}
              onReset={onEventReset}
              onMenu={onEventMenu}
              onFx={onOpenFx}
              onText={onEditText}
              onPan={onOpenPan}
              onDouble={onEventDouble}
              onSpeedPointDown={onSpeedPointDown}
              onSpeedLineDouble={onSpeedLineDouble}
              onSpeedPointMenu={onSpeedPointMenu}
            />
          );
        })}
        {recordingBox && (
          <div
            className="recording-box"
            style={{ left: recordingBox.start * pps, width: Math.max(1, (recordingBox.end - recordingBox.start) * pps) }}
          >
            ● Grabando
          </div>
        )}
        {track.envelopes && (
          <EnvelopeLines
            track={track}
            pps={pps}
            laneWidth={laneWidth}
            height={TRACK_H[track.type]}
            onPointDown={onEnvPointDown}
            onLineDouble={onEnvLineDouble}
            onPointMenu={onEnvPointMenu}
          />
        )}
      </div>
    </div>
  );
});

const Timeline = forwardRef(function Timeline({
  project, setProject, selection, setSelection, time, seek, playing, region, setRegion, ripple,
  pps, setPps, snap, onDropFiles, onMessage, onContextMenu, onOpenFx, onEditText, onOpenPan, onAddTrack, footer,
  armedTrackId, onArmTrack, recording, strips = {},
}, ref) {
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const rowRefs = useRef(new Map());
  const rowRefCallbacks = useRef(new Map());
  const zoomAnchor = useRef(null);
  const prevPps = useRef(pps);
  const [view, setView] = useState({ left: 0, width: 1200 });
  const [marquee, setMarquee] = useState(null); // rectángulo de selección { left, right, top, bottom } en px del contenido
  const [trackDrag, setTrackDrag] = useState(null); // pista que se arrastra: { id, line } (line: y de la línea de destino)
  const fps = project.settings.fps;

  // Valores actuales para manejadores estables (evita re-renderizar todas las pistas a cada fotograma).
  const live = useRef(null);
  live.current = { project, selection, time, pps, snap, playing, region, ripple };

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
    return [0, t, ...markPoints(p), ...p.events.filter((e) => !exclude.has(e.id)).flatMap((e) => [e.start, e.start + e.duration])];
  }, []);

  // Dónde queda el cursor al colocarlo con el ratón, como en VEGAS: con el ajuste activado se pega al
  // principio o al final de los eventos cercanos (8 px); si no, cae en el fotograma más próximo.
  // free (Mayús pulsada) desactiva el ajuste en ese momento. offset desplaza respecto al puntero.
  const snapTime = useCallback((time, free = false) => {
    const { project: p, snap: enabled, pps: scale } = live.current;
    const t = Math.max(0, time);
    if (enabled && !free) {
      let best = null;
      for (const x of [0, ...markPoints(p), ...p.events.flatMap((e) => [e.start, e.start + e.duration])]) {
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

  // Marcadores y regiones: arrastrarlos (part: 'move', o 'start'/'end' para los extremos de una región).
  const [editingMark, setEditingMark] = useState(null);
  const onMarkDown = useCallback((e, kind, mark, part) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const startX = e.clientX;
    const t0 = timeAt(e.clientX);
    let moved = false;
    const move = (me) => {
      if (!moved && Math.abs(me.clientX - startX) < 3) return;
      const first = !moved;
      moved = true;
      const dt = timeAt(me.clientX) - t0;
      let changes;
      if (kind === 'marker') {
        changes = { time: snapTime(mark.time + dt, me.shiftKey) };
      } else if (part === 'move') {
        const len = mark.end - mark.start;
        const raw = Math.max(0, mark.start + dt);
        const a = snapTime(raw, me.shiftKey);
        const b = snapTime(raw + len, me.shiftKey) - len;
        const start = Math.max(0, Math.abs(b - raw) < Math.abs(a - raw) ? b : a);
        changes = { start, end: start + len };
      } else {
        const t = snapTime((part === 'start' ? mark.start : mark.end) + dt, me.shiftKey);
        const other = part === 'start' ? mark.end : mark.start;
        const frame = 1 / live.current.project.settings.fps;
        changes = { start: Math.min(t, other), end: Math.max(Math.max(t, other), Math.min(t, other) + frame) };
      }
      setProject((p) => updateMark(p, kind, mark.id, changes), first);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) seek(kind === 'marker' ? mark.time : mark.start); // un clic lleva el cursor ahí
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [seek, setProject, snapTime, timeAt]);
  const onMarkDouble = useCallback((kind, mark) => {
    if (kind === 'region') setRegion({ start: mark.start, end: mark.end });
    setEditingMark({ kind, id: mark.id });
  }, [setRegion]);
  const onMarkRename = useCallback((kind, id, name) => {
    setEditingMark(null);
    setProject((p) => {
      const list = kind === 'marker' ? p.markers : p.regions;
      return list?.find((x) => x.id === id)?.name === name ? p : updateMark(p, kind, id, { name });
    });
  }, [setProject]);
  const onMarkMenu = useCallback((e, kind, mark) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu({ kind, x: e.clientX, y: e.clientY, mark, rename: () => setEditingMark({ kind, id: mark.id }) });
  }, [onContextMenu]);
  const markProps = useMemo(() => ({
    editing: editingMark, onDown: onMarkDown, onDouble: onMarkDouble, onMenu: onMarkMenu, onRename: onMarkRename,
  }), [editingMark, onMarkDown, onMarkDouble, onMarkMenu, onMarkRename]);

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
    // Alt + arrastrar el cuerpo: deslizar el contenido (slip, como en VEGAS). El evento no se mueve ni cambia de
    // duración; cambia el trozo del medio que usa (arrastrar a la derecha muestra lo de antes).
    const slip = e.altKey && mode === 'move';
    if (e.ctrlKey && !stretch) {
      setSelection(sel.includes(ev.id) ? sel.filter((id) => !group.includes(id)) : [...new Set([...sel, ...group])]);
      return;
    }
    const alreadySelected = sel.includes(ev.id);
    const activeSelection = alreadySelected ? sel : group;
    if (!alreadySelected) setSelection(group);

    // Mover afecta a toda la selección; recortar y fundir, al evento y a su grupo; el volumen, solo al evento.
    const affected = new Set(mode === 'move' && !slip ? activeSelection : mode === 'gain' ? [ev.id] : group);
    const origin = new Map(p.events.filter((x) => affected.has(x.id)).map((x) => [x.id, x]));
    const primary = origin.get(ev.id);
    const mediaOf = (o) => p.media.find((m) => m.id === o.mediaId);
    const trackType = new Map(p.tracks.map((t) => [t.id, t.type]));
    const primaryType = trackType.get(primary.trackId);
    const sameType = p.tracks.filter((t) => t.type === primaryType).map((t) => t.id);
    // Edición en cascada: al mover o al recortar el final, los eventos de detrás (en las pistas afectadas o
    // en todas) se desplazan lo mismo. Se toman de la foto inicial, como los que se editan.
    const ripple = live.current.ripple;
    const followers = new Map();
    if (ripple && !slip && (mode === 'move' || mode === 'trimR')) {
      const tracks = new Set(ripple === 'all' ? p.tracks.map((t) => t.id) : [...origin.values()].map((o) => o.trackId));
      const list = [...origin.values()];
      const from = mode === 'move' ? Math.min(...list.map((o) => o.start)) : Math.min(...list.map((o) => o.start + o.duration));
      for (const x of p.events) {
        if (!origin.has(x.id) && tracks.has(x.trackId) && x.start >= from - 1e-6) followers.set(x.id, x);
      }
    }
    const points = snapPoints(new Set([...origin.keys(), ...followers.keys()]));
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

      if (slip) {
        for (const o of origin.values()) {
          const m = mediaOf(o);
          if (!m || m.isImage || !m.duration) continue;
          const r = o.rate || 1;
          const used = sourceOffset(o, o.duration);
          dt = Math.min(dt, o.inPoint / r); // no antes del principio del medio
          dt = Math.max(dt, -(m.duration - o.inPoint - used) / r); // ni después del final
        }
        update = (o) => (mediaOf(o)?.isImage ? {} : { inPoint: Math.max(0, o.inPoint - dt * (o.rate || 1)) });
        onMessage(`Deslizar: el evento empieza en ${formatTimecode(primary.inPoint - dt * (primary.rate || 1), live.current.project.settings.fps)} del medio`);
      } else if (mode === 'move') {
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
            // La velocidad fija pasa a ser rate × duración / duración nueva: debe quedar entre MIN_RATE y MAX_RATE.
            const k = o.duration * (o.rate || 1);
            lo = Math.max(lo, k / MAX_RATE - o.duration);
            hi = k / MIN_RATE - o.duration;
          }
          if (left) hi = Math.min(hi, o.start);
          dt = sign * Math.min(hi, Math.max(lo, sign * dt));
        }
        update = (o) => {
          const duration = o.duration + sign * dt;
          const rate = mediaOf(o)?.isImage ? 1 : (o.duration * (o.rate || 1)) / duration;
          // Los fotogramas clave de la panorámica y la rampa de velocidad se estiran con el evento.
          return {
            start: left ? o.start + dt : o.start, duration, rate,
            pan: scalePanTime(o.pan, duration / o.duration), speed: scaleSpeedTime(o.speed, duration / o.duration),
            effects: scaleFxKeys(o.effects, duration / o.duration),
          };
        };
      } else if (mode === 'trimL') {
        dt = snapDelta(dt, [primary.start], me.shiftKey ? [] : points, threshold);
        for (const o of origin.values()) {
          if (!mediaOf(o)?.isImage) dt = Math.max(dt, localForSource(o, -o.inPoint)); // no antes del principio del medio
          dt = Math.max(dt, -o.start);
          dt = Math.min(dt, o.duration - MIN_EVENT);
        }
        update = (o) => ({
          start: o.start + dt,
          inPoint: mediaOf(o)?.isImage ? 0 : o.inPoint + sourceOffset(o, dt),
          duration: o.duration - dt,
          pan: shiftPan(o.pan, dt), // los fotogramas clave siguen a la imagen
          speed: shiftSpeed(o.speed, dt),
          effects: shiftFxKeys(o.effects, dt),
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
          if (m && !m.isImage && m.duration) dt = Math.min(dt, localForSource(o, m.duration - o.inPoint) - o.duration);
        }
        update = (o) => ({ duration: o.duration + dt });
      }

      // Cuánto se desplazan los de detrás: lo que se mueve el evento o lo que cambia su final.
      const shift = !slip && (mode === 'move' || mode === 'trimR') ? dt : 0;
      setProject(
        (cur) => ({
          ...cur,
          events: cur.events.map((x) => {
            if (origin.has(x.id)) return { ...x, ...update(origin.get(x.id)) };
            if (followers.has(x.id)) return { ...x, start: Math.max(0, followers.get(x.id).start + shift) };
            return x;
          }),
        }),
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
  }, [cursorTime, onMessage, seek, setProject, setSelection, snapPoints, trackAt]);

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
    // ¿Sobre un fundido? (o un fundido cruzado de audio): el menú ofrece su curva.
    const fades = resolved.fades.get(ev.id);
    const local = timeAt(e.clientX) - ev.start;
    const fadeZone = fades && fades.fadeIn > 0 && local < fades.fadeIn ? 'in'
      : fades && fades.fadeOut > 0 && local > ev.duration - fades.fadeOut ? 'out' : null;
    const partner = fadeZone === 'in' ? resolved.incoming.get(ev.id)?.from : fadeZone === 'out' ? resolved.outgoing.get(ev.id)?.to : null;
    onContextMenu({ kind: 'event', x: e.clientX, y: e.clientY, event: ev, selection: selected, time: timeAt(e.clientX), fadeZone, partner });
  }, [onContextMenu, resolved, setSelection, timeAt]);

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
        // Sin solapamiento: transición del fundido de entrada o de salida del evento (hacia la pista de debajo).
        const ev = p.events
          .filter((x) => x.trackId === target && x.start <= at && at < x.start + x.duration)
          .sort((a, b) => b.start - a.start)[0];
        const res = resolveTimeline(p);
        const f = ev && res.fades.get(ev.id);
        if (!ev) {
          onMessage('Suelta la transición sobre el solapamiento de dos eventos o sobre el principio o el final de un evento (para entrar o salir hacia la pista de debajo).');
          return;
        }
        const local = at - ev.start;
        const side = f.fadeIn > 0 && local < f.fadeIn ? 'in'
          : f.fadeOut > 0 && local > ev.duration - f.fadeOut ? 'out' : local < ev.duration / 2 ? 'in' : 'out';
        if (side === 'in' ? res.incoming.has(ev.id) : res.outgoing.has(ev.id)) {
          onMessage('Ese borde ya tiene una transición con otro evento.');
          return;
        }
        const fadeKey = side === 'in' ? 'fadeIn' : 'fadeOut';
        const length = f[fadeKey] > 0 ? f[fadeKey] : Math.min(1, ev.duration / 2);
        setProject((cur) => ({
          ...cur,
          events: cur.events.map((x) => (x.id === ev.id
            ? { ...x, [fadeKey]: length, [side === 'in' ? 'fadeInTransition' : 'fadeOutTransition']: transition }
            : x)),
        }));
        onMessage(`${transitionLabel(transition)} en el fundido de ${side === 'in' ? 'entrada' : 'salida'}. Arrastra la esquina del evento para cambiar su duración.`);
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
    if (mediaId && e.ctrlKey && target !== 'new') {
      // Ctrl + soltar sobre un evento: sustituir su medio (como en VEGAS).
      const { project: p } = live.current;
      const at = timeAt(e.clientX);
      const ev = p.events
        .filter((x) => x.trackId === target && x.start <= at && at < x.start + x.duration)
        .sort((a, b) => b.start - a.start)[0];
      const media = p.media.find((m) => m.id === mediaId);
      if (!ev || !media) {
        onMessage('Con Ctrl, suelta el medio sobre un evento para sustituir el suyo.');
        return;
      }
      const res = replaceMedia(p, ev.id, media);
      if (!res.changed) {
        onMessage(`«${media.name}» no tiene ${p.tracks.find((t) => t.id === target).type === 'video' ? 'imagen' : 'sonido'}: no puede sustituir a ese evento.`);
        return;
      }
      setProject(res.project);
      onMessage(`Medio sustituido por «${media.name}».`);
      return;
    }
    if (mediaId) {
      const media = live.current.project.media.find((m) => m.id === mediaId);
      if (media) setProject((p) => placeMedia(p, media, t, target));
    } else if (e.dataTransfer.files.length) {
      onDropFiles([...e.dataTransfer.files], t, target);
    }
  }, [onDropFiles, onMessage, onOpenFx, setProject, snapPoints, timeAt]);

  // Arrastrar la cabecera de una pista la cambia de sitio (como en VEGAS). Una línea marca dónde quedará.
  const onTrackDown = useCallback((e, trackId) => {
    if (e.button !== 0 || e.target.closest('button, input, .track-slider')) return;
    const startY = e.clientY;
    let dragging = false;
    let target = null; // posición de inserción en la lista actual (0..n)
    const tracks = live.current.project.tracks;
    const from = tracks.findIndex((t) => t.id === trackId);
    const move = (me) => {
      if (!dragging && Math.abs(me.clientY - startY) < 4) return;
      dragging = true;
      const contentTop = contentRef.current.getBoundingClientRect().top;
      const rects = tracks.map((t) => rowRefs.current.get(t.id)?.getBoundingClientRect()).filter(Boolean);
      if (rects.length !== tracks.length) return;
      target = rects.filter((r) => r.top + r.height / 2 < me.clientY).length;
      const line = (target < rects.length ? rects[target].top : rects[rects.length - 1].bottom) - contentTop;
      setTrackDrag({ id: trackId, line });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setTrackDrag(null);
      if (!dragging || target === null) return;
      const index = target > from ? target - 1 : target;
      if (index !== from) setProject((p) => moveTrack(p, trackId, index));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [setProject]);

  // ---- Envolventes de pista ----
  const setEnvelope = useCallback((trackId, kind, fn, record = true) => {
    setProject((p) => ({
      ...p,
      tracks: p.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const points = fn(t.envelopes?.[kind] || null);
        const envelopes = { ...(t.envelopes || {}), [kind]: points };
        if (!points) delete envelopes[kind];
        return { ...t, envelopes: Object.keys(envelopes).length ? envelopes : undefined };
      }),
    }), record);
  }, [setProject]);

  // Arrastrar un punto: en horizontal sin pasar a sus vecinos (se ajusta como el cursor; Mayús: sin ajuste),
  // en vertical cambia su valor.
  const onEnvPointDown = useCallback((e, trackId, kind, index) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const row = rowRefs.current.get(trackId).querySelector('.track-lane').getBoundingClientRect();
    const points = live.current.project.tracks.find((t) => t.id === trackId).envelopes[kind];
    const lo = index > 0 ? points[index - 1].t + 1e-3 : 0;
    const hi = index < points.length - 1 ? points[index + 1].t - 1e-3 : Infinity;
    let first = true;
    const move = (me) => {
      const t = Math.min(hi, Math.max(lo, snapTime(timeAt(me.clientX), me.shiftKey)));
      const v = envelopeValue(kind, me.clientY - row.top, row.height);
      setEnvelope(trackId, kind, (pts) => pts.map((p, i) => (i === index ? { ...p, t, v } : p)), first);
      first = false;
      onMessage(`${ENVELOPE_KINDS[kind].name}: ${formatEnv(kind, v)} en ${formatTimecode(t, live.current.project.settings.fps)}`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [onMessage, setEnvelope, snapTime, timeAt]);

  // Doble clic en la línea: un punto nuevo ahí, con el valor que ya tiene la línea en ese momento.
  const onEnvLineDouble = useCallback((e, trackId, kind) => {
    e.stopPropagation();
    const t = snapTime(timeAt(e.clientX), e.shiftKey);
    setEnvelope(trackId, kind, (pts) => addEnvelopePoint(pts, t, envelopeValueAt(pts, kind, t)));
  }, [setEnvelope, snapTime, timeAt]);

  // ---- Envolvente de velocidad del evento (rampa) ----
  // Se aplica al evento y a su grupo (el sonido de un video sigue a la imagen), con los tiempos de cada uno.
  const setSpeed = useCallback((ev, points, record = true) => {
    setProject((p) => ({
      ...p,
      events: p.events.map((x) => (x.id === ev.id || (ev.groupId && x.groupId === ev.groupId)
        ? { ...x, speed: points ? shiftSpeed(points, x.start - ev.start) : null }
        : x)),
    }), record);
  }, [setProject]);
  const onSpeedPointDown = useCallback((e, ev, index) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const h = bodyHeight(live.current.project.tracks.find((t) => t.id === ev.trackId)?.type || 'video');
    const startX = e.clientX;
    const startY = e.clientY;
    const p0 = ev.speed[index];
    const y0 = speedY(p0.v, h);
    let first = true;
    const fps = live.current.project.settings.fps;
    const move = (me) => {
      const t = Math.round((p0.t + (me.clientX - startX) / live.current.pps) * fps) / fps;
      let v = speedFromY(y0 + me.clientY - startY, h);
      if (!me.shiftKey && Math.abs(speedY(v, h) - speedY(1, h)) < 5) v = 1;
      v = Math.round(v * 100) / 100;
      const points = moveSpeedPoint(ev.speed, index, Math.min(ev.duration, Math.max(0, t)), v);
      setSpeed(ev, points, first);
      first = false;
      onMessage(`Velocidad: ${Math.round(points[index].v * 100)} % en ${formatTimecode(ev.start + points[index].t, fps)}`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [onMessage, setSpeed]);
  const onSpeedLineDouble = useCallback((e, ev) => {
    e.stopPropagation();
    const rect = e.currentTarget.ownerSVGElement.getBoundingClientRect();
    const fps = live.current.project.settings.fps;
    const t = Math.round(((e.clientX - rect.left) / live.current.pps) * fps) / fps;
    setSpeed(ev, addSpeedPoint(ev.speed, t, rampAt(ev.speed, t)));
  }, [setSpeed]);
  const onSpeedPointMenu = useCallback((e, ev, index) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu({
      kind: 'custom',
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Eliminar el punto', action: () => setSpeed(ev, removeSpeedPoint(ev.speed, index)) },
        { label: 'Poner a 100 %', action: () => setSpeed(ev, moveSpeedPoint(ev.speed, index, ev.speed[index].t, 1)) },
        'separator',
        { label: 'Quitar la rampa de velocidad', action: () => setSpeed(ev, null) },
      ],
    });
  }, [onContextMenu, setSpeed]);

  const onEnvPointMenu = useCallback((e, trackId, kind, index) => {
    e.preventDefault();
    e.stopPropagation();
    const points = live.current.project.tracks.find((t) => t.id === trackId).envelopes[kind];
    onContextMenu({
      kind: 'custom',
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Eliminar el punto',
          action: () => setEnvelope(trackId, kind, (pts) => pts.filter((_, i) => i !== index)),
          disabled: points.length < 2,
        },
        {
          label: { volume: 'Poner a 0 dB', pan: 'Poner en el centro', opacity: 'Poner a 100 %' }[kind],
          action: () => setEnvelope(trackId, kind, (pts) => pts.map((p, i) => (i === index ? { ...p, v: ENVELOPE_KINDS[kind].initial } : p))),
        },
        'separator',
        // Curva del tramo que va de este punto al siguiente (como el menú de los puntos de VEGAS).
        ...ENVELOPE_CURVES.map((c) => ({
          label: `Curva: ${c.label.toLowerCase()}`,
          checked: (points[index].c || 'linear') === c.id,
          disabled: index >= points.length - 1,
          action: () => setEnvelope(trackId, kind, (pts) => setEnvelopeCurve(pts, index, c.id)),
        })),
        'separator',
        { label: `Quitar la envolvente de ${ENVELOPE_KINDS[kind].name.toLowerCase()}`, action: () => setEnvelope(trackId, kind, () => null) },
      ],
    });
  }, [onContextMenu, setEnvelope]);

  // Clic derecho en la cabecera de una pista: envolventes (en las de audio) y eliminar la pista.
  const onTrackMenu = useCallback((e, trackId) => {
    e.preventDefault();
    const track = live.current.project.tracks.find((t) => t.id === trackId);
    const env = track.envelopes || {};
    const toggle = (kind) => setEnvelope(trackId, kind, (pts) => (pts ? null : [{ t: 0, v: ENVELOPE_KINDS[kind].initial }]));
    onContextMenu({
      kind: 'custom',
      x: e.clientX,
      y: e.clientY,
      items: [
        ...envelopeKinds(track.type).map((kind) => ({
          label: `Envolvente de ${ENVELOPE_KINDS[kind].name.toLowerCase()}`,
          checked: !!env[kind],
          action: () => toggle(kind),
        })),
        'separator',
        // Modo de fusión de la pista de video con las de debajo (como el modo de composición de VEGAS).
        ...(track.type === 'video'
          ? [
            ...BLEND_MODES.map((m) => ({
              label: `Fusión: ${m.label.toLowerCase()}`,
              checked: (track.blend || 'normal') === m.id,
              action: () => setProject((p) => ({
                ...p,
                tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, blend: m.id === 'normal' ? undefined : m.id } : t)),
              })),
            })),
            'separator',
          ]
          : []),
        { label: 'Eliminar la pista', action: () => onDeleteTrackRef.current(trackId) },
      ],
    });
  }, [onContextMenu, setEnvelope, setProject]);
  const onDeleteTrackRef = useRef(null);

  const onUpdateTrack = useCallback((trackId, changes, record) => {
    setProject((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, ...changes } : t)) }), record);
  }, [setProject]);

  const onDeleteTrack = useCallback((trackId) => {
    const hasEvents = live.current.project.events.some((e) => e.trackId === trackId);
    if (hasEvents && !window.confirm('La pista contiene eventos. ¿Eliminarla de todos modos?')) return;
    setProject((p) => deleteTrack(p, trackId));
  }, [setProject]);
  onDeleteTrackRef.current = onDeleteTrack;

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
              markers={project.markers || EMPTY}
              regions={project.regions || EMPTY}
              markProps={markProps}
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
              strips={strips}
              selectedSet={selectedSet}
              pps={pps}
              laneWidth={laneWidth}
              rowRef={rowRefFor(track.id)}
              region={region}
              dragging={trackDrag?.id === track.id}
              armed={armedTrackId === track.id}
              recordingBox={recording?.trackId === track.id ? { start: recording.start, end: Math.max(recording.start, time) } : null}
              onArm={onArmTrack}
              onTrackDown={onTrackDown}
              onTrackMenu={onTrackMenu}
              onEnvPointDown={onEnvPointDown}
              onEnvLineDouble={onEnvLineDouble}
              onEnvPointMenu={onEnvPointMenu}
              onLaneDown={onLaneDown}
              onEventDown={onEventDown}
              onEventReset={onEventReset}
              onEventMenu={onEventMenu}
              onLaneMenu={onLaneMenu}
              onOpenFx={onOpenFx}
              onEditText={onEditText}
              onOpenPan={onOpenPan}
              onEventDouble={onEventDouble}
              onDrop={onDrop}
              onUpdateTrack={onUpdateTrack}
              onDelete={onDeleteTrack}
              onSpeedPointDown={onSpeedPointDown}
              onSpeedLineDouble={onSpeedLineDouble}
              onSpeedPointMenu={onSpeedPointMenu}
            />
          ))}
          <div className="track-row empty" onDragOver={allowDrop} onDrop={(e) => onDrop(e, 'new')}>
            <div className="track-header">
              <span>Suelta aquí para crear pistas nuevas</span>
              <div className="add-track-buttons">
                <button onClick={() => onAddTrack('video')} title="Insertar pista de video, arriba del todo (Ctrl+Mayús+Q)">
                  <Icon name="film" size={12} /> Pista de video
                </button>
                <button onClick={() => onAddTrack('audio')} title="Insertar pista de audio, abajo del todo (Ctrl+Q)">
                  <Icon name="speaker" size={12} /> Pista de audio
                </button>
              </div>
            </div>
            <div className="track-lane" style={{ width: laneWidth }} onPointerDown={onLaneDown}>
              <RegionShade region={region} pps={pps} />
            </div>
          </div>
          {(project.markers || []).map((m) => (
            <div key={m.id} className="mark-line" style={{ left: HEADER_W + m.time * pps }} />
          ))}
          {(project.regions || []).flatMap((r) => [
            <div key={`${r.id}a`} className="mark-line region" style={{ left: HEADER_W + r.start * pps }} />,
            <div key={`${r.id}b`} className="mark-line region" style={{ left: HEADER_W + r.end * pps }} />,
          ])}
          <div className="cursor-line" style={{ left: HEADER_W + time * pps }} />
          {trackDrag && <div className="track-drop-line" style={{ top: trackDrag.line - 1 }} />}
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
        <span className="footer-info">Máster</span>
        <Meter id="master" withLabel title="Nivel del máster: lo que sale por los altavoces (y en el render). Rojo: satura" />
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
