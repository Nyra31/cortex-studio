import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Menú contextual (clic derecho) en la posición del puntero, con el mismo aspecto que los de la barra de menús.
// items = [{ label, shortcut, action, disabled, checked } | 'separator']
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Si no cabe a la derecha o abajo, se abre hacia el otro lado.
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: x + r.width > window.innerWidth ? Math.max(0, x - r.width) : x,
      top: y + r.height > window.innerHeight ? Math.max(0, y - r.height) : y,
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e) => {
      if (!ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div className="menu-list context-menu" ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={item.label}
            className="menu-item"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.action();
            }}
          >
            <span className="menu-check">{item.checked ? '✓' : ''}</span>
            <span className="menu-label">{item.label}</span>
            <span className="menu-shortcut">{item.shortcut}</span>
          </button>
        ),
      )}
    </div>
  );
}
