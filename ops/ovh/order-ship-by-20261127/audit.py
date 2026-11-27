"""Read only code; emit limited integration anchor excerpts, not configuration or account data."""
from pathlib import Path
import re, sys, ast
from patch_worker import patch
root=Path(sys.argv[1])
for name,patterns in {
 'auth-runtime.js':[r'const assistantHtml=.*?;',r'function ppGroqActionsHtml\(html\)'],
 'tenant-model-runtime.js':[r'function \w*(?:Normaliz|normaliz|Sanitiz|sanitiz|Import|import)\w*\(',r'function ppGroqPrepareEdit\(',r'\borders\s*[:=]\s*[^;\n]{0,100}'],
 'python-ga-upstream.mjs':[r'function \w*(?:Prefer|prefer|Best|best|Score|score|Objective|objective)\w*\(',r'const publicPlan\s*=',r'const \w*(?:Best|best|Score|score|Objective|objective)\w*\s*='],
 'restart-optimizer-ui.js':[r'function prefersNew\(',r'const prefersNew\s*=',r'function \w*(?:QualityFloor|qualityFloor)\w*\('],
 'stop-ui.js':[r'function (?:acceptedBeforeStop|choose|key)\('],
 'full_runtime_adapter.py':[r'def \w*(?:normaliz|objective|progress_best|progress_candidate|checkpoint|live_scheduler_preview)\w*\(',r'normalized\s*='],
 }.items():
    s=(root/name).read_text()
    for pattern in patterns:
        for m in list(re.finditer(pattern,s,re.M))[:8]:
            excerpt=s[max(0,m.start()-30):min(len(s),m.end()+650)]
            if not re.search(r'password|secret|api[_-]?key|authorization|token|credential',excerpt,re.I):
                print('SHIP_BY_ANCHOR',name,repr(excerpt)[:900])
worker=(root/'joint_minibatch.py').read_text()
try:
    patch(worker,Path(__file__).with_name('deadlines.py').read_text())
    print('SHIP_BY_ACTIVE_WORKER_PATCH_OK')
except ValueError as e:
    print('SHIP_BY_ACTIVE_WORKER_PATCH_REFUSED',str(e))
