import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {patchSelectedGenomeUi} from './selected_genome_ui.mjs';

export function patchUi(beforePath, afterPath) {
  if (!beforePath || !afterPath) throw Error('SELECTED_GENOME_UI_PATHS_REQUIRED');
  const before = readFileSync(beforePath, 'utf8');
  const after = patchSelectedGenomeUi(before);
  writeFileSync(afterPath, after);
  console.log('SELECTED_GENOME_UI_PATCH_PASS', JSON.stringify({changed: before !== after}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw Error('SELECTED_GENOME_UI_PATHS_REQUIRED');
  patchUi(process.argv[2], process.argv[3]);
}
