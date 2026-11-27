# Working on the drone-incident register

The site at droneincidents.eu is `drone-map-revamp/`. Its data comes from the
canonical JSON database in `drone-map/data/`. Read
[drone-map/data/README.md](drone-map/data/README.md) before editing records.

## Daily update checklist

Do every step in the same update. The map shows whatever is committed to `main`.

1. **Records.** Add or update events and sources as described in "Make an
   update" in the data guide. Advance `dataset.json` `cutoff` when the reporting
   window grows.
2. **Ship incidents.** For a ship hit, attack, capsizing or grounding off Romania
   or Bulgaria, start `countries` with `Romania` or `Bulgaria` and use one of
   these `recordType` values: `reported_offshore_drone_strike`,
   `reported_maritime_drone_strike`, `suspected_maritime_drone_attack`,
   `unconfirmed_offshore_drone_strike`, `drone_damaged_vessel_grounding`. The
   Black Sea escalation banner, its filter chip, the "Ship incidents" preset and
   the escalation replay all pick these up automatically, with their dates and
   counts. With any other type or country, the escalation stops at the last ship
   record it recognises. Write `(territorial waters)` in `countries` only when a
   source establishes it.
3. **Casualties.** Set `"casualties": true` on any record whose sources report
   deaths, injuries or missing people (crew or civilians), and remove it if a
   correction removes them all. It drives the "Casualties / Missing" badge. Put
   the figures themselves in `impact`.
4. **Reviewed copy.** Write the headline, TL;DR and summary for each new record
   in `drone-map/data/pages.json` and stamp it. `python3 drone-map/scripts/pages.py`
   lists the records still on automatic copy.
5. **Translations.** Translate every new or changed record into all 23 other
   languages, following
   [drone-map/data/translations/README.md](drone-map/data/translations/README.md).
   Visitors reading the map in another language otherwise see English cards. Before
   you commit, `python3 drone-map/scripts/translations.py status` must show
   `0 stale, 0 missing` for every language. CI warns when it does not.
6. **Build and check.** Run the same commands as CI (`.github/workflows/pages.yml`):

   ```sh
   python3 drone-map/scripts/build-data.py
   python3 -m unittest discover -s drone-map/tests -v
   python3 drone-map/scripts/build-data.py --check
   python3 drone-map/scripts/translations.py check
   python3 -m unittest discover -s drone-map-revamp/tests -v
   node --test drone-map/tests/test_trend.cjs drone-map-revamp/tests/*.cjs
   node drone-map/scripts/check-i18n.js --dir drone-map-revamp/i18n
   ```

7. **Commit** the JSON changes together with every generated file the build
   touched (`drone-map/dist/`, `drone-map-revamp/`). Asset versions, the record
   pages and the social preview image update themselves; the image is rendered
   when `main` deploys.

## Interface text

Every visible interface string lives in `drone-map-revamp/i18n/<lang>.js` for all
24 languages. Add new keys to `en.js` and translate them into the other 23 files;
`check-i18n.js` lists any that are missing. Record fields shown in the raw record
details and cited article titles stay in their original language.

## Licence

Text, data, images and code are CC BY 4.0 (see [LICENSE.md](LICENSE.md)). Commit
messages carry no AI co-author trailers.
