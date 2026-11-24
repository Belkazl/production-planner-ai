export function ppGanttZoom500Html(html) {
  const drift = () => {
    console.warn('PP_GANTT_ZOOM_500_SOURCE_DRIFT');
    return html;
  };
  if (typeof html !== 'string') return drift();
  const changes = [
    {
      scriptId: 'pp-gantt-tool-v2-script',
      before: 'scale=Math.max(.5,Math.min(2.5,Math.round(v*100)/100))',
      after: 'scale=Math.max(.5,Math.min(5,Math.round(v*100)/100))',
    },
    {
      scriptId: 'pp3-secondary-gantts-js',
      before: 'z[mode]=Math.min(2.5,Math.max(.5,Math.round(n*100)/100))',
      after: 'z[mode]=Math.min(5,Math.max(.5,Math.round(n*100)/100))',
    },
    {
      before: 'zoom=Math.min(4,zoom+.25);applyZoom()',
      after: 'zoom=Math.min(5,zoom+.25);applyZoom()',
    },
  ];
  const scripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi));
  const count = (text, token) => text.split(token).length - 1;
  for (const change of changes) {
    if (count(html, change.before) + count(html, change.after) !== 1) return drift();
    const matches = scripts.filter(script => {
      if (change.scriptId) {
        const id = script[1].match(/\bid\s*=\s*(["'])(.*?)\1/i);
        return id && id[2] === change.scriptId;
      }
      return script[2].includes(change.before) || script[2].includes(change.after);
    });
    if (matches.length !== 1 ||
        count(matches[0][2], change.before) + count(matches[0][2], change.after) !== 1) return drift();
  }
  let updated = html;
  for (const change of changes) updated = updated.replace(change.before, change.after);
  return updated;
}
