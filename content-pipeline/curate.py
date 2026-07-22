#!/usr/bin/env python3
"""curate.py — Strict post-fetch filtering of museum candidates.

Reads data/candidates.json, applies per-category acceptance rules based on
structured metadata (culture, classification, department, artist), and writes
data/curated.json containing only items that genuinely belong to each category.

This is the editorial layer: the brand promise is "curated art," so a puzzle
must actually match its category. No loose text-search matches.
"""
from __future__ import annotations

import json
import os
import re
import logging
from typing import Any, Dict, List, Callable

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
CANDIDATES_PATH = os.path.join(DATA_DIR, "candidates.json")
CURATED_PATH = os.path.join(DATA_DIR, "curated.json")
REJECTED_PATH = os.path.join(DATA_DIR, "rejected.json")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("curate")


def _has(text: Any, *keywords: str) -> bool:
    t = (text or "").lower() if isinstance(text, str) else ""
    return any(k.lower() in t for k in keywords)


def _is_painting_or_print(c: Dict[str, Any]) -> bool:
    """Keep only 2D wall-art: paintings, prints, drawings. Reject sculpture,
    ceramics, metalwork, textiles, armor, furniture, photographs of objects."""
    cls = (c.get("classification") or "").lower()
    dept = (c.get("department") or "").lower()
    title = (c.get("title") or "").lower()

    # Hard rejects: 3D objects and non-wall-art
    reject_terms = [
        "sculpture", "ceramic", "metalwork", "armor", "helmet", "stirrup",
        "furniture", "textile", "costume", "robe", "bowl", "cup", "vase",
        "jar", "ewer", "amulet", "seal", "mirror", "brush washer", "statuette",
        "stele", "figurine", "bronze", "jade", "lacquer", "woodblock",
        "photograph", "decorative arts", "arms and armor", "dish", "kozara",
        "tea bowl", "incense", "box", "cabinet", "screen", "panel", "tile",
        "cross", "staurotheke", "regulator", "clock", "longcase", "candelabra",
        "fountain", "jewelry", "pendant", "plaque", "coin", "medal",
    ]
    for term in reject_terms:
        if term in cls or term in title:
            return False

    # Positive signals for 2D art
    accept_terms = [
        "painting", "print", "drawing", "watercolor", "woodcut", "engraving",
        "etching", "lithograph", "album", "scroll", "hanging scroll", "handscroll",
        "screen painting", "byobu", "fusuma", "illustrated book", "miniature",
        "oil", "canvas", "panel painting",
    ]
    for term in accept_terms:
        if term in cls or term in title:
            return True

    # If classification is empty, allow only if department suggests paintings
    if "painting" in dept:
        return True
    # Default: reject (we'd rather be selective than loose)
    return False


# --- Per-category rules -------------------------------------------------------

def rule_japanese_ukiyoe(c: Dict[str, Any]) -> bool:
    # Must be Japanese AND a print/painting. Artist or culture should confirm Japan.
    if not _is_painting_or_print(c):
        return False
    if _has(c.get("culture"), "japan") or _has(c.get("artist"),
        "hokusai", "hiroshige", "utamaro", "kuniyoshi", "eisen", "harunobu",
        "sharaku", "yoshitoshi", "kunisada", "hiroshige ii", "toyokuni"):
        return True
    # Department Asian Art + title hints
    if _has(c.get("department"), "asian") and _has(c.get("title"),
        "wave", "fuji", "edo", "actor", "courtesan", "beauty", "kabuki",
        "plum garden", "kameido", "suruga", "asaina", "drunken"):
        return True
    return False


def rule_japanese_screens(c: Dict[str, Any]) -> bool:
    if not _is_painting_or_print(c):
        return False
    if _has(c.get("culture"), "japan"):
        # screens/byobu/fusuma OR classic Japanese painting subjects
        if _has((c.get("title") or "") + (c.get("classification") or ""),
            "screen", "byobu", "fusuma", "sliding door", "bamboo", "plum",
            "jizo", "bodhisattva", "landscape", "bird", "flower", "crane"):
            return True
    return False


def rule_chinese_landscape(c: Dict[str, Any]) -> bool:
    if not _is_painting_or_print(c):
        return False
    # Culture should be China/Chinese
    if _has(c.get("culture"), "china", "chinese") or _has(c.get("department"), "chinese"):
        # Landscape, bird-and-flower, mountain, river themes
        if _has((c.get("title") or "") + (c.get("classification") or ""),
            "landscape", "mountain", "river", "bird", "flower", "orchid",
            "bamboo", "pine", "scholar", "pavilion", "thousand li", "crane",
            "phoenix", "pheasant", "peony", "lotus", "plum blossom"):
            return True
    return False


def rule_korean_joseon(c: Dict[str, Any]) -> bool:
    if not _is_painting_or_print(c):
        return False
    if _has(c.get("culture"), "korea") or _has(c.get("dynasty"), "joseon"):
        return True
    if _has((c.get("title") or "") + (c.get("department") or ""), "korea", "joseon"):
        return True
    return False


def rule_western_old_masters(c: Dict[str, Any]) -> bool:
    if not _is_painting_or_print(c):
        return False
    # European paintings department or known old-master artists
    if _has(c.get("department"), "european paintings"):
        return True
    if _has(c.get("artist"),
        "rembrandt", "vermeer", "rubens", "hals", "van dyck", "van eyck",
        "bosch", "bruegel", "titian", "raphael", "caravaggio", "velazquez",
        "velázquez", "goya", "el greco", "murillo", "zurbaran", "stevens",
        "david", "ingres", "delacroix", "gericault", "constable", "turner"):
        return True
    return False


def rule_impressionism(c: Dict[str, Any]) -> bool:
    if not _is_painting_or_print(c):
        return False
    if _has(c.get("artist"),
        "monet", "renoir", "degas", "pissarro", "sisley", "caillebotte",
        "morisot", "van gogh", "gogh", "cezanne", "cézanne", "seurat",
        "signac", "toulouse", "gauguin", "manet", "cassatt"):
        return True
    if _has(c.get("classification"), "impressionist"):
        return True
    return False


def rule_islamic_art(c: Dict[str, Any]) -> bool:
    # Islamic art includes calligraphy, manuscripts, geometric tile/panel designs,
    # and miniatures. Allow works on paper/panel; reject pure metal/ceramic objects.
    cls = (c.get("classification") or "").lower()
    title = (c.get("title") or "").lower()
    reject = ["bowl", "ewer", "vase", "metalwork", "ceramic", "jewelry",
              "pendant", "coin", "dagger", "sword", "helmet"]
    for term in reject:
        if term in cls or term in title:
            return False
    if _has(c.get("department"), "islamic"):
        return True
    if _has(title, "calligraph", "quran", "qur'an", "manuscript", "miniature",
            "arabesque", "geometric", "tile", "laila", "majnun", "stallion",
            "bird", "surat"):
        return True
    return False


RULES: Dict[str, Callable[[Dict[str, Any]], bool]] = {
    "japanese-ukiyoe": rule_japanese_ukiyoe,
    "japanese-screens": rule_japanese_screens,
    "chinese-landscape": rule_chinese_landscape,
    "korean-joseon": rule_korean_joseon,
    "western-old-masters": rule_western_old_masters,
    "impressionism": rule_impressionism,
    "islamic-art": rule_islamic_art,
}


def main() -> None:
    with open(CANDIDATES_PATH, encoding="utf-8") as f:
        data = json.load(f)
    candidates = data.get("candidates", [])
    log.info("Loaded %d candidates", len(candidates))

    curated: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []

    for c in candidates:
        cat = c.get("category_id", "")
        rule = RULES.get(cat)
        if rule is None:
            rejected.append({**c, "_reason": "no rule for category"})
            continue
        try:
            if rule(c):
                curated.append(c)
            else:
                rejected.append({**c, "_reason": "failed category rule"})
        except Exception as exc:
            rejected.append({**c, "_reason": f"rule error: {exc}"})

    # Sort curated: prefer landscape-ish aspect and paintings first (stable)
    by_cat: Dict[str, int] = {}
    for c in curated:
        by_cat[c["category_id"]] = by_cat.get(c["category_id"], 0) + 1

    log.info("Curated %d / %d candidates", len(curated), len(candidates))
    for cat, n in sorted(by_cat.items()):
        log.info("  %-24s %d", cat, n)

    with open(CURATED_PATH, "w", encoding="utf-8") as f:
        json.dump({"total": len(curated), "candidates": curated}, f, ensure_ascii=False, indent=2)
    with open(REJECTED_PATH, "w", encoding="utf-8") as f:
        json.dump({"total": len(rejected), "rejected": rejected}, f, ensure_ascii=False, indent=2)
    log.info("Wrote curated → %s", CURATED_PATH)
    log.info("Wrote rejected → %s (for review)", REJECTED_PATH)


if __name__ == "__main__":
    main()
