/**
 * WebGL2 renderer that drops into ghostty-web's Terminal class in place
 * of its built-in Canvas2D renderer. Keeps the Terminal's other
 * subsystems (input handler, selection manager, link detector, wheel
 * scrolling) untouched — those don't care about the rendering backend,
 * only the VT parser state underneath.
 *
 * Pipeline per frame:
 *  1. Read cell grid from `wasmTerm.getViewport()` (or `getScrollbackLine`
 *     if the viewport is scrolled up).
 *  2. For every non-space, non-default-bg cell: push a background quad
 *     (2 triangles, 6 verts) into a CPU-side buffer.
 *  3. For every cell with a codepoint: look up (or rasterize) the glyph
 *     in the atlas, push a textured quad.
 *  4. Issue two `drawArrays` calls: backgrounds first, glyphs second.
 *     One state change between them (bind atlas texture + switch
 *     program). The whole grid at 200×50 = 10 000 cells × 6 verts ≈
 *     60 000 verts per batch — trivial for any GPU shipped in the
 *     last decade.
 *  5. Cursor & selection overlays emit additional quads into the bg
 *     buffer; the z-order is draw order, so selection lives between
 *     backgrounds and glyphs, cursor on top.
 *
 * This MVP deliberately ignores:
 *  - Font shaping (harfbuzz) — one glyph per codepoint, no ligatures.
 *  - Complex scripts — Arabic / Devanagari fall back to per-codepoint
 *    rendering which looks wrong but doesn't crash.
 *  - Subpixel LCD antialiasing — atlas is grayscale-covered for now.
 *  - Emoji / colour font fallback — Canvas2D's font fallback gets us
 *    partway (macOS emoji renders via Apple Color Emoji through
 *    system font fallback) but without a proper fallback chain this
 *    is fragile.
 *
 * When in doubt, the existing canvas renderer's rendering semantics
 * (see `node_modules/ghostty-web/dist/ghostty-web.js` around the
 * `render()` and `renderLine()` calls) are the reference — we try to
 * match cell-level behaviour so switching renderers is invisible to
 * Terminal subsystems.
 */

import type { GhosttyCell } from "ghostty-web";

import { GlyphAtlas, type GlyphMetrics } from "./GlyphAtlas.ts";
import {
  BG_FRAGMENT_SHADER,
  BG_VERTEX_SHADER,
  GLYPH_FRAGMENT_SHADER,
  GLYPH_VERTEX_SHADER,
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

/** Interface compatible with ghostty-web's `IScrollbackProvider`. */
interface ScrollbackSource {
  getScrollbackLength(): number;
  getScrollbackLine(offset: number): GhosttyCell[] | null;
}

/** Subset of ghostty-web's `WasmTerminal` we consume. */
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

/** Parse a CSS color string into [r, g, b, a] in 0..1. */
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

export class GhosttyWebGLRenderer {
  readonly canvas: HTMLCanvasElement;

  private readonly gl: WebGL2RenderingContext;
  private readonly atlas: GlyphAtlas;

  private readonly bgProgram: WebGLProgram;
  private readonly glyphProgram: WebGLProgram;
  private readonly bgVao: WebGLVertexArrayObject;
  private readonly glyphVao: WebGLVertexArrayObject;
  private readonly bgBuffer: WebGLBuffer;
  private readonly glyphBuffer: WebGLBuffer;
  private readonly glyphAtlasUniform: WebGLUniformLocation;

  /**
   * CPU-side vertex scratch buffers. Grown on demand, never shrunk —
   * a terminal's cell count is bounded by the window size and the
   * steady state converges quickly.
   */
  private bgVerts = new Float32Array(0);
  private glyphVerts = new Float32Array(0);

  private cols = 80;
  private rows = 24;
  private fontFamily: string;
  private fontSize: number;
  private cursorStyle: "block" | "bar" | "underline";
  private cursorBlink: boolean;
  private theme: Theme;
  private devicePixelRatio: number;

  // Selection manager is installed by ghostty-web's Terminal.open().
  // We accept it but don't use its dirty-row tracking — we redraw the
  // selection from current coords on every frame, which is cheap and
  // avoids a stale-region bug class.
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

  // Link detector hooks for hover underline. We accept the values but
  // MVP does not draw the hover underline yet.
  hoveredHyperlinkId = 0;
  private previousHoveredHyperlinkId = 0;
  private hoveredLinkRange: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null = null;

  private disposed = false;
  private loggedFirstFrame = false;
  private loggedDrawCounts = false;

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
      alpha: false,
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

    this.bgProgram = linkProgram(gl, BG_VERTEX_SHADER, BG_FRAGMENT_SHADER);
    this.glyphProgram = linkProgram(
      gl,
      GLYPH_VERTEX_SHADER,
      GLYPH_FRAGMENT_SHADER,
    );

    const glyphAtlasUniform = gl.getUniformLocation(
      this.glyphProgram,
      "u_atlas",
    );
    if (!glyphAtlasUniform) {
      throw new Error("[webgl] missing u_atlas uniform");
    }
    this.glyphAtlasUniform = glyphAtlasUniform;

    // Background VAO: (vec2 pos, vec4 color) per vertex, interleaved.
    const bgVao = gl.createVertexArray();
    const bgBuffer = gl.createBuffer();
    if (!bgVao || !bgBuffer) throw new Error("[webgl] vao/vbo alloc failed");
    this.bgVao = bgVao;
    this.bgBuffer = bgBuffer;
    gl.bindVertexArray(bgVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, bgBuffer);
    const bgStride = 6 * 4; // 2 floats pos + 4 floats color
    const bgPosLoc = gl.getAttribLocation(this.bgProgram, "a_position");
    const bgColorLoc = gl.getAttribLocation(this.bgProgram, "a_color");
    gl.enableVertexAttribArray(bgPosLoc);
    gl.vertexAttribPointer(bgPosLoc, 2, gl.FLOAT, false, bgStride, 0);
    gl.enableVertexAttribArray(bgColorLoc);
    gl.vertexAttribPointer(bgColorLoc, 4, gl.FLOAT, false, bgStride, 2 * 4);

    // Glyph VAO: (vec2 pos, vec2 uv, vec4 color).
    const glyphVao = gl.createVertexArray();
    const glyphBuffer = gl.createBuffer();
    if (!glyphVao || !glyphBuffer) {
      throw new Error("[webgl] vao/vbo alloc failed");
    }
    this.glyphVao = glyphVao;
    this.glyphBuffer = glyphBuffer;
    gl.bindVertexArray(glyphVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, glyphBuffer);
    const glyphStride = 8 * 4; // 2 pos + 2 uv + 4 color
    const glyphPosLoc = gl.getAttribLocation(this.glyphProgram, "a_position");
    const glyphUvLoc = gl.getAttribLocation(this.glyphProgram, "a_uv");
    const glyphColorLoc = gl.getAttribLocation(this.glyphProgram, "a_color");
    gl.enableVertexAttribArray(glyphPosLoc);
    gl.vertexAttribPointer(glyphPosLoc, 2, gl.FLOAT, false, glyphStride, 0);
    gl.enableVertexAttribArray(glyphUvLoc);
    gl.vertexAttribPointer(glyphUvLoc, 2, gl.FLOAT, false, glyphStride, 2 * 4);
    gl.enableVertexAttribArray(glyphColorLoc);
    gl.vertexAttribPointer(
      glyphColorLoc,
      4,
      gl.FLOAT,
      false,
      glyphStride,
      4 * 4,
    );

    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
  }

  // Renderer interface expected by ghostty-web's Terminal follows.

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getMetrics(): { width: number; height: number; baseline: number } {
    const m = this.atlas.getMetrics();
    // Terminal expects CSS-pixel metrics; we store device-pixel ones.
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
  }

  clear(): void {
    // TEMP diagnostic: bright red. If the tile shows red, the WebGL
    // pipeline is compositing correctly and we can move the
    // investigation to per-cell bg quads. If still white, the canvas
    // context itself isn't reaching the compositor.
    this.gl.clearColor(1.0, 0.0, 0.0, 1.0);
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
    this.previousHoveredHyperlinkId = this.hoveredHyperlinkId;
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
    gl.deleteVertexArray(this.bgVao);
    gl.deleteVertexArray(this.glyphVao);
    gl.deleteBuffer(this.bgBuffer);
    gl.deleteBuffer(this.glyphBuffer);
    gl.deleteProgram(this.bgProgram);
    gl.deleteProgram(this.glyphProgram);
  }

  /**
   * Main render entry. ghostty-web's Terminal calls this every rAF
   * with the current wasmTerm and viewport scroll position. We ignore
   * `forceAll` (we always repaint the whole viewport — it's cheaper
   * than reasoning about dirty rows at this grid size) and
   * `scrollbarOpacity` (scrollbar is not drawn in MVP).
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
    if (cols !== this.cols || rows !== this.rows) {
      this.resize(cols, rows);
    }
    const dims = {
      canvasW: this.canvas.width,
      canvasH: this.canvas.height,
      cellW: metrics.cellWidth,
      cellH: metrics.cellHeight,
      baseline: metrics.baseline,
    };

    if (!this.loggedFirstFrame) {
      this.loggedFirstFrame = true;
      console.debug("[ghostty-webgl] first render()", {
        cols,
        rows,
        viewportY,
        metrics,
        dims,
        gl: gl ? "present" : "missing",
        atlasSize: this.atlas.size,
        theme: this.theme,
      });
    }

    this.clear();

    // Gather cells: either from viewport (no scroll) or scrollback +
    // partial viewport (scrolled up).
    const bgVerts: number[] = [];
    const glyphVerts: number[] = [];

    const scrollbackLen = scrollback.getScrollbackLength();

    for (let y = 0; y < rows; y += 1) {
      let line: GhosttyCell[] | null = null;
      let lineRow = y;
      if (viewportY > 0) {
        if (y < viewportY && scrollbackLen > 0) {
          const idx = scrollbackLen - Math.floor(viewportY) + y;
          line = scrollback.getScrollbackLine(idx);
        } else {
          lineRow = y - Math.floor(viewportY);
          line = wasmTerm.getLine(lineRow);
        }
      } else {
        line = wasmTerm.getLine(y);
      }
      if (!line) continue;

      this.emitLine(line, y, lineRow, wasmTerm, bgVerts, glyphVerts, dims);
    }

    // Selection overlay — emits into the bg buffer so it paints
    // between cell-bg and glyphs. Slight translucency so cells'
    // backgrounds still show through.
    if (this.selectionManager?.hasSelection()) {
      this.emitSelection(viewportY, bgVerts, dims);
      this.selectionManager.clearDirtySelectionRows?.();
    }

    // Cursor overlay — paints on top of cell bg; glyphs (which come
    // next) will render text over it too, so a block cursor behind an
    // inverted-foreground text cell lights up correctly.
    if (viewportY === 0) {
      const cursor = wasmTerm.getCursor();
      if (cursor.visible) {
        this.emitCursor(cursor.x, cursor.y, bgVerts, dims);
      }
    }

    if (bgVerts.length > 0) {
      this.uploadAndDrawBackgrounds(bgVerts);
    }
    if (glyphVerts.length > 0) {
      this.uploadAndDrawGlyphs(glyphVerts);
    }

    if (!this.loggedDrawCounts) {
      this.loggedDrawCounts = true;
      const err = gl.getError();
      console.debug("[ghostty-webgl] first render() draw stats", {
        bgVerts: bgVerts.length / 6,
        glyphVerts: glyphVerts.length / 8,
        glError: err,
      });
    }

    wasmTerm.clearDirty();
  }

  private emitLine(
    line: GhosttyCell[],
    displayRow: number,
    sourceRow: number,
    wasmTerm: WasmTerm,
    bgVerts: number[],
    glyphVerts: number[],
    dims: {
      canvasW: number;
      canvasH: number;
      cellW: number;
      cellH: number;
      baseline: number;
    },
  ): void {
    const defaultFg = parseColor(this.theme.foreground, [0.9, 0.9, 0.9, 1]);
    for (let x = 0; x < line.length; x += 1) {
      const cell = line[x];
      if (!cell || cell.width === 0) continue; // skip wide-char follower

      // Background quad — only emitted if cell carries an explicit
      // non-default colour (r|g|b != 0). Default bg is the canvas
      // clear colour, already painted in `clear()`.
      let bgR = cell.bg_r,
        bgG = cell.bg_g,
        bgB = cell.bg_b;
      let fgR = cell.fg_r,
        fgG = cell.fg_g,
        fgB = cell.fg_b;
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
      const cellSpan = Math.max(1, cell.width);
      if (bgR !== 0 || bgG !== 0 || bgB !== 0) {
        this.pushCellBackground(
          x,
          displayRow,
          cellSpan,
          [bgR / 255, bgG / 255, bgB / 255, 1],
          bgVerts,
          dims,
        );
      }

      if (cell.flags & FLAG_INVISIBLE) continue;

      // Glyph: prefer the WASM's getGraphemeString (handles clusters,
      // emoji, combining marks) when available, otherwise fall back to
      // the raw codepoint.
      let text: string;
      if (cell.grapheme_len > 0 && wasmTerm.getGraphemeString) {
        text = wasmTerm.getGraphemeString(sourceRow, x);
      } else if (cell.codepoint === 0) {
        continue; // blank cell
      } else {
        text = String.fromCodePoint(cell.codepoint);
      }
      if (!text || text === " ") continue;

      const entry = this.atlas.getOrRasterize(text, cell.flags & 0b11);
      if (!entry) continue;

      let textFg: [number, number, number, number];
      if (fgR === 0 && fgG === 0 && fgB === 0) {
        textFg = defaultFg;
      } else {
        textFg = [fgR / 255, fgG / 255, fgB / 255, 1];
      }
      if (cell.flags & FLAG_FAINT) {
        textFg = [textFg[0], textFg[1], textFg[2], textFg[3] * 0.5];
      }
      this.pushGlyphQuad(x, displayRow, entry, textFg, glyphVerts, dims);

      if (cell.flags & FLAG_UNDERLINE) {
        this.pushUnderline(x, displayRow, cellSpan, textFg, bgVerts, dims);
      }
      if (cell.flags & FLAG_STRIKETHROUGH) {
        this.pushStrikethrough(x, displayRow, cellSpan, textFg, bgVerts, dims);
      }
    }
  }

  private emitSelection(
    viewportY: number,
    bgVerts: number[],
    dims: {
      canvasW: number;
      canvasH: number;
      cellW: number;
      cellH: number;
      baseline: number;
    },
  ): void {
    const coords = this.selectionManager?.getSelectionCoords?.();
    if (!coords) return;
    const color = parseColor(
      this.theme.selectionBackground,
      [0.4, 0.6, 0.9, 0.3],
    );
    const { startRow, startCol, endRow, endCol } = coords;
    for (let y = startRow; y <= endRow; y += 1) {
      const displayRow = y - Math.floor(viewportY);
      if (displayRow < 0 || displayRow >= this.rows) continue;
      const colA = y === startRow ? startCol : 0;
      const colB = y === endRow ? endCol : this.cols;
      if (colB <= colA) continue;
      this.pushCellBackground(
        colA,
        displayRow,
        colB - colA,
        color,
        bgVerts,
        dims,
      );
    }
  }

  private emitCursor(
    cursorX: number,
    cursorY: number,
    bgVerts: number[],
    dims: {
      canvasW: number;
      canvasH: number;
      cellW: number;
      cellH: number;
      baseline: number;
    },
  ): void {
    const color = parseColor(this.theme.cursor, [0.9, 0.9, 0.9, 1]);
    const pxLeft = cursorX * dims.cellW;
    const pxTop = cursorY * dims.cellH;
    switch (this.cursorStyle) {
      case "block":
        this.pushPixelQuad(
          pxLeft,
          pxTop,
          dims.cellW,
          dims.cellH,
          color,
          bgVerts,
          dims,
        );
        break;
      case "underline": {
        const h = Math.max(2, Math.floor(dims.cellH * 0.15));
        this.pushPixelQuad(
          pxLeft,
          pxTop + dims.cellH - h,
          dims.cellW,
          h,
          color,
          bgVerts,
          dims,
        );
        break;
      }
      case "bar":
      default: {
        const w = Math.max(2, Math.floor(dims.cellW * 0.15));
        this.pushPixelQuad(pxLeft, pxTop, w, dims.cellH, color, bgVerts, dims);
        break;
      }
    }
  }

  private pushCellBackground(
    col: number,
    row: number,
    cells: number,
    color: [number, number, number, number],
    out: number[],
    dims: { cellW: number; cellH: number; canvasW: number; canvasH: number },
  ): void {
    this.pushPixelQuad(
      col * dims.cellW,
      row * dims.cellH,
      cells * dims.cellW,
      dims.cellH,
      color,
      out,
      dims,
    );
  }

  private pushUnderline(
    col: number,
    row: number,
    cells: number,
    color: [number, number, number, number],
    out: number[],
    dims: {
      cellW: number;
      cellH: number;
      baseline: number;
      canvasW: number;
      canvasH: number;
    },
  ): void {
    const thickness = Math.max(1, Math.floor(dims.cellH * 0.06));
    this.pushPixelQuad(
      col * dims.cellW,
      row * dims.cellH + dims.baseline + 2,
      cells * dims.cellW,
      thickness,
      color,
      out,
      dims,
    );
  }

  private pushStrikethrough(
    col: number,
    row: number,
    cells: number,
    color: [number, number, number, number],
    out: number[],
    dims: { cellW: number; cellH: number; canvasW: number; canvasH: number },
  ): void {
    const thickness = Math.max(1, Math.floor(dims.cellH * 0.06));
    this.pushPixelQuad(
      col * dims.cellW,
      row * dims.cellH + Math.floor(dims.cellH / 2),
      cells * dims.cellW,
      thickness,
      color,
      out,
      dims,
    );
  }

  private pushPixelQuad(
    px: number,
    py: number,
    w: number,
    h: number,
    color: [number, number, number, number],
    out: number[],
    dims: { canvasW: number; canvasH: number },
  ): void {
    // Convert pixel coords → clip space. Y flips because WebGL's
    // origin is bottom-left.
    const x0 = (px / dims.canvasW) * 2 - 1;
    const x1 = ((px + w) / dims.canvasW) * 2 - 1;
    const y0 = 1 - (py / dims.canvasH) * 2;
    const y1 = 1 - ((py + h) / dims.canvasH) * 2;
    const [r, g, b, a] = color;
    // Two triangles making a quad: (x0,y0)(x1,y0)(x0,y1) + (x1,y0)(x1,y1)(x0,y1)
    out.push(x0, y0, r, g, b, a);
    out.push(x1, y0, r, g, b, a);
    out.push(x0, y1, r, g, b, a);
    out.push(x1, y0, r, g, b, a);
    out.push(x1, y1, r, g, b, a);
    out.push(x0, y1, r, g, b, a);
  }

  private pushGlyphQuad(
    col: number,
    row: number,
    entry: { atlasX: number; atlasY: number; width: number; height: number },
    color: [number, number, number, number],
    out: number[],
    dims: { cellW: number; cellH: number; canvasW: number; canvasH: number },
  ): void {
    const pxLeft = col * dims.cellW + entry.atlasX * 0 + 0; // cell origin
    const pxTop = row * dims.cellH;
    const x0 = (pxLeft / dims.canvasW) * 2 - 1;
    const x1 = ((pxLeft + entry.width) / dims.canvasW) * 2 - 1;
    const y0 = 1 - (pxTop / dims.canvasH) * 2;
    const y1 = 1 - ((pxTop + entry.height) / dims.canvasH) * 2;
    const atlasSize = this.atlas.size;
    const u0 = entry.atlasX / atlasSize;
    const u1 = (entry.atlasX + entry.width) / atlasSize;
    const v0 = entry.atlasY / atlasSize;
    const v1 = (entry.atlasY + entry.height) / atlasSize;
    const [r, g, b, a] = color;
    out.push(x0, y0, u0, v0, r, g, b, a);
    out.push(x1, y0, u1, v0, r, g, b, a);
    out.push(x0, y1, u0, v1, r, g, b, a);
    out.push(x1, y0, u1, v0, r, g, b, a);
    out.push(x1, y1, u1, v1, r, g, b, a);
    out.push(x0, y1, u0, v1, r, g, b, a);
  }

  private uploadAndDrawBackgrounds(verts: number[]): void {
    const gl = this.gl;
    if (this.bgVerts.length < verts.length) {
      this.bgVerts = new Float32Array(verts.length);
    }
    this.bgVerts.set(verts);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bgBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.bgVerts,
      gl.DYNAMIC_DRAW,
      0,
      verts.length,
    );
    gl.useProgram(this.bgProgram);
    gl.bindVertexArray(this.bgVao);
    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 6);
  }

  private uploadAndDrawGlyphs(verts: number[]): void {
    const gl = this.gl;
    if (this.glyphVerts.length < verts.length) {
      this.glyphVerts = new Float32Array(verts.length);
    }
    this.glyphVerts.set(verts);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glyphBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.glyphVerts,
      gl.DYNAMIC_DRAW,
      0,
      verts.length,
    );
    gl.useProgram(this.glyphProgram);
    gl.bindVertexArray(this.glyphVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
    gl.uniform1i(this.glyphAtlasUniform, 0);
    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 8);
  }
}
