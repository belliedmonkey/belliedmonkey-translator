// build/cn-relay-gate.js — CN 免费额度中继的 /spec 探活（构建闸）。
//
// 2026-11-04（BEL-188）：旧的腾讯云 Web 函数在 11-01 14:30:39 被删除，境内 NXDOMAIN，
// CN 141/142 的译文全失败；而构建侧没有任何东西会发现「地址还在、机器没了」——
// 包照样出、签名照样过、只有用户点翻译时才失败。这一道闸就是让那种包出不了厂：
// CN flavor 在写任何产物之前请求 `<relayUrl>/spec`，只有 HTTP 200 才继续。
//
// 判据故意做成纯注入：`getStatus` 可替换，单测才能喂 200 / 500 / 网络错误，
// 不必真的连网（test/cn-relay-gate.test.js）。默认实现用 curl，与发布机一致。
'use strict';

const { execFileSync } = require('child_process');

const DEFAULT_TIMEOUT_MS = 15000;

function specUrl(relayUrl) {
  const base = String(relayUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('CN relay spec gate: relayUrl 为空');
  let u;
  try { u = new URL(base); } catch (_) { throw new Error(`CN relay spec gate: relayUrl 不是合法地址（${base}）`); }
  if (u.protocol !== 'https:') throw new Error(`CN relay spec gate: relayUrl 不是 https（${base}）`);
  return base + '/spec';
}

// 默认探活：curl 只取状态码，响应体丢弃。--max-time 保证构建不会无限挂住。
function curlStatus(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  return String(execFileSync('curl', [
    '-sS', '--max-time', String(seconds), '-o', '/dev/null', '-w', '%{http_code}', url,
  ], { encoding: 'utf8', timeout: timeoutMs + 2000 })).trim();
}

// 200 才返回；否则 throw —— 调用方（build.js）负责 exit(1)。
// 返回 { url, status } 便于测试与日志；成功时固定打一行「CN relay spec 200」。
function assertCnRelaySpec(relayUrl, opts = {}) {
  const url = specUrl(relayUrl);
  const log = opts.log || ((m) => console.log(m));
  const getStatus = opts.getStatus || ((u) => curlStatus(u, opts));
  let status;
  try {
    status = String(getStatus(url));
  } catch (e) {
    throw new Error(`CN relay spec gate FAILED: ${url} 探活失败 —— ${(e && e.message) || e}`);
  }
  if (status !== '200') {
    throw new Error(`CN relay spec gate FAILED: ${url} 返回 HTTP ${status || '(空)'}，要求 200 —— 不出包`);
  }
  log(`CN relay spec 200 — ${url}`);
  return { url, status: 200 };
}

module.exports = { assertCnRelaySpec, specUrl, curlStatus, DEFAULT_TIMEOUT_MS };
