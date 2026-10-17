// Compositor de la vista previa con WebGL2: dibuja las capas de video (con fundidos y transiciones)
// igual que el render de FFmpeg. Las transiciones son traducciones directas de las de xfade
// (libavfilter/vf_xfade.c): P va de 1 (solo A, el evento que sale) a 0 (solo B, el que entra),
// x/y en píxeles del proyecto con el origen arriba a la izquierda, y mixx(a, b, m) = a·m + b·(1−m).
import { TRANSITIONS } from '../state/transitions.js';

const GLSL = {
  fade: 'return mixx(A(uv), B(uv), P);',
  fadeblack: 'return mixx(mixx(A(uv), vec3(0.0), smoothstep(0.8, 1.0, P)), mixx(vec3(0.0), B(uv), smoothstep(0.2, 1.0, P)), P);',
  fadewhite: 'return mixx(mixx(A(uv), vec3(1.0), smoothstep(0.8, 1.0, P)), mixx(vec3(1.0), B(uv), smoothstep(0.2, 1.0, P)), P);',
  dissolve: 'return frand(floor(px)) * 2.0 + P * 2.0 - 1.5 >= 0.5 ? A(uv) : B(uv);',
  wipeleft: 'return x > W * P ? B(uv) : A(uv);',
  wiperight: 'return x > W * (1.0 - P) ? A(uv) : B(uv);',
  wipeup: 'return y > H * P ? B(uv) : A(uv);',
  wipedown: 'return y > H * (1.0 - P) ? A(uv) : B(uv);',
  smoothleft: 'return mixx(B(uv), A(uv), smoothstep(0.0, 1.0, 1.0 + x / W - P * 2.0));',
  smoothright: 'return mixx(B(uv), A(uv), smoothstep(0.0, 1.0, 1.0 + (W - 1.0 - x) / W - P * 2.0));',
  smoothup: 'return mixx(B(uv), A(uv), smoothstep(0.0, 1.0, 1.0 + y / H - P * 2.0));',
  smoothdown: 'return mixx(B(uv), A(uv), smoothstep(0.0, 1.0, 1.0 + (H - 1.0 - y) / H - P * 2.0));',
  diagtl: 'return mixx(B(uv), A(uv), smoothstep(0.0, 1.0, 1.0 + x / W * y / H - P * 2.0));',
  diagtr: 'return mixx(B(uv), A(uv), smoothstep(0.0, 1.0, 1.0 + (W - 1.0 - x) / W * y / H - P * 2.0));',
  diagbl: 'return mixx(B(uv), A(uv), smoothstep(0.0, 1.0, 1.0 + x / W * (H - 1.0 - y) / H - P * 2.0));',
  diagbr: 'return mixx(B(uv), A(uv), smoothstep(0.0, 1.0, 1.0 + (W - 1.0 - x) / W * (H - 1.0 - y) / H - P * 2.0));',
  wipetl: 'return (y <= H * P && x <= W * P) ? A(uv) : B(uv);',
  wipetr: 'return (y <= H * P && x > W - W * P) ? A(uv) : B(uv);',
  wipebl: 'return (y > H - H * P && x <= W * P) ? A(uv) : B(uv);',
  wipebr: 'return (y > H - H * P && x > W - W * P) ? A(uv) : B(uv);',
  radial: 'return mixx(B(uv), A(uv), smoothstep(0.0, 1.0, atan(x - W / 2.0, y - H / 2.0) - (P - 0.5) * (PI * 2.5)));',
  circleopen: 'return mixx(A(uv), B(uv), smoothstep(0.0, 1.0, length(px - F / 2.0) / length(F / 2.0) + (P - 0.5) * 3.0));',
  circleclose: 'return mixx(A(uv), B(uv), smoothstep(0.0, 1.0, 1.0 - length(px - F / 2.0) / length(F / 2.0) + (P - 0.5) * 3.0));',
  circlecrop: `float z = pow(2.0 * abs(P - 0.5), 3.0) * length(F / 2.0);
    return z < length(px - F / 2.0) ? vec3(0.0) : (P < 0.5 ? B(uv) : A(uv));`,
  rectcrop: `vec2 z = abs(P - 0.5) * F;
    bool inside = abs(x - W / 2.0) < z.x && abs(y - H / 2.0) < z.y;
    return !inside ? vec3(0.0) : (P < 0.5 ? B(uv) : A(uv));`,
  vertopen: 'return mixx(B(uv), A(uv), smoothstep(0.0, 1.0, 2.0 - abs((x - W / 2.0) / (W / 2.0)) - P * 2.0));',
  vertclose: 'return mixx(B(uv), A(uv), smoothstep(0.0, 1.0, 1.0 + abs((x - W / 2.0) / (W / 2.0)) - P * 2.0));',
  horzopen: 'return mixx(B(uv), A(uv), smoothstep(0.0, 1.0, 2.0 - abs((y - H / 2.0) / (H / 2.0)) - P * 2.0));',
  horzclose: 'return mixx(B(uv), A(uv), smoothstep(0.0, 1.0, 1.0 + abs((y - H / 2.0) / (H / 2.0)) - P * 2.0));',
  slideleft: 'float z = x - P * W; return z >= 0.0 ? Bp(vec2(z, y)) : Ap(vec2(z + W, y));',
  slideright: 'float z = x + P * W; return z < W ? Bp(vec2(z, y)) : Ap(vec2(z - W, y));',
  slideup: 'float z = y - P * H; return z >= 0.0 ? Bp(vec2(x, z)) : Ap(vec2(x, z + H));',
  slidedown: 'float z = y + P * H; return z < H ? Bp(vec2(x, z)) : Ap(vec2(x, z - H));',
  coverleft: 'float z = x - P * W; return z >= 0.0 ? Bp(vec2(z, y)) : A(uv);',
  coverright: 'float z = x + P * W; return z < W ? Bp(vec2(z, y)) : A(uv);',
  coverup: 'float z = y - P * H; return z >= 0.0 ? Bp(vec2(x, z)) : A(uv);',
  coverdown: 'float z = y + P * H; return z < H ? Bp(vec2(x, z)) : A(uv);',
  revealleft: 'float z = x - P * W; return z >= 0.0 ? B(uv) : Ap(vec2(z + W, y));',
  revealright: 'float z = x + P * W; return z < W ? B(uv) : Ap(vec2(z - W, y));',
  revealup: 'float z = y - P * H; return z >= 0.0 ? B(uv) : Ap(vec2(x, z + H));',
  revealdown: 'float z = y + P * H; return z < H ? B(uv) : Ap(vec2(x, z - H));',
  hlslice: 'float s = smoothstep(-0.5, 0.0, x / W - P * 1.5); return s <= fract(10.0 * y / H) ? A(uv) : B(uv);',
  hrslice: 'float s = smoothstep(-0.5, 0.0, (W - 1.0 - x) / W - P * 1.5); return s <= fract(10.0 * y / H) ? A(uv) : B(uv);',
  vuslice: 'float s = smoothstep(-0.5, 0.0, y / H - P * 1.5); return s <= fract(10.0 * x / W) ? A(uv) : B(uv);',
  vdslice: 'float s = smoothstep(-0.5, 0.0, (H - 1.0 - y) / H - P * 1.5); return s <= fract(10.0 * x / W) ? A(uv) : B(uv);',
  squeezeh: `float z = 0.5 + (y / H - 0.5) / max(P, 1e-4);
    return (z < 0.0 || z > 1.0) ? B(uv) : A(vec2(uv.x, z));`,
  squeezev: `float z = 0.5 + (x / W - 0.5) / max(P, 1e-4);
    return (z < 0.0 || z > 1.0) ? B(uv) : A(vec2(z, uv.y));`,
  zoomin: 'return mixx(A((uv - 0.5) * smoothstep(0.5, 1.0, P) + 0.5), B(uv), smoothstep(0.0, 0.5, P));',
  pixelize: `float d = ceil(min(P, 1.0 - P) * 50.0) / 50.0;
    float sq = 2.0 * d * min(W, H) / 20.0;
    vec2 s = d > 0.0 ? min((floor(px / sq) + 0.5) * sq, F - 1.0) : px;
    return mixx(Ap(s), Bp(s), P);`,
};

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const transitionCases = [...TRANSITIONS.values()]
  .filter((t) => GLSL[t.id])
  .map((t) => `  if (uType == ${t.index}) { ${GLSL[t.id]} }`)
  .join('\n');

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uA;
uniform sampler2D uB;
uniform vec2 uScaleA;   // tamaño de la imagen encajada respecto al cuadro (bandas negras fuera)
uniform vec2 uScaleB;
uniform bool uHasA;
uniform bool uHasB;
uniform vec2 uFrame;    // resolución del proyecto
uniform bool uTransition;
uniform int uType;
uniform float uP;
uniform float uOpacity;
const float PI = 3.14159265358979;

vec3 fit(sampler2D t, vec2 s, bool has, vec2 uv) {
  vec2 q = (uv - 0.5) / s + 0.5;
  if (!has || q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec3(0.0);
  return texture(t, q).rgb;
}
vec3 A(vec2 uv) { return fit(uA, uScaleA, uHasA, uv); }
vec3 B(vec2 uv) { return fit(uB, uScaleB, uHasB, uv); }
vec3 Ap(vec2 p) { return A(p / uFrame); }
vec3 Bp(vec2 p) { return B(p / uFrame); }
vec3 mixx(vec3 a, vec3 b, float m) { return a * m + b * (1.0 - m); }
float frand(vec2 p) { return fract(sin(p.x * 12.9898 + p.y * 78.233) * 43758.545); }

vec3 transition(vec2 uv) {
  float P = uP;
  vec2 F = uFrame;
  vec2 px = uv * F;
  float x = px.x, y = px.y, W = F.x, H = F.y;
${transitionCases}
  return mixx(A(uv), B(uv), P);
}

void main() {
  vec3 c = uTransition ? transition(vUv) : A(vUv);
  outColor = vec4(c * uOpacity, uOpacity);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

const sourceSize = (el) =>
  el instanceof HTMLVideoElement ? [el.videoWidth, el.videoHeight]
    : el instanceof HTMLImageElement ? [el.naturalWidth, el.naturalHeight]
      : [el.width, el.height];

const isReady = (el) =>
  el instanceof HTMLVideoElement ? el.readyState >= 2 && el.videoWidth > 0
    : el instanceof HTMLImageElement ? el.complete && el.naturalWidth > 0
      : el.width > 0;

export class Compositor {
  constructor(canvas, { preserveDrawingBuffer = false } = {}) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer });
    if (!gl) throw new Error('WebGL2 no está disponible');
    this.gl = gl;
    this.canvas = canvas;
    this.textures = new WeakMap(); // elemento → { tex, still } (still: imagen ya subida)

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    this.u = {};
    for (const name of ['uA', 'uB', 'uScaleA', 'uScaleB', 'uHasA', 'uHasB', 'uFrame', 'uTransition', 'uType', 'uP', 'uOpacity']) {
      this.u[name] = gl.getUniformLocation(program, name);
    }
    gl.uniform1i(this.u.uA, 0);
    gl.uniform1i(this.u.uB, 1);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // colores premultiplicados
  }

  resize(width, height) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  // Sube el fotograma actual del elemento a su textura en la unidad indicada. Devuelve la escala de encaje o null.
  bind(el, unit, frame) {
    const gl = this.gl;
    if (!el || !isReady(el)) return null;
    gl.activeTexture(gl.TEXTURE0 + unit); // antes de crear la textura, para no pisar la de la otra unidad
    let entry = this.textures.get(el);
    if (!entry) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      entry = { tex, still: false };
      this.textures.set(el, entry);
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    if (!entry.still) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      entry.still = el instanceof HTMLImageElement;
    }
    const [w, h] = sourceSize(el);
    const frameAspect = frame.width / frame.height;
    const aspect = w / h;
    return aspect > frameAspect ? [1, frameAspect / aspect] : [aspect / frameAspect, 1];
  }

  // layers: de abajo a arriba. { a, opacity } o { a, b, type (índice), progress (P de xfade) }.
  render(frame, layers) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.u.uFrame, frame.width, frame.height);
    for (const layer of layers) {
      const scaleA = this.bind(layer.a, 0, frame);
      const scaleB = layer.b !== undefined ? this.bind(layer.b, 1, frame) : null;
      gl.uniform1i(this.u.uHasA, scaleA ? 1 : 0);
      gl.uniform1i(this.u.uHasB, scaleB ? 1 : 0);
      if (scaleA) gl.uniform2f(this.u.uScaleA, ...scaleA);
      if (scaleB) gl.uniform2f(this.u.uScaleB, ...scaleB);
      const transition = layer.b !== undefined;
      gl.uniform1i(this.u.uTransition, transition ? 1 : 0);
      gl.uniform1i(this.u.uType, transition ? layer.type : 0);
      gl.uniform1f(this.u.uP, transition ? layer.progress : 1);
      gl.uniform1f(this.u.uOpacity, transition ? 1 : layer.opacity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }
}
