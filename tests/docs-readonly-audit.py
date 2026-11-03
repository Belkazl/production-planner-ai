import urllib.request, re, json
url="https://production-planner-gateway-production.up.railway.app/"
with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"ProdPlanDocsNavigationAudit/1.0"}),timeout=40) as r:
 s=r.read(2000000).decode("utf-8","replace")
print("UPSTREAM_HTML",len(s))
queries=["Документы","Скачать шаблон","Загрузить данные","Сохранить план","nav span","querySelectorAll('.nav","querySelectorAll(\".nav","downloadTemplate","download","upload","fileInput","fileUpload","sectionView","function showSection","function switchTab","function setTab","onclick","Документы'","isDocuments"]
for query in queries:
 matches=list(re.finditer(re.escape(query),s,re.I))
 print("ANCHOR",repr(query),len(matches))
 for m in matches[:6]:
  before=650 if query in ("Документы","Скачать шаблон","Загрузить данные","nav span") else 280
  after=1200 if query in ("Документы","Скачать шаблон","Загрузить данные","nav span","sectionView") else 620
  print("CONTEXT",repr(query),m.start(),json.dumps(s[max(0,m.start()-before):min(len(s),m.end()+after)],ensure_ascii=False))
print("FINISHED_READ_ONLY")
