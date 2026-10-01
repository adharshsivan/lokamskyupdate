// Single-draw-call environment renderer (1 fullscreen triangle, no textures, no depth buffer).
import { VERT, buildFrag } from './shaders';
import type { QualitySettings } from './performance';

export type UniformValue = number | Float32Array;
export type Uniforms = Record<string, UniformValue>;

export class EnvRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGLRenderingContext;
  private prog: WebGLProgram | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private quality: QualitySettings | null = null;
  private lost = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', {
      antialias: false, depth: false, stencil: false, alpha: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL not supported');
    this.gl = gl;
    this.initBuffers();
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);
  }

  private onLost = (e: Event) => { e.preventDefault(); this.lost = true; this.prog = null; };
  private onRestored = () => {
    this.lost = false;
    this.initBuffers();
    if (this.quality) this.setQuality(this.quality);
  };

  private initBuffers() {
    const gl = this.gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  }

  /** Compiles the shader variant for a quality tier. Returns false if compilation failed. */
  setQuality(q: QualitySettings): boolean {
    const gl = this.gl;
    if (this.lost) { this.quality = q; return true; }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[EnvRenderer] shader compile error:\n', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, buildFrag(q));
    if (!vs || !fs) return false;
    const p = gl.createProgram();
    if (!p) return false;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('[EnvRenderer] link error:\n', gl.getProgramInfoLog(p));
      gl.deleteProgram(p);
      return false;
    }
    if (this.prog) gl.deleteProgram(this.prog);
    this.prog = p;
    this.loc = {};
    this.quality = q;
    gl.useProgram(p);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return true;
  }

  resize(w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  render(u: Uniforms) {
    const gl = this.gl;
    if (!this.prog || this.lost) return;
    for (const k in u) {
      let l = this.loc[k];
      if (l === undefined) l = this.loc[k] = gl.getUniformLocation(this.prog, k);
      if (!l) continue;
      const v = u[k];
      if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v.length === 2) gl.uniform2fv(l, v);
      else if (v.length === 3) gl.uniform3fv(l, v);
      else if (v.length === 4) gl.uniform4fv(l, v);
      else if (v.length === 9) gl.uniformMatrix3fv(l, false, v);
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    if (this.prog && !this.lost) this.gl.deleteProgram(this.prog);
    this.prog = null;
  }
}
