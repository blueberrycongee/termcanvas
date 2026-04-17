/**
 * WebGL2 terminal renderer, architecture adapted from Ghostty's native
 * OpenGL backend (`thirdparty/ghostty/src/renderer/opengl/` and
 * shaders at `.../shaders/glsl/`). We reimplement the render graph in
 * TypeScript and substitute WebGL2-available APIs for the pieces that
 * need desktop-OpenGL features Ghostty relies on:
 *
 *  - Cell backgrounds: a single full-screen triangle strip. Fragment
 *    shader samples a `usampler2D` carrying one RGBA8 texel per cell,
 *    indexed by derived grid coords. Ghostty uses an SSBO here;
 *    WebGL2 has no SSBO, but a texture gives us the same effect and
 *    costs ~4 bytes per cell per frame to upload.
 *  - Cell text: instanced rendering, 4 verts per glyph via triangle
 *    strip. Per-instance attributes mirror Ghostty's `CellText`
 *    struct (`glyph_pos`, `glyph_size`, `bearings`, `grid_pos`,
 *    `color`, `flags`). Vertex shader uses bearings to place the
 *    glyph quad inside the cell, not the cell-sized tile the MVP
 *    was using — gives pixel-perfect glyph positioning with
 *    ascenders/descenders drawn where they actually belong.
 *  - Colour: all inputs sRGB bytes. Shader linearizes for blend,
 *    unlinearizes for output. Eliminates the halo/edge-brightening
 *    bug our MVP's grayscale-blend path suffered from and matches
 *    Ghostty's default `cell_text.f.glsl` path.
 *  - Cursor: emitted as an extra "glyph" instance with the cursor
 *    colour and the FLAG_IS_BLOCK/UNDERLINE/BAR bit; fragment shader
 *    bypasses atlas sampling for these.
 *  - Underline / strikethrough: same trick — emit an instance with
 *    a line-primitive flag; fragment fills solid instead of sampling
 *    the atlas.
 *
 * What's still not here (follow-up phases):
 *  - Font shaping via harfbuzz-wasm for ligatures.
 *  - Colour glyph atlas for emoji.
 *  - Minimum contrast ratio enforcement (Ghostty has this but it
 *    interacts with theme.foreground semantics that we haven't wired
 *    through the cell data yet).
 *  - Box-drawing character precision (Ghostty generates these
 *    procedurally in its own atlas; we fall back to font rendering).
 *  - Image protocols.
 */

import type { GhosttyCell } from "ghostty-web";

import { GlyphAtlas, type FontMetrics } from "./GlyphAtlas.ts";
import {
  CELL_BG_FRAGMENT_SHADER,
  CELL_BG_VERTEX_SHADER,
  CELL_TEXT_FRAGMENT_SHADER,
  CELL_TEXT_VERTEX_SHADER,
  linkProgram,
} from "./shaders.ts";

interface Theme {
  background?: string;
  foreground?: string;
  cursor?: string;
  selectionBackground?: string;
  selectionForeground?: string;
}

interface RendererOptions {
  fontSize: number;
  fontFamily: string;
  theme: Theme;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
  devicePixelRatio?: number;
}

interface ScrollbackSource {
  getScrollbackLength(): number;
  getScrollbackLine(offset: number): GhosttyCell[] | null;
}

interface WasmTerm {
  getViewport(): GhosttyCell[];
  getLine(y: number): GhosttyCell[] | null;
  getDimensions(): { cols: number; rows: number };
  getCursor(): { x: number; y: number; visible: boolean };
  isRowDirty(y: number): boolean;
  clearDirty(): void;
  getGraphemeString?: (row: number, col: number) => string;
}

const FLAG_BOLD = 1;
const FLAG_ITALIC = 2;
const FLAG_UNDERLINE = 4;
const FLAG_STRIKETHROUGH = 8;
const FLAG_INVERSE = 16;
const FLAG_INVISIBLE = 64;
const FLAG_FAINT = 128;

// Instance struct flags (matches fragment shader constants)
const INST_FLAG_IS_UNDERLINE = 2;
const INST_FLAG_IS_STRIKETHROUGH = 4;

// Per-instance CellText attribute struct, laid out to match
// `a_glyph_pos/a_glyph_size/a_bearings/a_grid_pos/a_color/a_flags`:
//   uvec2 glyph_pos   (8 bytes)
//   uvec2 glyph_size  (8 bytes)
//   ivec2 bearings    (8 bytes, i32×2 — we could use i16×2 but keep
//                     i32 because vertexAttribIPointer doesn't allow
//                     non-4-byte stride alignment for i16 in WebGL2)
//   uvec2 grid_pos    (8 bytes, u32×2 for the same reason)
//   uvec4 color       (4 bytes, u8×4)
//   uint  flags       (4 bytes)
// Total: 40 bytes per instance. Packable to 32 with i16 grid + u8 flags
// but we're nowhere near bandwidth-bound so clarity wins.
const INSTANCE_FLOATS = 0;
const INSTANCE_BYTES = 40;

function parseColor(
  css: string | undefined,
  fallback: [number, number, number, number],
): [number, number, number, number] {
  if (!css) return fallback;
  if (css.startsWith("#")) {
    let hex = css.slice(1);
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return [r, g, b, a];
    }
  }
  const rgb = css.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const parts = rgb[1].split(",").map((s) => parseFloat(s.trim()));
    const r = (parts[0] ?? 0) / 255;
    const g = (parts[1] ?? 0) / 255;
    const b = (parts[2] ?? 0) / 255;
    const a = parts.length >= 4 ? (parts[3] ?? 1) : 1;
    return [r, g, b, a];
  }
  return fallback;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearizeAndPremul(
  c: [number, number, number, number],
): [number, number, number, number] {
  const r = srgbToLinear(c[0]) * c[3];
  const g = srgbToLinear(c[1]) * c[3];
  const b = srgbToLinear(c[2]) * c[3];
  return [r, g, b, c[3]];
}

export class GhosttyWebGLRenderer {
  readonly canvas: HTMLCanvasElement;

  private readonly gl: WebGL2RenderingContext;
  private readonly atlas: GlyphAtlas;

  // Programs
  private readonly bgProgram: WebGLProgram;
  private readonly textProgram: WebGLProgram;

  // BG program uniforms
  private readonly uBgCellColors: WebGLUniformLocation;
  private readonly uBgCellSize: WebGLUniformLocation;
  private readonly uBgScreenSize: WebGLUniformLocation;
  private readonly uBgGridSize: WebGLUniformLocation;
  private readonly uBgGlobalBg: WebGLUniformLocation;

  // Text program uniforms
  private readonly uTxAtlas: WebGLUniformLocation;
  private readonly uTxCellSize: WebGLUniformLocation;
  private readonly uTxScreenSize: WebGLUniformLocation;
  private readonly uTxAtlasSize: WebGLUniformLocation;
  private readonly uTxCellHeight: WebGLUniformLocation;

  // Cell bg texture — one RGBA8 texel per cell, updated per frame.
  private cellColorTexture: WebGLTexture;
  private cellColorBuffer = new Uint8Array(0);
  private cellColorWidth = 0;
  private cellColorHeight = 0;

  // Instance buffer for text glyphs.
  private readonly textVao: WebGLVertexArrayObject;
  private readonly textInstanceBuffer: WebGLBuffer;
  private instanceBuffer = new ArrayBuffer(0);
  private instanceView = new DataView(this.instanceBuffer);

  private cols = 80;
  private rows = 24;
  private fontFamily: string;
  private fontSize: number;
  private cursorStyle: "block" | "bar" | "underline";
  private cursorBlink: boolean;
  private theme: Theme;
  private devicePixelRatio: number;

  private selectionManager: {
    hasSelection(): boolean;
    getSelectionCoords(): {
      startRow: number;
      startCol: number;
      endRow: number;
      endCol: number;
    } | null;
    getDirtySelectionRows(): Set<number>;
    clearDirtySelectionRows(): void;
  } | null = null;

  hoveredHyperlinkId = 0;
  private hoveredLinkRange: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null = null;

  private disposed = false;
  private loggedFirstFrame = false;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions) {
    this.canvas = canvas;
    this.fontFamily = options.fontFamily;
    this.fontSize = options.fontSize;
    this.cursorStyle = options.cursorStyle;
    this.cursorBlink = options.cursorBlink;
    this.theme = options.theme ?? {};
    this.devicePixelRatio =
      options.devicePixelRatio ?? window.devicePixelRatio ?? 1;

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      throw new Error(
        "[webgl] WebGL2 unavailable — cannot initialise Ghostty WebGL renderer",
      );
    }
    this.gl = gl;

    this.atlas = new GlyphAtlas(gl);
    this.atlas.setFont(this.fontFamily, this.fontSize, this.devicePixelRatio);

    this.bgProgram = linkProgram(gl, CELL_BG_VERTEX_SHADER, CELL_BG_FRAGMENT_SHADER);
    this.textProgram = linkProgram(
      gl,
      CELL_TEXT_VERTEX_SHADER,
      CELL_TEXT_FRAGMENT_SHADER,
    );

    this.uBgCellColors = this.mustGetUniform(this.bgProgram, "u_cellColors");
    this.uBgCellSize = this.mustGetUniform(this.bgProgram, "u_cellSize");
    this.uBgScreenSize = this.mustGetUniform(this.bgProgram, "u_screenSize");
    this.uBgGridSize = this.mustGetUniform(this.bgProgram, "u_gridSize");
    this.uBgGlobalBg = this.mustGetUniform(this.bgProgram, "u_globalBg");

    this.uTxAtlas = this.mustGetUniform(this.textProgram, "u_atlas");
    this.uTxCellSize = this.mustGetUniform(this.textProgram, "u_cellSize");
    this.uTxScreenSize = this.mustGetUniform(this.textProgram, "u_screenSize");
    this.uTxAtlasSize = this.mustGetUniform(this.textProgram, "u_atlasSize");
    this.uTxCellHeight = this.mustGetUniform(this.textProgram, "u_cellHeight");

    // Cell bg color texture (sized per-resize).
    const cellTex = gl.createTexture();
    if (!cellTex) throw new Error("[webgl] cell bg texture alloc failed");
    this.cellColorTexture = cellTex;
    gl.bindTexture(gl.TEXTURE_2D, cellTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Instance VAO for the text pipeline.
    const textVao = gl.createVertexArray();
    const textInstanceBuffer = gl.createBuffer();
    if (!textVao || !textInstanceBuffer) {
      throw new Error("[webgl] text vao/buffer alloc failed");
    }
    this.textVao = textVao;
    this.textInstanceBuffer = textInstanceBuffer;

    gl.bindVertexArray(textVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, textInstanceBuffer);

    // Attribute layout must match INSTANCE_BYTES + shader inputs.
    // Offsets in bytes:
    //   0:  uvec2 glyph_pos  (u32×2)
    //   8:  uvec2 glyph_size (u32×2)
    //  16:  ivec2 bearings   (i32×2)
    //  24:  uvec2 grid_pos   (u32×2)
    //  32:  uvec4 color      (u8×4)
    //  36:  uint  flags      (u32)
    const enableInstAttrib = (
      loc: number,
      size: number,
      type: number,
      offset: number,
      integer: boolean,
    ) => {
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      if (integer) {
        gl.vertexAttribIPointer(loc, size, type, INSTANCE_BYTES, offset);
      } else {
        gl.vertexAttribPointer(loc, size, type, false, INSTANCE_BYTES, offset);
      }
      gl.vertexAttribDivisor(loc, 1);
    };
    enableInstAttrib(0, 2, gl.UNSIGNED_INT, 0, true);
    enableInstAttrib(1, 2, gl.UNSIGNED_INT, 8, true);
    enableInstAttrib(2, 2, gl.INT, 16, true);
    enableInstAttrib(3, 2, gl.UNSIGNED_INT, 24, true);
    enableInstAttrib(4, 4, gl.UNSIGNED_BYTE, 32, true);
    enableInstAttrib(5, 1, gl.UNSIGNED_INT, 36, true);

    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    // Pre-multiplied alpha blending throughout.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    // Clear color set per-frame to the linearized theme background so
    // edge pixels around the grid match the grid.
  }

  private mustGetUniform(program: WebGLProgram, name: string): WebGLUniformLocation {
    const loc = this.gl.getUniformLocation(program, name);
    if (!loc) {
      throw new Error(`[webgl] missing uniform "${name}"`);
    }
    return loc;
  }

  // Renderer interface expected by ghostty-web's Terminal:

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getMetrics(): { width: number; height: number; baseline: number } {
    const m = this.atlas.getMetrics();
    const dpr = this.devicePixelRatio;
    return {
      width: m.cellWidth / dpr,
      height: m.cellHeight / dpr,
      baseline: m.baseline / dpr,
    };
  }

  get charWidth(): number {
    return this.atlas.getMetrics().cellWidth / this.devicePixelRatio;
  }

  get charHeight(): number {
    return this.atlas.getMetrics().cellHeight / this.devicePixelRatio;
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    const m = this.atlas.getMetrics();
    const dpr = this.devicePixelRatio;
    const cssWidth = (cols * m.cellWidth) / dpr;
    const cssHeight = (rows * m.cellHeight) / dpr;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = cols * m.cellWidth;
    this.canvas.height = rows * m.cellHeight;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // Reallocate cell bg texture to match grid size.
    this.reallocCellColorTexture(cols, rows);
  }

  clear(): void {
    const bg = parseColor(this.theme.background, [0, 0, 0, 1]);
    const lin = linearizeAndPremul(bg);
    this.gl.clearColor(lin[0], lin[1], lin[2], lin[3]);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  setFontSize(size: number): void {
    if (size === this.fontSize) return;
    this.fontSize = size;
    this.atlas.setFont(this.fontFamily, size, this.devicePixelRatio);
  }

  setFontFamily(family: string): void {
    if (family === this.fontFamily) return;
    this.fontFamily = family;
    this.atlas.setFont(family, this.fontSize, this.devicePixelRatio);
  }

  setCursorStyle(style: "block" | "bar" | "underline"): void {
    this.cursorStyle = style;
  }

  setCursorBlink(blink: boolean): void {
    this.cursorBlink = blink;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  setSelectionManager(manager: typeof this.selectionManager): void {
    this.selectionManager = manager;
  }

  setHoveredHyperlinkId(id: number): void {
    this.hoveredHyperlinkId = id;
  }

  setHoveredLinkRange(
    range: {
      startX: number;
      startY: number;
      endX: number;
      endY: number;
    } | null,
  ): void {
    this.hoveredLinkRange = range;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    this.atlas.dispose();
    gl.deleteProgram(this.bgProgram);
    gl.deleteProgram(this.textProgram);
    gl.deleteTexture(this.cellColorTexture);
    gl.deleteVertexArray(this.textVao);
    gl.deleteBuffer(this.textInstanceBuffer);
  }

  /**
   * Main render entry — ghostty-web's Terminal calls this on every
   * rAF tick. We rebuild the cell bg texture + glyph instance buffer
   * from the current wasmTerm state, then issue two draw calls:
   * cell_bg (full-screen triangle strip) + cell_text (instanced strip).
   */
  render(
    wasmTerm: WasmTerm,
    _forceAll: boolean,
    viewportY: number,
    scrollback: ScrollbackSource,
    _scrollbarOpacity: number,
  ): void {
    if (this.disposed) return;
    const gl = this.gl;
    const metrics = this.atlas.getMetrics();
    const { cols, rows } = wasmTerm.getDimensions();
    const wantWidth = cols * metrics.cellWidth;
    const wantHeight = rows * metrics.cellHeight;
    if (
      cols !== this.cols ||
      rows !== this.rows ||
      this.canvas.width !== wantWidth ||
      this.canvas.height !== wantHeight
    ) {
      this.resize(cols, rows);
    }

    const cellW = metrics.cellWidth;
    const cellH = metrics.cellHeight;
    const canvasW = this.canvas.width;
    const canvasH = this.canvas.height;

    this.clear();

    // --- Build per-cell data ---
    this.resetCellColorBuffer(cols, rows);
    const instances: number[] = [];

    const defaultFg = parseColor(this.theme.foreground, [0.9, 0.9, 0.9, 1]);
    const defaultFgBytes: [number, number, number, number] = [
      Math.round(defaultFg[0] * 255),
      Math.round(defaultFg[1] * 255),
      Math.round(defaultFg[2] * 255),
      255,
    ];

    const scrollbackLen = scrollback.getScrollbackLength();
    for (let y = 0; y < rows; y += 1) {
      let line: GhosttyCell[] | null = null;
      let sourceRow = y;
      if (viewportY > 0) {
        if (y < viewportY && scrollbackLen > 0) {
          const idx = scrollbackLen - Math.floor(viewportY) + y;
          line = scrollback.getScrollbackLine(idx);
        } else {
          sourceRow = y - Math.floor(viewportY);
          line = wasmTerm.getLine(sourceRow);
        }
      } else {
        line = wasmTerm.getLine(y);
      }
      if (!line) continue;
      this.emitLineData(
        line,
        y,
        sourceRow,
        wasmTerm,
        defaultFgBytes,
        instances,
        cols,
      );
    }

    // Selection overlay as cell bg overwrites.
    if (this.selectionManager?.hasSelection()) {
      this.overlaySelection(viewportY, cols, rows);
      this.selectionManager.clearDirtySelectionRows?.();
    }

    // Cursor overlay — drawn as a text instance with no atlas, so it
    // paints a solid quad on top of the glyph.
    if (viewportY === 0) {
      const cursor = wasmTerm.getCursor();
      if (cursor.visible) {
        this.emitCursorInstance(cursor.x, cursor.y, cellW, cellH, instances);
      }
    }

    this.uploadCellColors(cols, rows);

    // --- Draw pass 1: cell backgrounds ---
    this.drawCellBackgrounds(cellW, cellH, canvasW, canvasH, cols, rows);

    // --- Draw pass 2: glyphs + underline + cursor ---
    this.drawTextInstances(
      instances,
      cellW,
      cellH,
      canvasW,
      canvasH,
    );

    if (!this.loggedFirstFrame) {
      this.loggedFirstFrame = true;
      console.debug("[ghostty-webgl] first render()", {
        cols,
        rows,
        canvasW,
        canvasH,
        cellW,
        cellH,
        atlasSize: this.atlas.size,
        instanceCount: instances.length / (INSTANCE_BYTES / 4),
      });
    }

    wasmTerm.clearDirty();
  }

  // Cell color buffer is a Uint8Array(cols * rows * 4) in RGBA order.
  private resetCellColorBuffer(cols: number, rows: number): void {
    const need = cols * rows * 4;
    if (this.cellColorBuffer.length !== need) {
      this.cellColorBuffer = new Uint8Array(need);
    } else {
      this.cellColorBuffer.fill(0);
    }
  }

  private reallocCellColorTexture(cols: number, rows: number): void {
    if (cols === this.cellColorWidth && rows === this.cellColorHeight) return;
    this.cellColorWidth = cols;
    this.cellColorHeight = rows;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.cellColorTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8UI,
      cols,
      rows,
      0,
      gl.RGBA_INTEGER,
      gl.UNSIGNED_BYTE,
      null,
    );
  }

  private uploadCellColors(cols: number, rows: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.cellColorTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      cols,
      rows,
      gl.RGBA_INTEGER,
      gl.UNSIGNED_BYTE,
      this.cellColorBuffer,
    );
  }

  private emitLineData(
    line: GhosttyCell[],
    displayRow: number,
    sourceRow: number,
    wasmTerm: WasmTerm,
    defaultFg: [number, number, number, number],
    instances: number[],
    cols: number,
  ): void {
    for (let x = 0; x < line.length && x < cols; x += 1) {
      const cell = line[x];
      if (!cell || cell.width === 0) continue;

      let fgR = cell.fg_r,
        fgG = cell.fg_g,
        fgB = cell.fg_b;
      let bgR = cell.bg_r,
        bgG = cell.bg_g,
        bgB = cell.bg_b;
      if (cell.flags & FLAG_INVERSE) {
        const tr = bgR,
          tg = bgG,
          tb = bgB;
        bgR = fgR;
        bgG = fgG;
        bgB = fgB;
        fgR = tr;
        fgG = tg;
        fgB = tb;
      }

      const hasExplicitBg = bgR !== 0 || bgG !== 0 || bgB !== 0;
      if (hasExplicitBg) {
        const off = (displayRow * cols + x) * 4;
        this.cellColorBuffer[off + 0] = bgR;
        this.cellColorBuffer[off + 1] = bgG;
        this.cellColorBuffer[off + 2] = bgB;
        this.cellColorBuffer[off + 3] = 255;
        if (cell.width === 2 && x + 1 < cols) {
          const off2 = (displayRow * cols + x + 1) * 4;
          this.cellColorBuffer[off2 + 0] = bgR;
          this.cellColorBuffer[off2 + 1] = bgG;
          this.cellColorBuffer[off2 + 2] = bgB;
          this.cellColorBuffer[off2 + 3] = 255;
        }
      }

      if (cell.flags & FLAG_INVISIBLE) continue;
      if (cell.codepoint === 0 && cell.grapheme_len === 0) continue;

      let text: string;
      if (cell.grapheme_len > 0 && wasmTerm.getGraphemeString) {
        text = wasmTerm.getGraphemeString(sourceRow, x);
      } else {
        text = String.fromCodePoint(cell.codepoint);
      }
      if (!text || text === " ") {
        // Underline / strikethrough on a space still need rendering.
        if (
          cell.flags & (FLAG_UNDERLINE | FLAG_STRIKETHROUGH)
        ) {
          // fall through to emit line primitives below
        } else {
          continue;
        }
      }

      const entry = text && text !== " "
        ? this.atlas.getOrRasterize(text, cell.flags & 0b11)
        : null;

      const fgRgba: [number, number, number, number] =
        fgR === 0 && fgG === 0 && fgB === 0
          ? defaultFg
          : [fgR, fgG, fgB, 255];
      const fgAlpha = cell.flags & FLAG_FAINT ? 128 : 255;
      const color: [number, number, number, number] = [
        fgRgba[0],
        fgRgba[1],
        fgRgba[2],
        fgAlpha,
      ];

      if (entry) {
        this.pushTextInstance(instances, {
          atlasX: entry.atlasX,
          atlasY: entry.atlasY,
          glyphW: entry.width,
          glyphH: entry.height,
          bearingX: entry.bearingX,
          bearingY: entry.bearingY,
          col: x,
          row: displayRow,
          color,
          flags: 0,
        });
      }

      if (cell.flags & FLAG_UNDERLINE) {
        const m = this.atlas.getMetrics();
        const thickness = Math.max(1, Math.floor(m.cellHeight * 0.06));
        const yOffset = m.baseline + 2;
        this.pushTextInstance(instances, {
          atlasX: 0,
          atlasY: 0,
          glyphW: m.cellWidth * (cell.width === 2 ? 2 : 1),
          glyphH: thickness,
          bearingX: 0,
          bearingY: m.cellHeight - yOffset,
          col: x,
          row: displayRow,
          color,
          flags: INST_FLAG_IS_UNDERLINE,
        });
      }
      if (cell.flags & FLAG_STRIKETHROUGH) {
        const m = this.atlas.getMetrics();
        const thickness = Math.max(1, Math.floor(m.cellHeight * 0.06));
        const yOffset = Math.floor(m.cellHeight / 2);
        this.pushTextInstance(instances, {
          atlasX: 0,
          atlasY: 0,
          glyphW: m.cellWidth * (cell.width === 2 ? 2 : 1),
          glyphH: thickness,
          bearingX: 0,
          bearingY: m.cellHeight - yOffset,
          col: x,
          row: displayRow,
          color,
          flags: INST_FLAG_IS_STRIKETHROUGH,
        });
      }
    }
  }

  private overlaySelection(
    viewportY: number,
    cols: number,
    rows: number,
  ): void {
    const coords = this.selectionManager?.getSelectionCoords?.();
    if (!coords) return;
    const selColor = parseColor(
      this.theme.selectionBackground,
      [0.4, 0.6, 0.9, 0.3],
    );
    const r = Math.round(selColor[0] * 255);
    const g = Math.round(selColor[1] * 255);
    const b = Math.round(selColor[2] * 255);
    const a = Math.round(selColor[3] * 255);

    const { startRow, startCol, endRow, endCol } = coords;
    for (let y = startRow; y <= endRow; y += 1) {
      const displayRow = y - Math.floor(viewportY);
      if (displayRow < 0 || displayRow >= rows) continue;
      const colA = y === startRow ? startCol : 0;
      const colB = y === endRow ? endCol : cols;
      for (let x = colA; x < colB; x += 1) {
        const off = (displayRow * cols + x) * 4;
        this.cellColorBuffer[off + 0] = r;
        this.cellColorBuffer[off + 1] = g;
        this.cellColorBuffer[off + 2] = b;
        this.cellColorBuffer[off + 3] = a;
      }
    }
  }

  private emitCursorInstance(
    col: number,
    row: number,
    cellW: number,
    cellH: number,
    instances: number[],
  ): void {
    const color = parseColor(this.theme.cursor, [0.9, 0.9, 0.9, 1]);
    const colorBytes: [number, number, number, number] = [
      Math.round(color[0] * 255),
      Math.round(color[1] * 255),
      Math.round(color[2] * 255),
      Math.round(color[3] * 255),
    ];
    let w = cellW,
      h = cellH,
      bx = 0,
      by = cellH;
    switch (this.cursorStyle) {
      case "block":
        w = cellW;
        h = cellH;
        break;
      case "underline":
        h = Math.max(2, Math.floor(cellH * 0.15));
        by = h;
        break;
      case "bar":
      default:
        w = Math.max(2, Math.floor(cellW * 0.15));
        break;
    }
    this.pushTextInstance(instances, {
      atlasX: 0,
      atlasY: 0,
      glyphW: w,
      glyphH: h,
      bearingX: bx,
      bearingY: by,
      col,
      row,
      color: colorBytes,
      flags: INST_FLAG_IS_UNDERLINE, // reuse "no-atlas" flag path
    });
  }

  private pushTextInstance(
    instances: number[],
    inst: {
      atlasX: number;
      atlasY: number;
      glyphW: number;
      glyphH: number;
      bearingX: number;
      bearingY: number;
      col: number;
      row: number;
      color: [number, number, number, number];
      flags: number;
    },
  ): void {
    // We'll convert this to bytes in a single pass when we upload;
    // here we just accumulate as (u32, i32, u8×4) tuples stored as
    // numbers so we don't allocate intermediate typed arrays.
    // Encoded inline: 10 u32-equivalents per instance = 40 bytes.
    //   [glyph_x, glyph_y, glyph_w, glyph_h, bearing_x, bearing_y,
    //    grid_x, grid_y, color_rgba_packed, flags]
    const colorPacked =
      (inst.color[0] & 0xff) |
      ((inst.color[1] & 0xff) << 8) |
      ((inst.color[2] & 0xff) << 16) |
      ((inst.color[3] & 0xff) << 24);
    instances.push(
      inst.atlasX,
      inst.atlasY,
      inst.glyphW,
      inst.glyphH,
      inst.bearingX,
      inst.bearingY,
      inst.col,
      inst.row,
      colorPacked,
      inst.flags,
    );
  }

  private drawCellBackgrounds(
    cellW: number,
    cellH: number,
    canvasW: number,
    canvasH: number,
    cols: number,
    rows: number,
  ): void {
    const gl = this.gl;
    gl.useProgram(this.bgProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cellColorTexture);
    gl.uniform1i(this.uBgCellColors, 0);
    gl.uniform2f(this.uBgCellSize, cellW, cellH);
    gl.uniform2f(this.uBgScreenSize, canvasW, canvasH);
    gl.uniform2i(this.uBgGridSize, cols, rows);

    const bg = parseColor(this.theme.background, [0, 0, 0, 1]);
    const lin = linearizeAndPremul(bg);
    gl.uniform4f(this.uBgGlobalBg, lin[0], lin[1], lin[2], lin[3]);
    // 4-vert triangle strip covering the whole clip space.
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawTextInstances(
    instances: number[],
    cellW: number,
    cellH: number,
    canvasW: number,
    canvasH: number,
  ): void {
    if (instances.length === 0) return;
    const gl = this.gl;

    const instanceCount = instances.length / 10;
    const byteSize = instanceCount * INSTANCE_BYTES;
    if (this.instanceBuffer.byteLength < byteSize) {
      this.instanceBuffer = new ArrayBuffer(byteSize);
      this.instanceView = new DataView(this.instanceBuffer);
    }
    // Layout: for each instance, write
    //  u32×2 (glyph_pos), u32×2 (glyph_size), i32×2 (bearings),
    //  u32×2 (grid_pos), u8×4 (color), u32 (flags)
    for (let i = 0; i < instanceCount; i += 1) {
      const src = i * 10;
      const dst = i * INSTANCE_BYTES;
      this.instanceView.setUint32(dst + 0, instances[src + 0], true);
      this.instanceView.setUint32(dst + 4, instances[src + 1], true);
      this.instanceView.setUint32(dst + 8, instances[src + 2], true);
      this.instanceView.setUint32(dst + 12, instances[src + 3], true);
      this.instanceView.setInt32(dst + 16, instances[src + 4], true);
      this.instanceView.setInt32(dst + 20, instances[src + 5], true);
      this.instanceView.setUint32(dst + 24, instances[src + 6], true);
      this.instanceView.setUint32(dst + 28, instances[src + 7], true);
      this.instanceView.setUint32(dst + 32, instances[src + 8], true);
      this.instanceView.setUint32(dst + 36, instances[src + 9], true);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.textInstanceBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Uint8Array(this.instanceBuffer, 0, byteSize),
      gl.DYNAMIC_DRAW,
    );

    gl.useProgram(this.textProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
    gl.uniform1i(this.uTxAtlas, 0);
    gl.uniform2f(this.uTxCellSize, cellW, cellH);
    gl.uniform2f(this.uTxScreenSize, canvasW, canvasH);
    gl.uniform2i(this.uTxAtlasSize, this.atlas.size, this.atlas.size);
    gl.uniform1f(this.uTxCellHeight, cellH);

    gl.bindVertexArray(this.textVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount);
  }
}
