import Icon from './Icon.jsx';
import { formatTimecode } from '../util/time.js';

export default function Transport({ playing, time, duration, onTogglePlay, onStop, onStart, onEnd }) {
  return (
    <div className="transport">
      <button title="Ir al inicio (Inicio)" onClick={onStart}>
        <Icon name="start" />
      </button>
      <button className="play" title="Reproducir / Pausar (Espacio)" onClick={onTogglePlay}>
        <Icon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      <button title="Detener (vuelve a donde empezó la reproducción)" onClick={onStop}>
        <Icon name="stop" />
      </button>
      <button title="Ir al final (Fin)" onClick={onEnd}>
        <Icon name="end" />
      </button>
      <div className="timecode">{formatTimecode(time)}</div>
      <div className="duration">/ {formatTimecode(duration)}</div>
    </div>
  );
}
