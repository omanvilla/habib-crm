"""Publication and unauthenticated denial checks. Never sends a customer message."""
import concurrent.futures,datetime,hashlib,json,pathlib,re,urllib.request,urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE='https://omanvilla.github.io/habib-crm/'
VERSION='20261021-client-v17'
source=(ROOT/'index.html').read_text()
paths=['index.html']+list(dict.fromkeys(re.findall(r'([A-Za-z0-9_.-]+\.(?:html|css|js)\?v=[A-Za-z0-9_-]+)',source)))
paths+=['supabase/functions/_shared/whatsapp-reply-preview.mjs?v='+VERSION,'supabase/functions/_shared/property-inquiry-matcher.mjs']
assert len(paths)==30,paths
out=ROOT/'public-verification';out.mkdir(exist_ok=True)
def check(path):
 name=path.split('?')[0];url=BASE+('' if name=='index.html' else path)
 result={'path':path,'expected_sha256':hashlib.sha256((ROOT/name).read_bytes()).hexdigest()}
 try:
  req=urllib.request.Request(url,headers={'Cache-Control':'no-cache','User-Agent':'HabibCRM-v17-Verification'})
  with urllib.request.urlopen(req,timeout=30) as response:
   body=response.read();result.update(status=response.status,sha256=hashlib.sha256(body).hexdigest(),content_type=response.headers.get('Content-Type'))
   if name=='index.html':result['version']=re.search(r'<meta name="app-version" content="([^"]+)"',body.decode()).group(1)
  result['matches']=result['status']==200 and result['sha256']==result['expected_sha256']
 except Exception as e:result.update(matches=False,error=str(e))
 return result
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:assets=list(pool.map(check,paths))
auth=[]
for function,error in [('whatsapp-send','missing_auth'),('whatsapp-webhook','invalid_signature')]:
 req=urllib.request.Request('https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/'+function,data=b'{}',headers={'Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.urlopen(req,timeout=30) as response:status=response.status;body=response.read()
 except urllib.error.HTTPError as response:status=response.code;body=response.read()
 payload=json.loads(body);auth.append({'function':function,'status':status,'error':payload.get('error'),'passed':status==401 and payload.get('error')==error})
report={'checked_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runtime_commit':'f120eabc201cf9849c3fe3e6c6ef9e893db31635','delivery_commit':'b70ccdd7d8ab5be95a173c037412a5410ba5f9d9','version':VERSION,'assets':assets,'all_match':all(a['matches'] for a in assets),'unauthenticated_edge_denials':auth,'production_business_writes':0}
(out/'assets.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'assets':len(assets),'all_match':report['all_match'],'edge':auth}))
assert report['all_match'],[x for x in assets if not x['matches']]
assert assets[0]['version']==VERSION
assert all(x['passed'] for x in auth)
