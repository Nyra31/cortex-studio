import { memo, useEffect, useRef } from 'react';

const MAX_CANVAS = 8000;

export default memo(function Waveform({ peaks, peaksPerSecond, inPoint, duration, width, height }) {
  const ref = useRef(null);
  const w = Math.max(1, Math.min(Math.round(width), MAX_CANVAS));

  useEffect(() => {
    const canvas = ref.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w;
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(178, 238, 205, 0.85)';
    const mid = canvas.height / 2;
    const first = inPoint * peaksPerSecond;
    const perPx = (duration * peaksPerSecond) / w;
    for (let x = 0; x < w; x++) {
      const a = Math.floor(first + x * perPx);
      const b = Math.min(peaks.length, Math.max(a + 1, Math.floor(first + (x + 1) * perPx)));
      let max = 0;
      for (let i = a; i < b; i++) if (peaks[i] > max) max = peaks[i];
      const h = Math.max(0.5, (max / 255) * mid);
      ctx.fillRect(x, mid - h, 1, h * 2);
    }
  }, [peaks, peaksPerSecond, inPoint, duration, w, height]);

  return <canvas ref={ref} className="waveform" style={{ height }} />;
});
