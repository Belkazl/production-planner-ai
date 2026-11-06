// Staging-only build-time adjustment; never run in production Railway builds.
import {readFileSync, writeFileSync} from 'node:fs';
const path = 'server.ts';
const source = readFileSync(path, 'utf8');
const anchor = 'let sameSite=allowedOrigins.has(origin);';
if (source.split(anchor).length !== 2) throw Error('preview_origin_anchor_changed');
const addition = `${anchor}
   // Local SSH-forwarded staging only; never permit an arbitrary Origin.
   const previewPort = String(process.env.OVH_LOCAL_PREVIEW_PORT || '18080');
   const previewHost = req.headers.get('host') || '';
   if (process.env.OVH_LOCAL_PREVIEW === '1'
       && (previewHost === 'localhost:' + previewPort
           || previewHost === '127.0.0.1:' + previewPort)
       && origin === 'http://' + previewHost) sameSite = true;`;
let patched = source.replace(anchor, addition);
const bindAnchor = "hostname:'0.0.0.0'";
if (patched.split(bindAnchor).length !== 2) throw Error('landing_bind_anchor_changed');
patched = patched.replace(bindAnchor,
  "hostname:process.env.OVH_STAGING_BIND_LOOPBACK === '1' ? '127.0.0.1' : '0.0.0.0'");
writeFileSync(path, patched);
console.log('OVH_LOCAL_PREVIEW_ORIGIN_PATCH_OK');