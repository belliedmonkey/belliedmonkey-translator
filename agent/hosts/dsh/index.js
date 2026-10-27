// H2 packaging shim for dsh. This module registers no tools.
//
// cordis.patch.yml lists this package before the mcp-client row.
// Import records the absolute path of stdio.js so that row's !!js
// expression can spawn it. The spawned file loads agent/mcp-stdio.js.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const launcher = join(dirname(fileURLToPath(import.meta.url)), 'stdio.js');
globalThis.__BELLIEDMONKEY_DSH_STDIO = launcher;

export const name = 'belliedmonkey-dsh';

export function apply() {
  globalThis.__BELLIEDMONKEY_DSH_STDIO = launcher;
}
