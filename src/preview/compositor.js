// Compositor de la vista previa con WebGL2: dibuja las capas de video (con fundidos, transiciones y efectos)
// igual que el render de FFmpeg. Las transiciones son traducciones directas de las de xfade
// (libavfilter/vf_xfade.c): P va de 1 (solo A, el evento que sale) a 0 (solo B, el que entra),
// x/y en píxeles del proyecto con el origen arriba a la izquierda, y mixx(a, b, m) = a·m + b·(1−m).
import { TRANSITIONS } from '../state/transitions.js';
import { GLSL_HELPERS, effectPasses } from './effects-gl.js';

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
uniform bool uPanOnA;   // panorámica/recorte del evento (ver state/pan.js)
uniform bool uPanOnB;
uniform vec4 uPanA;     // centro x, y (fracción del cuadro), escala, giro (radianes, sentido horario)
uniform vec4 uPanB;
uniform vec4 uCropA;    // recorte izquierda, arriba, derecha, abajo (fracciones de la imagen)
uniform vec4 uCropB;
const float PI = 3.14159265358979;

// Imagen encajada en el cuadro; fuera de ella (bandas) negro opaco. Dentro conserva el alfa (croma).
// Con panorámica: el punto q de la imagen (px del cuadro, desde su centro) se dibuja en P + S·R·q, así que
// se deshace esa transformación; lo que queda fuera de la imagen (o recortado) es transparente, como en el render.
vec4 fit(sampler2D t, vec2 s, bool has, vec2 uv, bool panOn, vec4 pan, vec4 crop) {
  if (panOn) {
    vec2 d = (uv - pan.xy) * uFrame;
    float c = cos(pan.w), sn = sin(pan.w);
    vec2 q = vec2(c * d.x + sn * d.y, -sn * d.x + c * d.y) / pan.z;
    vec2 qi = (q / uFrame) / s + 0.5;
    if (!has || qi.x < crop.x || qi.y < crop.y || qi.x > 1.0 - crop.z || qi.y > 1.0 - crop.w) return vec4(0.0);
    return texture(t, qi);
  }
  vec2 q = (uv - 0.5) / s + 0.5;
  if (!has || q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
  return texture(t, q);
}
vec4 fitA(vec2 uv) { return fit(uA, uScaleA, uHasA, uv, uPanOnA, uPanA, uCropA); }
vec4 fitB(vec2 uv) { return fit(uB, uScaleB, uHasB, uv, uPanOnB, uPanB, uCropB); }
// En las transiciones (opacas, como xfade en yuv420p) se pierde el alfa: fuera de la imagen panorámica, negro.
vec3 A(vec2 uv) { return fitA(uv).rgb; }
vec3 B(vec2 uv) { return fitB(uv).rgb; }
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
  if (uTransition) {
    outColor = vec4(transition(vUv), 1.0); // como xfade en yuv420p: la transición es opaca
  } else {
    vec4 c = fitA(vUv);
    float a = c.a * uOpacity;
    outColor = vec4(c.rgb * a, a);
  }
}`;

// Pasadas de efectos: dibujan en un búfer del tamaño de la imagen encajada, con la fila 0 arriba
// (igual que las texturas de video), para que todas las texturas tengan la misma orientación.
const FX_VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const uniformType = (v) => (Array.isArray(v) ? `vec${v.length}` : 'float');

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function link(gl, vertex, fragment) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}

const sourceSize = (el) =>
  el instanceof HTMLVideoElement ? [el.videoWidth, el.videoHeight]
    : el instanceof HTMLImageElement ? [el.naturalWidth, el.naturalHeight]
      : [el.width, el.height];

const isReady = (el) =>
  el instanceof HTMLVideoElement ? el.readyState >= 2 && el.videoWidth > 0
    : el instanceof HTMLImageElement ? el.complete && el.naturalWidth > 0
      : el.width > 0;

function setupTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

const SCRATCH = 7; // unidad de textura para subir y crear texturas sin tocar las que están en uso

export class Compositor {
  constructor(canvas, { preserveDrawingBuffer = false } = {}) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer });
    if (!gl) throw new Error('WebGL2 no está disponible');
    this.gl = gl;
    this.canvas = canvas;
    this.textures = new WeakMap(); // elemento → { tex, still } (still: imagen ya subida)
    this.fxPrograms = new Map(); // código de la pasada → { program, loc }
    this.pool = []; // búferes intermedios de los efectos: { fbo, tex, w, h, busy }

    this.program = link(gl, VERTEX, FRAGMENT);
    gl.useProgram(this.program);
    this.u = {};
    for (const name of [
      'uA', 'uB', 'uScaleA', 'uScaleB', 'uHasA', 'uHasB', 'uFrame', 'uTransition', 'uType', 'uP', 'uOpacity',
      'uPanOnA', 'uPanOnB', 'uPanA', 'uPanB', 'uCropA', 'uCropB',
    ]) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }
    gl.uniform1i(this.u.uA, 0);
    gl.uniform1i(this.u.uB, 1);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // colores premultiplicados
  }

  resize(width, height) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  // Sube el fotograma actual del elemento a su textura. Las imágenes y los canvas (textos) solo una vez,
  // salvo que cambie su cortexVersion (el texto se ha vuelto a dibujar). Devuelve { tex, w, h } o null.
  upload(el) {
    const gl = this.gl;
    if (!el || !isReady(el)) return null;
    gl.activeTexture(gl.TEXTURE0 + SCRATCH);
    let entry = this.textures.get(el);
    if (!entry) {
      entry = { tex: setupTexture(gl), still: false };
      this.textures.set(el, entry);
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    if (!entry.still || entry.version !== el.cortexVersion) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      entry.still = !(el instanceof HTMLVideoElement);
      entry.version = el.cortexVersion;
    }
    const [w, h] = sourceSize(el);
    return { tex: entry.tex, w, h };
  }

  setPan(which, pan) {
    const gl = this.gl;
    gl.uniform1i(this.u[`uPanOn${which}`], pan ? 1 : 0);
    if (!pan) return;
    gl.uniform4f(this.u[`uPan${which}`], pan.x, pan.y, pan.scale, (pan.rotation * Math.PI) / 180);
    const c = pan.crop;
    gl.uniform4f(this.u[`uCrop${which}`], c.left, c.top, c.right, c.bottom);
  }

  // Búfer intermedio libre de w×h (se reutilizan de un fotograma a otro).
  acquire(w, h) {
    const gl = this.gl;
    let target = this.pool.find((t) => !t.busy && t.w === w && t.h === h);
    if (!target) {
      gl.activeTexture(gl.TEXTURE0 + SCRATCH);
      const tex = setupTexture(gl);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      target = { fbo, tex, w, h, busy: false };
      this.pool.push(target);
    }
    target.busy = true;
    target.used = true;
    return target;
  }

  fxProgram(pass) {
    const gl = this.gl;
    const names = Object.keys(pass.uniforms);
    const key = pass.code + names.map((name) => `${name}:${uniformType(pass.uniforms[name])}`).join();
    let entry = this.fxPrograms.get(key);
    if (!entry) {
      const fragment = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPrev;
uniform sampler2D uSrc;
uniform vec2 uSize;
${names.map((name) => `uniform ${uniformType(pass.uniforms[name])} ${name};`).join('\n')}
${GLSL_HELPERS}
vec4 fx(vec2 uv) {
${pass.code}
}
void main() { outColor = fx(vUv); }`;
      const program = link(gl, FX_VERTEX, fragment);
      const loc = {};
      for (const name of ['uPrev', 'uSrc', 'uSize', ...names]) loc[name] = gl.getUniformLocation(program, name);
      entry = { program, loc };
      this.fxPrograms.set(key, entry);
    }
    return entry;
  }

  // Aplica la cadena de efectos a una textura, a w×h píxeles (la imagen encajada). Devuelve la textura resultante.
  applyEffects(tex, effects, w, h) {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, w, h);
    let current = tex;
    for (const fx of effects) {
      const input = current;
      for (const pass of effectPasses(fx, { w, h })) {
        const target = this.acquire(w, h);
        const { program, loc } = this.fxProgram(pass);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, current);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, input);
        gl.uniform1i(loc.uPrev, 2);
        gl.uniform1i(loc.uSrc, 3);
        gl.uniform2f(loc.uSize, w, h);
        for (const [name, value] of Object.entries(pass.uniforms)) {
          const v = Array.isArray(value) ? value : [value];
          gl[`uniform${v.length}fv`](loc[name], v);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        current = target.tex;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.program);
    return current;
  }

  // Textura lista para componer (con sus efectos aplicados) y escala de encaje en el cuadro, o null.
  prepare(el, effects, frame) {
    const src = this.upload(el);
    if (!src) return null;
    const frameAspect = frame.width / frame.height;
    const aspect = src.w / src.h;
    const scale = aspect > frameAspect ? [1, frameAspect / aspect] : [aspect / frameAspect, 1];
    if (!effects?.length) return { tex: src.tex, scale };
    const w = Math.max(2, Math.round(this.canvas.width * scale[0]));
    const h = Math.max(2, Math.round(this.canvas.height * scale[1]));
    return { tex: this.applyEffects(src.tex, effects, w, h), scale };
  }

  // layers: de abajo a arriba. { a, opacity, fxA, panA } o { a, b, type (índice), progress (P de xfade), fxA, fxB, panA, panB }.
  // fxA/fxB: efectos activos de cada evento (activeEffects). panA/panB: panorámica en ese instante
  // ({ x, y, scale, rotation (grados), crop }) o null si no cambia nada.
  render(frame, layers) {
    const gl = this.gl;
    for (const t of this.pool) t.used = false;
    const prepared = layers.map((layer) => ({
      layer,
      a: this.prepare(layer.a, layer.fxA, frame),
      b: layer.b !== undefined ? this.prepare(layer.b, layer.fxB, frame) : null,
    }));

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.program);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.enable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.u.uFrame, frame.width, frame.height);
    for (const { layer, a, b } of prepared) {
      const transition = layer.b !== undefined;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, a ? a.tex : null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, b ? b.tex : null);
      gl.uniform1i(this.u.uHasA, a ? 1 : 0);
      gl.uniform1i(this.u.uHasB, b ? 1 : 0);
      if (a) gl.uniform2f(this.u.uScaleA, ...a.scale);
      if (b) gl.uniform2f(this.u.uScaleB, ...b.scale);
      gl.uniform1i(this.u.uTransition, transition ? 1 : 0);
      gl.uniform1i(this.u.uType, transition ? layer.type : 0);
      gl.uniform1f(this.u.uP, transition ? layer.progress : 1);
      gl.uniform1f(this.u.uOpacity, transition ? 1 : layer.opacity);
      this.setPan('A', layer.panA);
      this.setPan('B', layer.panB);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Los búferes quedan libres para el siguiente fotograma; los que no se han usado se borran.
    this.pool = this.pool.filter((t) => {
      t.busy = false;
      if (t.used) return true;
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
      return false;
    });
  }
}
