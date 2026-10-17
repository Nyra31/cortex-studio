// Efectos de video en la vista previa: cada efecto de state/effects.js se traduce a una o varias
// pasadas de shader sobre la imagen encajada (sin bandas negras), con las mismas fórmulas que el
// filtro de FFmpeg que usa el render. Las ejecuta Compositor.applyEffects.
//
// Pasada = { code, uniforms }: code es el cuerpo de `vec4 fx(vec2 uv)`; puede leer uPrev (resultado de
// la pasada anterior), uSrc (imagen que entró al efecto) y uSize (tamaño en px). Los colores van sin
// premultiplicar y el canal alfa se conserva (lo crea el croma).
import { blurSigma, pixelBlock, sepiaMatrix } from '../state/effects.js';

// Conversión RGB ↔ YUV de rango limitado (BT.601), la que usa FFmpeg al pasar una imagen a yuv420p:
// los filtros eq, hue y vignette trabajan sobre esos valores.
export const GLSL_HELPERS = `
vec3 toYuv(vec3 c) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  return vec3((16.0 + 219.0 * y) / 255.0, (128.0 + 224.0 * (c.b - y) / 1.772) / 255.0, (128.0 + 224.0 * (c.r - y) / 1.402) / 255.0);
}
vec3 toRgb(vec3 q) {
  float y = (q.x * 255.0 - 16.0) / 219.0;
  float cb = (q.y * 255.0 - 128.0) / 224.0;
  float cr = (q.z * 255.0 - 128.0) / 224.0;
  return clamp(vec3(y + 1.402 * cr, y - 0.344136 * cb - 0.714136 * cr, y + 1.772 * cb), 0.0, 1.0);
}
// Filtro hue de FFmpeg: gira y escala la crominancia y suma al brillo.
vec3 hueFilter(vec3 c, float angle, float sat, float bright) {
  vec3 q = toYuv(c);
  vec2 uv = q.yz - 128.0 / 255.0;
  float cs = cos(angle) * sat, sn = sin(angle) * sat;
  q.yz = vec2(cs * uv.x - sn * uv.y, sn * uv.x + cs * uv.y) + 128.0 / 255.0;
  q.x = clamp(q.x + bright, 0.0, 1.0);
  return toRgb(clamp(q, 0.0, 1.0));
}
`;

const blurPasses = (sx, sy) =>
  [
    [sx, [1, 0]],
    [sy, [0, 1]],
  ]
    .filter(([s]) => s >= 0.05)
    .map(([sigma, dir]) => ({
      code: `
        float r = ceil(uSigma * 3.0);
        float stepPx = max(1.0, r / 48.0);
        vec4 acc = vec4(0.0);
        float wsum = 0.0;
        for (int i = -48; i <= 48; i++) {
          float o = float(i) * stepPx;
          if (abs(o) > r) continue;
          float w = exp(-0.5 * o * o / (uSigma * uSigma));
          acc += texture(uPrev, uv + uDir * o / uSize) * w;
          wsum += w;
        }
        return acc / wsum;`,
      uniforms: { uSigma: sigma, uDir: dir },
    }));

const PASSES = {
  brightness: (p) => [{
    code: `
      vec4 c = texture(uPrev, uv);
      vec3 q = toYuv(c.rgb);
      q.x = clamp(uContrast * (q.x - 0.5) + 0.5 + uBrightness, 0.0, 1.0);
      return vec4(toRgb(q), c.a);`,
    uniforms: { uBrightness: p.brightness, uContrast: 1 + p.contrast },
  }],
  colorcorrect: (p) => [{
    code: `
      vec4 c = texture(uPrev, uv);
      vec3 rgb = clamp(c.rgb * uGain, 0.0, 1.0);
      return vec4(uSat == 1.0 ? rgb : hueFilter(rgb, 0.0, uSat, 0.0), c.a);`,
    uniforms: { uGain: [p.red, p.green, p.blue], uSat: p.saturation },
  }],
  hsl: (p) => [{
    code: `
      vec4 c = texture(uPrev, uv);
      return vec4(hueFilter(c.rgb, uHue, uSat, uBright), c.a);`,
    uniforms: { uHue: (p.hue * Math.PI) / 180, uSat: p.saturation, uBright: p.lightness },
  }],
  blackwhite: (p) => [{
    code: `
      vec4 c = texture(uPrev, uv);
      return vec4(hueFilter(c.rgb, 0.0, 1.0 - uAmount, 0.0), c.a);`,
    uniforms: { uAmount: p.amount },
  }],
  sepia: (p) => {
    const m = sepiaMatrix(p.amount);
    return [{
      code: `
        vec4 c = texture(uPrev, uv);
        return vec4(clamp(vec3(dot(uR, c.rgb), dot(uG, c.rgb), dot(uB, c.rgb)), 0.0, 1.0), c.a);`,
      uniforms: { uR: m.slice(0, 3), uG: m.slice(3, 6), uB: m.slice(6, 9) },
    }];
  },
  invert: (p) => [{
    code: `
      vec4 c = texture(uPrev, uv);
      return vec4(mix(c.rgb, 1.0 - c.rgb, uAmount), c.a);`,
    uniforms: { uAmount: p.amount },
  }],
  blur: (p, ctx) => blurPasses(blurSigma(p.horizontal, ctx.h), blurSigma(p.vertical, ctx.h)),
  // unsharp de FFmpeg solo sobre la luminancia: Y + cantidad · (Y − media de la caja).
  sharpen: (p, ctx) => [{
    code: `
      vec4 c = texture(uPrev, uv);
      float y = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      float sum = 0.0;
      float cnt = 0.0;
      for (int j = -11; j <= 11; j++) {
        for (int i = -11; i <= 11; i++) {
          if (abs(float(i)) > uRadius || abs(float(j)) > uRadius) continue;
          sum += dot(texture(uPrev, uv + vec2(float(i), float(j)) / uSize).rgb, vec3(0.299, 0.587, 0.114));
          cnt += 1.0;
        }
      }
      return vec4(clamp(c.rgb + uAmount * (y - sum / cnt), 0.0, 1.0), c.a);`,
    uniforms: { uAmount: p.amount * 2, uRadius: Math.max(1, Math.floor((Math.max(3, Math.round(ctx.h * 0.005) | 1)) / 2)) },
  }],
  glow: (p, ctx) => [
    {
      code: `
        vec4 c = texture(uPrev, uv);
        vec3 v = floor(c.rgb * 255.0 + 0.5);
        return vec4(mix(vec3(0.0), c.rgb, step(uThreshold + 0.5, v)), c.a);`,
      uniforms: { uThreshold: Math.round(p.threshold * 255) },
    },
    ...blurPasses(...Array(2).fill(Math.max(0.05, blurSigma(p.radius, ctx.h)))),
    {
      code: `
        vec4 a = texture(uSrc, uv);
        vec3 b = texture(uPrev, uv).rgb;
        vec3 screen = 1.0 - (1.0 - a.rgb) * (1.0 - b);
        return vec4(a.rgb + (screen - a.rgb) * uIntensity, a.a);`,
      uniforms: { uIntensity: p.intensity },
    },
  ],
  // pixelize de FFmpeg (modo media): bloques desde la esquina superior izquierda de la imagen.
  pixelate: (p, ctx) => [{
    code: `
      vec2 px = uv * uSize;
      vec2 b0 = floor(px / uBlock) * uBlock;
      vec2 b1 = min(b0 + uBlock, uSize);
      vec4 acc = vec4(0.0);
      for (int j = 0; j < 4; j++) {
        for (int i = 0; i < 4; i++) {
          acc += texture(uPrev, (b0 + (vec2(float(i), float(j)) + 0.5) / 4.0 * (b1 - b0)) / uSize);
        }
      }
      return acc / 16.0;`,
    uniforms: { uBlock: pixelBlock(p.size, ctx.h) },
  }],
  // vignette de FFmpeg: factor cos(ángulo · d)^4, con d = distancia al centro / semidiagonal.
  vignette: (p) => [{
    code: `
      vec4 c = texture(uPrev, uv);
      vec2 d = (uv - 0.5) * uSize;
      float dn = length(d) / length(uSize * 0.5);
      float k = cos(uAngle * dn);
      float f = dn > 1.0 ? 0.0 : k * k * k * k;
      return vec4(c.rgb * f, c.a);`,
    uniforms: { uAngle: (p.amount * Math.PI) / 2 },
  }],
  mirror: (p) => [{
    code: `return texture(uPrev, vec2(uFlip.x > 0.5 ? 1.0 - uv.x : uv.x, uFlip.y > 0.5 ? 1.0 - uv.y : uv.y));`,
    uniforms: { uFlip: [p.horizontal ? 1 : 0, p.vertical ? 1 : 0] },
  }],
  // colorkey de FFmpeg: distancia RGB al color, normalizada; transparente por debajo de la similitud.
  chromakey: (p) => {
    const hex = p.color.replace('#', '');
    const key = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return [{
      code: `
        vec4 c = texture(uPrev, uv);
        float diff = length(c.rgb - uKey) / sqrt(3.0);
        float a = uBlend > 0.0001 ? clamp((diff - uSimilarity) / uBlend, 0.0, 1.0) : (diff > uSimilarity ? 1.0 : 0.0);
        return vec4(c.rgb, c.a * a);`,
      uniforms: { uKey: key, uSimilarity: p.similarity, uBlend: p.blend },
    }];
  },
};

// Pasadas de un efecto (con sus parámetros ya completos) para una imagen de ctx = { w, h } píxeles.
export function effectPasses(fx, ctx) {
  const make = PASSES[fx.type];
  return make ? make(fx.params, ctx) : [];
}
