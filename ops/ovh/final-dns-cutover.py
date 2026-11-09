#!/usr/bin/env python3
"""LiftOrbit: minimal Cloudflare DNS cutover controls, with exact-record rollback."""
import json, os, pathlib, sys, urllib.error, urllib.parse, urllib.request
TOKEN=os.environ.get("CLOUDFLARE_API_TOKEN","")
NAMES=("liftorbit.app","app.liftorbit.app")
ORIGIN="51.255.163.121"
API="https://api.cloudflare.com/client/v4/"
def stop(reason):
    raise RuntimeError("LIFTORBIT_DNS_"+reason)
def query(method,path,payload=None):
    if not TOKEN: stop("TOKEN_MISSING")
    req=urllib.request.Request(API+path,method=method,headers={
        "Authorization":"Bearer "+TOKEN,"Accept":"application/json",
        "Content-Type":"application/json"},
        data=json.dumps(payload).encode() if payload is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            data=json.load(res)
    except urllib.error.HTTPError as e:
        stop("HTTP_"+str(e.code))
    if not data.get("success"):stop("API_FAILURE")
    return data.get("result")
def zone():
    matches=[z for z in query("GET","zones?"+urllib.parse.urlencode(
        {"name":"liftorbit.app","per_page":20})) if z.get("name")=="liftorbit.app"]
    if len(matches)!=1:stop("ZONE_NOT_UNIQUE")
    return matches[0]["id"]
def records(zone_id,name):
    path="zones/"+zone_id+"/dns_records?"+urllib.parse.urlencode({"name":name,"per_page":100})
    return [r for r in query("GET",path) if r.get("name")==name and
        r.get("type") in ("A","AAAA","CNAME")]
def capture(path):
    z=zone()
    out={"kind":"liftorbit-cutover-v1","zone":z,"records":{}}
    for name in NAMES:
        rs=records(z,name)
        if len(rs)!=1 or rs[0]["type"]!="CNAME" or not rs[0].get("proxied"):
            stop("UNEXPECTED_CNAME_"+name.replace(".","_"))
        r=rs[0]
        out["records"][name]={k:r.get(k) for k in
            ("id","type","name","content","proxied","ttl")}
        print("DNS_SNAPSHOT_READY",name)
    with open(path,"x") as out_file:json.dump(out,out_file,separators=(",",":"),sort_keys=True)
    os.chmod(path,0o600)
def read_snapshot(path):
    p=pathlib.Path(path)
    if p.is_symlink() or not p.is_file():stop("SNAPSHOT_INVALID")
    data=json.loads(p.read_text())
    if data.get("kind")!="liftorbit-cutover-v1" or set(data.get("records",{}))!=set(NAMES):
        stop("SNAPSHOT_CONTENT_INVALID")
    return data
def modify(data,restore):
    z=zone()
    if z!=data["zone"]:stop("ZONE_MISMATCH")
    for name in NAMES:
        saved=data["records"][name]
        if saved.get("name")!=name or saved.get("type")!="CNAME" or not saved.get("id"):
            stop("SAVED_RECORD_INVALID")
        existing=records(z,name)
        if len(existing)!=1 or existing[0]["id"]!=saved["id"]:stop("RECORD_ID_CHANGED")
        if not restore and (existing[0]["type"]!="CNAME" or
            existing[0]["content"]!=saved["content"]):stop("RECORD_CHANGED_SINCE_CAPTURE")
        payload=({k:saved[k] for k in ("type","name","content","proxied","ttl")}
                 if restore else {"type":"A","name":name,"content":ORIGIN,
                                  "proxied":saved["proxied"],"ttl":saved["ttl"]})
        query("PATCH","zones/"+z+"/dns_records/"+saved["id"],payload)
        actual=records(z,name)
        if len(actual)!=1 or any(actual[0].get(k)!=v for k,v in payload.items()):
            stop("POST_UPDATE_VERIFICATION_FAILED")
        print("DNS_RECORD_RESTORED" if restore else "DNS_RECORD_TO_OVH",name)
def main():
    if len(sys.argv)!=3 or sys.argv[1] not in ("capture","switch","restore"):
        stop("USAGE")
    action,path=sys.argv[1:]
    if action=="capture": capture(path)
    else: modify(read_snapshot(path),action=="restore")
if __name__=="__main__":
    try:main()
    except Exception as error:
        print("LIFTORBIT_DNS_ERROR",str(error).splitlines()[0][:90],file=sys.stderr)
        sys.exit(1)
