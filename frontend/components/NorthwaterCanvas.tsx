'use client'

import { useEffect, useRef } from 'react'

// ── GLSL shaders (verbatim from original northwater.js) ──────────────────────

const VERT = [
  `#version 300 es`,
  `out vec2 v_uv;`,
  `const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));`,
  `void main() {`,
  `  vec2 p = corners[gl_VertexID];`,
  `  v_uv = p * 0.5 + 0.5;`,
  `  gl_Position = vec4(p, 0.0, 1.0);`,
  `}`,
].join('\n')

const MASK = [
  `#version 300 es`,
  `precision highp float;`,
  `uniform vec2 u_texel;`,
  `in vec2 v_uv;`,
  `out vec4 outColor;`,
  `void main() {`,
  `  float ceiling = 0.61 + 0.095 * sin(v_uv.x * 7.4 + 0.60) + 0.045 * sin(v_uv.x * 22.9 - 0.90);`,
  `  float floor = 0.026 + 0.020 * sin(v_uv.x * 6.8 + 2.10) + 0.009 * sin(v_uv.x * 19.5 + 0.50);`,
  `  float sdf = min(v_uv.y - floor, ceiling - v_uv.y);`,
  `  float feather = max(1.5 * u_texel.y, 0.004);`,
  `  outColor = vec4(sdf, smoothstep(-feather, feather, sdf), 0.0, 1.0);`,
  `}`,
].join('\n')

const SEED = [
  `#version 300 es`,
  `precision highp float;`,
  `uniform sampler2D u_bank;`,
  `in vec2 v_uv;`,
  `out vec4 outColor;`,
  `float thread(float lane, float amp, float phase) {`,
  `  float path = lane + sin(v_uv.x * 8.0 + phase) * amp + sin(v_uv.x * 25.0 + phase) * 0.010;`,
  `  float delta = v_uv.y - path;`,
  `  return exp(-(delta * delta) / 0.00014);`,
  `}`,
  `void main() {`,
  `  float a = thread(0.105, 0.025, 0.20);`,
  `  float b = thread(0.195, 0.033, 1.30);`,
  `  float c = thread(0.285, 0.027, 2.60);`,
  `  float d = thread(0.375, 0.020, 4.10);`,
  `  float e = thread(0.455, 0.016, 5.20);`,
  `  float dye = 0.22 * a + 0.19 * b + 0.16 * c + 0.13 * d + 0.10 * e;`,
  `  dye *= texture(u_bank, v_uv).g;`,
  `  outColor = vec4(vec3(dye), 0.0);`,
  `}`,
].join('\n')

const SPLAT = [
  `#version 300 es`,
  `precision highp float;`,
  `uniform sampler2D u_source;`,
  `uniform sampler2D u_bank;`,
  `uniform vec2 u_point;`,
  `uniform vec3 u_value;`,
  `uniform float u_radius;`,
  `uniform float u_aspect;`,
  `in vec2 v_uv;`,
  `out vec4 outColor;`,
  `void main() {`,
  `  vec2 offset = v_uv - u_point;`,
  `  offset.x *= u_aspect;`,
  `  float influence = exp(-dot(offset, offset) / max(u_radius, 0.0001));`,
  `  float fluid = texture(u_bank, v_uv).g;`,
  `  outColor = (texture(u_source, v_uv) + vec4(u_value * influence, 0.0)) * fluid;`,
  `}`,
].join('\n')

const ADVECT = [
  `#version 300 es`,
  `precision highp float;`,
  `uniform sampler2D u_velocity;`,
  `uniform sampler2D u_source;`,
  `uniform sampler2D u_bank;`,
  `uniform vec2 u_texel;`,
  `uniform float u_dt;`,
  `uniform float u_dissipation;`,
  `in vec2 v_uv;`,
  `out vec4 outColor;`,
  `void main() {`,
  `  vec2 velocity = texture(u_velocity, v_uv).xy;`,
  `  vec2 coordinate = v_uv - u_dt * velocity * u_texel * 46.0;`,
  `  coordinate = clamp(coordinate, u_texel * 0.5, vec2(1.0) - u_texel * 0.5);`,
  `  float fluid = texture(u_bank, v_uv).g;`,
  `  float donor = texture(u_bank, coordinate).g;`,
  `  outColor = u_dissipation * texture(u_source, coordinate) * fluid * donor;`,
  `}`,
].join('\n')

const DRIFT = [
  `#version 300 es`,
  `precision highp float;`,
  `uniform sampler2D u_velocity;`,
  `uniform sampler2D u_bank;`,
  `uniform vec2 u_texel;`,
  `uniform float u_time;`,
  `uniform float u_dt;`,
  `in vec2 v_uv;`,
  `out vec4 outColor;`,
  `void main() {`,
  `  vec2 velocity = texture(u_velocity, v_uv).xy;`,
  `  float upper = sin(v_uv.x * 10.0 + u_time * 0.34 + v_uv.y * 5.0);`,
  `  float lower = sin(v_uv.x * 17.0 - u_time * 0.21 - v_uv.y * 9.0);`,
  `  vec2 drift = vec2(0.72, upper * 0.23 + lower * 0.13);`,
  `  float sdf = texture(u_bank, v_uv).r;`,
  `  vec2 normal = normalize(vec2(`,
  `    texture(u_bank, v_uv + vec2(u_texel.x, 0.0)).r - texture(u_bank, v_uv - vec2(u_texel.x, 0.0)).r,`,
  `    texture(u_bank, v_uv + vec2(0.0, u_texel.y)).r - texture(u_bank, v_uv - vec2(0.0, u_texel.y)).r`,
  `  ) + vec2(0.00001));`,
  `  vec2 tangent = vec2(-normal.y, normal.x);`,
  `  if (tangent.x < 0.0) tangent *= -1.0;`,
  `  float shore = 1.0 - smoothstep(0.018, 0.105, max(sdf, 0.0));`,
  `  drift += tangent * shore * 0.28;`,
  `  float fluid = texture(u_bank, v_uv).g;`,
  `  outColor = vec4((velocity + drift * u_dt) * fluid, 0.0, 1.0);`,
  `}`,
].join('\n')

const DIVERGENCE = [
  `#version 300 es`,
  `precision highp float;`,
  `uniform sampler2D u_velocity;`,
  `uniform sampler2D u_bank;`,
  `uniform vec2 u_texel;`,
  `in vec2 v_uv;`,
  `out vec4 outColor;`,
  `void main() {`,
  `  vec2 l_uv = v_uv - vec2(u_texel.x, 0.0);`,
  `  vec2 r_uv = v_uv + vec2(u_texel.x, 0.0);`,
  `  vec2 b_uv = v_uv - vec2(0.0, u_texel.y);`,
  `  vec2 t_uv = v_uv + vec2(0.0, u_texel.y);`,
  `  float l = texture(u_velocity, l_uv).x * texture(u_bank, l_uv).g;`,
  `  float r = texture(u_velocity, r_uv).x * texture(u_bank, r_uv).g;`,
  `  float b = texture(u_velocity, b_uv).y * texture(u_bank, b_uv).g;`,
  `  float t = texture(u_velocity, t_uv).y * texture(u_bank, t_uv).g;`,
  `  float fluid = texture(u_bank, v_uv).g;`,
  `  outColor = vec4(0.5 * (r - l + t - b) * fluid, 0.0, 0.0, 1.0);`,
  `}`,
].join('\n')

const PRESSURE = [
  `#version 300 es`,
  `precision highp float;`,
  `uniform sampler2D u_pressure;`,
  `uniform sampler2D u_divergence;`,
  `uniform sampler2D u_bank;`,
  `uniform vec2 u_texel;`,
  `in vec2 v_uv;`,
  `out vec4 outColor;`,
  `void main() {`,
  `  float center = texture(u_pressure, v_uv).x;`,
  `  vec2 l_uv = v_uv - vec2(u_texel.x, 0.0);`,
  `  vec2 r_uv = v_uv + vec2(u_texel.x, 0.0);`,
  `  vec2 b_uv = v_uv - vec2(0.0, u_texel.y);`,
  `  vec2 t_uv = v_uv + vec2(0.0, u_texel.y);`,
  `  float l = mix(center, texture(u_pressure, l_uv).x, texture(u_bank, l_uv).g);`,
  `  float r = mix(center, texture(u_pressure, r_uv).x, texture(u_bank, r_uv).g);`,
  `  float b = mix(center, texture(u_pressure, b_uv).x, texture(u_bank, b_uv).g);`,
  `  float t = mix(center, texture(u_pressure, t_uv).x, texture(u_bank, t_uv).g);`,
  `  float div = texture(u_divergence, v_uv).x;`,
  `  float fluid = texture(u_bank, v_uv).g;`,
  `  outColor = vec4((l + r + b + t - div) * 0.25 * fluid, 0.0, 0.0, 1.0);`,
  `}`,
].join('\n')

const GRADIENT = [
  `#version 300 es`,
  `precision highp float;`,
  `uniform sampler2D u_pressure;`,
  `uniform sampler2D u_velocity;`,
  `uniform sampler2D u_bank;`,
  `uniform vec2 u_texel;`,
  `in vec2 v_uv;`,
  `out vec4 outColor;`,
  `void main() {`,
  `  float center = texture(u_pressure, v_uv).x;`,
  `  vec2 l_uv = v_uv - vec2(u_texel.x, 0.0);`,
  `  vec2 r_uv = v_uv + vec2(u_texel.x, 0.0);`,
  `  vec2 b_uv = v_uv - vec2(0.0, u_texel.y);`,
  `  vec2 t_uv = v_uv + vec2(0.0, u_texel.y);`,
  `  float l = mix(center, texture(u_pressure, l_uv).x, texture(u_bank, l_uv).g);`,
  `  float r = mix(center, texture(u_pressure, r_uv).x, texture(u_bank, r_uv).g);`,
  `  float b = mix(center, texture(u_pressure, b_uv).x, texture(u_bank, b_uv).g);`,
  `  float t = mix(center, texture(u_pressure, t_uv).x, texture(u_bank, t_uv).g);`,
  `  vec2 velocity = texture(u_velocity, v_uv).xy - 0.5 * vec2(r - l, t - b);`,
  `  float fluid = texture(u_bank, v_uv).g;`,
  `  vec2 normal = normalize(vec2(texture(u_bank, r_uv).r - texture(u_bank, l_uv).r, texture(u_bank, t_uv).r - texture(u_bank, b_uv).r) + vec2(0.00001));`,
  `  float outward = min(0.0, dot(velocity, normal));`,
  `  velocity = (velocity - outward * normal) * fluid;`,
  `  outColor = vec4(velocity, 0.0, 1.0);`,
  `}`,
].join('\n')

const CURL = [
  `#version 300 es`,
  `precision highp float;`,
  `uniform sampler2D u_velocity;`,
  `uniform sampler2D u_bank;`,
  `uniform vec2 u_texel;`,
  `in vec2 v_uv;`,
  `out vec4 outColor;`,
  `void main() {`,
  `  vec2 l_uv = v_uv - vec2(u_texel.x, 0.0);`,
  `  vec2 r_uv = v_uv + vec2(u_texel.x, 0.0);`,
  `  vec2 b_uv = v_uv - vec2(0.0, u_texel.y);`,
  `  vec2 t_uv = v_uv + vec2(0.0, u_texel.y);`,
  `  float l = texture(u_velocity, l_uv).y * texture(u_bank, l_uv).g;`,
  `  float r = texture(u_velocity, r_uv).y * texture(u_bank, r_uv).g;`,
  `  float b = texture(u_velocity, b_uv).x * texture(u_bank, b_uv).g;`,
  `  float t = texture(u_velocity, t_uv).x * texture(u_bank, t_uv).g;`,
  `  float fluid = texture(u_bank, v_uv).g;`,
  `  outColor = vec4((r - l - t + b) * fluid, 0.0, 0.0, 1.0);`,
  `}`,
].join('\n')

const VORTICITY = [
  `#version 300 es`,
  `precision highp float;`,
  `uniform sampler2D u_velocity;`,
  `uniform sampler2D u_curl;`,
  `uniform sampler2D u_bank;`,
  `uniform vec2 u_texel;`,
  `uniform float u_dt;`,
  `uniform float u_confinement;`,
  `in vec2 v_uv;`,
  `out vec4 outColor;`,
  `void main() {`,
  `  float l = abs(texture(u_curl, v_uv - vec2(u_texel.x, 0.0)).x);`,
  `  float r = abs(texture(u_curl, v_uv + vec2(u_texel.x, 0.0)).x);`,
  `  float b = abs(texture(u_curl, v_uv - vec2(0.0, u_texel.y)).x);`,
  `  float t = abs(texture(u_curl, v_uv + vec2(0.0, u_texel.y)).x);`,
  `  float center = texture(u_curl, v_uv).x;`,
  `  vec2 force = 0.5 * vec2(t - b, r - l);`,
  `  force /= length(force) + 0.0001;`,
  `  force *= u_confinement * center;`,
  `  float fluid = texture(u_bank, v_uv).g;`,
  `  vec2 velocity = (texture(u_velocity, v_uv).xy + force * u_dt) * fluid;`,
  `  outColor = vec4(velocity, 0.0, 1.0);`,
  `}`,
].join('\n')

const DISPLAY = [
  `#version 300 es`,
  `precision highp float;`,
  `uniform sampler2D u_dye;`,
  `uniform sampler2D u_velocity;`,
  `uniform sampler2D u_bank;`,
  `uniform vec2 u_texel;`,
  `uniform vec3 u_water;`,
  `uniform vec3 u_foam;`,
  `uniform vec3 u_ember;`,
  `uniform float u_idleAlpha;`,
  `in vec2 v_uv;`,
  `out vec4 outColor;`,
  `float densityAt(vec2 uv) {`,
  `  vec3 dye = texture(u_dye, clamp(uv, vec2(0.0), vec2(1.0))).rgb;`,
  `  return max(dye.r, max(dye.g, dye.b));`,
  `}`,
  `void main() {`,
  `  float center = densityAt(v_uv);`,
  `  float l = densityAt(v_uv - vec2(u_texel.x, 0.0));`,
  `  float r = densityAt(v_uv + vec2(u_texel.x, 0.0));`,
  `  float b = densityAt(v_uv - vec2(0.0, u_texel.y));`,
  `  float t = densityAt(v_uv + vec2(0.0, u_texel.y));`,
  `  float edge = length(vec2(r - l, t - b));`,
  `  float speed = length(texture(u_velocity, v_uv).xy);`,
  `  float fluid = texture(u_bank, v_uv).g;`,
  `  float sdf = texture(u_bank, v_uv).r;`,
  `  float core = smoothstep(0.018, 0.16, center);`,
  `  float ribbon = smoothstep(0.0015, 0.024, edge) * smoothstep(0.006, 0.145, center);`,
  `  float wake = smoothstep(0.16, 1.55, speed);`,
  `  float shore = 1.0 - smoothstep(0.008, 0.075, max(sdf, 0.0));`,
  `  float tracer = clamp(core * 0.42 + ribbon * 1.12 + wake * 0.11, 0.0, 1.0);`,
  `  vec3 bed = mix(u_water, u_foam, 0.10 * shore);`,
  `  vec3 color = mix(bed, u_foam, smoothstep(0.08, 0.58, tracer));`,
  `  color = mix(color, u_ember, smoothstep(1.85, 2.80, center) * 0.08);`,
  `  float alpha = fluid * (u_idleAlpha * (0.72 + 0.28 * shore) + tracer * 0.68);`,
  `  outColor = vec4(color * alpha, alpha);`,
  `}`,
].join('\n')

// ── Types ─────────────────────────────────────────────────────────────────────

type RGB = [number, number, number]
type FBO = { texture: WebGLTexture; framebuffer: WebGLFramebuffer }
type DoubleFBO = { read: FBO; write: FBO }
type Prog = { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> }
type Programs = {
  mask: Prog; seed: Prog; splat: Prog; advect: Prog; drift: Prog
  divergence: Prog; pressure: Prog; gradient: Prog; curl: Prog; vorticity: Prog; display: Prog
}
type FBOs = {
  velocity: DoubleFBO; dye: DoubleFBO; pressure: DoubleFBO
  divergence: FBO; curl: FBO; banks: FBO
}
type Dims = { width: number; height: number; simWidth: number; simHeight: number }
type Colors = { water: RGB; foam: RGB; ember: RGB; idleAlpha: number }
type Splat = { x: number; y: number; dx: number; dy: number; color: RGB; radius: number }

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex: string, fallback: RGB): RGB {
  const s = hex.trim().replace('#', '')
  const n = s.length === 3 ? s.split('').map(c => c + c).join('') : s
  if (!/^[0-9a-fA-F]{6}$/.test(n)) return fallback
  return [parseInt(n.slice(0, 2), 16) / 255, parseInt(n.slice(2, 4), 16) / 255, parseInt(n.slice(4, 6), 16) / 255]
}

function luminance([r, g, b]: RGB): number {
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}

function prefersReducedMotion(): boolean {
  return (
    document.documentElement.dataset.motion === 'off' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type)
  if (!s) return null
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn('Northwater shader:', gl.getShaderInfoLog(s))
    gl.deleteShader(s)
    return null
  }
  return s
}

function createProgram(gl: WebGL2RenderingContext, fragSrc: string, uniformNames: string[]): Prog | null {
  const vert = compileShader(gl, gl.VERTEX_SHADER, VERT)
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc)
  if (!vert || !frag) return null
  const prog = gl.createProgram()
  if (!prog) return null
  gl.attachShader(prog, vert)
  gl.attachShader(prog, frag)
  gl.linkProgram(prog)
  gl.deleteShader(vert)
  gl.deleteShader(frag)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('Northwater program:', gl.getProgramInfoLog(prog))
    gl.deleteProgram(prog)
    return null
  }
  return {
    program: prog,
    uniforms: Object.fromEntries(uniformNames.map(n => [n, gl.getUniformLocation(prog, n)])),
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NorthwaterCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    const canvas = canvasEl
    const container = canvas.parentElement as HTMLElement
    if (!container) return

    let gl: WebGL2RenderingContext | null = null
    let rafId = 0
    let isVisible = false
    let destroyed = false
    let lastFrameTime = 0
    let lastSeedTime = 0
    let lastPointer: { x: number; y: number } | null = null
    let pendingSplat: Splat | null = null
    let programs: Programs | null = null
    let fbos: FBOs | null = null
    let dims: Dims = { width: 0, height: 0, simWidth: 0, simHeight: 0 }
    let colors: Colors = { water: [0.14, 0.16, 0.17], foam: [0.86, 0.83, 0.75], ember: [0.7, 0.14, 0.03], idleAlpha: 0.2 }

    // ── Color refresh ────────────────────────────────────────────────────────
    function refreshColors() {
      const style = getComputedStyle(document.documentElement)
      const paper = hexToRgb(style.getPropertyValue('--color-paper'), [0.93, 0.89, 0.82])
      const dark = luminance(paper) < 0.24
      colors = {
        water: dark ? [0.14, 0.16, 0.17] : [0.13, 0.15, 0.16],
        foam: dark ? [0.86, 0.83, 0.75] : [0.15, 0.13, 0.1],
        ember: hexToRgb(style.getPropertyValue('--color-signal'), [0.7, 0.14, 0.03]),
        idleAlpha: dark ? 0.2 : 0.12,
      }
    }

    // ── FBO helpers ──────────────────────────────────────────────────────────
    function makeFBO(w: number, h: number): FBO | null {
      if (!gl) return null
      const tex = gl.createTexture()
      const fb = gl.createFramebuffer()
      if (!tex || !fb) return null
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      if (!ok) { gl.deleteTexture(tex); gl.deleteFramebuffer(fb); return null }
      return { texture: tex, framebuffer: fb }
    }

    function dropFBO(fbo: FBO | null) {
      if (!gl || !fbo) return
      gl.deleteTexture(fbo.texture)
      gl.deleteFramebuffer(fbo.framebuffer)
    }

    function makeDouble(w: number, h: number): DoubleFBO | null {
      const a = makeFBO(w, h)
      const b = makeFBO(w, h)
      return a && b ? { read: a, write: b } : null
    }

    function swap(d: DoubleFBO) { const t = d.read; d.read = d.write; d.write = t }

    function dropAll() {
      if (!fbos) return
      dropFBO(fbos.velocity.read); dropFBO(fbos.velocity.write)
      dropFBO(fbos.dye.read); dropFBO(fbos.dye.write)
      dropFBO(fbos.pressure.read); dropFBO(fbos.pressure.write)
      dropFBO(fbos.divergence); dropFBO(fbos.curl); dropFBO(fbos.banks)
      fbos = null
    }

    // ── Render helpers ───────────────────────────────────────────────────────
    function bindFBO(fbo: FBO | null, w = dims.simWidth, h = dims.simHeight) {
      if (!gl) return
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo?.framebuffer ?? null)
      gl.viewport(0, 0, w, h)
    }

    function clearFBO(fbo: FBO | null) {
      if (!gl) return
      bindFBO(fbo)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }

    function bindTex(unit: number, tex: WebGLTexture | null, loc: WebGLUniformLocation | null) {
      if (!gl) return
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.uniform1i(loc, unit)
    }

    function draw(prog: Prog, target: FBO | null, w = dims.simWidth, h = dims.simHeight) {
      if (!gl) return
      bindFBO(target, w, h)
      gl.useProgram(prog.program)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    // ── Splat ────────────────────────────────────────────────────────────────
    function splatBuffer(buf: DoubleFBO, value: RGB, pt: Omit<Splat, 'color'>) {
      if (!gl || !fbos || !programs) return
      const p = programs.splat
      gl.useProgram(p.program)
      gl.uniform2f(p.uniforms.u_point, pt.x, pt.y)
      gl.uniform1f(p.uniforms.u_radius, pt.radius)
      gl.uniform1f(p.uniforms.u_aspect, dims.width / Math.max(1, dims.height))
      bindTex(0, buf.read.texture, p.uniforms.u_source)
      bindTex(1, fbos.banks.texture, p.uniforms.u_bank)
      gl.uniform3f(p.uniforms.u_value, ...value)
      draw(p, buf.write)
      swap(buf)
    }

    function applySplat(s: Splat) {
      if (!fbos) return
      splatBuffer(fbos.velocity, [s.dx, s.dy, 0], s)
      splatBuffer(fbos.dye, s.color, s)
    }

    function idleSeed(t: number) {
      if (!fbos) return
      const ts = t / 1000
      const velDy = Math.cos(ts * 1.1) * 0.55
      splatBuffer(fbos.velocity, [4.6, velDy, 0], {
        x: 0.042, y: 0.285 + Math.sin(ts * 0.74) * 0.045,
        dx: 4.6, dy: velDy, radius: 0.032,
      })
      const lanes = [0.105, 0.195, 0.285, 0.375, 0.455]
      for (let i = 0; i < lanes.length; i++) {
        splatBuffer(fbos.dye, [0.24 - i * 0.02, 0.2 - i * 0.017, 0.13 - i * 0.01], {
          x: 0.022, y: lanes[i] + Math.sin(ts * 0.8 + i * 1.8) * 0.012,
          dx: 0, dy: 0, radius: 0.00052,
        })
      }
    }

    // ── Seed (initial dye pattern) ────────────────────────────────────────────
    function renderSeed() {
      if (!gl || !fbos || !programs) return
      const p = programs.seed
      gl.useProgram(p.program)
      bindTex(0, fbos.banks.texture, p.uniforms.u_bank)
      draw(p, fbos.dye.read)
    }

    // ── Simulation step ───────────────────────────────────────────────────────
    function step(dt: number, t: number) {
      if (!gl || !fbos || !programs) return
      const tx = 1 / dims.simWidth
      const ty = 1 / dims.simHeight

      if (pendingSplat) { applySplat(pendingSplat); pendingSplat = null }
      if (t - lastSeedTime > 245) { lastSeedTime = t; idleSeed(t) }

      const { advect, drift, curl, vorticity, divergence, pressure, gradient } = programs

      // advect velocity
      gl.useProgram(advect.program)
      gl.uniform2f(advect.uniforms.u_texel, tx, ty)
      gl.uniform1f(advect.uniforms.u_dt, dt)
      gl.uniform1f(advect.uniforms.u_dissipation, 0.994)
      bindTex(0, fbos.velocity.read.texture, advect.uniforms.u_velocity)
      bindTex(1, fbos.velocity.read.texture, advect.uniforms.u_source)
      bindTex(2, fbos.banks.texture, advect.uniforms.u_bank)
      draw(advect, fbos.velocity.write)
      swap(fbos.velocity)

      // drift
      gl.useProgram(drift.program)
      gl.uniform2f(drift.uniforms.u_texel, tx, ty)
      gl.uniform1f(drift.uniforms.u_time, t / 1000)
      gl.uniform1f(drift.uniforms.u_dt, dt)
      bindTex(0, fbos.velocity.read.texture, drift.uniforms.u_velocity)
      bindTex(1, fbos.banks.texture, drift.uniforms.u_bank)
      draw(drift, fbos.velocity.write)
      swap(fbos.velocity)

      // curl
      gl.useProgram(curl.program)
      gl.uniform2f(curl.uniforms.u_texel, tx, ty)
      bindTex(0, fbos.velocity.read.texture, curl.uniforms.u_velocity)
      bindTex(1, fbos.banks.texture, curl.uniforms.u_bank)
      draw(curl, fbos.curl)

      // vorticity
      gl.useProgram(vorticity.program)
      gl.uniform2f(vorticity.uniforms.u_texel, tx, ty)
      gl.uniform1f(vorticity.uniforms.u_dt, dt)
      gl.uniform1f(vorticity.uniforms.u_confinement, 13)
      bindTex(0, fbos.velocity.read.texture, vorticity.uniforms.u_velocity)
      bindTex(1, fbos.curl.texture, vorticity.uniforms.u_curl)
      bindTex(2, fbos.banks.texture, vorticity.uniforms.u_bank)
      draw(vorticity, fbos.velocity.write)
      swap(fbos.velocity)

      // divergence
      gl.useProgram(divergence.program)
      gl.uniform2f(divergence.uniforms.u_texel, tx, ty)
      bindTex(0, fbos.velocity.read.texture, divergence.uniforms.u_velocity)
      bindTex(1, fbos.banks.texture, divergence.uniforms.u_bank)
      draw(divergence, fbos.divergence)

      // pressure solve (24 iterations)
      clearFBO(fbos.pressure.read)
      clearFBO(fbos.pressure.write)
      gl.useProgram(pressure.program)
      gl.uniform2f(pressure.uniforms.u_texel, tx, ty)
      bindTex(1, fbos.divergence.texture, pressure.uniforms.u_divergence)
      bindTex(2, fbos.banks.texture, pressure.uniforms.u_bank)
      for (let i = 0; i < 24; i++) {
        bindTex(0, fbos.pressure.read.texture, pressure.uniforms.u_pressure)
        draw(pressure, fbos.pressure.write)
        swap(fbos.pressure)
      }

      // gradient subtract
      gl.useProgram(gradient.program)
      gl.uniform2f(gradient.uniforms.u_texel, tx, ty)
      bindTex(0, fbos.pressure.read.texture, gradient.uniforms.u_pressure)
      bindTex(1, fbos.velocity.read.texture, gradient.uniforms.u_velocity)
      bindTex(2, fbos.banks.texture, gradient.uniforms.u_bank)
      draw(gradient, fbos.velocity.write)
      swap(fbos.velocity)

      // advect dye
      gl.useProgram(advect.program)
      gl.uniform2f(advect.uniforms.u_texel, tx, ty)
      gl.uniform1f(advect.uniforms.u_dt, dt)
      gl.uniform1f(advect.uniforms.u_dissipation, 0.999)
      bindTex(0, fbos.velocity.read.texture, advect.uniforms.u_velocity)
      bindTex(1, fbos.dye.read.texture, advect.uniforms.u_source)
      bindTex(2, fbos.banks.texture, advect.uniforms.u_bank)
      draw(advect, fbos.dye.write)
      swap(fbos.dye)
    }

    // ── Display ───────────────────────────────────────────────────────────────
    function renderDisplay() {
      if (!gl || !fbos || !programs) return
      const p = programs.display
      bindFBO(null, dims.width, dims.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(p.program)
      bindTex(0, fbos.dye.read.texture, p.uniforms.u_dye)
      bindTex(1, fbos.velocity.read.texture, p.uniforms.u_velocity)
      bindTex(2, fbos.banks.texture, p.uniforms.u_bank)
      gl.uniform2f(p.uniforms.u_texel, 1 / dims.simWidth, 1 / dims.simHeight)
      gl.uniform3f(p.uniforms.u_water, ...colors.water)
      gl.uniform3f(p.uniforms.u_foam, ...colors.foam)
      gl.uniform3f(p.uniforms.u_ember, ...colors.ember)
      gl.uniform1f(p.uniforms.u_idleAlpha, colors.idleAlpha)
      draw(p, null, dims.width, dims.height)
    }

    // ── Teardown ──────────────────────────────────────────────────────────────
    function teardown() {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = 0
      delete container.dataset.northwaterReady
      canvas.style.display = 'none'
    }

    // ── Resize ────────────────────────────────────────────────────────────────
    function resize() {
      if (!gl) return
      const rect = container.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      const sw = Math.max(260, Math.min(560, Math.round(w * 0.48)))
      const sh = Math.max(112, Math.min(144, Math.round(sw * h / w)))
      if (w === dims.width && h === dims.height && sw === dims.simWidth && sh === dims.simHeight) return
      dims = { width: w, height: h, simWidth: sw, simHeight: sh }
      canvas.width = w
      canvas.height = h
      dropAll()

      const vel = makeDouble(sw, sh)
      const dye = makeDouble(sw, sh)
      const pres = makeDouble(sw, sh)
      const divFBO = makeFBO(sw, sh)
      const curlFBO = makeFBO(sw, sh)
      const banks = makeFBO(sw, sh)
      if (!vel || !dye || !pres || !divFBO || !curlFBO || !banks) { teardown(); return }

      fbos = { velocity: vel, dye, pressure: pres, divergence: divFBO, curl: curlFBO, banks }
      clearFBO(vel.read); clearFBO(vel.write)
      clearFBO(dye.read); clearFBO(dye.write)
      clearFBO(pres.read); clearFBO(pres.write)
      clearFBO(divFBO); clearFBO(curlFBO); clearFBO(banks)

      if (!programs?.mask) { teardown(); return }
      gl.useProgram(programs.mask.program)
      gl.uniform2f(programs.mask.uniforms.u_texel, 1 / sw, 1 / sh)
      draw(programs.mask, banks)
      renderSeed()
      lastSeedTime = 0
    }

    // ── Init WebGL ────────────────────────────────────────────────────────────
    function initGL(): boolean {
      if (gl || destroyed || prefersReducedMotion()) return !!gl
      gl = canvas.getContext('webgl2', {
        alpha: true, antialias: false, powerPreference: 'low-power', premultipliedAlpha: true,
      }) as WebGL2RenderingContext | null
      if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
        gl = null; canvas.style.display = 'none'; return false
      }
      const vao = gl.createVertexArray()
      if (!vao) return false
      gl.bindVertexArray(vao)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.BLEND)

      const mask = createProgram(gl, MASK, ['u_texel'])
      const seed = createProgram(gl, SEED, ['u_bank'])
      const splat = createProgram(gl, SPLAT, ['u_source', 'u_bank', 'u_point', 'u_value', 'u_radius', 'u_aspect'])
      const advect = createProgram(gl, ADVECT, ['u_velocity', 'u_source', 'u_bank', 'u_texel', 'u_dt', 'u_dissipation'])
      const driftP = createProgram(gl, DRIFT, ['u_velocity', 'u_bank', 'u_texel', 'u_time', 'u_dt'])
      const divP = createProgram(gl, DIVERGENCE, ['u_velocity', 'u_bank', 'u_texel'])
      const pres = createProgram(gl, PRESSURE, ['u_pressure', 'u_divergence', 'u_bank', 'u_texel'])
      const grad = createProgram(gl, GRADIENT, ['u_pressure', 'u_velocity', 'u_bank', 'u_texel'])
      const curlP = createProgram(gl, CURL, ['u_velocity', 'u_bank', 'u_texel'])
      const vort = createProgram(gl, VORTICITY, ['u_velocity', 'u_curl', 'u_bank', 'u_texel', 'u_dt', 'u_confinement'])
      const disp = createProgram(gl, DISPLAY, ['u_dye', 'u_velocity', 'u_bank', 'u_texel', 'u_water', 'u_foam', 'u_ember', 'u_idleAlpha'])

      if (!mask || !seed || !splat || !advect || !driftP || !divP || !pres || !grad || !curlP || !vort || !disp) {
        teardown(); return false
      }
      programs = {
        mask, seed, splat, advect, drift: driftP, divergence: divP,
        pressure: pres, gradient: grad, curl: curlP, vorticity: vort, display: disp,
      }
      refreshColors()
      resize()
      return !!fbos
    }

    // ── RAF loop ──────────────────────────────────────────────────────────────
    function loop(timestamp: number) {
      if (destroyed || !isVisible || document.hidden || prefersReducedMotion()) { rafId = 0; return }
      if (!initGL() || !gl || !fbos) { rafId = 0; return }

      const targetInterval = pendingSplat ? 1000 / 38 : 1000 / 23
      if (!lastFrameTime || timestamp - lastFrameTime >= targetInterval) {
        const dt = Math.min(0.04, Math.max(0.012, (timestamp - (lastFrameTime || timestamp)) / 1000))
        lastFrameTime = timestamp
        step(dt, timestamp)
        renderDisplay()
        container.dataset.northwaterReady = 'true'
        canvas.style.display = ''
      }
      rafId = requestAnimationFrame(loop)
    }

    function startLoop() {
      if (rafId || !isVisible || document.hidden || prefersReducedMotion() || destroyed) return
      canvas.style.display = ''
      rafId = requestAnimationFrame(loop)
    }

    // ── Pointer interaction ───────────────────────────────────────────────────
    function onPointerMove(e: PointerEvent) {
      if (prefersReducedMotion() || !isVisible) return
      const rect = container.getBoundingClientRect()
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        lastPointer = null; return
      }
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const y = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
      const prev = lastPointer
      lastPointer = { x, y }
      if (!prev) return
      const dx = Math.max(-4.5, Math.min(4.5, (x - prev.x) * 56))
      const dy = Math.max(-4.5, Math.min(4.5, (y - prev.y) * 56))
      if (Math.abs(dx) + Math.abs(dy) < 0.02) return
      pendingSplat = { x, y, dx, dy, color: [0.42, 0.36, 0.23], radius: 0.0022 }
      startLoop()
    }

    function onPointerLeave() { lastPointer = null }

    // ── Observers ─────────────────────────────────────────────────────────────
    const intersectionObs = new IntersectionObserver(
      entries => { isVisible = entries.some(e => e.isIntersecting); if (isVisible) startLoop() },
      { rootMargin: '120px 0px' }
    )
    intersectionObs.observe(container)

    const resizeObs = new ResizeObserver(() => { if (gl) resize() })
    resizeObs.observe(container)

    const mutationObs = new MutationObserver(() => {
      refreshColors()
      if (prefersReducedMotion()) {
        if (rafId) cancelAnimationFrame(rafId)
        rafId = 0
        delete container.dataset.northwaterReady
        gl?.clear(gl.COLOR_BUFFER_BIT)
      } else {
        startLoop()
      }
    })
    mutationObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion', 'data-theme'] })

    const mqReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMotionChange = () => { mqReducedMotion.matches ? delete container.dataset.northwaterReady : startLoop() }
    mqReducedMotion.addEventListener('change', onMotionChange)

    const onVisibilityChange = () => { if (!document.hidden) startLoop() }
    document.addEventListener('visibilitychange', onVisibilityChange)

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); teardown() }, { passive: false })

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    container.addEventListener('pointerleave', onPointerLeave, { passive: true })

    return () => {
      destroyed = true
      if (rafId) cancelAnimationFrame(rafId)
      intersectionObs.disconnect()
      resizeObs.disconnect()
      mutationObs.disconnect()
      mqReducedMotion.removeEventListener('change', onMotionChange)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerleave', onPointerLeave)
      delete container.dataset.northwaterReady
      dropAll()
      if (gl && programs) {
        Object.values(programs).forEach(p => gl!.deleteProgram(p.program))
      }
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="northwater__canvas"
      data-northwater-canvas=""
      style={{ display: 'none' }}
      aria-hidden="true"
    />
  )
}
