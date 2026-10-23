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

  // 注入 LID 判词：同语言只发一次（真机也是「变了才发」）。
  // H1：`force` 时不做去重（`__mtTest.lid()` 是显式注入）；`lidMute` 时 say()/partial() 不自动发判词
  // （开场短句、按住说「按住时不该有 LID」这类用例要自己控制）。
  let lidSent = '', lidMute = false;
  const emitLid = (loc, llr, force) => {
    const n = ns();
    if (!n || !n._fromNative) return false;
    const b = String(loc).split(/[-_]/)[0].toLowerCase();
    if (!force && b === lidSent) return false;
    lidSent = b;
    n._fromNative({ type: 'lid-live', lang: b, engine: 'test', llr: llr == null ? 0 : llr });
    return true;
  };
  // 延迟注入（给 LID 判词留出 0.5s 的「稳住」窗口）。
  const delayEmit = (msg) => {
    const n = ns();
    setTimeout(() => { const m = ns(); if (m && m._fromNative) m._fromNative(msg); }, 650);
    return n;
  };

  function ns() {
    return (typeof NativeSpeech !== 'undefined' && NativeSpeech) || null;
  }

  // 只读的模型自述（AppListen._debug 本来就是产品里的只读诊断口）。
  function dbg() {
    try {
      const A = (typeof window !== 'undefined' && window.AppListen) || null;
      return A && typeof A._debug === 'function' ? A._debug() : null;
    } catch (_) { return null; }
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
    v: 2,   // 2 = 加了 H1（LID 注入）与 H3（按住说驱动）

    // 「麦克风听到了一句定稿」。conf 默认 0.95：回声闸的判据是文本相似度，不是置信度，
    // 这里只是让下游的置信度过滤不拦它。
    say(text, locale, conf) {
      const n = ns();
      if (!n || !n._fromNative) return false;
      const loc = locale || 'zh';
      // **先注入 LID 判词，再延迟注入定稿**（2026-10-08）：语种归属现在**只认 LID**
      // （`listen-model` 的 `sideMatchesLid` 两道闸），判词为空时注入的每一片都会被丢掉
      // ⇒ M2/M7 这些「注入 stt-final 等成行」的用例一行都落不下来。注入层原本「只注入事件」，
      // 而 LID 判词也是**原生事件**，所以这里补上它是同一原则内的修法。
      // 延迟 650ms 是因为 `lidPair()` 要求判词**稳住 ≥0.5s**（LID_CONFIRM_MS）才认。
      if (!lidMute) emitLid(loc);
      delayEmit({
        type: 'stt-final', locale: loc, text: String(text), conf: conf == null ? 0.95 : conf,
      });
      return true;
    },

    // DEBUG：直接灌定稿 timeline（绕过 STT）。优先走 AppListen._testInjectFinal。
    // Duo sim 无 SpeechTranscriber 时 AC-D1/H3 用；正式包不带本文件。
    injectFinal(text, opts) {
      try {
        const A = (typeof window !== 'undefined' && window.AppListen) || null;
        if (A && typeof A._testInjectFinal === 'function') {
          return A._testInjectFinal(String(text || ''), opts || {});
        }
      } catch (_) {}
      return { ok: false, reason: 'no-inject' };
    },

    // 「麦克风正在听到半句」。conf 用来验半句层的跨语言仲裁（真机 partial 也带 conf）。
    partial(text, locale, conf) {
      const n = ns();
      if (!n || !n._fromNative) return false;
      const loc = locale || 'zh';
      if (!lidMute) emitLid(loc);
      delayEmit({ type: 'stt-partial', locale: loc, text: String(text), conf: conf == null ? 0.95 : conf });
      return true;
    },

    // ── H1：LID 注入 ───────────────────────────────────────────────────────
    // 显式注入一条判词（不去重）；llr 只作记录，产品侧不读它。
    lid(lang, opts) { return emitLid(lang, opts && opts.llr, true); },
    // 注入识别文本时**不**自动发判词（开场短句、按住说用）。lidMute(1) 开 · lidMute(0) 关。
    lidMute(on) { lidMute = !!on; return lidMute; },
    // 只读：判定是否被暂停（按住说期间为 true）。
    lidPaused() { const d = dbg(); return !!(d && d.lidPaused); },

    // ── H3：录音（改稿 D · 点一下开 / 停）────────────────────────────────────
    // 驱动的是**真按钮上的真点击**（不是绕过界面调模型）：开 / 停、换边全是产品代码自己算的。
    ptt: {
      el(side) { return el(side === 'other' ? 'app-listen-ptt-other' : 'app-listen-ptt-mine'); },
      click(side) {
        const e = el(side === 'other' ? 'app-listen-ptt-other' : 'app-listen-ptt-mine');
        if (!e) return false;
        e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
        return true;
      },
      toggle(side) { return this.click(side); },
      state() {
        const d = dbg();
        const p = (d && d.ptt) || { on: false, side: '', stopping: false };
        return { on: !!p.on, side: p.side || '', stopping: !!p.stopping, lidPaused: !!(d && d.lidPaused) };
      },
    },

    // 模拟麦克风没授权（P-09）：产品侧读 window.__mtMicDenied（正式包里没人设它）。
    micPermission(v) { try { window.__mtMicDenied = (v === 'denied'); } catch (_) {} return !!window.__mtMicDenied; },

    // ── H5：ECAPA 包「坏输入」（M-05）────────────────────────────────────────
    // 不模拟「装好了」，而是**把坏输入喂给原生**：'sha' 改 sha256、'truncate' 把 size 砍半。
    // 判据是原生那道校验挡下它、且不把半个包当成已安装（下次进听译会重下）。
    // lidAssetsFault('') 关掉。
    lidAssetsFault(kind) {
      const n = ns();
      if (n && typeof n.ensureLid === 'function' && !n.__mtLidFaultWrapped) {
        const orig = n.ensureLid;
        n.ensureLid = function (model, onProgress) {
          const f = window.__mtLidFault;
          let m = model;
          if (f && model && Array.isArray(model.files)) {
            m = Object.assign({}, model, {
              files: model.files.map((x) => Object.assign({}, x, f === 'sha'
                ? { sha256: 'deadbeef' + String(x.sha256 || '').slice(8) }
                : { size: Math.max(1, Math.floor((Number(x.size) || 0) / 2)) })),
            });
          }
          return orig.call(this, m, onProgress);
        };
        n.__mtLidFaultWrapped = true;
      }
      try { window.__mtLidFault = kind === 'sha' || kind === 'truncate' ? kind : ''; } catch (_) {}
      return true;
    },

    // ── H4：下载源故障注入（端到端那一半，M-03/M-04/M-10）────────────────────
    // 只换 ModelSources 的 fetch / probe：表「down / empty / 非 200」、主地址或备用地址探测失败、
    // 整体断网。modelFault({}) 复原（不传就按全好）。
    modelFault(o) {
      const M = (typeof window !== 'undefined' && window.ModelSources) || null;
      if (!M) return false;
      const f = o || {};
      const bad = (u) => (f.offline === true) ||
        (f.primary === 'fail' && String(u).indexOf('src=other') < 0) ||
        (f.alt === 'fail' && String(u).indexOf('src=other') >= 0);
      M.configure({
        fetch: f.table === 'down' ? async () => { throw new Error('fault'); }
          : f.table === 'empty' ? async () => ({ ok: true, json: async () => [] })
            : f.table ? async () => ({ ok: false })
              : undefined,     // 不指定就退回真 fetch
        probe: (f.offline || f.primary === 'fail' || f.alt === 'fail') ? async (u) => !bad(u) : undefined,
      });
      return true;
    },
    // 翻译请求计数（P-06/P-07：这些情况下必须 0）。
    translateCalls() { const d = dbg(); return (d && d.translateCalls) || 0; },

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
      const txt = (id) => { const e = el(id); return e ? (e.textContent || '').trim() : null; };
      const d = dbg();
      return {
        path: location.hash || '',
        firstRunPacks: visible('firstrun-packs'),
        signedIn: visible('signed-in'),
        historyCount: rows.length,
        history: rows,
        langMy: pick('packs-my-lang'),
        langOther: pick('packs-other-lang'),
        sttProbe: n && n.probeResult ? n.probeResult() : null,
        // 按住说 / 点一下（P 组 / C-09）：按钮文案、小字、锁定提示、灰掉原因
        ptt: {
          shown: visible('app-listen-ptt'),
          // **名字 span**，不是整个按钮 —— 左键按钮里现在还有小字（C 案），读 textContent 会把
          // 两者会被粘成一句（P-01 第一版就是这么假红的）。
          mine: txt('app-listen-ptt-mine-name'),
          mineHint: txt('app-listen-ptt-mine-hint'),
          otherName: txt('app-listen-ptt-other-name'),
          otherHint: txt('app-listen-ptt-other-hint'),
          locked: '',
          why: visible('app-listen-ptt-why') ? txt('app-listen-ptt-why') : '',
          note: '',
          recording: (() => { const d = dbg(); return !!(d && d.ptt && d.ptt.on); })(),
          recSide: (() => { const d = dbg(); return (d && d.ptt && d.ptt.side) || ''; })(),
          disabled: (() => { const e = el('app-listen-ptt-mine'); return !!(e && e.disabled); })(),
          state: (d && d.ptt) || null,
        },
        nowLabel: txt('app-listen-now-label'),
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
