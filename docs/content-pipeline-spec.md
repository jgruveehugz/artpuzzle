# Content Pipeline Spec — ArtPuzzle

## Goal
Build a Python pipeline that queries museum APIs, downloads high-res public domain artwork, processes images for web, and generates a JSON manifest of curated puzzle data.

## Museum APIs (all verified working)

### 1. Met Museum API
- Base: `https://collectionapi.metmuseum.org/public/collection/v1/`
- No API key needed
- Search: `GET /search?q={query}&hasImages=true&department=Asian+Art&medium=Paintings`
- Object: `GET /objects/{id}` → returns title, primaryImage, primaryImageSmall, culture, dynasty, period, objectDate, classification, artistDisplayName
- Image URLs are direct (e.g., `https://images.metmuseum.org/CRDImages/as/original/DP369217.jpg`)
- 568 Asian art paintings with images available

### 2. Cleveland Museum of Art API
- Base: `https://openaccess-api.clevelandart.org/api/artworks/`
- No API key needed
- CC0 license (no attribution required)
- Filter by department: `?department=Chinese%20Art`, `?department=Japanese%20Art`, etc.
- Image structure: each artwork has `images` array with `web` (900px), `print` (3400px+), and `full` (original) variants
- Image URL pattern: `https://openaccess-cdn.clevelandart.org/{accession}/{accession}_web.jpg`
- 2,647 Chinese Art objects, plus Japanese, Korean, Indian, etc.

### 3. Art Institute of Chicago API
- Base: `https://api.artic.edu/api/v1/artworks`
- No API key needed
- Search: `GET /artworks/search?q={query}&query[term][is_public_domain]=true`
- Image URL pattern: `https://www.artic.edu/iiiff/2/{image_id}/full/843,/0/default.jpg`
- 132K+ total objects, many public domain

## Target Collections

### Asian Art
- Japanese Ukiyo-e (Hokusai, Hiroshige, Utamaro)
- Japanese screen paintings (byobu, fusuma)
- Chinese Song Dynasty landscapes
- Chinese Ming/Qing bird-and-flower paintings
- Korean Joseon Dynasty paintings
- Tibetan thangka paintings
- Indian miniature paintings

### Western Art
- European Old Masters (Rembrandt, Vermeer, Dutch Golden Age)
- Impressionism (Monet, Renoir, Van Gogh)
- American art (Hopper, Church, Bierstadt)
- Medieval/Renaissance religious art

### Cross-Cultural
- Islamic geometric art
- Ancient Egyptian
- African and Oceanic

## Pipeline Steps

1. **fetch.py** — Query each museum API, retrieve object metadata + image URLs for target collections
2. **download.py** — Download high-res images to `src/assets/images/` with organized folder structure by collection
3. **process.py** — Resize images to standard web sizes (large: 1200px, medium: 800px, thumbnail: 300px), optimize for web (quality 85), generate JSON manifest
4. **manifest.py** — Generate `data/puzzles.json` with all puzzle metadata

## Output Format

### `data/puzzles.json`
```json
{
  "version": "1.0",
  "generated": "2026-07-12T...",
  "categories": [
    {
      "id": "japanese-ukiyoe",
      "name": "Japanese Ukiyo-e",
      "description": "Woodblock prints from Japan's floating world",
      "puzzles": [
        {
          "id": "met-682118",
          "title": "The Great Wave off Kanagawa",
          "artist": "Katsushika Hokusai",
          "date": "ca. 1830-32",
          "culture": "Japan",
          "museum": "Metropolitan Museum of Art",
          "image": "assets/images/japanese-ukiyoe/great-wave.jpg",
          "thumbnail": "assets/images/japanese-ukiyoe/great-wave-thumb.jpg",
          "width": 1200,
          "height": 800,
          "license": "Public Domain (CC0)",
          "sourceUrl": "https://collectionapi.metmuseum.org/public/collection/v1/objects/682118",
          "difficulty": {
            "easy": 24,
            "medium": 48,
            "hard": 96,
            "expert": 192
          }
        }
      ]
    }
  ]
}
```

### Folder Structure
```
src/assets/images/
  japanese-ukiyoe/
    great-wave.jpg        (1200px wide, web-optimized)
    great-wave-thumb.jpg  (300px wide)
  japanese-screens/
  chinese-landscape/
  ...
```

## Image Processing Rules
- Source images: download at highest available resolution
- Large: resize to max 1200px on longest side, JPEG quality 85
- Medium: resize to max 800px (fallback for slower connections)
- Thumbnail: resize to 300px on longest side, JPEG quality 80
- Strip EXIF data
- File naming: slugify the title (e.g., "The Great Wave" → "great-wave.jpg")
- Skip images smaller than 800px in original resolution (too low quality)
- Skip images with extreme aspect ratios (>3:1 or <1:3)

## Technical Requirements
- Python 3.12+ (use Mac Mini's python3 or venv)
- Libraries: requests, Pillow (PIL), json, os, slugify
- Run from `~/Projects/artpuzzle/content-pipeline/`
- Output to `~/Projects/artpuzzle/src/assets/images/` and `~/Projects/artpuzzle/data/`
- Handle API rate limits gracefully (small delays between requests)
- Log progress (downloaded, skipped, errors)
- Be resilient — if one API is down, continue with others
- Generate a `data/curation-report.json` listing all candidates so Jung can review and curate
