/**
 * GLSL shader sources for the WebGL2 terminal renderer.
 *
 * Design:
 *  - Two draw calls per frame: one for cell backgrounds (solid-colour
 *    quads, no texture sample), one for glyphs (atlas-sampled quads,
 *    multiplied by per-cell foreground colour).
 *  - Cursor and selection overlays piggyback on the background draw:
 *    we just emit them as additional quads with their own colours,
 *    ordered after the normal cell backgrounds so they paint on top.
 *  - All vertex positions are in clip space (-1..1), built CPU-side
 *    from cell column/row + atlas metrics. Keeps the shader trivial
 *    and skips a matrix multiply per vertex — the grid is big and
 *    CPU-side batching beats GPU-side transformation here.
 *  - Glyph colour is stored as 8-bit RGB in a vec3 attribute; the
 *    atlas alpha channel acts as coverage. Fragment colour is
 *    `fgColor * atlasSample.a`, which gives us straight grayscale AA
 *    for now. Subpixel LCD would sample RGB from the atlas and use a
 *    different blend — leaving that for a follow-up.
 */

export const BG_VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 a_position;   // clip-space, pre-multiplied CPU-side
in vec4 a_color;      // RGBA 0..1

out vec4 v_color;

void main() {
  v_color = a_color;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const BG_FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec4 v_color;
out vec4 outColor;

void main() {
  outColor = v_color;
}
`;

export const GLYPH_VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 a_position;   // clip-space
in vec2 a_uv;         // atlas UV (0..1)
in vec4 a_color;      // fg RGBA 0..1

out vec2 v_uv;
out vec4 v_color;

void main() {
  v_uv = a_uv;
  v_color = a_color;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const GLYPH_FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
in vec4 v_color;

uniform sampler2D u_atlas;

out vec4 outColor;

void main() {
  // Grayscale coverage from the atlas's alpha channel. RGB channels
  // in the atlas carry the rasterized colour (white, since we tint
  // CPU-side), which we ignore here — the fg tint comes from v_color.
  //
  // Pre-multiply alpha: the gl.blendFunc is (ONE, ONE_MINUS_SRC_ALPHA),
  // which expects src.rgb to already carry the alpha factor. Without
  // the multiply, partial-coverage pixels at glyph edges add
  // unscaled fg colour on top of the background — each character ends
  // up ringed by a too-bright halo that visually reads as a white
  // background behind the character.
  float alpha = v_color.a * texture(u_atlas, v_uv).a;
  outColor = vec4(v_color.rgb * alpha, alpha);
}
`;

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("[webgl] failed to allocate shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`[webgl] shader compile failed: ${log}`);
  }
  return shader;
}

export function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error("[webgl] failed to allocate program");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error(`[webgl] program link failed: ${log}`);
  }
  // Shaders can be detached after linking — they stay alive via the
  // program's reference and GC-able independently.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}
