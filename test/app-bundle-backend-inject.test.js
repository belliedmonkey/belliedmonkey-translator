// test/app-bundle-backend-inject.test.js — App 包的后端配置必须**在拼包时**注入。
//
// BEL-197（P0）：build.js 用 `backendInject.applyToDir` 把真实 host / anon key 注入
// `dist/learn/backend.config.js`，但 build/app-bundle.js 拼的是**源码**那份
// `extension/learn/backend.config.js`。于是 `node build.js` 直出的
// `dist-app/Script.js` 里还留着 `https://backend.invalid` 与
// `PUBLIC_ANON_KEY_INJECTED_AT_BUILD`；质量抽核看到安装包里是 0，是因为事后又对
// dist-app 单独跑了一次 inject —— 那正好把「管道本身没接上」藏起来了。
//
// 所以这条测试**跑真的 buildAppBundle**，而不是只测一个替换函数：漏掉那一次
// `backendInject.apply` 的回归，必须在这里当场变红。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test, ok, eq } = require('./harness');

// 临时改 process.env，结束后逐字还原（包括「原本不存在」这个状态）。
function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  for (const k of Object.keys(env)) process.env[k] = env[k];
  try {
    return fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const count = (text, needle) => text.split(needle).length - 1;

describe('build/app-bundle.js — 后端配置在拼进 Script.js 之前已注入', () => {
  test('★ 产出里没有 .invalid 占位 host / 占位 anon key（BEL-197 回归）', () => {
    // 全部四个 sentinel 都用 env 覆盖：env 优先于 .local/backend.env，测试不依赖
    // 这台机器上有没有那份文件，也不读它的值。
    const GLOBAL_URL = 'https://app-bundle-test.supabase.co';
    const GLOBAL_KEY = 'app-bundle-test-anon-key';
    const CHINA_URL = 'https://app-bundle-cn-test.example';
    const CHINA_KEY = 'app-bundle-cn-test-anon-key';

    const js = withEnv({
      MT_BACKEND_URL: GLOBAL_URL,
      MT_BACKEND_ANON_KEY: GLOBAL_KEY,
      MT_CHINA_BACKEND_URL: CHINA_URL,
      MT_CHINA_BACKEND_ANON_KEY: CHINA_KEY,
    }, () => {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-app-inject-'));
      const { buildAppBundle } = require('../build/app-bundle.js');
      buildAppBundle(out, () => {}, {});
      return fs.readFileSync(path.join(out, 'Script.js'), 'utf8');
    });

    // 只看 backend.config.js 那一段。整份 Script.js 里还有 build.js 生成的
    // providers/stt/tts/i18n 注册表；在**被 scrub 过的 checkout** 里它们也带
    // `https://backend.invalid` 占位，而这条测试直接调 buildAppBundle、不先跑
    // generate*。整包断言会被那些合法占位绊倒（假红），真正要钉的是这一段。
    const HEAD = '// ─── extension/learn/backend.config.js ';
    const start = js.indexOf(HEAD);
    ok(start >= 0, 'Script.js 里找不到 backend.config.js 段 —— 拼包结构变了');
    eq(js.indexOf(HEAD, start + 1), -1, 'backend.config.js 段出现了不止一次');
    const nextBanner = js.indexOf('\n// ─── ', start + HEAD.length);
    ok(nextBanner > start, 'backend.config.js 段后面没有下一段 banner —— 段边界找不到');
    const seg = js.slice(start, nextBanner);

    // 漏注入的两种形状：host 还是 .invalid，key 还是占位符。
    eq(count(seg, 'https://backend.invalid'), 0,
      'backend.config.js 段里还有 https://backend.invalid —— app-bundle 没走 backendInject.apply');
    eq(count(seg, 'PUBLIC_ANON_KEY_INJECTED_AT_BUILD'), 0,
      'backend.config.js 段里还有 PUBLIC_ANON_KEY_INJECTED_AT_BUILD —— app-bundle 没走 backendInject.apply');
    eq(count(seg, 'https://cn.backend.invalid'), 0,
      'app-bundle 没注入 china.url —— 同一个 apply 必须覆盖全部 sentinel');
    eq(count(seg, 'PUBLIC_CN_ANON_KEY_INJECTED_AT_BUILD'), 0,
      'app-bundle 没注入 china.anonKey —— 同一个 apply 必须覆盖全部 sentinel');

    // 注入的是**这一份**配置，不是别的构建残留。
    ok(seg.includes(GLOBAL_URL), '这一段里没有 env 给的 MT_BACKEND_URL —— 注入值不对');
    ok(seg.includes(GLOBAL_KEY), '这一段里没有 env 给的 MT_BACKEND_ANON_KEY —— 注入值不对');
    ok(seg.includes(CHINA_URL), '这一段里没有 env 给的 MT_CHINA_BACKEND_URL —— 注入值不对');
    ok(seg.includes(CHINA_KEY), '这一段里没有 env 给的 MT_CHINA_BACKEND_ANON_KEY —— 注入值不对');
  });
});
