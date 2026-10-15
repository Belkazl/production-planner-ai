#!/usr/bin/env python3
"""Read-only RDAP lookups for LiftOrbit domains. No registrations or account actions."""
import concurrent.futures, json, urllib.request, urllib.error
from datetime import datetime, timezone

DOMAINS = {
    "com": ("liftorbit.com", "example.com"),
    "net": ("liftorbit.net", "google.net"),
    "org": ("liftorbit.org", "wikipedia.org"),
    "io": ("liftorbit.io", "github.io"),
    "ai": ("liftorbit.ai", "google.ai"),
    "app": ("liftorbit.app", "google.app"),
    "dev": ("liftorbit.dev", "google.dev"),
    "eu": ("liftorbit.eu", "google.eu"),
    "si": ("liftorbit.si", "google.si"),
    "co": ("liftorbit.co", "google.co"),
    "xyz": ("liftorbit.xyz", "abc.xyz"),
    "tech": ("liftorbit.tech", "nic.tech"),
    "cloud": ("liftorbit.cloud", "nic.cloud"),
    "software": ("liftorbit.software", "nic.software"),
    "de": ("liftorbit.de", "google.de"),
    "uk": ("liftorbit.co.uk", "google.co.uk"),
}
HEADERS={"User-Agent":"Mozilla/5.0 (compatible; PublicRDAPDomainResearch/1.0)","Accept":"application/rdap+json, application/json"}
def query(url):
    try:
        req=urllib.request.Request(url,headers=HEADERS)
        with urllib.request.urlopen(req,timeout=14) as r:
            raw=r.read(15000)
            return r.status, json.loads(raw) if raw else {}, r.url
    except urllib.error.HTTPError as e:
        try: body=json.loads(e.read(15000))
        except Exception: body={}
        return e.code,body,url
    except Exception as e:
        return 0,{"error":type(e).__name__+": "+str(e)[:120]},url

def bootstrap():
    status,data,_=query("https://data.iana.org/rdap/dns.json")
    out={}
    if status==200:
        for suffixes,endpoints in data.get("services",[]):
            for suffix in suffixes:
                out[suffix.lower().lstrip(".")]=endpoints
    print("RDAP_BOOTSTRAP status="+str(status)+" services="+str(len(out)),flush=True)
    return out

FALLBACK={
"com":["https://rdap.verisign.com/com/v1/domain/"],
"net":["https://rdap.verisign.com/net/v1/domain/"],
"org":["https://rdap.publicinterestregistry.org/rdap/domain/"],
"si":["https://rdap.register.si/rdap/domain/"],
"eu":["https://rdap.eurid.eu/rdap/domain/"],
"app":["https://rdap.nic.google/domain/"],
"dev":["https://rdap.nic.google/domain/"],
"io":["https://rdap.identitydigital.services/rdap/domain/"],
"ai":["https://rdap.identitydigital.services/rdap/domain/"],
"co":["https://rdap.identitydigital.services/rdap/domain/"],
"de":["https://rdap.denic.de/"],
}
routes=bootstrap()
def inspect(item):
    tld,(domain,control)=item
    endpoints=list(dict.fromkeys(routes.get(tld,[])+FALLBACK.get(tld,[])))
    if not endpoints:
        return {"domain":domain,"result":"UNKNOWN","reason":"no RDAP endpoint"}
    errors=[]
    for base in endpoints[:3]:
        target=base.rstrip("/")+"/" + domain if base.endswith("/domain/") else base.rstrip("/")+"/domain/"+domain
        # Registry bootstrap base generally ends in slash before 'domain' suffix.
        if "/domain/domain/" in target:target=target.replace("/domain/domain/","/domain/")
        status,body,actual=query(target)
        if status==200 and isinstance(body,dict) and (body.get("ldhName") or body.get("unicodeName")):
            return {"domain":domain,"result":"REGISTERED","http":status,"rdap":actual,"registrar":next((x.get("vcardArray",[])[-1][0][-1] if False else "") for x in []), "events":body.get("events",[])[:4]}
        if status in (404,410):
            control_url=base.rstrip("/")+"/" + control if base.endswith("/domain/") else base.rstrip("/")+"/domain/"+control
            control_url=control_url.replace("/domain/domain/","/domain/")
            s,b,_=query(control_url)
            if s==200 and isinstance(b,dict) and (b.get("ldhName") or b.get("unicodeName")):
                return {"domain":domain,"result":"NO_REGISTRATION_RECORD","http":status,"rdap":actual,"control":control,"controlStatus":s}
            errors.append(f"target={status};control={s} ({base})")
        else:
            errors.append(f"target={status};detail={str(body.get('error',''))[:70]} ({base})")
    return {"domain":domain,"result":"UNKNOWN","reason":" | ".join(errors)}

print("RDAP_CHECKED_AT "+datetime.now(timezone.utc).isoformat(),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    for record in pool.map(inspect,DOMAINS.items()):
        print("RDAP_RESULT "+json.dumps(record,ensure_ascii=False,default=str),flush=True)
