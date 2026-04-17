/**
 * Glyph atlas modelled after Ghostty's native atlas, adapted for the
 * browser via `OffscreenCanvas` rasterization and a WebGL2 R8 texture.
 *
 * Changes from the MVP:
 *  - Stores each glyph at its *natural* bounding box, not at cell size.
 *    Reduces wasted atlas space and lets the renderer position glyphs
 *    using font bearings (ascenders reach above the baseline,
 *    descenders below; wide glyphs span two cells; empty margins
 *    aren't wasted). Matches Ghostty's `CellText` per-instance layout
 *    (`glyph_pos`, `glyph_size`, `bearings`) so our vertex shader can
 *    mirror `cell_text.v.glsl`.
 *  - R8 (single-channel red) texture for grayscale coverage. Ghostty
 *    uses the same layout for its grayscale atlas; means 4x less
 *    texture memory and a simpler fragment shader.
 *  - Tracks font metrics (cellWidth/Height from "MMMM" advance +
 *    measured ascent/descent) so the renderer can lay out grid cells
 *    without asking the atlas to pad glyphs.
 *  - Cache keyed by `(text, bold, italic)`; font change invalidates
 *    the whole cache because bearings are per-size.
 */

const ATLAS_INITIAL_SIZE = 1024;
const ATLAS_MAX_SIZE = 4096;
const SHELF_PADDING = 1;

export interface FontMetrics {
  /** Distance from baseline up to cap-height. Device pixels. */
  ascent: number;
  /** Distance from baseline down to descender bottom. Device pixels. */
  descent: number;
  /** Monospace advance width. Device pixels. */
  cellWidth: number;
  /** Full cell height = ceil(max(ascent+descent, fontPx×1.2)). */
  cellHeight: number;
  /** Baseline offset inside cell, from cell top. Device pixels. */
  baseline: number;
}

export interface GlyphEntry {
  /** Top-left position of glyph in the atlas, device pixels. */
  atlasX: number;
  atlasY: number;
  /** Glyph bbox dimensions in the atlas, device pixels. */
  width: number;
  height: number;
  /**
   * Bearings — distance from the cell origin (top-left) to the glyph's
   * top-left. Matches Ghostty's convention: positive `bearingX` pushes
   * right, positive `bearingY` is the glyph's top above the baseline.
   * The renderer computes glyph screen position as:
   *   glyph_top_left = cell_top_left + vec2(bearingX, cellHeight - bearingY)
   */
  bearingX: number;
  bearingY: number;
  /** Advance in cells — 1 for narrow, 2 for wide (CJK/fullwidth). */
  advance: number;
  /** Set when the glyph is a colour emoji (later phase). */
  isColor: boolean;
}

type GlyphKey = string;

function makeKey(text: string, flags: number): GlyphKey {
  return `${flags & 0b11}:${text}`;
}

export class GlyphAtlas {
  readonly texture: WebGLTexture;

  private readonly gl: WebGL2RenderingContext;
  private readonly cache = new Map<GlyphKey, GlyphEntry>();
  private readonly rasterCanvas: OffscreenCanvas;
  private readonly rasterCtx: OffscreenCanvasRenderingContext2D;

  private atlasSize = ATLAS_INITIAL_SIZE;
  private shelfX = SHELF_PADDING;
  private shelfY = SHELF_PADDING;
  private shelfHeight = 0;

  private fontFamily = "monospace";
  private fontSize = 15;
  private devicePixelRatio = 1;
  private metricsCache: FontMetrics;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;

    const texture = gl.createTexture();
    if (!texture) throw new Error("[webgl] atlas texture alloc failed");
    this.texture = texture;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    // R8: single-channel unsigned byte, perfect for grayscale coverage.
    // Using LINEAR filtering so DPR fractional offsets blend cleanly;
    // NEAREST would show seams at sub-pixel glyph quad positions.
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      this.atlasSize,
      this.atlasSize,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Rasterization scratchpad — sized up to ~2× expected glyph dims
    // so we don't spend cycles reallocating on every large glyph.
    this.rasterCanvas = new OffscreenCanvas(128, 64);
    const ctx = this.rasterCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("[webgl] no 2d context for glyph rasterizer");
    this.rasterCtx = ctx;

    this.metricsCache = this.measureFont();
  }

  get size(): number {
    return this.atlasSize;
  }

  getMetrics(): FontMetrics {
    return this.metricsCache;
  }

  setFont(family: string, sizeCssPx: number, dpr: number): void {
    if (
      family === this.fontFamily &&
      sizeCssPx === this.fontSize &&
      dpr === this.devicePixelRatio
    ) {
      return;
    }
    this.fontFamily = family;
    this.fontSize = sizeCssPx;
    this.devicePixelRatio = dpr;
    this.metricsCache = this.measureFont();
    this.reset();
  }

  getOrRasterize(text: string, flags: number): GlyphEntry | null {
    const key = makeKey(text, flags);
    const cached = this.cache.get(key);
    if (cached) return cached;
    return this.rasterize(text, flags, key);
  }

  reset(): void {
    this.cache.clear();
    this.shelfX = SHELF_PADDING;
    this.shelfY = SHELF_PADDING;
    this.shelfHeight = 0;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const blank = new Uint8Array(this.atlasSize * this.atlasSize);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.atlasSize,
      this.atlasSize,
      gl.RED,
      gl.UNSIGNED_BYTE,
      blank,
    );
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture);
    this.cache.clear();
  }

  private measureFont(): FontMetrics {
    const dpr = this.devicePixelRatio;
    const pixelSize = this.fontSize * dpr;
    this.rasterCtx.font = `${pixelSize}px ${this.fontFamily}`;
    this.rasterCtx.textBaseline = "alphabetic";

    // Monospace advance from 4-char average — more stable than
    // measuring a single glyph, which varies across fonts.
    const advanceMetrics = this.rasterCtx.measureText("MMMM");
    const advance = advanceMetrics.width / 4;

    // Ascent/descent from a glyph-full sample so we include
    // descenders and accents.
    const sample = this.rasterCtx.measureText("ygj|M");
    const ascent = sample.actualBoundingBoxAscent;
    const descent = sample.actualBoundingBoxDescent;

    const cellHeight = Math.ceil(Math.max(ascent + descent, pixelSize * 1.2));
    // Baseline centred in the extra leading so ascenders and descenders
    // both clear the cell edges.
    const leading = cellHeight - (ascent + descent);
    const baseline = Math.floor(ascent + leading / 2);

    return {
      ascent,
      descent,
      cellWidth: Math.ceil(advance),
      cellHeight,
      baseline,
    };
  }

  private rasterize(
    text: string,
    flags: number,
    key: GlyphKey,
  ): GlyphEntry | null {
    const dpr = this.devicePixelRatio;
    const pixelSize = this.fontSize * dpr;
    const isBold = (flags & 1) !== 0;
    const isItalic = (flags & 2) !== 0;
    const fontSpec = `${isItalic ? "italic " : ""}${
      isBold ? "bold " : ""
    }${pixelSize}px ${this.fontFamily}`;

    const ctx = this.rasterCtx;
    ctx.font = fontSpec;
    ctx.textBaseline = "alphabetic";

    const rawMetrics = ctx.measureText(text);
    const advanceWidth = Math.max(1, rawMetrics.width);
    const advanceCells =
      advanceWidth > this.metricsCache.cellWidth * 1.3 ? 2 : 1;

    // Actual glyph bbox — may be smaller than the cell (narrow glyphs),
    // extend above the cell (accents), or extend below (descenders).
    // Use the bounding-box metrics so we capture the full ink rect,
    // including the marks.
    const glyphAscent = Math.ceil(rawMetrics.actualBoundingBoxAscent);
    const glyphDescent = Math.ceil(rawMetrics.actualBoundingBoxDescent);
    const glyphLeft = Math.ceil(rawMetrics.actualBoundingBoxLeft);
    const glyphRight = Math.ceil(rawMetrics.actualBoundingBoxRight);

    const glyphWidth = Math.max(1, glyphLeft + glyphRight);
    const glyphHeight = Math.max(1, glyphAscent + glyphDescent);

    // Rasterize into the offscreen canvas at glyphWidth × glyphHeight.
    // Origin: we draw the glyph with fillText at (glyphLeft,
    // glyphAscent) so (0, 0) of the raster canvas maps to
    // (-glyphLeft, -glyphAscent) of the glyph's baseline origin.
    const pad = 1;
    const tileWidth = glyphWidth + pad * 2;
    const tileHeight = glyphHeight + pad * 2;

    if (
      this.rasterCanvas.width < tileWidth ||
      this.rasterCanvas.height < tileHeight
    ) {
      this.rasterCanvas.width = Math.max(this.rasterCanvas.width, tileWidth);
      this.rasterCanvas.height = Math.max(this.rasterCanvas.height, tileHeight);
      ctx.font = fontSpec;
      ctx.textBaseline = "alphabetic";
    }

    ctx.clearRect(0, 0, tileWidth, tileHeight);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, pad + glyphLeft, pad + glyphAscent);

    // Allocate atlas spot.
    if (!this.ensureShelfSpace(tileWidth, tileHeight)) {
      return null;
    }
    const atlasX = this.shelfX;
    const atlasY = this.shelfY;
    this.shelfX += tileWidth + SHELF_PADDING;

    // Extract the alpha channel from the rasterized pixels into an R8
    // upload. Canvas2D rasterizes to premultiplied RGBA; since we
    // filled in white, every non-zero pixel's alpha equals its luma,
    // so we can just pull alpha directly for coverage.
    const imageData = ctx.getImageData(0, 0, tileWidth, tileHeight);
    const pixels = imageData.data;
    const coverage = new Uint8Array(tileWidth * tileHeight);
    for (let i = 0, o = 0; i < pixels.length; i += 4, o += 1) {
      // Alpha is the pre-multiplied coverage for a white source.
      coverage[o] = pixels[i + 3];
    }

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      atlasX,
      atlasY,
      tileWidth,
      tileHeight,
      gl.RED,
      gl.UNSIGNED_BYTE,
      coverage,
    );

    // Bearings (Ghostty convention):
    //  - bearingX is the horizontal offset from the cell's left edge to
    //    the glyph's left edge. Same as glyphLeft (positive = ink
    //    starts inside the cell).
    //  - bearingY is the vertical offset from the baseline UP to the
    //    glyph's top, i.e. the glyph's ascender height. Positive.
    const entry: GlyphEntry = {
      atlasX: atlasX + pad,
      atlasY: atlasY + pad,
      width: glyphWidth,
      height: glyphHeight,
      bearingX: -glyphLeft,
      bearingY: glyphAscent,
      advance: advanceCells,
      isColor: false,
    };
    this.cache.set(key, entry);
    return entry;
  }

  private ensureShelfSpace(tileWidth: number, tileHeight: number): boolean {
    if (
      this.shelfX + tileWidth + SHELF_PADDING <= this.atlasSize &&
      this.shelfY + tileHeight + SHELF_PADDING <= this.atlasSize
    ) {
      this.shelfHeight = Math.max(this.shelfHeight, tileHeight);
      return true;
    }
    this.shelfY += this.shelfHeight + SHELF_PADDING;
    this.shelfX = SHELF_PADDING;
    this.shelfHeight = 0;
    if (this.shelfY + tileHeight + SHELF_PADDING <= this.atlasSize) {
      this.shelfHeight = tileHeight;
      return true;
    }
    if (this.atlasSize < ATLAS_MAX_SIZE) {
      this.grow();
      return this.ensureShelfSpace(tileWidth, tileHeight);
    }
    this.reset();
    return this.ensureShelfSpace(tileWidth, tileHeight);
  }

  private grow(): void {
    const gl = this.gl;
    this.atlasSize = Math.min(this.atlasSize * 2, ATLAS_MAX_SIZE);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      this.atlasSize,
      this.atlasSize,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      null,
    );
    this.cache.clear();
    this.shelfX = SHELF_PADDING;
    this.shelfY = SHELF_PADDING;
    this.shelfHeight = 0;
  }
}
