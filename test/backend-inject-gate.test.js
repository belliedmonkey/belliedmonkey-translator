// test/backend-inject-gate.test.js — BEL-259 构建门 + BEL-260 previousUrl 哨兵边界。
//
// 这一组守两件事：
//   1. 发货构建的**生效** url/anonKey 不能是占位（空 / 哨兵常量 / .invalid / 不同源）。
//   2. previousUrl 明确不在判据里 —— 中国版哨兵 https://backend.invalid 必须能过构建门，
//      而东京 previousUrl 由 build/china-gate.js 的公开扫描拦，不靠这里开豁免。
//
// 判据用合成值：FAKE_NOT_A_JWT 与只含 role/ref 的合成 JWT。不读仓库 .local/backend.env。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { describe, test, ok, eq } = require('./harness');

const INJECT = require('../build/backend-inject.js');
const RG = require('../scripts/lib/release-gate.js');
const ROOT = path.join(__dirname, '..');
const BUILD = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `x.${b64(payload)}.y`;
const INTL_URL = 'https://abcdefgh.supabase.co';
const INTL_KEY = jwt({ role: 'anon', ref: 'abcdefgh' });
const CN_URL = 'https://api.example.cn';
const CN_KEY = jwt({ role: 'anon', iss: 'belliedmonkey' });
const PLACEHOLDER_CFG = {
  url: 'https://backend.invalid',
  anonKey: 'PUBLIC_ANON_KEY_INJECTED_AT_BUILD',
  china: { ready: false, url: '', anonKey: '' },
};
const SECRET_KEY = jwt({ role: 'anon', ref: 'otherref' });

function messages(result) {
  return result.violations.map((v) => v.message).join('\n');
}
function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mt-b259-gate-'));
}

describe('BEL-259 构建门：只查生效字段，占位必败', () => {
  test('global：真 host + 同源 JWT 通过', () => {
    const r = INJECT.checkShippable({ url: INTL_URL, anonKey: INTL_KEY }, { flavor: 'global' });
    ok(r.ok, messages(r));
    eq(r.host, 'abcdefgh.supabase.co');
    ok(/^[0-9a-f]{8}$/.test(r.anonKeySha8));
  });

  test('global：占位 url + 占位 key 必败，且报 host / 指纹 / 来源', () => {
    const r = INJECT.checkShippable(PLACEHOLDER_CFG, {
      flavor: 'global',
      values: { sources: { url: 'file', anonKey: 'none' } },
    });
    ok(!r.ok, '占位后端没被拦');
    const text = messages(r);
    ok(/placeholder constant/.test(text), text);
    const msg = INJECT.formatShippableFailure(r);
    ok(msg.includes('backend.invalid'), msg);
    ok(msg.includes('sha256:'), msg);
    ok(msg.includes('file .local/backend.env:MT_BACKEND_URL'), msg);
    ok(msg.includes('none (MT_BACKEND_ANON_KEY not set)'), msg);
    ok(!msg.includes(SECRET_KEY), '失败日志打印了 key');
  });

  test('空 / 纯空白 / 非 URL 一律红', () => {
    for (const url of ['', '   ', 'not a url']) {
      const r = INJECT.checkShippable({ url, anonKey: INTL_KEY }, { flavor: 'global' });
      ok(!r.ok, `url=${JSON.stringify(url)} 没被拦`);
    }
    const r = INJECT.checkShippable({ url: INTL_URL, anonKey: '  ' }, { flavor: 'global' });
    ok(!r.ok, '空 anonKey 没被拦');
  });

  test('china：只看 china 块；顶层仍留着 .invalid 不算数', () => {
    const cfg = {
      url: 'https://backend.invalid',
      anonKey: 'PUBLIC_ANON_KEY_INJECTED_AT_BUILD',
      china: { ready: true, url: CN_URL, anonKey: CN_KEY },
    };
    const r = INJECT.checkShippable(cfg, { flavor: 'china' });
    ok(r.ok, messages(r));
    eq(r.active, 'china');
    eq(r.host, 'api.example.cn');
  });

  test('china.ready=false：回到顶层字段，占位仍红', () => {
    const r = INJECT.checkShippable(PLACEHOLDER_CFG, { flavor: 'china' });
    ok(!r.ok, 'china.ready=false 但顶层占位没被拦');
    eq(r.active, 'intl');
  });

  test('★ previousUrl 在判据之外：.invalid 哨兵与东京值都不影响构建门', () => {
    // BEL-260 用户裁定：CN previousUrl 保持 .invalid，不注入东京。
    const cfg = {
      url: 'https://backend.invalid',
      anonKey: 'PUBLIC_ANON_KEY_INJECTED_AT_BUILD',
      previousUrl: 'https://backend.invalid',
      china: { ready: true, url: CN_URL, anonKey: CN_KEY },
    };
    ok(INJECT.checkShippable(cfg, { flavor: 'china' }).ok, '.invalid previousUrl 被构建门误杀');
    cfg.previousUrl = 'https://tokyo.supabase.co';
    ok(INJECT.checkShippable(cfg, { flavor: 'china' }).ok,
      'previousUrl 不该进入构建门判据 —— 东京值由 china-gate 公开扫描拦，不在这里开豁免');
  });

  test('不同源：supabase host + ref 不匹配 / 无 ref / 非 JWT 红', () => {
    for (const [key, why] of [
      [SECRET_KEY, 'ref 不匹配'],
      [jwt({ role: 'anon' }), '无 ref'],
      ['FAKE_NOT_A_JWT', '非 JWT'],
    ]) {
      const r = INJECT.checkShippable({ url: INTL_URL, anonKey: key }, { flavor: 'global' });
      ok(!r.ok, `${why} 没被拦`);
      ok(/ref|JWT/.test(messages(r)), messages(r));
    }
  });

  test('不同源：非 supabase host 带 supabase ref 红', () => {
    const r = INJECT.checkShippable({ url: CN_URL, anonKey: SECRET_KEY }, { flavor: 'global' });
    ok(!r.ok, '非 supabase host 带了 ref 没被拦');
    ok(/carries a supabase JWT ref/.test(messages(r)), messages(r));
  });

  test('逃生阀只认字符串 1；发布上下文拒绝', () => {
    eq(INJECT.placeholderMode({}).enabled, false);
    eq(INJECT.placeholderMode({ MT_ALLOW_PLACEHOLDER_BACKEND: 'true' }).enabled, false);
    eq(INJECT.placeholderMode({ MT_ALLOW_PLACEHOLDER_BACKEND: '1' }).enabled, true);
    for (const env of [
      { CI: 'true' },
      { MT_RELEASE: '1' },
      { MT_BUILD_CONTEXT: 'release' },
      { MT_BUILD_CONTEXT: 'store' },
      { MT_BUILD_CONTEXT: 'upload' },
      { npm_lifecycle_event: 'release:ios' },
      { npm_lifecycle_event: 'publish' },
      { npm_lifecycle_event: 'upload' },
    ]) {
      const m = INJECT.placeholderMode(Object.assign({ MT_ALLOW_PLACEHOLDER_BACKEND: '1' }, env));
      ok(m.enabled && m.refused, `发布上下文没被拒绝：${JSON.stringify(env)}`);
    }
  });

  test('allowPlaceholder：只降级占位，不同源仍硬失败', () => {
    const placeholder = INJECT.checkShippable(PLACEHOLDER_CFG, { flavor: 'global', allowPlaceholder: true });
    ok(placeholder.ok, '本地预览应允许占位');
    ok(placeholder.warnings.length >= 2, '占位应变成 warning');
    const mixed = INJECT.checkShippable({ url: INTL_URL, anonKey: SECRET_KEY }, {
      flavor: 'global', allowPlaceholder: true,
    });
    ok(!mixed.ok, '预览也不许把东京 host 和别的 ref 拼在一起');
  });
});

describe('BEL-259 构建顺序 / 逃生阀 / marker（源码形状）', () => {
  test('★ gate 必须在 fs.rmSync(DIST) 与 copyDir(SRC, DIST) 之前', () => {
    const gate = BUILD.indexOf('backendInject.assertShippable(');
    const clean = BUILD.indexOf('if (fs.existsSync(DIST)) fs.rmSync(DIST');
    const copy = BUILD.indexOf('copyDir(SRC, DIST);');
    ok(gate >= 0, 'build.js 没有 assertShippable 调用');
    ok(clean >= 0 && copy >= 0, 'clean/copy 的锚点变了');
    ok(gate < clean, 'gate 排在清目录之后 —— 失败会留下旧产物');
    ok(gate < copy, 'gate 排在拷贝之后 —— 失败已经写出了产物');
  });

  test('逃生阀强制 SKIP_ZIP，并把 marker 写进 DIST 与 APP_OUT', () => {
    ok(/const PLACEHOLDER = backendInject\.placeholderMode\(process\.env\)/.test(BUILD));
    ok(/PLACEHOLDER\.refused/.test(BUILD), '发布上下文拒绝不见了');
    ok(/SKIP_ZIP = 'placeholder backend allowed/.test(BUILD), '逃生阀没有强制 SKIP_ZIP');
    ok(/const MARKER_DIRS = \[DIST, path\.join\(ROOT, APP_OUT_NAME\)\]/.test(BUILD),
      'marker 没有同时覆盖 DIST 与 dist-app*');
    ok(/fs\.writeFileSync\(path\.join\(d, '\.not-shippable'\)/.test(BUILD));
  });

  test('switchBackend 对空 previousUrl fail closed（BEL-260 禁止项）', () => {
    const start = BUILD.indexOf('function switchBackend');
    const end = BUILD.indexOf('function limitProviders');
    ok(start >= 0 && end > start, 'switchBackend 边界变了');
    const fn = BUILD.slice(start, end);
    ok(/if \(!prev\)/.test(fn), '空 previousUrl 没有被拒绝');
    ok(/process\.exit\(1\)/.test(fn), '空 previousUrl 没有 exit 1');
  });

  test('App 包那处 ad-hoc previousUrl 正则已删除，改走共享断言', () => {
    ok(!/split\('\\n'\)\.filter\(\(l\) => !\/\^  previousUrl: '/.test(BUILD),
      'build.js 还留着 previousUrl 正则豁免');
    ok(/assertBackendInjected\(\{ dist: path\.join\(ROOT, APP_OUT\), flavor: 'china' \}\)/.test(BUILD),
      'App 包没有走共享 assertBackendInjected');
  });
});

describe('BEL-259 产物断言：共享 checker + 发布路径接线', () => {
  test('--dist：CN 真 host 通过；.invalid 红；previousUrl .invalid 不参与', () => {
    const dir = tmpdir();
    const learn = path.join(dir, 'learn');
    fs.mkdirSync(learn, { recursive: true });
    const cfg = (url) => `var MT_BACKEND = {\n`
      + `  url: '${url}',\n`
      + `  previousUrl: 'https://backend.invalid',\n`
      + `  anonKey: 'FAKE_CN_NOT_A_JWT',\n`
      + `};\n`;
    try {
      fs.writeFileSync(path.join(learn, 'backend.config.js'), cfg(CN_URL));
      const good = RG.checkBackendInjected({ dist: dir, flavor: 'china' });
      ok(good.ok, good.violations.join('\n'));
      ok(good.targets.length === 1 && good.targets[0].previousHost === 'backend.invalid');

      fs.writeFileSync(path.join(learn, 'backend.config.js'), cfg('https://cn.backend.invalid'));
      const bad = RG.checkBackendInjected({ dist: dir, flavor: 'china' });
      ok(!bad.ok, '.invalid 产物没被拦');
      ok(bad.violations.some((v) => /learn\/backend\.config\.js: url still points at \.invalid/.test(v)),
        bad.violations.join('\n'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Script.js：读 MT_BACKEND 段；previousUrl 只打印不判', () => {
    const dir = tmpdir();
    const script = `// ─── extension/learn/backend.config.js ───\n`
      + `var MT_BACKEND = {\n`
      + `  url: '${CN_URL}',\n`
      + `  previousUrl: 'https://backend.invalid',\n`
      + `  anonKey: 'FAKE_CN_NOT_A_JWT',\n`
      + `  china: { ready: true, url: 'https://cn.backend.invalid' },\n`
      + `};\n`;
    try {
      fs.writeFileSync(path.join(dir, 'Script.js'), script);
      const r = RG.checkBackendInjected({ dist: dir, flavor: 'china' });
      ok(r.ok, r.violations.join('\n'));
      eq(r.targets[0].file, 'Script.js');
      eq(r.targets[0].host, 'api.example.cn');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('intl：supabase host + 同源 ref 通过；非 supabase host 红', () => {
    const dir = tmpdir();
    const learn = path.join(dir, 'learn');
    fs.mkdirSync(learn, { recursive: true });
    const cfg = (url, key) => `var MT_BACKEND = {\n  url: '${url}',\n  anonKey: '${key}',\n};\n`;
    try {
      fs.writeFileSync(path.join(learn, 'backend.config.js'), cfg(INTL_URL, INTL_KEY));
      ok(RG.checkBackendInjected({ dist: dir, flavor: 'intl' }).ok);
      fs.writeFileSync(path.join(learn, 'backend.config.js'), cfg(CN_URL, CN_KEY));
      const r = RG.checkBackendInjected({ dist: dir, flavor: 'intl' });
      ok(!r.ok, 'intl 产物指向了非 supabase host 却没红');
      ok(r.violations.some((v) => /intl url is not a \*\.supabase\.co host/.test(v)), r.violations.join('\n'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('zip 产物：解包后读同一份配置（真实上传路径的输入形状）', () => {
    const dir = tmpdir();
    const learn = path.join(dir, 'learn');
    fs.mkdirSync(learn, { recursive: true });
    const zip = path.join(dir, 'artifact.zip');
    try {
      fs.writeFileSync(path.join(learn, 'backend.config.js'),
        `var MT_BACKEND = {\n  url: '${CN_URL}',\n  previousUrl: 'https://backend.invalid',\n  anonKey: 'FAKE_CN_NOT_A_JWT',\n};\n`);
      execFileSync('zip', ['-qr', zip, 'learn'], { cwd: dir, stdio: 'pipe' });
      const r = RG.checkBackendInjected({ artifact: zip, flavor: 'china' });
      ok(r.ok, r.violations.join('\n'));
      eq(r.targets[0].host, 'api.example.cn');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('三条发布路径都在上传/发布前调 assertBackendInjected', () => {
    const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    const gate = read('scripts/lib/release-gate.js');
    ok(/function assertBackendInjected/.test(gate), 'release-gate.js 没有共享断言');
    const checks = [
      ['scripts/amo-publish.js', 'const fd = new FormData()'],
      ['scripts/cws-publish.js', "api(token, 'PUT'"],
      ['scripts/gh-release.js', 'sh(`gh release create'],
    ];
    for (const [file, upload] of checks) {
      const src = read(file);
      const at = src.indexOf('assertVersionIntegrity(');
      const be = src.indexOf('assertBackendInjected(');
      const up = src.indexOf(upload);
      ok(be >= 0, `${file} 没接 assertBackendInjected`);
      ok(at >= 0 && be > at, `${file}: 后端断言没有排在版本门之后`);
      ok(up >= 0 && be < up, `${file}: 后端断言没有排在上传/发布之前`);
    }
  });

  test('build-safari.sh 拒绝并 unset 逃生阀', () => {
    const safari = fs.readFileSync(path.join(ROOT, 'build-safari.sh'), 'utf8');
    ok(/if \[ "\$\{MT_ALLOW_PLACEHOLDER_BACKEND:-\}" = "1" \]/.test(safari), '没有拒绝分支');
    ok(/unset MT_ALLOW_PLACEHOLDER_BACKEND/.test(safari), '没有 unset 逃生阀');
  });

  test('verify-backend-injected.js 存在且走共享 checker', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/verify-backend-injected.js'), 'utf8');
    ok(/checkBackendInjected/.test(src), 'CLI 没有用共享 checker');
    ok(/--dist/.test(src) && /--flavor/.test(src), 'CLI 参数不完整');
  });
});
