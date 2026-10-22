// Enlace entre la vista previa y los monitores de video (Scopes.jsx): mientras hay un monitor abierto, la vista
// previa lee una copia pequeña de cada fotograma que dibuja (Compositor.readScope) y se la pasa. Reproduciendo,
// como mucho unas 15 veces por segundo; en pausa, cada fotograma (solo se dibuja cuando algo cambia).
let listener = null;
let pending = false; // el monitor acaba de abrirse: hace falta un fotograma aunque nada haya cambiado
let last = 0;

export function setScopeListener(fn) {
  listener = fn;
  pending = !!fn;
}

export const scopeNeedsFrame = () => pending;

export function scopeWanted(playing) {
  return !!listener && (!playing || pending || performance.now() - last > 66);
}

export function publishScope(data) {
  last = performance.now();
  pending = false;
  listener?.(data);
}
