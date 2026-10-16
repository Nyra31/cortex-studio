import { useEffect, useRef, useState } from 'react';

// Barra de menús clásica. menus = [{ label, items: [{ label, shortcut, action, disabled, checked } | 'separator'] }]
export default function MenuBar({ menus }) {
  const [open, setOpen] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (open === null) return undefined;
    const onDown = (e) => {
      if (!ref.current.contains(e.target)) setOpen(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menubar" ref={ref}>
      {menus.map((menu, i) => (
        <div key={menu.label} className="menu">
          <button
            className={`menu-title${open === i ? ' open' : ''}`}
            onClick={() => setOpen(open === i ? null : i)}
            onPointerEnter={() => open !== null && setOpen(i)}
          >
            {menu.label}
          </button>
          {open === i && (
            <div className="menu-list">
              {menu.items.map((item, j) =>
                item === 'separator' ? (
                  <div key={j} className="menu-sep" />
                ) : (
                  <button
                    key={item.label}
                    className="menu-item"
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(null);
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
          )}
        </div>
      ))}
    </div>
  );
}
