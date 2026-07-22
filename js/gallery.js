/* ============================================
   ArtPuzzle — Gallery Page Logic (gallery.js)
   - Fetch puzzles.json
   - Render puzzle cards in a responsive grid
   - Category filter dropdown, difficulty filter,
     and search bar
   - Lazy load images
   - Click Play → puzzle.html?id={puzzle-id}
   ============================================ */

(function () {
  "use strict";

  const PLACEHOLDER_IMG =
    "https://images.metmuseum.org/CRDImages/as/original/DP369217.jpg";

  let allPuzzles = [];
  let activeCategory = "";
  let activeDifficulty = "";
  let searchTerm = "";

  // --- Fetch puzzles.json (with localStorage cache) ---
  async function fetchPuzzles() {
    const cacheKey = "artpuzzle_puzzles_cache";
    const cacheTimeKey = "artpuzzle_puzzles_cache_time";
    const CACHE_TTL = 1000 * 60 * 60;

    try {
      const cached = localStorage.getItem(cacheKey);
      const cachedTime = localStorage.getItem(cacheTimeKey);
      if (cached && cachedTime) {
        const age = Date.now() - parseInt(cachedTime, 10);
        if (age < CACHE_TTL) return JSON.parse(cached);
      }
    } catch (e) {}

    try {
      const resp = await fetch("data/puzzles.json?v=" + Date.now());
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      try {
        localStorage.setItem(cacheKey, JSON.stringify(data));
        localStorage.setItem(cacheTimeKey, String(Date.now()));
      } catch (e) {}
      return data;
    } catch (err) {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch (e) {}
      return null;
    }
  }

  // --- Populate the category dropdown from puzzle data ---
  function populateCategoryFilter(puzzles) {
    const select = document.getElementById("category-filter");
    if (!select) return;

    const categories = new Set();
    puzzles.forEach(function (p) {
      if (p.category) categories.add(p.category);
    });

    // Keep the "All Categories" option, append the rest
    const sorted = Array.from(categories).sort();
    select.innerHTML =
      '<option value="">All Categories</option>' +
      sorted
        .map(function (c) {
          return (
            '<option value="' +
            escapeAttr(c) +
            '">' +
            escapeHtml(c) +
            "</option>"
          );
        })
        .join("");

    // Pre-select from URL param
    const urlParams = new URLSearchParams(window.location.search);
    const catParam = urlParams.get("category");
    if (catParam) {
      select.value = catParam;
      activeCategory = catParam;
    }
  }

  // --- Determine difficulty badge from piece count ---
  function getDifficultyBadge(pieceCount) {
    if (pieceCount == null) return "";
    const n = parseInt(pieceCount, 10);
    if (n <= 24)
      return '<span class="badge badge-easy">Easy</span>';
    if (n <= 48)
      return '<span class="badge badge-medium">Medium</span>';
    if (n <= 96)
      return '<span class="badge badge-hard">Hard</span>';
    return '<span class="badge badge-hard">Expert</span>';
  }

  function getDifficultyKey(pieceCount) {
    const n = parseInt(pieceCount, 10);
    if (n <= 24) return "easy";
    if (n <= 48) return "medium";
    if (n <= 96) return "hard";
    return "expert";
  }

  // --- Render a single puzzle card ---
  function renderCard(puzzle) {
    const id = puzzle.id || "";
    const title = puzzle.title || "Untitled";
    const artist = puzzle.artist || "Unknown artist";
    const image = puzzle.image || puzzle.thumbnail || PLACEHOLDER_IMG;
    const category = puzzle.category || "";
    const pieces = puzzle.pieces || puzzle.pieceCount || "";
    const difficultyBadge = getDifficultyBadge(pieces);

    return (
      '<article class="puzzle-card">' +
      '<div class="puzzle-card-image">' +
      '<div class="puzzle-card-difficulty">' +
      difficultyBadge +
      "</div>" +
      '<img src="' +
      escapeAttr(image) +
      '" alt="' +
      escapeAttr(title + " by " + artist + " — jigsaw puzzle") +
      '" loading="lazy">' +
      '<div class="puzzle-card-overlay">' +
      '<a href="puzzle.html?id=' +
      encodeURIComponent(id) +
      '" class="btn btn-primary">▶ Play</a>' +
      "</div>" +
      "</div>" +
      '<div class="puzzle-card-body">' +
      '<h3 class="puzzle-card-title">' +
      escapeHtml(title) +
      "</h3>" +
      '<p class="puzzle-card-artist">' +
      escapeHtml(artist) +
      "</p>" +
      '<div class="puzzle-card-footer">' +
      '<span class="puzzle-card-meta">' +
      (category ? escapeHtml(category) : "") +
      (pieces ? " · " + pieces + " pieces" : "") +
      "</span>" +
      '<a href="puzzle.html?id=' +
      encodeURIComponent(id) +
      '" class="btn-play">Play</a>' +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  // --- Filter and render the grid ---
  function renderGrid() {
    const grid = document.getElementById("puzzle-grid");
    const countEl = document.getElementById("gallery-count");
    if (!grid) return;

    if (!allPuzzles || allPuzzles.length === 0) {
      grid.innerHTML =
        '<div class="empty-state" style="grid-column: 1 / -1;">' +
        "<h3>No puzzles yet</h3>" +
        "<p>The collection is being curated. Check back soon!</p>" +
        '<a href="index.html" class="btn btn-secondary" style="margin-top:1rem;">Back to Home</a>' +
        "</div>";
      if (countEl) countEl.textContent = "";
      return;
    }

    const filtered = allPuzzles.filter(function (p) {
      // Category filter
      if (activeCategory && p.category !== activeCategory) return false;

      // Difficulty filter
      if (activeDifficulty) {
        const key = getDifficultyKey(p.pieces || p.pieceCount);
        if (key !== activeDifficulty) return false;
      }

      // Search filter
      if (searchTerm) {
        const hay = (
          (p.title || "") +
          " " +
          (p.artist || "") +
          " " +
          (p.category || "")
        ).toLowerCase();
        if (!hay.includes(searchTerm.toLowerCase())) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      grid.innerHTML =
        '<div class="empty-state" style="grid-column: 1 / -1;">' +
        "<h3>No puzzles match your filters</h3>" +
        "<p>Try adjusting your search or filters.</p>" +
        "</div>";
    } else {
      grid.innerHTML = filtered.map(renderCard).join("");
    }

    if (countEl) {
      countEl.textContent =
        filtered.length +
        " puzzle" +
        (filtered.length !== 1 ? "s" : "");
    }
  }

  // --- Wire up event listeners ---
  function setupListeners() {
    const searchInput = document.getElementById("search-input");
    const categoryFilter = document.getElementById("category-filter");
    const difficultyFilter = document.getElementById("difficulty-filter");

    if (searchInput) {
      let debounceTimer;
      searchInput.addEventListener("input", function (e) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          searchTerm = e.target.value.trim();
          renderGrid();
        }, 200);
      });
    }

    if (categoryFilter) {
      categoryFilter.addEventListener("change", function (e) {
        activeCategory = e.target.value;
        renderGrid();
      });
    }

    if (difficultyFilter) {
      difficultyFilter.addEventListener("change", function (e) {
        activeDifficulty = e.target.value;
        renderGrid();
      });
    }
  }

  // --- Main init ---
  async function init() {
    setupListeners();

    const puzzles = await fetchPuzzles();

    if (!puzzles || puzzles.length === 0) {
      allPuzzles = [];
      populateCategoryFilter([]);
    } else {
      allPuzzles = puzzles;
      populateCategoryFilter(puzzles);
    }

    renderGrid();
  }

  // --- HTML escaping helpers ---
  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  // --- DOM Ready ---
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
