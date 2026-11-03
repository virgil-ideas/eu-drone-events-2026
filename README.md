# Europe Drone Events · 2026

[Open the interactive map](https://droneincidents.eu/) · [Browse every record](https://droneincidents.eu/events/)

A zoomable map and timeline replay of the EU foreign-drone research register and reviewed updates through 3 November 2026. The map contains 179 active records: 169 event-class records and ten unidentified/provisional candidates. Karwia’s domestic-drone discovery is excluded from the map and totals; its original page preserves the correction. Selected alerts and offshore context remain explicitly distinguished from confirmed territorial incursions.

The 3 November update adds a provisional Balvi–Ludza episode in Latvia, not a confirmed foreign-drone incursion. A later NBS briefing confirms UAV detection but leaves origin and a possible fall unresolved; its visual resemblance to Ukrainian military UAVs is not confirmed attribution. NBS also now assesses the 1 November crossing UAV as likely a Russian Geran, with explosive payload unknown. It also updates the CONTSHIP JET cargo-hazard follow-up: the Tsarevo container’s origin and contents remain unconfirmed, and water-sample results are pending. The ship’s 28 October sinking is confirmed by Varna Radio. KHORYV’s completed sinking remains unestablished. The inclusive reporting cutoff accommodates reviewed occurrences; it does not certify complete EU-wide coverage. Outstanding gaps are documented in the database’s watchlist.

Every record has an individual marker with a minimum visible size. Colors distinguish flights (blue), shoot-downs or armed engagements (purple), crashes (orange), reported strikes or explosions (fire red), controlled disposal (slate teal), recoveries (yellow), and alerts or other outcomes (gray). A trend panel compares the last 90 calendar days with the preceding 90 days, and a running-total curve sits above the timeline. Selecting a record shows images or video from the linked reports, then its sources, uncertainty and counting notes. The interface is available in all 24 official EU languages; record fields stay in the original English. Replay moves smoothly through every calendar day at 8 days per second by default, with pause, date scrubbing, event-date stepping and 2×/4× playback speeds. New events ripple and play quiet pentatonic notes by type, combining into chords on shared dates. Strikes, explosions, shoot-downs and armed engagements have longer, textured bell sounds; the other categories retain their regular pings. Shoot-downs and armed engagements keep their original pitches. All sounds finish naturally and can overlap, with no delay to event timing. Sound can be muted.

Positions are approximate editorial anchors. These are record counts, not a count of confirmed attacks or unique drones. The nine aggregate/context records remain separate from the map count. Daily bulletins and their reported aircraft/crossing totals are not counted as individual events.

## Run locally

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory drone-map-revamp
```

Open <http://127.0.0.1:4173/>. No API key or package installation is required.

See the [interface guide](drone-map-revamp/README.md) for the production UI and [project documentation](drone-map/README.md) for data handling, colors, replay behavior and limitations. The [original Markdown register](eu_foreign_drone_events_2026_consolidated.md) and [deduplicated update](eu_foreign_drone_events_2026_final_update_deduped.md) are preserved unchanged in the repository.

## Update the data

The map's source of truth is a validated JSON database in [`drone-map/data`](drone-map/data/README.md). Events include their coordinates, classifications and reviewed corrections; sources and non-additive context records have their own files. The original Markdown files are preserved research snapshots. To update an event, edit its canonical JSON record and rebuild:

```sh
python3 drone-map/scripts/build-data.py
python3 -m unittest discover -s drone-map/tests -v
python3 drone-map/scripts/build-data.py --check
```

The [editing guide](drone-map/data/README.md) documents adding events, reviewing sources and publishing changes. Git preserves the edit history; no database server or additional packages are required.

## Publish

GitHub Actions runs integrity tests and checks the JavaScript and generated data on pull requests and pushes, then deploys `drone-map-revamp` to GitHub Pages on each push to `main`. The workflow can also be started manually from the Actions tab. The canonical database remains in `drone-map/data`; its build refreshes both interfaces. The previous interface remains in `drone-map/dist` and can be restored by changing the upload path in `.github/workflows/pages.yml`.

The latest partial EU27 review covers 30 October–3 November through approximately 06:04 UTC, with older gaps revisited but not declared closed. The original research archives remain unchanged.
