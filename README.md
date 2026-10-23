# Europe Drone Events · 2026

[Open the interactive map](https://droneincidents.eu/) · [Browse every record](https://droneincidents.eu/events/)

A zoomable map and timeline replay of the supplied EU foreign-drone research register and deduplicated update, with targeted additions through 23 October 2026. The map contains 164 active records: 157 event records and seven unidentified/provisional candidates. Karwia’s domestic-drone discovery is excluded from the map and totals; its original page preserves the correction. The original supplement’s daily reports and precautionary alerts remain excluded, except for specifically reviewed later records such as the explicitly labelled 14 October Romanian RO-Alert, which involved no airspace entry.

Recent additions include Greek UAV activity on 21–22 October, provisional discoveries at Moșești and Lubaczów on 21 October, and KHORYV’s reported drone strike off Constanța on 23 October. KHORYV’s attack, fire, reported sinking and rescue remain one event. Operator attribution and the final vessel condition remain unresolved. The inclusive reporting cutoff accommodates reviewed occurrences; it does not certify complete EU-wide coverage. Outstanding source and coverage gaps are documented in the database’s watchlist.

Every record has an individual marker with a minimum visible size. Colors distinguish flights (blue), shoot-downs or armed engagements (purple), crashes (orange), reported strikes or explosions (fire red), controlled disposal (slate teal), recoveries (yellow), and alerts or other outcomes (gray). A trend panel compares the last 90 calendar days with the preceding 90 days, and a running-total curve sits above the timeline. Selecting a record shows images or video from the linked reports, then its sources, uncertainty and counting notes. The interface is available in all 24 official EU languages; record fields stay in the original English. Replay moves smoothly through every calendar day at 8 days per second by default, with pause, date scrubbing, event-date stepping and 2×/4× playback speeds. New events ripple and play quiet pentatonic notes by type, combining into chords on shared dates; sound can be muted.

Positions are approximate editorial anchors. These are record counts, not a count of confirmed attacks or unique drones. The nine aggregate/context records remain separate from the map count. Daily bulletins and their reported aircraft/crossing totals are not counted as individual events.

## Run locally

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory drone-map/dist
```

Open <http://127.0.0.1:4173/>. No API key or package installation is required.

See [project documentation](drone-map/README.md) for data handling, colors, replay behavior and limitations. The [original Markdown register](eu_foreign_drone_events_2026_consolidated.md) and [deduplicated update](eu_foreign_drone_events_2026_final_update_deduped.md) are preserved unchanged in the repository.

## Update the data

The map's source of truth is a validated JSON database in [`drone-map/data`](drone-map/data/README.md). Events include their coordinates, classifications and reviewed corrections; sources and non-additive context records have their own files. The original Markdown files are preserved research snapshots. To update an event, edit its canonical JSON record and rebuild:

```sh
python3 drone-map/scripts/build-data.py
python3 -m unittest discover -s drone-map/tests -v
python3 drone-map/scripts/build-data.py --check
```

The [editing guide](drone-map/data/README.md) documents adding events, reviewing sources and publishing changes. Git preserves the edit history; no database server or additional packages are required.

## Publish

GitHub Actions runs integrity tests and checks the JavaScript and generated data on pull requests and pushes, then deploys `drone-map/dist` to GitHub Pages on each push to `main`. The workflow can also be started manually from the Actions tab.
