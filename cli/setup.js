// cli/setup.js — 交互式首次配置：**先登录，再自动领免费额度**（learning-design §9.10 / §8.10）。
//
// 用户不必先去某家厂商申请 key：登录之后服务端发一枚额度令牌，CLI 把它写进配置，
// 请求走我们的中继。额度用完（401/402 `credit_exhausted`）时再引导去配自己的 key。
//
// 「领 → 写槽」用的是同一份实现（src/shared/grant.js，见 cli/grant.js / cli/bootstrap.js）。
'use strict';
const configMod = require('./config.js');
const messages = require('./messages.js');

function pageUrl() {
  const host = process.env.BM_CLI_FLAVOR === 'china' ? 'belliedmonkey.com' : 'belliedmonkey.cc';
  return 'https://' + host + '/setup.html';
}

// deps: { ask(prompt) → string, out(line), err(line) }
async function guidedSetup(values, deps) {
  const ask = deps.ask;
  const out = deps.out || (() => {});
  const err = deps.err || (() => {});
  const flavor = process.env.BM_CLI_FLAVOR === 'china' ? 'china' : 'global';
  const lang = values['ui-lang'] || configMod.load().uiLang || '';

  if (flavor === 'china') {
    err(messages.t('cli_china_no_grant', lang));
    return { ok: false, code: 'grant_unavailable' };
  }

  const { Corpus } = require('./corpus.js');
  const corpus = new Corpus(values.corpus);
  try { await corpus.load(); } catch (_) { /* 这里只领额度，语料不存在也无妨 */ }

  let rt;
  try { rt = require('./bootstrap.js').boot(corpus, { flavor, stateFile: values.state }); }
  catch (e) { err(`初始化失败：${(e && e.message) || e}`); return { ok: false, code: e && e.code }; }

  if (!rt.grant || !rt.grant.enabled()) {
    err(messages.t('cli_setup_hint', lang));
    return { ok: false, code: 'grant_unavailable' };
  }

  // Gate F 的披露段：领取**之前**说清楚「这条路上你的文本会经过我们的服务器」。
  // 文案取自 grant.js 的卡面（与扩展 / App 同一份），不在这里抄一遍。
  const card = rt.grant.cardFor('unclaimed');
  if (card && card.note) out(card.note);

  // 1) 登录 —— 引导流程的第一步，必须完成（免费额度是登录的附带权益）
  let sess = await rt.auth.current();
  if (!sess) {
    const who = String((await ask(messages.t('cli_setup_email_prompt', lang))) || '').trim();
    if (!who) { err(messages.t('cli_whoami_none', lang)); return { ok: false, code: 'no_email' }; }
    await rt.auth.signIn(who);
    out(messages.fmt('cli_setup_sent', lang, { who }));
    const code = String((await ask(messages.t('cli_setup_code_prompt', lang))) || '').trim();
    sess = await rt.auth.verify(who, code);
    rt.saveState();
    out(messages.fmt('cli_setup_logged_in', lang, { who: rt.auth.displayName(sess) || sess.userId || who }));
  } else {
    out(messages.fmt('cli_setup_logged_in', lang, { who: rt.auth.displayName(sess) || sess.userId }));
  }

  // 2) 领取（幂等：服务端以 user_id 为主键，第二次回传同一枚令牌）
  let claimed;
  try { claimed = await rt.grant.claim({ auth: rt.auth, backend: rt.backend, fetch }); }
  catch (e) { err(messages.fmt('cli_setup_failed', lang, { code: (e && e.code) || 'error', msg: (e && e.message) || e })); return { ok: false, code: e && e.code }; }

  // 3) 把令牌写进配置。overwrite=true 是这里的明确语义：设置这个动作就是「用免费额度」，
  //    旧的 key 该被换掉（与扩展「改回免费额度」同一个入参）。
  const planned = rt.grant.plan(claimed, configMod.load(), undefined, { overwrite: true });
  const writes = Object.assign({}, planned.writes, planned.marks || {}, { engineChosen: true });
  configMod.save(writes);
  rt.saveState();

  const limit = Number(claimed.limitUsd || 0);
  const left = Math.max(0, limit - Number(claimed.spentUsd || 0));
  out(messages.fmt('cli_setup_claimed', lang, { limit: limit.toFixed(2), left: left.toFixed(2) }));
  out(messages.t('cli_setup_done', lang));
  return { ok: true, provider: writes.provider, limitUsd: limit };
}

module.exports = { guidedSetup, pageUrl };
