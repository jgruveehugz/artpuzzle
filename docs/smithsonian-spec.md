# Smithsonian Fetch Spec — ArtPuzzle Asian Expansion

## Goal
Add a `fetch_smithsonian.py` to the content pipeline that pulls public-domain Asian artworks from the Smithsonian Open Access API, focusing on growing the thin categories: Ukiyo-e, Japanese Screens, Chinese Landscapes, Korean Joseon.

## API (verified working)
- Category browse: `https://api.si.edu/openaccess/api/v1.0/category/art_design/search?api_key={KEY}&q={query}&rows={n}`
- API key: use `DEMO_KEY` (rate-limited) or better, register free at https://api.data.gov/signup/ and store key in `content-pipeline/.smithsonian_key` (gitignored). Try env var `SMITHSONIAN_API_KEY` first, fall back to DEMO_KEY.
- Image URLs appear in object content as `https://ids.si.edu/ids/download?id={ID}.jpg`
- Structured metadata in `content.freetext`: `date`, `name`, `place`, `objectType`, `objectRights`, `creditLine`, `physicalDescription`, `setName`
- Only keep objects whose `objectRights`/usage permits CC0 or public domain. Check `content.freetext.objectRights` for "CC0" or non-copyright. Freer/Sackler (unit_code FSG) is largely CC0.

## Search targets (map to existing category_ids)
- japanese-ukiyoe: q="ukiyo-e", q="Hiroshige", q="Hokusai", q="Japanese woodblock"
- japanese-screens: q="Japanese screen", q="byobu", q="Japanese painting Edo"
- chinese-landscape: q="Chinese landscape painting", q="shan shui", q="Chinese handscroll"
- korean-joseon: q="Korean painting", q="Joseon"

## Output
Append candidates (same schema as fetch.py) into `data/candidates.json` with `source: "smithsonian"`, `object_id`, `title`, `artist`, `date`, `culture`, `classification`, `image_url`, `image_url_small`, `museum: "Smithsonian (Freer|Sackler)"`, `license`, `source_url`.

## Integration
- Reuse the same candidate dict shape as fetch.py so download.py/process.py/manifest.py work unchanged.
- Respect rate limits: 0.5s between calls (DEMO_KEY is limited).
- Then run: curate.py → download.py → process.py → manifest.py, and regenerate src/data/puzzles.json (flat array form the web app uses).
- Target: bring each thin category to 8-15 quality puzzles.

## Verification
After running, print category counts and confirm japanese-ukiyoe >= 8, chinese-landscape >= 8, korean-joseon >= 3 (if available), japanese-screens >= 8.
