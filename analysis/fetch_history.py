"""Κατεβάζει όλο το ιστορικό των τριών WiFi datasets και το Μητρώο Σταθμών από το CKAN API
του Δήμου Αθηναίων και τα αποθηκεύει σε analysis/data/.

Χρήση:  python3 analysis/fetch_history.py
"""
import csv
import json
import pathlib
import urllib.parse
import urllib.request

BASE = 'https://opendata.cityofathens.gr/api/3/action/datastore_search'
RESOURCES = {
    'traffic': ('fa73f026-7a01-4d5c-9b8d-f13d176bf5fa', 'cumulative_traffic'),
    'visitors': ('1cdccaf9-c11b-4393-b3c7-cf9d3f78ad0f', 'highest_visitors'),
    'concurrent': ('4beed3ab-20d4-42b8-8d36-eb55030567b1', 'active_visitors'),
}
REGISTRY = 'c1514018-b420-46ea-939b-ea23fae5d7e0'
OUT = pathlib.Path(__file__).parent / 'data'


def search(**params):
    url = BASE + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': 'athens-realestate-pulse-analysis'})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.load(r)
    if not body.get('success'):
        raise RuntimeError(body.get('error'))
    return body['result']


def fetch_all(resource_id, fields, page=10000):
    rows, offset = [], 0
    while True:
        res = search(resource_id=resource_id, limit=page, offset=offset, fields=','.join(fields), sort='_id',
                     filters=json.dumps({'interval_type': 'OneDay'}) if 'date' in fields else '{}')
        rows += res['records']
        if len(res['records']) < page:
            return rows
        offset += page


def main():
    OUT.mkdir(exist_ok=True)
    daily = {}
    for name, (rid, metric) in RESOURCES.items():
        for r in fetch_all(rid, ['station_id', 'date', metric]):
            key = (int(r['station_id']), r['date'][:10])
            daily.setdefault(key, {})[name] = r[metric]
        print(name, 'ok')
    with open(OUT / 'daily.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['station_id', 'date', 'traffic', 'visitors', 'concurrent'])
        for (sid, d), v in sorted(daily.items()):
            w.writerow([sid, d, v.get('traffic'), v.get('visitors'), v.get('concurrent')])
    reg = search(resource_id=REGISTRY, limit=500)['records']
    with open(OUT / 'stations.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['station_id', 'station_name', 'neighbourhood', 'district', 'address'])
        for r in reg:
            w.writerow([r['station_id'], r['station_name'], r['neighbourhood_name'], r['municipal_district_id'], r['station_address']])
    print('γράφτηκαν', len(daily), 'ημέρες σταθμών και', len(reg), 'σταθμοί στο', OUT)


if __name__ == '__main__':
    main()
