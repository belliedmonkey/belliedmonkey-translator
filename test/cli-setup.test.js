// test/cli-setup.test.js — 交互式首次配置：登录 → 自动领免费额度（learning-design §9.10 / §8.10）。
//
// 复用 src/shared/grant.js 的编译产物（dist-cli/grant.js）。后端是一个假的
// GoTrue + 领取端点；语料/配置/状态都落在临时目录。
'use strict';
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const { test, describe, ok, eq } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const { guidedSetup, pageUrl } = require('../cli/setup.js');
const messages = require('../cli/messages.js');

function fakeServer() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization || '' });
      const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url.startsWith('/auth/v1/otp')) return json(200, {});
      if (req.url.startsWith('/auth/v1/verify')) {
        return json(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, user: { id: 'u1', email: 'me@example.com' } });
      }
      if (req.url.startsWith('/functions/v1/bt-grant')) {
        return json(200, { token: 'bmg_test-token-0001', limit_usd: 0.2, spent_usd: 0.0, reused: false });
      }
      return json(404, { message: 'nope ' + req.url });
    });
  });
  return { server, seen };
}
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));

// 在子进程里跑 guidedSetup（避免污染本进程的全局，也照实际用它的方式）。
const SCRIPT = `
const { guidedSetup } = require('./cli/setup.js');
const answers = ['me@example.com', '123456'];
const ask = () => Promise.resolve(answers.shift() || '');
guidedSetup({}, { ask, out: (s) => console.log(s), err: (s) => console.error(s) })
  .then((r) => { console.log('RESULT ' + JSON.stringify(r)); process.exit(r && r.ok ? 0 : 5); })
  .catch((e) => { console.error('ERR ' + (e && e.stack || e)); process.exit(1); });
`;
function runScript(script, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['-e', script], { cwd: ROOT, env: Object.assign({}, process.env, env), encoding: 'utf8' },
      (err, stdout, stderr) => resolve({ code: err ? (err.code || 1) : 0, stdout, stderr }));
  });
}

describe('cli-setup: 登录 → 领免费额度 → 写配置（§9.10）', () => {
  test('★ 引导配置：登录后领取，配置里出现 grant 令牌', async () => {
    const { server, seen } = fakeServer();
    const port = await listen(server);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-setup-'));
    const confDir = path.join(dir, 'conf');
    const env = {
      BM_BACKEND_URL: `http://127.0.0.1:${port}`,
      BM_BACKEND_ANON: 'anon',
      BM_GRANT_CLAIM_URL: `http://127.0.0.1:${port}/functions/v1/bt-grant`,
      BELLIEDMONKEY_CONFIG_DIR: confDir,
      BM_STATE: path.join(dir, 'state.json'),
      BM_CORPUS: path.join(dir, 'corpus.mtlearn'),
    };
    try {
      const r = await runScript(SCRIPT, env);
      eq(r.code, 0, 'setup 应成功，stderr=' + r.stderr);
      const conf = JSON.parse(fs.readFileSync(path.join(confDir, 'config.json'), 'utf8'));
      eq(conf.provider, 'grant', 'provider 应是 grant（中继）');
      eq(conf.apiKey, 'bmg_test-token-0001', 'apiKey 应是领取到的令牌');
      ok(conf.apiModel, '模型要钉进配置（否则撞 403 model_not_allowed）');
      eq(conf.engineChosen, true, '选中引擎这个动作要记下');
      ok(conf.grantTail && conf.grantTail.length === 8, 'grantTail 要写回');
      // 领取请求带 Bearer 登录令牌。
      const claim = seen.find((x) => x.url.startsWith('/functions/v1/bt-grant'));
      ok(claim && /^Bearer at-1/.test(claim.auth), '领取请求要带 Bearer，实际 ' + (claim && claim.auth));
      // 会话落进 state.json（同步也会用它）。
      const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
      ok(state.storage && state.storage.learnAuth && state.storage.learnAuth.userId === 'u1', '会话要落盘');
    } finally { server.close(); }
  });

  test('中国版不代领额度：明确拒绝并指向自带 key', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-setup-cn-'));
    const r = await runScript(SCRIPT, {
      BM_CLI_FLAVOR: 'china',
      BELLIEDMONKEY_CONFIG_DIR: path.join(dir, 'conf'),
      BM_STATE: path.join(dir, 'state.json'),
    });
    eq(r.code, 5, '中国版应拒绝（退出 5）');
    ok(/China build|中国版/.test(r.stdout + r.stderr), '要说清楚是中国版没有代领额度');
    ok(!fs.existsSync(path.join(dir, 'conf', 'config.json')), '拒绝时不该写配置');
  });

  test('额度用完的引导：文案与页面地址', () => {
    ok(messages.t('cli_exhausted_hint', 'zh_CN').includes('{url}'), '要有页面占位');
    ok(/config set provider/.test(messages.t('cli_exhausted_hint', 'zh_CN')), '要给出配 key 的路');
    ok(/bm setup/.test(messages.t('cli_setup_hint', 'zh_CN')), '未配置时先指向 setup');
    ok(/belliedmonkey\.(cc|com)\/setup\.html$/.test(pageUrl()), '页面地址应是官网 setup.html，实际 ' + pageUrl());
  });
});
