# Europe Drone Events · 2026

A static interactive map of the supplied consolidated research register and deduplicated supplement. Open the [GitHub Pages map](https://virgil-ideas.github.io/eu-drone-events-2026/), or run locally:

```sh
cd drone-map
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Then open <http://127.0.0.1:4173>. No API key, package installation or build step is needed.

## Map and replay

- Drag to pan; scroll, pinch or use +/− to zoom.
- Every event is shown individually at all zoom levels. Each blob stays at least 20 CSS pixels across, with translucent fill so overlaps show density. Zoom in or use the event list to inspect dense areas.
- Select a marker or a row in the independently scrollable register to see the original fields and linked sources.
- Replay moves continuously through every calendar day, including quiet days; records accumulate. At 1× it advances 8 days per second (about 30 seconds for the full timeline); 2× and 4× run at 16 and 32 days per second. Pause/resume preserves progress. Scrubbing snaps to calendar dates, keyboard arrows move one day, and the previous/next buttons step between event dates. Existing markers remain in place as new records appear. New arrivals get one fading ripple (disabled for reduced-motion preferences) and a quiet, 240 ms synthesized sine tone. Each type has a note in C-major pentatonic order: alert C5, recovery D5, flight E5, disposal G5, engagement A5, shoot-down C6, crash D6, explosion E6. Different types arriving on the same date form a chord; repeated types subtly weight the mix. Total gain is normalized to keep chords quiet, and successive dates crossfade so fast playback does not pile up sound. Sound starts only after a user gesture and can be muted with the speaker button. Scrubbing and Show all are silent.
- All 112 records appear in one view: 84 baseline records, 27 new event additions and the unidentified object N033 under Alert / other. The three supplemental precautionary alerts and 32 daily reports are excluded from the map; the complete unchanged research update remains downloadable.
- Show all resets the date and full map extent.
- About the data explains the counting rules and includes the eight non-additive context records and both original Markdown downloads.

## Marker colors

- Blue: flight
- Purple: shot down or armed engagement
- Amber: crash
- Red: reported incident explosion
- Slate teal: controlled disposal by authorities
- Teal: recovery
- Gray: alert or other unresolved outcome

Records with several stages prioritize incident explosion, then shoot-down or armed engagement, then crash for the marker color; applicable stages remain visible in the details. Discovery-only records keep their recovery date and category, without implying a same-day crash. Controlled disposal is separate from incident explosions. Explosive payloads, fires, attempted attacks with failed charges, nearby explosions and ambiguous interceptions do not automatically become explosions or shoot-downs. E047 (20 August Neptun Deep) is classified as military engagement after checking the MApN correction and AGERPRES report: F-16 cannon fire damaged the explosive maritime drone and naval EOD subsequently neutralized it. Disposal remains a secondary stage, and the intended target is not established. The reviewed classification is in `scripts/build-data.py`; source fields remain unchanged.

## Data and limitations

`dist/events.js` contains 84 E-records plus 28 mapped N-records, eight A/NA context records and 167 source references (93 baseline + 74 supplement). The importer validates all 63 dated N-records before retaining the 27 event additions and N033 for the requested map view. Only canonical detailed tables are imported; the compact manifest is validated as an index, not imported a second time. Stable IDs are unique, so rebuilding is idempotent. Original fields are retained verbatim. The source was not independently fact-checked as part of building the map.

Coordinates in `scripts/build-data.py` are **editorial approximate geographic anchors**, not verified incident locations. Broad, unresolved and offshore locations are explicitly labelled. E010 and E029 each have two regional anchors but count once in the register, so the complete map contains 114 individual markers for 112 records. Markers are never clustered, merged or shifted to avoid overlap. E058 uses a representative Lithuania position because its reported Pratkūnai site has not been geocoded. Supplementary Lithuanian village records without verified geocoding use labelled district anchors. Overlapping records remain individual markers.

Replay uses each record's first listed calendar date. Full date ranges, discrepancies, discovery dates and linked follow-up dates remain in the detail panel. Status reflects the supplied research snapshot, including later attribution updates; replay does not reconstruct what was known on that day. Record categories describe the event type, not confidence, operator or nationality. Context totals are never added to dated-record counts. N038 keeps its 9–10 September discovery/disposal chain; N062 and N063 remain separate Mamaia Nord and Corbu finds. N023 and N055 are individual encounters, not duplicated daily reports. N033 is included under Alert / other and remains explicitly unidentified. Offshore N042 remains outside territorial waters in its detailed scope note.

To regenerate after editing either supplied Markdown file in the parent directory:

```sh
python3 scripts/build-data.py
```

Add corresponding explicit approximate anchors and reviewed outcomes when adding records. The importer validates expected record classes, unique IDs, the supplement manifest, date ranges and all source references. UI counts and replay bounds derive from the generated data. Both input files are copied unchanged for download.

The map uses locally vendored [Leaflet 1.9.4](https://leafletjs.com/download.html); its license is in `dist/vendor`. [OpenStreetMap standard tiles](https://operations.osmfoundation.org/policies/tiles/) load on demand and require an internet connection. Google Fonts are optional; system font fallbacks are included. The app does not prefetch tiles or offer offline map downloads. A tile error leaves the event list and record markers usable.

Optional WebMCP tools use the same visible selection and timeline actions when supported by the browser. They were checked with valid and invalid inputs in the local preview.

## Project layout

- `dist/index.html` — complete static page
- `dist/styles.css` — desktop and mobile layouts
- `dist/app.js` — map, event details and replay controls
- `dist/events.js` — generated source data
- `scripts/build-data.py` — baseline import, approximate anchors and merged output
- `scripts/supplement.py` — canonical supplemental tables, occurrence classifications and approximate anchors
- `../.github/workflows/pages.yml` — automatic GitHub Pages publication from `main`

Both original Markdown files in the project root are preserved unchanged.

## Supplementary anchor checks

Anchors are deliberately rounded and approximate. Supporting geographic references used while locating the new reporting areas include [Zourafa’s NGA-backed coordinates](https://www.wikidata.org/wiki/Q19803473), [Varėna district coordinates](https://geographic.org/geographic_names/name.php?c=lithuania&fid=3704&uni=9088780), [Pasvalys](https://www.geodatos.net/en/coordinates/lithuania/pasvalys), [Edighiol–Periboina](https://www.findlatitudeandlongitude.com/l/Edighiol%2B-%2BPeriboina%2C%2BRomania/1228663/), and [Periteașca](https://mapcarta.com/13687884). These locate broad areas only and do not independently verify incident coordinates or the research claims.
