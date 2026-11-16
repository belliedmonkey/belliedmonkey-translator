// shared/owner.js — BEL-266：凭证归属（owner）的**唯一**判定点。
//
// BEL-257 把「owner 从引擎推」这条错路从迁移里删掉了；但设置页保存 key 时还在
// `SettingsStore.get(provider / ttsEngine / sttEngine)` 上重犯：用户先选 B、再粘
// 一把属于 A 的 key（或反过来），owner 会跟着**当前引擎**走，而不是跟着**这枚
// key 是谁发的**走。下一次请求的 key_owner_mismatch 守卫就会把人拦在自家配置外。
//
// 这里的输入只有三样：槽位、key、调用点显式给出的 vendor。没有存储读取、没有
// EngineState.resolve、没有「引擎 id 总可以当 vendor」的兜底 —— 一旦在这里读
// 存储，测试就必须先摆一套全局状态才能问「这枚 key 归谁」，而那正是 BEL-257
// 留下的那类 bug 的温床。
//
// `bmg_` 是**唯一**可以由 key 本身判定的归属：它是我们发的额度令牌，槽位决定
// 写哪个 grant id（中继按 id 查白名单）。用户自己的 key 只能由调用点告诉我们
// 它属于谁；调用点不知道时答案是空串（"不判归属"），不是猜一个。

const GRANT_OWNER_BY_SLOT = {
  chat: 'grant',
  // 解析跟随翻译引擎：owner 留空，由 resolveConfig 用 chat 的 owner 判。
  notes: 'grant',
  tts: 'grant_speech',
  stt: 'grant_stt',
};

// grant 家族从槽位表派生，不再手写第二份名单：加槽位/改 id 时这里自动跟上。
// 用户 key 永远不属于这个集合，见 ownerFor 的不变量。
const GRANT_OWNERS = new Set(Object.values(GRANT_OWNER_BY_SLOT));

function ownerFor(slot, key, explicitVendor, grantId) {
  const v = String(key == null ? '' : key).trim();
  if (!v) return '';
  if (/^bmg_/i.test(v)) {
    // 已知槽位按槽位；未知槽位只接受调用方显式给的那一个 grant id，绝不回落到
    // chat 的 'grant'（那会把 speech / stt 令牌记到错误的家族上）。
    return GRANT_OWNER_BY_SLOT[slot] || String(grantId == null ? '' : grantId).trim();
  }
  // 用户自己的 key：只认调用点显式选择的 vendor。空 = 不判归属。
  // 不变量：非 bmg_ 的 key + grant 家族的显式 vendor 是**不可表示**的状态 ——
  // 用户 key 绝不能被 grant 认领（否则下一次请求撞 key_owner_mismatch，额度账
  // 也会把用户 key 记到 grant 头上）。这里返回空串：不读存储、不回落引擎，
  // 也不退回「显式 vendor 原样用」。
  // notes 的「跟随翻译引擎」在调用点就是空串，这里同样得到 '' —— 符合设计，
  // 而不是漏了一种分支。
  const vendor = String(explicitVendor == null ? '' : explicitVendor).trim();
  if (GRANT_OWNERS.has(vendor)) return '';
  return vendor;
}

export { ownerFor, GRANT_OWNER_BY_SLOT };
export default { ownerFor, GRANT_OWNER_BY_SLOT };
