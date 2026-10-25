import { useState } from 'react';
import Icon from './Icon.jsx';
import { MEDIA_MIME } from './Timeline.jsx';
import { formatDuration } from '../util/time.js';
import { formatFps } from '../state/project.js';
import { isText } from '../state/text.js';
import { tx } from '../i18n/index.js';

function describe(m) {
  if (m.missing) return tx('Archivo no encontrado');
  if (isText(m)) return tx('Títulos y texto');
  const parts = [];
  if (m.isImage) parts.push(tx('Imagen'));
  else if (m.hasVideo) parts.push(tx('Video'));
  else parts.push(tx('Audio'));
  if (m.width) parts.push(`${m.width}×${m.height}`);
  if (m.fps && !m.isImage) parts.push(`${formatFps(Math.round(m.fps * 1000) / 1000)} fps`);
  return parts.join(' · ');
}

// proxies / proxyJobs: proxies de la vista previa ya hechos (ruta → proxy) y los que se están creando (ruta → %).
// onMenu(e, medio): clic derecho en un medio.
export default function MediaPool({ media, proxies = {}, proxyJobs = {}, onImport, onYoutube, onNewText, onDropFiles, onRemove, onAdd, onMenu }) {
  const [selected, setSelected] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`media-pool${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) onDropFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="dock-toolbar">
        <button className="tool" title={tx('Importar medios (Ctrl+I)')} onClick={onImport}>
          <Icon name="importMedia" />
        </button>
        <button className="tool" title={tx('Descargar de YouTube (Ctrl+Mayús+D)')} onClick={onYoutube}>
          <Icon name="webDownload" />
        </button>
        <button className="tool" title={tx('Insertar texto en el cursor (Insertar → Medio de texto)')} onClick={onNewText}>
          <Icon name="text" />
        </button>
        <button
          className="tool"
          title={tx('Quitar del proyecto')}
          disabled={!selected}
          onClick={() => {
            onRemove(selected);
            setSelected(null);
          }}
        >
          <Icon name="close" />
        </button>
        <span className="dock-toolbar-label">{tx(media.length === 1 ? '{n} medio' : '{n} medios', { n: media.length })}</span>
      </div>
      {media.length === 0 ? (
        <div className="empty-hint">
         {tx('Arrastra aquí videos, audios o imágenes,')}
          <br />{tx('o pulsa Importar medios (Ctrl+I).')}
        </div>
      ) : (
        <div className="media-grid" onClick={() => setSelected(null)}>
          {media.map((m) => (
            <div
              key={m.id}
              className={`media-item${selected === m.id ? ' selected' : ''}${m.missing ? ' missing' : ''}`}
              draggable={!m.missing}
              onDragStart={(e) => {
                e.dataTransfer.setData(MEDIA_MIME, m.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={(e) => {
                e.stopPropagation();
                setSelected(m.id);
              }}
              onDoubleClick={() => !m.missing && onAdd(m)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSelected(m.id);
                onMenu?.(e, m);
              }}
              title={tx('{n}\nArrastra a la línea de tiempo o haz doble clic para añadir en el cursor', { n: isText(m) ? m.name : m.path })}
            >
              <div className="thumb">
                {m.thumb ? <img src={m.thumb} alt="" /> : <Icon name="music" size={26} />}
                {!m.isImage && m.duration != null && <span className="badge">{formatDuration(m.duration)}</span>}
                {m.path in proxyJobs ? (
                  <span className="badge proxy busy" title={tx('Creando una copia ligera para la vista previa')}>{tx('Proxy {n} %', { n: proxyJobs[m.path] })}</span>
                ) : proxies[m.path] ? (
                  <span className="badge proxy" title={tx('La vista previa usa una copia ligera (proxy); el render, el original')}>{tx('Proxy')}</span>
                ) : null}
              </div>
              <div className="media-name">{m.name}</div>
              <div className="media-meta">{describe(m)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
