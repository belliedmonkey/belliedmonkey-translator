// test/grant.test.js — 免费额度的客户端核心（docs/learning-design.md §8.10）。
//
// 三件事只有纯逻辑测得住，而它们全都会**静默**出错：
//   · plan 写出来的键必须落在宿主认得的集合里 —— 不在里面的键 saveAll() 读不回来，
//     下一次任何字段变更就会把它清掉。不报错，只是配置自己消失。
//   · 「可覆盖」的判据是尾号命中，不是「反正是我们写的」。判宽了就会盖掉**用户自己
//     粘的 key**，而那是他花时间申请来的东西。
//   · 状态机的顺序即优先级。「池子空了」排在「你用完了」前面 —— 后者会让用户去查
//     自己的账户，查一晚上也查不出来，因为那边根本没问题。
const { describe, test, eq, ok, deepEq, loadModule } = require('./harness');

const SPEC = {
  vendor: 'openrouter', limitUsd: 0.2,
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

function load(spec) {
  const win = Object.assign({ MT_GRANT: spec === undefined ? SPEC : spec }, REG);
  const ctx = loadModule(['learn/quick-setup.js', 'learn/grant.js'], {
    window: win, document: { createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }) },
    chrome: { i18n: { getMessage: () => '' } },
  });
  return { G: ctx.LearnGrant, QS: ctx.QuickSetup, win };
}

const TOKEN = 'bmg_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAtail1234';
const claimed = { token: TOKEN, limitUsd: 0.2, spentUsd: 0, reused: false };

describe('§8.10 spec —— 中国版没有这个东西', () => {
  test('MT_GRANT 为 null 时 enabled 为假，claim 具名失败', async () => {
    const { G } = load(null);
    eq(G.enabled(), false);
    eq(G.spec(), null);
    let code = '';
    try { await G.claim({}); } catch (e) { code = e.code; }
    eq(code, 'grant_unavailable', '不可用时必须具名，不能抛一个看不懂的东西');
  });

  test('有 spec 时 enabled 为真', () => { eq(load().G.enabled(), true); });
});

describe('§8.10 plan —— 只算 patch，且键必须是宿主认得的', () => {
  const { G } = load();

  test('空配置：三槽都写，模型被钉住（留空会撞 403）', () => {
    const r = G.plan(claimed, {}, REG);
    eq(r.writes.provider, 'grant');
    eq(r.writes.apiKey, TOKEN);
    eq(r.writes.apiModel, 'deepseek/deepseek-v4-flash', '模型必须写死 —— 中继按白名单放行');
    eq(r.writes.ttsEngine, 'grant_speech');
    eq(r.writes.ttsModel, 'deepgram/aura-2');
    eq(r.writes.sttEngine, 'grant_stt');
    eq(r.writes.sttModel, 'openai/gpt-4o-mini-transcribe');
    eq(r.writes.apiBaseUrl, '', '端点必须写空 —— 留着上一个引擎的地址配新 key 是明文禁止的');
  });

  test('★ writes 的每个键都在宿主的 SETTINGS_KEYS 里', () => {
    // 这条是整份文件里最贵的一条。不在集合里的键 saveAll() 读不回来，
    // 下一次任何字段变更就会把它清掉 —— 不报错，配置自己消失。
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'extension/options/options.js'), 'utf8');
    const m = src.match(/SETTINGS_KEYS\s*=\s*\[([\s\S]*?)\]/);
    ok(m, 'options.js 里找不到 SETTINGS_KEYS —— 这条断言在空转');
    const known = new Set((m[1].match(/'([A-Za-z0-9_]+)'/g) || []).map((x) => x.slice(1, -1)));
    ok(known.size > 10, `只解出 ${known.size} 个键，扫法走歪了`);
    const r = G.plan(claimed, {}, REG);
    const miss = Object.keys(r.writes).filter((k) => !known.has(k));
    eq(miss.length, 0, '这些键不在 SETTINGS_KEYS 里，会被静默清掉：' + miss.join(', '));
  });

  test('marks 三件**不进** SETTINGS_KEYS —— 宿主单独写', () => {
    const r = G.plan(claimed, {}, REG);
    deepEq(Object.keys(r.marks).sort(), ['grant', 'grantBalance', 'grantTail']);
    eq(r.marks.grantTail, TOKEN.slice(-8));
    eq(r.marks.grantTail.length, 8, '只存尾八位：判定不需要更多，而少一份完整凭证就少一处泄漏面');
    ok(!String(JSON.stringify(r.marks)).includes(TOKEN), 'marks 里不许出现完整令牌');
  });

  test('用户自己粘的 key 一个字节都不动', () => {
    const s = { apiKey: 'sk-users-own-key', ttsApiKey: 'sk-users-own-key', sttEngine: 'openai_transcribe' };
    const r = G.plan(claimed, s, REG);
    ok(!('apiKey' in r.writes), '盖掉了用户自己的翻译 key');
    ok(!('ttsApiKey' in r.writes), '盖掉了用户自己的朗读 key');
    ok(!('sttEngine' in r.writes), '盖掉了用户自己的转写引擎');
    eq(r.replaced.length, 0);
    ok(r.skipped.length >= 3, '跳过了却没如实报告 —— 界面会假装配好了');
  });

  test('上一枚令牌可以被盖掉，且**如实报告是替换**', () => {
    const OLD = 'bmg_oldoldoldoldoldoldoldoldoldoldoldoldOLDTAIL9';
    const s = { apiKey: OLD, ttsApiKey: OLD, sttEngine: 'grant_stt', sttApiKey: OLD, grantTail: OLD.slice(-8) };
    const r = G.plan(claimed, s, REG);
    eq(r.writes.apiKey, TOKEN);
    eq(r.writes.ttsApiKey, TOKEN);
    eq(r.writes.sttApiKey, TOKEN);
    deepEq(r.replaced.sort(), ['chat', 'stt', 'tts']);
  });

  test('尾号只差一位就不许覆盖 —— 判宽了会盖掉别人的 key', () => {
    const NEAR = 'sk-something-OLDTAIL8';                 // 与 grantTail 差一位
    const s = { apiKey: NEAR, grantTail: 'OLDTAIL9' };
    const r = G.plan(claimed, s, REG);
    ok(!('apiKey' in r.writes), '尾号不同却覆盖了');
  });

  test('注册表里没有那三条时不产出任何 writes（中国版 / 老产物）', () => {
    const r = G.plan(claimed, {}, { MT_PROVIDERS: [], MT_TTS_ENGINES: [], MT_STT_ENGINES: [] });
    deepEq(r.writes, {});
  });
});

describe('§8.10 active —— 判据是尾号命中，不是 provider 名', () => {
  const { G } = load();
  const s = (o) => Object.assign({ grantTail: TOKEN.slice(-8) }, o);

  test('每一路各自判 —— 翻译换成自己的 key 而朗读还用额度是常见形状', () => {
    const st = s({ apiKey: 'sk-mine', ttsApiKey: TOKEN });
    eq(G.activeIn(st, 'chat'), false);
    eq(G.activeIn(st, 'tts'), true);
    eq(G.active(st), true, '只要还有一路在用额度，整体就算在用');
  });

  test('没有 grantTail 时一律为假 —— 不猜', () => {
    eq(G.active({ apiKey: TOKEN }), false);
  });
});

describe('§8.10 status —— 顺序即优先级', () => {
  const { G } = load();
  const signed = { signedIn: true };

  test('★ 池子空了排在「你用完了」前面', () => {
    const st = { grant: {}, grantTail: TOKEN.slice(-8), apiKey: TOKEN,
      grantBalance: { limitUsd: 0.2, spentUsd: 0.2, at: Date.now() } };
    eq(G.status(st, signed), 'exhausted');
    eq(G.status(st, { signedIn: true, unavailable: true }), 'unavailable',
      '池子空了却说成「你用完了」—— 用户会去查自己的账户，查一晚上也查不出来');
  });

  test('未登录 / 未领 / 在用 / 余额低 / 换成自己的 key', () => {
    const tail8 = TOKEN.slice(-8);
    eq(G.status({}, { signedIn: false }), 'none');
    eq(G.status({ grant: {} }, { signedIn: false }), 'signed_out');
    eq(G.status({}, signed), 'unclaimed');
    eq(G.status({ grant: {}, grantTail: tail8, apiKey: TOKEN,
      grantBalance: { limitUsd: 0.2, spentUsd: 0.05, at: Date.now() } }, signed), 'active');
    eq(G.status({ grant: {}, grantTail: tail8, apiKey: TOKEN,
      grantBalance: { limitUsd: 0.2, spentUsd: 0.195, at: Date.now() } }, signed), 'low');
    eq(G.status({ grant: {}, grantTail: tail8, apiKey: 'sk-mine' }, signed), 'replaced');
  });

  test('MT_GRANT 不存在时永远是 none —— 中国版不该出现任何额度状态', () => {
    const { G: G2 } = load(null);
    eq(G2.status({ grant: {}, grantTail: 'x' }, signed), 'none');
  });
});

describe('§8.10 退出登录：清令牌，留记录', () => {
  const { G } = load();

  test('三槽里尾号命中的清空，记录留着（余额保留，再登录就回来）', () => {
    const t8 = TOKEN.slice(-8);
    const r = G.clearOnSignOut({ grantTail: t8, apiKey: TOKEN, ttsApiKey: TOKEN,
      sttApiKey: TOKEN, sttEngine: 'grant_stt', grant: { at: 1 } });
    eq(r.writes.apiKey, '');
    eq(r.writes.ttsApiKey, '');
    eq(r.writes.sttEngine, '', '转写那一路的哨兵是 engine 而不是 key');
    eq(r.marks.grantTail, '');
    ok(!('grant' in r.marks), 'grant 记录必须留着 —— 它只有时间与上限，没有令牌');
  });

  test('用户自己的 key 不受退出登录影响', () => {
    const r = G.clearOnSignOut({ grantTail: 'OLDTAIL9', apiKey: 'sk-mine', ttsApiKey: 'sk-mine' });
    deepEq(r.writes, {});
  });
});

describe('§8.10 余额缓存', () => {
  const { G } = load();
  test('过期不等于错 —— fresh 为假时仍算得出剩多少', () => {
    const old = { limitUsd: 0.2, spentUsd: 0.05, at: Date.now() - G.CACHE_MS - 1 };
    eq(G.fresh(old), false);
    eq(G.leftUsd(old), 0.15, '过期就返回 null 的话，界面会画成一片空白 —— 看着像额度没了');
  });
  test('没有上限时返回 null，不返回 0', () => {
    eq(G.leftUsd({ spentUsd: 0.1 }), null, '0 会被画成「用完了」');
  });
});

describe('§8.10 卡面 —— 哪个状态说哪句话', () => {
  const { G } = load();
  const t = (k, d) => d;
  const bal = (spent) => ({ limitUsd: 0.2, spentUsd: spent, at: Date.now() });

  test('★ 每个状态至多一个主按钮 —— 两个并列等于没有', () => {
    for (const st of ['none', 'signed_out', 'unclaimed', 'active', 'low', 'exhausted', 'unavailable', 'replaced']) {
      const c = G.cardFor(st, { t, balance: bal(0.05) });
      ok(c, `${st} 没画出卡`);
      ok(!c.action || typeof c.action.id === 'string', `${st} 的按钮形状不对`);
    }
  });

  test('★ 标题里不写金额 —— 数字只出现在进度那一行', () => {
    for (const st of ['none', 'unclaimed', 'active', 'exhausted']) {
      const c = G.cardFor(st, { t, balance: bal(0.05) });
      ok(!/\$|美元|0\.2/.test(c.title), `${st} 的标题里出现了金额：${c.title}`);
    }
  });

  test('★ 「池子空了」那句头一句先说不是你的问题', () => {
    const c = G.cardFor('unavailable', { t });
    ok(/不是你/.test(c.body.slice(0, 12)),
      '头一句没说「不是你」—— 用户会去查自己的账户，查一晚上也查不出来：' + c.body);
    ok(!c.action, '池子空了时不该给「领取」按钮 —— 点了必然失败');
  });

  test('未登录那张卡：主按钮是登录，且提前说清实时听译不含在内', () => {
    const c = G.cardFor('none', { t });
    eq(c.action.id, 'signin');
    ok(/实时听译/.test(c.note), '没提前说实时听译不在范围内，用户会点进去发现入口不存在');
  });

  test('领取前要出隐私那一句 —— 文本经我们的服务器转发', () => {
    const c = G.cardFor('unclaimed', { t });
    eq(c.action.id, 'claim');
    ok(/服务器/.test(c.note) && /不保存|不记录/.test(c.note), '领取前没说清文本去哪：' + c.note);
  });

  test('用完了给两个出口，且没有主按钮（没有可点的补救动作）', () => {
    const c = G.cardFor('exhausted', { t, balance: bal(0.2) });
    eq(c.action, null);
    deepEq(c.links.map((l) => l.id).sort(), ['byo', 'community']);
    eq(c.progress.left, 0);
  });

  test('退出登录那句先说余额还在', () => {
    const c = G.cardFor('signed_out', { t });
    ok(/余额保留|余额还在/.test(c.body), '没说余额还在，用户以为钱没了：' + c.body);
  });

  test('换成自己的 key 之后给「改回免费额度」', () => {
    const c = G.cardFor('replaced', { t });
    eq(c.action.id, 'restore');
  });

  test('认不出的状态什么都不画 —— 不猜', () => {
    eq(G.cardFor('who-knows', { t }), null);
    eq(G.cardFor('', { t }), null);
  });

  test('进度条：余额未知时不画一条空条（空条看着像用完了）', () => {
    const c = G.cardFor('active', { t });          // 没传 balance
    eq(c.progress, null);
    const c2 = G.cardFor('active', { t, balance: bal(0.05) });
    eq(c2.progress.left, 0.15);
  });
});
