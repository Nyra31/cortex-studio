import { useEffect, useRef } from 'react';
import { registerMeter, resetClip } from '../preview/meters.js';
import { tx } from '../i18n/index.js';

// Medidor estéreo (izquierda arriba, derecha abajo) de una pista o del máster (id = 'master'). Lo anima
// meters.js. withLabel: muestra el pico retenido en dB y el testigo de saturación.
export default function Meter({ id, withLabel = false, title }) {
  const refs = useRef({ bars: [], holds: [] });
  const label = useRef(null);
  const clip = useRef(null);
  useEffect(() => registerMeter(id, {
    bars: refs.current.bars,
    holds: refs.current.holds,
    label: label.current,
    clip: clip.current,
  }), [id]);
  return (
    <div className={`meter${withLabel ? ' big' : ''}`} title={title}>
      <div className="meter-bars">
        {[0, 1].map((c) => (
          <div key={c} className="meter-bar">
            <div ref={(el) => (refs.current.bars[c] = el)} className="meter-fill" />
            <div ref={(el) => (refs.current.holds[c] = el)} className="meter-hold" />
          </div>
        ))}
      </div>
      {withLabel && (
        <>
          <span ref={label} className="meter-db">-∞</span>
          <span ref={clip} className="meter-clip" title={tx('Saturación (clic para apagar)')} onClick={() => resetClip(id)} />
        </>
      )}
    </div>
  );
}
