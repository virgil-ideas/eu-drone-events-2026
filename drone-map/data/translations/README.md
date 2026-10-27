# Record copy translations

Each `<lang>.json` here holds one language's translation of the map's record
copy: the headline, the TL;DR description and the summary paragraphs. English
lives in `../pages.json` (or the automatic copy when a record has no reviewed
page). The interface strings are translated separately, in
`drone-map-revamp/i18n/<lang>.js`.

Every entry carries a `basis`, a hash of the English copy it was translated
from. When the English changes, the basis stops matching. The map then shows
English for that record until the translation is redone, and `todo` lists it
again. `python3 drone-map/scripts/build-data.py` writes the current
translations to `drone-map-revamp/i18n/pages/<lang>.js`, and the map loads that
file when a visitor picks the language.

```bash
python3 drone-map/scripts/translations.py status
python3 drone-map/scripts/translations.py todo ro --out drone-map/data/translations/parts/ro-todo.json
python3 drone-map/scripts/translations.py merge ro drone-map/data/translations/parts/ro-*.json
python3 drone-map/scripts/translations.py check
```

`parts/` is a scratch folder for work in progress and is not committed.

## How to translate a language

1. Run `todo LANG --out drone-map/data/translations/parts/LANG-todo.json` to
   get the English copy that still needs translating.
2. Translate it in batches of about 25 records. Write each batch to
   `drone-map/data/translations/parts/LANG-01.json`, `LANG-02.json` and so on.
   Each batch is an object keyed by record ID:
   `{"N095": {"headline": "…", "description": "…", "summary": ["…", "…"]}}`.
   Write only those three fields; `merge` adds the basis.
3. Run `merge LANG` with all the batch files, then `check`. `merge` refuses a
   batch with an unknown ID, an empty field or the wrong number of summary
   paragraphs.
4. Run `node drone-map/scripts/check-i18n.js --dir drone-map-revamp/i18n LANG`.
   Add every key it reports missing to `drone-map-revamp/i18n/LANG.js`,
   translated from `drone-map-revamp/i18n/en.js`, keeping each `{placeholder}`
   unchanged.

## Translation rules

The register's credibility rests on saying exactly what the sources say, no
more and no less.

- **Attribution and certainty stay exactly as strong as the English.**
  "Reported", "according to", "suspected", "likely", "assessed as",
  "unconfirmed", "not established" and "origin unknown" must keep the same
  degree of certainty. Never turn "reported Russian" into "Russian", and never
  add or drop a hedge.
- **No added or dropped facts.** Translate sentence by sentence, with one
  paragraph for each English paragraph, in the same order. Add no notes,
  explanations or translator remarks.
- **Keep unchanged:** record IDs (E033, N095), numbers and quantities, times,
  ship names (YARA J, KHORYV, WINE TRADER), drone model names (Geran-2, Shahed,
  Gerbera), and acronyms (NATO, MApN, VSAT). Translate a unit only when the
  language normally does.
- **Dates:** write them the way the language normally does, with month names
  in the language and the day and year unchanged.
- **Places:** use the name the language normally uses for countries, major
  cities and seas (Black Sea, Baltic, Constanța in its usual form). Keep small
  localities in their local spelling, with diacritics.
- **Terms:** use the outcome words from the language's interface file (`cat.*`
  and `class.*` keys) so the cards and the copy agree. Use the established
  local word for drone, UAV and unidentified object.
- **Style:** the headline reads as a concise news headline in the language. The
  description is the TL;DR and should stay about as short as the English,
  roughly 160 characters. Use the language's own quotation marks and
  punctuation, such as French spaces before `:` and `;`.
- **Format:** valid JSON in UTF-8. Escape `"` inside strings and use no
  trailing commas.
