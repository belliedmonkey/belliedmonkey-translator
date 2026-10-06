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
  // 事件记录器的账本（rec()）。
  let recOn = false, recLog = [];
  // 保活定时器（ka()）。
  let kaTimer = null;

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

    // 「麦克风正在听到半句」。conf 用来验半句层的跨语言仲裁（真机 partial 也带 conf）。
    partial(text, locale, conf) {
      const n = ns();
      if (!n || !n._fromNative) return false;
      n._fromNative({ type: 'stt-partial', locale: locale || 'zh', text: String(text), conf: conf == null ? 0.95 : conf });
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

    // 事件记录器：旁听两个桥的 _fromNative（NativeSpeech=识别/朗读，NativeAudio=麦克风/
    // 会话状态），只记录、原样转发。M2 靠它看 tts-start/tts-end（朗读真走了管线），M3 靠它
    // 掐回声窗的时机，听译 setup 靠 mic-state 找授权/输入卡在哪。
    // rec(1) 开始（清空旧账）· rec(0) 停 · rec() 取副本。
    rec(state) {
      for (const n of [ns(), (typeof NativeAudio !== 'undefined' && NativeAudio) || null]) {
        if (n && !n.__mtRecWrapped && typeof n._fromNative === 'function') {
          const orig = n._fromNative;
          n._fromNative = function wrapped(msg) {
            if (recOn && msg && msg.type !== 'mic-level' && msg.type !== 'mic-pcm') {
              try { recLog.push(msg); if (recLog.length > 400) recLog.shift(); } catch (_) {}
            }
            return orig.call(this, msg);
          };
          n.__mtRecWrapped = true;
        }
      }
      if (state === 1) { recLog = []; recOn = true; return true; }
      if (state === 0) { recOn = false; return true; }
      return recLog.slice();
    },

    // 保活：每 8s 注入一条健康的 mic-level（rms 0.2）。30 秒静音自动暂停按「底噪之上
    // 没有人声」算 —— 长等待的 case（M5 等 tts-start 最长 60s）不该被它误收。与 say()
    // 同类：只注入事件，App 的规则照常自己判。ka(1) 开 · ka(0) 停。
    ka(on) {
      if (on) {
        if (kaTimer) return true;
        kaTimer = setInterval(() => {
          try {
            const n = (typeof NativeAudio !== 'undefined' && NativeAudio) || null;
            if (n && n._fromNative) n._fromNative({ type: 'mic-level', rms: 0.2 });
          } catch (_) {}
        }, 8000);
        return true;
      }
      if (kaTimer) { clearInterval(kaTimer); kaTimer = null; }
      return false;
    },

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
