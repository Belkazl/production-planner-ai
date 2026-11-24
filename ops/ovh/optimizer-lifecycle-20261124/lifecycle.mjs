export function ppOptimizerLifecycleHtml(html) {
  const marker = 'PP_OPTIMIZER_LIFECYCLE_20261124';
  const fail = () => {
    console.warn('PP_OPTIMIZER_LIFECYCLE_SOURCE_DRIFT');
    return html;
  };
  if (typeof html !== 'string') return fail();
  const ids = ['ppAsyncPlanTransport', 'ppStopOptimizationV1', 'pp-restart-optimizer-ui'];
  const scripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi));
  const found = ids.map(id => scripts.filter(script => {
    const attr = script[1].match(/\bid\s*=\s*(["'])(.*?)\1/i);
    return attr && attr[2] === id;
  }));
  if (found.some(matches => matches.length !== 1)) return fail();
  const source = found.map(matches => matches[0][2]);
  if (source.every(script => script.split(marker).length === 2)) return html;
  if (source.some(script => script.includes(marker))) return fail();
  const one = (text, before, after) => {
    if (text.split(before).length !== 2) throw Error('anchor');
    return text.replace(before, after);
  };
  const region = (text, begin, end, replacement) => {
    if (text.split(begin).length !== 2) throw Error('region');
    const a = text.indexOf(begin), b = text.indexOf(end, a + begin.length);
    if (b <= a || b - a > 16000) throw Error('boundary');
    return text.slice(0, a) + replacement + text.slice(b);
  };

  function bindJob(value) {
    const id = String(value || '');
    if (disposed || !active || !/^[0-9a-f]{32}$/.test(id)) return false;
    if (jobId && jobId !== id) return false;
    jobId = id;
    connect();
    return true;
  }
  async function finish() {
    if (disposed || fullPending || !active || !jobId) return;
    const expectedEpoch = runEpoch, expectedJob = jobId;
    fullPending = true;
    try {
      networkFinalGets++;
      const r = await originalFetch('/api/plan-progress?ppNoCache=1&ppProgressCache=off&job_id=' + encodeURIComponent(expectedJob), {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: {accept: 'application/json'}, signal: AbortSignal.timeout(25000)
      });
      const data = r.ok ? await r.json() : null;
      if (disposed || !active || runEpoch !== expectedEpoch || jobId !== expectedJob) return;
      if (!data?.success || data.running !== false || data.phase !== 'completed' ||
          data.job_id !== expectedJob || data.result?.valid === false ||
          !Array.isArray(data.result?.operations) || !data.result.operations.length)
        throw Error('sse_full_result_not_verified');
      fullData = data; phase = 'completed';
      terminalGap = 100 - percent; terminalAt = performance.now();
      stream?.close(); stream = null; connected = false;
      if (animationTimer) { clearTimeout(animationTimer); animationTimer = null; }
      percent = 100; targetPercent = 100; verifiedTerminal = true;
      finishVisible();
    } catch (_) {
      if (disposed || !active || runEpoch !== expectedEpoch || jobId !== expectedJob) return;
      errors++; fullPending = false;
      if (finalRetries < 3) {
        finalRetries++;
        finalRetryTimer = setTimeout(() => {
          finalRetryTimer = null;
          if (runEpoch === expectedEpoch && jobId === expectedJob) void finish();
        }, 1700 + finalRetries * 1500);
      }
    }
  }
  function receiveProgress(raw) {
    let p;
    try { p = JSON.parse(raw); } catch { return; }
    if (!active || !jobId || p?.job_id !== jobId ||
        typeof p.percent !== 'number' || !Number.isFinite(p.percent)) return;
    if (Number.isInteger(p.seq)) {
      if (p.seq <= lastProgressSeq) return;
      lastProgressSeq = p.seq;
    }
    const next = Math.max(0, Math.min(99, Math.floor(p.percent)));
    const nextPhase = String(p.phase || 'running');
    if (!Number.isInteger(p.seq) && next === targetPercent && phase === nextPhase) return;
    setProgressTarget(next); phase = nextPhase; events++; ensureMeter();
  }
  function connect() {
    if (disposed || !active || !jobId || stream || typeof EventSource !== 'function') return;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    const expectedEpoch = runEpoch, expectedJob = jobId;
    const connection = new EventSource('/api/plan-events?job_id=' + encodeURIComponent(expectedJob));
    stream = connection; connected = false;
    const current = () => !disposed && active && stream === connection &&
      runEpoch === expectedEpoch && jobId === expectedJob;
    const message = event => {
      if (!current()) return null;
      try {
        const data = JSON.parse(event.data);
        return data?.job_id === expectedJob ? data : null;
      } catch { return null; }
    };
    connection.addEventListener('open', () => { if (current()) connected = true; });
    connection.addEventListener('progress', event => { if (current()) receiveProgress(event.data); });
    connection.addEventListener('preview', event => {
      const data = message(event);
      if (data && !sameCandidate(data.plan)) paintPreview();
    });
    connection.addEventListener('complete', event => { if (message(event)) void finish(); });
    connection.addEventListener('stopped', event => { if (message(event)) stop(); });
    connection.addEventListener('problem', event => {
      const data = message(event);
      if (data) { errors++; lastStreamIssue = data.reason || 'unknown'; }
    });
    connection.addEventListener('error', () => {
      if (!current()) return;
      connected = false; reconnects++;
      if (connection.readyState === 2) {
        connection.close(); stream = null;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (runEpoch === expectedEpoch && jobId === expectedJob) connect();
        }, Math.min(4500, 500 + reconnects * 500));
      }
    });
  }
  function start(expectedJobId) {
    if (disposed) return;
    if (active) { if (expectedJobId) bindJob(expectedJobId); return; }
    runEpoch++; manuallyStopped = false;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (animationTimer) { clearTimeout(animationTimer); animationTimer = null; }
    if (finalRetryTimer) { clearTimeout(finalRetryTimer); finalRetryTimer = null; }
    stream?.close(); stream = null; connected = false;
    active = true; completed = false; verifiedTerminal = false; finalRetries = 0;
    terminalGap = 0; terminalAt = 0; terminalElapsedMs = 0;
    jobId = null; percent = 0; targetPercent = 0; phase = 'queued'; lastProgressSeq = -1;
    fullData = null; fullPending = false; lastPreviewSignature = ''; lastPlan = null;
    kpiUpdates = 0; lastKpiMetrics = null;
    hideFog(); ensureMeter();
    if (expectedJobId) bindJob(expectedJobId);
  }

  function waitForWorkerUpdate(ms, signal, expectedJobId) {
    return new Promise(resolve => {
      let timer = null, settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        window.removeEventListener('pp:sse-verified-complete', complete);
        window.removeEventListener('pp:optimizer-stop-settled', done);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const complete = event => {
        if (expectedJobId && event.detail?.job_id === expectedJobId) done();
      };
      window.addEventListener('pp:sse-verified-complete', complete);
      window.addEventListener('pp:optimizer-stop-settled', done);
      signal?.addEventListener('abort', done, {once: true});
      timer = setTimeout(done, ms);
      if (signal?.aborted) done();
    });
  }
  async function ppConfirmStoppedAfterAmbiguousResponse(expectedJobId, expectedGeneration) {
    if (!/^[0-9a-f]{32}$/.test(String(expectedJobId || ''))) return null;
    try {
      const response = await fetch('/api/plan-progress?ppStopConfirm=' + Date.now() + '&ppProgressCache=off&job_id=' + encodeURIComponent(expectedJobId), {
        method: 'GET', cache: 'no-store', credentials: 'same-origin',
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return null;
      const status = await response.json();
      if (expectedGeneration !== generation || status?.ok !== true ||
          status.running !== false || status.job_id !== expectedJobId) return null;
      const cancelled = status.phase === 'cancelled' || status.stopped === true || status.error === 'optimization_stopped';
      const completed = status.phase === 'completed' && status.success === true && valid(status.result);
      if (!cancelled && !completed) return null;
      return {ok: true, stopped: true, already_completed: completed, job_id: expectedJobId,
        best_preview: status.best_preview || status.result || null,
        variants: [], confirmed_by: 'same_job_terminal_status'};
    } catch (error) {
      console.warn('PP_STOP_CONFIRM_UNAVAILABLE', String(error).slice(0, 80));
      return null;
    }
  }
  async function ppLifecycleStopClick() {
    if (!running || requestStop || stopPending) return;
    const expectedGeneration = generation;
    let expectedJobId = currentRunJobId || window.__PP_SSE_PROGRESS_V1__?.state?.jobId;
    const pending = {generation: expectedGeneration, job_id: expectedJobId};
    stopPending = true; window.__ppStopRequestPending = pending;
    stop.disabled = true; stop.textContent = 'Останавливаю...';
    const current = () => expectedGeneration === generation &&
      (!currentRunJobId || !expectedJobId || currentRunJobId === expectedJobId);
    try {
      if (!/^[0-9a-f]{32}$/.test(String(expectedJobId || ''))) {
        expectedJobId = await new Promise(resolve => {
          let timer = null, settled = false;
          const done = value => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimeout(timer);
            window.removeEventListener('pp:ga-async-started', ready);
            window.removeEventListener('pp:optimizer-finished', ended);
            resolve(value);
          };
          const ready = event => {
            const id = event.detail?.job_id;
            if (!current()) return done(null);
            if (/^[0-9a-f]{32}$/.test(String(id || '')) &&
                (!currentRunJobId || currentRunJobId === id)) done(id);
          };
          const ended = () => done(null);
          window.addEventListener('pp:ga-async-started', ready);
          window.addEventListener('pp:optimizer-finished', ended);
          timer = setTimeout(() => done(null), 15000);
        });
      }
      if (!current() || !/^[0-9a-f]{32}$/.test(String(expectedJobId || ''))) return;
      pending.job_id = expectedJobId;
      let response = null, data = null;
      try {
        response = await fetch('/api/optimizer-stop?job_id=' + encodeURIComponent(expectedJobId), {
          method: 'POST', cache: 'no-store', credentials: 'same-origin',
          signal: AbortSignal.timeout(15000)
        });
        data = await response.json();
      } catch (error) { console.warn('PP_STOP_RESPONSE_UNAVAILABLE', String(error).slice(0, 80)); }
      if (!current()) return;
      if (!response?.ok || data?.ok !== true || data.job_id !== expectedJobId) {
        data = await ppConfirmStoppedAfterAmbiguousResponse(expectedJobId, expectedGeneration);
        if (!current()) return;
        if (!data) {
          const status = document.getElementById('valid');
          if (status) status.textContent = 'GA: остановка не подтверждена · повтори Stop';
          console.warn('PP_STOP_NOT_READY', 'same_job_terminal_state_unconfirmed');
          return;
        }
      }
      for (const variant of data.variants || []) record(variant.plan);
      record(data.best_preview);
      requestStop = true;
      stoppedPlanAvailable = items.some(item => valid(item.plan)) || valid(prevPlan);
      window.__ppStopUiLocked = true;
      generation++; running = false; candidateAvailable = false;
      const candidate = liveModeButton('candidate');
      if (candidate) { candidate.disabled = false; candidate.removeAttribute('aria-disabled'); candidate.title = ''; }
      clearTimeout(timer);
      try { window.__ppCurrentOptimizationAbort?.abort('stopped_by_user'); } catch (_) {}
      window.__ppOptimizationInFlight = false; btn.disabled = false;
      stop.classList.remove('pp-on'); stop.textContent = 'Остановить оптимизацию';
      setActionAfterStop();
      window.dispatchEvent(new Event('pp:optimizer-stopped'));
      const status = document.getElementById('valid');
      if (status) status.textContent = 'GA: остановлено · выбери вариант';
      ppScheduleStopReconciliation(generation);
      setTimeout(showModal, 40);
    } catch (error) {
      console.error('PP_STOP_REQUEST_ERROR', error);
    } finally {
      if (window.__ppStopRequestPending === pending) {
        window.__ppStopRequestPending = null; stopPending = false;
        stop.disabled = false; stop.textContent = 'Остановить оптимизацию';
        window.dispatchEvent(new CustomEvent('pp:optimizer-stop-settled', {detail: {job_id: expectedJobId}}));
      }
    }
  }
  async function ppLifecycleAsyncFetch(input, init) {
    if (pathOf(input) !== '/api/plan' || methodOf(input, init) !== 'POST') return nativeFetch(input, init);
    let payload;
    try {
      const raw = await originalBody(input, init); payload = raw ? JSON.parse(raw) : {};
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('invalid');
    } catch { return nativeFetch(input, init); }
    if (payload.__pp_async_start === true) return nativeFetch(input, init);
    if (activePlanPromise && activePlanSignal?.aborted) { activePlanPromise = null; activePlanSignal = null; }
    if (!activePlanPromise) {
      activePlanSignal = init?.signal || (input instanceof Request ? input.signal : null);
      const own = joinOrStart(input, init, payload).finally(() => {
        if (activePlanPromise === own) { activePlanPromise = null; activePlanSignal = null; }
      });
      activePlanPromise = own;
    }
    const out = await activePlanPromise;
    return jsonResponse(out.data, out.status);
  }

  try {
    let [transport, stopSource, sse] = source;
    transport = one(transport, 'let activePlanPromise=null;', 'let activePlanPromise=null,activePlanSignal=null;');
    transport = one(transport, 'async function progressOnce(signal){', 'async function progressOnce(signal,expectedJobId){');
    transport = one(transport, 'window.fetch("/api/plan-progress",{method:', 'window.fetch("/api/plan-progress?ppProgressCache=off"+(expectedJobId?"&job_id="+encodeURIComponent(expectedJobId):""),{method:');
    transport = one(transport, ' async function waitForPlan(signal){', ' ' + waitForWorkerUpdate.toString() + '\n async function waitForPlan(signal,expectedJobId){');
    transport = one(transport,
      '   await sleep(transient?Math.min(15000,2000+transient*2000):3000);',
      '   const terminal=window.__PP_SSE_PROGRESS_V1__?.state;\n' +
      '   if(window.__ppStopRequestPending||!(terminal?.completed&&terminal.jobId===expectedJobId))\n' +
      '    await waitForWorkerUpdate(transient?Math.min(15000,2000+transient*2000):3000,signal,expectedJobId);');
    transport = one(transport, '   let out;\n   try{out=await progressOnce(AbortSignal.timeout(14000))}',
      '   if(window.__ppStopRequestPending)continue;\n   let out;\n   try{out=await progressOnce(AbortSignal.timeout(14000),expectedJobId)}');
    transport = one(transport, '   const {r,data}=out;',
      '   if(signal?.aborted)throw new DOMException("The operation was aborted.","AbortError");\n' +
      '   if(window.__ppStopRequestPending)continue;\n   const {r,data}=out;\n' +
      '   if(r.status===409&&data?.error==="job_mismatch")return {status:409,data};\n' +
      '   if(r.ok&&expectedJobId&&data?.job_id!==expectedJobId)\n' +
      '    return {status:409,data:{ok:false,error:"ga_job_identity_mismatch"}};');
    transport = one(transport, 'if(data.phase==="cancelled"||data.error==="optimization_stopped")',
      'if(data.stopped===true||data.phase==="cancelled"||data.error==="optimization_stopped")');
    transport = one(transport, '  abortIfStopped();\n  let prior=null;',
      '  const waitForJob=async(jobId,joined=false)=>{\n   abortIfStopped();\n' +
      '   window.dispatchEvent(new CustomEvent("pp:ga-async-started",{detail:{job_id:jobId||null,joined}}));\n' +
      '   const state=window.__PP_SSE_PROGRESS_V1__?.state;\n' +
      '   const epoch=state?.jobId===jobId?state.runEpoch:null;\n' +
      '   let succeeded=false;\n   try{\n' +
      '    const out=await waitForPlan(signal,jobId);\n' +
      '    succeeded=out?.status===200&&out.data?.ok===true;\n    return out;\n' +
      '   }finally{\n' +
      '    if(!succeeded&&jobId&&Number.isInteger(epoch))\n' +
      '     window.dispatchEvent(new CustomEvent("pp:ga-transport-ended",{detail:{job_id:jobId,run_epoch:epoch}}));\n' +
      '   }\n  };\n  abortIfStopped();\n  let prior=null;');
    transport = one(transport, 'if(prior.r.ok&&prior.data?.running)return waitForPlan(signal);',
      'if(prior.r.ok&&prior.data?.running)return waitForJob(prior.data.job_id,true);');
    transport = one(transport, '    try{body=await start.json()}catch(_){body=null}',
      '    try{body=await start.json()}catch(_){body=null}\n    abortIfStopped();');
    transport = one(transport,
      '     window.dispatchEvent(new CustomEvent("pp:ga-async-started",{\n      detail:{job_id:body.job_id||null,joined:!!body.joined}\n     }));\n     return waitForPlan(signal);',
      '     return waitForJob(body.job_id,!!body.joined);');
    transport = one(transport, '     return waitForPlan(signal);', '     return waitForJob(cur.data.job_id,true);');
    transport = region(transport, ' window.fetch=async function(input,init){', '\n function ppRouteGaDiagnosticsOutsideValidator(){',
      ' window.fetch=' + ppLifecycleAsyncFetch.toString() + ';\n');

    stopSource = one(stopSource, 'let reconnecting=true,recoveredSession=false,remotePercent=0,remotePhase="checking",remoteFailureCount=0;',
      'let reconnecting=true,recoveredSession=false,remotePercent=0,remotePhase="checking",remoteFailureCount=0;\nlet stopPending=false,currentRunJobId=null;');
    stopSource = one(stopSource, ' stop.disabled=false;stop.title="Корректных вариантов: "+items.length;',
      ' stop.disabled=stopPending;stop.title="Корректных вариантов: "+items.length;');
    stopSource = one(stopSource, ' stop.disabled=false;\n stop.textContent="Остановить оптимизацию";\n if(!stop.classList.contains("pp-on"))',
      ' stop.disabled=stopPending;\n if(!stopPending)stop.textContent="Остановить оптимизацию";\n if(!stop.classList.contains("pp-on"))');
    stopSource = one(stopSource, ' reconnecting=false;recoveredSession=true;remoteFailureCount=0;',
      ' reconnecting=false;recoveredSession=true;remoteFailureCount=0;\n currentRunJobId=data.job_id||null;');
    stopSource = one(stopSource, 'fetch("/api/plan-progress?ppReconnect="+Date.now(),{',
      'fetch("/api/plan-progress?ppProgressCache=off&ppReconnect="+Date.now(),{');
    stopSource = one(stopSource, ' record(data.best_preview);record(data.candidate_preview);\n window.dispatchEvent(new Event("pp:optimizer-started"));',
      ' record(data.best_preview);record(data.candidate_preview);\n window.dispatchEvent(new CustomEvent("pp:optimizer-started",{detail:{job_id:currentRunJobId}}));');
    stopSource = one(stopSource, 'if(my===generation&&running&&!requestStop){stop.disabled=false;timer=setTimeout(()=>poll(my),1750);}',
      'if(my===generation&&running&&!requestStop){stop.disabled=stopPending;timer=setTimeout(()=>poll(my),1750);}');
    stopSource = region(stopSource, 'async function ppConfirmStoppedAfterAmbiguousResponse(){', '\nfunction ppReconcileStoppedUi(expectedGeneration){',
      ppConfirmStoppedAfterAmbiguousResponse.toString() + '\n');
    stopSource = one(stopSource, ' const my=++generation;\n running=true;requestStop=false;items=[];stop.disabled=false;',
      ' const my=++generation;\n currentRunJobId=null;stopPending=false;\n running=true;requestStop=false;items=[];stop.disabled=false;');
    stopSource = region(stopSource, 'stop.onclick=async function(){', '\nconst ppFetchOriginal=window.fetch.bind(window);',
      'stop.onclick=' + ppLifecycleStopClick.toString() + ';\n' +
      'window.addEventListener("pp:ga-async-started",event=>{\n' +
      ' const id=event.detail?.job_id;\n' +
      ' if(running&&!requestStop&&/^[0-9a-f]{32}$/.test(String(id||""))&&(!currentRunJobId||currentRunJobId===id))currentRunJobId=id;\n});\n' +
      'window.addEventListener("pp:sse-verified-complete",event=>{\n' +
      ' if(running&&!stopPending&&!requestStop&&event.detail?.job_id===currentRunJobId){\n' +
      '  stop.classList.remove("pp-on");stop.disabled=true;\n' +
      '  if(recoveredSession){clearTimeout(timer);void poll(generation);}\n' +
      ' }\n});\n');
    stopSource = one(stopSource, '{ok:true,running:false,success:false,stopped:true,percent:0}',
      '{ok:true,running:false,success:false,stopped:true,phase:"cancelled",error:"optimization_stopped",job_id:currentRunJobId,percent:0}');

    sse = one(sse, 'let stream=null,retryTimer=null,jobId=null,percent=0,phase="idle",fullData=null,fullPending=false;',
      'let stream=null,retryTimer=null,jobId=null,percent=0,phase="idle",fullData=null,fullPending=false;\nlet runEpoch=0,lastProgressSeq=-1;\n' + bindJob.toString());
    sse = region(sse, 'async function finish(){', '\nfunction receiveProgress(raw){', finish.toString() + '\n');
    sse = region(sse, 'function receiveProgress(raw){', '\nfunction connect(){', receiveProgress.toString() + '\n');
    sse = region(sse, 'function connect(){', '\nfunction start(){', connect.toString() + '\n');
    sse = region(sse, 'function start(){', '\nfunction stop(){', start.toString() + '\n');
    sse = one(sse, 'function stop(){\n manuallyStopped=true;', 'function stop(){\n runEpoch++;\n manuallyStopped=true;');
    sse = one(sse, 'const startHandler=()=>start();',
      'const startHandler=event=>start(event?.detail?.job_id);\n' +
      'const jobHandler=event=>{if(active)bindJob(event.detail?.job_id)};\n' +
      'const transportEndedHandler=event=>{\n' +
      ' const detail=event.detail;\n' +
      ' if(!disposed&&active&&!completed&&detail?.job_id===jobId&&detail?.run_epoch===runEpoch)stop();\n' +
      '};\n' +
      'const finishHandler=()=>{if(active&&!jobId)stop()};');
    sse = one(sse, 'window.addEventListener("pp:optimizer-stopped",stopHandler);',
      'window.addEventListener("pp:optimizer-stopped",stopHandler);\n' +
      'window.addEventListener("pp:ga-async-started",jobHandler);\n' +
      'window.addEventListener("pp:ga-transport-ended",transportEndedHandler);\n' +
      'window.addEventListener("pp:optimizer-finished",finishHandler);');
    sse = one(sse, 'get state(){return{active,completed,connected,percent,phase,events,previews,',
      'get state(){return{runEpoch,active,completed,connected,percent,phase,events,previews,');
    sse = one(sse, '  window.removeEventListener("pp:optimizer-stopped",stopHandler);',
      '  window.removeEventListener("pp:optimizer-stopped",stopHandler);\n' +
      '  window.removeEventListener("pp:ga-async-started",jobHandler);\n' +
      '  window.removeEventListener("pp:ga-transport-ended",transportEndedHandler);\n' +
      '  window.removeEventListener("pp:optimizer-finished",finishHandler);');

    const updated = [transport, stopSource, sse].map(script => '// ' + marker + '\n' + script);
    let output = html;
    for (const item of found.map((matches, i) => ({match: matches[0], content: updated[i]})).sort((a, b) => b.match.index - a.match.index)) {
      const match = item.match, offset = match[0].indexOf('>') + 1;
      output = output.slice(0, match.index + offset) + item.content +
        output.slice(match.index + offset + match[2].length);
    }
    return output;
  } catch (_) { return fail(); }
}
