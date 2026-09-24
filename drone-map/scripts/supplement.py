"""Import canonical supplement tables once, preserving their stable IDs and fields."""
import re
from collections import Counter
from datetime import date

FIELDS = ['id', 'importAction', 'recordType', 'dateLabel', 'startDate', 'endDate',
          'countries', 'normalizedLocality', 'dateBasis', 'location', 'status',
          'categories', 'vehicle', 'attribution', 'route', 'circumstances',
          'payload', 'impact', 'response', 'uncertainty', 'deduplication',
          'provenance', 'sourceReferences']
CLASSES = {'ADD_EVENT': 'event', 'ADD_ALERT': 'alert',
           'ADD_DAILY_REPORT': 'daily', 'KEEP_CANDIDATE': 'candidate'}

# Approximate locality/region anchors, never incident coordinates. Lithuanian
# villages without verified geocoding use the stated district, not guessed sites.
# IDs | lat | lng | precision | display outcome
ANCHORS = '''
N004 N005 N012 N036 N053 N059|54.29|25.39|region|flight
N011 N049|54.29|25.39|region|crash
N010|54.22|24.57|region|flight
N015|48.14|11.58|region|flight
N023|40.22|25.42|region|flight
N028|42.50|27.68|offshore|disposal
N029|43.36|28.47|locality|recovery
N030|42.41|27.73|offshore|disposal
N031|42.31|27.81|offshore|disposal
N032|42.56|27.64|locality|recovery
N033|43.40|28.29|region|alert
N035|43.37|28.48|offshore|recovery
N038|44.35|28.69|locality|disposal
N040|42.39|27.70|locality|recovery
N042|44.34|29.75|offshore|recovery
N043|45.03|29.63|region|recovery
N044|44.51|28.85|region|disposal
N045|44.74|29.09|region|disposal
N046|45.35|29.55|region|alert
N050|52.00|19.00|region|alert
N051|45.30|29.30|region|alert
N052|56.06|24.40|region|recovery
N055|40.47|25.84|locality|flight
N062|44.29|28.62|locality|recovery
N063|44.40|28.70|locality|recovery
'''


def import_supplement(path):
    text = path.read_text(encoding='utf-8')
    urls = dict(re.findall(r'^\[([^\]]+)\]:\s*(https?://\S+)', text, re.M))
    anchors = {}
    for line in ANCHORS.strip().splitlines():
        ids, lat, lng, precision, category = line.split('|')
        for record_id in ids.split():
            assert record_id not in anchors
            anchors[record_id] = (float(lat), float(lng), precision, category)

    def refs(value):
        result = list(dict.fromkeys(re.findall(r'\[([A-Z][A-Z0-9]+)\]', value)))
        assert all(ref in urls for ref in result), result
        return result

    records, contexts, sources, manifest = [], [], {}, {}
    for line in text.splitlines():
        if not line.startswith('| '):
            continue
        cells = [cell.strip() for cell in line.split('|')[1:-1]]
        if len(cells) == len(FIELDS) and re.fullmatch(r'N\d{3}', cells[0]):
            record = dict(zip(FIELDS, cells))
            record['recordClass'] = CLASSES[record['importAction']]
            record['sources'] = refs(record['sourceReferences'])
            record['sourceFile'] = path.name
            record['title'] = record['normalizedLocality']
            if record['recordClass'] == 'daily':
                lat, lng, precision, category = 38.0, 25.5, 'region', 'flight'
                record['title'] = 'Aegean · ' + ('FIR-only daily report' if record['recordType'] == 'fir_only_daily_report' else 'claimed-airspace daily report')
                record['positionNote'] = 'Representative Aegean reporting-area anchor, not a flight track or an airspace boundary. One daily report may describe several aircraft or crossings.'
                record['classificationNote'] = 'Daily activity bulletin, kept separate from individual-event records. FIR procedure infringements alone do not establish entry into sovereign airspace; airspace claims remain attributed to the Greek account.'
            else:
                lat, lng, precision, category = anchors[record['id']]
                record['positionNote'] = ''
                record['classificationNote'] = ''
            record['category'] = category
            record['positions'] = [dict(lat=lat, lng=lng, precision=precision, label=record['normalizedLocality'])]
            stages = [category]
            if record['recordType'] == 'cross_border_seizure':
                stages += ['flight', 'recovery']
                district = 'Varėna' if record['id'] == 'N010' else 'Šalčininkai'
                record['positionNote'] = f'Representative {district} district anchor; the named village or linked recovery sites have not been geocoded. Linked detection and recovery remain one record.'
                record['classificationNote'] = ('Electronic counter-drone intervention and seizure. The reported damaged/crashed craft determines the crash color.' if category == 'crash' else 'Electronic counter-drone intervention and seizure; forced descent alone is not classified as a kinetic shoot-down or a confirmed crash.')
            if record['recordType'] == 'discovery_recovery':
                stages += ['recovery']
            if category == 'disposal':
                record['classificationNote'] = 'Controlled disposal by authorities after discovery; kept separate from incident explosions. Replay uses the discovery date, with any later disposal retained as a linked stage.'
            if record['id'] == 'N015':
                record['positionNote'] = 'Representative Munich city anchor; the reported defence-manufacturer site is not precisely located here.'
            if record['id'] == 'N023':
                record['classificationNote'] = 'Fighter identification/interception is reported, with no firing or shoot-down. The civil-flight precaution is part of the same encounter.'
            if record['id'] == 'N042':
                record['positionNote'] = 'Approximate anchor derived from the reported area 46 nautical miles east of Midia, outside the territorial sea. This was aerial-drone debris, not a maritime drone.'
            if record['id'] == 'N050':
                record['positionNote'] = 'Representative national anchor; the patrol areas and tracks were not published.'
            if record['id'] == 'N052':
                record['positionNote'] = 'Representative Pasvalys district anchor; the Keneliai forest discovery site has not been geocoded.'
            record['stages'] = list(dict.fromkeys(stages))
            records.append(record)
        elif len(cells) == 7 and re.fullmatch(r'NA\d{3}', cells[0]):
            contexts.append(dict(id=cells[0], importAction=cells[1], countries=cells[2],
                                 dateLabel=cells[3], vehicle=cells[4], deduplication=cells[5],
                                 sourceReferences=cells[6], sources=refs(cells[6]),
                                 status='Aggregate / pattern context', attribution='', uncertainty='',
                                 sourceFile=path.name))
        elif len(cells) == 4 and cells[0] in urls:
            title = re.search(r'\[([^\]]+)\]\[[^\]]+\]', cells[3])
            sources[cells[0]] = dict(id=cells[0], publisher=cells[1], dateLabel=cells[2],
                                    title=title.group(1) if title else cells[3], audit=cells[3], url=urls[cells[0]])
        elif len(cells) == 5 and re.fullmatch(r'N\d{3}', cells[0]):
            assert cells[0] not in manifest
            manifest[cells[0]] = dict(action=cells[1], recordType=cells[2], matchKey=cells[3])

    assert len(records) == 63 and len(contexts) == 4 and len(sources) == 74
    assert {record['id'] for record in records} == {f'N{i:03}' for i in range(1, 64)}
    assert len({record['id'] for record in records}) == len(records)
    assert Counter(r['recordClass'] for r in records) == {'event': 27, 'alert': 3, 'daily': 32, 'candidate': 1}
    assert set(manifest) == {r['id'] for r in records}
    assert len({r['matchKey'] for r in manifest.values()}) == len(manifest)
    for record in records:
        entry = manifest[record['id']]
        assert entry['action'] == record['importAction'] and entry['recordType'] == record['recordType']
        record['matchKey'] = entry['matchKey']
        assert date.fromisoformat(record['startDate']) <= date.fromisoformat(record['endDate']) <= date(2026, 9, 24)
    assert all(record['sources'] and all(ref in sources for ref in record['sources']) for record in records + contexts)
    return records, contexts, sources
