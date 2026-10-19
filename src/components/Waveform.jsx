import { memo, useEffect, useRef } from 'react';
import { fadeAt } from '../state/project.js';
import { sourceOffset } from '../state/speed.js';

const MAX_CANVAS = 8000;

// rate: velocidad del evento (dura `duration` en la línea de tiempo y usa duration × rate segundos del medio).
// gain, fadeIn y fadeOut escalan el dibujo para que la forma de onda refleje el volumen del evento.
export default memo(function Waveform({
  peaks, peaksPerSecond, inPoint, duration, rate = 1, speed = null, width, height, gain = 1, fadeIn = 0, fadeOut = 0, curveIn, curveOut,
}) {
  const ref = useRef(null);
  const w = Math.max(1, Math.min(Math.round(width), MAX_CANVAS));

  useEffect(() => {
    const canvas = ref.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w;
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(235, 235, 235, 0.8)';
    const mid = canvas.height / 2;
    // Con rampa de velocidad, cada píxel cubre un trozo distinto del medio.
    const ev = { rate, speed };
    const at = (x) => (inPoint + sourceOffset(ev, (x / w) * duration)) * peaksPerSecond;
    for (let x = 0; x < w; x++) {
      const a = Math.floor(at(x));
      const b = Math.min(peaks.length, Math.max(a + 1, Math.floor(at(x + 1))));
      let max = 0;
      for (let i = a; i < b; i++) if (peaks[i] > max) max = peaks[i];
      const t = ((x + 0.5) / w) * duration;
      const k = gain * fadeAt(t, duration, { fadeIn, fadeOut, curveIn, curveOut });
      const h = Math.max(0.5, (max / 255) * mid * k);
      ctx.fillRect(x, mid - h, 1, h * 2);
    }
  }, [peaks, peaksPerSecond, inPoint, duration, rate, speed, w, height, gain, fadeIn, fadeOut, curveIn, curveOut]);

  return <canvas ref={ref} className="waveform" style={{ height }} />;
});
