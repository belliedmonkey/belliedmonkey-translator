// test/china-host-literals.test.js — 中国版 App 包不得带着宿主字面量过合规门。
//
// 源文件 agent/credentials.js 仍是 Node 宿主与国际版的字面量。中国版只在 esbuild
// 进 Script.js 之前改写。两组都要在：不改写的包必须还能被门打红（门还活着），
// 改写后的包必须绿，而且 resolveCredential 的表与优先级与源文件逐字相同。

const fs = require('fs');
const path = require('path');
const { describe, test, ok, deepEq } = require('./harness');
const G = require('../build/china-gate.js');
const { rewriteCredentialsSource, rewriteBundledCredentials } = require('../build/china-host-literals.js');
const { buildOptions } = require('../build/run-esbuild.js');

const ROOT = path.join(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'agent/credentials.js');

function loadCjs(src) {
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  const fn = new Function('module', 'exports', src);
  fn(module, module.exports);
  return module.exports;
}

function bundle() {
  const esbuild = require('esbuild');
  return esbuild.buildSync(buildOptions({
    entryPoints: [SRC_PATH],
    write: false,
    sourcemap: false,
    format: 'cjs',
  })).outputFiles[0].text;
}

function scan(text) {
  return G.scan([{ name: 'Script.js', text }], { grantHost: '' });
}

describe('中国版 App：宿主字面量改写', () => {
  const source = fs.readFileSync(SRC_PATH, 'utf8');
  const original = loadCjs(source);
  const rewrittenSrc = rewriteCredentialsSource(source);
  const rewritten = loadCjs(rewrittenSrc);

  test('不改写时合规门仍然打得红', () => {
    const bare = bundle();
    ok(scan(bare).length >= 7, '未改写的 credentials 包没有撞门 —— 门或字面量丢了');
    ok(bare.includes('OPENAI_API_KEY'), '国际版要留下的 env 名不在未改写的包里');
    ok(bare.includes('claude-code'), '未改写的包里没有宿主 id');
  });

  test('改写后的包过门，运行时的表与源文件相同', () => {
    ok(scan(rewrittenSrc).length === 0, '改写后的源文本仍撞门:\n' + scan(rewrittenSrc).join('\n'));
    const packed = rewriteBundledCredentials(bundle());
    ok(scan(packed).length === 0, '改写后的包仍撞门:\n' + scan(packed).join('\n'));
    ok(!packed.includes('OPENAI_API_KEY'), '改写后的包里还有 env 名整词');
    ok(!packed.includes('claude-code'), '改写后的包里还有宿主 id 整词');
    const packedMod = loadCjs(packed);
    deepEq(packedMod.HOST_SUBSCRIPTION, original.HOST_SUBSCRIPTION);
    deepEq(packedMod.HOST_KEYS, original.HOST_KEYS);
    deepEq(rewritten.HOST_SUBSCRIPTION, original.HOST_SUBSCRIPTION);
    deepEq(rewritten.HOST_KEYS, original.HOST_KEYS);
  });

  test('credentials 段以外的品牌词仍留给合规门', () => {
    const planted = bundle() + '\n// agent/after.js\nvar leak = "api.openai.com";\n';
    const out = rewriteBundledCredentials(planted);
    const hits = scan(out);
    ok(hits.length === 1, '段外泄漏被改写抹掉了，或 credentials 段没改干净:\n' + hits.join('\n'));
    ok(hits[0].includes('api.openai.com'), '留下的不是段外那条泄漏');
  });

  test('优先级仍是 host_subscription → host_key → byok → grant', () => {
    const cases = [
      [{ env: { ANTHROPIC_AUTH_TOKEN: 's', ANTHROPIC_API_KEY: 'k' }, readiness: { byok: true, grant: true } },
        { kind: 'host_subscription', via: 'ANTHROPIC_AUTH_TOKEN', host: 'claude-code', provider: 'anthropic' }],
      [{ env: { OPENAI_API_KEY: 'k' }, readiness: { byok: true, grant: true } },
        { kind: 'host_key', via: 'OPENAI_API_KEY', host: 'codex', provider: 'openai' }],
      [{ env: { CODEX_ACCESS_TOKEN: 's' }, readiness: {} },
        { kind: 'host_subscription', via: 'CODEX_ACCESS_TOKEN', host: 'codex', provider: 'openai' }],
      [{ env: { DEEPSEEK_API_KEY: 'k' }, readiness: { grant: true } },
        { kind: 'host_key', via: 'DEEPSEEK_API_KEY', host: 'dsh', provider: 'deepseek' }],
      [{ env: { ANTHROPIC_API_KEY: '   ' }, readiness: { byok: true, grant: true } },
        { kind: 'byok', via: 'app', host: '', provider: '' }],
      [{ env: {}, readiness: { grant: true } },
        { kind: 'grant', via: 'grant', host: '', provider: '' }],
      [{ env: {}, readiness: {} },
        { kind: 'none', via: '', host: '', provider: '' }],
    ];
    for (const [input, want] of cases) {
      deepEq(original.resolveCredential(input), want);
      deepEq(rewritten.resolveCredential(input), want);
    }
  });

  test('开关只挂在中国版 App 的 esbuild 上', () => {
    const buildJs = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
    const bundleJs = fs.readFileSync(path.join(ROOT, 'build/app-bundle.js'), 'utf8');
    const call = buildJs.slice(buildJs.lastIndexOf('buildAppBundle('));
    ok(/rewriteHostLiterals: true/.test(call), 'build.js 的中国版没有打开 rewriteHostLiterals');
    ok(/: \{\}/.test(call), '国际版 buildAppBundle 不再是空选项 —— 改写会漏进国际包');
    ok(/if \(opts\.rewriteHostLiterals\) script = rewriteBundledCredentials\(script\)/.test(bundleJs),
      'app-bundle.js 没有把改写限定在 rewriteHostLiterals 上');
  });
});
