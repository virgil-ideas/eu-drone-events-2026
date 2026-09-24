# Europe Drone Events · 2026

[Open the interactive map](https://virgil-ideas.github.io/eu-drone-events-2026/)

A zoomable map and timeline replay of the supplied EU foreign-drone research register and deduplicated update, through 24 September 2026. The map contains 112 records: the 84 baseline records, 27 new events and one unidentified object under Alert / other. Supplementary daily reports and precautionary alerts are excluded from the map; the complete research remains available for download.

Every record has an individual marker with a minimum visible size. Colors distinguish flights (blue), shoot-downs or armed engagements (purple), crashes (orange), reported explosions (fire red), controlled disposal (slate teal), recoveries (yellow), and alerts or other outcomes (gray). A trend panel compares the last three months with the three before, and a running-total curve sits above the timeline. Selecting a record shows images or video from the linked reports, then its sources, uncertainty and counting notes. The interface is available in all 24 official EU languages; record fields stay in the original English. Replay moves smoothly through every calendar day at 8 days per second by default, with pause, date scrubbing, event-date stepping and 2×/4× playback speeds. New events ripple and play quiet pentatonic notes by type, combining into chords on shared dates; sound can be muted.

Positions are approximate editorial anchors. These are record counts, not a count of confirmed attacks or unique drones. The eight aggregate/context records remain separate from the map count. Daily bulletins and their reported aircraft/crossing totals are not counted as individual events.

## Run locally

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory drone-map/dist
```

Open <http://127.0.0.1:4173/>. No API key or package installation is required.

See [project documentation](drone-map/README.md) for data handling, colors, replay behavior and limitations. The [original Markdown register](eu_foreign_drone_events_2026_consolidated.md) and [deduplicated update](eu_foreign_drone_events_2026_final_update_deduped.md) are preserved unchanged in the repository.

## Publish

GitHub Actions checks the JavaScript and regenerated data, then deploys `drone-map/dist` to GitHub Pages on each push to `main`. The workflow can also be started manually from the Actions tab.
