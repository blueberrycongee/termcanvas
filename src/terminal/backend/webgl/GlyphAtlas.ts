/**
 * On-demand glyph rasterizer + texture atlas for the WebGL terminal
 * renderer. Rasterizes each distinct (codepoint, bold, italic) triple
 * into a packed RGBA texture the first time the renderer encounters
 * it; subsequent uses are atlas lookups.
 *
 * Design:
 *  - Single POT (power-of-two) texture, subregion-uploaded via
 *    `gl.texSubImage2D` as new glyphs arrive. Starting at 1024² — one
 *    row fits ~60 glyphs at 16px, plenty for ASCII + common CJK spill
 *    before resize. We grow to 2048² on overflow.
 *  - Shelf-packing: glyphs flow left-to-right on the current shelf,
 *    wrap to a new shelf when they don't fit. Worst-case density is
 *    modest but we're glyph-budgeted in practice, not byte-budgeted.
 *  - Cells are RGBA so we can bake either grayscale coverage (alpha
 *    channel only) or subpixel LCD triplets (R/G/B channels) without
 *    re-plumbing the shader. MVP uses grayscale (alpha) coverage;
 *    subpixel LCD is a later phase.
 *  - One rasterization "pool" per font face (family + size). Changing
 *    either triggers a full reset, because glyph metrics would be
 *    invalidated and the renderer recomputes cell-grid geometry from
 *    the atlas's new metrics anyway.
 */

const ATLAS_INITIAL_SIZE = 1024;
const ATLAS_MAX_SIZE = 4096;
const SHELF_PADDING = 1;

export interface GlyphMetrics {
  /** Distance from baseline to top of cell — matches CSS font metrics. */
  ascent: number;
  /** Cell width (monospace advance), device pixels. */
  cellWidth: number;
  /** Cell height, device pixels. */
  cellHeight: number;
  /** Baseline offset inside the cell, from top, device pixels. */
  baseline: number;
}

export interface GlyphEntry {
  /** Texel x (device pixels), top-left of glyph in atlas. */
  atlasX: number;
  atlasY: number;
  /** Width / height of this glyph's atlas tile, device pixels. */
  width: number;
  height: number;
  /**
   * Offset from the cell's top-left to the glyph's top-left, device
   * pixels. Varies per glyph — descenders, accents, wide CJK; renderer
   * adds this to the cell position when it builds the vertex quad.
   */
  offsetX: number;
  offsetY: number;
  /** Advance in cells — 1 for ASCII, 2 for CJK/fullwidth. */
  advance: number;
}

type GlyphKey = string;

function makeKey(text: string, flags: number): GlyphKey {
  // Flags we actually distinguish at rasterization time: bold, italic.
  // Other SGR bits (inverse, underline, strikethrough, faint) are
  // applied in the shader / cell geometry, not baked into the glyph.
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
  private metrics: GlyphMetrics;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;

    const texture = gl.createTexture();
    if (!texture) {
      throw new Error("[webgl] failed to create atlas texture");
    }
    this.texture = texture;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.atlasSize,
      this.atlasSize,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.rasterCanvas = new OffscreenCanvas(256, 64);
    const ctx = this.rasterCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("[webgl] no 2d context for glyph rasterizer");
    this.rasterCtx = ctx;

    this.metrics = this.measureFont();
  }

  get size(): number {
    return this.atlasSize;
  }

  getMetrics(): GlyphMetrics {
    return this.metrics;
  }

  /**
   * Set font params. Triggers a full atlas reset if anything changed,
   * because cached glyphs were rasterized at the previous size and are
   * no longer meaningful.
   */
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
    this.reset();
    this.metrics = this.measureFont();
  }

  getOrRasterize(text: string, flags: number): GlyphEntry | null {
    const key = makeKey(text, flags);
    const cached = this.cache.get(key);
    if (cached) return cached;
    return this.rasterize(text, flags, key);
  }

  /** Drop every cached glyph and zero the texture. */
  reset(): void {
    this.cache.clear();
    this.shelfX = SHELF_PADDING;
    this.shelfY = SHELF_PADDING;
    this.shelfHeight = 0;

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // Zero-fill the current atlas. texImage2D with null does this on
    // most implementations but not all — be explicit with a buffer.
    const blank = new Uint8Array(this.atlasSize * this.atlasSize * 4);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.atlasSize,
      this.atlasSize,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      blank,
    );
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture);
    this.cache.clear();
  }

  private measureFont(): GlyphMetrics {
    const dpr = this.devicePixelRatio;
    const pixelSize = this.fontSize * dpr;
    this.rasterCtx.font = `${pixelSize}px ${this.fontFamily}`;
    this.rasterCtx.textBaseline = "alphabetic";
    const metrics = this.rasterCtx.measureText("MMMM");
    const advance = metrics.width / 4;
    const ascent = metrics.actualBoundingBoxAscent;
    const descent = metrics.actualBoundingBoxDescent;
    // Cell height: prefer font metrics-based height but clamp to a
    // line-height multiple of the font size so capital letters and
    // descenders both fit. CSS convention is ~1.2–1.4x font size.
    const cellHeight = Math.ceil(Math.max(ascent + descent, pixelSize * 1.2));
    // Baseline goes where the font ascent reaches; centre any extra
    // leading so content sits mid-cell.
    const leading = cellHeight - (ascent + descent);
    const baseline = Math.floor(ascent + leading / 2);
    return {
      ascent,
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

    // Measure to find exact bounds. measureText is cheap; the advance
    // tells us glyph width (for wide chars like 中, measures > cellWidth
    // so we'll allocate two cells worth).
    const metrics = ctx.measureText(text);
    const advanceWidth = Math.max(1, Math.ceil(metrics.width));
    const advance = advanceWidth > this.metrics.cellWidth * 1.3 ? 2 : 1;
    const tileWidth = advance * this.metrics.cellWidth;
    const tileHeight = this.metrics.cellHeight;

    // Resize the raster canvas if necessary. Use a tile slightly
    // larger than the atlas cell so descenders / accents don't clip
    // at the edges; we'll copy out the full tile.
    if (
      this.rasterCanvas.width < tileWidth ||
      this.rasterCanvas.height < tileHeight
    ) {
      this.rasterCanvas.width = Math.max(
        this.rasterCanvas.width,
        tileWidth + 8,
      );
      this.rasterCanvas.height = Math.max(
        this.rasterCanvas.height,
        tileHeight + 8,
      );
      // Canvas resize zeros the font — reapply.
      ctx.font = fontSpec;
      ctx.textBaseline = "alphabetic";
    }

    // Clear, paint white text on transparent bg. Colour is applied in
    // the shader by multiplying the sampled alpha with the cell's fg.
    ctx.clearRect(0, 0, tileWidth, tileHeight);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, 0, this.metrics.baseline);

    // Find a spot on the atlas shelf.
    if (!this.ensureShelfSpace(tileWidth, tileHeight)) {
      return null;
    }
    const atlasX = this.shelfX;
    const atlasY = this.shelfY;
    this.shelfX += tileWidth + SHELF_PADDING;

    // Pull pixels out of the raster canvas and upload as subregion.
    const imageData = ctx.getImageData(0, 0, tileWidth, tileHeight);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      atlasX,
      atlasY,
      tileWidth,
      tileHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      imageData.data,
    );

    const entry: GlyphEntry = {
      atlasX,
      atlasY,
      width: tileWidth,
      height: tileHeight,
      offsetX: 0,
      offsetY: 0,
      advance,
    };
    this.cache.set(key, entry);
    return entry;
  }

  private ensureShelfSpace(tileWidth: number, tileHeight: number): boolean {
    // Will this glyph fit on the current shelf?
    if (
      this.shelfX + tileWidth + SHELF_PADDING <= this.atlasSize &&
      this.shelfY + tileHeight + SHELF_PADDING <= this.atlasSize
    ) {
      this.shelfHeight = Math.max(this.shelfHeight, tileHeight);
      return true;
    }
    // Close the current shelf and start a new one below.
    this.shelfY += this.shelfHeight + SHELF_PADDING;
    this.shelfX = SHELF_PADDING;
    this.shelfHeight = 0;
    if (this.shelfY + tileHeight + SHELF_PADDING <= this.atlasSize) {
      this.shelfHeight = tileHeight;
      return true;
    }
    // Atlas full — try to grow.
    if (this.atlasSize < ATLAS_MAX_SIZE) {
      this.grow();
      return this.ensureShelfSpace(tileWidth, tileHeight);
    }
    // At max size; evict everything and start over. Caller gets a
    // fresh atlas but loses the cache — acceptable for an overflow
    // event in the MVP; a LRU later would be nicer.
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
      gl.RGBA,
      this.atlasSize,
      this.atlasSize,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    // Grown atlas is empty — the cache is stale (absolute coords) so
    // drop it. Glyphs re-rasterize on next access.
    this.cache.clear();
    this.shelfX = SHELF_PADDING;
    this.shelfY = SHELF_PADDING;
    this.shelfHeight = 0;
  }
}
