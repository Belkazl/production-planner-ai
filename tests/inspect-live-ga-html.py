import pathlib,re
s=pathlib.Path("/tmp/pp-gateway-fixture.html").read_text("utf-8")
print("PP_GA_SOURCE_LEN",len(s))
patterns=[r"/api/plan(?:-progress)?",r"generations",r"gen_count",r"ga_.*(?:iterations|generations)",r"population",r"max(?:imum)?_?(?:gens|generations)",r"batch_size",r"iterations",r"opt.onclick",r"\boptimize\(",r"async function.*(?:plan|optim)",r"Timeout",r"AbortController"]
for pattern in patterns:
 hits=list(re.finditer(pattern,s,re.I))
 print("PP_GA_PATTERN",repr(pattern),"COUNT",len(hits))
 for m in hits[:8]:
  print("PP_GA_EXCERPT",repr(pattern),m.start(),repr(s[max(0,m.start()-320):min(len(s),m.end()+490)]))
