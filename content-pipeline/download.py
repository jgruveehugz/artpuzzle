#!/usr/bin/env python3
"""download.py — Download high-res images for candidates from candidates.json
and write a download manifest with local file paths.

Inputs:  ~/Projects/artpuzzle/data/candidates.json
Outputs: ~/Projects/artpuzzle/data/downloaded.json
         ~/Projects/artpuzzle/src/assets/images/{category}/...
"""
from __future__ import annotations

import json
import os
import re
import time
import logging
from typing import Any, Dict, List

import requests
from slugify import slugify

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
IMAGES_DIR = os.path.join(BASE_DIR, "src", "assets", "images")
CANDIDATES_PATH = os.path.join(DATA_DIR, "candidates.json")
CURATED_PATH = os.path.join(DATA_DIR, "curated.json")
DOWNLOADED_PATH = os.path.join(DATA_DIR, "downloaded.json")

REQUEST_DELAY = 0.3
TIMEOUT = 60
MIN_IMAGE_BYTES = 8_000  # skip obviously tiny responses (<8KB likely error page)
MAX_PER_CATEGORY = 12    # cap downloads per category to keep the pipeline bounded

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("download")


# ----------------------------------------------------------------------------
# Filename slugification
# ----------------------------------------------------------------------------
def slugify_title(title: str, object_id: str, existing: set[str]) -> str:
    """Produce a filesystem-safe unique slug filename."""
    base = slugify(title) or "untitled"
    # Keep it reasonably short
    base = base[:60]
    name = base
    if name in existing:
        name = f"{base}-{object_id}"
    existing.add(name)
    return name


# ----------------------------------------------------------------------------
# Download
# ----------------------------------------------------------------------------
def download_image(url: str, dest_path: str) -> bool:
    """Stream-download an image to dest_path. Returns True on success."""
    try:
        headers = {"User-Agent": "ArtPuzzlePipeline/1.0 (educational project)"}
        resp = requests.get(url, stream=True, timeout=TIMEOUT, headers=headers)
        resp.raise_for_status()
        chunks = []
        total = 0
        for chunk in resp.iter_content(chunk_size=8192):
            if chunk:
                chunks.append(chunk)
                total += len(chunk)
                if total > 25 * 1024 * 1024:  # 25MB cap
                    log.warning("  image >25MB, aborting: %s", url)
                    return False
        if total < MIN_IMAGE_BYTES:
            log.warning("  too small (%d bytes), skipping: %s", total, url)
            return False
        with open(dest_path, "wb") as f:
            for c in chunks:
                f.write(c)
        return True
    except Exception as exc:
        log.warning("  download failed for %s: %s", url, exc)
        return False


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main() -> None:
    # Prefer curated.json (post-filter) over raw candidates.json.
    if os.path.exists(CURATED_PATH):
        src = CURATED_PATH
        log.info("Using curated.json (filtered set)")
    elif os.path.exists(CANDIDATES_PATH):
        src = CANDIDATES_PATH
        log.info("curated.json not found — falling back to raw candidates.json")
    else:
        log.error("No input found — run fetch.py then curate.py first")
        return

    with open(src, "r", encoding="utf-8") as f:
        candidates_data = json.load(f)
    candidates: List[Dict[str, Any]] = candidates_data.get("candidates", [])
    log.info("Loaded %d candidates", len(candidates))

    os.makedirs(IMAGES_DIR, exist_ok=True)
    downloaded: List[Dict[str, Any]] = []
    per_cat_count: Dict[str, int] = {}
    skipped = 0

    for c in candidates:
        cat_id = c["category_id"]
        if per_cat_count.get(cat_id, 0) >= MAX_PER_CATEGORY:
            continue

        url = c.get("image_url") or c.get("image_url_small") or ""
        if not url:
            skipped += 1
            continue

        cat_dir = os.path.join(IMAGES_DIR, cat_id)
        os.makedirs(cat_dir, exist_ok=True)

        # Slug filename
        existing_slugs: set[str] = set(os.listdir(cat_dir))
        slug = slugify_title(c["title"], c["object_id"], existing_slugs)
        ext = ".jpg"
        if not url.lower().endswith((".jpg", ".jpeg", ".png")):
            # Some APIs return without explicit extension; default to .jpg
            ext = ".jpg"
        filename = f"{slug}{ext}"
        dest_path = os.path.join(cat_dir, filename)

        log.info("[%s] %s → %s", cat_id, c["title"][:60], filename)
        ok = download_image(url, dest_path)
        if ok:
            c["local_path"] = os.path.relpath(dest_path, BASE_DIR)
            c["download_filename"] = filename
            c["download_status"] = "ok"
            downloaded.append(c)
            per_cat_count[cat_id] = per_cat_count.get(cat_id, 0) + 1
        else:
            c["download_status"] = "failed"
            skipped += 1

        time.sleep(REQUEST_DELAY)

    log.info("Downloaded %d images, skipped %d", len(downloaded), skipped)
    with open(DOWNLOADED_PATH, "w", encoding="utf-8") as f:
        json.dump({"total": len(downloaded), "downloaded": downloaded}, f, ensure_ascii=False, indent=2)
    log.info("Wrote download manifest → %s", DOWNLOADED_PATH)

    for cat, n in sorted(per_cat_count.items()):
        log.info("  %-24s %d", cat, n)


if __name__ == "__main__":
    main()
