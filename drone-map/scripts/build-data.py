"""Preserve the supplied register verbatim; add explicitly approximate map anchors."""
import json
import re
import shutil
from pathlib import Path
from supplement import import_supplement

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'eu_foreign_drone_events_2026_consolidated.md'
SUPPLEMENT = ROOT.parent / 'eu_foreign_drone_events_2026_final_update_deduped.md'
text = SOURCE.read_text(encoding='utf-8')
fields = ['id', 'dateLabel', 'dateBasis', 'countries', 'location', 'status',
          'categories', 'vehicle', 'attribution', 'route', 'circumstances',
          'payload', 'impact', 'response', 'uncertainty', 'deduplication',
          'provenance', 'sourceReferences']

# These are editorial map anchors, not sourced incident coordinates. Regional
# anchors deliberately retain the register's geographic uncertainty.
# id | short place | latitude | longitude | precision | display category
anchors_text = '''
E001|Przasnysz|53.02|20.88|locality|flight
E002|Sfântu Gheorghe · Sulina|45.02|29.65|region|flight
E003|Öresund, near Malmö|55.61|12.86|region|flight
E004|Konin area|52.23|18.30|region|recovery
E005|Lake Lavysas|54.17|24.47|locality|flight
E006|Auvere power station|59.27|27.90|locality|flight
E007|Krāslava region|55.90|27.17|region|flight
E008|Eastern Latvia|56.30|27.70|region|flight
E009|Kouvola area|60.90|26.70|region|flight
E010|Tartu County · Finnish border|58.38|26.73|region|alert
E011|Bariera Traian, Galați|45.47|28.04|locality|flight
E012|Văcăreni|45.33|28.20|locality|recovery
E013|Luncavița · Văcăreni|45.32|28.25|region|recovery
E014|Șerbăuți|47.83|26.01|locality|recovery
E015|Virolahti|60.58|27.71|region|flight
E016|Balvi · Ludza · Rēzekne|56.60|27.37|region|flight
E017|Lefkada|38.73|20.65|region|maritime
E018|Helsinki metropolitan area|60.22|24.96|region|alert
E019|Samanė · Utena area|55.50|25.60|region|recovery
E020|Latvian–Russian border|56.80|27.70|region|flight
E021|Põltsamaa area|58.65|25.97|region|flight
E022|Eastern Latvia|56.50|27.30|region|alert
E023|Vilnius|54.69|25.28|region|alert
E024|Latvia's eastern border|56.30|27.80|region|flight
E025|Utena County|55.53|25.61|region|alert
E026|Lake Drīdzis|55.97|27.27|locality|flight
E027|Šalčininkai border district|54.29|25.39|region|flight
E028|Mazepa, Galați|45.42|28.04|locality|flight
E029|Latvian · Estonian border regions|56.80|27.70|region|alert
E030|Constanța port and offshore|44.13|28.69|region|maritime
E031|Bērzgale|56.63|27.51|locality|flight
E032|Rachelu|45.29|28.33|locality|recovery
E033|Off Sfântu Gheorghe|44.80|29.79|offshore|maritime
E034|Black Sea · Romanian EEZ|44.69|29.91|offshore|maritime
E035|Padina · Pogoanele|44.88|27.06|region|flight
E036|Tulcea coastal sector|44.95|29.56|region|flight
E037|Northeast of Sulina|45.23|29.81|offshore|flight
E038|Southeastern Romania|44.70|28.40|region|flight
E039|Periprava · Sulina branch|45.40|29.55|region|flight
E040|Leipzig/Halle Airport|51.42|12.22|locality|flight
E041|Western Germany · site unspecified|51.00|7.00|region|flight
E042|Kardam|43.73|28.11|locality|flight
E043|Neptun Deep · aerial wreckage|44.30|30.76|offshore|recovery
E044|Rugāji|57.00|27.13|locality|flight
E045|Băleni · Cudalbi|45.88|27.80|region|flight
E046|Northeast of Grindu|45.43|28.25|locality|flight
E047|Neptun Deep · maritime drone|44.15|30.51|offshore|maritime
E048|Tuzla beach|43.99|28.68|locality|recovery
E049|Off Gura Portiței|44.69|29.03|offshore|recovery
E050|Ciușlea|45.78|27.38|locality|flight
E051|Constanța Casino promenade|44.17|28.67|locality|recovery
E052|Olimp beach|43.89|28.61|locality|recovery
E053|Off Sfântu Gheorghe · Progress IV|44.77|29.89|offshore|maritime
E054|Viișoara, Vaslui|46.38|27.89|locality|recovery
E055|Southern Finnish coast|60.10|25.00|region|recovery
E056|Neamț · Botoșani · Iași sector|47.40|26.80|region|flight
E057|Rusinowo · Jarosławiec coast|54.52|16.52|locality|recovery
E058|Lithuania · near Pratkūnai|55.30|25.50|region|flight
E059|Solca|47.70|25.85|locality|flight
E060|Chilia branch|45.37|29.19|region|flight
E061|Costinești beach|43.95|28.64|locality|recovery
E062|Saturn beach|43.83|28.60|locality|recovery
E063|Northern Tulcea · Măcin Mountains|45.24|28.25|region|flight
E064|Plauru|45.33|28.80|locality|recovery
E065|Off Tyulenovo · unidentified object|43.49|28.59|locality|recovery
E066|Primorsko beach|42.27|27.76|locality|recovery
E067|Lozenets beach|42.21|27.81|locality|recovery
E068|Albena · Kranevo|43.36|28.07|region|recovery
E069|Rakitnika|43.12|27.93|locality|recovery
E070|Tsarevo · Varvara|42.14|27.88|region|recovery
E071|Kamchia coast|43.02|27.90|locality|recovery
E072|Kabakum beach|43.25|28.03|locality|recovery
E073|Off Pomorie|42.56|27.68|offshore|recovery
E074|Pasha Dere|43.11|27.94|locality|recovery
E075|Northeast of Cape Galata|43.19|27.99|offshore|recovery
E076|Golden Sands · Laguna|43.29|28.05|locality|recovery
E077|Northern Burgas beach|42.52|27.49|locality|recovery
E078|South of Kavarna|43.30|28.34|offshore|recovery
E079|Kamchia · Black Sea|43.02|27.93|offshore|recovery
E080|Chernomorets|42.45|27.64|locality|recovery
E081|Sozopol · Sveti Ivan island|42.43|27.69|locality|recovery
E082|North of Shabla Lighthouse|43.55|28.61|locality|recovery
E083|Ahtopol · Bungalata beach|42.11|27.94|locality|recovery
E084|North of Snake Island|45.55|30.20|offshore|alert
'''
anchors = {}
for line in anchors_text.strip().splitlines():
    key, title, lat, lon, precision, category = line.split('|')
    anchors[key] = dict(title=title, category=category, positions=[{
        'lat': float(lat), 'lng': float(lon), 'precision': precision,
        'label': title,
    }])
# Multi-country records retain one record ID and multiple regional anchors.
anchors['E010']['positions'].append(dict(lat=61.0, lng=28.2, precision='region', label='Finnish border area · unspecified site'))
anchors['E029']['positions'].append(dict(lat=58.5, lng=27.2, precision='region', label='Eastern Estonia · unspecified tracks'))
anchors['E058']['positions'][0]['label'] = 'Representative Lithuania position; Pratkūnai site not geocoded'

# Outcome labels were reviewed against the original categories, circumstances
# and response fields. Do not infer detonations from payloads, fires, negated
# shoot-downs, failed charges, or explosions outside the mapped incident.
outcome_groups = {
    'flight': 'E002 E003 E008 E015 E020 E024 E027 E038 E039 E040 E041 E056 E060',
    'shotdown': 'E021 E031 E035 E036 E037 E044 E045 E058',
    'engaged': 'E047',
    'crash': 'E001 E006 E007 E009 E011 E016 E046 E050 E059 E063',
    'explosion': 'E005 E026 E028 E030 E033 E042',
    'disposal': 'E013 E017 E032 E043 E048 E049 E052 E054 E064 E073 E074 E081',
    'recovery': 'E004 E012 E014 E019 E051 E055 E057 E061 E062 E065 E066 E067 E068 E069 E070 E071 E072 E075 E076 E077 E078 E079 E080 E082 E083',
    'alert': 'E010 E018 E022 E023 E025 E029 E034 E053 E084',
}
outcomes = {record_id: category for category, ids in outcome_groups.items() for record_id in ids.split()}
assert len(outcomes) == sum(len(ids.split()) for ids in outcome_groups.values()) == 84
assert set(outcomes) == set(anchors)
classification_notes = {
    'E014': 'A discovery record; the original crash time is unknown.',
    'E019': 'Wreckage and explosives were discovered; a same-day crash or explosion is not established.',
    'E027': 'Forced landing and seizure; the register does not describe a kinetic shoot-down or crash.',
    'E034': 'Ship impact reported; mine versus drone and the explosive mechanism remain unresolved.',
    'E039': 'Interception and debris fall are reported; the record does not explicitly establish a kinetic shoot-down.',
    'E040': 'Attempted explosive attack: the main charge failed. The separate aircraft collision was suspected.',
    'E047': 'The supplied Observator footage appears to show the maritime drone approaching the platform. This is a visual interpretation of the footage, rather than a verified track. F-16 cannon fire hit and damaged the explosive drone, then Navy EOD neutralized it. The military engagement determines the map color; disposal was the subsequent stage.',
    'E053': 'Fire and sinking were reported; an explosion or drone strike is not established.',
    'E060': 'Explosions were reported after departure; no Romanian impact is established.',
}

events, contexts, sources = [], [], {}
urls = dict(re.findall(r'^\[(S\d+)\]:\s*(https?://\S+)', text, re.M))
for line in text.splitlines():
    if not line.startswith('| '):
        continue
    cells = [cell.strip() for cell in line.split('|')[1:-1]]
    if len(cells) == 18 and re.fullmatch(r'[EA]\d{3}', cells[0]):
        record = dict(zip(fields, cells))
        record['sources'] = list(dict.fromkeys(re.findall(r'\[(S\d+)\]', record['sourceReferences'])))
        if record['id'].startswith('E'):
            # First reported date drives replay; full date basis stays visible.
            record['startDate'] = re.search(r'2026-\d{2}-\d{2}', record['dateLabel']).group()
            record.update(anchors[record['id']])
            record['category'] = outcomes[record['id']]
            stages = [record['category']]
            if re.search(r'\bincursions?\b|overflight|unauthorized flight|cross-border transit', record['categories'], re.I):
                stages.append('flight')
            if record['id'] in {'E005', 'E026', 'E028', 'E042'}:
                stages.append('crash')
            if record['id'] in {'E011', 'E047', 'E063'}:
                stages.append('disposal')
            if 'recovery' in record['categories'].lower():
                stages.append('recovery')
            record['stages'] = list(dict.fromkeys(stages))
            record['classificationNote'] = classification_notes.get(record['id'], '')
            if record['category'] == 'disposal':
                record['classificationNote'] = (record['classificationNote'] + ' Controlled disposal by authorities; kept separate from incident explosions.').strip()
            events.append(record)
        else:
            contexts.append(record)
    if len(cells) == 4 and re.match(r'\[S\d+\]', cells[0]):
        source_id = re.search(r'S\d+', cells[0]).group()
        sources[source_id] = dict(id=source_id, publisher=cells[1], title=cells[2], audit=cells[3], url=urls[source_id])

events.sort(key=lambda item: (item['startDate'], item['id']))
assert len(events) == 84 and len(contexts) == 4 and len(sources) == 93
assert {e['id'] for e in events} == set(anchors)
assert all(ref in sources for e in events + contexts for ref in e['sources'])
for record in events:
    record['recordClass'] = 'event'
    record['sourceFile'] = SOURCE.name
new_events, new_contexts, new_sources = import_supplement(SUPPLEMENT)
assert not (set(sources) & set(new_sources))
# The requested map view includes event additions and the unidentified object.
# Supplementary alerts/daily bulletins remain in the unchanged source download.
events.extend(record for record in new_events if record['recordClass'] in {'event', 'candidate'})
contexts.extend(new_contexts)
sources.update(new_sources)
events.sort(key=lambda item: (item['startDate'], item['id']))
assert len(events) == len({e['id'] for e in events}) == 112
assert sum(e['recordClass'] == 'event' for e in events) == 111
data = dict(events=events, contexts=contexts, sources=sources, cutoff='2026-09-24',
            sourceFiles=[SOURCE.name, SUPPLEMENT.name])
(ROOT / 'dist' / 'events.js').write_text('window.DRONE_DATA = ' + json.dumps(data, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
shutil.copyfile(SOURCE, ROOT / 'dist' / SOURCE.name)
shutil.copyfile(SUPPLEMENT, ROOT / 'dist' / SUPPLEMENT.name)
print(f'Imported {len(events)} dated records, {len(contexts)} context records and {len(sources)} sources.')
