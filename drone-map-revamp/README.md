# Europe Foreign Drone Events · 2026 (Revamped Edition)

This folder (`drone-map-revamp/`) contains the complete UX and functional revamp of `droneincidents.eu`, keeping the original `drone-map/` untouched for side-by-side comparison.

## Run locally

```sh
python3 -m http.server 4174 --bind 127.0.0.1 --directory drone-map-revamp
```

Then open <http://127.0.0.1:4174/>.

To refresh the exported editorial headlines and TL;DR summaries (`pages-data.js`) and sync static assets from `drone-map/`:

```sh
python3 drone-map-revamp/build-pages-data.py
python3 drone-map-revamp/build-pages-data.py --check
```

The usual `python3 drone-map/scripts/build-data.py` command also refreshes this
folder, and its `--check` mode verifies both outputs without writing. The check
verifies summaries, copied event data, media, and
every static event page. CI validates both interfaces; deployment continues to
publish `drone-map/dist/` until the redesign is explicitly adopted.

Regression checks:

```sh
node --test drone-map-revamp/tests/*.cjs
python3 -m unittest discover -s drone-map-revamp/tests -v
node drone-map/scripts/check-i18n.js --dir drone-map-revamp/i18n
```

## Key Changes in This Revamp

1. **Latest Incidents Visible Immediately Above the Fold**
   - Replaced the tall static sidebar header (`THE EVENT REGISTER`, `"A year in the air..."`, intro paragraph, and inline monthly bar chart) and redundant floating map title box with a **56px compact command bar** that shows live totals (`164 records · 10 EU countries · 23 Oct cutoff`), an interactive **90-Day Surge Pill (`▲ +336%`)** with a mini spark-bar that opens the full monthly breakdown modal on demand, and a **⚓ Black Sea Escalation** turning-point pill.
   - The left panel starts immediately with the latest incidents (`23 Oct 2026` at the top) plus instant search, country filter, and outcome-type filter.

2. **Spotlight: "When Things Took a Dark Turn" — October 2026 Black Sea Maritime Escalation**
   - Highlights eight records covering nine merchant vessels in the 5–23 October 2026 escalation. Only *YARA J* `N086` and *Sea Destiny* `N089` are labeled as inside Romanian territorial waters. The offshore records retain their own jurisdiction notes: *WINE TRADER* `N090`, *Royad Mammadov* `N072`, *KHORYV* `N112`, *ALFA WATAN* & *ABLE* `N073`, *CHELSEA 3* `N079`, and *HS Dignity* `N080`.
   - Features a collapsible **Turning Point Spotlight Banner** at the top of the feed, a **3-phase chronological breakdown modal (`#maritime-dialog`)** with an interactive list of all 11 Black Sea vessel records, dedicated **⚓ Black Sea ship** and **⚠ Casualties / missing** badges on cards and briefings, an **⚓ Oct 5** marker line on the cumulative timeline curve, and one-click **Filter Ship Strikes** / **Replay Escalation** presets.

3. **Headlines, TL;DR Summaries & News Articles Brought Forth**
   - Exported the reviewed editorial copy (`headline`, `description` TL;DR, and multi-paragraph `summary`) from `drone-map/data/pages.json` and `drone-map/data/events.json` into `pages-data.js` for all 164 mapped records.
   - **Feed Cards** show the full journalistic headline, a visible **TL;DR box**, outcome/maritime/casualty/unidentified-object badges, and **direct clickable news source chips (`📰 Publisher ↗`)** right on the card.
   - Added a **News Articles & Sources** tab in the feed (`230+` cited news reports) showing every article's headline, publisher, date, researcher verification/audit summary, and a one-click jump to the mapped incident.
   - **Redesigned Incident Briefing Drawer (`#detail`)**: Places the **Executive TL;DR Summary** and a **2×2 Key Facts Grid** (*What Happened*, *Drone / Vehicle*, *Impact & Damage*, *Response & Outcome*) at the very top, followed by an explicit **Attribution & Uncertainty Callout**, media/news articles with audit summaries, and a collapsible `<details>` section for the 16 raw technical register fields.

4. **Relocated Time-Interval & Playable History Studio + Video Recording Export**
   - Moved the timeline scrubber out of the permanent 158px bottom row so the map and feed get 100% of the viewport height.
   - Placed a compact floating **Replay History & Studio** pill on the map (and a `History & Record` button in the header) that expands into the **Timeline & Recording Studio**.
   - **Custom Time Intervals**: Pick any `From` and `To` date or use quick presets (`Full Year`, `Last 30d`, `Last 90d`, `Aug–Oct Surge`, `October`, `⚓ Ship Strikes`) to filter the map, feed, and replay bounds.
   - **Download Your Own Recording**: Click **Record & Download Video** to render and download a self-contained 1280×720 `.webm`/`.mp4` video recording of the selected interval replay (complete with animated markers, ripples, date counter, live latest-headline ticker, and pentatonic + metallic bell audio), or export a **PNG snapshot** or **CSV dataset** of the selected interval.
