/** Private acceptance fixture loader. No production exports or network access. */
export function createApsHarness(source, {fetch, fetchUpstream, model, accountPlanBelongsToModel, console: log = {log() {}, warn() {}, error() {}}}) {
  if (!fetch && typeof fetchUpstream === 'function') fetch = async (url, options = {}) => {
    const target = new URL(url);
    if (target.pathname === '/api/model') return Response.json({model});
    const req = new Request('https://app.example.test' + target.pathname + target.search,
      {method: options.method || 'GET', headers: options.headers});
    return fetchUpstream(req, options);
  };
  const boundary = '\nconst PP_GANTT_INLINE=';
  if (source.split(boundary).length !== 2 || typeof fetch !== 'function')
    throw Error('INTEGRATED_SETUP_APS_FIXTURE_BOUNDARY');
  // This is the actual full scheduling/validation/cache/terminal code preceding
  // the UI literal. No scheduler or terminal handler is replaced by a stub.
  const prefix = source.slice(0, source.indexOf(boundary))
    .replaceAll('export function ', 'function ').replaceAll('export async function ', 'async function ');
  for (const name of ['scheduleWithSetup', 'searchWithSetup', 'validateSetupPlan', 'convertOne', 'progress', 'plan'])
    if (!new RegExp('(?:async )?function ' + name + '\\(').test(prefix)) throw Error('INTEGRATED_SETUP_APS_FIXTURE_FUNCTION');
  const factory = new Function('fetch', 'ppAccountPlanBelongsToModel', 'console', prefix +
    '\nlet legacyCalls=0;const originalSchedule=scheduleWithSetup;\n' +
    'scheduleWithSetup=function(...args){legacyCalls++;return originalSchedule.apply(this,args)};\n' +
    'return {progress,plan,convertOne,scheduleWithSetup,searchWithSetup,validateSetupPlan,legacyCalls:()=>legacyCalls};');
  return factory(fetch, accountPlanBelongsToModel || (() => { throw Error('ACTUAL_OWNERSHIP_FUNCTION_REQUIRED'); }), log);
}
