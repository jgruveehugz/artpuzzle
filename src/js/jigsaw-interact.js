/**
 * jigsaw-interact.js — Input handling: unified pointer events for mouse+touch,
 * drag, zoom, pan.
 *
 * License: MIT
 */

'use strict';

/**
 * PointerInput manages all pointer-based interactions with the puzzle canvas.
 * Uses the Pointer Events API for unified mouse/touch/pen handling.
 * Supports: piece dragging, pinch-zoom, pan.
 */
class PointerInput {
  constructor(puzzle, canvas) {
    this.puzzle = puzzle;
    this.canvas = canvas;

    // Active pointers: Map of pointerId → {x, y}
    this.pointers = new Map();

    // Dragging state
    this.dragGroup = null;
    this.dragOffsetX = 0; // offset from piece origin to grab point
    this.dragOffsetY = 0;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.hasMoved = false;

    // Panning state (when 2+ pointers or background drag)
    this.isPanning = false;
    this.panStartOffsetX = 0;
    this.panStartOffsetY = 0;
    this.panStartX = 0;
    this.panStartY = 0;

    // Pinch-zoom state
    this.pinchStartDist = 0;
    this.pinchStartScale = 1;
    this.pinchCenterX = 0;
    this.pinchCenterY = 0;

    // Double-click detection (for potential rotation feature)
    this._lastTapTime = 0;
    this._lastTapX = 0;
    this._lastTapY = 0;

    this._bindEvents();
  }

  _bindEvents() {
    const c = this.canvas;
    c.style.touchAction = 'none'; // prevent default touch scrolling

    c.addEventListener('pointerdown', (e) => this._onDown(e));
    c.addEventListener('pointermove', (e) => this._onMove(e));
    c.addEventListener('pointerup', (e) => this._onUp(e));
    c.addEventListener('pointercancel', (e) => this._onUp(e));
    c.addEventListener('pointerleave', (e) => this._onUp(e));

    // Wheel zoom on desktop
    c.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

    // Prevent context menu on long-press
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ─── Coordinate helpers ────────────────────────────────────────────────────
  _toScreen(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  _screenToWorld(sx, sy) {
    const p = this.puzzle;
    return {
      x: (sx - p.offsetX) / p.scale,
      y: (sy - p.offsetY) / p.scale,
    };
  }

  // ─── Pointer down ──────────────────────────────────────────────────────────
  _onDown(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const pt = this._toScreen(e);
    this.pointers.set(e.pointerId, pt);

    if (this.pointers.size === 1) {
      // Single pointer: try to pick a piece
      const piece = this._pickPiece(pt.x, pt.y);
      if (piece) {
        // Start dragging this piece's group
        this.dragGroup = piece.group;
        this.dragStartX = pt.x;
        this.dragStartY = pt.y;
        this.hasMoved = false;

        // Calculate offset from piece to pointer (in screen space)
        const world = this._screenToWorld(pt.x, pt.y);
        this.dragOffsetX = world.x - piece.x;
        this.dragOffsetY = world.y - piece.y;

        // Bring group to top
        const maxZ = Math.max(0, ...this.puzzle.groups.map((g) => g.zIndex));
        this.dragGroup.zIndex = maxZ + 1;
        this.puzzle.render();
      } else {
        // Background drag = pan
        this.isPanning = true;
        this.panStartX = pt.x;
        this.panStartY = pt.y;
        this.panStartOffsetX = this.puzzle.offsetX;
        this.panStartOffsetY = this.puzzle.offsetY;
      }
    } else if (this.pointers.size === 2) {
      // Two pointers: start pinch-zoom
      this._cancelDrag();
      this.isPanning = false;
      this._initPinch();
    }

    // Double-tap detection
    const now = Date.now();
    if (now - this._lastTapTime < 350 &&
        Math.hypot(pt.x - this._lastTapX, pt.y - this._lastTapY) < 30) {
      this._onDoubleTap(pt.x, pt.y);
    }
    this._lastTapTime = now;
    this._lastTapX = pt.x;
    this._lastTapY = pt.y;
  }

  _cancelDrag() {
    if (this.dragGroup) {
      // Check snap on release
      this.puzzle.checkSnap(this.dragGroup);
      this.dragGroup = null;
    }
  }

  _initPinch() {
    const pts = [...this.pointers.values()];
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    this.pinchStartDist = Math.hypot(dx, dy);
    this.pinchStartScale = this.puzzle.scale;
    this.pinchCenterX = (pts[0].x + pts[1].x) / 2;
    this.pinchCenterY = (pts[0].y + pts[1].y) / 2;
    this.panStartOffsetX = this.puzzle.offsetX;
    this.panStartOffsetY = this.puzzle.offsetY;
  }

  // ─── Pointer move ───────────────────────────────────────────────────────────
  _onMove(e) {
    const pt = this._toScreen(e);
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, pt);
    }

    if (this.pointers.size === 2) {
      // Pinch-zoom
      this._updatePinch();
      return;
    }

    if (this.pointers.size === 1) {
      if (this.dragGroup) {
        // Drag the piece group
        const world = this._screenToWorld(pt.x, pt.y);
        const targetX = world.x - this.dragOffsetX;
        const targetY = world.y - this.dragOffsetY;

        // Move all pieces in the group by the delta
        const firstPiece = this.dragGroup.pieces[0];
        const dx = targetX - firstPiece.x;
        const dy = targetY - firstPiece.y;
        this.puzzle._moveGroup(this.dragGroup, dx, dy);

        this.hasMoved = true;
        this.puzzle.render();
      } else if (this.isPanning) {
        // Pan the board
        const dx = pt.x - this.panStartX;
        const dy = pt.y - this.panStartY;
        this.puzzle.offsetX = this.panStartOffsetX + dx;
        this.puzzle.offsetY = this.panStartOffsetY + dy;
        this.puzzle.render();
      }
    }
  }

  _updatePinch() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const dist = Math.hypot(dx, dy);
    if (this.pinchStartDist < 1) return;

    const newScale = Math.max(0.2, Math.min(4, this.pinchStartScale * (dist / this.pinchStartDist)));

    // Zoom around the pinch center
    const cx = (pts[0].x + pts[1].x) / 2;
    const cy = (pts[0].y + pts[1].y) / 2;

    // World point under the pinch center before zoom
    const worldX = (cx - this.panStartOffsetX) / this.pinchStartScale;
    const worldY = (cy - this.panStartOffsetY) / this.pinchStartScale;

    // Adjust offset so the world point stays under the pinch center
    this.puzzle.scale = newScale;
    this.puzzle.offsetX = cx - worldX * newScale;
    this.puzzle.offsetY = cy - worldY * newScale;

    this.puzzle.render();
  }

  // ─── Pointer up ─────────────────────────────────────────────────────────────
  _onUp(e) {
    const pt = this._toScreen(e);

    if (this.pointers.has(e.pointerId)) {
      this.pointers.delete(e.pointerId);
    }

    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch (_) {}

    if (this.pointers.size === 0) {
      // Released last pointer
      if (this.dragGroup) {
        // Check snap
        this.puzzle.checkSnap(this.dragGroup);
        this.dragGroup = null;
      }
      this.isPanning = false;
    } else if (this.pointers.size === 1) {
      // Went from 2 pointers to 1: re-init for single-pointer pan/drag
      const remaining = [...this.pointers.entries()][0];
      const pt2 = remaining[1];
      this.isPanning = true;
      this.panStartX = pt2.x;
      this.panStartY = pt2.y;
      this.panStartOffsetX = this.puzzle.offsetX;
      this.panStartOffsetY = this.puzzle.offsetY;
    }

    this.puzzle.render();
  }

  // ─── Wheel zoom (desktop) ───────────────────────────────────────────────────
  _onWheel(e) {
    e.preventDefault();
    const pt = this._toScreen(e);
    const delta = -e.deltaY * 0.001;
    const factor = Math.exp(delta);
    const newScale = Math.max(0.2, Math.min(4, this.puzzle.scale * factor));

    // Zoom around cursor position
    const worldX = (pt.x - this.puzzle.offsetX) / this.puzzle.scale;
    const worldY = (pt.y - this.puzzle.offsetY) / this.puzzle.scale;

    this.puzzle.scale = newScale;
    this.puzzle.offsetX = pt.x - worldX * newScale;
    this.puzzle.offsetY = pt.y - worldY * newScale;

    this.puzzle.render();
  }

  // ─── Pick the topmost piece at screen coordinates ───────────────────────────
  _pickPiece(sx, sy) {
    const p = this.puzzle;
    // Iterate groups from top to bottom (highest zIndex first)
    const sortedGroups = [...p.groups].sort((a, b) => b.zIndex - a.zIndex);
    for (const group of sortedGroups) {
      for (const piece of group.pieces) {
        if (p.hitTest(piece, sx, sy)) {
          return piece;
        }
      }
    }
    return null;
  }

  // ─── Double-tap handler (placeholder for rotation) ──────────────────────────
  _onDoubleTap(sx, sy) {
    const piece = this._pickPiece(sx, sy);
    if (piece) {
      this.puzzle.emit('pieceDoubleTap', piece.id);
    }
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────────
  destroy() {
    this.pointers.clear();
    this.dragGroup = null;
    this.isPanning = false;
  }
}

if (typeof window !== 'undefined') {
  window.PointerInput = PointerInput;
}
