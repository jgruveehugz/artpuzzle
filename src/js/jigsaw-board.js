/**
 * jigsaw-board.js — Board management: layout, viewport culling, progress tracking.
 *
 * License: MIT
 */

'use strict';

/**
 * PuzzleBoard manages the overall board layout: positioning the puzzle area
 * in the center of the canvas, computing the initial viewport (scale/offset)
 * to fit the board, and handling resize events.
 */
class PuzzleBoard {
  constructor(puzzle, canvas) {
    this.puzzle = puzzle;
    this.canvas = canvas;

    // The board area in world coordinates (where the completed puzzle sits)
    this.boardX = 0;
    this.boardY = 0;
    this.boardW = 0;
    this.boardH = 0;

    // The total play area (board + scatter zone)
    this.worldW = 0;
    this.worldH = 0;
  }

  /**
   * Compute the initial layout: board position, world dimensions,
   * and initial view transform (scale + offset) to fit the board on screen.
   */
  layout() {
    const p = this.puzzle;
    if (!p.image) return;

    // The completed puzzle occupies (0, 0) to (imageW, imageH) in world space.
    // We center the board around origin: board from (-imageW/2, -imageH/2) to (imageW/2, imageH/2).
    // Actually, for simplicity, let the puzzle origin be (0,0) = top-left of the image.
    // The board is the region (0, 0) to (imageW, imageH).

    this.boardX = 0;
    this.boardY = 0;
    this.boardW = p.imageW;
    this.boardH = p.imageH;

    // World dimensions: board + scatter margin on all sides
    const scatterMargin = Math.max(p.imageW, p.imageH) * 0.25;
    this.worldW = p.imageW + scatterMargin * 2;
    this.worldH = p.imageH + scatterMargin * 2;

    // Set the puzzle's board reference
    p.boardX = this.boardX;
    p.boardY = this.boardY;

    // Compute initial view transform to fit everything (board + scatter)
    this.fitToView(false);
  }

  /**
   * Adjust scale and offset so the entire puzzle (with scatter area) fits in the canvas.
   * Optionally fit just the board (completed area) tightly.
   */
  fitToView(fitBoardOnly = false) {
    const p = this.puzzle;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    const targetW = fitBoardOnly ? this.boardW : this.worldW;
    const targetH = fitBoardOnly ? this.boardH : this.worldH;

    const scaleX = cw / targetW;
    const scaleY = ch / targetH;
    let scale = Math.min(scaleX, scaleY) * 0.9; // 90% to leave some padding

    // Clamp scale
    scale = Math.max(0.15, Math.min(2, scale));

    // Center the target in the canvas
    let offsetX, offsetY;
    if (fitBoardOnly) {
      offsetX = (cw - this.boardW * scale) / 2;
      offsetY = (ch - this.boardH * scale) / 2;
    } else {
      // Center the world area, but shift so the board is roughly centered
      const worldCenterX = this.boardX + this.boardW / 2;
      const worldCenterY = this.boardY + this.boardH / 2;
      offsetX = cw / 2 - worldCenterX * scale;
      offsetY = ch / 2 - worldCenterY * scale;
    }

    p.scale = scale;
    p.offsetX = offsetX;
    p.offsetY = offsetY;
  }

  /**
   * Center the view on the board area.
   */
  centerOnBoard() {
    const p = this.puzzle;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    p.offsetX = cw / 2 - (this.boardX + this.boardW / 2) * p.scale;
    p.offsetY = ch / 2 - (this.boardY + this.boardH / 2) * p.scale;
  }

  /**
   * Zoom to a specific scale, keeping a screen-space point fixed.
   */
  zoomAt(screenX, screenY, newScale) {
    const p = this.puzzle;
    newScale = Math.max(0.15, Math.min(4, newScale));

    const worldX = (screenX - p.offsetX) / p.scale;
    const worldY = (screenY - p.offsetY) / p.scale;

    p.scale = newScale;
    p.offsetX = screenX - worldX * newScale;
    p.offsetY = screenY - worldY * newScale;
  }

  /**
   * Handle canvas resize: re-fit the view.
   */
  onResize() {
    // Just re-fit; the pieces are in world space so they stay consistent
    this.fitToView();
    this.puzzle.render();
  }

  /**
   * Get the progress as a percentage of pieces connected.
   * Delegates to the puzzle's group tracking.
   */
  getProgress() {
    return this.puzzle.getProgress();
  }

  /**
   * Get a list of pieces visible in the current viewport (for culling/debug).
   */
  getVisiblePieces() {
    const p = this.puzzle;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    const viewLeft = -p.offsetX / p.scale;
    const viewTop = -p.offsetY / p.scale;
    const viewRight = viewLeft + cw / p.scale;
    const viewBottom = viewTop + ch / p.scale;

    return p.pieces.filter((piece) => {
      return !(
        piece.x + (piece.canvas?.width || 0) < viewLeft ||
        piece.x > viewRight ||
        piece.y + (piece.canvas?.height || 0) < viewTop ||
        piece.y > viewBottom
      );
    });
  }

  /**
   * Count connected groups and lone pieces.
   */
  getGroupStats() {
    const groups = this.puzzle.groups;
    let lone = 0;
    let multi = 0;
    let maxGroupSize = 0;
    for (const g of groups) {
      if (g.pieces.length === 1) lone++;
      else multi++;
      maxGroupSize = Math.max(maxGroupSize, g.pieces.length);
    }
    return { totalGroups: groups.length, lone, multi, maxGroupSize };
  }
}

if (typeof window !== 'undefined') {
  window.PuzzleBoard = PuzzleBoard;
}
