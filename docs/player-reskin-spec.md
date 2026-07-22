# Puzzle Player Reskin Spec — ArtPuzzle

## Goal
Reskin the puzzle player's remaining chrome (top bar, difficulty selector, control buttons, completion overlay) to match the new gallery-grade design system in src/css/main.css. Do NOT touch the jigsaw engine JS logic — only CSS and minimal HTML class/structure alignment.

## Design system (already in src/css/main.css)
- Palette: --bg-primary #0f0f14, --bg-secondary #16161d, --bg-card #1a1a22, --bg-elevated #20202a, --text-primary #f2f0ea, --text-secondary #a8a69e, --text-muted #6e6c66, --accent #c9a84c, --accent-hover #e0c070, --border #2a2a33, --border-soft #22222a
- Radius: 4px (architectural), --radius-sm 2px
- Buttons: .btn, .btn-primary (gold bg, dark text), .btn-secondary (outline), .btn-ghost
- Typography: Playfair Display headings, Inter body

## What to restyle in src/css/puzzle.css (and puzzle.html if needed)
1. **Top bar** — match site-header: darker (--bg-secondary), 1px --border-soft bottom border, Playfair title, italic artist. Back link styled like main-nav link with hover underline.
2. **Difficulty selector** — segmented pill control: contained in a --bg-card rounded box, buttons are quiet text, active button gets --accent background + dark text. Matches the landing's restrained look (not the current chunky gold Medium button).
3. **Control buttons (Ghost/Peek/Shuffle/Restart)** — icon + label, --bg-card background, --border-soft border, hover lifts and border goes --accent-dim. Active/toggled state (Ghost) shows --accent-soft bg + --accent text. Consistent with .btn-ghost / card hover.
4. **Completion overlay** — use --bg-scrim backdrop with blur, centered card in --bg-card with --border, gold trophy accent, Playfair "Puzzle Complete!", quiet time/pieces meta, .btn-primary "Play Another" + .btn-secondary "Replay This".
5. **Progress bar** — thin (2px), --border track, --accent fill, percentage in --text-secondary.

## Constraints
- Keep all element IDs and JS hooks unchanged (btn-ghost, btn-peek, btn-shuffle, btn-restart, difficulty-btn, completion-overlay, progress-fill, progress-text).
- Keep pointer/touch handlers intact.
- Mobile: difficulty selector collapses to smaller pills; controls stay reachable.
- Do not modify jigsaw-engine.js, jigsaw-interact.js, jigsaw-board.js, puzzle-app.js logic. CSS + HTML class tweaks only.

## Verify
Open puzzle.html?id=met-436535 and screenshot: top bar, difficulty pills, control buttons, and trigger completion overlay (merge all groups via console) to confirm the reskin reads as one design system with the landing/gallery.
