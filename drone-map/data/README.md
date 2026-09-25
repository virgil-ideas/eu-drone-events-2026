# Canonical event database

These JSON files are the source of truth for the map. They are maintained in Git;
no database server, credentials or third-party Python packages are required.

| File | Contents |
| --- | --- |
| `events.json` | Individual events and the unidentified-object candidate, including approximate map anchors, outcome stages, uncertainty and source IDs. Ordered by stable ID for editing. |
| `sources.json` | Shared bibliography keyed by source ID: publisher, title, URL, audit notes and the publication-date label when known. |
| `contexts.json` | Non-additive aggregate/context records. Never counted or mapped as individual events. |
| `dataset.json` | Schema version, inclusive reporting cutoff and the filenames/SHA-256 hashes of archived research. |

The original Markdown files at the repository root are research snapshots, not
editable database inputs. Keep them unchanged. Supplementary daily reports and
precautionary alerts remain in those snapshots; they are not mapped events.

The migration preserved all 112 mapped records, eight context records, 169 sources
and 114 anchors, including the reviewed Solca and Neptun Deep classifications.
Those are migration totals, not hard-coded limits. All browser record fields were
compared with the previous export; no research claims or locations changed.

## Make an update

1. Read the existing event and its source reports. A follow-up, recovery or disposal
   of the same drone usually updates the existing record rather than creating a
   second occurrence. Keep the event ID stable.
2. Add genuinely new source reports to `sources.json` using an unused stable ID.
   Link their IDs in the event's `sources` array. Reuse existing source IDs when
   citing the same report; unused bibliography entries are allowed.
3. Edit the event directly in `events.json`. Update its uncertainty, attribution,
   classification notes and provenance as needed; add/update `reviewedOn` with the
   review date. There is no overrides file. Git records the change and author.
4. For a new event, use an unused `E###` or `N###` ID. Do not renumber existing
   records or fill gaps without checking the research: some N IDs belong to
   excluded daily reports and alerts. Add an explicit approximate anchor and
   review the outcome stages. Do not copy the previous event's `matchKey`,
   `importAction`, `normalizedLocality` or `sourceFile`; these are optional legacy
   research metadata, not required for a new directly sourced record.
5. Advance `dataset.json.cutoff` if the reporting window has grown. Dates must
   remain within the calendar year of that cutoff. For new research snapshots,
   add a new Markdown file at the repository root and register its filename/hash;
   do not replace or rehash an old snapshot to accommodate an accidental edit.
6. From the repository root, run:

   ```sh
   python3 drone-map/scripts/build-data.py
   python3 -m unittest discover -s drone-map/tests -v
   python3 drone-map/scripts/build-data.py --check
   ```

7. Review and commit the JSON changes with the generated `drone-map/dist/events.js`.
   Preview the map locally for editorial changes. Pull requests run the checks;
   a validated push to `main` also publishes to GitHub Pages.

To compute a new research file's hash: `shasum -a 256 filename.md`.
To validate without building: `python3 drone-map/scripts/database.py`.
`--check` never writes files and fails if any generated export/download is stale.
All inputs are validated before the builder writes its outputs.

## Record schema (version 1)

The executable schema lives in `scripts/database.py`. Unknown fields are rejected
to catch misspelled keys. Change the schema deliberately when extending it.

Required event fields:

| Fields | Meaning |
| --- | --- |
| `id`, `title` | Stable ID and short map/list title. |
| `recordClass` | `event` or `candidate`; daily summaries and precautionary alerts are excluded. |
| `startDate`, `dateLabel`, `dateBasis` | ISO replay date, original human-readable date/range, and explanation of the date used. Optional ISO `endDate` preserves an explicit range. |
| `countries`, `location` | Original country names (semicolon-separated for multiple countries) and detailed location/scope. |
| `status`, `categories` | Research wording for status and incident types. These do not automatically determine the map color. |
| `category`, `stages` | Reviewed map color category and unique outcome stages; the first stage must equal `category`. |
| `positions` | One or more `{lat, lng, precision, label}` anchors. Precision is `locality`, `region` or `offshore`; all remain approximate. Multiple anchors still count as one event. |
| `vehicle`, `attribution`, `route`, `circumstances`, `payload` | Reported details; distinguish an observed route from operator or target attribution. |
| `impact`, `response`, `uncertainty` | Reported effects, response and limits of the evidence. Use explicit unknown/unconfirmed wording when appropriate. |
| `deduplication`, `provenance`, `classificationNote` | Counting rationale, origin/review notes and explanation of the outcome classification. `classificationNote` can be empty. |
| `sources` | Non-empty list of unique IDs present in `sources.json`. The browser's `sourceReferences` text is generated from this list, never maintained separately. |

Outcome values are `flight`, `shotdown`, `engaged`, `crash`, `explosion`, `disposal`,
`recovery`, and `alert`. Controlled disposal is separate from an incident
explosion. A fighter launch alone does not establish a shoot-down. Confidence and
attribution remain source-backed prose; the database does not infer them.

Optional event fields: `endDate`, `recordType`, `positionNote`, `reviewedOn`,
`sourceFile`, and the retained research fields `importAction`, `normalizedLocality`,
`matchKey`. Research match keys must be unique when present. `reviewedOn` is an
editorial date and can be later than the event cutoff. `sourceFile`, when present,
must name a registered research snapshot.

Sources require `id` (matching their object key), `publisher`, `title`, `url` and
`audit`. Optional `dateLabel` preserves a publication-date label, including ranges
and later updates. Missing publication dates are not guessed.

Contexts require `id` (`A###` or `NA###`), `dateLabel`, `countries`, `status`,
`vehicle`, `attribution`, `uncertainty`, `deduplication` and `sources`. They can also
carry the descriptive research fields, `sourceFile`, `reviewedOn` and legacy
`importAction`. They have no map positions or replay date.

## Generated files and checks

`scripts/build-data.py` reads and validates the four files together, sorts events
by replay date and ID, generates `dist/events.js`, and copies archived research
byte for byte for download. The browser contract is unchanged. The media fetcher
also reads the canonical database, so it cannot silently use a stale map export.

Validation checks duplicate JSON keys and record IDs, required/unknown fields,
calendar dates/ranges/cutoff, category/stage consistency, finite coordinate ranges,
duplicate anchors within a record, source references and HTTP(S) URLs, and research
file hashes. It does not infer whether two differently identified reports describe
the same real-world incident, verify the truth of a claim, or fetch source URLs.
Editorial review is still required for those decisions.
