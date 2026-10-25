import { useEffect, useRef } from 'react';
import FontPicker from './FontPicker.jsx';
import { formatTimecode } from '../util/time.js';
import {
  SUB_STYLE, addCue, cueAt, importCues, parseSubtitles, removeCue, setSubtitleOptions, subtitlesOf, toSrt, updateCue,
} from '../state/subtitles.js';
import { tx } from '../i18n/index.js';

// Lee un tiempo escrito como hh:mm:ss:ff (fotogramas), hh:mm:ss,mmm o en segundos. null si no se entiende.
function parseTime(s, fps) {
  const t = String(s).trim().replace(',', '.');
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(':').map(Number);
  if (parts.some((x) => Number.isNaN(x))) return null;
  if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / fps;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

// Pestaña «Subtítulos»: la lista de subtítulos (tiempos y texto editables), añadir en el cursor o en la
// selección de tiempo, importar y exportar SRT, el estilo y si se ven en la vista previa. focusId: subtítulo cuyo
// texto se edita al abrir (doble clic en la franja de la regla).
export default function SubtitlesPanel({ project, setProject, time, seek, region, focusId, onFocused, onMessage, defaultName, onTranscribe }) {
  const subs = subtitlesOf(project);
  const fps = project.settings.fps;
  const style = { ...SUB_STYLE, ...subs.style };
  const active = cueAt(subs, time);
  const refs = useRef(new Map());
  const listRef = useRef(null);
  const first = useRef(true);

  useEffect(() => {
    if (!focusId) return;
    const el = refs.current.get(focusId);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
      el.focus();
      el.select();
    }
    onFocused?.();
  }, [focusId, onFocused]);

  // El subtítulo que suena se ve en la lista.
  useEffect(() => {
    if (active) refs.current.get(active.id)?.closest('.sub-row')?.scrollIntoView({ block: 'nearest' });
  }, [active?.id]);

  const add = () => {
    const start = region ? region.start : time;
    const end = region ? region.end : time + 2;
    const res = addCue(project, start, end, '');
    setProject(res.project);
    setTimeout(() => refs.current.get(res.cue.id)?.focus(), 50);
  };
  const doImport = async () => {
    const res = await window.api.importSubtitles();
    if (!res) return;
    const list = parseSubtitles(res.text);
    if (!list.length) {
      onMessage(tx('El archivo no tiene subtítulos que se puedan leer (SRT o WebVTT).'));
      return;
    }
    const replace = subs.cues.length > 0 && window.confirm(tx('Ya hay {cues} subtítulos. ¿Sustituirlos por los del archivo? (Cancelar: añadirlos a los que hay)', { cues: subs.cues.length }));
    setProject((p) => importCues(p, list, replace));
    onMessage(tx('{length} subtítulos importados de {path}', { length: list.length, path: res.path }));
  };
  const doExport = async () => {
    const saved = await window.api.exportSubtitles(toSrt(subs.cues), `${defaultName}.srt`);
    if (saved) onMessage(tx('Subtítulos exportados a {saved}', { saved }));
  };
  const setStyle = (changes, record = true) => setProject((p) => setSubtitleOptions(p, { style: { ...style, ...changes } }), record);
  const live = (id, toValue = (v) => v) => ({
    onPointerDown: () => (first.current = true),
    onChange: (e) => {
      setStyle({ [id]: toValue(e.target.value) }, first.current);
      first.current = false;
    },
  });
  const timeField = (cue, field) => (
    <input
      key={`${cue.id}-${field}-${cue[field]}`}
      className="sub-time"
      defaultValue={formatTimecode(cue[field], fps)}
      title={field === 'start' ? tx('Entrada (hh:mm:ss:ff o segundos)') : tx('Salida')}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      onBlur={(e) => {
        const t = parseTime(e.target.value, fps);
        if (t === null) {
          e.target.value = formatTimecode(cue[field], fps);
          return;
        }
        const other = field === 'start' ? cue.end : cue.start;
        const changes = field === 'start' ? { start: Math.min(t, other - 0.1) } : { end: Math.max(t, other + 0.1) };
        setProject((p) => updateCue(p, cue.id, changes));
      }}
    />
  );

  return (
    <div className="subtitles-panel">
      <div className="dock-toolbar">
        <button className="tool-text" onClick={add} title={tx('Subtítulo nuevo en el cursor (2 s) o en la selección de tiempo')}>{tx('+ Añadir')}</button>
        <button className="tool-text" onClick={onTranscribe} title={tx('Escribir los subtítulos a partir de la voz, con Whisper (en este equipo)')}>{tx('Automáticos…')}</button>
        <button className="tool-text" onClick={doImport}>{tx('Importar SRT…')}</button>
        <button className="tool-text" onClick={doExport} disabled={!subs.cues.length}>{tx('Exportar SRT…')}</button>
        <label className="sub-check" title={tx('Ver los subtítulos en la vista previa')}>
          <input type="checkbox" checked={subs.preview !== false} onChange={(e) => setProject((p) => setSubtitleOptions(p, { preview: e.target.checked }))} />
         {tx('Ver en la vista previa')}
        </label>
        <span className="dock-toolbar-label">{tx('{cues} subtítulos', { cues: subs.cues.length })}</span>
      </div>
      <div className="sub-style">
        <FontPicker value={style.font} onChange={(font) => setStyle({ font })} />
        <label title={tx('Tamaño')}>{tx('Tamaño')} <input type="range" min={0.025} max={0.12} step={0.001} value={style.size} {...live('size', Number)} /></label>
        <label title={tx('Altura (0 = arriba, 1 = abajo)')}>{tx('Altura')} <input type="range" min={0.05} max={0.95} step={0.005} value={style.y} {...live('y', Number)} /></label>
        <label title={tx('Contorno')}>{tx('Contorno')} <input type="range" min={0} max={0.2} step={0.005} value={style.outline} {...live('outline', Number)} /></label>
        <label title={tx('Caja detrás del texto')}>{tx('Caja')} <input type="range" min={0} max={1} step={0.01} value={style.box} {...live('box', Number)} /></label>
        <input type="color" title={tx('Color del texto')} value={style.color} {...live('color')} />
        <input type="color" title={tx('Color del contorno')} value={style.outlineColor} {...live('outlineColor')} />
        <input type="color" title={tx('Color de la caja')} value={style.boxColor} {...live('boxColor')} />
      </div>
      {subs.cues.length === 0 ? (
        <div className="empty-hint">
         {tx('Sin subtítulos. «+ Añadir» crea uno en el cursor (o en la selección de tiempo);')}
          <br />
         {tx('también se pueden importar de un archivo SRT.')}
        </div>
      ) : (
        <div className="sub-list" ref={listRef}>
          {subs.cues.map((cue, i) => (
            <div key={cue.id} className={`sub-row${active?.id === cue.id ? ' active' : ''}`}>
              <button className="sub-number" title={tx('Llevar el cursor aquí')} onClick={() => seek(cue.start)}>{i + 1}</button>
              <div className="sub-times">
                {timeField(cue, 'start')}
                {timeField(cue, 'end')}
              </div>
              <textarea
                ref={(el) => (el ? refs.current.set(cue.id, el) : refs.current.delete(cue.id))}
                className="sub-text"
                rows={2}
                value={cue.text}
                spellCheck
                placeholder={tx('Texto del subtítulo')}
                onFocus={() => {
                  first.current = true;
                  if (time < cue.start || time >= cue.end) seek(cue.start);
                }}
                onChange={(e) => {
                  setProject((p) => updateCue(p, cue.id, { text: e.target.value }), first.current);
                  first.current = false;
                }}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button className="sub-delete" title={tx('Eliminar el subtítulo')} onClick={() => setProject((p) => removeCue(p, cue.id))}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
