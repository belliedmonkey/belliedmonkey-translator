// test/quota.test.js — P1-1：额度只有一份运行时来源、一个数字口径、一份 stale 语义。
//
// 守三件事：
//   1. 设置页的额度卡与对话/字幕的额度条**显示同一个量**（spent / limit）。旧实现
//      设置页显示剩余、字幕条显示已用，同一个 grantBalance 会变成 $0.06 vs $0.14。
//   2. 进设置 / 回前台走 quota.refresh()：成功写回同一个 grantBalance，两个订阅者
//      拿到同一个对象；失败保留上次值并打 stale，formatter 明确标注「未刷新」。
//   3. 余额端点的推导对 intl（bt-grant）与 CN（/claim）两种构建都成立。
const fs = require('fs');
const path = require('path');
const { describe, test, ok, eq, deepEq, loadSrc } = require('./harness');

const ROOT = path.join(__dirname, '..');
const NOW = 1_800_000_000_000;
const SPEC = {
  vendor: 'openrouter', vendorLabel: 'OpenRouter', limitUsd: 0.2,
  claimUrl: 'https://backend.example/functions/v1/bt-grant',
  models: { chat: 'deepseek/deepseek-v4-flash' },
};
const REG = {
  MT_PROVIDERS: [{ id: 'grant', type: 'chat-compat', grantOnly: true,
    defaultEndpoint: 'https://backend.example/functions/v1/bt-relay/chat/completions' }],
  MT_TTS_ENGINES: [], MT_STT_ENGINES: [],
};

function makeStorage(seed) {
  const data = Object.assign({}, seed || {});
  return {
    data,
    get(keys, cb) {
      const out = {};
      for (const k of keys) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
      cb(out);
    },
    set(patch, cb) { Object.assign(data, patch); if (cb) cb(); },
  };
}

function loadQuota(opts) {
  const o = opts || {};
  const win = Object.assign({ MT_GRANT: o.spec === undefined ? SPEC : o.spec }, REG);
  return loadSrc('src/shared/quota.js', 'Quota', {
    window: win,
    fetch: o.fetch || (async () => { throw new Error('no network'); }),
    URL,
    chrome: { storage: { local: o.storage || makeStorage() } },
  }).Quota;
}

function loadGrant() {
  return loadSrc('src/shared/grant.js', 'grant', {
    window: Object.assign({ MT_GRANT: SPEC }, REG),
    document: { createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }) },
    chrome: { i18n: { getMessage: () => '' } },
  }).grant;
}

const t = (k, d) => d;
const settings = (bal) => Object.assign({
  grantTail: 'tail1234', apiKey: 'bmg-token-tail1234', grantBalance: bal,
}, {});

describe('P1-1 额度口径 — 设置页与字幕/对话只显示 spent / limit', () => {
  test('同一个 grantBalance：设置卡与 N26 字幕条数字逐字相同（旧实现 $0.06 vs $0.14）', () => {
    const G = loadGrant();
    const N = loadSrc('src/app/n26-session.js', 'N26', {
      window: Object.assign({ MT_GRANT: SPEC }, REG), URL,
    }).N26;
    const bal = { spentUsd: 0.14, limitUsd: 0.2, at: NOW };
    const card = G.cardFor('active', { t, balance: bal, now: NOW });
    eq(card.progress.text, '$0.14 / $0.20');
    eq(N.meterText(bal, { t, now: NOW }), '$0.14 / $0.20');
    eq(card.progress.spent, 0.14);
  });

  test('用完时两处都是 $0.20 / $0.20，不是剩余 $0.00', () => {
    const G = loadGrant();
    const N = loadSrc('src/app/n26-session.js', 'N26', {
      window: Object.assign({ MT_GRANT: SPEC }, REG), URL,
    }).N26;
    const bal = { spentUsd: 0.2, limitUsd: 0.2, at: NOW };
    eq(G.cardFor('exhausted', { t, balance: bal, now: NOW }).progress.text, '$0.20 / $0.20');
    eq(N.meterText(bal, { t, now: NOW }), '$0.20 / $0.20');
  });

  test('两处都从同一个 provider 取数 —— 源码里设置页 / 对话页都接 quota.refresh', () => {
    const files = {
      settings: fs.readFileSync(path.join(ROOT, 'src/app/settings-view.jsx'), 'utf8'),
      options: fs.readFileSync(path.join(ROOT, 'src/pages/options.jsx'), 'utf8'),
      listen: fs.readFileSync(path.join(ROOT, 'src/app/listen-model.js'), 'utf8'),
    };
    ok(/Quota\.refresh\(/.test(files.settings), 'App 设置页没有走 quota.refresh');
    ok(/Quota\.refresh\(/.test(files.options), '扩展设置页没有走 quota.refresh');
    ok(/Quota\.refresh\(/.test(files.listen), '对话/字幕没有走 quota.refresh');
    ok(/spentText|grant\.js/.test(files.settings + files.options) || /LearnGrant\.status/.test(files.settings),
      '设置页不再经 grant.js 的共用状态/格式化');
  });
});

describe('P1-1 刷新 — 成功同源，失败保留旧值并标注', () => {
  test('进设置 force 刷新：写回同一个 grantBalance，两个订阅者看到同一个对象', async () => {
    const storage = makeStorage({
      grantTail: 'tail1234', apiKey: 'bmg-token-tail1234',
      grantBalance: { spentUsd: 0.06, limitUsd: 0.2, at: NOW - 60_000 },
    });
    const Q = loadQuota({
      storage,
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ spent_usd: 0.15, limit_usd: 0.2 }) }),
    });
    const seen = [];
    Q.subscribe((b) => seen.push({ who: 'settings', b: JSON.parse(JSON.stringify(b)) }));
    Q.subscribe((b) => seen.push({ who: 'listen', b: JSON.parse(JSON.stringify(b)) }));
    const r = await Q.refresh({ force: true, now: () => NOW });
    eq(r.ok, true);
    eq(r.balance.spentUsd, 0.15);
    eq(storage.data.grantBalance.spentUsd, 0.15);
    eq(storage.data.grantBalance.at, NOW);
    eq(seen.length, 2, '两个订阅者都该收到刷新结果');
    deepEq(seen[0].b, seen[1].b);
    eq(Q.spentText(seen[0].b, { t, now: NOW }), '$0.15 / $0.20');
  });

  test('断网：保留上次 spent，打 stale，两处 formatter 都标注「未刷新」', async () => {
    const storage = makeStorage({
      grantTail: 'tail1234', apiKey: 'bmg-token-tail1234',
      grantBalance: { spentUsd: 0.06, limitUsd: 0.2, at: NOW - 60_000 },
    });
    const Q = loadQuota({ storage, fetch: async () => { throw new Error('offline'); } });
    const r = await Q.refresh({ force: true, now: () => NOW });
    eq(r.ok, false);
    eq(r.balance.spentUsd, 0.06, '失败时不许把旧值丢掉，也不许改写成 0');
    eq(r.balance.stale, true);
    eq(storage.data.grantBalance.spentUsd, 0.06);
    eq(storage.data.grantBalance.stale, true);
    ok(/未刷新/.test(Q.spentText(r.balance, { t, now: NOW })), '旧值必须标注，不能冒充当前');
  });

  test('下一次成功刷新清掉 stale，数字统一前进', async () => {
    const storage = makeStorage({
      grantTail: 'tail1234', apiKey: 'bmg-token-tail1234',
      grantBalance: { spentUsd: 0.06, limitUsd: 0.2, at: NOW - 60_000, stale: true, staleReason: 'offline' },
    });
    const Q = loadQuota({
      storage,
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ spent_usd: 0.14, limit_usd: 0.2 }) }),
    });
    const r = await Q.refresh({ force: true, now: () => NOW });
    eq(r.ok, true);
    eq(storage.data.grantBalance.stale, undefined);
    eq(Q.spentText(storage.data.grantBalance, { t, now: NOW }), '$0.14 / $0.20');
  });

  test('没有额度规格 / 不是额度槽：不发请求，不写存储', async () => {
    const storage = makeStorage({ grantTail: '', apiKey: 'sk-mine' });
    let calls = 0;
    const Q = loadQuota({ spec: null, storage, fetch: async () => { calls++; return { ok: true, json: async () => ({}) }; } });
    const r = await Q.refresh({ force: true, now: () => NOW });
    eq(r.code, 'grant_unavailable');
    eq(calls, 0);
    eq(storage.data.grantBalance, undefined);
  });
});

describe('P1-1 余额端点 — intl / CN 两种 claimUrl', () => {
  test('intl：bt-grant → bt-relay/balance', () => {
    const Q = loadQuota();
    eq(Q.balanceUrl({ claimUrl: 'https://backend.example/functions/v1/bt-grant' }),
      'https://backend.example/functions/v1/bt-relay/balance');
  });
  test('CN：/claim → /balance', () => {
    const Q = loadQuota();
    eq(Q.balanceUrl({ claimUrl: 'https://relay.example/claim' }), 'https://relay.example/balance');
  });
});

describe('P1-2 来源标记 — 不读 DOM，启动重开后仍按登录态回', () => {
  test('listen-model 的 open() 不再读 #signed-in.hidden', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/app/listen-model.js'), 'utf8');
    ok(!/cameFrom\s*=\s*\$\(\s*'signed-in'\s*\)\.hidden/.test(src),
      'open() 还在用 DOM 可见性判 cameFrom');
    ok(/sessionGetter/.test(src) && /sourceNow\(\)/.test(src), '没有显式 session 来源');
  });
});
