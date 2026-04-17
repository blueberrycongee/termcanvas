/**
 * GLSL shaders for the WebGL2 terminal renderer. Adapted from
 * Ghostty's `cell_text.v.glsl` / `cell_text.f.glsl` / `cell_bg.f.glsl`
 * (see `thirdparty/ghostty/src/renderer/shaders/glsl/`), translated
 * from OpenGL 4.3 to WebGL2-compatible ES 3.00 GLSL:
 *
 *  - `layout(binding = N)` → set sampler uniform via
 *    `gl.uniform1i(loc, textureUnit)` CPU-side.
 *  - `sampler2DRect` → `sampler2D` + `texelFetch` for exact pixel
 *    sampling (or `texture()` with normalised coords since we
 *    pre-compute UVs on CPU from glyph atlas coords).
 *  - SSBOs (`layout(binding, std430) readonly buffer`) → either UBOs
 *    or a 2D texture carrying cell colours. We use the texture route
 *    for background cells because UBO size caps out at 64 KB in
 *    WebGL2, which is too small for a 4K-cell grid.
 *
 * Pipeline stages (mirrors Ghostty):
 *  1. `cell_bg` — full-screen triangle that samples per-cell colours
 *     from a texture and emits them as fragments. One draw call for
 *     the whole grid background.
 *  2. `cell_text` — instanced draw of per-glyph quads. Each instance
 *     carries `(glyph_atlas_pos, glyph_size, bearings, grid_pos,
 *     color, flags)`. Vertex ID (0..3) expands to the four corners
 *     via a triangle strip.
 *  3. `cursor` — a single quad drawn in the cursor's style, on top.
 *
 * Colour handling follows Ghostty: all inputs are assumed sRGB-
 * encoded, linearized into the shader for blending, then unlinearized
 * to sRGB on output. Gives correct antialiasing edges regardless of
 * whether the system framebuffer is sRGB-aware.
 */

export const CELL_BG_VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;

// Triangle strip covering NDC [-1,1] — 4 verts, one call, no buffer.
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

uniform usampler2D u_cellColors; // R8UI×4 texture, packed RGBA per cell
uniform vec2 u_cellSize;        // device pixels
uniform vec2 u_screenSize;      // device pixels
uniform ivec2 u_gridSize;       // cols, rows
uniform vec4 u_globalBg;        // theme.background, linearized

out vec4 outColor;

vec4 linearize(vec4 srgb) {
  bvec3 cutoff = lessThanEqual(srgb.rgb, vec3(0.04045));
  vec3 higher = pow((srgb.rgb + vec3(0.055)) / vec3(1.055), vec3(2.4));
  vec3 lower = srgb.rgb / vec3(12.92);
  return vec4(mix(higher, lower, cutoff), srgb.a);
}

vec4 unlinearize(vec4 linear) {
  bvec3 cutoff = lessThanEqual(linear.rgb, vec3(0.0031308));
  vec3 higher = pow(linear.rgb, vec3(1.0 / 2.4)) * vec3(1.055) - vec3(0.055);
  vec3 lower = linear.rgb * vec3(12.92);
  return vec4(mix(higher, lower, cutoff), linear.a);
}

void main() {
  // Compute grid cell from screen position. gl_FragCoord has (0,0) at
  // bottom-left in WebGL but Ghostty's bg shader uses top-left origin
  // via layout(origin_upper_left). We don't have that in WebGL2, so
  // flip Y CPU-side by reading rows in reverse.
  vec2 pixel = gl_FragCoord.xy;
  pixel.y = u_screenSize.y - pixel.y;

  ivec2 cell = ivec2(floor(pixel / u_cellSize));
  if (cell.x < 0 || cell.x >= u_gridSize.x ||
      cell.y < 0 || cell.y >= u_gridSize.y) {
    outColor = u_globalBg;
    return;
  }

  // Cell bg stored as non-premultiplied sRGB 8-bit RGBA. Pull, linearize,
  // premultiply.
  uvec4 packed = texelFetch(u_cellColors, cell, 0);
  vec4 cellBg = vec4(packed) / 255.0;
  // sentinel (0,0,0,0) = "default"; fall back to theme.background.
  if (cellBg.a == 0.0) {
    outColor = u_globalBg;
    return;
  }
  cellBg = linearize(cellBg);
  cellBg.rgb *= cellBg.a;
  // Composite onto theme.background (already linear + premultiplied).
  outColor = cellBg + u_globalBg * (1.0 - cellBg.a);
}
`;

export const CELL_TEXT_VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in uvec2 a_glyph_pos;    // atlas top-left (device px)
layout(location = 1) in uvec2 a_glyph_size;   // atlas tile size (device px)
layout(location = 2) in ivec2 a_bearings;     // glyph offset from cell top-left
layout(location = 3) in uvec2 a_grid_pos;     // cell (col, row)
layout(location = 4) in uvec4 a_color;        // RGBA 0..255, sRGB
layout(location = 5) in uint a_flags;         // see Flags below

uniform vec2 u_cellSize;      // device pixels per cell
uniform vec2 u_screenSize;    // device pixels
uniform ivec2 u_atlasSize;    // device pixels
uniform float u_cellHeight;   // device pixels; same as u_cellSize.y but explicit

out vec2 v_uv;               // atlas UV (0..1)
flat out vec4 v_color;       // linear premultiplied
flat out uint v_flags;

const uint FLAG_COLOR_GLYPH = 1u;
const uint FLAG_IS_UNDERLINE = 2u;
const uint FLAG_IS_STRIKETHROUGH = 4u;

vec4 linearize(vec4 srgb) {
  bvec3 cutoff = lessThanEqual(srgb.rgb, vec3(0.04045));
  vec3 higher = pow((srgb.rgb + vec3(0.055)) / vec3(1.055), vec3(2.4));
  vec3 lower = srgb.rgb / vec3(12.92);
  return vec4(mix(higher, lower, cutoff), srgb.a);
}

void main() {
  // Four-corner triangle strip: 0=TL, 1=TR, 2=BL, 3=BR
  vec2 corner = vec2(
    float((gl_VertexID & 1) == 1),
    float((gl_VertexID & 2) == 2)
  );

  vec2 glyph_size = vec2(a_glyph_size);
  vec2 cell_origin = vec2(a_grid_pos) * u_cellSize;

  // Glyph's top-left in the cell: bearingX right from cell-left,
  // (cellHeight - bearingY) down from cell-top (so the glyph's
  // baseline sits at cell_top + cellHeight - 0 = cell_bottom... no,
  // baseline sits at bearingY pixels below the glyph top).
  vec2 offset = vec2(a_bearings);
  offset.y = u_cellHeight - offset.y;

  vec2 pixel = cell_origin + glyph_size * corner + offset;
  // Convert device pixels → clip space. Origin top-left.
  vec2 clip = (pixel / u_screenSize) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);

  // Atlas UV, exact pixel coords mapped into [0..1].
  vec2 atlas_pos = vec2(a_glyph_pos) + glyph_size * corner;
  v_uv = atlas_pos / vec2(u_atlasSize);

  // Color: sRGB bytes → linear premultiplied.
  vec4 srgb = vec4(a_color) / 255.0;
  v_color = linearize(srgb);
  v_color.rgb *= v_color.a;
  v_flags = a_flags;
}
`;

export const CELL_TEXT_FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D u_atlas;     // grayscale R8 coverage

in vec2 v_uv;
flat in vec4 v_color;
flat in uint v_flags;

out vec4 outColor;

vec4 unlinearize(vec4 linear) {
  bvec3 cutoff = lessThanEqual(linear.rgb, vec3(0.0031308));
  vec3 higher = pow(linear.rgb, vec3(1.0 / 2.4)) * vec3(1.055) - vec3(0.055);
  vec3 lower = linear.rgb * vec3(12.92);
  return vec4(mix(higher, lower, cutoff), linear.a);
}

void main() {
  // Underline / strikethrough quads come through the same pipeline
  // but ignore the atlas — v_uv would sample outside any glyph and
  // we want solid fill, so we bypass atlas sampling.
  if ((v_flags & 2u) != 0u || (v_flags & 4u) != 0u) {
    outColor = unlinearize(v_color);
    return;
  }

  float coverage = texture(u_atlas, v_uv).r;
  vec4 linear_premul = v_color * coverage;
  // Unlinearize for output. Since alpha is premultiplied, divide out,
  // unlinearize RGB, re-multiply. Matches Ghostty's non-linear
  // blending path.
  if (linear_premul.a > 0.0) {
    vec4 color = linear_premul;
    color.rgb /= color.a;
    color = unlinearize(color);
    color.rgb *= color.a;
    outColor = color;
  } else {
    outColor = vec4(0.0);
  }
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
