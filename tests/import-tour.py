import os,json,hashlib,urllib.request,zipfile,io,struct,pathlib
root=pathlib.Path('assets/tour');root.mkdir(parents=True,exist_ok=True)
sha='f4bbf9e41206ba879281e38aa474ec7797798954'
artifact=12062736182
expected_digest='f7f9d8ba2ab98e56fd8adc20621eb96e6ed4f92152349de5e11f61ccda7b4d5e'
names=['starter-overview','starter-orders','starter-equipment','starter-schedule']
manifest=root/'source.json'
if manifest.exists():
 data=json.loads(manifest.read_text())
 assert data['sourceCommit']==sha
 for name in names:assert hashlib.sha256((root/(name+'.png')).read_bytes()).hexdigest()==data['images'][name]
 print('Verified previously committed real screenshots')
else:
 req=urllib.request.Request('https://api.github.com/repos/Belkazl/production-planner-ai/actions/artifacts/'+str(artifact)+'/zip',headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'})
 with urllib.request.urlopen(req,timeout=45) as r:raw=r.read()
 assert hashlib.sha256(raw).hexdigest()==expected_digest,'Artifact digest mismatch'
 z=zipfile.ZipFile(io.BytesIO(raw));report=json.loads(z.read('starter-report.json'))
 assert report['ok'] and report['release']=='starter-en-2026-10-16-v1'
 assert not any(v['labels'] for v in report['visibleRussian'])
 images={}
 for name in names:
  data=z.read('screenshots/'+name+'.png')
  assert data[:8]==b'\x89PNG\r\n\x1a\n' and len(data)<5000000
  assert struct.unpack('>II',data[16:24])==(1440,1000)
  (root/(name+'.png')).write_bytes(data);images[name]=hashlib.sha256(data).hexdigest()
 manifest.write_text(json.dumps({'sourceCommit':sha,'sourceRun':38939624074,'sourceArtifact':artifact,'artifactSha256':expected_digest,'note':'Real English synthetic demo account screenshots; no customer data.','images':images},indent=2))
 print('Imported four verified real English demonstration screens')
