# Web App Spec — ArtPuzzle

## Goal
Build a static web app: gallery landing page, category browsing, and puzzle player. Vanilla HTML/CSS/JS. No build tools. No frameworks. Deploy to GitHub Pages or Cloudflare Pages.

## Pages

### 1. Landing Page (`index.html`)
- Full-width hero: today's featured puzzle (daily puzzle, date-seeded selection)
- "Play Today's Puzzle" CTA button
- Collection grid below: cards for each art category (Japanese Ukiyo-e, Chinese Landscapes, etc.)
- Each card shows: category name, thumbnail, puzzle count
- Minimal header: logo/wordmark, no nav needed initially
- Footer: about, public domain attribution, GitHub link

### 2. Gallery Page (`gallery.html`)
- Filterable grid of puzzles
- Filters: category dropdown, difficulty filter
- Each puzzle card: thumbnail, title, artist, piece count, "Play" button
- Lazy load thumbnails
- Responsive: 1 column mobile, 2 tablet, 3-4 desktop
- Search bar: filter by title, artist, or category

### 3. Puzzle Player Page (`puzzle.html`)
- Full-screen jigsaw canvas
- Top bar: puzzle title, artist, difficulty selector, progress bar
- The jigsaw engine renders here
- Back to gallery button
- Share button (copy URL)
- Completion view: full image, time taken, "Play another" button

## Design System

### Typography
- Headings: Georgia or "Times New Roman" (serif, museum feel)
- Body: system-ui, -apple-system, sans-serif
- No external font loading (keep it fast)

### Colors
```css
:root {
  --bg-primary: #1a1a2e;      /* deep navy/charcoal */
  --bg-secondary: #16213e;    /* slightly lighter */
  --bg-card: #1e1e3a;        /* card background */
  --text-primary: #e8e8e8;   /* warm white */
  --text-secondary: #a0a0b8;  /* muted */
  --accent: #c9a84c;         /* gold/brass */
  --accent-hover: #d4b563;   /* lighter gold */
  --border: #2a2a4a;         /* subtle border */
  --success: #4a9d5e;        /* green for completion */
}
```

### Layout
- Max content width: 1400px
- Gallery grid: CSS Grid with `repeat(auto-fill, minmax(280px, 1fr))`
- Cards: rounded corners (8px), subtle shadow, hover lift effect
- Mobile-first responsive breakpoints: 640px, 1024px

### Card Design
- Image thumbnail (aspect ratio 4:3 or square)
- Title (serif, bold)
- Artist (sans, muted)
- Category badge (small, pill-shaped)
- Hover: slight scale up, shadow increase, "Play" overlay

## Data Flow
1. `data/puzzles.json` is the single source of truth
2. Gallery page fetches puzzles.json on load, renders cards
3. Puzzle page reads `?id=met-682118` from URL, finds puzzle in JSON, loads image, starts engine
4. Daily puzzle: `index.html` seeds by date, picks from puzzles.json
5. Progress saved to localStorage keyed by puzzle ID

## SEO
- Semantic HTML5 (article, section, nav, main, header, footer)
- Meta tags: description, og:title, og:image, og:type
- Structured data: JSON-LD for each puzzle (CreativeWork schema)
- Sitemap.xml generated from puzzles.json
- robots.txt
- Clean URLs: `puzzle.html?id=great-wave` (or use URL rewriting on Cloudflare)
- Alt text on all images: artwork title + artist + "jigsaw puzzle"

## Performance
- No external dependencies (no CDN fonts, no JS libraries)
- Images lazy-loaded with `loading="lazy"`
- puzzles.json cached in localStorage after first fetch
- CSS and JS minified for production (manual or simple script)
- Target: < 50KB total JS+CSS, < 3 second load on mobile 3G

## Technical Constraints
- Vanilla HTML/CSS/JS only
- No build tools required (can add minification later)
- Must work on GitHub Pages (no server-side processing)
- Mobile-first responsive design
- Touch-optimized controls
- Accessible: keyboard navigation, ARIA labels, sufficient contrast
