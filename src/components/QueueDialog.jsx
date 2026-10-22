import { useEffect } from 'react';

const STATUS = {
  waiting: 'En espera',
  rendering: 'Renderizando',
  done: 'Terminado',
  error: 'Error',
  canceled: 'Cancelado',
};

// Cola de render (como el renderizado por lotes): trabajos { id, name, outPath, status, progress, error } que se
// renderizan de uno en uno. La cola sigue aunque se cierre esta ventana (el progreso sale en la barra de estado).
export default function QueueDialog({ queue, running, onStart, onStop, onRemove, onRetry, onClearDone, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const fileName = (p) => p.split(/[\\/]/).pop();
  const pending = queue.some((j) => j.status === 'waiting');

  return (
    <div className="modal-backdrop">
      <div className="modal queue-dialog">
        <div className="modal-title">Cola de render</div>
        <div className="modal-content">
          {queue.length === 0 ? (
            <p className="note">
              La cola está vacía. En <em>Renderizar como…</em>, «Añadir a la cola» guarda un render (con el proyecto tal
              como está en ese momento) para hacerlo después junto con otros.
            </p>
          ) : (
            <div className="queue-list">
              {queue.map((j) => (
                <div key={j.id} className={`queue-item ${j.status}`}>
                  <div className="queue-main">
                    <div className="queue-name" title={j.outPath}>
                      <strong>{fileName(j.outPath)}</strong> <span className="note">· {j.name}</span>
                    </div>
                    <div className="progress small"><div style={{ width: `${((j.status === 'done' ? 1 : j.progress) * 100).toFixed(1)}%` }} /></div>
                    <div className="queue-status">
                      {STATUS[j.status]}
                      {j.status === 'rendering' && ` · ${Math.floor(j.progress * 100)} %`}
                      {j.status === 'error' && <span className="queue-error" title={j.error}> · {j.error?.split('\n').pop()}</span>}
                    </div>
                  </div>
                  <div className="queue-actions">
                    {j.status === 'done' && <button onClick={() => window.api.revealFile(j.outPath)}>Mostrar</button>}
                    {(j.status === 'error' || j.status === 'canceled') && <button onClick={() => onRetry(j.id)}>Reintentar</button>}
                    {j.status !== 'rendering' && <button onClick={() => onRemove(j.id)}>Quitar</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button onClick={onClearDone} disabled={!queue.some((j) => j.status === 'done')}>Quitar los terminados</button>
          <span className="footer-spacer" />
          {running ? (
            <button onClick={onStop}>Detener</button>
          ) : (
            <button onClick={onStart} disabled={!pending}>Renderizar la cola</button>
          )}
          <button className="primary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
