import { useRef } from 'react';
import { textBounds } from '../state/text.js';

const SNAP_PX = 6; // al moverlo, el centro del texto se pega al centro del cuadro (Mayús: sin ajuste)
const CORNERS = ['nw', 'ne', 'sw', 'se'];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Capa sobre la vista previa para colocar los textos con el ratón (en pausa). items: textos visibles en el
// instante actual, del de más arriba al de más abajo ({ event, media }); target: el que muestra el recuadro
// (el seleccionado o el de la ventana de texto abierta). Clic en un texto: lo selecciona y se puede arrastrar;
// las esquinas del recuadro cambian el tamaño; doble clic abre su ventana. width/height: tamaño del proyecto.
export default function TextOverlay({ items, target, width, height, onSelect, onChange, onEdit }) {
  const ref = useRef(null);
  if (!items.length) return null;
  const boxOf = (item) => textBounds(item.media.text, width, height);
  const inside = (b, x, y) => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height;

  // Arrastre: cada movimiento llama a update(rect, evento); el primer cambio crea el paso de deshacer.
  const drag = (e, update) => {
    const rect = ref.current.getBoundingClientRect();
    let first = true;
    const move = (me) => {
      const changes = update(rect, me);
      if (!changes) return;
      onChange(changes.mediaId, (t) => ({ ...t, ...changes.values }), first);
      first = false;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onDown = (e) => {
    if (e.button !== 0) return;
    const rect = ref.current.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const hit = target && inside(boxOf(target), fx, fy) ? target : items.find((it) => inside(boxOf(it), fx, fy));
    if (!hit) return;
    e.preventDefault();
    if (hit !== target) onSelect(hit.event.id);
    const { x, y } = hit.media.text;
    drag(e, (r, me) => {
      if (Math.abs(me.clientX - e.clientX) < 2 && Math.abs(me.clientY - e.clientY) < 2) return null;
      let nx = x + (me.clientX - e.clientX) / r.width;
      let ny = y + (me.clientY - e.clientY) / r.height;
      if (!me.shiftKey && Math.abs(nx - 0.5) * r.width < SNAP_PX) nx = 0.5;
      if (!me.shiftKey && Math.abs(ny - 0.5) * r.height < SNAP_PX) ny = 0.5;
      return { mediaId: hit.media.id, values: { x: clamp(nx, 0, 1), y: clamp(ny, 0, 1) } };
    });
  };

  // Esquinas: el tamaño cambia según cuánto se aleja el puntero del centro del texto (el centro no se mueve).
  const onCorner = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const { x, y, size } = target.media.text;
    drag(e, (r, me) => {
      const cx = r.left + x * r.width;
      const cy = r.top + y * r.height;
      const d0 = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
      const d = Math.hypot(me.clientX - cx, me.clientY - cy);
      return { mediaId: target.media.id, values: { size: Math.round(clamp((size * d) / d0, 0.01, 1) * 1000) / 1000 } };
    });
  };

  const box = target && boxOf(target);
  return (
    <div
      ref={ref}
      className="text-overlay"
      onPointerDown={onDown}
      onDoubleClick={(e) => {
        const rect = ref.current.getBoundingClientRect();
        const fx = (e.clientX - rect.left) / rect.width;
        const fy = (e.clientY - rect.top) / rect.height;
        const hit = items.find((it) => inside(boxOf(it), fx, fy));
        if (hit) {
          e.stopPropagation(); // en un texto, el doble clic lo edita (fuera, pone la vista previa a pantalla completa)
          onEdit(hit.media.id);
        }
      }}
    >
      {box && (
        <div
          className="text-box"
          title="Arrastra para mover el texto (Mayús: sin ajuste al centro); las esquinas cambian el tamaño; doble clic: editar"
          style={{
            left: `${box.left * 100}%`,
            top: `${box.top * 100}%`,
            width: `${box.width * 100}%`,
            height: `${box.height * 100}%`,
          }}
        >
          {CORNERS.map((c) => (
            <div key={c} className={`text-corner ${c}`} onPointerDown={onCorner} />
          ))}
        </div>
      )}
    </div>
  );
}
