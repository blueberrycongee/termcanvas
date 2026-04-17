/**
 * GLSL shaders for the WebGL2 terminal renderer.
 *
 * Earlier iteration ran gamma-correct (linearize inputs / unlinearize
 * outputs). Looked right in theory, but the clear-color + bg-pass
 * output path was inconsistent — clearColor fed a linear RGB tuple
 * straight into the display framebuffer while the text fragment
 * unlinearized before output. Result was a grid where background
 * cells appeared dimmer than the surrounding clear area, glyphs
 * looked washed out, and the overall tile had a weird gray cast
 * the user called out.
 *
 * Pragmatic simplification: stay in sRGB throughout. Display
 * framebuffers in WebGL2 default contexts are not sRGB-aware, so the
 * shader output IS the displayed byte. Gamma-correct blending at
 * glyph edges is a real improvement (see Ghostty's cell_text.f.glsl
 * `use_linear_correction` path) but we'll reintroduce it only after
 * the baseline display is correct — edge AA is a fix on top of
 * "colours are right", not a substitute for it.
 *
 * Vertex shader also simplifies: `bearings` are now stored in the
 * atlas as direct offsets from the cell's top-left to the glyph's
 * top-left ink pixel. No inversion in the shader. The Ghostty
 * convention (bearings.y = distance from cell bottom to glyph top)
 * makes sense when you're integrating with FreeType which reports
 * bearings from the baseline up; our Canvas2D-based atlas natively
 * knows the cell-top-to-ink-top distance, so we skip the conversion
 * and let the shader be trivial.
 */

export const CELL_BG_VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;

void main() {
  vec2 corner = vec2(
    float((gl_VertexID & 1) == 1),
    float((gl_VertexID & 2) == 2)
  );
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const CELL_BG_FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D u_cellColors; // RGBA8UI per cell, sRGB bytes
uniform vec2 u_cellSize;
uniform vec2 u_screenSize;
uniform ivec2 u_gridSize;
uniform vec4 u_globalBg;         // sRGB 0..1

out vec4 outColor;

void main() {
  // gl_FragCoord has (0,0) at bottom-left in WebGL; our grid coords
  // are top-left origin. Flip Y so cell (0, 0) is at the top row.
  vec2 pixel = gl_FragCoord.xy;
  pixel.y = u_screenSize.y - pixel.y;

  ivec2 cell = ivec2(floor(pixel / u_cellSize));
  if (cell.x < 0 || cell.x >= u_gridSize.x ||
      cell.y < 0 || cell.y >= u_gridSize.y) {
    outColor = u_globalBg;
    return;
  }

  uvec4 packed = texelFetch(u_cellColors, cell, 0);
  vec4 cellBg = vec4(packed) / 255.0;
  if (cellBg.a == 0.0) {
    // Sentinel: cell uses default theme bg.
    outColor = u_globalBg;
    return;
  }
  // Composite sRGB over sRGB. Non-physically-correct at partial
  // transparency but that's also what xterm.js / ghostty-web's own
  // Canvas2D renderer did; keeps visuals predictable.
  outColor = vec4(
    cellBg.rgb * cellBg.a + u_globalBg.rgb * (1.0 - cellBg.a),
    1.0
  );
}
`;

export const CELL_TEXT_VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in uvec2 a_glyph_pos;    // atlas top-left (device px)
layout(location = 1) in uvec2 a_glyph_size;   // atlas tile size (device px)
layout(location = 2) in ivec2 a_bearings;     // direct offsets from cell TL to glyph TL
layout(location = 3) in uvec2 a_grid_pos;     // cell (col, row)
layout(location = 4) in uvec4 a_color;        // RGBA 0..255, sRGB
layout(location = 5) in uint a_flags;

uniform vec2 u_cellSize;
uniform vec2 u_screenSize;
uniform ivec2 u_atlasSize;

out vec2 v_uv;
flat out vec4 v_color;
flat out uint v_flags;

void main() {
  vec2 corner = vec2(
    float((gl_VertexID & 1) == 1),
    float((gl_VertexID & 2) == 2)
  );

  vec2 glyph_size = vec2(a_glyph_size);
  vec2 cell_origin = vec2(a_grid_pos) * u_cellSize;
  vec2 offset = vec2(a_bearings);

  // Bearings are direct top-left offsets — no cell-height subtraction.
  vec2 pixel = cell_origin + glyph_size * corner + offset;
  vec2 clip = (pixel / u_screenSize) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);

  vec2 atlas_pos = vec2(a_glyph_pos) + glyph_size * corner;
  v_uv = atlas_pos / vec2(u_atlasSize);

  // sRGB 0..1, non-premultiplied. Fragment shader premultiplies with
  // coverage and emits sRGB unchanged.
  v_color = vec4(a_color) / 255.0;
  v_flags = a_flags;
}
`;

export const CELL_TEXT_FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D u_atlas;

in vec2 v_uv;
flat in vec4 v_color;
flat in uint v_flags;

out vec4 outColor;

const uint FLAG_IS_UNDERLINE = 2u;
const uint FLAG_IS_STRIKETHROUGH = 4u;

void main() {
  if ((v_flags & FLAG_IS_UNDERLINE) != 0u ||
      (v_flags & FLAG_IS_STRIKETHROUGH) != 0u) {
    // Solid fill (cursor, underline, strikethrough). Pre-multiply
    // inline so the gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA) contract
    // stays consistent across both paths.
    outColor = vec4(v_color.rgb * v_color.a, v_color.a);
    return;
  }
  float coverage = texture(u_atlas, v_uv).r;
  float alpha = v_color.a * coverage;
  outColor = vec4(v_color.rgb * alpha, alpha);
}
`;

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("[webgl] shader alloc failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`[webgl] shader compile failed: ${log}\nsource:\n${source}`);
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
  if (!program) throw new Error("[webgl] program alloc failed");
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
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}
