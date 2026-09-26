// test/options-model.test.js — options 页纯逻辑层的单元回归（React 迁移 PR5）。
//
// 这些函数原本散在 extension/options/options.js 里，没有一处能进 node 单测
// （和 DOM 搅在一起）。搬进 options-model.js 不只是为了测 —— 真正的守卫是
// 「SAVE_KEYS 对账 schema」那组：schema 是键的唯一登记处，saveNow 的键域是
// options 自己的行为约定，两者之间的差集每一条都必须说得出名字。test/quick-setup.test.js
// 与 test/grant.test.js 里「plan.writes 必须落得回来」那两条旧断言的锚点也随之
// 换到这里对账（键从手抄清单换成了 schema）。
const { describe, test, ok, eq, deepEq, loadSrc } = require('./harness');

// loadSrc 返回 vm context；具名导出是扁平对象（OptionsModel.SAVE_KEYS），而
// schema 是 export default —— loadSrc 已拆掉 default 那层，直接拿。
const M = loadSrc('src/pages/options-model.js', 'OptionsModel').OptionsModel;
const SCHEMA = loadSrc('src/store/schema.js', 'SETTINGS_SCHEMA').SETTINGS_SCHEMA;

describe('SAVE_KEYS 对账 schema（saveNow 的键域）', () => {
  test('33 个键、无重复', () => {
    eq(M.SAVE_KEYS.length, 33, '数量变了就要连着 options.jsx 的 saveNow 一起看');
    eq(new Set(M.SAVE_KEYS).size, M.SAVE_KEYS.length, '有重复键');
  });

  test('每个键都在 schema 里（saveNow 走 setMany，未知键会被整单拒绝）', () => {
    const miss = M.SAVE_KEYS.filter((k) => !(k in SCHEMA.spec));
    deepEq(miss, [], 'SAVE_KEYS 里有 schema 不认识的键 —— setMany 会拒绝整份 patch');
  });

  test('与 keysFor("options") 的差集恰好是 5 个有名有姓的例外', () => {
    const opt = new Set(SCHEMA.keysFor('options'));
    const diff = [...opt].filter((k) => !M.SAVE_KEYS.includes(k)).sort();
    deepEq(diff, ['bilingualMode', 'enabled', 'engineChosen', 'learnRules', 'reqCustomParams'],
      '差集变了 —— 每一条都要在这里说得出为什么不归 saveNow 写：'
      + ' enabled 归 background.js；engineChosen 由 provider 变更单独写；'
      + ' bilingualMode 这页没有控件；learnRules 走治理区的响应式写入；'
      + ' reqCustomParams 是 schema 注明的 read-only（adv-custom 单独落盘）。');
  });
});

describe('scaleValue（字号档位）', () => {
  test('档位内原样，档位外落 1.0', () => {
    for (const v of M.SCALE_OPTS) eq(M.scaleValue(v), v);
    eq(M.scaleValue('1.4'), '1.0', '旧版写过的超档值');
    eq(M.scaleValue(''), '1.0');
    eq(M.scaleValue(null), '1.0');
    eq(M.scaleValue(undefined), '1.0');
    eq(M.scaleValue(1.25), '1.25', '数字也认（String 归一）');
  });
});

describe('advNum（高级参数钳制）', () => {
  const C = [0.01, 2]; const B = [16, 32000];
  test('空串与非法值都落「不发送」（空串语义）', () => {
    eq(M.advNum('', C), '');
    eq(M.advNum('   ', C), '');
    eq(M.advNum(null, C), '');
    eq(M.advNum('abc', C), '');
    eq(M.advNum('0.7abc', C), '');
  });
  test('界内原样，越界钳到端点', () => {
    eq(M.advNum('0.7', C), 0.7);
    eq(M.advNum(' 1.5 ', C), 1.5, '输入框值带空格');
    eq(M.advNum('0', C), 0.01, '下界');
    eq(M.advNum('99', C), 2, '上界');
    eq(M.advNum('2000', B), 2000);
    eq(M.advNum('5', B), 16);
    eq(M.advNum('40000', B), 32000);
  });
});

describe('learnDailyNew（每日新卡数）', () => {
  test('空/零/负/非数回落默认，界内原样，越界钳制', () => {
    eq(M.learnDailyNew('', 15), 15);
    eq(M.learnDailyNew('0', 15), 15);
    eq(M.learnDailyNew('-3', 15), 1, '负数是 truthy，钳到下界 1（原版同义）');
    eq(M.learnDailyNew('abc', 15), 15);
    eq(M.learnDailyNew('20', 15), 20);
    eq(M.learnDailyNew('1', 15), 1);
    eq(M.learnDailyNew('300', 15), 200, '上界 200');
    eq(M.learnDailyNew('0.5', 15), 1, '下界 1');
  });
});

describe('apiHint（#api-hint 拼接）', () => {
  const t = (k, fb) => fb || k;
  const byId = (id) => ({ google: { hintKey: 'hint_g', defaultModel: 'gemini-x' },
    plain: { hintKey: 'hint_p' }, bare: {} }[id]);
  test('不认识的 provider → 空串', () => {
    eq(M.apiHint('nope', t, byId), '');
  });
  test('没有 defaultModel → 只有 hint；什么都没有 → 空串', () => {
    eq(M.apiHint('plain', t, byId), 'hint_p');
    eq(M.apiHint('bare', t, byId), '');
  });
  test('hint + 默认模型：中文句号后不加空格，否则加一个', () => {
    eq(M.apiHint('google', (k, fb) => (k === 'hint_g' ? '免费，无需申请。' : fb), byId),
      '免费，无需申请。默认模型：gemini-x');
    eq(M.apiHint('google', (k, fb) => (k === 'hint_g' ? 'Free tier' : fb), byId),
      'Free tier 默认模型：gemini-x');
    eq(M.apiHint('google', (k, fb) => (k === 'hint_g' ? '' : fb), byId),
      '默认模型：gemini-x', '空 hint 只剩默认模型');
  });
});

describe('syncError（同步/登录错误 → 状态行）', () => {
  // 桩 t：只回 key，让断言钉住「每个 code 用了哪个 key」；fallback 文案本身由
  // error-copy 门禁在 JSX 源码上逐字对账，这里不重复。
  const t = (k) => k;
  const cases = [
    ['offline', 'sync_err_offline'],
    ['quota', 'sync_err_quota'],
    ['signed_out', 'sync_err_signed_out'],
    ['enc_unsupported', 'sync_err_upgrade'],
    ['rate_limited', 'sync_err_rate'],
    ['owner_mismatch', 'sync_err_owner_mismatch'],
    ['owner_unknown', 'sync_err_owner_unknown'],
    ['pkce_missing', 'sync_err_pkce_missing'],
    ['pkce_state', 'sync_err_pkce_state'],
    ['storage_error', 'sync_err_storage'],
    ['credit_exhausted', 'grant_err_exhausted'],
    ['grant_unavailable', 'grant_err_unavailable'],
    ['grant_misconfigured', 'grant_err_misconfigured'],
    ['grant_revoked', 'grant_err_revoked'],
    ['grant_invalid', 'grant_err_invalid'],
    ['model_not_allowed', 'grant_err_model'],
    ['busy', 'grant_err_busy'],
    ['auth', 'auth_err_key'],
  ];
  test('18 个具名码一个不落（error-copy 门禁的对账面）', () => {
    for (const [code, key] of cases) eq(M.syncError({ code }, t), key);
  });
  test('兜底：e.message 优先，其次通用文案', () => {
    eq(M.syncError({ code: 'whatever', message: 'boom' }, t), 'boom', '无名 code 用 message');
    eq(M.syncError({ code: 'whatever' }, t), 'sync_err_generic', '无名 code 且无 message 用通用文案');
    eq(M.syncError({}, t), 'sync_err_generic');
    eq(M.syncError(null, t), 'sync_err_generic');
  });
});
