// test/bt-relay.test.js — the relay implementation moved to the private hosted repo.
//
// BEL-172 (P0): `supabase/functions/bt-relay/index.ts` and the other hosted functions were
// migrated to `belliedmonkey-translator-hosted`. The relay-contract test now lives there
// (`tests/relay.test.js`) and runs against the real implementation.
//
// What the public repo must still prove is the *boundary*: the implementation has not
// crept back. The public HTTP contract itself is covered by test/contract-mock.test.js,
// which runs the public mock in `mocks/hosted-gateway/`.
const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const RELAY = path.join(ROOT, 'supabase', 'functions', 'bt-relay', 'index.ts');

describe('bt-relay → hosted (BEL-172)', () => {
  test('公仓不再带中继实现（实现只在私有 hosted 仓）', () => {
    ok(!fs.existsSync(RELAY),
      'supabase/functions/bt-relay/index.ts 又回到了公仓 —— 见 BOUNDARY.md §2 与 scripts/check-boundary.js');
  });

  test('公仓仍保留契约与 mock（E5 的可执行面）', () => {
    ok(fs.existsSync(path.join(ROOT, 'contracts', 'hosted-gateway.v0.yaml')), '契约不见了');
    ok(fs.existsSync(path.join(ROOT, 'mocks', 'hosted-gateway', 'server.js')), 'mock 不见了');
  });
});
