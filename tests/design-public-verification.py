"""Public static GETs only. No credentials or business data."""
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'https://omanvilla.github.io/habib-crm/'
VERSION = '20261020-design-v14'
index = (ROOT / 'index.html').read_text()
paths = ['index.html'] + list(dict.fromkeys(re.findall(r'([A-Za-z0-9_.-]+\.(?:html|css|js)\?v=[A-Za-z0-9_-]+)', index)))
assert len(paths) == 24, paths
assert 'src="modern-v17.js' not in index
assert 'src="instagram-crm.js' not in index

def inspect(path):
    name = path.split('?', 1)[0]
    url = BASE + ('' if name == 'index.html' else path)
    req = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'HabibCRM-ReleaseVerification/1.0'})
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read()
        item = {'file': name, 'url': url, 'final_url': response.url,
                'status': response.status, 'etag': response.headers.get('ETag'),
                'served_sha256': hashlib.sha256(body).hexdigest(),
                'expected_sha256': hashlib.sha256((ROOT / name).read_bytes()).hexdigest()}
    item['matches'] = item['status'] == 200 and item['served_sha256'] == item['expected_sha256']
    if name == 'index.html':
        item['app_version'] = re.search(r'<meta name="app-version" content="([^"]+)"', body.decode()).group(1)
    return item

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    assets = list(pool.map(inspect, paths))
out = ROOT / 'public-verification'
out.mkdir(exist_ok=True)
report = {'checked_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'runtime_commit': 'd49357224002fff16d0c194013256d15e9cc8c57', 'version': VERSION,
          'url': BASE, 'assets': assets, 'all_match': all(x['matches'] for x in assets)}
(out / 'assets.json').write_text(json.dumps(report, indent=2))
print(json.dumps({'version': assets[0]['app_version'], 'assets': len(assets), 'all_match': report['all_match']}))
assert assets[0]['app_version'] == VERSION
assert report['all_match'], [x for x in assets if not x['matches']]
