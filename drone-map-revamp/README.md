# Europe Foreign Drone Events · 2026 (Revamped Edition)

This folder (`drone-map-revamp/`) contains the complete UX and functional revamp of `droneincidents.eu`, keeping the original `drone-map/` untouched for side-by-side comparison.

## Run locally

```sh
python3 -m http.server 4174 --bind 127.0.0.1 --directory drone-map-revamp
```

Then open <http://127.0.0.1:4174/>.

To refresh the exported editorial headlines and TL;DR summaries (`pages-data.js`) from `drone-map/data/pages.json` and `drone-map/data/events.json`:

```sh
python3 drone-map-revamp/build-pages-data.py
```

## Key Changes in This Revamp

1. **Latest Incidents Visible Immediately Above the Fold**
   - Replaced the tall static sidebar header (`THE EVENT REGISTER`, `"A year in the air..."`, intro paragraph, and inline monthly bar chart) and redundant floating map title box with a **56px compact command bar** that shows live totals (`145 records · 10 EU countries · 18 Oct cutoff`) and an interactive **90-Day Surge Pill (`▲ +324%`)** with a mini spark-bar that opens the full monthly breakdown modal on demand.
   - The left panel starts immediately with the latest incidents (`18 Oct 2026` at the top) plus instant search, country filter, and outcome-type filter.

2. **Headlines, TL;DR Summaries & News Articles Brought Forth**
   - Exported the reviewed editorial copy (`headline`, `description` TL;DR, and multi-paragraph `summary`) from `drone-map/data/pages.json` into `pages-data.js`.
   - **Feed Cards** now show the full journalistic headline, a visible **TL;DR box**, the explicit **attribution/uncertainty status**, and **direct clickable news source chips (`📰 Publisher ↗`)** right on the card.
   - Added a **News Articles & Sources** tab in the feed (`210+` cited news reports) showing every article's headline, publisher, date, researcher verification/audit summary, and a one-click jump to the mapped incident.
   - **Redesigned Incident Briefing Drawer (`#detail`)**: Places the **Executive TL;DR Summary** and a **2×2 Key Facts Grid** (*What Happened*, *Drone / Vehicle*, *Impact & Damage*, *Response & Outcome*) at the very top, followed by an explicit **Attribution & Uncertainty Callout**, media/news articles with audit summaries, and a collapsible `<details>` section for the 16 raw technical register fields.

3. **Relocated Time-Interval & Playable History Studio + Video Recording Export**
   - Moved the timeline scrubber out of the permanent 158px bottom row so the map and feed get 100% of the viewport height.
   - Placed a compact floating **Replay History & Studio** pill on the map (and a `History & Record` button in the header) that expands into the **Timeline & Recording Studio**.
   - **Custom Time Intervals**: Pick any `From` and `To` date or use quick presets (`Full Year`, `Last 30d`, `Last 90d`, `Aug–Oct Surge`, `October`) to filter the map, feed, and replay bounds.
   - **Download Your Own Recording**: Click **Record & Download Video** to render and download a self-contained 1280×720 `.webm`/`.mp4` video recording of the selected interval replay (complete with animated markers, ripples, date counter, live latest-headline ticker, and optional pentatonic audio), or export a **PNG snapshot** or **CSV dataset** of the selected interval.
