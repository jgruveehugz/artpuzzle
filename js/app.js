/* ============================================
   ArtPuzzle — Landing Page Logic (app.js)
   - Daily featured puzzle (date-seeded pick)
   - Category grid rendering
   - Graceful empty states when puzzles.json
     doesn't exist yet
   ============================================ */

(function () {
  "use strict";

  // --- Fallback / placeholder data for empty states ---
  const PLACEHOLDER_IMG =
    "https://images.metmuseum.org/CRDImages/as/original/DP369217.jpg";

  const FALLBACK_CATEGORIES = [
    {
      name: "Japanese Ukiyo-e",
      thumbnail:
        "https://images.metmuseum.org/CRDImages/as/original/DP369217.jpg",
      count: 0,
    },
    {
      name: "Chinese Landscapes",
      thumbnail:
        "https://images.metmuseum.org/CRDImages/as/original/DP369217.jpg",
      count: 0,
    },
    {
      name: "Western Masters",
      thumbnail:
        "https://images.metmuseum.org/CRDImages/eur/original/DP369217.jpg",
      count: 0,
    },
    {
      name: "South & Southeast Asian",
      thumbnail:
        "https://images.metmuseum.org/CRDImages/as/original/DP369217.jpg",
      count: 0,
    },
    {
      name: "Ancient Egyptian",
      thumbnail:
        "https://images.metmuseum.org/CRDImages/eg/original/DP369217.jpg",
      count: 0,
    },
    {
      name: "Islamic Art",
      thumbnail:
        "https://images.metmuseum.org/CRDImages/is/original/DP369217.jpg",
      count: 0,
    },
  ];

  // --- Date-seeded daily puzzle selection ---
  // Uses a simple deterministic hash of the date string so the
  // same puzzle appears all day, then rotates at midnight.
  function getDailyPuzzleIndex(puzzleCount) {
    const now = new Date();
    const dateStr =
      now.getFullYear() + "-" +
      String(now.getMonth() + 1).padStart(2, "0") + "-" +
      String(now.getDate()).padStart(2, "0");

    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
      hash = (hash * 31 + dateStr.charCodeAt(i)) & 0x7fffffff;
    }
    return hash % puzzleCount;
  }

  // --- Fetch puzzles.json with caching to localStorage ---
  async function fetchPuzzles() {
    const cacheKey = "artpuzzle_puzzles_cache";
    const cacheTimeKey = "artpuzzle_puzzles_cache_time";
    const CACHE_TTL = 1000 * 60 * 60; // 1 hour

    // Try cache first
    try {
      const cached = localStorage.getItem(cacheKey);
      const cachedTime = localStorage.getItem(cacheTimeKey);
      if (cached && cachedTime) {
        const age = Date.now() - parseInt(cachedTime, 10);
        if (age < CACHE_TTL) {
          return JSON.parse(cached);
        }
      }
    } catch (e) {
      /* localStorage may be unavailable */
    }

    // Fetch fresh
    try {
      const resp = await fetch("data/puzzles.json?v=" + Date.now());
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      try {
        localStorage.setItem(cacheKey, JSON.stringify(data));
        localStorage.setItem(cacheTimeKey, String(Date.now()));
      } catch (e) {
        /* storage full or unavailable */
      }
      return data;
    } catch (err) {
      // Try stale cache as fallback
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch (e) {
        /* ignore */
      }
      return null;
    }
  }

  // --- Render the hero / daily featured puzzle ---
  function renderHero(puzzle) {
    const bgImg = document.getElementById("hero-bg-img");
    const titleEl = document.getElementById("hero-title");
    const artistEl = document.getElementById("hero-artist");
    const metaEl = document.getElementById("hero-meta");
    const actionsEl = document.getElementById("hero-actions");

    if (!puzzle) {
      bgImg.src = PLACEHOLDER_IMG;
      titleEl.textContent = "Welcome to ArtPuzzle";
      artistEl.textContent = "Puzzles coming soon";
      metaEl.innerHTML = "";
      actionsEl.innerHTML =
        '<a href="gallery.html" class="btn btn-primary btn-lg">Browse Gallery</a>';
      return;
    }

    bgImg.src = puzzle.image || puzzle.thumbnail || PLACEHOLDER_IMG;
    bgImg.alt = puzzle.title || "Featured artwork";

    titleEl.textContent = puzzle.title || "Untitled";
    artistEl.textContent = puzzle.artist || "Unknown artist";

    const metaParts = [];
    if (puzzle.category)
      metaParts.push('<span class="meta-item">📂 ' + escapeHtml(puzzle.category) + "</span>");
    if (puzzle.year || puzzle.date)
      metaParts.push('<span class="meta-item">📅 ' + escapeHtml(String(puzzle.year || puzzle.date)) + "</span>");
    if (puzzle.museum)
      metaParts.push('<span class="meta-item">🏛️ ' + escapeHtml(puzzle.museum) + "</span>");
    metaEl.innerHTML = metaParts.join("");

    const puzzleId = puzzle.id || "";
    actionsEl.innerHTML =
      '<a href="puzzle.html?id=' +
      encodeURIComponent(puzzleId) +
      '" class="btn btn-primary btn-lg">▶ Play Today&#39;s Puzzle</a>' +
      '<a href="gallery.html" class="btn btn-secondary btn-lg">Browse All</a>';
  }

  // --- Render the category grid ---
  function renderCategoryGrid(categories) {
    const grid = document.getElementById("category-grid");
    if (!grid) return;

    if (!categories || categories.length === 0) {
      grid.innerHTML =
        '<div class="empty-state"><h3>No categories yet</h3>' +
        "<p>Puzzles will appear here once the collection is ready.</p></div>";
      return;
    }

    grid.innerHTML = categories
      .map(function (cat) {
        const countText =
          cat.count > 0 ? cat.count + (cat.count === 1 ? " puzzle" : " puzzles") : "Coming soon";
        return (
          '<a href="gallery.html?category=' +
          encodeURIComponent(cat.name) +
          '" class="category-card">' +
          '<div class="category-card-thumb-wrap">' +
          '<img class="category-card-thumb" src="' +
          escapeAttr(cat.thumbnail || PLACEHOLDER_IMG) +
          '" alt="' +
          escapeAttr(cat.name) +
          '" loading="lazy">' +
          '<span class="category-card-count-pill">' +
          countText +
          "</span>" +
          "</div>" +
          '<div class="category-card-body">' +
          '<h3 class="category-card-name">' +
          escapeHtml(cat.name) +
          "</h3>" +
          '<p class="category-card-desc">' +
          escapeHtml(cat.desc || "") +
          "</p>" +
          "</div>" +
          "</a>"
        );
      })
      .join("");
  }

  // --- Derive categories from puzzle data ---
  const CATEGORY_DESCRIPTIONS = {
    "Japanese Ukiyo-e": "Woodblock prints and paintings from Japan's floating world",
    "Japanese Screen Paintings": "Byōbu and fusuma — ink and color on gold and silk",
    "Chinese Landscapes": "Shan shui — mountains and water in ink, across the dynasties",
    "Korean Joseon Dynasty": "Paintings from Korea's five-hundred-year kingdom",
    "Western Old Masters": "European painting from the Renaissance to the Baroque",
    "Impressionism": "Light, color, and the modern world — Monet to Van Gogh",
    "Islamic Art": "Calligraphy, geometry, and the illuminated manuscript",
  };

  function deriveCategories(puzzles) {
    const catMap = {};
    puzzles.forEach(function (p) {
      if (!p.category) return;
      if (!catMap[p.category]) {
        catMap[p.category] = {
          name: p.category,
          thumbnail: p.image || p.thumbnail || PLACEHOLDER_IMG,
          count: 0,
          desc: CATEGORY_DESCRIPTIONS[p.category] || "",
        };
      }
      catMap[p.category].count++;
    });
    return Object.values(catMap).sort(function (a, b) {
      return b.count - a.count;
    });
  }

  // --- Main init ---
  async function init() {
    const puzzles = await fetchPuzzles();

    if (!puzzles || puzzles.length === 0) {
      // Empty state — still render a welcoming landing page
      renderHero(null);
      renderCategoryGrid(FALLBACK_CATEGORIES);
      return;
    }

    // Daily featured puzzle
    const dailyIdx = getDailyPuzzleIndex(puzzles.length);
    renderHero(puzzles[dailyIdx]);

    // Category grid from real data
    renderCategoryGrid(deriveCategories(puzzles));
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
