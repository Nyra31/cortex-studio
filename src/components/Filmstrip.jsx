import { memo, useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../util/time.js';
import { sourceOffset } from '../state/speed.js';

const MAX_CANVAS = 8000;
const images = new Map(); // ruta de la tira → <img> (compartidas por todos los eventos del mismo medio)

// Miniaturas a lo largo de un evento de video, como en VEGAS: cada una muestra el fotograma del medio que hay en
// ese punto del evento (sigue al punto de entrada, la velocidad y las rampas). strip: tira de miniaturas del medio
// ({ path, step, count, tw, th, cols }, ver filmstrip en electron/ffmpeg.js).
export default memo(function Filmstrip({ strip, inPoint, duration, rate = 1, speed = null, width, height }) {
  const ref = useRef(null);
  const [, setLoaded] = useState(0);
  const w = Math.max(1, Math.min(Math.round(width), MAX_CANVAS));

  let img = images.get(strip.path);
  if (!img) {
    img = new Image();
    img.src = mediaUrl(strip.path);
    images.set(strip.path, img);
  }
  useEffect(() => {
    if (img.complete) return undefined;
    const done = () => setLoaded((n) => n + 1);
    img.addEventListener('load', done);
    return () => img.removeEventListener('load', done);
  }, [img]);

  useEffect(() => {
    const canvas = ref.current;
    const dpr = window.devicePixelRatio || 1;
    const H = Math.round(height * dpr);
    canvas.width = w;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, H);
    if (!img.complete || !img.naturalWidth) return;
    // Ancho de cada miniatura en el lienzo (que se estira a `width` px de pantalla).
    const scaleX = w / width;
    const tw = (strip.tw / strip.th) * height * scaleX;
    const ev = { rate, speed };
    for (let x = 0; x < w; x += tw) {
      const local = ((x + tw / 2) / w) * duration;
      const src = inPoint + sourceOffset(ev, Math.min(duration, local));
      const i = Math.max(0, Math.min(strip.count - 1, Math.round(src / strip.step)));
      const sx = (i % strip.cols) * strip.tw;
      const sy = Math.floor(i / strip.cols) * strip.th;
      ctx.drawImage(img, sx, sy, strip.tw, strip.th, x, 0, tw, H);
    }
  });

  return <canvas ref={ref} className="filmstrip" style={{ height }} />;
});
