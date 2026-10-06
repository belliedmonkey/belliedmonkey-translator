// app/diag-log.js — 诊断日志：真机哑、说不清的那类故障，从此有设备侧证据。
// （§0.4.1 证据缺口的补法，2026-10-06 用户拍板：手机端补打点；中国版零网络，选项 A ——
//   只落本机 + 设置里手动导出，自动上报（L2）另批。）
//
// 纪律（三道门禁钉着，test/diag-log.test.js）：
//   1. **零内容**：每类事件的字段白名单在 push 处强制 —— 白名单外的键一个都进不来。
//      事件里永远没有用户文本/译文/URL 凭证，只有 reason code、语言码、字节数、时长。
//   2. **schema 白名单**：事件种类是固定集合（六类，按 2026-09/10 的真机故障清单定）；
//      加一类 = 改设计文档（规则 4 的既有纪律），不是改代码。
//   3. **体量**：200 条环形、~25KB 上限，storage.local 单键持久化（防抖写）。
var DiagLog = (() => {
  const KEY = 'mtDiagLog';
  const MAX = 200;

  const SCHEMA = {
    // 模型下载：哪一级地址、成没成、sha 对没对（2026-10-06 泰国拉不动魔搭那类）
    dl: ['path', 'tier', 'phase', 'sha_ok', 'bytes', 'dur_ms', 'why'],
    // 引擎装载：vits/kokoro 起没起来、失败原因（#567 reason:"load" 此前真机完全不可见）
    tts_engine: ['lang', 'model_type', 'phase', 'fail_reason'],
    // 朗读链结局：ok/reason/engine/fallback/到出声耗时（#568 在途失败不可见）
    speak: ['lang', 'ok', 'reason', 'engine', 'fallback', 'start_ms'],
    // 探测结果：识别/朗读探针的结论
    probe: ['kind', 'ok', 'reason', 'langs', 'assets'],
    // 登录里程碑：provider + 阶段 + 错误 code（无 token；504-Apple 那类）
    auth: ['provider', 'phase', 'code'],
    // 引擎 id 自愈：脏值被重写（ensureDeviceTts）
    engine_fix: ['from', 'to'],
  };

  let buf = null;
  let writing = false;

  function persist() {
    if (writing) return;
    writing = true;
    setTimeout(() => {
      writing = false;
      try { chrome.storage.local.set({ [KEY]: buf }, () => {}); } catch (_) {}
    }, 800);
  }

  function ensure() {
    if (buf) return;
    buf = [];
    try {
      chrome.storage.local.get([KEY], (v) => {
        if (Array.isArray(v && v[KEY])) buf = v[KEY].slice(-MAX);
      });
    } catch (_) {}
  }

  function push(kind, fields) {
    ensure();
    if (!SCHEMA[kind]) return;                    // 白名单外的事件类型直接丢（schema 门）
    const f = {};
    const src = fields || {};
    for (const k of SCHEMA[kind]) if (src[k] !== undefined) f[k] = src[k];   // 字段白名单过滤
    buf.push({ t: Date.now(), k: kind, f });
    if (buf.length > MAX) buf.splice(0, buf.length - MAX);
    persist();
  }

  function all() { ensure(); return buf.slice(); }

  function exportText() {
    ensure();
    const head = {
      what: 'mt-diag',                                    // 导入侧的识别标记
      flavor: (typeof window !== 'undefined' && window.MT_FLAVOR) || '',
      ua: (typeof navigator !== 'undefined' && navigator.userAgent) || '',
      exported_at: new Date().toISOString(),
      count: buf.length,
    };
    return JSON.stringify(head, null, 1) + '\n' + buf.map((e) => JSON.stringify(e)).join('\n');
  }

  function clear() { ensure(); buf = []; try { chrome.storage.local.set({ [KEY]: [] }, () => {}); } catch (_) {} }

  return { push, all, exportText, clear, SCHEMA, MAX, KEY };
})();
try { window.DiagLog = DiagLog; } catch (_) {}
if (typeof module !== 'undefined' && module.exports) module.exports = DiagLog;
