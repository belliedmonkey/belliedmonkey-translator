// src/app/pack-pending.js — BEL-269：首启包失败后「先进首页」的共享状态与判据。
//
// 为什么单独一份：三个模块都要读同一个事实 ——
//   · shell-model  —— 首页横幅画不画、首页入口（听译/字幕）挡不挡、跳过是否还在；
//   · listen-model —— 两张主角卡的门与原因（不能只靠探针 ok，包没下好也是不可用）；
//   · driving-model / settings-view —— 设备内置朗读（TTS）的「未就绪」原因。
// 每个模块各自读一遍 `listenPacksSkipped` 会产生四份真值；这里只有一份内存值 + 一个
// 只读一次存储的种子。UI 文案仍由各视图用自己的 t() 画，这里只回答布尔与键名。
//
// 存储键是**本机 UI 状态**，不是遥测 schema / 白名单：`listenPacksSkipped` 只在本机
// 回答「上次是跳过包屏进来的」，不随账号同步、不进任何事件字段。
export const PACKS_SKIPPED_KEY = 'listenPacksSkipped';

let pending = false;
let loaded = false;

/** 写入方（shell-model 的 skip / 成功）改内存真值；读方立刻看到，不必等存储回调。 */
export function markPacksPending(on) {
  pending = !!on;
  loaded = true;
  return pending;
}

/** 同步读：已经加载过就是内存值；没加载过按「没跳过」处理（首启默认）。 */
export function packsPendingSync() { return pending; }

/**
 * 读一次存储并缓存。存储读失败按「没跳过」—— 不能因为读不到一个 UI 提示键就把人
 * 挡在首页外；真正的路由仍由 listenPacksDone 决定。
 */
export function readPacksPending() {
  if (loaded) return Promise.resolve(pending);
  return new Promise((resolve) => {
    const done = (v) => {
      pending = !!v;
      loaded = true;
      resolve(pending);
    };
    try {
      chrome.storage.local.get([PACKS_SKIPPED_KEY], (v) => done(v && v[PACKS_SKIPPED_KEY]));
    } catch (_) { done(false); }
  });
}

/**
 * 首页「语言包未就绪」横幅该不该露。纯粹由输入决定，方便在心跳/重绘后反复调用：
 * 同一个输入永远同一个答案，不会因为画了几次而改变路由。
 *   session  —— 有登录会话（未登录首页不挂这张横幅）；
 *   skipped  —— 上次是「稍后补包，先进入」；
 *   ready    —— 现在三样包真的齐了（齐了就立刻收横幅，不靠刷新）；
 *   screen   —— 当前屏（包屏/管理屏上不画，避免遮住下载按钮）。
 */
export function packsBannerState(input) {
  const i = input || {};
  const show = !!i.session && !!i.skipped && !i.ready && i.screen !== 'packs';
  return {
    show,
    titleKey: 'packs_pending_title',
    bodyKey: 'packs_pending_body',
    goKey: 'packs_pending_go',
    whyKey: 'packs_pending_why',
    ttsKey: 'packs_pending_tts',
  };
}

/**
 * 一张功能入口（听译 / 实时字幕 / 设备朗读）在「包未就绪」时该长什么样。
 * packsPending 优先于探针原因：跳过包屏后，探针可能仍报设备识别器 ok，但包没下完，
 * 此时必须说「语言包未就绪」，不能把入口画成可用、让用户点进去等一个空转。
 */
export function packsEntryGate(packsPending, probeOk) {
  if (packsPending) {
    return { available: false, reasonKey: 'packs_pending_why', reason: 'packs' };
  }
  if (!probeOk) return { available: false, reasonKey: '', reason: '' };
  return { available: true, reasonKey: '', reason: '' };
}
