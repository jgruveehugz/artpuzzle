# Jigsaw Engine Spec — ArtPuzzle

## Goal
Build an HTML5 Canvas jigsaw puzzle engine in vanilla JavaScript. No frameworks. No dependencies. Must work on desktop and mobile (touch).

## Core Requirements

### Piece Generation
- Take a source image and divide it into a grid of pieces
- Support piece counts: 24 (4x6), 48 (6x8), 96 (8x12), 192 (12x16)
- Each piece has irregular edges (tabs and blanks) like a real jigsaw
- Tab/blank pattern should alternate and be deterministic (same image + difficulty = same pieces)
- Piece shape: classic jigsaw curve (bezier curves for tabs)
- Each piece is rendered to its own offscreen canvas for performance

### Interaction
- Click/tap to select a piece
- Drag to move (mouse and touch)
- Pieces snap together when edges align within tolerance (15px)
- Snapped pieces form a group that moves together
- When all pieces are connected, trigger completion animation
- Optional: piece rotation (double-click to rotate 90°) — for hard mode only
- Pieces start scattered randomly around the board (not overlapping the puzzle area)

### Board
- Puzzle board area in center of screen
- Scattered pieces around the board edges
- Ghost image option (faint outline of the completed image, toggleable)
- Zoom and pan (pinch-zoom on mobile, scroll on desktop)
- Board shows faint outline of the puzzle dimensions

### Visual Design
- Clean, minimal, museum/gallery aesthetic
- Dark or warm neutral background (not pure black or white)
- Pieces have subtle shadow for depth
- Snapped pieces have no visible seam
- Smooth animations for piece movement
- Completion: subtle celebratory animation (fade to full image, gentle glow)

### UI Elements
- Top bar: puzzle title, artist name, difficulty selector
- Side or bottom: progress bar (pieces connected / total)
- Controls: toggle ghost image, shuffle, restart, change difficulty
- Menu: back to gallery, share result
- Mobile: collapsible top bar, touch-first controls

### Performance
- Use offscreen canvases for individual pieces
- Only render visible pieces (viewport culling)
- Limit redraws to only when pieces move
- Image preloading with progress indicator
- Support images up to 1200x1200px
- Must handle 192 pieces smoothly on mobile

## File Structure
```
src/js/
  jigsaw-engine.js    — Core engine: piece generation, rendering, snapping
  jigsaw-interact.js  — Input handling: mouse, touch, drag, zoom
  jigsaw-board.js     — Board management: layout, viewport, progress
  puzzle-app.js       — App logic: loading puzzles, difficulty, completion
src/css/
  puzzle.css          — Puzzle page styles
  gallery.css         — Gallery page styles
  main.css            — Shared styles, layout, typography
```

## Technical Constraints
- Vanilla JS (ES6+). No React, Vue, or frameworks.
- Canvas 2D API only (no WebGL needed)
- Must work in Safari iOS 16+, Chrome Android, desktop Chrome/Safari/Firefox
- Touch events must use pointer events for unified mouse/touch handling
- Image loading must handle CORS (museum images may need crossOrigin="anonymous")
- localStorage for progress saving (which pieces are connected)
- Total codebase target: 3,000-4,000 lines of JS

## Piece Shape Algorithm
Use the classic jigsaw piece with bezier-curved tabs. The algorithm:
1. Divide image into grid of cells (e.g., 6x8 for 48 pieces)
2. For each cell edge (top, right, bottom, left), determine if it has a tab or blank
3. Adjacent pieces must have complementary edges (if piece A's right edge has a tab, piece B's left edge must have a blank)
4. Border edges (outer edges of the puzzle) are flat
5. Tab/blank assignment is deterministic based on a seed (image ID + difficulty)
6. Render each piece by clipping the source image to the piece shape using bezier paths

## Snapping Logic
- When dragging a piece/group near another piece's edge
- Check if the edges are complementary (tab/blank match)
- Check alignment within 15px tolerance
- If match: snap into place, merge groups
- Play subtle visual feedback (brief glow on snap)
- Track progress as (snapped pieces / total pieces)

## API (for the app layer)
```js
// Initialize a puzzle
const puzzle = new JigsawPuzzle({
  canvas: document.getElementById('puzzle-canvas'),
  image: 'assets/images/japanese-ukiyoe/great-wave.jpg',
  difficulty: 48, // piece count
  ghostImage: true
});

// Events
puzzle.on('progress', (percent) => { ... });
puzzle.on('complete', () => { ... });
puzzle.on('pieceSnap', (pieceId) => { ... });

// Methods
puzzle.shuffle();
puzzle.toggleGhost();
puzzle.restart();
puzzle.save(); // to localStorage
puzzle.load(); // from localStorage
```
