// test/lib/copy-redlines.js — 商店文案的口径红线（App Store 的 aso.md 与 AMO 的 amo-listing.md 共用）。
//
// 2026-09-15 发 1.11.0 前审文案时，15 个语种里挑出三类早就不成立、却没有任何门禁看得见的句子：
//
//   ① 「没有追踪 / 没有埋点 / no telemetry」—— 1.7.16 起就在发匿名用量事件（可在设置里关）。
//      同一段里一边说「没有追踪」一边说「只发匿名用量事件」，读者只会记住前半句。
//      官网那边 site:audit 早就禁了 no telemetry，商店文案这边从来没人查。
//   ② 不加限定的「完全免费」—— 自带 key 要付服务商的钱，免费额度有上限（release-checklist 红线）。
//   ③ 「翻译链路上没有我们的服务器」—— 1.9.0 起国际版的免费额度经我们的中继（Gate F：按路径说，不说绝对话）。
//      中国版没有免费额度，这句对它仍然为真，所以③只对国际版生效。
//
// 每条正则都来自当时文案里的原句（各语种的真实写法），不是凭空猜的译法。

// ① 追踪 / 遥测的绝对说法
const NO_TRACKING = [
  /\bno (tracking|telemetry)\b/i,
  /没有埋点|无埋点|无追踪|没有追踪|不追踪/,
  /沒有追蹤|無追蹤|沒有埋點/,
  /トラッキングなし/,
  /추적 없음|추적하지 않/,
  /kein Tracking/i,
  /aucun pistage/i,
  /sin rastreo/i,
  /никакой слежки|слежки нет/i,
  /sem rastreamento/i,
  /لا تتبّع|لا تتبع/,
  /nessun tracciamento/i,
  /takip yok|telemetri yok/i,
  /không theo dõi/i,
  /bez śledzenia/i,
];

// ② 不加限定的「完全免费」
const FULLY_FREE = [
  /完全免费|完全免費/,
  /\b(completely|fully|100%) free\b/i,
  /完全に無料/,
  /완전히 무료/,
  /vollständig kostenlos/i,
  /entièrement gratuit/i,
  /completamente gratis/i,
  /полностью бесплатно/i,
  /totalmente gratuito/i,
  /مجاني بالكامل/,
];

// ③ 「翻译路径上没有我们的服务器」（仅国际版）
const NO_SERVER_OF_OURS = [
  /\bno servers? of ours\b/i,
  /翻译链路上没有我们的服务器|无中间服务器|不经过我们的服务器/,
  /翻譯路徑上(也)?沒有我們的伺服器/,
  /当方のサーバーは一切ありません/,
  /저희 서버는 없습니다/,
  /kein Server von uns/i,
  /aucun serveur à nous/i,
  /ningún servidor nuestro/i,
  /нет наших серверов/i,
  /nenhum servidor nosso/i,
  /لا خادم لنا/,
  /nessun nostro server/i,
  /bize ait hiçbir sunucu yok/i,
  /không có máy chủ nào của chúng tôi/i,
  /nie ma żadnego naszego serwera/i,
];

// 国际版不点名服务商：注册表（build/providers.config.js）变了商店文案不会跟着变。
// YouTube 不在此列 —— 那是被翻译的站点，不是引擎；国际版 keywords 里保留（aso.md 约束 2）。
const PROVIDER_BRANDS = /\b(OpenAI|ChatGPT|Claude|Anthropic|Gemini|DeepSeek|GLM|Kimi|Google)\b|智谱|通义千问/;

// 返回命中的第一条正则，没有则 null
function firstHit(list, text) {
  for (const re of list) if (re.test(text)) return re;
  return null;
}

module.exports = { NO_TRACKING, FULLY_FREE, NO_SERVER_OF_OURS, PROVIDER_BRANDS, firstHit };
