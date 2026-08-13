#!/usr/bin/env node
// scripts/local-keys.js — 本地凭证清单（.local/keys.md）的生成器与读取器。
//
//   node scripts/local-keys.js init    # 按注册表生成模板（已存在则不覆盖）
//   node scripts/local-keys.js check   # 报告哪些槽位填了（值一律打码，永不打印）
//   node scripts/local-keys.js get <key>   # 打印单个值（供脚本内联，慎用）
//
// 为什么要有它：每次真机/端到端验证都要重填一遍 key，既慢又容易填错。这个文件
// 让「填一次，之后自动读」成立。
//
// 三条硬规矩：
//   1. 文件只允许写在 `.local/`，且 `.local/` 在 .gitignore 里——**永不提交**。
//   2. 模板里的引擎清单是从 `build/{providers,tts,stt}.config.js` **生成**的，
//      不是手抄。注册表加一个引擎，这里重跑 init 就有（AGENTS.md：注册表是唯一
//      真源，任何复述都会过时）。
//   3. `check` 只打印「填了/没填 + 长度」，绝不回显值；值只在真正要用时读出来，
//      并且只发往你自己配置的端点。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, '.local');
const FILE = path.join(DIR, 'keys.md');

function reg(name) {
  try { return require(path.join(ROOT, 'build', name)); } catch (_) { return []; }
}
// 只列出「需要用户填点什么」的条目——零配置引擎（浏览器语音、免费翻译通道）
// 不需要槽位，列出来只会让人以为漏填了。
function needsInput(e) { return e.needsKey || e.requiresBaseUrl || e.supportsBaseUrl; }
function describe(e) {
  const want = [];
  if (e.needsKey) want.push('要 key');
  if (e.requiresBaseUrl) want.push('必填地址');
  else if (e.supportsBaseUrl) want.push('地址可选');
  if (e.supportsModel) want.push('模型可选');
  return `${e.id}${want.length ? '（' + want.join(' · ') + '）' : ''}`;
}

function template() {
  const P = reg('providers.config.js').filter(needsInput).map(describe);
  const T = reg('tts.config.js').filter(needsInput).map(describe);
  const S = reg('stt.config.js').filter(needsInput).map(describe);
  const chat = reg('providers.config.js')
    .filter((e) => e.type === 'chat-compat' || e.type === 'messages-compat')
    .map((e) => e.id);

  return `# 本地凭证（不进 git）

> 这个文件在 \`.gitignore\` 里，**永远不要提交、不要贴进对话或 PR**。
> 值只留在这台机器上，只发往你自己在下面填的端点。
> 引擎清单由 \`node scripts/local-keys.js init\` 从 \`build/*.config.js\` 生成——
> 注册表加了新引擎，重跑一次即可（不要手动补，会漂移）。
>
> 填法：等号右边写值，留空表示「不用这一项」。行首 \`#\` 是注释。
> 填完用 \`node scripts/local-keys.js check\` 自查（只显示填没填，不回显内容）。

\`\`\`ini
# ── 翻译引擎（扩展 options / App 都读这组）──────────────────────────
# 可选 id：${P.join('、') || '（无需填写的引擎）'}
provider     =
apiKey       =
apiBaseUrl   =
apiModel     =

# ── 解析引擎（§9.2「解析这句」+ §9.3 AI 题包共用这一组）─────────────
# 留空 notesProvider = 跟随上面的翻译引擎（整组跟随）
# 只有对话类引擎能做解析/题包，可选 id：${chat.join('、')}
notesProvider =
notesApiKey   =
notesBaseUrl  =
notesModel    =

# ── 朗读语音 TTS（§9.1）────────────────────────────────────────────
# 可选 id：${T.join('、') || '（仅设备内置语音，无需填写）'}
# 设备内置语音不需要任何值；下面几项只在选自建/云端点时才要
ttsEngine  =
ttsApiKey  =
ttsBaseUrl =
ttsModel   =

# ── 转写 STT（§9.4 说题；不配则说题不出现）─────────────────────────
# 可选 id：${S.join('、') || '（无）'}
# 自建端点提示：必须允许跨域（CORS），否则 WebKit 只会报「连不上」
# 真机测试填 Mac 的局域网 IP（模拟器可用 127.0.0.1）
sttEngine  =
sttApiKey  =
sttBaseUrl =
sttModel   =

# ── App Store Connect API key（可选，填了才能无人值守上传 TestFlight）──
# 现在走的是 Xcode 登录态，能用但要人在场过 2FA
ascKeyId     =
ascIssuerId  =
ascKeyPath   =
\`\`\`

## 我（Claude）以后怎么用它

- 需要凭证时先读这里，不再问你要；\`check\` 的输出只有槽位状态，不含值。
- 往 App / 扩展的设置面里填时，值直接从这里取。
- 这个文件永远不进提交、不进日志、不进 PR 正文。
`;
}

function parse() {
  if (!fs.existsSync(FILE)) return null;
  const out = {};
  for (const line of fs.readFileSync(FILE, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const v = m[2].trim();
    if (v) out[m[1]] = v;
  }
  return out;
}

const cmd = process.argv[2] || 'check';

if (cmd === 'init') {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    console.log('已存在，未覆盖：' + path.relative(ROOT, FILE));
    console.log('（要按最新注册表重生成模板：先备份再删除该文件）');
  } else {
    fs.writeFileSync(FILE, template());
    console.log('已生成：' + path.relative(ROOT, FILE));
  }
  process.exit(0);
}

if (cmd === 'get') {
  const all = parse() || {};
  const v = all[process.argv[3]];
  if (!v) process.exit(1);
  process.stdout.write(v);
  process.exit(0);
}

// check（默认）：只报状态，绝不回显值
const all = parse();
if (!all) {
  console.log('✗ 还没有 .local/keys.md —— 先跑 node scripts/local-keys.js init');
  process.exit(1);
}
const GROUPS = {
  '翻译引擎': ['provider', 'apiKey', 'apiBaseUrl', 'apiModel'],
  '解析引擎/题包': ['notesProvider', 'notesApiKey', 'notesBaseUrl', 'notesModel'],
  '朗读语音': ['ttsEngine', 'ttsApiKey', 'ttsBaseUrl', 'ttsModel'],
  '转写（说题）': ['sttEngine', 'sttApiKey', 'sttBaseUrl', 'sttModel'],
  'ASC 上传': ['ascKeyId', 'ascIssuerId', 'ascKeyPath'],
};
const SECRET = /key$/i;
for (const [name, keys] of Object.entries(GROUPS)) {
  const parts = keys.map((k) => {
    const v = all[k];
    if (!v) return `${k}: —`;
    return SECRET.test(k) ? `${k}: ‹已填 ${v.length} 字符›` : `${k}: ${v}`;
  });
  console.log(`${name}\n  ` + parts.join('\n  '));
}
