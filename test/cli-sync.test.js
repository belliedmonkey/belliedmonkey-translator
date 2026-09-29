// test/cli-sync.test.js — 命令行宿主的登录与同步（learning-design §9.10 / §8）。
//
// 复用 learn/auth.js + learn/sync.js 的**同一份字节**，只换掉脚下的存储（state.json）
// 与语料（mt-learn/1 文件）。这里跑一条真的闭环：A 采集 → 登录 → 推送；B 登录 → 拉取
// → 拿到 A 的卡。后端是一个假的 GoTrue + PostgREST，只实现用到的那几个端点。
'use strict';
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const { test, describe, ok, eq } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const { Corpus } = require('../cli/corpus.js');

// ── 假后端：GoTrue /auth/v1/* + PostgREST /rest/v1/bt_chunks ────────────────
function fakeBackend() {
  const rows = [];
  let seq = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (p === '/auth/v1/otp') return json(200, {});
      if (p === '/auth/v1/verify' || p === '/auth/v1/token') {
        return json(200, {
          access_token: 'at-' + Math.random().toString(36).slice(2),
          refresh_token: 'rt-1', expires_in: 3600,
          user: { id: 'u1', email: 'me@example.com' },
        });
      }
      if (p === '/auth/v1/logout') return json(200, {});
      if (p === '/rest/v1/rpc/bt_usage') return json(200, [{ bytes: 0, chunks: rows.length, quota: 52428800 }]);
      if (p === '/rest/v1/bt_chunks' && req.method === 'POST') {
        const obj = JSON.parse(body || '{}');
        seq += 1;
        rows.push({ seq, kind: obj.kind, blob: obj.blob, generation: obj.generation || 0 });
        return json(201, [{ seq }]);
      }
      if (p === '/rest/v1/bt_chunks' && req.method === 'GET') {
        const gt = Number((url.searchParams.get('seq') || 'gt.0').replace('gt.', '')) || 0;
        const out = rows.filter((r) => r.seq > gt).map((r) => ({ seq: r.seq, blob: r.blob }));
        return json(200, out);
      }
      if (p === '/rest/v1/bt_chunks' && req.method === 'DELETE') return json(204, null);
      return json(404, { message: 'not found ' + p });
    });
  });
  return { server, rows };
}

function runCli(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(ROOT, 'cli', 'bin', 'belliedmonkey.js')].concat(args),
      { env: Object.assign({}, process.env, env || {}), encoding: 'utf8' },
      (err, stdout, stderr) => resolve({ code: err ? (err.code || 1) : 0, stdout, stderr }));
  });
}

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

describe('cli-sync: 登录 + 同步闭环（§9.10）', () => {
  test('★ A 推送 → B 拉取，语料跨设备一致', async () => {
    const { server, rows } = fakeBackend();
    const port = await listen(server);
    const base = { BM_BACKEND_URL: `http://127.0.0.1:${port}`, BM_BACKEND_ANON: 'anon' };
    try {
      const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-sync-a-'));
      const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-sync-b-'));
      const corpusA = path.join(dirA, 'corpus.mtlearn');
      const corpusB = path.join(dirB, 'corpus.mtlearn');

      // A：采集两张卡。
      const a = new Corpus(corpusA);
      a.capture('Seed sentence one.', '种子句一。', { targetLang: 'zh-CN' }, Date.now());
      a.capture('Seed sentence two.', '种子句二。', { targetLang: 'zh-CN' }, Date.now());
      await a.save();

      const envA = Object.assign({}, base, { BM_CORPUS: corpusA, BM_STATE: path.join(dirA, 'state.json') });
      const envB = Object.assign({}, base, { BM_CORPUS: corpusB, BM_STATE: path.join(dirB, 'state.json') });

      // A 登录 + 同步。
      const loginA = await runCli(['login', 'me@example.com', '--code', '123456'], envA);
      eq(loginA.code, 0, 'login A stderr=' + loginA.stderr);
      ok(/已登录/.test(loginA.stdout), 'login 要报身份，实际 ' + loginA.stdout);
      const syncA = await runCli(['sync', '--json'], envA);
      eq(syncA.code, 0, 'sync A stderr=' + syncA.stderr);
      const pushedA = JSON.parse(syncA.stdout);
      eq(pushedA.pushed.pushed, 2, 'A 要推送 2 张');
      ok(rows.length >= 1, '假后端应收到 chunk');

      // B 登录 + 同步 → 拉到 A 的卡。
      const loginB = await runCli(['login', 'me@example.com', '--code', '123456'], envB);
      eq(loginB.code, 0, 'login B stderr=' + loginB.stderr);
      const syncB = await runCli(['sync', '--json'], envB);
      eq(syncB.code, 0, 'sync B stderr=' + syncB.stderr);
      const pulledB = JSON.parse(syncB.stdout);
      eq(pulledB.pulled.cards, 2, 'B 要拉取 2 张');

      const planB = await runCli(['plan', '--corpus', corpusB, '--json'], {});
      eq(JSON.parse(planB.stdout).total, 2, 'B 的语料应有 2 张');

      // whoami 读回会话。
      const who = await runCli(['whoami'], envB);
      eq(who.code, 0);
      ok(/me@example\.com/.test(who.stdout), 'whoami 要显示邮箱，实际 ' + who.stdout);
    } finally { server.close(); }
  });

  test('未登录 sync ⇒ 退出码 5 并提示先登录', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-sync-c-'));
    const r = await runCli(['sync', '--corpus', path.join(dir, 'c.mtlearn'), '--state', path.join(dir, 's.json')], {});
    eq(r.code, 5, '未登录同步应退出 5，实际 ' + r.code + ' / ' + r.stderr);
    ok(/未登录|signed_out/.test(r.stdout + r.stderr), '要说清楚是没登录');
  });
});

describe('cli-sync: 存储与适配器（单元）', () => {
  test('state.json 往返：storage 与 meta 都保留，权限 0600', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-state-'));
    const file = path.join(dir, 'state.json');
    const stateMod = require('../cli/state.js');
    const s = stateMod.load(file);
    const chrome = stateMod.makeChrome(s);
    chrome.storage.local.set({ learnAuth: { userId: 'u1' } }, () => {});
    s.meta.syncCursor = 7;
    stateMod.save(s);

    const back = stateMod.load(file);
    eq(back.storage.learnAuth.userId, 'u1');
    eq(back.meta.syncCursor, 7);
    ok((fs.statSync(file).mode & 0o777) === 0o600, 'state.json 必须 0600');
  });

  test('store 适配器：meta 读写 + markSynced 盖章', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-adapter-'));
    const corpus = new Corpus(path.join(dir, 'c.mtlearn'));
    const state = { file: path.join(dir, 's.json'), storage: {}, meta: {} };
    const { makeStore } = require('../cli/store-adapter.js');
    const store = makeStore(corpus, state);
    await store.setMeta('k', 1);
    eq(await store.getMeta('k', 0), 1);
    await store.setMeta('k', null);
    eq(await store.getMeta('k', 42), 42, '删掉后回默认值');

    corpus.capture('One card.', '一张卡。', { targetLang: 'zh-CN' }, Date.now());
    const card = corpus.allItems()[0];
    await store.mergeBatch([card], [], { accumulate: false, markSynced: true });
    ok(corpus.itemById(card.id).syncedAt > 0, 'markSynced 要给卡盖章');
  });
});
