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
- Select a marker or a row in the register to see its details: linked images or video first, then the source references, then the original record fields. On desktop the sidebar scrolls as one column (trend panel, then the register). On phones, Explore the records opens a pull-up panel with monthly records and trends expanded by default; the whole panel scrolls. The register lists the newest records first; during replay and scrubbing it follows the newest records only while you are scrolled into the list, so the trend panel otherwise stays in view.
- Replay starts on 1 January 2026 and moves continuously through every calendar day, including quiet days before the first record; records accumulate. At 1× it advances 8 days per second (about 33 seconds for the full timeline); 2× and 4× run at 16 and 32 days per second. Pause/resume preserves progress. Scrubbing snaps to calendar dates, keyboard arrows move one day, and the previous/next buttons step between event dates. Existing markers remain in place as new records appear. New arrivals get one fading ripple (disabled for reduced-motion preferences) and a quiet, 240 ms synthesized sine tone. Each type has a note in C-major pentatonic order: alert C5, recovery D5, flight E5, disposal G5, engagement A5, shoot-down C6, crash D6, explosion E6. Different types arriving on the same date form a chord; repeated types subtly weight the mix. Total gain is normalized to keep chords quiet, and successive dates crossfade so fast playback does not pile up sound. Sound starts only after a user gesture and can be muted with the speaker button. Scrubbing and Show all are silent.
- All 112 records appear in one view: 84 baseline records, 27 new event additions and the unidentified object N033 under Alert / other. The three supplemental precautionary alerts and 32 daily reports are excluded from the map; the complete unchanged research update remains downloadable.
- The running-total curve above the scrubber shows how records accumulate; the played part is colored and the rest stays as a gray preview. The shaded band marks the last three calendar months, with the total before the band and at the cutoff labelled.
- On phones, the map fills the available screen above compact replay controls. Map key opens the legend, and the three-dot playback control reveals the running-total curve, previous/next buttons and Show all. Panels preserve the map and replay state, and the desktop layout returns automatically on wider screens.
- Show all resets the date and full map extent.
- About the data explains the counting rules and includes the eight non-additive context records and both original Markdown downloads.

## Trend panel

The sidebar opens with records per month. The headline compares the last three calendar months, including the current partial month, with the three months before (for the 24 September cutoff: 1 July – 24 September against 1 April – 30 June). Columns for the last three months are dark, the comparison months mid-gray and earlier months light; brackets under the columns give each window's total. During replay the columns fill up to the playhead. All figures derive from `events.js`, count records by first listed date, and describe this register rather than a verified count of attacks; the About dialog explains the caveats.

## Marker colors

- Blue: flight
- Purple: shot down or armed engagement
- Orange: crash
- Fire red: reported incident explosion
- Slate teal: controlled disposal by authorities
- Yellow: recovery
- Gray: alert or other unresolved outcome

Yellow, orange and fire red (`#e8c400`, `#f0700f`, `#d3201c`) were checked for color-vision-deficiency separation; marker outlines are a step darker so yellow stays visible on the pale map, and the legend always names each color.

Records with several stages prioritize incident explosion, then shoot-down or armed engagement, then crash for the marker color; applicable stages remain visible in the details. Discovery-only records keep their recovery date and category, without implying a same-day crash. Controlled disposal is separate from incident explosions. Explosive payloads, fires, attempted attacks with failed charges, nearby explosions and ambiguous interceptions do not automatically become explosions or shoot-downs. E047 (20 August Neptun Deep) is classified as military engagement after checking the MApN correction and AGERPRES report: F-16 cannon fire damaged the explosive maritime drone and naval EOD subsequently neutralized it. Disposal remains a secondary stage, and the intended target is not established. Reviewed classifications, outcome stages and approximate anchors are maintained directly in `data/events.json`. Original research snapshots remain unchanged.

## Languages

The interface is available in the 24 official EU languages. The language is chosen from `?lang=xx`, then the saved choice, then the browser's languages; the picker in the top bar switches it without reloading and updates the URL for sharing. Strings live in `dist/i18n/<code>.js`, one file per language, with `en.js` as the reference and fallback; only the active language is loaded. Plural forms follow `Intl.PluralRules`, and dates, numbers, percentages and country names come from `Intl`. Record fields, source titles and research notes stay in the register's original English (marked `lang="en"`), so translation never changes their wording.

After editing strings, run:

```sh
node scripts/check-i18n.js
```

It checks that every language has the same keys and `{placeholders}` as English and every plural category its language needs.

## Images and video

`dist/media.js` holds preview media for the sources each record cites: the article's sharing image (`og:image`/`twitter:image`) and, where the page offers one, a video file or an embeddable player. `scripts/media-extra.json` adds a few curated news items per event that are not among the register's sources; each has a note explaining why it matches the event's date and place, and the detail panel labels them as additional coverage.

Images load from the publishers' servers without a referrer and link to the report. Videos show a poster and load the third-party player only when the viewer presses play; closing the panel stops playback. Images that fail to load are skipped. Rights remain with the publishers.

To refresh the media (network required, about 25 seconds):

```sh
python3 scripts/fetch-media.py                  # fetch all cited pages
python3 scripts/fetch-media.py --only S43,N004  # refetch some sources or events
python3 scripts/fetch-media.py --offline        # rebuild media.js from scripts/media-cache.json
```

Some channels forbid playback on other sites even though YouTube's oEmbed reports the video as embeddable. Those items carry `"embeddable": false` in `media-extra.json` (found by loading each video through the YouTube IFrame Player API from a non-YouTube page, where they fail with error 150); the panel shows their thumbnail and opens the video on YouTube instead of embedding it.

The fetcher skips blocked pages (Reuters and AP currently block it), rejects logos, placeholders and site-wide default images, verifies each image and video loads without a referrer, and only keeps embeds that allow framing. CI checks `media.js` syntax but does not refetch.

## Data and limitations

The canonical database lives in `data/`: `events.json` holds mapped records, `sources.json` the shared bibliography, `contexts.json` non-additive context records, and `dataset.json` the schema version, reporting cutoff and research snapshot hashes. See the [database editing guide](data/README.md) for the schema and update workflow. There is no running database service.

`dist/events.js` is a generated browser export, currently containing 84 E-records plus 28 mapped N-records, eight A/NA context records and 169 source references (93 baseline + 74 supplement + 2 reviewed follow-up sources). Corrections, classifications and coordinates are part of the canonical records; there is no Markdown importer or separate overrides file. Both original research downloads remain unchanged. The original register was not independently fact-checked as part of building the map.

The 25 September review of E059 (Solca, 24 September) adds the confirmed radar track through northern Botoșani, roughly four minutes in Romanian airspace, two Romanian F-16s launched for monitoring, the IAR-330 SOCAT and Interior Ministry response, and residents' discovery/filming of wreckage among trees. MApN reports no casualties, material damage or fire. Monitorul de Suceava quotes conflicting witness accounts about an explosion; it remains explicitly witness-reported and unconfirmed in the reviewed official releases. E059 keeps its orange crash marker, with flight and recovery stages. Neither a shoot-down nor operator/national attribution is established, and no extra event is counted.

Coordinates in `data/events.json` are **editorial approximate geographic anchors**, not verified incident locations. Broad, unresolved and offshore locations are explicitly labelled. E010 and E029 each have two regional anchors but count once in the register, so the complete map contains 114 individual markers for 112 records. Markers are never clustered, merged or shifted to avoid overlap. E058 uses a representative Lithuania position because its reported Pratkūnai site has not been geocoded. Supplementary Lithuanian village records without verified geocoding use labelled district anchors. Overlapping records remain individual markers.

Replay uses each record's first listed calendar date. Full date ranges, discrepancies, discovery dates and linked follow-up dates remain in the detail panel. Status reflects the supplied research snapshot, including later attribution updates; replay does not reconstruct what was known on that day. Record categories describe the event type, not confidence, operator or nationality. Context totals are never added to dated-record counts. N038 keeps its 9–10 September discovery/disposal chain; N062 and N063 remain separate Mamaia Nord and Corbu finds. N023 and N055 are individual encounters, not duplicated daily reports. N033 is included under Alert / other and remains explicitly unidentified. Offshore N042 remains outside territorial waters in its detailed scope note.

To regenerate after editing the canonical JSON database (from `drone-map/`):

```sh
python3 scripts/build-data.py
python3 -m unittest discover -s tests -v
python3 scripts/build-data.py --check
```

The validator checks unique IDs/JSON keys, required fields, dates and ranges, source references, source URLs, outcome stages, approximate anchors and archived research hashes before writing any output. The check mode rejects stale generated files without modifying them. UI counts and replay bounds derive from the generated data. Add source reports and edit an existing event directly for a reviewed correction; do not edit `dist/events.js` or the archived Markdown. New research remains subject to deduplication and editorial review.

The map uses locally vendored [Leaflet 1.9.4](https://leafletjs.com/download.html); its license is in `dist/vendor`. [OpenStreetMap standard tiles](https://operations.osmfoundation.org/policies/tiles/) load on demand and require an internet connection. Google Fonts are optional; system font fallbacks are included. The app does not prefetch tiles or offer offline map downloads. A tile error leaves the event list and record markers usable.

Optional WebMCP tools use the same visible selection and timeline actions when supported by the browser. They were checked with valid and invalid inputs in the local preview.

## Visitor statistics

The map uses [GoatCounter](https://www.goatcounter.com/) for a private visitor dashboard with country totals. The public counting endpoint in `dist/analytics.js` connects to the owner's `ideanathor` account. The site URL is `https://droneincidents.eu/`; keep the dashboard private in the account settings. No password or API token belongs in this repository. Set the endpoint to an empty string to disable tracking.

Open [the analytics dashboard](https://ideanathor.goatcounter.com/) and sign in to read visits and the Locations breakdown. Keep Sessions and Locations enabled under Data collection; other dimensions can be disabled. Country is inferred from the visitor's network address, so VPNs can affect it. GoatCounter uses short-lived sessions to estimate visits without cookies; this is not a lifetime count of distinct people.

The script runs only on `droneincidents.eu`, its `www` variant, and the original GitHub Pages map URL. Local previews send nothing. All these addresses, language URLs and `index.html` count as one map page (`/`), with no query strings, selected event IDs, or referrer values sent by the integration. Replay, panning, language changes and event selection do not send additional hits. Statistics start when tracking is enabled; visitors who block analytics will not be counted. If the analytics service is unavailable, the map continues working.

## Project layout

- `dist/index.html` — complete static page
- `dist/styles.css` — shared and desktop layouts
- `dist/mobile.css` and `dist/mobile.js` — phone layout, record and legend sheets
- `dist/app.js` — map, trend panel, event details, replay controls and language switching
- `dist/analytics.js` — production-only visitor counting
- `dist/events.js` — generated browser data; do not edit directly
- `dist/media.js` — generated preview images and video for cited sources, plus curated extras
- `dist/i18n/` — interface strings for the 24 official EU languages
- `data/` — authoritative event, source, context and dataset JSON files; editing guide
- `scripts/database.py` — versioned schema validation and browser export
- `scripts/build-data.py` — validate canonical data and generate/check static output
- `tests/test_database.py` — data integrity and publishing regression checks
- `scripts/fetch-media.py` — source media extraction (`media-cache.json` caches raw results)
- `scripts/media-extra.json` — curated additional news media, matched per event
- `scripts/check-i18n.js` — translation completeness check
- `../.github/workflows/pages.yml` — automatic GitHub Pages publication from `main`

Both original Markdown files in the project root are preserved unchanged.

## Supplementary anchor checks

Anchors are deliberately rounded and approximate. Supporting geographic references used while locating the new reporting areas include [Zourafa’s NGA-backed coordinates](https://www.wikidata.org/wiki/Q19803473), [Varėna district coordinates](https://geographic.org/geographic_names/name.php?c=lithuania&fid=3704&uni=9088780), [Pasvalys](https://www.geodatos.net/en/coordinates/lithuania/pasvalys), [Edighiol–Periboina](https://www.findlatitudeandlongitude.com/l/Edighiol%2B-%2BPeriboina%2C%2BRomania/1228663/), and [Periteașca](https://mapcarta.com/13687884). These locate broad areas only and do not independently verify incident coordinates or the research claims.
