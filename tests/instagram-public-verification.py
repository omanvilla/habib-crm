"""One-time unauthenticated release verification, not scheduled monitoring."""
import concurrent.futures, datetime, hashlib, json, pathlib, re, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE='https://omanvilla.github.io/habib-crm/'
VERSION='20261021-instagram-v16'
index=(ROOT/'index.html').read_text()
paths=['index.html']+list(dict.fromkeys(re.findall(r'([A-Za-z0-9_.-]+\.(?:html|css|js)\?v=[A-Za-z0-9_-]+)',index)))
assert len(paths)==26,paths

def check(path):
 name=path.split('?',1)[0]
 url=BASE+('' if name=='index.html' else path)
 request=urllib.request.Request(url,headers={'Cache-Control':'no-cache','User-Agent':'HabibCRM-ReleaseVerification/1.0'})
 with urllib.request.urlopen(request,timeout=30) as response:
  body=response.read()
  result={'file':name,'url':url,'status':response.status,'served_sha256':hashlib.sha256(body).hexdigest(),'expected_sha256':hashlib.sha256((ROOT/name).read_bytes()).hexdigest()}
 result['matches']=result['status']==200 and result['served_sha256']==result['expected_sha256']
 if name=='index.html':result['version']=re.search(r'<meta name="app-version" content="([^"]+)"',body.decode()).group(1)
 return result

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:assets=list(pool.map(check,paths))
out=ROOT/'public-verification';out.mkdir(exist_ok=True)
report={'checked_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'validated_commit':'4bbe7a71b70dd1e95367a9d8a85053c71d79b313','version':VERSION,'all_match':all(x['matches'] for x in assets),'assets':assets}
(out/'assets.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'version':assets[0]['version'],'count':len(assets),'all_match':report['all_match']}))
assert assets[0]['version']==VERSION
assert report['all_match'],[a for a in assets if not a['matches']]
