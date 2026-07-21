#!/usr/bin/env python3
"""manifest.py — Generate data/puzzles.json and data/curation-report.json.

Inputs:  ~/Projects/artpuzzle/data/processed.json
         ~/Projects/artpuzzle/data/candidates.json  (for the curation report)
Outputs: ~/Projects/artpuzzle/data/puzzles.json
         ~/Projects/artpuzzle/data/curation-report.json
"""
from __future__ import annotations

import json
import os
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
PROCESSED_PATH = os.path.join(DATA_DIR, "processed.json")
CANDIDATES_PATH = os.path.join(DATA_DIR, "candidates.json")
PUZZLES_PATH = os.path.join(DATA_DIR, "puzzles.json")
CURATION_REPORT_PATH = os.path.join(DATA_DIR, "curation-report.json")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("manifest")

# Category metadata (id, name, description)
CATEGORIES = [
    ("japanese-ukiyoe", "Japanese Ukiyo-e", "Woodblock prints from Japan's floating world"),
    ("japanese-screens", "Japanese Screen Paintings", "Byobu and fusuma screen paintings from Japan"),
    ("chinese-landscape", "Chinese Landscapes", "Chinese landscape paintings and bird-and-flower works"),
    ("korean-joseon", "Korean Joseon Dynasty", "Paintings from Korea's Joseon dynasty"),
    ("western-old-masters", "Western Old Masters", "European Old Master paintings (Rembrandt, Vermeer, Dutch Golden Age)"),
    ("impressionism", "Impressionism", "Impressionist and Post-Impressionist works (Monet, Van Gogh)"),
    ("islamic-art", "Islamic Art", "Islamic geometric and decorative art"),
]
CATEGORY_META = {cid: (cid, name, desc) for cid, name, desc in CATEGORIES}


def difficulty_pieces(width: int, height: int) -> Dict[str, int]:
    """Pick puzzle piece counts based on image dimensions."""
    area = width * height
    # Scale piece counts with image area; clamp to spec-friendly values.
    if area >= 1_000_000:
        return {"easy": 24, "medium": 54, "hard": 96, "expert": 192}
    elif area >= 500_000:
        return {"easy": 20, "medium": 48, "hard": 80, "expert": 160}
    else:
        return {"easy": 16, "medium": 36, "hard": 64, "expert": 128}


def build_puzzle(item: Dict[str, Any], category_id: str) -> Dict[str, Any]:
    w = item.get("width", 1200)
    h = item.get("height", 800)
    image_path = item.get("image", "")
    thumb_path = item.get("thumbnail", "")
    # The spec example uses "assets/images/..." (relative to src/), so strip "src/" prefix if present.
    def to_spec_path(p: str) -> str:
        if p.startswith("src/"):
            return p[4:]
        return p
    return {
        "id": f"{item['source']}-{item['object_id']}",
        "title": item.get("title", "Untitled"),
        "artist": item.get("artist", "Unknown"),
        "date": item.get("date", ""),
        "culture": item.get("culture", ""),
        "museum": item.get("museum", ""),
        "image": to_spec_path(image_path),
        "thumbnail": to_spec_path(thumb_path),
        "width": w,
        "height": h,
        "license": item.get("license", "Public Domain"),
        "sourceUrl": item.get("source_url", ""),
        "difficulty": difficulty_pieces(w, h),
    }


def build_curation_report(candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Group all candidates (downloaded or not) per category for Jung to review."""
    by_cat: Dict[str, List[Dict[str, Any]]] = {}
    for c in candidates:
        by_cat.setdefault(c["category_id"], []).append(c)

    report_cats = []
    for cid, name, desc in CATEGORIES:
        items = by_cat.get(cid, [])
        report_cats.append({
            "id": cid,
            "name": name,
            "description": desc,
            "candidate_count": len(items),
            "candidates": items,
        })
    return {
        "generated": datetime.now(timezone.utc).isoformat(),
        "total_candidates": len(candidates),
        "categories": report_cats,
    }


def main() -> None:
    # Load processed items
    if not os.path.exists(PROCESSED_PATH):
        log.error("processed.json not found — run process.py first")
        return
    with open(PROCESSED_PATH, "r", encoding="utf-8") as f:
        proc_data = json.load(f)
    processed: List[Dict[str, Any]] = proc_data.get("processed", [])
    log.info("Loaded %d processed items", len(processed))

    # Group processed items by category
    by_cat: Dict[str, List[Dict[str, Any]]] = {}
    for item in processed:
        by_cat.setdefault(item["category_id"], []).append(item)

    # Build categories array (only categories that actually have puzzles)
    cats_out: List[Dict[str, Any]] = []
    for cid, name, desc in CATEGORIES:
        items = by_cat.get(cid, [])
        if not items:
            continue
        puzzles = [build_puzzle(it, cid) for it in items]
        cats_out.append({
            "id": cid,
            "name": name,
            "description": desc,
            "puzzle_count": len(puzzles),
            "puzzles": puzzles,
        })

    puzzles_manifest = {
        "version": "1.0",
        "generated": datetime.now(timezone.utc).isoformat(),
        "total_puzzles": sum(len(c["puzzles"]) for c in cats_out),
        "categories": cats_out,
    }

    with open(PUZZLES_PATH, "w", encoding="utf-8") as f:
        json.dump(puzzles_manifest, f, ensure_ascii=False, indent=2)
    log.info("Wrote puzzles.json (%d puzzles across %d categories) → %s",
             puzzles_manifest["total_puzzles"], len(cats_out), PUZZLES_PATH)

    # Curation report — all candidates
    candidates = []
    if os.path.exists(CANDIDATES_PATH):
        with open(CANDIDATES_PATH, "r", encoding="utf-8") as f:
            candidates = json.load(f).get("candidates", [])
    report = build_curation_report(candidates)
    with open(CURATION_REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    log.info("Wrote curation-report.json (%d candidates) → %s",
             report["total_candidates"], CURATION_REPORT_PATH)


if __name__ == "__main__":
    main()
