"""Progress-only patch, bound to the audited production files.
No changes to optimization, candidate scoring, scheduling or preview cadence.
"""
import ast
import hashlib
import math
from pathlib import Path
import sys
import types

NAMES=("full_runtime_adapter.py","manager.py","python-ga-upstream.mjs","restart-optimizer-ui.js","auth-runtime.js")
BASE={
 "full_runtime_adapter.py":"e4806ff78c6c203e9a1e36513b4db0b6947c3f7bd12003468c7ae458fbca5ead",
 "manager.py":"058cfecc8e411253ecb922a6a83a8ffbdaba63d97d3971be4125553e763ece58",
 "python-ga-upstream.mjs":"14880d5d29a79831e78a3a66718608e8ac25b61cbfd9f7c048a64e762ec5ec8c",
 "restart-optimizer-ui.js":"46e10cdecfdf6a1bff3f7aa6401ad1a2a1cc476b9fdc852e8e9bca0413d2536f",
}

OBSERVER='''def _pp_install_decimal_progress_observer(ga):
    """Observe existing native candidate-slot counters, without changing GA work."""
    counters = (0, 0)
    begin = ga.get('_pp_progress_begin')
    step = ga.get('_pp_progress_step')
    if callable(begin) and callable(step):
        def observed_begin(total, *args, **kwargs):
            nonlocal counters
            result = begin(total, *args, **kwargs)
            counters = (0, max(0, int(total)))
            return result

        def observed_step(*args, **kwargs):
            nonlocal counters
            result = step(*args, **kwargs)
            done, total = counters
            if total > 0:
                counters = (min(total, done + 1), total)
            return result

        ga['_pp_progress_begin'] = observed_begin
        ga['_pp_progress_step'] = observed_step

    def percent(snapshot):
        from math import isfinite
        done, total = counters
        if callable(begin) and callable(step) and total == 0:
            return 0.0  # Native search has not started; never emit the legacy artificial 1%.
        if total > 0:
            # Integer arithmetic avoids rounding up a not-yet-completed slot.
            # 100 is reserved for the independently verified terminal result.
            return min(9999, done * 10000 // total) / 100.0
        # Older adapters that don't expose the hooks retain their reported
        # precision; never estimate progress from time or animation.
        try:
            v = float(snapshot.get('percent') or 0)
            return max(0.0, min(99.99, v)) if isfinite(v) else 0.0
        except (ValueError, TypeError, OverflowError):
            return 0.0
    return percent


'''

def once(s,a,b):
    if s.count(a)!=1:
        raise ValueError('decimal_progress_anchor_drift')
    return s.replace(a,b,1)

def digest(b):
    return hashlib.sha256(b).hexdigest()

def patch_lifecycle(s):
    # Authenticated HTML replaces the base SSE receiver with the lifecycle
    # receiver. Preserve every job/sequence/terminal check; change only its cap
    # and integer truncation, and fail closed if the audited source has drifted.
    start="function ppOptimizerLifecycleHtml(html) {"
    if s.count(start)!=1:
        raise ValueError("decimal_lifecycle_owner_drift")
    i=s.index(start)
    j=s.index("\n}\n",i)+3
    helper=s[i:j]
    if "PP_OPTIMIZER_LIFECYCLE_20261124" not in helper:
        raise ValueError("decimal_lifecycle_marker_drift")
    a=helper.index("function receiveProgress(raw) {")
    b=helper.index("function connect() {",a)
    receiver=helper[a:b]
    for guard in ("p?.job_id !== jobId","p.seq <= lastProgressSeq","lastProgressSeq = p.seq","Number.isFinite(p.percent)","setProgressTarget(next)"):
        if guard not in receiver:
            raise ValueError("decimal_lifecycle_guard_drift")
    before="Math.min(99, Math.floor(p.percent))"
    after="Math.min(99.99, p.percent)"
    candidate=once(receiver,before,after)
    updated=helper[:a]+candidate+helper[b:]
    result=s[:i]+updated+s[j:]
    assert result[:i]+updated[:a]+once(candidate,after,before)+updated[a+len(candidate):]+result[i+len(updated):]==s
    return result


def patch(name,s):
    if name=="auth-runtime.js":
        return patch_lifecycle(s)
    if digest(s.encode())!=BASE[name]:
        raise ValueError('decimal_progress_audited_source_drift_'+name)
    if name=="full_runtime_adapter.py":
        s=once(s,"def run(payload,progress):\n",OBSERVER+"def run(payload,progress):\n")
        s=once(s,"    def compute():\n","    decimal_percent = _pp_install_decimal_progress_observer(ga)\n    def compute():\n")
        s=once(s,"initial_progress={'percent':1,'phase':'starting','running':True}","initial_progress={'percent':0.0,'phase':'starting','running':True}")
        s=once(s,"pct=int(snap.get('percent') or 0)","pct=decimal_percent(snap)")
        s=once(s,"preview={'percent':min(99,max(1,pct))","preview={'percent':min(99.99,max(0.0,pct))")
        ast.parse(s)
    elif name=="manager.py":
        s=once(s,"    progress: int = 0\n","    progress: float = 0.0\n")
        s=once(s,'job.progress = min(99, max(job.progress, int(data.get("percent", 0))))',
            '''try:
                                from math import isfinite
                                fraction = float(data.get("percent", 0))
                                if isfinite(fraction):
                                    job.progress = min(99.99, max(job.progress, fraction))
                            except (ValueError, TypeError, OverflowError):
                                pass''')
        ast.parse(s)
    elif name=="python-ga-upstream.mjs":
        s=once(s,"percent:Math.min(99,job.progress||0)","percent:Math.min(99.99,job.progress||0)")
        s=once(s,"const pct=Math.max(0,Math.min(99,Number(data.progress)||0));","const pct=Math.max(0,Math.min(99.99,Number(data.progress)||0));")
    elif name=="restart-optimizer-ui.js":
        start=";(function ppOneSseProgressAndGantt(){"
        if s.count(start)!=1:raise ValueError("decimal_progress_ui_owner")
        a=s.index(start)
        b=s.index("\n})();",a)+len("\n})();")
        original=s[a:b];ui=original
        ui=once(ui,"const STEP_MS=250; // One visible percent per fixed beat, including the verified final stretch.","const STEP_MS=0; // Exact confirmed values from the existing native SSE stream.")
        ui=once(ui,''' const doneText=(/^ru/i.test(document.documentElement.lang||"")||
   window.__PP_LANGUAGE__?.current==="ru")?"Продолжить · 100%":"Continue · 100%";
 const shownText=completed?doneText:percent+"%";''',''' const russian=/^ru/i.test(document.documentElement.lang||"")||window.__PP_LANGUAGE__?.current==="ru";
 const formatted=percent.toFixed(2).replace(".",russian?",":".")+"%";
 const shownText=completed?(russian?"Продолжить · ":"Continue · ")+formatted:formatted;''')
        first=ui.index("function animatePercent(){")
        last=ui.index("function hideFog(){",first)
        prior=ui[first:last]
        if "percent++;ensureMeter();" not in prior or "Math.floor(target)" not in prior:raise ValueError("decimal_progress_ui_pacing_drift")
        ui=ui[:first]+'''function setProgressTarget(target){
 if(!Number.isFinite(target))return;
 const confirmed=Math.max(0,Math.min(verifiedTerminal?100:99.99,target));
 targetPercent=Math.max(targetPercent,confirmed);
 if(verifiedTerminal){finishVisible();return}
 if(percent!==targetPercent){percent=targetPercent;ensureMeter()}
}
'''+ui[last:]
        ui=once(ui,"const next=Math.max(0,Math.min(99,Math.floor(p.percent)));","const next=Math.max(0,Math.min(99.99,p.percent));")
        ui=once(ui,"done:completed?100:Math.min(99,percent),total:100,","done:completed?100:Math.min(99.99,percent),total:100,")
        ui=once(ui,"percent:completed?100:Math.min(99,percent),","percent:completed?100:Math.min(99.99,percent),")
        s=s[:a]+ui+s[b:]
        if "percent++" in ui or "setTimeout(animatePercent" in ui:raise ValueError("decimal_progress_artificial_pacing")
    return s

def test(out):
    adapter=ast.parse((out/"full_runtime_adapter.py").read_text())
    fn=next(n for n in adapter.body if isinstance(n,ast.FunctionDef) and n.name=="_pp_install_decimal_progress_observer")
    ns={};exec(compile(ast.Module(body=[fn],type_ignores=[]),"<counter-test>","exec"),ns)
    calls=[]
    ga={"_pp_progress_begin":lambda *a,**k:calls.append(("begin",a,k)),"_pp_progress_step":lambda *a,**k:calls.append(("step",a,k))}
    percent=ns[fn.name](ga)
    assert percent({"percent":0})==0
    assert percent({"percent":1})==0
    ga["_pp_progress_begin"](18,"optimizing")
    values=[]
    for i in range(1,19):
        ga["_pp_progress_step"]();values.append(percent({"percent":int(i*100/18)}))
    assert values==[min(9999,i*10000//18)/100 for i in range(1,19)]
    assert values[0]==5.55 and values[1]==11.11 and values[-1]==99.99
    assert len(calls)==19 and calls[0][1]==(18,"optimizing")
    ga["_pp_progress_begin"](133,"optimizing")
    assert percent({})==0
    ga["_pp_progress_step"]();assert percent({})==0.75
    # Invalid and stale manager events must not decrease progress or round it.
    tree=ast.parse((out/"manager.py").read_text())
    update=[n for n in ast.walk(tree) if isinstance(n,ast.Try) and any(
        isinstance(a,ast.Assign) and isinstance(a.targets[0],ast.Name) and a.targets[0].id=="fraction" for a in n.body)]
    assert len(update)==1
    statement=compile(ast.Module(body=update,type_ignores=[]),"<manager-test>","exec")
    job=types.SimpleNamespace(progress=0.0)
    for sent,expected in [(13.27,13.27),(13.10,13.27),(float("nan"),13.27),("bad",13.27),(99.99,99.99),(100,99.99)]:
        exec(statement,{"job":job,"data":{"percent":sent}})
        assert job.progress==expected
    print("DECIMAL_COUNTER_AND_MANAGER_PASS",values[0],values[1],values[-1])

if __name__=="__main__":
    before,after=map(Path,sys.argv[1:3])
    after.mkdir(parents=True,exist_ok=True,mode=0o700)
    for name in NAMES:
        raw=(before/name).read_bytes()
        candidate=patch(name,raw.decode()).encode()
        (after/name).write_bytes(candidate)
    test(after)
    print("DECIMAL_LIFECYCLE_RECEIVER_PATCH_PASS",flush=True)
    print("DECIMAL_EXACT_FIVE_FILE_PATCH_PASS",flush=True)
