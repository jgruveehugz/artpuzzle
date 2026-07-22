#!/usr/bin/env python3
"""process.py — Process downloaded images for web.

For each downloaded image:
  - Skip if smaller than 800px on shortest side
  - Skip if extreme aspect ratio (>3:1 or <1:3)
  - Create large (1200px), medium (800px), thumbnail (300px) versions
  - JPEG quality 85 (80 for thumb), strip EXIF
  - Remove the original raw download (we keep the processed variants only)

Inputs:  ~/Projects/artpuzzle/data/downloaded.json
Outputs: Updates processed metadata into ~/Projects/artpuzzle/data/processed.json
         Writes images into src/assets/images/{category}/ as {slug}-large.jpg,
         {slug}-medium.jpg, {slug}-thumb.jpg
"""
from __future__ import annotations

import json
import os
import logging
from typing import Any, Dict, List, Tuple

from PIL import Image, ImageOps

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
IMAGES_DIR = os.path.join(BASE_DIR, "src", "assets", "images")
DOWNLOADED_PATH = os.path.join(DATA_DIR, "downloaded.json")
PROCESSED_PATH = os.path.join(DATA_DIR, "processed.json")

LARGE_MAX = 1200
MEDIUM_MAX = 800
THUMB_MAX = 300
JPEG_QUALITY = 85
JPEG_QUALITY_THUMB = 80
MIN_ORIG_PX = 500  # skip if smaller than this on shortest side (allows handscrolls)
MAX_RATIO = 6.0    # skip if aspect ratio > 6:1 or < 1:6 (Chinese handscrolls are panoramic)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("process")


def aspect_ok(w: int, h: int) -> bool:
    if w <= 0 or h <= 0:
        return False
    ratio = max(w, h) / min(w, h)
    return ratio <= MAX_RATIO


def resize_to_max(img: Image.Image, max_side: int) -> Image.Image:
    """Resize so the longest side == max_side (preserving aspect)."""
    w, h = img.size
    longest = max(w, h)
    if longest <= max_side:
        return img
    scale = max_side / longest
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    return img.resize((new_w, new_h), Image.Resampling.LANCZOS)


def process_one(item: Dict[str, Any]) -> Dict[str, Any] | None:
    local_path = item.get("local_path")
    if not local_path or not os.path.exists(os.path.join(BASE_DIR, local_path)):
        log.warning("  missing file: %s", local_path)
        return None

    src_abs = os.path.join(BASE_DIR, local_path)
    try:
        with Image.open(src_abs) as img:
            img = ImageOps.exif_transpose(img)  # honor EXIF orientation before stripping
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGB")
            elif img.mode == "RGBA":
                img = img.convert("RGB")

            w, h = img.size
            min_side = min(w, h)

            if min_side < MIN_ORIG_PX:
                log.info("  skip (orig %dx%d, min<%d): %s", w, h, MIN_ORIG_PX, local_path)
                return None
            if not aspect_ok(w, h):
                log.info("  skip (extreme ratio %dx%d): %s", w, h, local_path)
                return None

            # Build processed variants
            large = resize_to_max(img, LARGE_MAX)
            medium = resize_to_max(img, MEDIUM_MAX)
            thumb = resize_to_max(img, THUMB_MAX)

            cat_dir = os.path.dirname(src_abs)
            slug = os.path.splitext(os.path.basename(src_abs))[0]

            large_path = os.path.join(cat_dir, f"{slug}-large.jpg")
            medium_path = os.path.join(cat_dir, f"{slug}-medium.jpg")
            thumb_path = os.path.join(cat_dir, f"{slug}-thumb.jpg")

            large.save(large_path, "JPEG", quality=JPEG_QUALITY, optimize=True)
            medium.save(medium_path, "JPEG", quality=JPEG_QUALITY, optimize=True)
            thumb.save(thumb_path, "JPEG", quality=JPEG_QUALITY_THUMB, optimize=True)

            lw, lh = large.size
            tw, th = thumb.size

            # Remove the original raw download — we keep only processed variants
            try:
                os.remove(src_abs)
            except OSError:
                pass

            result = dict(item)
            result["image"] = os.path.relpath(large_path, BASE_DIR)
            result["image_medium"] = os.path.relpath(medium_path, BASE_DIR)
            result["thumbnail"] = os.path.relpath(thumb_path, BASE_DIR)
            result["width"] = lw
            result["height"] = lh
            result["thumb_width"] = tw
            result["thumb_height"] = th
            result["process_status"] = "ok"
            return result
    except Exception as exc:
        log.warning("  process failed for %s: %s", local_path, exc)
        return None


def main() -> None:
    if not os.path.exists(DOWNLOADED_PATH):
        log.error("downloaded.json not found — run download.py first")
        return

    with open(DOWNLOADED_PATH, "r", encoding="utf-8") as f:
        dl_data = json.load(f)
    items: List[Dict[str, Any]] = dl_data.get("downloaded", [])
    log.info("Loaded %d downloaded items", len(items))

    processed: List[Dict[str, Any]] = []
    skipped = 0

    for item in items:
        log.info("[%s] %s", item.get("category_id"), item.get("title", "")[:60])
        out = process_one(item)
        if out:
            processed.append(out)
        else:
            skipped += 1

    log.info("Processed %d images, skipped %d", len(processed), skipped)
    with open(PROCESSED_PATH, "w", encoding="utf-8") as f:
        json.dump({"total": len(processed), "processed": processed}, f, ensure_ascii=False, indent=2)
    log.info("Wrote processed manifest → %s", PROCESSED_PATH)


if __name__ == "__main__":
    main()
