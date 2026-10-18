import Icon from './Icon.jsx';

function TransportButton({ icon, title, onClick, active }) {
  return (
    <button className={`transport-btn${active ? ' active' : ''}`} title={title} onClick={onClick}>
      <Icon name={icon} size={14} />
    </button>
  );
}

export default function Transport({ playing, loop, onToggleLoop, onPlay, onPause, onStop, onStart, onEnd, onPrevFrame, onNextFrame }) {
  return (
    <div className="transport">
      <TransportButton icon="play" title="Reproducir (Espacio)" onClick={onPlay} active={playing} />
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
