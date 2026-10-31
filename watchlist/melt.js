// Melts one poster into the next with a WebGL shader. The old image runs downwards
// in uneven drips while the new one rises out of it. If WebGL or an image isn't
// available, play() returns false and the caller uses a plain dissolve instead.

const MELT_DURATION = 4400;
const MELT_MAX_PIXEL_RATIO = 2;
const MELT_TEXTURE_CACHE = 4;

const MELT_VERTEX = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = vec2(aPosition.x * 0.5 + 0.5, 0.5 - aPosition.y * 0.5);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const MELT_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform vec2 uFromScale;
uniform vec2 uToScale;
uniform float uFromFlip;
uniform float uProgress;
uniform float uSeed;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  return 0.55 * noise(p) + 0.3 * noise(p * 2.1 + 3.7) + 0.15 * noise(p * 4.3 + 9.2);
}

vec2 cover(vec2 uv, vec2 scale) {
  return (uv - 0.5) * scale + 0.5;
}

void main() {
  float soft = 0.16;
  float blobs = fbm(vUv * vec2(2.2, 1.6) + uSeed);
  // Broad streams with a few narrower ones; finer noise here looks like a glitch rather than liquid.
  float drips = 0.72 * noise(vec2(vUv.x * 3.5 + uSeed, uSeed)) + 0.28 * noise(vec2(vUv.x * 8.0 + uSeed, uSeed * 2.0));

  // The melting edge travels from top to bottom, further ahead in some columns than others.
  float front = mix(-soft - 0.35, 1.0 + soft, uProgress);
  float height = vUv.y * 0.72 + blobs * 0.16 + drips * 0.12;
  float remaining = smoothstep(front - soft, front + soft, height);

  // Sampling higher up the image makes its contents flow downwards.
  vec2 fromUv = vUv;
  fromUv.y -= uProgress * uProgress * (0.2 + 0.55 * drips);
  fromUv.x += (blobs - 0.5) * 0.03 * uProgress;
  fromUv = cover(clamp(fromUv, 0.0, 1.0), uFromScale);
  if (uFromFlip > 0.5) fromUv.y = 1.0 - fromUv.y;

  // The new poster ripples slightly as it settles.
  vec2 toUv = cover(clamp(vUv + (blobs - 0.5) * 0.035 * (1.0 - uProgress), 0.0, 1.0), uToScale);

  vec3 color = mix(texture2D(uTo, toUv).rgb, texture2D(uFrom, fromUv).rgb, remaining);
  // A soft sheen along the edge, like light on a liquid surface.
  color += 4.0 * remaining * (1.0 - remaining) * 0.09;
  gl_FragColor = vec4(color, 1.0);
}`;

function createMelt() {
  const canvas = document.createElement("canvas");
  canvas.className = "melt";
  canvas.setAttribute("aria-hidden", "true");

  let gl = null;
  let uniforms = null;
  let snapshot = null;
  let frame = null;
  let textures = new Map();
  let run = null;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  }

  function newTexture() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Posters aren't power-of-two sized, which WebGL 1 only allows with these settings.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  function init() {
    gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) return;
    const vertex = compile(gl.VERTEX_SHADER, MELT_VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, MELT_FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment) {
      gl = null;
      return;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl = null;
      return;
    }
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    uniforms = {};
    for (const name of ["uFrom", "uTo", "uFromScale", "uToScale", "uFromFlip", "uProgress", "uSeed"]) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    gl.uniform1i(uniforms.uFrom, 0);
    gl.uniform1i(uniforms.uTo, 1);
    snapshot = newTexture();
    textures = new Map();
  }

  // iOS can take the context away when the app goes to the background.
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    stop();
    gl = null;
    textures = new Map();
  });
  canvas.addEventListener("webglcontextrestored", init);

  function isReady(image) {
    return Boolean(image && image.complete && image.naturalWidth);
  }

  function textureFor(image) {
    const key = image.currentSrc || image.src;
    const known = textures.get(key);
    if (known) {
      textures.delete(key);
      textures.set(key, known);
      return known;
    }
    const entry = { texture: newTexture(), width: image.naturalWidth, height: image.naturalHeight };
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
    textures.set(key, entry);
    return entry;
  }

  function evictOldTextures(inUse) {
    for (const [key, entry] of textures) {
      if (textures.size <= MELT_TEXTURE_CACHE) break;
      if (!inUse.includes(entry.texture)) {
        gl.deleteTexture(entry.texture);
        textures.delete(key);
      }
    }
  }

  // Upload ahead of time, so the first frame of a melt never has to wait for it.
  function prepare(image) {
    if (!gl) init();
    if (gl && isReady(image)) textureFor(image);
  }

  // Scale for sampling an image the way object-fit: cover draws it.
  function coverScale(width, height) {
    const box = canvas.width / canvas.height;
    const image = width / height;
    return image > box ? [box / image, 1] : [1, image / box];
  }

  function draw(progress) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, run.from);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, run.to);
    gl.uniform2fv(uniforms.uFromScale, run.fromScale);
    gl.uniform2fv(uniforms.uToScale, run.toScale);
    gl.uniform1f(uniforms.uFromFlip, run.fromFlip);
    gl.uniform1f(uniforms.uSeed, run.seed);
    gl.uniform1f(uniforms.uProgress, progress);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    run.progress = progress;
  }

  function tick(now) {
    if (!run) return;
    const elapsed = Math.min(1, (now - run.start) / MELT_DURATION);
    if (elapsed >= 1) {
      stop();
      return;
    }
    draw(elapsed * elapsed * (3 - 2 * elapsed));
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    run = null;
    canvas.remove();
  }

  // Melts fromImage into toImage, drawn inside host. A melt already running
  // continues from whatever is on screen instead of snapping to its end.
  function play(fromImage, toImage, host) {
    if (!gl) init();
    if (!gl || gl.isContextLost() || !isReady(toImage) || (!run && !isReady(fromImage))) return false;

    const box = host.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, MELT_MAX_PIXEL_RATIO);
    const width = Math.round(box.width * ratio);
    const height = Math.round(box.height * ratio);
    if (!width || !height) return false;

    let from;
    let fromScale;
    let fromFlip = 0;
    const midway = run && canvas.width === width && canvas.height === height;
    if (midway) {
      // The drawing buffer only survives until the browser composites, so redraw and copy in one go.
      draw(run.progress);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, snapshot);
      gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, width, height, 0);
      from = snapshot;
      fromScale = [1, 1];
      fromFlip = 1;
    }
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;

    canvas.width = width;
    canvas.height = height;
    if (!midway) {
      if (!isReady(fromImage)) {
        stop();
        return false;
      }
      gl.activeTexture(gl.TEXTURE0);
      const entry = textureFor(fromImage);
      from = entry.texture;
      fromScale = coverScale(entry.width, entry.height);
    }
    gl.activeTexture(gl.TEXTURE1);
    const target = textureFor(toImage);
    evictOldTextures([from, target.texture]);

    run = {
      from,
      to: target.texture,
      fromScale,
      toScale: coverScale(target.width, target.height),
      fromFlip,
      seed: Math.random() * 50,
      progress: 0,
      start: performance.now(),
    };
    host.append(canvas);
    draw(0);
    frame = requestAnimationFrame(tick);
    return true;
  }

  return { prepare, play, stop };
}
