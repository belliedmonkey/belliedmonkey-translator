// test/model-urls-not-plaintext.test.js — 模型下载地址不得以明文出现在编译进包的配置里（2026-10-05 用户裁定）。
//
// 理由见 docs/verification-spec.md「硬编码禁令」：反编译能看到 device-models.config.js 的兜底 URL；
// 真实托管地址写在那里等于把 CC-BY-NC 模型的来源暴露给任何人。
// 门禁：device-models.config.js 的 url 字段只许 api.belliedmonkey.com 前缀（自家域名中继）。
const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'app', 'device-models.config.js'), 'utf8');

// 第三方托管域名（真实地址只许出现在 bt_model_sources 表和 Caddyfile 里，不进客户端包）
const FORBIDDEN = [
  /github\.com\/belliedmonkey/,
  /modelscope\.cn/,
  /hf-mirror\.com/,
  /huggingface\.co/,
  /cdn-lfs/,
  /raw\.githubusercontent/,
];

describe('模型下载地址不得明文进包（硬编码禁令）', () => {
  test('★ device-models.config.js 的 URL 只许自家域名中继', () => {
    const urls = src.match(/https:\/\/[^\s'"]+/g) || [];
    ok(urls.length > 0, '没解析到任何 URL —— 文件形状变了？');
    for (const u of urls) {
      for (const re of FORBIDDEN) {
        ok(!re.test(u), `URL 出现了第三方托管域名（${re.source}）：${u} —— 真实地址只许在 bt_model_sources 表和 Caddyfile 里（verification-spec「硬编码禁令」）`);
      }
    }
    ok(src.includes('MT_MODEL_RELAY'), '没有 MT_MODEL_RELAY 中继变量 —— 兜底地址该走自家域名');
    ok(src.includes('api.belliedmonkey.com/models/'), '中继地址不是 api.belliedmonkey.com/models/ —— 反编译应只看到自家域名');
  });
});
