// Staging-only build-time adjustment; never run in production Railway builds.
import {readFileSync, writeFileSync} from 'node:fs';
const path = 'server.ts';
const source = readFileSync(path, 'utf8');
const anchor = 'let sameSite=allowedOrigins.has(origin);';
if (source.split(anchor).length !== 2) throw Error('preview_origin_anchor_changed');
const addition = `${anchor}
   // SSH-forwarded staging only; public Railway preview behavior is unchanged.
   if (process.env.OVH_LOCAL_PREVIEW === '1'
       && req.headers.get('host') === 'localhost:18080'
       && origin === 'http://localhost:18080') sameSite = true;`;
writeFileSync(path, source.replace(anchor, addition));
console.log('OVH_LOCAL_PREVIEW_ORIGIN_PATCH_OK');