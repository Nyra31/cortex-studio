import { memo, useEffect, useRef } from 'react';

const MAX_CANVAS = 8000;

// rate: velocidad del evento (dura `duration` en la línea de tiempo y usa duration × rate segundos del medio).
// gain, fadeIn y fadeOut escalan el dibujo para que la forma de onda refleje el volumen del evento.
export default memo(function Waveform({ peaks, peaksPerSecond, inPoint, duration, rate = 1, width, height, gain = 1, fadeIn = 0, fadeOut = 0 }) {
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
    const first = inPoint * peaksPerSecond;
    const perPx = (duration * rate * peaksPerSecond) / w;
    for (let x = 0; x < w; x++) {
      const a = Math.floor(first + x * perPx);
      const b = Math.min(peaks.length, Math.max(a + 1, Math.floor(first + (x + 1) * perPx)));
      let max = 0;
      for (let i = a; i < b; i++) if (peaks[i] > max) max = peaks[i];
      const t = ((x + 0.5) / w) * duration;
      let k = gain;
      if (fadeIn > 0 && t < fadeIn) k *= t / fadeIn;
      if (fadeOut > 0 && t > duration - fadeOut) k *= Math.max(0, (duration - t) / fadeOut);
      const h = Math.max(0.5, (max / 255) * mid * k);
      ctx.fillRect(x, mid - h, 1, h * 2);
    }
  }, [peaks, peaksPerSecond, inPoint, duration, rate, w, height, gain, fadeIn, fadeOut]);

  return <canvas ref={ref} className="waveform" style={{ height }} />;
});
