# Europe Foreign Drone Events · 2026 (Revamped Edition)

This folder (`drone-map-revamp/`) is the production interface served at `droneincidents.eu`. The previous interface remains in `drone-map/dist/` for comparison and rollback; the canonical database remains in `drone-map/data/`.

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
every static event page. CI validates both interfaces and publishes
`drone-map-revamp/` to GitHub Pages on validated pushes to `main`.

The same build also generates `asset-manifest.json` and updates local script and
stylesheet URLs in `index.html` using hashes of their contents. No manual date
or cache-version changes are needed. Each page load checks a small uncached
manifest, then loads the versioned records, news sources, summaries and media.
Lazy language files use the same manifest, so a previously cached page can still
load new daily data and discard outdated translations. `--check` rejects stale
manifests or HTML asset URLs. Commit these generated changes with the data update.

## Social preview image

The image shown when someone shares the site is drawn by `og/card.html` from
the same data files as the map. It shows the 90-day trend, a map of the
records and the latest incident. The deploy job renders it to `og-image.png`
with headless Chrome before publishing, so each data update that reaches
`main` also updates the image. The PNG is not committed.

The build versions the `og:image` URL with a hash of the card's inputs.
Facebook, LinkedIn and X cache previews by URL, so they fetch the new image
once the data changes. To preview the card, open
<http://127.0.0.1:4174/og/card.html> at 1200×630, or render it:

```sh
python3 drone-map-revamp/og/render.py
```

The script needs Chrome (`google-chrome`, `chromium` or the macOS app, or set
`CHROME`) and network access for the Google Fonts the card uses. It fails
rather than publish a card drawn in fallback fonts.

Recording pauses automatically when its tab is hidden, including unfinished audio tails,
and resumes from the same date when the tab becomes visible again. Map framing accounts
for the open studio; event stepping follows the selected country, outcome and date filters.

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

2. **Spotlight: "When Things Took a Dark Turn" — Black Sea Maritime Escalation**
   - The banner, dialog, filter and replay share one selection of Romanian and Bulgarian shipping records from 5 October onward. Their end date is the latest included ship incident, and their count is the number of records, not drones or vessels. Dates and counts are localized in all interface languages.
   - New records using the database’s existing `reported_offshore_drone_strike`, `reported_maritime_drone_strike` or `suspected_maritime_drone_attack` types are included automatically. The three legacy summer shipping records (E033, E034, E053) remain in the dialog as precursors. Excluded records, offshore debris and platform incidents are omitted from this shipping selection.
   - The ordinary database build is sufficient; no interface ID, date or translated-text edits are needed for later shipping additions. Territorial-water labels still come only from the explicit jurisdiction qualifier. Existing casualty badges remain separately curated; inclusion as a ship incident does not imply casualties or establish an attacker.

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
