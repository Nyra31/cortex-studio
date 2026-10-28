import { useEffect, useMemo, useState } from 'react';
import { silenceRanges } from '../state/transcript.js';
import { decimal, tx } from '../i18n/index.js';

const STORE = 'cortex-silencios';
const DEFAULTS = { thresholdDb: -40, minDur: 0.6, keep: 0.15 };
const load = () => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
};

// Quitar silencios: busca las pausas de una pista de audio con su forma de onda y quita esos tramos de todas las
// pistas (como borrar texto en la pestaña «Texto»). Enseña cuántas y cuánto tiempo antes de aplicarlo.
export default function SilenceDialog({ project, initialTrackId, onApply, onClose }) {
  const tracks = project.tracks.filter((t) => t.type === 'audio' && project.events.some((e) => e.trackId === t.id));
  const [trackId, setTrackId] = useState(tracks.some((t) => t.id === initialTrackId) ? initialTrackId : tracks[0]?.id);
  const [opts, setOpts] = useState(load);
  const ranges = useMemo(() => (trackId ? silenceRanges(project, trackId, opts) : []), [project, trackId, opts]);
  const total = ranges.reduce((s, [a, b]) => s + (b - a), 0);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const change = (patch) => setOpts((o) => {
    const next = { ...o, ...patch };
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {}
    return next;
  });

  return (
    <div className="modal-backdrop">
      <div className="modal silence-dialog">
        <div className="modal-title">{tx('Quitar silencios')}</div>
        <div className="modal-content">
          <p className="note">{tx('Busca las pausas en la pista elegida (normalmente, la de la voz) y las quita de todas las pistas, cerrando los huecos. Se puede deshacer.')}</p>
          <label>
            <span className="field-label">{tx('Pista')}</span>
            <select value={trackId || ''} onChange={(e) => setTrackId(e.target.value)}>
              {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">{tx('Silencio: por debajo de {db} dB', { db: opts.thresholdDb })}</span>
            <input type="range" min={-60} max={-20} step={1} value={opts.thresholdDb} onChange={(e) => change({ thresholdDb: Number(e.target.value) })} />
          </label>
          <label>
            <span className="field-label">{tx('Pausas de al menos {s} s', { s: decimal(opts.minDur, 1) })}</span>
            <input type="range" min={0.2} max={3} step={0.1} value={opts.minDur} onChange={(e) => change({ minDur: Number(e.target.value) })} />
          </label>
          <label>
            <span className="field-label">{tx('Dejar {s} s de silencio a cada lado', { s: decimal(opts.keep, 2) })}</span>
            <input type="range" min={0} max={0.5} step={0.05} value={opts.keep} onChange={(e) => change({ keep: Number(e.target.value) })} />
          </label>
          <p className="note">
            {ranges.length
              ? tx('Se quitarán {n} pausas: {s} s en total.', { n: ranges.length, s: decimal(total, 1) })
              : tx('Con estos valores no hay pausas que quitar.')}
          </p>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>{tx('Cancelar')}</button>
          <button className="primary" disabled={!ranges.length} onClick={() => onApply(ranges, total)}>{tx('Quitar')}</button>
        </div>
      </div>
    </div>
  );
}
