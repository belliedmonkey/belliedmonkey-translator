// test/bel230-account-switch.test.js — BEL-230：同进程换账号后，上一账号的
// bmg_ 令牌必须当场失效。
//
// 这条 bug 的形态是「没有报错、只有一笔错账」：新账号登录成功，但三槽里还是
// 上一账号那枚已经耗尽的令牌；bt-grant 幂等回传同一枚，replaceKeyTail 又只认
// 「尾号命中」，于是下一次 relay 请求用旧令牌发出、记在旧账号头上，直到重启。
//
// 钉四件事：
//   1. 换号（userId 变了）才触发；同账号重复登录不触发、不重复 claim。
//   2. 清理是 claim 之前的一笔写入 —— 三槽在 claim 开始前就已为空。
//   3. 成功之后三槽 = 新 token（plan 用旧尾号换绑）。
//   4. claim 失败也不回填旧 token —— 三槽保持空。

const { describe, test, ok, eq, rejects, loadSrc } = require('./harness');

const SPEC = {
  vendor: 'openrouter', vendorLabel: 'OpenRouter', limitUsd: 0.2,
  claimUrl: 'https://backend.example/functions/v1/bt-grant',
  models: { chat: 'deepseek/deepseek-v4-flash' },
};
const REG = {
  MT_PROVIDERS: [{ id: 'grant', type: 'chat-compat', needsKey: true, grantOnly: true,
    defaultEndpoint: 'https://backend.example/functions/v1/bt-relay/chat/completions',
    defaultModel: 'deepseek/deepseek-v4-flash' }],
  MT_TTS_ENGINES: [{ id: 'grant_speech', type: 'speech-compat', needsKey: true, grantOnly: true,
    defaultEndpoint: 'https://backend.example/functions/v1/bt-relay/audio/speech',
    defaultModel: 'deepgram/aura-2' }],
  MT_STT_ENGINES: [{ id: 'grant_stt', type: 'transcribe-compat', needsKey: true, grantOnly: true,
    defaultEndpoint: 'https://backend.example/functions/v1/bt-relay/audio/transcriptions',
    defaultModel: 'openai/gpt-4o-mini-transcribe' }],
};
const REGISTRY = { providers: REG.MT_PROVIDERS, tts: REG.MT_TTS_ENGINES, stt: REG.MT_STT_ENGINES };

const OLD_TOKEN = 'bmg_OLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDoldtail9';
const NEW_TOKEN = 'bmg_NEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWNEWnewtail8';
const OLD_TAIL = OLD_TOKEN.slice(-8);

function loadGrant() {
  return loadSrc('src/shared/grant.js', 'grant', {
    window: Object.assign({ MT_GRANT: SPEC }, REG),
    document: { createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }) },
    chrome: { i18n: { getMessage: () => '' } },
  }).grant;
}
function loadShell() {
  return loadSrc('src/app/shell-model.js', 'Shell', { URL }).Shell;
}

function oldSettings() {
  return {
    apiKey: OLD_TOKEN, apiModel: 'deepseek/deepseek-v4-flash',
    ttsApiKey: OLD_TOKEN, ttsModel: 'deepgram/aura-2',
    sttApiKey: OLD_TOKEN, sttModel: 'openai/gpt-4o-mini-transcribe', sttEngine: 'grant_stt',
    grantTail: OLD_TAIL,
    grantBalance: { spentUsd: 0.2, limitUsd: 0.2, at: Date.now() },
    grant: { vendor: 'openrouter', limitUsd: 0.2, at: Date.now() - 1000, reused: false },
  };
}

// 真实的 grant.js + 真实的 plan，只把 LearnGrant.claim 换成返回新 token 的桩。
// 这样「成功后三槽 = 新 token」考的是真 plan 的换绑路径，不是测试自己写的写入。
function makeSwitch(opts) {
  const o = opts || {};
  const G = loadGrant();
  const storage = oldSettings();
  const claims = [];
  const writes = [];
  const claimed = { token: NEW_TOKEN, limitUsd: 0.2, spentUsd: 0, reused: false };
  const LearnGrant = Object.assign({}, G, {
    claim: async () => { claims.push(1); return claimed; },
  });
  const switchFn = loadShell().createAccountSwitch({
    enabled: () => true,
    read: async () => Object.assign({}, storage),
    clear: (s) => LearnGrant.clearForAccountSwitch(s),
    write: async (patch) => { writes.push(Object.assign({}, patch)); Object.assign(storage, patch); },
    claimAndApply: async (o2) => {
      if (o.failClaim) { claims.push(1); throw Object.assign(new Error('offline'), { code: 'offline' }); }
      // 与 settingsModel.claimAndApply 同一条：先 claim，再用**同一个** plan 落盘。
      const c = await LearnGrant.claim();
      const plan = LearnGrant.plan(c, storage, REGISTRY, o2);
      Object.assign(storage, plan.writes, plan.marks);
      return { wroteAny: plan.tests.length > 0, plan };
    },
  });
  return { G, storage, writes, claims, switchFn };
}

describe('BEL-230 换号判据 —— 只有 userId 真的变了才算', () => {
  const Shell = loadShell();
  test('不同 userId ⇒ 换号；同一 userId / 任一侧为空 ⇒ 不是换号', () => {
    eq(Shell.accountSwitched({ userId: 'acct-a' }, { userId: 'acct-b' }), true);
    eq(Shell.accountSwitched({ userId: 'acct-a' }, { userId: 'acct-a' }), false,
      '同一账号重复登录被当成换号 —— 会白清一次三槽并重复 claim');
    eq(Shell.accountSwitched(null, { userId: 'acct-b' }), false, '冷启动没有「上一账号」可比');
    eq(Shell.accountSwitched({ userId: 'acct-a' }, null), false, '退出登录不是换号');
  });

  test('四条登录路径都在 show(session) 收口 —— 没有一条绕过换号清理', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'shell-model.js'), 'utf8');
    ok(/await o\.show\(session\)/.test(src), 'Google 的共用 flow 没进 show(session)');
    for (const call of [
      "LearnAuth.signInWithIdToken('apple'",
      'LearnAuth.verify(pendingEmail',
      'LearnAuth.signInPassword(',
    ]) {
      const i = src.indexOf(call);
      ok(i > -1, '找不到登录调用：' + call);
      ok(/await show\(session\)/.test(src.slice(i, i + 1600)),
        call + ' 登录成功后没有进 show(session) —— 换号清理会漏掉这条路径');
    }
  });

  test('接线：只有 switched 为真才走 switchAccountGrant，且它在 show() 的 claim 之前', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'shell-model.js'), 'utf8');
    const show = src.slice(src.indexOf('async function show('));
    ok(/const switched = accountSwitched\(prevSession, session\)/.test(show),
      'show() 没有判「账号真的变了」');
    const sw = show.indexOf('const switchP = switched ? switchAccountGrant() : null');
    ok(sw > -1, '换号串行步骤没有挂在 switched 分支里（入口即启动）');
    const call = show.indexOf('await switchP', sw);
    ok(call > sw, 'show() 没有 await 换号串行步骤');
    const claim = show.indexOf('autoClaimGrant()', call);
    ok(claim > call, '换号步骤不在自动领取之前 —— 旧令牌可能先被 claim 复用');
    const fn = src.slice(src.indexOf('async function switchAccountGrant'));
    ok(/_autoClaimed = null/.test(fn.slice(0, 500)),
      '换号没有清 _autoClaimed —— 会命中上一账号的「只领一次」memo，新账号一枚令牌都拿不到');
  });
});

describe('BEL-230 换号串行步骤 —— 清三槽 → 重新 claim → 三槽 = 新 token', () => {
  test('★ 成功后三槽都是新 token，且 claim 带的是旧尾号', async () => {
    const { storage, claims, writes, switchFn } = makeSwitch();
    await switchFn();
    eq(claims.length, 1, '换号没有重新 claim，或 claim 了不止一次');
    eq(storage.apiKey, NEW_TOKEN, '翻译槽还是上一账号的令牌');
    eq(storage.ttsApiKey, NEW_TOKEN, '朗读槽还是上一账号的令牌');
    eq(storage.sttApiKey, NEW_TOKEN, '转写槽还是上一账号的令牌');
    eq(storage.grantTail, NEW_TOKEN.slice(-8), 'grantTail 没换绑到新令牌');
    // 清理必须是一笔独立写入，且发生在 claim 之前：第一笔写掉的正是三槽 + 旧尾号。
    ok(writes.length >= 1, '一次清理都没有 —— 旧令牌会活到 claim 之后');
    eq(writes[0].apiKey, '', '第一笔写入没有清翻译槽');
    eq(writes[0].ttsApiKey, '', '第一笔写入没有清朗读槽');
    eq(writes[0].sttApiKey, '', '第一笔写入没有清转写槽');
    eq(writes[0].grantTail, '', '旧 grantTail 没清');
    eq(writes[0].grant, null, '上一账号的 grant 记录没清 —— 新账号会继承旧余额/领过状态');
  });

  test('★ claim 失败 → 三槽为空，旧令牌一个字节都不回填', async () => {
    const { storage, claims, switchFn } = makeSwitch({ failClaim: true });
    await rejects(switchFn(), /offline/);
    eq(claims.length, 1, '失败场景里 claim 没被调用 —— 这个测试什么也没证明');
    eq(storage.apiKey, '', 'claim 失败后翻译槽残留旧令牌');
    eq(storage.ttsApiKey, '', 'claim 失败后朗读槽残留旧令牌');
    eq(storage.sttApiKey, '', 'claim 失败后转写槽残留旧令牌');
    eq(storage.grantTail, '', 'claim 失败后旧 grantTail 还在');
    eq(storage.grant, null, 'claim 失败后旧 grant 记录还在');
  });

  test('用户自己的 key 不动 —— 换号只失效额度令牌', () => {
    const G = loadGrant();
    const s = Object.assign(oldSettings(), { ttsApiKey: 'sk-user-own-tts' });
    const c = G.clearForAccountSwitch(s);
    eq(c.writes.apiKey, '', '额度令牌该清');
    ok(!('ttsApiKey' in c.writes), '把用户自己粘的朗读 key 清掉了');
  });
});

describe('BEL-230 exhausted 卡 —— 重新领取入口', () => {
  const G = loadGrant();
  const t = (k, d) => d;
  test('exhausted 卡给 claim 入口（与手动重领同一路径），文案是「重新领取」', () => {
    const card = G.cardFor('exhausted', { t, balance: { spentUsd: 0.2, limitUsd: 0.2 } });
    ok(card.action, 'exhausted 卡没有 action —— 用户只剩「填自己的 key」一条路');
    eq(card.action.id, 'claim', '入口不是 claim —— 宿主不会走共用的领取路径');
    eq(card.action.text, '重新领取');
  });

  test('两个宿主都把 claim 接到共用领取路径，并在 finally 重画卡', () => {
    const fs = require('fs');
    const path = require('path');
    for (const rel of ['src/pages/options.jsx', 'src/app/settings-view.jsx']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      const at = Math.max(src.indexOf('const grantAction'), src.indexOf('function grantAction'));
      ok(at > -1, rel + ' 里找不到 grantAction');
      const fn = src.slice(at);
      ok(/id !== 'claim'/.test(fn.slice(0, 900)), rel + ' 的 grantAction 不接 claim');
      ok(/claimAndApply|LearnGrant\.claim/.test(fn.slice(0, 2600)),
        rel + ' 的 claim 没走共用领取层');
      const fin = fn.indexOf('finally');
      ok(fin > -1 && /paintGrant/.test(fn.slice(fin, fin + 400)),
        rel + ' 领取结束后没有重画额度卡 —— 成功/失败界面都停在旧状态');
    }
  });

  test('重新领取成功（新 token / 新余额）后卡回到 active，不再是 exhausted', () => {
    const s = {
      grantTail: NEW_TOKEN.slice(-8), apiKey: NEW_TOKEN,
      ttsApiKey: NEW_TOKEN, sttApiKey: NEW_TOKEN,
      grantBalance: { spentUsd: 0, limitUsd: 0.2, at: Date.now() },
      grant: { vendor: 'openrouter', limitUsd: 0.2, at: Date.now(), reused: true },
    };
    eq(G.status(s, { signedIn: true }), 'active', '新余额没让卡离开 exhausted');
    const card = G.cardFor('active', { t, balance: s.grantBalance });
    eq(card.action, null, 'active 卡还挂着领取按钮');
  });
});
