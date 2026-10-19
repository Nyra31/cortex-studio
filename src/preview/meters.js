// Medidores de volumen (vista previa): uno estéreo por pista de audio y el del máster. Leen los picos del
// motor de audio (AudioEngine.levels) en un bucle propio con requestAnimationFrame y tocan el DOM
// directamente: nada se vuelve a dibujar con React.
// Escala en dBFS de −60 a 0 (lo que pasa de 0 dB satura en el render). Caída de 24 dB/s, pico retenido 1,5 s
// y testigo de saturación que se queda encendido hasta que se hace clic en él.

export const METER_MIN_DB = -60;
const FALL_DB_PER_S = 24;
const HOLD_MS = 1500;

let engine = null;
const meters = new Map(); // id (id de pista o 'master') → { bars: [el, el], holds: [el, el], label, clip, state }
let raf = 0;

export const toDb = (peak) => (peak > 0 ? 20 * Math.log10(peak) : -Infinity);
const fraction = (db) => Math.max(0, Math.min(1, (db - METER_MIN_DB) / -METER_MIN_DB));

export function setMeterEngine(e) {
  engine = e;
  start();
}

// Registra los elementos de un medidor; devuelve la función para quitarlo.
export function registerMeter(id, parts) {
  const state = { db: [-Infinity, -Infinity], hold: [-Infinity, -Infinity], holdAt: [0, 0], clipped: false };
  meters.set(id, { ...parts, state });
  start();
  return () => {
    if (meters.get(id)?.bars === parts.bars) meters.delete(id);
  };
}

export function resetClip(id) {
  const m = meters.get(id);
  if (!m) return;
  m.state.clipped = false;
  m.clip?.classList.remove('on');
}

// Solo se toca el DOM si el valor cambia (en silencio, nada).
function put(el, key, value, apply) {
  if (!el || el[key] === value) return;
  el[key] = value;
  apply(value);
}

let last = 0;
function tick(now) {
  raf = requestAnimationFrame(tick);
  const dt = last ? (now - last) / 1000 : 0;
  last = now;
  if (!meters.size) return;
  const levels = engine?.levels() || null;
  for (const [id, m] of meters) {
    const peaks = (id === 'master' ? levels?.master : levels?.tracks.get(id)) || [0, 0];
    const s = m.state;
    for (let c = 0; c < 2; c++) {
      const db = toDb(peaks[c]);
      s.db[c] = Math.max(db, Number.isFinite(s.db[c]) ? s.db[c] - FALL_DB_PER_S * dt : -Infinity);
      if (db >= s.hold[c] || now - s.holdAt[c] > HOLD_MS) {
        s.hold[c] = db;
        s.holdAt[c] = now;
      }
      if (peaks[c] >= 1) s.clipped = true;
      const bar = m.bars[c];
      put(bar, '_w', `${(fraction(s.db[c]) * 100).toFixed(1)}%`, (v) => (bar.style.width = v));
      put(bar, '_c', `meter-fill${s.db[c] > -1 ? ' clip' : s.db[c] > -9 ? ' hot' : ''}`, (v) => (bar.className = v));
      const hold = m.holds?.[c];
      const visible = Number.isFinite(s.hold[c]) && s.hold[c] > METER_MIN_DB;
      put(hold, '_l', visible ? `${(fraction(s.hold[c]) * 100).toFixed(1)}%` : 'none', (v) => {
        hold.style.display = v === 'none' ? 'none' : '';
        if (v !== 'none') hold.style.left = v;
      });
    }
    put(m.clip, '_on', s.clipped, (v) => m.clip.classList.toggle('on', v));
    const top = Math.max(s.hold[0], s.hold[1]);
    put(m.label, '_t', Number.isFinite(top) && top > METER_MIN_DB ? `${top > 0 ? '+' : ''}${top.toFixed(1).replace('.', ',')}` : '-∞', (v) => (m.label.textContent = v));
  }
}

function start() {
  if (!raf) raf = requestAnimationFrame(tick);
}
