import { CLEAR_COLOR, SHADING_GLSL } from './shading';
import { POINT_FLOATS, type DrawRange, type FrameUniforms, type PointCloudBacking } from './types';

// Points unfold from a 1D index into a 4096-wide RGBA32F texture.
const TEX_WIDTH_SHIFT = 12;
const TEX_WIDTH = 1 << TEX_WIDTH_SHIFT;
const TEX_WIDTH_MASK = TEX_WIDTH - 1;

const VERTEX = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform mat4 u_viewProj;
uniform vec4 u_camRight;   // xyz = right, w = point size
uniform vec4 u_camUp;      // xyz = up, w = current time
uniform vec2 u_params;     // x = trail duration, y = channel
uniform int u_first;       // gl_InstanceID has no base instance, so each draw sets its offset
uniform float u_sweepTime;
uniform sampler2D u_points;

out vec2 v_uv;
out float v_alpha;
out vec3 v_color;

const vec2 QUAD[4] = vec2[4](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0));
${SHADING_GLSL}

void main() {
  int idx = u_first + gl_InstanceID;
  vec4 pt = texelFetch(u_points, ivec2(idx & ${TEX_WIDTH_MASK}, idx >> ${TEX_WIDTH_SHIFT}), 0);
  float age = 1.0 - (u_camUp.w - u_sweepTime) / max(u_params.x, 0.0001);
  vec2 uv = QUAD[gl_VertexID];
  vec3 world = pt.xyz + (u_camRight.xyz * uv.x + u_camUp.xyz * uv.y) * u_camRight.w;
  gl_Position = u_viewProj * vec4(world, 1.0);
  v_uv = uv;
  v_alpha = clamp(age, 0.0, 1.0);
  v_color = shade(pt, v_alpha, int(u_params.y));
}`;

const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
in float v_alpha;
in vec3 v_color;
out vec4 fragColor;

void main() {
  float r2 = dot(v_uv, v_uv);
  if (r2 > 1.0) discard;
  float a = (1.0 - r2 * 0.65) * v_alpha;
  fragColor = vec4(v_color * a, a);
}`;

type Uniform = 'viewProj' | 'camRight' | 'camUp' | 'params' | 'first' | 'sweepTime' | 'points';

export class WebGL2TextureBacking implements PointCloudBacking {
  readonly backendType = 'webgl2';
  capacityPoints = 0;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly loc: Record<Uniform, WebGLUniformLocation | null>;
  private texture?: WebGLTexture;

  static create(canvas: HTMLCanvasElement): WebGL2TextureBacking {
    const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 unavailable');
    return new WebGL2TextureBacking(gl);
  }

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = linkProgram(gl, VERTEX, FRAGMENT);
    const at = (name: Uniform) => gl.getUniformLocation(this.program, 'u_' + name);
    this.loc = {
      viewProj: at('viewProj'),
      camRight: at('camRight'),
      camUp: at('camUp'),
      params: at('params'),
      first: at('first'),
      sweepTime: at('sweepTime'),
      points: at('points'),
    };
    this.vao = gl.createVertexArray();
  }

  allocate(maxPoints: number): void {
    const gl = this.gl;
    const height = Math.max(1, Math.ceil(maxPoints / TEX_WIDTH));
    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (height > maxSize) throw new Error(`Point texture needs ${height} rows, GPU allows ${maxSize}`);
    if (this.texture) gl.deleteTexture(this.texture);
    this.capacityPoints = height * TEX_WIDTH;
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, TEX_WIDTH, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Partial rows are written one at a time, whole rows in a single call. */
  uploadPoints(pointOffset: number, data: Float32Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture!);
    let remaining = data.length / POINT_FLOATS;
    let idx = pointOffset;
    let src = 0;
    while (remaining > 0) {
      const col = idx & TEX_WIDTH_MASK;
      const row = idx >> TEX_WIDTH_SHIFT;
      const partial = col > 0 || remaining < TEX_WIDTH;
      const width = partial ? Math.min(remaining, TEX_WIDTH - col) : TEX_WIDTH;
      const rows = partial ? 1 : Math.floor(remaining / TEX_WIDTH);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, col, row, width, rows, gl.RGBA, gl.FLOAT, data, src);
      idx += width * rows;
      src += width * rows * POINT_FLOATS;
      remaining -= width * rows;
    }
  }

  resize(width: number, height: number): void {
    this.gl.viewport(0, 0, width, height);
  }

  render(u: FrameUniforms, ranges: DrawRange[]): void {
    const { gl, loc } = this;
    gl.clearColor(...CLEAR_COLOR, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.texture || ranges.length === 0) return;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(loc.points, 0);
    gl.uniformMatrix4fv(loc.viewProj, false, u.viewProjection);
    gl.uniform4f(loc.camRight, ...u.cameraRight, u.pointSize);
    gl.uniform4f(loc.camUp, ...u.cameraUp, u.currentTime);
    gl.uniform2f(loc.params, u.trailDuration, u.channel);
    for (const range of ranges) {
      gl.uniform1i(loc.first, range.first);
      gl.uniform1f(loc.sweepTime, range.time);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, range.count);
    }
  }

  dispose(): void {
    const gl = this.gl;
    if (this.texture) gl.deleteTexture(this.texture);
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}

function linkProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(shader));
    }
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Program link failed: ' + gl.getProgramInfoLog(program));
  }
  return program;
}
