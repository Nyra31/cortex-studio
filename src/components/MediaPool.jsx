import { useState } from 'react';
import Icon from './Icon.jsx';
import { MEDIA_MIME } from './Timeline.jsx';
import { formatDuration } from '../util/time.js';
import { formatFps } from '../state/project.js';
import { isText } from '../state/text.js';

function describe(m) {
  if (m.missing) return 'Archivo no encontrado';
  if (isText(m)) return 'Títulos y texto';
  const parts = [];
  if (m.isImage) parts.push('Imagen');
  else if (m.hasVideo) parts.push('Video');
  else parts.push('Audio');
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
        <button className="tool" title="Importar medios (Ctrl+I)" onClick={onImport}>
          <Icon name="importMedia" />
        </button>
        <button className="tool" title="Descargar de YouTube (Ctrl+Mayús+D)" onClick={onYoutube}>
          <Icon name="webDownload" />
        </button>
        <button className="tool" title="Insertar texto en el cursor (Insertar → Medio de texto)" onClick={onNewText}>
          <Icon name="text" />
        </button>
        <button
          className="tool"
          title="Quitar del proyecto"
          disabled={!selected}
          onClick={() => {
            onRemove(selected);
            setSelected(null);
          }}
        >
          <Icon name="close" />
        </button>
        <span className="dock-toolbar-label">{media.length} {media.length === 1 ? 'medio' : 'medios'}</span>
      </div>
      {media.length === 0 ? (
        <div className="empty-hint">
          Arrastra aquí videos, audios o imágenes,
          <br />o pulsa Importar medios (Ctrl+I).
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
              title={`${isText(m) ? m.name : m.path}\nArrastra a la línea de tiempo o haz doble clic para añadir en el cursor`}
            >
              <div className="thumb">
                {m.thumb ? <img src={m.thumb} alt="" /> : <Icon name="music" size={26} />}
                {!m.isImage && m.duration != null && <span className="badge">{formatDuration(m.duration)}</span>}
                {m.path in proxyJobs ? (
                  <span className="badge proxy busy" title="Creando una copia ligera para la vista previa">Proxy {proxyJobs[m.path]} %</span>
                ) : proxies[m.path] ? (
                  <span className="badge proxy" title="La vista previa usa una copia ligera (proxy); el render, el original">Proxy</span>
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
