import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BUNDLED_FONTS, installedFonts, isBundledFont } from '../state/fonts.js';
import { TEXT_FONTS } from '../state/text.js';

const fontCss = (family) => `"${family}", sans-serif`;

// Selector de fuente: cada nombre se ve con su fuente. Primero las incluidas con Cortex Studio (por
// categorías), luego las instaladas en el equipo. Con buscador; también se puede escribir cualquier nombre.
export default function FontPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [system, setSystem] = useState(null);
  const [pos, setPos] = useState(null);
  const button = useRef(null);
  const panel = useRef(null);
  const search = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    installedFonts().then((list) => setSystem(list || TEXT_FONTS.filter((f) => !isBundledFont(f))));
    const onDown = (e) => {
      if (!panel.current?.contains(e.target) && !button.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  // La lista va fuera de la ventana del texto (que tiene barra de desplazamiento), pegada al botón.
  useLayoutEffect(() => {
    if (!open) return;
    const r = button.current.getBoundingClientRect();
    const height = Math.min(420, window.innerHeight - 40);
    const top = r.bottom + height + 8 < window.innerHeight ? r.bottom + 2 : Math.max(8, r.top - height - 2);
    setPos({ left: r.left, top, width: Math.max(260, r.width), height });
    search.current?.focus();
  }, [open]);

  const choose = (family) => {
    onChange(family);
    setOpen(false);
    setQuery('');
  };
  const q = query.trim().toLowerCase();
  const match = (f) => !q || f.toLowerCase().includes(q);
  const categories = [...new Set(BUNDLED_FONTS.map((f) => f.category))];
  const systemList = (system || []).filter(match);
  const firstMatch = BUNDLED_FONTS.find((f) => match(f.family))?.family || systemList[0];
  // Ninguna coincide: se ofrece usar el nombre escrito (una fuente que no aparezca en la lista).
  const typed = q && !firstMatch ? query.trim() : null;

  return (
    <>
      <button
        ref={button}
        className="font-picker-btn"
        style={{ fontFamily: fontCss(value) }}
        title="Fuente del texto"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{value}</span>
        <span className="font-picker-arrow">▾</span>
      </button>
      {open && pos && (
        <div ref={panel} className="font-picker" style={pos}>
          <input
            ref={search}
            className="font-picker-search"
            placeholder="Buscar fuente…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation(); // que las teclas no lleguen a los atajos del editor
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'Enter' && q) choose(firstMatch || query.trim());
            }}
          />
          <div className="font-picker-list">
            {typed && (
              <button className="font-picker-item" onClick={() => choose(typed)}>
                Usar «{typed}»
              </button>
            )}
            {categories.map((cat) => {
              const fonts = BUNDLED_FONTS.filter((f) => f.category === cat && match(f.family));
              if (!fonts.length) return null;
              return (
                <div key={cat}>
                  <div className="font-picker-group">{cat}</div>
                  {fonts.map((f) => (
                    <button
                      key={f.family}
                      className={`font-picker-item${f.family === value ? ' active' : ''}`}
                      style={{ fontFamily: fontCss(f.family) }}
                      onClick={() => choose(f.family)}
                    >
                      {f.family}
                    </button>
                  ))}
                </div>
              );
            })}
            {systemList.length > 0 && (
              <div>
                <div className="font-picker-group">Instaladas en este equipo (pueden faltar en otros)</div>
                {systemList.map((f) => (
                  <button
                    key={f}
                    className={`font-picker-item${f === value ? ' active' : ''}`}
                    style={{ fontFamily: fontCss(f) }}
                    onClick={() => choose(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
            {system === null && <div className="font-picker-group">Buscando las fuentes instaladas…</div>}
          </div>
        </div>
      )}
    </>
  );
}
