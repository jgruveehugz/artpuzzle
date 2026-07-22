#!/usr/bin/env python3
"""fetch_smithsonian.py — Fetch public-domain Asian artworks from the
Smithsonian Open Access API (Freer/Sackler and Cooper Hewitt collections).

Outputs candidates in the SAME dict shape as fetch.py and MERGES them into
data/candidates.json (deduped by source+object_id).

API: https://api.si.edu/openaccess/api/v1.0/category/art_design/search
Key:  env SMITHSONIAN_API_KEY, else DEMO_KEY (rate-limited — 2s delays).
"""
from __future__ import annotations

import json
import os
import time
import logging
from typing import Any, Dict, List, Optional

import requests

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
CANDIDATES_PATH = os.path.join(DATA_DIR, "candidates.json")

SMITHSONIAN_SEARCH_URL = (
    "https://api.si.edu/openaccess/api/v1.0/category/art_design/search"
)
IDS_BASE = "https://ids.si.edu/ids/download?id={}.jpg"

# DEMO_KEY rate limit: ~1000 req/hour, but also aggressive per-second.
# Use 2.0s between calls to stay safe.
REQUEST_DELAY = 2.0
TIMEOUT = 45

# Search targets mapped to existing category_ids.
# Consolidated into fewer queries (using OR) to stay within DEMO_KEY rate limits.
SEARCH_TARGETS: List[Dict[str, Any]] = [
    {
        "category_id": "japanese-ukiyoe",
        "queries": ["Hiroshige", "Hokusai", "ukiyo-e woodblock"],
        "rows": 40,
    },
    {
        "category_id": "japanese-screens",
        "queries": ["Japanese screen byobu", "Japanese painting Edo screen"],
        "rows": 40,
    },
    {
        "category_id": "chinese-landscape",
        "queries": ["Chinese landscape painting", "shan shui handscroll"],
        "rows": 40,
    },
    {
        "category_id": "korean-joseon",
        "queries": ["Korean painting Joseon"],
        "rows": 40,
    },
]

# Object types we accept (paintings, prints, drawings — not books/catalogs/sculpture)
ACCEPTED_OBJECT_TYPES = {
    "painting", "paintings", "print", "prints", "drawing", "drawings",
    "watercolor", "watercolors", "woodblock print", "woodblock prints",
    "hanging scroll", "handscroll", "screen painting", "screen",
    "byobu", "scroll", "album", "album leaf", "fan",
}

# Terms in objectType or title that signal rejection (books, catalogs, etc.)
REJECT_TYPE_TERMS = {
    "book", "catalog", "catalogue", "photograph", "photographs",
    "sculpture", "ceramic", "metalwork", "textile", "costume",
    "coin", "medal", "seal", "furniture", "weapon", "armor",
    "archaeological", "specimen", "mineral", "fossil",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("fetch_smithsonian")


# ----------------------------------------------------------------------------
# API key resolution
# ----------------------------------------------------------------------------
def get_api_key() -> str:
    """Resolve API key: env var > .smithsonian_key file > DEMO_KEY."""
    key = os.environ.get("SMITHSONIAN_API_KEY", "").strip()
    if key:
        log.info("Using SMITHSONIAN_API_KEY from environment")
        return key

    key_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".smithsonian_key")
    if os.path.exists(key_file):
        with open(key_file, "r") as f:
            key = f.read().strip()
        if key:
            log.info("Using API key from .smithsonian_key file")
            return key

    log.warning("No API key found — using DEMO_KEY (rate-limited, 2s delays)")
    return "DEMO_KEY"


# ----------------------------------------------------------------------------
# HTTP helper with rate-limit awareness
# ----------------------------------------------------------------------------
def http_get(url: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """GET with retry on rate-limit (429). Returns JSON dict or None."""
    for attempt in range(5):
        try:
            resp = requests.get(url, params=params, timeout=TIMEOUT)
            if resp.status_code == 429:
                wait = 10.0 * (attempt + 1)
                log.warning("  rate limited (429), waiting %.0fs (attempt %d)", wait, attempt + 1)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            log.warning("  GET failed (attempt %d): %s", attempt + 1, exc)
            time.sleep(3.0 * (attempt + 1))
    log.error("  Giving up on %s", url)
    return None


# ----------------------------------------------------------------------------
# Metadata extraction helpers
# ----------------------------------------------------------------------------
def _freetext_list(content: Dict, field: str) -> List[str]:
    """Extract a freetext field as a list of content strings."""
    ft = content.get("freetext", {})
    items = ft.get(field, [])
    return [item.get("content", "") for item in items if item.get("content")]


def _freetext_join(content: Dict, field: str) -> str:
    """Join a freetext field's content into a single string."""
    return "; ".join(_freetext_list(content, field))


def _extract_image_ids(content: Dict) -> List[str]:
    """Extract idsId values from online_media. These are used to build
    the download URL: https://ids.si.edu/ids/download?id={ID}.jpg"""
    dn = content.get("descriptiveNonRepeating", {})
    om = dn.get("online_media", {})
    if not om:
        return []
    media_list = om.get("media", [])
    if not isinstance(media_list, list):
        media_list = [media_list]
    ids = []
    for m in media_list:
        if isinstance(m, dict):
            ids_id = m.get("idsId")
            if ids_id:
                ids.append(ids_id)
    return ids


def _check_rights(content: Dict) -> bool:
    """Check if the object has CC0 or public domain rights."""
    # Check freetext objectRights
    rights_str = _freetext_join(content, "objectRights").lower()
    if "cc0" in rights_str:
        return True
    if "public domain" in rights_str:
        return True
    # Check usage in online_media
    dn = content.get("descriptiveNonRepeating", {})
    om = dn.get("online_media", {})
    if om:
        media_list = om.get("media", [])
        if not isinstance(media_list, list):
            media_list = [media_list]
        for m in media_list:
            if isinstance(m, dict):
                usage = m.get("usage", {})
                if isinstance(usage, dict):
                    access = (usage.get("access") or "").lower()
                    if "cc0" in access:
                        return True
    return False


def _get_object_types(content: Dict) -> List[str]:
    """Get all objectType values (lowercased)."""
    return [t.lower() for t in _freetext_list(content, "objectType")]


def _has_accepted_type(content: Dict) -> bool:
    """Check if any objectType matches our accepted types and none match rejects."""
    types = _get_object_types(content)
    types_str = " ".join(types)

    # Reject if any reject term found
    for rt in REJECT_TYPE_TERMS:
        if rt in types_str:
            return False

    # Accept if any accepted term found
    for at in ACCEPTED_OBJECT_TYPES:
        if at in types_str:
            return True

    # Also check physicalDescription for medium clues (painting/print/drawing)
    medium = _freetext_join(content, "physicalDescription").lower()
    medium_accept = ["painting", "print", "drawing", "watercolor", "woodblock",
                     "ink on paper", "ink and color", "ink on silk", "color on silk",
                     "ink and color on silk", "ink and color on paper",
                     "color on paper", "ink on paper", "silk", "hanging scroll",
                     "handscroll"]
    for ma in medium_accept:
        if ma in medium:
            return True

    return False


def _extract_title(row: Dict) -> str:
    """Get the object title."""
    dn = row.get("content", {}).get("descriptiveNonRepeating", {})
    title_obj = dn.get("title", {})
    if isinstance(title_obj, dict):
        return (title_obj.get("content") or "Untitled").strip()
    return row.get("title", "Untitled").strip()


def _extract_artist(content: Dict) -> str:
    """Get the primary artist name from freetext.name."""
    names = _freetext_list(content, "name")
    if not names:
        return "Unknown"
    # First name entry is typically the artist
    artist = names[0]
    # Clean up: "Ando Hiroshige, Japanese, 1797–1858" -> "Ando Hiroshige"
    # but keep fuller info if it's just a name
    return artist.strip()


def _extract_date(content: Dict) -> str:
    return _freetext_join(content, "date").strip()


def _extract_culture(content: Dict) -> str:
    """Determine culture from place/name fields."""
    places = _freetext_list(content, "place")
    for p in places:
        pl = p.lower()
        if "japan" in pl:
            return "Japan"
        if "china" in pl or "chinese" in pl:
            return "China"
        if "korea" in pl:
            return "Korea"
    # Check name fields for culture hints
    names = _freetext_list(content, "name")
    for n in names:
        nl = n.lower()
        if "japan" in nl:
            return "Japan"
        if "chinese" in nl or "china" in nl:
            return "China"
        if "korean" in nl or "korea" in nl:
            return "Korea"
    # Check indexedStructured
    isd = content.get("indexedStructured", {})
    places_is = isd.get("place", [])
    if isinstance(places_is, list):
        for p in places_is:
            if isinstance(p, dict):
                p_content = (p.get("L2", {}).get("content", "") or "").lower()
            else:
                p_content = str(p).lower()
            if "japan" in p_content:
                return "Japan"
            if "china" in p_content:
                return "China"
            if "korea" in p_content:
                return "Korea"
    return ""


def _extract_classification(content: Dict) -> str:
    """Build a classification string from objectType."""
    types = _freetext_list(content, "objectType")
    return "; ".join(types).strip()


def _extract_unit_code(content: Dict) -> str:
    dn = content.get("descriptiveNonRepeating", {})
    return dn.get("unit_code", "")


def _extract_record_link(content: Dict) -> str:
    dn = content.get("descriptiveNonRepeating", {})
    return dn.get("record_link", "")


def _museum_name(unit_code: str) -> str:
    """Map unit code to museum name."""
    mapping = {
        "FSG": "Smithsonian (Freer Gallery of Art)",
        "SAAM": "Smithsonian (Smithsonian American Art Museum)",
        "CHNDM": "Smithsonian (Cooper Hewitt)",
        "ACM": "Smithsonian (Anacostia Community Museum)",
        "NMAH": "Smithsonian (National Museum of American History)",
        "NMAfA": "Smithsonian (National Museum of African Art)",
    }
    return mapping.get(unit_code, f"Smithsonian ({unit_code})")


# ----------------------------------------------------------------------------
# Parse a single API row into a candidate dict
# ----------------------------------------------------------------------------
def parse_row(row: Dict[str, Any], category_id: str) -> Optional[Dict[str, Any]]:
    """Parse a Smithsonian search result row into a candidate dict.
    Returns None if the row doesn't pass quality filters."""
    content = row.get("content", {})
    if not content:
        return None

    # --- Must have usable image IDs ---
    image_ids = _extract_image_ids(content)
    if not image_ids:
        return None

    # --- Must have CC0 / public domain rights ---
    if not _check_rights(content):
        return None

    # --- Must be a painting/print/drawing (not book/catalog/sculpture) ---
    if not _has_accepted_type(content):
        return None

    title = _extract_title(row)
    if not title or title == "Untitled":
        return None

    artist = _extract_artist(content)
    date = _extract_date(content)
    culture = _extract_culture(content)
    classification = _extract_classification(content)
    unit_code = _extract_unit_code(content)
    record_link = _extract_record_link(content)

    # Build image URLs
    primary_id = image_ids[0]
    image_url = IDS_BASE.format(primary_id)
    # For small version, Smithsonian doesn't have a separate small URL;
    # use the same URL (process.py will resize)
    image_url_small = image_url

    # object_id: use the row's id or record_ID
    dn = content.get("descriptiveNonRepeating", {})
    object_id = dn.get("record_ID") or row.get("id", "")
    if not object_id:
        return None

    # source_url: prefer record_link, fall back to the API object URL
    source_url = record_link or f"https://collections.si.edu/search/results.htm?q=*&fq=record_ID:{object_id}"

    museum = _museum_name(unit_code)

    candidate = {
        "category_id": category_id,
        "source": "smithsonian",
        "object_id": str(object_id),
        "title": title,
        "artist": artist,
        "date": date,
        "culture": culture,
        "dynasty": "",
        "period": "",
        "classification": classification,
        "department": "",  # Smithsonian doesn't have "department" like the Met
        "image_url": image_url,
        "image_url_small": image_url_small,
        "museum": museum,
        "license": "CC0 (Smithsonian Open Access)",
        "source_url": source_url,
        "accession": "",
    }

    return candidate


# ----------------------------------------------------------------------------
# Search and collect
# ----------------------------------------------------------------------------
def search_smithsonian(
    query: str, category_id: str, rows: int, api_key: str
) -> List[Dict[str, Any]]:
    """Search the Smithsonian API and return parsed candidates."""
    log.info("Smithsonian search: q=%r (category=%s, rows=%d)", query, category_id, rows)

    params = {
        "api_key": api_key,
        "q": query,
        "rows": rows,
    }

    data = http_get(SMITHSONIAN_SEARCH_URL, params)
    if not data:
        return []

    response = data.get("response", {})
    total_available = response.get("rowCount", 0)
    rows_data = response.get("rows", [])
    log.info("  API returned %d rows (of %d total)", len(rows_data), total_available)

    candidates: List[Dict[str, Any]] = []
    for row in rows_data:
        cand = parse_row(row, category_id)
        if cand:
            candidates.append(cand)

    log.info("  parsed %d valid candidates from %d rows", len(candidates), len(rows_data))
    return candidates


# ----------------------------------------------------------------------------
# Dedup and merge
# ----------------------------------------------------------------------------
def dedupe(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for c in candidates:
        key = (c["source"], c["object_id"])
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


def merge_into_candidates(new_candidates: List[Dict[str, Any]]) -> None:
    """Merge new candidates into existing candidates.json, deduped by source+object_id."""
    existing: List[Dict[str, Any]] = []
    if os.path.exists(CANDIDATES_PATH):
        with open(CANDIDATES_PATH, "r", encoding="utf-8") as f:
            existing_data = json.load(f)
            existing = existing_data.get("candidates", [])

    # Build dedup set of existing keys
    existing_keys = {(c["source"], c["object_id"]) for c in existing}

    # Add new candidates that don't already exist
    added = 0
    for c in new_candidates:
        key = (c["source"], c["object_id"])
        if key not in existing_keys:
            existing.append(c)
            existing_keys.add(key)
            added += 1

    log.info("Merged %d new candidates into candidates.json (%d total, %d were dupes)",
             added, len(existing), len(new_candidates) - added)

    with open(CANDIDATES_PATH, "w", encoding="utf-8") as f:
        json.dump({"total": len(existing), "candidates": existing}, f, ensure_ascii=False, indent=2)
    log.info("Wrote %d total candidates → %s", len(existing), CANDIDATES_PATH)


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    api_key = get_api_key()

    all_candidates: List[Dict[str, Any]] = []

    for target in SEARCH_TARGETS:
        cat_id = target["category_id"]
        for query in target["queries"]:
            try:
                cands = search_smithsonian(query, cat_id, target["rows"], api_key)
                all_candidates.extend(cands)
            except Exception as exc:
                log.exception("Failed fetching query %r for %s: %s", query, cat_id, exc)
            time.sleep(REQUEST_DELAY)

    # Dedupe within smithsonian results
    before = len(all_candidates)
    all_candidates = dedupe(all_candidates)
    after = len(all_candidates)
    log.info("Smithsonian dedupe: %d → %d", before, after)

    # Per-category counts
    by_cat: Dict[str, int] = {}
    for c in all_candidates:
        by_cat[c["category_id"]] = by_cat.get(c["category_id"], 0) + 1
    log.info("Smithsonian candidates per category:")
    for cat, n in sorted(by_cat.items()):
        log.info("  %-24s %d", cat, n)

    # Merge into candidates.json
    merge_into_candidates(all_candidates)


if __name__ == "__main__":
    main()
