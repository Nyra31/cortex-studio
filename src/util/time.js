const pad = (n, len = 2) => String(n).padStart(len, '0');

// hh:mm:ss.ff (fotogramas a 30 fps)
export function formatTimecode(t, fps = 30) {
  const frames = Math.floor(Math.max(0, t) * fps + 1e-6);
  const f = frames % fps;
  const s = Math.floor(frames / fps);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}.${pad(f)}`;
}

// m:ss o h:mm:ss, para duraciones cortas en la lista de medios.
export function formatDuration(t) {
  const s = Math.round(Math.max(0, t || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// Etiquetas de la regla; con pasos menores a 1 s se muestran décimas.
export function formatRuler(t, step) {
  const whole = Math.floor(t + 1e-6);
  const base = formatDuration(whole);
  if (step >= 1) return base;
  return `${base}.${Math.round((t - whole) * 10) % 10}`;
}

export const mediaUrl = (filePath) => `media://file/?p=${encodeURIComponent(filePath)}`;
