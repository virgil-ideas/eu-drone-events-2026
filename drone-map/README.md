# Europe Drone Events · 2026

A static interactive map of the supplied consolidated research register. Open the [GitHub Pages map](https://virgil-ideas.github.io/eu-drone-events-2026/), or run locally:

```sh
cd drone-map
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Then open <http://127.0.0.1:4173>. No API key, package installation or build step is needed.

## Map and replay

- Drag to pan; scroll, pinch or use +/− to zoom.
- Every event is shown individually at all zoom levels. Each blob stays at least 20 CSS pixels across, with translucent fill so overlaps show density. Zoom in or use the event list to inspect dense areas.
- Select a marker or a row in the independently scrollable register to see the original fields and linked sources.
- Replay moves continuously through every calendar day, including quiet days; records accumulate. At 1× it advances 8 days per second (about 30 seconds for the full timeline); 2× and 4× run at 16 and 32 days per second. Pause/resume preserves progress. Scrubbing snaps to calendar dates, keyboard arrows move one day, and the previous/next buttons step between event dates. Existing markers remain in place as new records appear. New arrivals get one fading ripple (disabled for reduced-motion preferences) and a quiet, 240 ms synthesized sine tone. Each type has a note in C-major pentatonic order: alert C4, recovery D4, flight E4, disposal G4, engagement A4, shoot-down C5, crash D5, explosion E5. Different types arriving on the same date form a chord; repeated types subtly weight the mix. Total gain is normalized to keep chords quiet, and successive dates crossfade so fast playback does not pile up sound. Sound starts only after a user gesture and can be muted with the speaker button. Scrubbing and Show all are silent.
- Show all resets the full register and map extent.
- About the data explains the counting rules and includes the four non-additive context records and the original Markdown download.

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

`dist/events.js` contains all 84 E-records, four A-records and 93 source references, parsed from the original Markdown. Original fields are retained verbatim. The source was not independently fact-checked as part of building the map.

Coordinates in `scripts/build-data.py` are **editorial approximate geographic anchors**, not verified incident locations. Broad, unresolved and offshore locations are explicitly labelled. E010 and E029 each have two regional anchors but count once in the register, so the complete map contains 86 individual markers for 84 records. Markers are never clustered, merged or shifted to avoid overlap. E058 uses a representative Lithuania position because its reported Pratkūnai site has not been geocoded.

Replay uses each record's first listed calendar date. Full date ranges, discrepancies, discovery dates and linked follow-up dates remain in the detail panel. Status reflects the supplied research snapshot, including later attribution updates; replay does not reconstruct what was known on that day. Record categories describe the event type, not confidence, operator or nationality. Context totals are never added to the 84-record count.

To regenerate after editing the original Markdown in the parent directory:

```sh
python3 scripts/build-data.py
```

Add corresponding explicit approximate anchors when adding new events, and update the count assertions and UI totals if the register changes.

The map uses locally vendored [Leaflet 1.9.4](https://leafletjs.com/download.html); its license is in `dist/vendor`. [OpenStreetMap standard tiles](https://operations.osmfoundation.org/policies/tiles/) load on demand and require an internet connection. Google Fonts are optional; system font fallbacks are included. The app does not prefetch tiles or offer offline map downloads. A tile error leaves the event list and record markers usable.

Optional WebMCP tools use the same visible selection and timeline actions when supported by the browser. They were checked with valid and invalid inputs in the local preview.

## Project layout

- `dist/index.html` — complete static page
- `dist/styles.css` — desktop and mobile layouts
- `dist/app.js` — map, event details and replay controls
- `dist/events.js` — generated source data
- `scripts/build-data.py` — lossless table import and approximate anchors
- `../.github/workflows/pages.yml` — automatic GitHub Pages publication from `main`

The original Markdown in the project root is preserved unchanged.
