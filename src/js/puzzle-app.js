/**
 * puzzle-app.js — App logic: loading puzzles from URL params, difficulty
 * selection, completion handling, localStorage save/load.
 *
 * License: MIT
 */

'use strict';

/**
 * PuzzleApp is the top-level controller that ties together JigsawPuzzle,
 * PuzzleBoard, and PointerInput. It handles:
 * - Reading URL params (image URL, difficulty, title, artist)
 * - Creating/destroying puzzle instances
 * - UI wiring (buttons, progress bar, difficulty selector)
 * - Save/load state
 * - Completion flow
 */
class PuzzleApp {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.puzzle = null;
    this.board = null;
    this.input = null;

    // Config from options or URL params
    this.options = options;
    this.config = this._parseConfig(options);

    // UI element refs (optional, may be null if not provided)
    this.ui = {
      progressBar: options.progressBar || null,
      progressText: options.progressText || null,
      titleEl: options.titleEl || null,
      artistEl: options.artistEl || null,
      difficultySelect: options.difficultySelect || null,
      ghostBtn: options.ghostBtn || null,
      shuffleBtn: options.shuffleBtn || null,
      restartBtn: options.restartBtn || null,
      saveBtn: options.saveBtn || null,
      loadingOverlay: options.loadingOverlay || null,
      completionOverlay: options.completionOverlay || null,
    };

    this._resizeHandler = null;
    this._saveTimeout = null;
  }

  // ─── Parse config from options or URL query params ──────────────────────────
  _parseConfig(options) {
    const params = new URLSearchParams(window.location.search);
    return {
      image: options.image || params.get('image') || '',
      difficulty: parseInt(options.difficulty || params.get('difficulty') || '48', 10),
      ghostImage: options.ghostImage !== undefined
        ? options.ghostImage
        : params.get('ghost') !== '0',
      title: options.title || params.get('title') || 'Untitled Puzzle',
      artist: options.artist || params.get('artist') || 'Unknown Artist',
      imageId: options.imageId || params.get('id') || options.image || params.get('image') || 'default',
    };
  }

  // ─── Initialize: load image, create puzzle, start ────────────────────────────
  async init() {
    if (!this.config.image) {
      this._showError('No image URL provided. Use ?image=<url> in the URL.');
      return;
    }

    // Validate difficulty
    const validDiffs = [24, 48, 96, 192];
    if (!validDiffs.includes(this.config.difficulty)) {
      this.config.difficulty = 48;
    }

    // Set canvas size to container
    this._resizeCanvas();

    // Update UI
    this._updateTitleUI();
    this._showLoading(true);

    try {
      // Create puzzle instance
      this.puzzle = new JigsawPuzzle({
        canvas: this.canvas,
        image: this.config.image,
        difficulty: this.config.difficulty,
        ghostImage: this.config.ghostImage,
        imageId: this.config.imageId,
      });

      // Wire events
      this.puzzle.on('progress', (pct) => this._onProgress(pct));
      this.puzzle.on('complete', () => this._onComplete());
      this.puzzle.on('pieceSnap', (id) => this._onPieceSnap(id));
      this.puzzle.on('loading', () => this._showLoading(true));
      this.puzzle.on('loaded', () => this._onLoaded());

      // Load image and generate pieces
      await this.puzzle.loadImage();

      // Create board layout
      this.board = new PuzzleBoard(this.puzzle, this.canvas);
      this.board.layout();

      // Create input handler
      this.input = new PointerInput(this.puzzle, this.canvas);

      // Try to load saved state
      const loaded = this.puzzle.load();
      if (!loaded) {
        // No saved state — shuffle pieces
        this.puzzle.shuffle();
      }

      // Set up resize listener
      this._resizeHandler = () => this._onResize();
      window.addEventListener('resize', this._resizeHandler);

      // Wire UI buttons
      this._wireUI();

      // Initial render
      this.puzzle.render();

      this._showLoading(false);
    } catch (err) {
      console.error('Puzzle init failed:', err);
      this._showError('Failed to load puzzle: ' + err.message);
    }
  }

  // ─── Loaded callback ─────────────────────────────────────────────────────────
  _onLoaded() {
    this._showLoading(false);
  }

  // ─── Progress callback ───────────────────────────────────────────────────────
  _onProgress(pct) {
    if (this.ui.progressBar) {
      this.ui.progressBar.style.width = pct + '%';
    }
    if (this.ui.progressText) {
      this.ui.progressText.textContent = pct + '%';
    }

    // Auto-save (debounced)
    this._scheduleSave();
  }

  // ─── Piece snap callback ─────────────────────────────────────────────────────
  _onPieceSnap(pieceId) {
    // Could play a sound here
    // Auto-save after snap
    this._scheduleSave();
  }

  // ─── Completion callback ─────────────────────────────────────────────────────
  _onComplete() {
    if (this.ui.completionOverlay) {
      this.ui.completionOverlay.classList.add('show');
    }
    // Auto-save final state
    this.puzzle.save();
  }

  // ─── Schedule auto-save (debounced) ──────────────────────────────────────────
  _scheduleSave() {
    if (this._saveTimeout) clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      if (this.puzzle && !this.puzzle.completed) {
        this.puzzle.save();
      }
    }, 2000);
  }

  // ─── Wire up UI buttons ──────────────────────────────────────────────────────
  _wireUI() {
    if (this.ui.ghostBtn) {
      this.ui.ghostBtn.addEventListener('click', () => {
        const enabled = this.puzzle.toggleGhost();
        this.ui.ghostBtn.classList.toggle('active', enabled);
      });
      this.ui.ghostBtn.classList.toggle('active', this.config.ghostImage);
    }

    if (this.ui.shuffleBtn) {
      this.ui.shuffleBtn.addEventListener('click', () => {
        this.puzzle.shuffle();
      });
    }

    if (this.ui.restartBtn) {
      this.ui.restartBtn.addEventListener('click', () => {
        // Clear saved state
        const key = `artpuzzle:${this.config.imageId}:${this.config.difficulty}`;
        localStorage.removeItem(key);
        this.puzzle.restart();
      });
    }

    if (this.ui.saveBtn) {
      this.ui.saveBtn.addEventListener('click', () => {
        const ok = this.puzzle.save();
        this.ui.saveBtn.textContent = ok ? 'Saved!' : 'Failed';
        setTimeout(() => {
          this.ui.saveBtn.textContent = 'Save';
        }, 1500);
      });
    }

    if (this.ui.difficultySelect) {
      // Set current value
      this.ui.difficultySelect.value = String(this.config.difficulty);
      this.ui.difficultySelect.addEventListener('change', (e) => {
        const newDiff = parseInt(e.target.value, 10);
        // Reload page with new difficulty
        const url = new URL(window.location.href);
        url.searchParams.set('difficulty', String(newDiff));
        window.location.href = url.toString();
      });
    }
  }

  // ─── Update title/artist in UI ───────────────────────────────────────────────
  _updateTitleUI() {
    if (this.ui.titleEl) this.ui.titleEl.textContent = this.config.title;
    if (this.ui.artistEl) this.ui.artistEl.textContent = this.config.artist;
  }

  // ─── Canvas sizing ───────────────────────────────────────────────────────────
  _resizeCanvas() {
    const parent = this.canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = parent ? parent.clientWidth : window.innerWidth;
    const h = parent ? parent.clientHeight : window.innerHeight;

    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.scale(dpr, dpr);

    // Adjust canvas dimensions for rendering (we work in CSS pixels)
    this.canvas.width = w;
    this.canvas.height = h;
  }

  _onResize() {
    this._resizeCanvas();
    if (this.board) {
      this.board.onResize();
    }
  }

  // ─── Loading overlay ─────────────────────────────────────────────────────────
  _showLoading(show) {
    if (this.ui.loadingOverlay) {
      this.ui.loadingOverlay.style.display = show ? 'flex' : 'none';
    }
  }

  _showError(msg) {
    this._showLoading(false);
    const overlay = this.ui.loadingOverlay;
    if (overlay) {
      overlay.innerHTML = `<div class="error">${msg}</div>`;
      overlay.style.display = 'flex';
    } else {
      alert(msg);
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────
  destroy() {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
    }
    if (this.input) {
      this.input.destroy();
    }
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
    }
    this.puzzle = null;
    this.board = null;
    this.input = null;
  }

  // ─── Change difficulty (recreates puzzle) ────────────────────────────────────
  async changeDifficulty(newDiff) {
    const validDiffs = [24, 48, 96, 192];
    if (!validDiffs.includes(newDiff)) return;

    this.destroy();
    this.config.difficulty = newDiff;
    await this.init();
  }
}

if (typeof window !== 'undefined') {
  window.PuzzleApp = PuzzleApp;
}
