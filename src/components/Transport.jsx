import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

function TransportButton({ icon, title, onClick, onContextMenu, active, className = '' }) {
  return (
    <button className={`transport-btn ${className}${active ? ' active' : ''}`} title={title} onClick={onClick} onContextMenu={onContextMenu}>
      <Icon name={icon} size={14} />
    </button>
  );
}

// Medidor del nivel del micrófono mientras se graba. Se anima por su cuenta (lee el nivel del grabador en cada
// fotograma) para no tener que redibujar nada más.
export function LevelMeter({ source }) {
  const bar = useRef(null);
  const read = useRef(source);
  read.current = source; // la función cambia en cada dibujado; el bucle usa siempre la última
  useEffect(() => {
    let raf;
    const tick = () => {
      const level = read.current() || 0;
      const db = level > 0 ? 20 * Math.log10(level) : -60;
      const fill = Math.max(0, Math.min(1, (db + 60) / 60));
      if (bar.current) {
        bar.current.style.width = `${fill * 100}%`;
        bar.current.className = `level-fill${db > -1 ? ' clip' : db > -9 ? ' hot' : ''}`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="level-meter" title="Nivel del micrófono (rojo: satura; baja la ganancia del micrófono)">
      <div ref={bar} className="level-fill" />
    </div>
  );
}

export default function Transport({
  playing, loop, recording, recorder, onRecord, onRecordMenu, onToggleLoop, onPlay, onPause, onStop, onStart, onEnd, onPrevFrame, onNextFrame,
}) {
  return (
    <div className="transport">
      <TransportButton
        icon="record"
        className="record"
        title={recording ? 'Terminar la grabación (Ctrl+R)' : 'Grabar voz en off en la pista armada (Ctrl+R); clic derecho: opciones'}
        onClick={onRecord}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!recording) onRecordMenu();
        }}
        active={recording}
      />
      {recording && <LevelMeter source={() => recorder.current?.level} />}
      <TransportButton icon="play" title="Reproducir (Espacio)" onClick={onPlay} active={playing && !recording} />
      <TransportButton icon="pause" title="Pausa (Intro)" onClick={onPause} />
      <TransportButton icon="stop" title="Detener y volver (Espacio)" onClick={onStop} />
      <span className="transport-sep" />
      <TransportButton icon="start" title="Ir al inicio (Inicio)" onClick={onStart} />
      <TransportButton icon="end" title="Ir al final (Fin)" onClick={onEnd} />
      <span className="transport-sep" />
      <TransportButton icon="prevFrame" title="Fotograma anterior (←)" onClick={onPrevFrame} />
      <TransportButton icon="nextFrame" title="Fotograma siguiente (→)" onClick={onNextFrame} />
      <span className="transport-sep" />
      <TransportButton
        icon="loop"
        title="Reproducción en bucle de la selección de tiempo (Q)"
        onClick={onToggleLoop}
        active={loop}
      />
    </div>
  );
}
