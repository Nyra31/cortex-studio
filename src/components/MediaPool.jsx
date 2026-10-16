import { useState } from 'react';
import Icon from './Icon.jsx';
import { MEDIA_MIME } from './Timeline.jsx';
import { formatDuration } from '../util/time.js';

function describe(m) {
  if (m.missing) return 'Archivo no encontrado';
  const parts = [];
  if (m.isImage) parts.push('Imagen');
  else if (m.hasVideo) parts.push('Video');
  else parts.push('Audio');
  if (m.width) parts.push(`${m.width}×${m.height}`);
  if (m.fps && !m.isImage) parts.push(`${Math.round(m.fps * 100) / 100} fps`);
  return parts.join(' · ');
}

export default function MediaPool({ media, onImport, onDropFiles, onRemove, onAdd }) {
  const [selected, setSelected] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`panel media-pool${dragOver ? ' drag-over' : ''}`}
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
      <div className="panel-header">
        <span>Medios del proyecto</span>
        <div className="panel-actions">
          <button onClick={onImport}>Importar…</button>
          <button
            disabled={!selected}
            onClick={() => {
              onRemove(selected);
              setSelected(null);
            }}
          >
            Quitar
          </button>
        </div>
      </div>
      {media.length === 0 ? (
        <div className="empty-hint">
          Arrastra aquí videos, audios o imágenes,
          <br />o usa «Importar…».
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
              title={`${m.path}\nArrastra a la línea de tiempo o haz doble clic para añadir en el cursor`}
            >
              <div className="thumb">
                {m.thumb ? <img src={m.thumb} alt="" /> : <Icon name="music" size={28} />}
                {!m.isImage && m.duration != null && <span className="badge">{formatDuration(m.duration)}</span>}
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
