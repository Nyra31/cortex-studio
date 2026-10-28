import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { cutRange, cutRanges, fillerRanges, timelineWords } from '../state/transcript.js';
import { decimal, tx } from '../i18n/index.js';

// Pestaña «Texto» (editar con el texto): lo que se dice en los eventos de audio transcritos, palabra a palabra, en el
// orden de la línea de tiempo. Clic en una palabra: el cursor va ahí; arrastrar o Mayús+clic: seleccionar; Supr o
// Retroceso: quitar ese tramo de todas las pistas (ver transcript.js). Las pausas largas salen como «[1,2 s]» y se
// pueden borrar igual. La palabra que suena se marca sin volver a dibujar la lista (cambia en cada fotograma).
export default function TranscriptPanel({ project, setProject, time, playing, seek, onTranscribe, onSilences, onMessage }) {
  const items = useMemo(() => timelineWords(project), [project.events, project.transcripts, project.media, project.tracks]);
  const [sel, setSel] = useState(null); // [i, j] con i ≤ j
  const anchor = useRef(null);
  const dragging = useRef(false);
  const listRef = useRef(null);
  const fillers = useMemo(() => fillerRanges(items), [items]);
  const words = items.filter((x) => x.kind === 'word').length;

  useEffect(() => setSel(null), [items]);
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  // La palabra que suena (búsqueda binaria), marcada directamente en el DOM; reproduciendo, se mantiene a la vista.
  const current = useRef(null);
  useEffect(() => {
    let lo = 0;
    let hi = items.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].start <= time) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const idx = found >= 0 && time < items[found].end + 0.3 ? found : -1;
    const el = idx >= 0 ? listRef.current?.querySelector(`[data-i="${idx}"]`) : null;
    if (el === current.current) return;
    current.current?.classList.remove('now');
    el?.classList.add('now');
    current.current = el;
    if (el && playing) el.scrollIntoView({ block: 'nearest' });
  }, [time, items, playing]);

  // message(n, s) → texto de la barra de estado (n tramos, s segundos quitados).
  const cut = (ranges, message) => {
    if (!ranges.length) return;
    setProject((p) => cutRanges(p, ranges));
    setSel(null);
    const total = ranges.reduce((s, [a, b]) => s + (b - a), 0);
    onMessage(message(ranges.length, decimal(total, 1)));
  };
  const deleteSelection = () => {
    if (!sel) return;
    const r = cutRange(items, sel[0], sel[1]);
    if (r) cut([r], (n, s) => tx('Texto quitado: {s} s menos.', { s }));
  };

  const onDown = (i, e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    listRef.current?.focus();
    if (e.shiftKey && anchor.current !== null) {
      setSel([Math.min(anchor.current, i), Math.max(anchor.current, i)]);
      return;
    }
    anchor.current = i;
    dragging.current = true;
    setSel([i, i]);
    seek(items[i].start);
  };
  const onEnter = (i) => {
    if (dragging.current && anchor.current !== null) setSel([Math.min(anchor.current, i), Math.max(anchor.current, i)]);
  };
  const onKeyDown = (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
      e.preventDefault();
      e.stopPropagation(); // si no, App borraría los eventos seleccionados
      deleteSelection();
    } else if (e.key === 'Escape' && sel) {
      e.stopPropagation();
      setSel(null);
    }
  };

  return (
    <div className="transcript-panel">
      <div className="dock-toolbar">
        <button className="tool-text" onClick={onTranscribe} title={tx('Transcribir la voz de los eventos de audio, palabra a palabra, con Whisper (en este equipo)')}>{tx('Transcribir…')}</button>
        <button className="tool-text" onClick={deleteSelection} disabled={!sel} title={tx('Quitar del video lo que se dice en el texto seleccionado (Supr)')}>{tx('Quitar lo seleccionado')}</button>
        <button
          className="tool-text"
          disabled={!fillers.length}
          onClick={() => cut(fillers, (n, s) => (n === 1 ? tx('Quitada {n} muletilla ({s} s).', { n, s }) : tx('Quitadas {n} muletillas ({s} s).', { n, s })))}
          title={tx('Quitar los «eh», «em», «mmm»… que ha escrito Whisper')}
        >
          {tx('Quitar muletillas ({n})', { n: fillers.length })}
        </button>
        <button className="tool-text" onClick={onSilences} title={tx('Quitar las pausas largas de una pista, midiendo el volumen (no hace falta transcribir)')}>{tx('Quitar silencios…')}</button>
        <span className="dock-toolbar-label">{words === 1 ? tx('{n} palabra', { n: words }) : tx('{n} palabras', { n: words })}</span>
      </div>
      {items.length === 0 ? (
        <div className="empty-hint">
          {tx('Transcribe la voz de los eventos de audio para editar el video borrando texto:')}
          <br />
          {tx('al quitar una frase aquí, se corta en todas las pistas.')}
        </div>
      ) : (
        <div className="transcript-text" ref={listRef} tabIndex={0} onKeyDown={onKeyDown}>
          <Words items={items} sel={sel} onDown={onDown} onEnter={onEnter} />
        </div>
      )}
    </div>
  );
}

// La lista solo se vuelve a dibujar si cambian las palabras o la selección.
const Words = memo(function Words({ items, sel, onDown, onEnter }) {
  const out = [];
  items.forEach((x, i) => {
    const selected = sel && i >= sel[0] && i <= sel[1];
    if (i > 0 && x.start - items[i - 1].end >= 2) out.push(<br key={`br${i}`} />);
    out.push(
      <span
        key={x.key}
        data-i={i}
        className={`tw ${x.kind}${x.filler ? ' filler' : ''}${selected ? ' sel' : ''}`}
        onMouseDown={(e) => onDown(i, e)}
        onMouseEnter={() => onEnter(i)}
      >
        {x.kind === 'pause' ? `[${decimal(x.end - x.start, 1)} s]` : x.text}
      </span>,
      ' ',
    );
  });
  return out;
}, (a, b) => a.items === b.items && a.sel === b.sel);
