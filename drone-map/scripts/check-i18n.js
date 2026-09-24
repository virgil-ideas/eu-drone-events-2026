// Validate interface translations against the English strings:
// same keys, same {placeholders}, and every plural category the language uses.
// Usage: node scripts/check-i18n.js [lang ...]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LANGUAGES = 'bg cs da de el en es et fi fr ga hr hu it lt lv mt nl pl pt ro sk sl sv'.split(' ');
const dir = path.join(__dirname, '..', 'dist', 'i18n');
const sandbox = {window: {}};
vm.createContext(sandbox);
const load = lang => vm.runInContext(fs.readFileSync(path.join(dir, `${lang}.js`), 'utf8'), sandbox, {filename: `${lang}.js`});
load('en');
const en = sandbox.window.DRONE_I18N.en;
const placeholders = text => new Set(text.match(/\{\w+\}/g) || []);
const same = (a, b) => a.size === b.size && [...a].every(item => b.has(item));

let failures = 0;
const fail = (lang, message) => { failures++; console.error(`${lang}: ${message}`); };
const requested = process.argv.slice(2);
for (const lang of requested.length ? requested : LANGUAGES) {
  if (!LANGUAGES.includes(lang)) { fail(lang, 'not an official EU language code'); continue; }
  if (!fs.existsSync(path.join(dir, `${lang}.js`))) { fail(lang, 'file missing'); continue; }
  try { load(lang); } catch (error) { fail(lang, `does not parse: ${error.message}`); continue; }
  const strings = sandbox.window.DRONE_I18N[lang];
  if (!strings) { fail(lang, `does not assign window.DRONE_I18N.${lang}`); continue; }
  const categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
  for (const key of Object.keys(strings)) if (!(key in en)) fail(lang, `unknown key ${key}`);
  for (const [key, source] of Object.entries(en)) {
    const value = strings[key];
    if (value === undefined) { fail(lang, `missing ${key}`); continue; }
    if (typeof source === 'string') {
      if (typeof value !== 'string' || !value.trim()) { fail(lang, `${key} must be a non-empty string`); continue; }
      if (!same(placeholders(source), placeholders(value))) fail(lang, `${key} placeholders ${[...placeholders(value)]} ≠ ${[...placeholders(source)]}`);
      continue;
    }
    if (!value || typeof value !== 'object') { fail(lang, `${key} must be a plural object`); continue; }
    const expected = placeholders(source.other);
    for (const category of categories) {
      if (typeof value[category] !== 'string' || !value[category].trim()) { fail(lang, `${key}.${category} missing`); continue; }
      const found = placeholders(value[category]);
      // Singular-like forms may spell out the number; all other names are required.
      const required = new Set([...expected].filter(name => name !== '{n}' || category === 'other' || category === 'many' || category === 'few'));
      if (![...found].every(name => expected.has(name)) || ![...required].every(name => found.has(name))) fail(lang, `${key}.${category} placeholders ${[...found]} ≠ ${[...expected]}`);
    }
    for (const category of Object.keys(value)) if (!categories.includes(category)) fail(lang, `${key}.${category} is not a plural category for ${lang}`);
  }
}
if (failures) { console.error(`${failures} problem(s)`); process.exit(1); }
console.log(`Checked ${requested.length || LANGUAGES.length} language file(s).`);
