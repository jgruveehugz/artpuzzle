# ArtPuzzle — Curated Museum Art Jigsaw Puzzles

A web-based jigsaw puzzle game featuring curated public domain artwork from major museums.

## Architecture
- `content-pipeline/` — Python scripts to fetch, process, and catalog art from museum APIs
- `src/` — Web app (HTML, CSS, JS)
  - `src/js/` — Jigsaw engine and app logic
  - `src/css/` — Styles
  - `src/assets/` — Static assets (images, icons)
- `data/` — JSON manifests of puzzle data
- `docs/` — Documentation

## Content Sources
- Met Museum API (no key needed, CC0)
- Cleveland Museum of Art API (no key needed, CC0)
- Art Institute of Chicago API (no key needed, public domain)

## Hosting
GitHub Pages or Cloudflare Pages (TBD)

## Build
Phase 1 MVP: 100-150 curated puzzles across 5-6 art categories.
