#!/usr/bin/env python3
"""fetch.py — Query Met, Cleveland, and Art Institute museum APIs
for public domain artwork candidates across target collections.

Outputs: ~/Projects/artpuzzle/data/candidates.json
"""
from __future__ import annotations

import json
import os
import time
import logging
from typing import Any, Dict, List

import requests

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
CANDIDATES_PATH = os.path.join(DATA_DIR, "candidates.json")

MET_BASE = "https://collectionapi.metmuseum.org/public/collection/v1"
CLEVELAND_BASE = "https://openaccess-api.clevelandart.org/api/artworks"
ARTIC_BASE = "https://api.artic.edu/api/v1/artworks"

REQUEST_DELAY = 0.5  # seconds, between API calls to be respectful
TIMEOUT = 30

# Each search target maps to a category in the final manifest.
# (category_id, category_name, category_description, search spec)
SEARCH_TARGETS = [
    {
        "category_id": "japanese-ukiyoe",
        "category_name": "Japanese Ukiyo-e",
        "category_description": "Woodblock prints from Japan's floating world",
        "source": "met",
        "queries": ["Hokusai", "Hiroshige", "Utamaro"],
        "department": "Asian Art",
    },
    {
        "category_id": "japanese-screens",
        "category_name": "Japanese Screen Paintings",
        "category_description": "Byobu and fusuma screen paintings from Japan",
        "source": "met",
        "queries": ["Japan screen", "byobu", "fusuma"],
        "department": "Asian Art",
    },
    {
        "category_id": "chinese-landscape",
        "category_name": "Chinese Landscapes",
        "category_description": "Chinese landscape paintings and bird-and-flower works",
        "source": "cleveland",
        "department": "Chinese Art",
    },
    {
        "category_id": "korean-joseon",
        "category_name": "Korean Joseon Dynasty",
        "category_description": "Paintings from Korea's Joseon dynasty",
        "source": "met",
        "queries": ["Korea", "Joseon"],
        "department": "Asian Art",
    },
    {
        "category_id": "western-old-masters",
        "category_name": "Western Old Masters",
        "category_description": "European Old Master paintings (Rembrandt, Vermeer, Dutch Golden Age)",
        "source": "met",
        "queries": ["Rembrandt", "Vermeer"],
        "department": "European Paintings",
    },
    {
        "category_id": "impressionism",
        "category_name": "Impressionism",
        "category_description": "Impressionist and Post-Impressionist works (Monet, Van Gogh)",
        "source": "mixed",
        "met_queries": ["Monet", "Van Gogh"],
        "artic_queries": ["Monet", "Van Gogh"],
    },
    {
        "category_id": "islamic-art",
        "category_name": "Islamic Art",
        "category_description": "Islamic geometric and decorative art",
        "source": "met",
        "queries": ["Islamic"],
        "department": "Islamic Art",
    },
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("fetch")


# ----------------------------------------------------------------------------
# HTTP helper
# ----------------------------------------------------------------------------
def http_get(url: str, params: Dict[str, Any] | None = None) -> Dict[str, Any] | None:
    """GET with retries; returns JSON dict or None on failure."""
    for attempt in range(3):
        try:
            resp = requests.get(url, params=params, timeout=TIMEOUT)
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            log.warning("GET %s failed (attempt %d): %s", url, attempt + 1, exc)
            time.sleep(1.0 * (attempt + 1))
    log.error("Giving up on %s", url)
    return None


# ----------------------------------------------------------------------------
# Met Museum
# ----------------------------------------------------------------------------
def fetch_met_candidates(query: str, department: str, category_id: str, limit: int = 40) -> List[Dict[str, Any]]:
    """Search the Met API and hydrate each object with full metadata."""
    log.info("Met search: q=%r department=%r (category=%s)", query, department, category_id)
    search_url = f"{MET_BASE}/search"
    params: Dict[str, Any] = {
        "q": query,
        "hasImages": "true",
    }
    if department:
        params["department"] = department

    data = http_get(search_url, params=params)
    if not data:
        return []

    object_ids = data.get("objectIDs") or []
    if not object_ids:
        log.info("  no results for %r", query)
        return []

    # The Met returns up to hundreds of IDs; cap per query so we stay respectful.
    object_ids = object_ids[:limit]
    log.info("  found %d objectIDs, hydrating first %d", len(data.get("objectIDs", [])), len(object_ids))

    candidates: List[Dict[str, Any]] = []
    for oid in object_ids:
        time.sleep(REQUEST_DELAY)
        obj = http_get(f"{MET_BASE}/objects/{oid}")
        if not obj:
            continue
        # Only keep objects with a usable primary image
        primary_image = obj.get("primaryImage") or ""
        if not primary_image:
            continue
        candidates.append({
            "category_id": category_id,
            "source": "met",
            "object_id": str(oid),
            "title": (obj.get("title") or "Untitled").strip(),
            "artist": (obj.get("artistDisplayName") or "Unknown").strip(),
            "date": (obj.get("objectDate") or "").strip(),
            "culture": (obj.get("culture") or "").strip(),
            "dynasty": (obj.get("dynasty") or "").strip(),
            "period": (obj.get("period") or "").strip(),
            "classification": (obj.get("classification") or "").strip(),
            "department": (obj.get("department") or "").strip(),
            "image_url": primary_image,
            "image_url_small": obj.get("primaryImageSmall") or primary_image,
            "museum": "Metropolitan Museum of Art",
            "license": "Public Domain (Met Open Access)",
            "source_url": f"{MET_BASE}/objects/{oid}",
            "accession": obj.get("accessionNumber") or "",
        })
    log.info("  collected %d hydrated Met objects for %r", len(candidates), query)
    return candidates


# ----------------------------------------------------------------------------
# Cleveland Museum of Art
# ----------------------------------------------------------------------------
def fetch_cleveland_candidates(department: str, category_id: str, limit: int = 40) -> List[Dict[str, Any]]:
    """Fetch Cleveland Museum artworks by department."""
    log.info("Cleveland: department=%r (category=%s)", department, category_id)
    candidates: List[Dict[str, Any]] = []
    offset = 0
    page_size = 100  # Cleveland max page size
    collected = 0

    while collected < limit:
        params = {
            "department": department,
            "limit": page_size,
            "offset": offset,
            "has_image": 1,
        }
        data = http_get(CLEVELAND_BASE, params=params)
        if not data:
            break
        artworks = data.get("data") or []
        if not artworks:
            break

        for art in artworks:
            if collected >= limit:
                break
            images = art.get("images")
            # Cleveland returns images as a DICT (web/print/full), not a list.
            if not images or not isinstance(images, dict):
                continue
            web_obj = images.get("web") if isinstance(images.get("web"), dict) else {}
            print_obj = images.get("print") if isinstance(images.get("print"), dict) else {}
            full_obj = images.get("full") if isinstance(images.get("full"), dict) else {}
            web = web_obj.get("url") if web_obj else None
            print_url = print_obj.get("url") if print_obj else None
            full = full_obj.get("url") if full_obj else None
            image_url = print_url or web or full
            if not image_url:
                continue

            artists_tags = art.get("artists_tags") or []
            artist = ""
            if artists_tags and isinstance(artists_tags, list):
                artist = artists_tags[0] if isinstance(artists_tags[0], str) else str(artists_tags[0])

            # Cleveland returns several fields as lists; coerce to strings.
            def _to_str(val: Any) -> str:
                if isinstance(val, list):
                    return "; ".join(str(v) for v in val if v)
                return str(val).strip() if val else ""

            candidates.append({
                "category_id": category_id,
                "source": "cleveland",
                "object_id": str(art.get("id") or art.get("accession_number") or ""),
                "title": (art.get("title") or "Untitled").strip(),
                "artist": artist.strip() or "Unknown",
                "date": (art.get("creation_date") or "").strip(),
                "culture": _to_str(art.get("culture")),
                "dynasty": "",
                "period": "",
                "classification": _to_str(art.get("type")),
                "department": _to_str(art.get("department")),
                "image_url": image_url,
                "image_url_small": web or image_url,
                "museum": "Cleveland Museum of Art",
                "license": "CC0 (Creative Commons Zero)",
                "source_url": f"{CLEVELAND_BASE}/{art.get('id', '')}",
                "accession": art.get("accession_number") or "",
            })
            collected += 1

        log.info("  page offset=%d → collected %d/%d", offset, collected, limit)
        if len(artworks) < page_size:
            break
        offset += page_size
        time.sleep(REQUEST_DELAY)

    log.info("  collected %d Cleveland objects", len(candidates))
    return candidates


# ----------------------------------------------------------------------------
# Art Institute of Chicago
# ----------------------------------------------------------------------------
def fetch_artic_candidates(query: str, category_id: str, limit: int = 40) -> List[Dict[str, Any]]:
    """Search the Art Institute of Chicago API."""
    log.info("Artic search: q=%r (category=%s)", query, category_id)
    params = {
        "q": query,
        "query[term][is_public_domain]": "true",
        "limit": limit,
        "fields": "id,title,artist_display,date_display,department,classification,image_id,medium_display,dimensions",
    }
    data = http_get(f"{ARTIC_BASE}/search", params=params)
    if not data:
        return []
    artworks = data.get("data") or []
    candidates: List[Dict[str, Any]] = []
    for art in artworks:
        image_id = art.get("image_id")
        if not image_id:
            continue
        image_url = f"https://www.artic.edu/iiiff/2/{image_id}/full/843,/0/default.jpg"
        image_url_full = f"https://www.artic.edu/iiiff/2/{image_id}/full/2000,/0/default.jpg"
        candidates.append({
            "category_id": category_id,
            "source": "artic",
            "object_id": str(art.get("id") or ""),
            "title": (art.get("title") or "Untitled").strip(),
            "artist": (art.get("artist_display") or "Unknown").strip(),
            "date": (art.get("date_display") or "").strip(),
            "culture": "",
            "dynasty": "",
            "period": "",
            "classification": (art.get("classification") or "").strip(),
            "department": (art.get("department") or "").strip(),
            "image_url": image_url_full,
            "image_url_small": image_url,
            "museum": "Art Institute of Chicago",
            "license": "Public Domain (Art Institute of Chicago)",
            "source_url": f"{ARTIC_BASE}/{art.get('id', '')}",
            "accession": "",
        })
    log.info("  collected %d Artic objects for %r", len(candidates), query)
    return candidates


# ----------------------------------------------------------------------------
# Dedup helper
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


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    all_candidates: List[Dict[str, Any]] = []

    for target in SEARCH_TARGETS:
        cat_id = target["category_id"]
        source = target["source"]
        try:
            if source == "met":
                for q in target.get("queries", []):
                    cands = fetch_met_candidates(q, target.get("department", ""), cat_id, limit=40)
                    all_candidates.extend(cands)
                    time.sleep(REQUEST_DELAY)
            elif source == "cleveland":
                cands = fetch_cleveland_candidates(target["department"], cat_id, limit=40)
                all_candidates.extend(cands)
                time.sleep(REQUEST_DELAY)
            elif source == "mixed":
                # Met portion
                for q in target.get("met_queries", []):
                    cands = fetch_met_candidates(q, "", cat_id, limit=20)
                    all_candidates.extend(cands)
                    time.sleep(REQUEST_DELAY)
                # Artic portion
                for q in target.get("artic_queries", []):
                    cands = fetch_artic_candidates(q, cat_id, limit=20)
                    all_candidates.extend(cands)
                    time.sleep(REQUEST_DELAY)
        except Exception as exc:
            log.exception("Failed fetching category %s: %s", cat_id, exc)
            continue

    # Dedupe across queries within the same source
    before = len(all_candidates)
    all_candidates = dedupe(all_candidates)
    after = len(all_candidates)
    log.info("Dedupe: %d → %d candidates", before, after)

    # Bucket counts
    by_cat: Dict[str, int] = {}
    for c in all_candidates:
        by_cat[c["category_id"]] = by_cat.get(c["category_id"], 0) + 1
    log.info("Candidates per category:")
    for cat, n in sorted(by_cat.items()):
        log.info("  %-24s %d", cat, n)

    with open(CANDIDATES_PATH, "w", encoding="utf-8") as f:
        json.dump({"total": len(all_candidates), "candidates": all_candidates}, f, ensure_ascii=False, indent=2)
    log.info("Wrote %d candidates → %s", len(all_candidates), CANDIDATES_PATH)


if __name__ == "__main__":
    main()
