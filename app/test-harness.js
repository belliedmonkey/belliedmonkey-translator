// app/test-harness.js — window.__mtTest：分层验证矩阵的页面侧驱动接口
// （docs/verification-spec.md §0.4，2026-10-05 用户拍板）。
//
// 进包纪律：只在 buildAppBundle 收到 opts.testHarness 时拼进 Script.js；正常构建不带它。
// 它自己不发起任何网络请求（门禁按名词扫全文，注释也算）—— 没有原生端点的包里它就是死代码。
//
// 设计原则：**只注入事件、只读状态，不替 App 做决定。** say()/partial() 伪装的是
// 「麦克风听到了这句」（原生事件 stt-final / stt-partial），朗读走页面自己的真管线 ——
// 模拟器层（无声学回环）与 Mac 层（真回环）因此能用同一份 case。
(function () {
  if (window.__mtTest) return;

  function ns() {
    return (typeof NativeSpeech !== 'undefined' && NativeSpeech) || null;
  }

  function el(id) { return document.getElementById(id) || null; }
  function visible(id) {
    const e = el(id);
    if (!e) return false;
    return !e.hidden && getComputedStyle(e).display !== 'none';
  }

  // 异步结果的落点：端点的 evaluateJavaScript 是同步回执（不等 Promise），异步操作由
  // runAsync() 存进来、驱动侧轮询 last() 取 —— 端点保持极简。
  let lastAsync = null;

  window.__mtTest = {
    v: 1,

    // 「麦克风听到了一句定稿」。conf 默认 0.95：回声闸的判据是文本相似度，不是置信度，
    // 这里只是让下游的置信度过滤不拦它。
    say(text, locale, conf) {
      const n = ns();
      if (!n || !n._fromNative) return false;
      n._fromNative({
        type: 'stt-final',
        locale: locale || 'zh',
        text: String(text),
        conf: conf == null ? 0.95 : conf,
      });
      return true;
    },

    // 「麦克风正在听到半句」。
    partial(text, locale) {
      const n = ns();
      if (!n || !n._fromNative) return false;
      n._fromNative({ type: 'stt-partial', locale: locale || 'zh', text: String(text) });
      return true;
    },

    // 跑一个异步函数（探测、真朗读、等状态），结果落在 last()。驱动侧：
    //   eval('__mtTest.runAsync(async () => JSON.stringify(await NativeSpeech.probe()))')
    //   … 轮询 eval('__mtTest.last()') 直到非 null。
    async runAsync(fn) {
      lastAsync = null;
      try {
        lastAsync = { ok: true, value: await fn() };
      } catch (e) {
        lastAsync = { ok: false, error: String(e) };
      }
      return lastAsync.ok;
    },

    last() { return lastAsync; },

    // 读状态：屏幕 / 历史 / 语言对 —— 全部从 DOM 与公开对象读，不复制 App 逻辑。
    state() {
      const rows = Array.from(document.querySelectorAll('#app-listen-history > *'))
        .map((r) => (r.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const pick = (id) => {
        const e = el(id);
        if (!e) return null;
        return e.value != null ? e.value : (e.textContent || '').trim() || null;
      };
      const n = ns();
      return {
        path: location.hash || '',
        firstRunPacks: visible('firstrun-packs'),
        signedIn: visible('signed-in'),
        historyCount: rows.length,
        history: rows,
        langMy: pick('packs-my-lang'),
        langOther: pick('packs-other-lang'),
        sttProbe: n && n.probeResult ? n.probeResult() : null,
      };
    },

    // 等条件成立。返回 true/false，不 throw —— 驱动侧负责把 false 变成失败报告。
    async waitFor(fn, ms) {
      const t0 = Date.now();
      for (;;) {
        let ok = false;
        try { ok = !!fn(); } catch (_) { /* 条件本身抛异常按未成立处理 */ }
        if (ok) return true;
        if (Date.now() - t0 > (ms || 5000)) return false;
        await new Promise((r) => setTimeout(r, 120));
      }
    },
  };
})();
