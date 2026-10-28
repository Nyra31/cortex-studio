import { useEffect } from 'react';
import { locale, tx } from '../i18n/index.js';

// Novedades de una o varias versiones (src/state/news.js): después de actualizar y en Ayuda → Novedades…
export default function NewsDialog({ news, updated, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose(); // Intro: el botón, que tiene el foco
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const date = ([y, m, d]) => new Date(y, m - 1, d).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className="modal-backdrop">
      <div className="modal news-dialog">
        <div className="modal-title">
          {updated ? tx('Cortex Studio se ha actualizado a la versión {version}', { version: news[0].version }) : tx('Novedades')}
        </div>
        <div className="modal-content">
          {news.map((n) => (
            <section key={n.version}>
              <h3>
                {tx('Versión {version}', { version: n.version })}
                <span>{date(n.date)}</span>
              </h3>
              <ul>
                {n.items.map(([title, text]) => (
                  <li key={title}>
                    <strong>{title}.</strong> {text}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onClose} autoFocus>
            {tx('Aceptar')}
          </button>
        </div>
      </div>
    </div>
  );
}
