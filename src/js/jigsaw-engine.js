/**
 * jigsaw-engine.js — Core Jigsaw Puzzle Engine
 * Piece generation with bezier-curve tabs/blanks, offscreen canvas rendering, snapping logic.
 *
 * License: MIT
 */

'use strict';

// ─── Deterministic PRNG (mulberry32) ────────────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

// ─── Difficulty grids ────────────────────────────────────────────────────────
const DIFFICULTY_GRIDS = {
  24: { cols: 4, rows: 6 },
  48: { cols: 6, rows: 8 },
  96: { cols: 8, rows: 12 },
  192: { cols: 12, rows: 16 },
};

// Tab sizes relative to piece dimension
const TAB_RATIO = 0.22;
const SNAP_TOLERANCE = 15;

// ─── Edge type constants ─────────────────────────────────────────────────────
const FLAT = 0;
const TAB = 1;
const BLANK = -1;

// ─── Tiny event emitter ──────────────────────────────────────────────────────
class Emitter {
  constructor() {
    this._listeners = {};
  }
  on(event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
    return () => this.off(event, fn);
  }
  off(event, fn) {
    const arr = this._listeners[event];
    if (arr) {
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    }
  }
  emit(event, ...args) {
    const arr = this._listeners[event];
    if (arr) arr.forEach((fn) => fn(...args));
  }
}

// ─── Piece class ─────────────────────────────────────────────────────────────
class Piece {
  constructor(id, col, row, edges) {
    this.id = id;
    this.col = col;
    this.row = row;
    // edges: { top, right, bottom, left } each FLAT / TAB / BLANK
    this.edges = edges;
    this.canvas = null;     // offscreen canvas with rendered piece image
    this.x = 0;             // current screen-space position (top-left of piece bounding box)
    this.y = 0;
    this.targetX = 0;       // solved position on board
    this.targetY = 0;
    this.width = 0;         // piece bounding-box width (including tab extent)
    this.height = 0;
    this.cellW = 0;         // grid cell width (without tabs)
    this.cellH = 0;
    this.group = null;      // reference to the Group it belongs to
    this.snapped = false;   // whether piece is in its correct solved position relative to group
    this.glowAlpha = 0;     // for snap-glow animation
  }
}

// ─── Group class (set of snapped-together pieces that move together) ─────────
class PieceGroup {
  constructor(id) {
    this.id = id;
    this.pieces = [];
    this.x = 0;
    this.y = 0;
    this.zIndex = 0;
  }
  add(piece) {
    if (!this.pieces.includes(piece)) {
      this.pieces.push(piece);
      piece.group = this;
    }
  }
  // Merge another group into this one
  absorb(other) {
    for (const p of other.pieces) {
      this.add(p);
    }
  }
  get bounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of this.pieces) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.width);
      maxY = Math.max(maxY, p.y + p.height);
    }
    return { minX, minY, maxX, maxY };
  }
}

// ─── Bezier path helpers for jigsaw tab/blank ────────────────────────────────
// Draws a single edge of a piece into a Path2D.
// 'type' is FLAT, TAB (outward bump), or BLANK (inward notch).
// The edge goes from (x1,y1) to (x2,y2). 'normal' is [nx, ny] pointing outward.
function traceEdge(path, x1, y1, x2, y2, type) {
  if (type === FLAT) {
    path.lineTo(x2, y2);
    return;
  }

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  // Unit vector along edge
  const ux = dx / len;
  const uy = dy / len;
  // Normal (perpendicular, pointing outward) — rotate edge dir 90° clockwise
  const nx = uy;
  const ny = -ux;

  const dir = type; // +1 for TAB (outward), -1 for BLANK (inward)
  const tabSize = len * TAB_RATIO;
  const n = dir; // normal multiplier

  // Points along the edge in parametric form: P(t) = (x1 + ux*len*t, y1 + uy*len*t)
  // Key parameters for the classic jigsaw curve
  const t1 = 0.35, t2 = 0.50, t3 = 0.65;
  const neck = tabSize * 0.10; // slight neck before the tab

  // Pre-tab constriction point
  const p0x = x1 + ux * len * t1;
  const p0y = y1 + uy * len * t1;
  // Tab apex
  const apexX = x1 + ux * len * t2 + nx * tabSize * n;
  const apexY = y1 + uy * len * t2 + ny * tabSize * n;
  // Post-tab constriction point
  const p1x = x1 + ux * len * t3;
  const p1y = y1 + uy * len * t3;

  // Draw a smooth bezier bump
  // Control points create the classic bulb shape
  const ctrlSpread = tabSize * 0.35;
  const ctrlOut = tabSize * 0.55 * n;

  // First segment: line to pre-tab area with slight inward neck
  path.lineTo(p0x - ux * 2, p0y - uy * 2);

  // Bezier curve creating the bulb tab
  // Left side of tab
  path.bezierCurveTo(
    p0x + nx * ctrlOut * 0.3 - ux * ctrlSpread,
    p0y + ny * ctrlOut * 0.3 - uy * ctrlSpread,
    p0x + nx * tabSize * n * 0.9 - ux * ctrlSpread,
    p0y + ny * tabSize * n * 0.9 - uy * ctrlSpread,
    apexX,
    apexY
  );
  // Right side of tab
  path.bezierCurveTo(
    p1x + nx * tabSize * n * 0.9 + ux * ctrlSpread,
    p1y + ny * tabSize * n * 0.9 + uy * ctrlSpread,
    p1x + nx * ctrlOut * 0.3 + ux * ctrlSpread,
    p1y + ny * ctrlOut * 0.3 + uy * ctrlSpread,
    p1x + ux * 2,
    p1y + uy * 2
  );

  // Continue to end
  path.lineTo(x2, y2);
}

// Build the full piece path (top→right→bottom→left, clockwise)
function buildPiecePath(piece, cellW, cellH, tabSize) {
  const path = new Path2D();
  const e = piece.edges;

  // Start at top-left corner
  path.moveTo(0, 0);

  // Top edge: left → right
  traceEdge(path, 0, 0, cellW, 0, e.top);

  // Right edge: top → bottom
  traceEdge(path, cellW, 0, cellW, cellH, e.right);

  // Bottom edge: right → left
  traceEdge(path, cellW, cellH, 0, cellH, e.bottom);

  // Left edge: bottom → top
  traceEdge(path, 0, cellH, 0, 0, e.left);

  path.closePath();
  return path;
}

// ─── PieceFactory ────────────────────────────────────────────────────────────
class PieceFactory {
  /**
   * Generate the edge map and piece objects for a puzzle.
   * @param {number} cols
   * @param {number} rows
   * @param {string} seed  — deterministic seed string (image ID + difficulty)
   * @returns {Piece[]} array of pieces
   */
  static generate(cols, rows, seed) {
    const rng = mulberry32(hashString(seed));

    // Build horizontal edges: hEdges[r][c] is the edge between piece(c,r) and piece(c,r-1)
    // top edge of row r. Value: 1=TAB(from below), -1=BLANK
    // We store the edge value as seen by the piece BELOW the edge (row r).
    // If hEdges[r][c] = TAB, then piece(c,r).top = TAB and piece(c,r-1).bottom = BLANK (complementary).
    const hEdges = [];
    for (let r = 0; r <= rows; r++) {
      hEdges.push(new Array(cols));
    }
    // Build vertical edges: vEdges[r][c] is the edge between piece(c,r) and piece(c-1,r)
    const vEdges = [];
    for (let r = 0; r < rows; r++) {
      vEdges.push(new Array(cols + 1));
    }

    // Fill interior horizontal edges (row 0 and row `rows` are borders = FLAT)
    for (let r = 1; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        hEdges[r][c] = rng() < 0.5 ? TAB : BLANK;
      }
    }
    // Fill interior vertical edges (col 0 and col `cols` are borders = FLAT)
    for (let r = 0; r < rows; r++) {
      for (let c = 1; c < cols; c++) {
        vEdges[r][c] = rng() < 0.5 ? TAB : BLANK;
      }
    }

    // Set borders to FLAT
    for (let c = 0; c < cols; c++) {
      hEdges[0][c] = FLAT;
      hEdges[rows][c] = FLAT;
    }
    for (let r = 0; r < rows; r++) {
      vEdges[r][0] = FLAT;
      vEdges[r][cols] = FLAT;
    }

    // Build pieces
    const pieces = [];
    let id = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // For a piece at (c, r):
        //   top    = hEdges[r][c]     (if TAB, the tab points UP = outward for top edge)
        //   bottom = complement of hEdges[r+1][c]  (if hEdges[r+1][c]=TAB meaning tab points up into this piece's bottom,
        //            then this piece's bottom edge has a BLANK)
        //   left   = vEdges[r][c]     (if TAB, tab points LEFT = outward for left edge)
        //   right  = complement of vEdges[r][c+1]
        const top = hEdges[r][c];
        const bottom = -hEdges[r + 1][c]; // complement
        const left = vEdges[r][c];
        const right = -vEdges[r][c + 1]; // complement

        pieces.push(new Piece(id++, c, r, { top, right, bottom, left }));
      }
    }

    return pieces;
  }
}

// ─── Main JigsawPuzzle class ─────────────────────────────────────────────────
class JigsawPuzzle extends Emitter {
  constructor(options) {
    super();
    this.canvas = options.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.imageUrl = options.image;
    this.difficulty = options.difficulty || 48;
    this.ghostEnabled = options.ghostImage !== false;
    this.imageId = options.imageId || options.image;

    const grid = DIFFICULTY_GRIDS[this.difficulty] || DIFFICULTY_GRIDS[48];
    this.cols = grid.cols;
    this.rows = grid.rows;

    this.image = null;
    this.pieces = [];
    this.groups = [];
    this.boardX = 0;
    this.boardY = 0;
    this.cellW = 0;
    this.cellH = 0;
    this.tabSize = 0;
    this.completed = false;
    this.completionAnim = 0; // 0→1 animation progress

    // View transform (set by board/interact modules)
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    this._animFrame = null;
    this._glowPieces = new Set();
  }

  // ─── Load image and initialize ─────────────────────────────────────────────
  async loadImage() {
    this.emit('loading');
    const img = await this._loadImage(this.imageUrl);
    this.image = img;

    // Fit image into max 1200x1200 while preserving aspect ratio
    const MAX = 1200;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w > MAX || h > MAX) {
      const s = MAX / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    this.imageW = w;
    this.imageH = h;

    this.cellW = w / this.cols;
    this.cellH = h / this.rows;
    this.tabSize = Math.min(this.cellW, this.cellH) * TAB_RATIO;

    // Generate pieces
    const seed = `${this.imageId}:${this.difficulty}`;
    this.pieces = PieceFactory.generate(this.cols, this.rows, seed);

    // Render each piece to its own offscreen canvas
    for (const piece of this.pieces) {
      this._renderPiece(piece);
    }

    // Create initial groups (one per piece)
    this.groups = [];
    let gid = 0;
    for (const piece of this.pieces) {
      const g = new PieceGroup(gid++);
      g.add(piece);
      this.groups.push(g);
    }

    this.emit('loaded');
  }

  _loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error('Failed to load image: ' + url));
      img.src = url;
    });
  }

  // ─── Render a piece to an offscreen canvas ──────────────────────────────────
  _renderPiece(piece) {
    const { cellW, cellH, tabSize } = this;
    // Bounding box includes potential tab extension on all sides
    const pad = Math.ceil(tabSize) + 4; // extra padding for shadow
    const bw = Math.ceil(cellW + tabSize * 2 + pad * 2);
    const bh = Math.ceil(cellH + tabSize * 2 + pad * 2);

    const cnv = document.createElement('canvas');
    cnv.width = bw;
    cnv.height = bh;
    const ctx = cnv.getContext('2d');

    // Offset so the piece's (0,0) corner maps to (pad+tabSize, pad+tabSize) on the offscreen canvas
    const ox = pad + tabSize;
    const oy = pad + tabSize;

    piece.canvas = cnv;
    piece.pad = pad;
    piece.ox = ox;
    piece.oy = oy;
    piece.width = cellW + tabSize * 2;
    piece.height = cellH + tabSize * 2;
    piece.cellW = cellW;
    piece.cellH = cellH;

    // Build the piece path (local coords with origin at piece corner)
    const path = buildPiecePath(piece, cellW, cellH, tabSize);

    ctx.save();
    ctx.translate(ox, oy);

    // Clip to piece shape
    ctx.clip(path);

    // Draw the source image portion
    // Source crop: the piece's grid cell region, but expanded by tabSize in case a tab extends
    const srcX = piece.col * (this.imageW / this.cols) - tabSize;
    const srcY = piece.row * (this.imageH / this.rows) - tabSize;
    const srcW = cellW + tabSize * 2;
    const srcH = cellH + tabSize * 2;

    // Clamp to image bounds
    const sx = Math.max(0, srcX);
    const sy = Math.max(0, srcY);
    const sw = Math.min(this.imageW - sx, srcW);
    const sh = Math.min(this.imageH - sy, srcH);

    // Destination position within the piece local coords
    const dx = sx - srcX;
    const dy = sy - srcY;

    ctx.drawImage(this.image, sx, sy, sw, sh, dx, dy, sw, sh);

    ctx.restore();

    // Draw piece outline + subtle shadow on a second pass
    ctx.save();
    ctx.translate(ox, oy);

    // Subtle inner highlight on the top/left edges
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke(path);

    // Subtle dark outline
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke(path);

    ctx.restore();

    // Store path for hit-testing
    piece.path = path;
  }

  // ─── Hit test: is screen-space point (px, py) inside this piece? ────────────
  hitTest(piece, px, py) {
    // Convert screen→world by inverse view transform
    const wx = (px - this.offsetX) / this.scale;
    const wy = (py - this.offsetY) / this.scale;
    // World→piece local
    const lx = wx - piece.x;
    const ly = wy - piece.y;
    // Check against the offscreen canvas path
    // Use a temp context for isPointInPath
    if (!this._hitCtx) {
      this._hitCtx = document.createElement('canvas').getContext('2d');
    }
    return this._hitCtx.isPointInPath(piece.path, lx + piece.ox, ly + piece.oy);
  }

  // ─── Snapping logic ─────────────────────────────────────────────────────────
  /**
   * Check if the dragged group should snap to any adjacent piece's group.
   * Called after a drag move.
   * @param {PieceGroup} dragGroup
   * @returns {boolean} true if a snap occurred
   */
  checkSnap(dragGroup) {
    const tolerance = SNAP_TOLERANCE;
    const dragPieces = dragGroup.pieces;

    // For each piece in the dragged group, check its grid neighbors
    for (const piece of dragPieces) {
      const neighbors = this._getNeighbors(piece);
      for (const { neighbor, edge } of neighbors) {
        if (!neighbor) continue;
        if (neighbor.group === dragGroup) continue; // already same group

        // Calculate where the neighbor should be relative to this piece
        const expected = this._getExpectedOffset(piece, neighbor, edge);
        if (!expected) continue;

        // Current offset between the two pieces
        const actualDx = neighbor.x - piece.x;
        const actualDy = neighbor.y - piece.y;

        const distErr = Math.hypot(expected.dx - actualDx, expected.dy - actualDy);
        if (distErr <= tolerance) {
          // Snap! Move the drag group to align
          const snapDx = expected.dx - actualDx;
          const snapDy = expected.dy - actualDy;
          this._moveGroup(dragGroup, snapDx, snapDy);

          // Merge groups
          this._mergeGroups(dragGroup, neighbor.group);

          // Glow effect
          this._triggerGlow(dragGroup.pieces);

          this.emit('pieceSnap', piece.id);
          this._updateProgress();
          return true;
        }
      }
    }
    return false;
  }

  _getNeighbors(piece) {
    const { cols, rows } = this;
    const c = piece.col;
    const r = piece.row;
    return [
      { neighbor: this._pieceAt(c, r - 1), edge: 'top' },
      { neighbor: this._pieceAt(c + 1, r), edge: 'right' },
      { neighbor: this._pieceAt(c, r + 1), edge: 'bottom' },
      { neighbor: this._pieceAt(c - 1, r), edge: 'left' },
    ].filter((n) => n.neighbor);
  }

  _pieceAt(col, row) {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return null;
    return this.pieces[row * this.cols + col];
  }

  _getExpectedOffset(piece, neighbor, edge) {
    const { cellW, cellH, tabSize } = this;
    // In piece-local coordinates, the piece's top-left grid corner is at (tabSize, tabSize).
    // Pieces are positioned so piece.x/piece.y is the top-left of their bounding box.
    // The grid corner (col*cellW, row*cellH) maps to piece.x + tabSize.
    //
    // For a neighbor to the right of `piece`:
    //   neighbor.x should = piece.x + cellW (grid aligned)
    //   neighbor.y should = piece.y
    switch (edge) {
      case 'right':
        return { dx: cellW, dy: 0 };
      case 'left':
        return { dx: -cellW, dy: 0 };
      case 'bottom':
        return { dx: 0, dy: cellH };
      case 'top':
        return { dx: 0, dy: -cellH };
      default:
        return null;
    }
  }

  _moveGroup(group, dx, dy) {
    for (const p of group.pieces) {
      p.x += dx;
      p.y += dy;
    }
    group.x += dx;
    group.y += dy;
  }

  _mergeGroups(g1, g2) {
    if (g1 === g2) return;
    // Keep the one with more pieces, absorb the other
    const [keep, drop] = g1.pieces.length >= g2.pieces.length ? [g1, g2] : [g2, g1];
    keep.absorb(drop);
    const idx = this.groups.indexOf(drop);
    if (idx >= 0) this.groups.splice(idx, 1);
    // Reassign all to keep
    for (const p of keep.pieces) p.group = keep;
  }

  _triggerGlow(pieces) {
    for (const p of pieces) {
      this._glowPieces.add(p);
      p.glowAlpha = 1;
    }
    this._startAnim();
  }

  _startAnim() {
    if (this._animFrame) return;
    const loop = () => {
      let needMore = false;
      // Decay glow
      for (const p of this._glowPieces) {
        p.glowAlpha *= 0.92;
        if (p.glowAlpha < 0.01) {
          p.glowAlpha = 0;
          this._glowPieces.delete(p);
        } else {
          needMore = true;
        }
      }
      // Completion animation
      if (this.completionAnim > 0 && this.completionAnim < 1) {
        this.completionAnim = Math.min(1, this.completionAnim + 0.02);
        needMore = true;
      }
      this.render();
      if (needMore || this.completionAnim > 0) {
        this._animFrame = requestAnimationFrame(loop);
      } else {
        this._animFrame = null;
      }
    };
    this._animFrame = requestAnimationFrame(loop);
  }

  _updateProgress() {
    const total = this.pieces.length;
    // Progress = (pieces in largest group) / total
    let largest = 0;
    for (const g of this.groups) {
      if (g.pieces.length > largest) largest = g.pieces.length;
    }
    // Alternatively: count snapped pieces. But with groups, we track largest group growth.
    // Better: count pieces whose group size > 1 (i.e. connected to at least one other)
    let connected = 0;
    for (const g of this.groups) {
      if (g.pieces.length > 1) connected += g.pieces.length;
    }
    // If all pieces are in a single group, that's 100%
    if (this.groups.length === 1 && this.pieces.length > 1) {
      connected = total;
    }
    const pct = Math.round((connected / total) * 100);
    this.emit('progress', pct);

    if (this.groups.length === 1 && !this.completed) {
      this.completed = true;
      this.completionAnim = 0.01;
      this._snapAllToSolved();
      this._startAnim();
      this.emit('complete');
    }
  }

  _snapAllToSolved() {
    // Snap all pieces to their solved positions
    for (const p of this.pieces) {
      p.x = p.col * this.cellW;
      p.y = p.row * this.cellH;
    }
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────
  render() {
    const ctx = this.ctx;
    const { canvas, scale, offsetX, offsetY } = this;
    const W = canvas.width;
    const H = canvas.height;

    // Clear with dark background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    if (this.pieces.length === 0) return;

    // Draw ghost image (faint outline of completed puzzle at board position)
    if (this.ghostEnabled) {
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      ctx.globalAlpha = 0.12;
      ctx.drawImage(this.image, 0, 0, this.imageW, this.imageH);
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, this.imageW, this.imageH);
      ctx.restore();
    }

    // Sort groups by zIndex (dragged group on top)
    const sortedGroups = [...this.groups].sort((a, b) => a.zIndex - b.zIndex);

    // Viewport culling: only draw pieces visible on screen
    const viewLeft = -offsetX / scale;
    const viewTop = -offsetY / scale;
    const viewRight = viewLeft + W / scale;
    const viewBottom = viewTop + H / scale;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    for (const group of sortedGroups) {
      for (const piece of group.pieces) {
        // Cull off-screen pieces
        if (
          piece.x + piece.canvas.width < viewLeft ||
          piece.x > viewRight ||
          piece.y + piece.canvas.height < viewTop ||
          piece.y > viewBottom
        ) {
          continue;
        }

        // Draw drop shadow (except when completed)
        if (!this.completed || this.completionAnim < 1) {
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.4)';
          ctx.shadowBlur = 6;
          ctx.shadowOffsetX = 2;
          ctx.shadowOffsetY = 3;
          ctx.drawImage(piece.canvas, piece.x - piece.pad, piece.y - piece.pad);
          ctx.restore();
        } else {
          ctx.drawImage(piece.canvas, piece.x - piece.pad, piece.y - piece.pad);
        }

        // Glow effect
        if (piece.glowAlpha > 0) {
          ctx.save();
          ctx.globalAlpha = piece.glowAlpha * 0.5;
          ctx.shadowColor = 'rgba(100,200,255,1)';
          ctx.shadowBlur = 20;
          ctx.drawImage(piece.canvas, piece.x - piece.pad, piece.y - piece.pad);
          ctx.restore();
        }
      }
    }

    // Completion animation: fade to full image with glow
    if (this.completionAnim > 0) {
      const a = this.completionAnim;
      ctx.globalAlpha = a * 0.8;
      ctx.shadowColor = 'rgba(255,220,100,0.6)';
      ctx.shadowBlur = 30 * a;
      ctx.drawImage(this.image, 0, 0, this.imageW, this.imageH);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  // ─── Shuffle: scatter pieces around the board ───────────────────────────────
  shuffle() {
    const rng = mulberry32(Date.now());
    const margin = this.tabSize + 20;
    // Scattering zone: the area outside the puzzle board but inside a reasonable range
    // We'll scatter pieces in a ring around the board
    const boardW = this.imageW;
    const boardH = this.imageH;
    const scatterRange = Math.max(boardW, boardH) * 0.6;

    for (const piece of this.pieces) {
      // Place randomly in a ring around the board area
      let px, py;
      let attempts = 0;
      do {
        // Pick a random position in the extended area
        px = (rng() - 0.5) * (boardW + scatterRange * 2);
        py = (rng() - 0.5) * (boardH + scatterRange * 2);
        attempts++;
      } while (
        attempts < 10 &&
        // Avoid placing inside the board area
        px > -boardW / 2 - margin &&
        px < boardW / 2 + margin &&
        py > -boardH / 2 - margin &&
        py < boardH / 2 + margin
      );

      // Offset so pieces are scattered around the board center
      // The board center is at (boardW/2, boardH/2) in world coords
      piece.x = boardW / 2 + px;
      piece.y = boardH / 2 + py;
    }

    // Reset groups: one per piece
    this.groups = [];
    let gid = 0;
    for (const piece of this.pieces) {
      const g = new PieceGroup(gid++);
      g.add(piece);
      g.x = piece.x;
      g.y = piece.y;
      this.groups.push(g);
    }
    this.completed = false;
    this.completionAnim = 0;
    this._updateProgress();
    this.render();
  }

  // ─── Toggle ghost image overlay ──────────────────────────────────────────────
  toggleGhost() {
    this.ghostEnabled = !this.ghostEnabled;
    this.render();
    return this.ghostEnabled;
  }

  // ─── Restart: re-scatter pieces ──────────────────────────────────────────────
  restart() {
    this.completed = false;
    this.completionAnim = 0;
    this.shuffle();
  }

  // ─── Save state to localStorage ──────────────────────────────────────────────
  save() {
    const key = `artpuzzle:${this.imageId}:${this.difficulty}`;
    const data = {
      pieces: this.pieces.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        col: p.col,
        row: p.row,
      })),
      groups: this.groups.map((g) => ({
        id: g.id,
        pieceIds: g.pieces.map((p) => p.id),
      })),
      completed: this.completed,
      ghostEnabled: this.ghostEnabled,
    };
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('Save failed:', e);
      return false;
    }
  }

  // ─── Load state from localStorage ─────────────────────────────────────────────
  load() {
    const key = `artpuzzle:${this.imageId}:${this.difficulty}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const data = JSON.parse(raw);

      // Restore piece positions
      const pieceMap = new Map(this.pieces.map((p) => [p.id, p]));
      for (const ps of data.pieces) {
        const p = pieceMap.get(ps.id);
        if (p) {
          p.x = ps.x;
          p.y = ps.y;
        }
      }

      // Restore groups
      this.groups = [];
      for (const gs of data.groups) {
        const g = new PieceGroup(gs.id);
        for (const pid of gs.pieceIds) {
          const p = pieceMap.get(pid);
          if (p) g.add(p);
        }
        this.groups.push(g);
      }

      this.completed = data.completed || false;
      this.ghostEnabled = data.ghostEnabled !== undefined ? data.ghostEnabled : this.ghostEnabled;
      this._updateProgress();
      this.render();
      return true;
    } catch (e) {
      console.error('Load failed:', e);
      return false;
    }
  }

  // ─── Get current progress percentage ─────────────────────────────────────────
  getProgress() {
    const total = this.pieces.length;
    if (total === 0) return 0;
    let connected = 0;
    for (const g of this.groups) {
      if (g.pieces.length > 1) connected += g.pieces.length;
    }
    if (this.groups.length === 1) connected = total;
    return Math.round((connected / total) * 100);
  }
}

// ─── Export to window (no module system, browser global) ─────────────────────
if (typeof window !== 'undefined') {
  window.JigsawPuzzle = JigsawPuzzle;
  window.Piece = Piece;
  window.PieceGroup = PieceGroup;
  window.PieceFactory = PieceFactory;
}
