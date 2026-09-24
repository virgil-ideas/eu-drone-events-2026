# Europe Drone Events · 2026

[Open the interactive map](https://virgil-ideas.github.io/eu-drone-events-2026/)

A zoomable map and timeline replay of 84 event records from the supplied EU foreign-drone research register, through 24 September 2026.

Every record has an individual marker with a minimum visible size. Colors distinguish flights, shoot-downs or armed engagements, crashes, reported explosions, controlled disposal, recoveries, and alerts or other outcomes. The scrollable register includes source links, uncertainty and counting notes. Replay supports pause, date scrubbing, event-date stepping and playback speeds.

Positions are approximate editorial anchors. These are record counts, not a count of confirmed attacks or unique drones. The four aggregate/context records remain separate from the map count.

## Run locally

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory drone-map/dist
```

Open <http://127.0.0.1:4173/>. No API key or package installation is required.

See [project documentation](drone-map/README.md) for data handling, colors, replay behavior and limitations. The [original Markdown register](eu_foreign_drone_events_2026_consolidated.md) is preserved in the repository.

## Publish

GitHub Actions checks the JavaScript and regenerated data, then deploys `drone-map/dist` to GitHub Pages on each push to `main`. The workflow can also be started manually from the Actions tab.
