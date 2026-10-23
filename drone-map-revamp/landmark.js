// A small low-poly diorama of the Neptun Deep production platform (Neptun Alpha),
// drawn with plain WebGL so the map needs no 3D library. Illustrative, not to scale.
// Usage: const model = window.createPlatformModel(canvas, {still}); model.resize(px); model.destroy();
(() => {
  'use strict';

  const hex = value => [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16) / 255);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const normalize = a => scale(a, 1 / (Math.hypot(...a) || 1));

  const COLORS = {
    water: hex('#6cc3d5'), waterSide: hex('#3f97b0'), foam: hex('#f4fbfc'),
    leg: hex('#f2b937'), brace: hex('#d99a24'), deck: hex('#e6ecee'), deckSide: hex('#9fb0b6'),
    module: hex('#e4572e'), moduleLight: hex('#f4f6f6'), window: hex('#24414b'),
    helideck: hex('#2f6b5f'), helideckRing: hex('#f2c14e'), white: hex('#ffffff'),
    boom: hex('#c3ccd0'), flame: hex('#ff8a2a'), flameCore: hex('#ffd166'),
    flagBlue: hex('#002b7f'), flagYellow: hex('#fcd116'), flagRed: hex('#ce1126'),
  };
  const FLARE_TIP = [-1.02, 1.5, -0.8];

  // Flat-shaded triangles. Each shape passes its centre so face normals point outward
  // whatever the winding, which keeps the builders short.
  function buildGeometry() {
    const positions = [], normals = [], colors = [], animation = [];
    const triangle = (a, b, c, color, centre, anim = 0) => {
      let normal = normalize(cross(sub(b, a), sub(c, a)));
      const middle = scale(add(add(a, b), c), 1 / 3);
      if (centre && dot(normal, sub(middle, centre)) < 0) normal = scale(normal, -1);
      for (const point of [a, b, c]) {
        positions.push(...point); normals.push(...normal); colors.push(...color); animation.push(anim);
      }
    };
    const quad = (a, b, c, d, color, centre, anim) => { triangle(a, b, c, color, centre, anim); triangle(a, c, d, color, centre, anim); };
    const box = (centre, size, color, side = color) => {
      const [x, y, z] = centre, [w, h, d] = scale(size, 0.5);
      const p = (i, j, k) => [x + i * w, y + j * h, z + k * d];
      quad(p(-1, 1, -1), p(1, 1, -1), p(1, 1, 1), p(-1, 1, 1), color, centre);
      quad(p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), side, centre);
      quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), side, centre);
      quad(p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1), side, centre);
      quad(p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1), side, centre);
      quad(p(-1, -1, -1), p(-1, 1, -1), p(-1, 1, 1), p(-1, -1, 1), side, centre);
    };
    // A capped (possibly tapered) cylinder between two points.
    const tube = (from, to, r0, r1, segments, color, anim = 0, caps = true) => {
      const axis = normalize(sub(to, from));
      const helper = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = normalize(cross(axis, helper)), v = cross(axis, u);
      const ring = (origin, radius, index) => {
        const angle = index / segments * Math.PI * 2;
        return add(origin, add(scale(u, Math.cos(angle) * radius), scale(v, Math.sin(angle) * radius)));
      };
      const centre = scale(add(from, to), 0.5);
      for (let index = 0; index < segments; index++) {
        const a = ring(from, r0, index), b = ring(from, r0, index + 1), c = ring(to, r1, index + 1), d = ring(to, r1, index);
        if (r1 > 0) quad(a, b, c, d, color, centre, anim); else triangle(a, b, to, color, centre, anim);
        if (caps && r0 > 0) triangle(from, a, b, color, centre, anim);
        if (caps && r1 > 0) triangle(to, d, c, color, centre, anim);
      }
    };

    // Water puck with a wavy, subdivided top.
    const radius = 1.32, rings = 6, segments = 30;
    for (let ringIndex = 0; ringIndex < rings; ringIndex++) {
      const r0 = radius * ringIndex / rings, r1 = radius * (ringIndex + 1) / rings;
      for (let index = 0; index < segments; index++) {
        const at = (r, i) => [Math.cos(i / segments * Math.PI * 2) * r, 0, Math.sin(i / segments * Math.PI * 2) * r];
        const below = [0, -1, 0];
        if (ringIndex === 0) triangle([0, 0, 0], at(r1, index), at(r1, index + 1), COLORS.water, below, 1);
        else quad(at(r0, index), at(r0, index + 1), at(r1, index + 1), at(r1, index), COLORS.water, below, 1);
      }
    }
    tube([0, -0.32, 0], [0, 0, 0], radius, radius, segments, COLORS.waterSide, 1, false);

    // Jacket: four slightly raked legs with foam collars and cross braces.
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const foot = ([i, k]) => [i * 0.46, -0.05, k * 0.46], head = ([i, k]) => [i * 0.38, 0.78, k * 0.38];
    const along = (corner, t) => add(foot(corner), scale(sub(head(corner), foot(corner)), t));
    for (const corner of corners) {
      tube(foot(corner), head(corner), 0.075, 0.065, 10, COLORS.leg);
      tube(add(foot(corner), [0, 0.03, 0]), add(foot(corner), [0, 0.07, 0]), 0.13, 0.11, 12, COLORS.foam, 1);
    }
    for (let index = 0; index < 4; index++) {
      const a = corners[index], b = corners[(index + 1) % 4];
      tube(along(a, 0.3), along(b, 0.62), 0.03, 0.03, 6, COLORS.brace);
      tube(along(b, 0.3), along(a, 0.62), 0.03, 0.03, 6, COLORS.brace);
    }

    // Decks and modules.
    box([0, 0.83, 0], [1.16, 0.1, 1.16], COLORS.deck, COLORS.deckSide);
    box([-0.12, 1.05, 0.08], [0.62, 0.34, 0.52], COLORS.module);
    box([0.32, 0.99, -0.3], [0.36, 0.22, 0.34], COLORS.moduleLight, hex('#d9e1e3'));
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 4; column++) {
        box([-0.36 + column * 0.16, 1.0 + row * 0.12, 0.345], [0.07, 0.05, 0.012], COLORS.window);
      }
    }

    // Helideck on a cantilever, with its ring and H.
    tube([0.45, 0.86, 0.45], [0.62, 1.2, 0.5], 0.03, 0.03, 6, COLORS.brace);
    tube([0.6, 1.2, 0.5], [0.6, 1.235, 0.5], 0.36, 0.36, 24, COLORS.helideckRing);
    tube([0.6, 1.235, 0.5], [0.6, 1.25, 0.5], 0.3, 0.3, 24, COLORS.helideck);
    box([0.52, 1.256, 0.5], [0.035, 0.012, 0.22], COLORS.white);
    box([0.68, 1.256, 0.5], [0.035, 0.012, 0.22], COLORS.white);
    box([0.6, 1.256, 0.5], [0.16, 0.012, 0.035], COLORS.white);

    // Crane.
    tube([0.36, 0.88, -0.36], [0.36, 1.18, -0.36], 0.06, 0.05, 10, COLORS.leg);
    tube([0.36, 1.16, -0.36], [0.92, 1.5, -0.62], 0.028, 0.02, 6, COLORS.leg);
    tube([0.92, 1.5, -0.62], [0.92, 1.22, -0.62], 0.006, 0.006, 4, COLORS.window);

    // Flare boom and its flame (animated in the shader around FLARE_TIP).
    tube([-0.44, 0.9, -0.38], FLARE_TIP, 0.045, 0.035, 8, COLORS.boom);
    tube(FLARE_TIP, add(FLARE_TIP, [0, 0.34, 0]), 0.11, 0, 10, COLORS.flame, 2);
    tube(add(FLARE_TIP, [0, 0.02, 0]), add(FLARE_TIP, [0, 0.2, 0]), 0.06, 0, 8, COLORS.flameCore, 2);

    // Romanian flag.
    tube([-0.38, 1.22, 0.3], [-0.38, 1.62, 0.3], 0.012, 0.012, 6, COLORS.boom);
    [COLORS.flagBlue, COLORS.flagYellow, COLORS.flagRed].forEach((color, index) => {
      box([-0.335 + index * 0.08, 1.53, 0.3], [0.08, 0.16, 0.012], color);
    });

    return {positions, normals, colors, animation, count: positions.length / 3};
  }

  const VERTEX = `
    attribute vec3 a_position; attribute vec3 a_normal; attribute vec3 a_color; attribute float a_animation;
    uniform mat4 u_viewProjection; uniform float u_angle; uniform float u_time; uniform vec3 u_flare;
    varying vec3 v_normal; varying vec3 v_color; varying float v_crest;
    void main() {
      vec3 p = a_position;
      v_crest = 0.0;
      if (a_animation > 0.5 && a_animation < 1.5) {
        // Calmer at the rim so the puck keeps a clean edge.
        float calm = 1.0 - 0.75 * smoothstep(0.9, 1.32, length(p.xz));
        float wave = calm * (0.03 * sin(u_time * 1.7 + p.x * 4.5) + 0.022 * cos(u_time * 1.3 + p.z * 5.5));
        p.y += wave;
        v_crest = max(wave, 0.0) * 9.0;
      } else if (a_animation > 1.5) {
        vec3 d = p - u_flare;
        float f = 1.0 + 0.16 * sin(u_time * 11.0) + 0.07 * sin(u_time * 23.0 + 1.3);
        p = u_flare + vec3(d.x / sqrt(f), d.y * f, d.z / sqrt(f));
      }
      float c = cos(u_angle), s = sin(u_angle);
      vec3 world = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
      v_normal = vec3(c * a_normal.x + s * a_normal.z, a_normal.y, -s * a_normal.x + c * a_normal.z);
      v_color = a_color;
      gl_Position = u_viewProjection * vec4(world, 1.0);
    }`;
  const FRAGMENT = `
    precision mediump float;
    varying vec3 v_normal; varying vec3 v_color; varying float v_crest;
    uniform vec3 u_light;
    void main() {
      float light = dot(normalize(v_normal), u_light);
      float band = light > 0.45 ? 1.0 : (light > -0.05 ? 0.84 : 0.7);
      gl_FragColor = vec4(min(v_color * band + vec3(v_crest * 0.22), 1.0), 1.0);
    }`;

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
  }
  function lookAt(eye, target) {
    const z = normalize(sub(eye, target)), x = normalize(cross([0, 1, 0], z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  }
  function multiply(a, b) {
    const out = new Array(16).fill(0);
    for (let column = 0; column < 4; column++) {
      for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
      }
    }
    return out;
  }

  window.createPlatformModel = (canvas, {still = false} = {}) => {
    const gl = canvas.getContext('webgl', {alpha: true, antialias: true, premultipliedAlpha: true});
    if (!gl) return null;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);

    const geometry = buildGeometry();
    const attribute = (name, data, size) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    };
    attribute('a_position', geometry.positions, 3);
    attribute('a_normal', geometry.normals, 3);
    attribute('a_color', geometry.colors, 3);
    attribute('a_animation', geometry.animation, 1);
    const uniform = name => gl.getUniformLocation(program, name);
    const view = lookAt([0, 2.9, 6.1], [0, 0.55, 0]);
    gl.uniformMatrix4fv(uniform('u_viewProjection'), false, multiply(perspective(0.6, 1, 0.1, 20), view));
    gl.uniform3fv(uniform('u_light'), normalize([0.55, 0.9, 0.45]));
    gl.uniform3fv(uniform('u_flare'), FLARE_TIP);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);

    let frame = 0, visible = true, started = performance.now();
    const draw = now => {
      const seconds = still ? 0 : (now - started) / 1000;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(uniform('u_time'), seconds + 2);
      gl.uniform1f(uniform('u_angle'), 0.6 + seconds * 0.22);
      gl.drawArrays(gl.TRIANGLES, 0, geometry.count);
    };
    const loop = now => {
      frame = 0;
      draw(now);
      if (!still && visible && !document.hidden) frame = requestAnimationFrame(loop);
    };
    const wake = () => { if (!frame && !still && visible && !document.hidden) frame = requestAnimationFrame(loop); };
    // Only animate while the model is on screen and the tab is visible.
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; wake(); });
    observer.observe(canvas);
    document.addEventListener('visibilitychange', wake);

    return {
      resize(size) {
        const pixels = Math.round(size * Math.min(window.devicePixelRatio || 1, 2));
        if (canvas.width !== pixels) { canvas.width = pixels; canvas.height = pixels; }
        draw(performance.now());
        wake();
      },
      destroy() {
        cancelAnimationFrame(frame);
        observer.disconnect();
        document.removeEventListener('visibilitychange', wake);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      },
    };
  };
})();
