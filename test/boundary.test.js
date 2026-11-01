// test/boundary.test.js — BOUNDARY.md §2 must be falsifiable, not decorative.
//
// The checker is the executable half of the public/private split. This suite proves:
//   1. the current public tree is clean (no denylisted implementation, no private import,
//      no JWT-shaped token),
//   2. the deny rules actually catch the paths they claim to (a rule that cannot go red
//      is not a gate),
//   3. the contract/whitelist/mock exceptions are exactly the intended ones.
const { describe, test, ok, eq, deepEq } = require('./harness');
const { inspectTree, inspectPaths, denied, filterExistingAtHead } = require('../scripts/check-boundary.js');

describe('BOUNDARY — public tree', () => {
  test('公仓树干净：无 denylist 实现 / 无旁仓 import / 无 JWT 形状 token', () => {
    const v = inspectTree();
    eq(v.length, 0, 'violations:\n' + v.map((x) => `  [${x.kind}] ${x.path} — ${x.why}`).join('\n'));
  });

  test('denylist 真的会红（逐条证伪）', () => {
    const shouldFail = [
      'supabase/functions/bt-relay/index.ts',
      'supabase/functions/bt-grant/index.ts',
      'supabase/functions/bt-grant-ledger/index.ts',
      'supabase/functions/bt-models/index.ts',
      'supabase/functions/bt-ingest/index.ts',
      'supabase/functions/bt-delete-account/index.ts',
      'deploy/china/README.md',
      'deploy/china-relay/build-scf.sh',
      '.env',
      'certs/app.p12',
    ];
    for (const p of shouldFail) ok(denied(p), `${p} 应被 denylist 拦下，实际放行`);
  });

  test('契约 / 白名单 / mock 是仅有的例外', () => {
    const allowed = [
      'contracts/hosted-gateway.v0.yaml',
      'mocks/hosted-gateway/server.js',
      'supabase/functions/bt-ingest/events.gen.json',
      'supabase/schema.sql',
      'supabase/functions/README.md',
      'extension/content/translation-api.js',
      'app.js',
    ];
    for (const p of allowed) ok(!denied(p), `${p} 不该被拦`);
    // The whitelist exception is file-exact: the pipeline beside it is still denied.
    ok(!denied('supabase/functions/bt-ingest/events.gen.json'));
    ok(!!denied('supabase/functions/bt-ingest/pipeline.ts'));
  });

  test('inspectPaths 报出路径与原因（不是静默 true/false）', () => {
    const v = inspectPaths(['supabase/functions/bt-relay/index.ts', 'docs/ok.md']);
    eq(v.length, 1);
    eq(v[0].path, 'supabase/functions/bt-relay/index.ts');
    ok(/hosted relay/.test(v[0].why), 'violation 没带可读原因');
  });

  test('--changed 只查 HEAD 仍存在的路径：删除 denylist 不红，现存 denylist 仍红', () => {
    const atHead = new Set(['supabase/functions/bt-relay/index.ts', 'docs/ok.md']);
    const changed = [
      'deploy/china/README.md',                 // deleted by the PR: doing the boundary's work
      'supabase/functions/bt-relay/index.ts',  // modified and still present: must stay red
      'docs/ok.md',
    ];
    deepEq(filterExistingAtHead(changed, atHead), [
      'supabase/functions/bt-relay/index.ts',
      'docs/ok.md',
    ]);
    eq(inspectPaths(filterExistingAtHead(['deploy/china/README.md'], atHead)).length, 0);
    const live = inspectPaths(filterExistingAtHead(changed, atHead));
    eq(live.length, 1);
    eq(live[0].path, 'supabase/functions/bt-relay/index.ts');
  });
});
