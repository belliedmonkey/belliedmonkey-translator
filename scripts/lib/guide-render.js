// scripts/lib/guide-render.js — 把注册表渲染成官网的教程页。
// 数据来自 scripts/gen-setup-guide.js；这里只管排版与两种语言的行文。
'use strict';

const fs = require('fs');
const path = require('path');
const G = require('../gen-setup-guide.js');

const PROVIDERS = require('../../build/providers.config.js');
// 教程页的主色也从调色板注册表取，不再自己抄一份：这里原来写死 #b2622d，白底上 4.49:1
// 差一线不过 AA（2026-09-06 深浅色核查）。terra550 是白字 / 白底两个方向都过线的那一档。
const PALETTE = require('../../build/palette.config.js').ramps;
const STT = require('../../build/stt.config.js');
const TTS = require('../../build/tts.config.js');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const code = (s) => `<code>${esc(s)}</code>`;

const STYLE = `<style>
  :root { color-scheme: light dark; --accent:${PALETTE.terra550}; --ink:#1a1a1a; --sub:#7a7268; --line:#e6ded1; --bg:#fff; --well:#faf6f0; }
  @media (prefers-color-scheme: dark) { :root { --ink:#e6e6e6; --sub:#9a9188; --line:#333; --bg:#111; --well:#1b1a19; --accent:#e08a4d; } }
  body { max-width:760px; margin:0 auto; padding:28px 20px 72px; background:var(--bg); color:var(--ink);
         font:16px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  nav { display:flex; align-items:center; gap:14px; margin-bottom:34px; font-size:.9rem; }
  nav a.brand { font-weight:700; color:var(--ink); text-decoration:none; }
  nav .spacer { flex:1; }
  a { color:var(--accent); }
  h1 { font-size:1.8rem; line-height:1.3; margin:0 0 8px; }
  h2 { font-size:1.18rem; margin:38px 0 8px; }
  h3 { font-size:1rem; margin:22px 0 4px; }
  .lede { color:var(--sub); margin:0 0 6px; }
  p { margin:0 0 14px; }
  code { background:var(--well); border:1px solid var(--line); border-radius:5px; padding:1px 5px;
         font:.86em/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; word-break:break-all; }
  table { border-collapse:collapse; width:100%; margin:14px 0 18px; font-size:.92rem; display:block; overflow-x:auto; }
  th, td { border:1px solid var(--line); padding:8px 10px; text-align:start; vertical-align:top; }
  th { background:var(--well); font-weight:600; }
  ol.steps { padding-inline-start:20px; }
  ol.steps > li { margin-bottom:8px; }
  .note { background:var(--well); border:1px solid var(--line); border-left:3px solid var(--accent);
          border-radius:8px; padding:12px 14px; margin:16px 0; }
  .cta { display:block; margin:34px 0 8px; padding:16px 18px; border:1px solid var(--line); border-radius:12px;
         text-decoration:none; color:var(--ink); }
  .cta strong { color:var(--accent); }
  footer { margin-top:52px; padding-top:18px; border-top:1px solid var(--line); display:flex; flex-wrap:wrap;
           gap:14px; font-size:.85rem; color:var(--sub); }
  footer a { color:var(--sub); }
</style>`;

function engineTable(rows, cols) {
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = rows.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('\n    ');
  return `<table>\n  <thead><tr>${head}</tr></thead>\n  <tbody>\n    ${body}\n  </tbody>\n</table>`;
}

// schema.org 的 text 字段是**纯文本**，不该带标签。步骤文案里混了 <code>（地址那种），
// 所以进 JSON-LD 之前统一剥掉：既符合规范，也让「标注与正文一致」那道门禁只需要
// 处理一种差异（空白），而不是两种。
const plain = (s) => String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function howToJsonLd(site, title, desc, steps) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: title,
    description: desc,
    url: `https://${site.host}/guide.html`,
    totalTime: 'PT5M',
    supply: [], tool: [],
    step: steps.map((s, i) => ({
      '@type': 'HowToStep', position: i + 1, name: plain(s.name), text: plain(s.text),
      url: `https://${site.host}/guide.html#step${i + 1}`,
    })),
  }, null, 2);
}

module.exports.build = function build(flavor) {
  const site = G.SITES[flavor];
  const provs = G.forFlavor(PROVIDERS, flavor);
  const stts = G.forFlavor(STT, flavor);
  const ttss = G.forFlavor(TTS, flavor);
  const ds = provs.find((p) => p.id === 'deepseek');
  const cloudStt = stts.find((s) => s.needsKey);
  const cloudTts = ttss.find((t) => t.needsKey);
  const deviceTts = ttss.find((t) => t.id === 'browser');
  const localStt = stts.find((s) => s.id === 'local');
  const m = G.measured('api.deepseek.com', ds.model);
  const mg = G.measured('open.bigmodel.cn', 'glm-4.6');

  const engineRows = provs.filter((p) => p.needsKey && p.endpoint).map((p) => [
    esc(p.label),
    code(p.endpoint),
    p.model ? code(p.model) : '—',
    p.console ? `<a href="${p.console}" target="_blank" rel="noopener">${esc(p.console.replace(/^https:\/\//, ''))}</a>` : '—',
  ]);
  const customRows = provs.filter((p) => !p.endpoint && p.placeholder).map((p) => [
    esc(p.label), code(p.placeholder), '—', '—',
  ]);

  return (flavor === 'china' ? renderZh : renderEn)({
    site, provs, stts, ttss, ds, cloudStt, cloudTts, deviceTts, localStt,
    m, mg, engineRows, customRows,
  });
};

// ─────────────────────────────────────────────────────────── 国际版（英文）
function renderEn(d) {
  const { site, ds, cloudStt, cloudTts, deviceTts, m, mg, engineRows, customRows } = d;
  const steps = [
    { name: 'Install the app and switch the extension on',
      text: `Install from the App Store, or load the Chrome or Firefox build. Then switch the extension on once — on iPhone that happens in Settings, and ${site.host}/setup.html detects it and confirms when it is actually working.` },
    { name: `Get an API key from ${esc(ds.label)}`,
      text: `Sign up at ${ds.console} and create an API key. Any of the supported providers works; this guide uses ${esc(ds.label)} because it is inexpensive, fast enough for whole pages, and its key works from anywhere.` },
    { name: 'Enter the key in Settings and test the connection',
      text: `Open the extension's Settings, choose ${esc(ds.label)} as the translation engine, paste the key, and press Test connection. The endpoint and model are filled in for you — ${ds.endpoint} with model ${ds.model} — and you only change them if you are pointing at a gateway or a different model.` },
    { name: 'Choose how sentences are read aloud',
      text: `The device's built-in voice is free, works offline and needs no key, which is the right default. If you want a better voice for listening practice, ${esc(cloudTts.label)} takes a key of its own at ${cloudTts.endpoint} with model ${cloudTts.model}.` },
    { name: 'Add transcription so the speaking exercises work',
      text: `Speaking review needs to hear you, which means a transcription endpoint. ${esc(cloudStt.label)} uses ${cloudStt.endpoint} with model ${cloudStt.model} and the same kind of key. If you would rather nothing left your machine, point it at a local server instead — the field takes any endpoint speaking the same shape.` },
    { name: 'Translate one page to confirm it works',
      text: 'Open a page in a language you do not read, switch translation on, and check that each paragraph keeps its original with the translation underneath. If a paragraph fails it now says so with a retry you can press, rather than sitting at "Translating…".' },
  ];

  return `<!DOCTYPE html>
<html lang="en" data-page="guide">
<head>
<title>Setup guide: your own translation engine, step by step</title>
<link rel="canonical" href="https://${site.host}/guide.html">
<meta name="description" content="A complete, working configuration: which key to get, the exact endpoint and model to enter, how to add read-aloud and transcription, and what to do when a request fails.">
<meta property="og:type" content="article">
<meta property="og:url" content="https://${site.host}/guide.html">
<meta property="og:title" content="Setup guide: your own translation engine, step by step">
<meta property="og:description" content="The exact endpoint, model and key for a configuration that works — plus the measurements behind the recommendation.">
<meta property="og:image" content="https://${site.host}/icon.png">
<meta name="twitter:card" content="summary">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/icon.png">
${STYLE}
<script type="application/ld+json">
${howToJsonLd(site, 'Setup guide: your own translation engine, step by step',
  'A complete working configuration for BelliedMonkey Translator: key, endpoint, model, read-aloud and transcription.', steps)}
</script>
</head>
<body>
<nav>
  <a class="brand" href="/">BelliedMonkey</a>
  <span class="spacer"></span>
  <a href="/faq.html">FAQ</a>
  <a href="/setup.html">Set up</a>
</nav>

<h1>Setup guide: your own translation engine, step by step</h1>
<p class="lede">One configuration that works end to end — the exact endpoint, the exact model, and the measurements behind the choice.</p>

<p>Translation needs an engine, and an engine needs a key of your own. That is the whole setup: this guide walks through one configuration end to end — translation good enough to read closely, plus the listening and speaking review that needs speech and transcription. The point of bringing your own keys is that your text goes from your browser to that provider directly; there is no server of ours in between.</p>

<h2>What this guide sets up</h2>
${engineTable([
  ['Translation', esc(d.ds.label), code(d.ds.model), 'Paid, cheap, fast enough for whole pages'],
  ['Read-aloud', esc(deviceTts.label.replace(/\s*[（(].*$/, '')), '—', 'Free, offline, no key'],
  ['Transcription', esc(cloudStt.label), code(cloudStt.model), 'Needed only for speaking review'],
], ['Job', 'Engine', 'Model', 'Why'])}

<h2 id="step1">1. Install it and switch the extension on</h2>
<p>${steps[0].text}</p>

<h2 id="step2">2. Get an API key</h2>
<p>${steps[1].text}</p>

<h2 id="step3">3. Enter the key and press Test connection</h2>
<p>${steps[2].text}</p>
<div class="note"><strong>The address is used exactly as you store it.</strong> Nothing is appended to it and no path is guessed, so a corporate gateway or a proxy on its own domain works by pasting its full URL — including the path. That is also why an address without a path fails: ${code(exampleHost(d))} is not an endpoint, ${code(exampleAddr(d))} is.</div>

<h2 id="step4">4. Read-aloud</h2>
<p>${steps[3].text}</p>

<h2 id="step5">5. Transcription, for the speaking exercises</h2>
<p>${steps[4].text}</p>

<h2 id="step6">6. Translate one page to confirm</h2>
<p>${steps[5].text}</p>

<h2>Turning the review cards on</h2>
<p>Translation works without this, so it is not one of the six steps. Capture is <strong>off by default</strong>; turning it on is what makes the sentences you actually stopped and read become review cards — extension settings → <strong>Collect study material</strong>. It records only sentences you dwelled on, never everything you scrolled past, and the cards stay on the device until you choose to sign in.</p>
<p>That switch lives in the extension, not in the app. The two have separate storage, so a switch drawn in the app would write somewhere the extension never reads — which is why the app sends you here instead of pretending otherwise.</p>

<h2>Why this engine, and why you do not have to tune it</h2>
${m ? `<p>Reasoning models are the trap here. Left alone, ${esc(d.ds.label)}'s ${code(d.ds.model)} spends tokens thinking about every single paragraph: measured on ${m.date}, one paragraph took ${m.before} ms and burned ${m.thinkBefore} thinking tokens. With thinking switched off the same paragraph came back in ${m.after} ms — ${m.x}× faster for text that reads the same.</p>` : ''}
${mg ? `<p>The extension sends that parameter for you, per host and per model, from a table built out of measurements rather than documentation. The reason it has to be measured is that documentation does not predict it: on another provider the identical situation cost ${mg.before} ms before and ${mg.after} ms after — ${mg.x}× — and on a third, sending the documented parameter returns HTTP 200 with an empty body, which looks like a bug in the extension and is not.</p>` : ''}
<p>A host the table has never seen gets the protocol minimum and nothing else, which is why a gateway inside your own company works on the first try instead of failing on a parameter it does not implement.</p>

<h2>Every engine, with its exact address</h2>
<p>These are read from the same registry the software ships with, so this table cannot drift away from what the app actually does.</p>
${engineTable(engineRows, ['Engine', 'Endpoint', 'Default model', 'Where to get a key'])}
<p>Anything else that speaks one of the two request shapes works too — you supply the whole address yourself:</p>
${engineTable(customRows, ['Entry', 'Address shape', '', ''])}

<h2>When something does not work</h2>
<h3>The key is rejected but you are sure it is right</h3>
<p>Several providers issue region-bound keys and run separate hosts for them, so a key from one console will not authenticate against the other's address. Check that the endpoint's domain matches the console you created the key in.</p>
<h3>Nothing happens and there is no error</h3>
<p>A request that returns HTTP 200 with an empty body is almost always a reasoning model that spent its whole output budget thinking. The extension avoids this for the models it knows; if you switched to a model by hand, switch back or reduce it to a non-reasoning one.</p>
<h3>It works in one browser but not another</h3>
<p>Settings live on the device and do not travel to your other ones — enter the key again there. Sync carries the learning corpus and nothing else: the cards, the reviews, and the pages they came from. Your keys never leave the device, which is the entire point of bringing your own.</p>

<a class="cta" href="/setup.html"><strong>Not switched on yet? Start here →</strong><br>
Three steps, about a minute. That page detects the extension and confirms when it is actually working.</a>

<p>See also: <a href="/faq.html">frequently asked questions</a> · <a href="/youtube-dual-subtitles.html">YouTube dual subtitles</a> · <a href="/safari-ios-translate-extension.html">Safari on iPhone</a></p>

<footer>
  <span>© 2026 BelliedMonkey, LLC</span>
  <a href="/">Product</a>
  <a href="/faq.html">FAQ</a>
  <a href="/privacy.html">Privacy</a>
  <a href="/support.html">Support</a>
  <a href="https://github.com/belliedmonkey/belliedmonkey-translator" target="_blank" rel="noopener">Source code</a>
</footer>
</body>
</html>
`;
}
module.exports.renderEn = renderEn;

// ─────────────────────────────────────────────────────────── 中国版（中文）
//
// 这不是英文那份的翻译。中国版的注册表**给的东西本来就少**：没有免费通道（必须自带
// key）、没有云端转写（只能自建）、没有云端朗读。照着英文那份翻会得到一页教人用
// 不存在的功能的教程 —— 所以这里的每一段都由 flavor 过滤后的注册表决定。
function renderZh(d) {
  const BEIAN = beianOf(d.site.dir);
  const { site, ds, deviceTts, localStt, m, mg, engineRows, customRows } = d;   // ttss 由 localTtsShape(d) 直接取
  const steps = [
    { name: '装好 App，并把扩展启用',
      text: `从 App Store 装好之后，还要手动把 Safari 扩展打开一次。iPhone 上这一步在「设置」里；打开 ${site.host}/setup.html，那一页会自己检测，成功了它会变绿告诉你。` },
    { name: `到 ${esc(ds.label)} 拿一个 API Key`,
      text: `在 ${ds.console} 注册并创建一个 API Key。支持的引擎都可以，这份教程用 ${esc(ds.label)}：便宜、整页翻译够快，而且不需要额外的网络条件。` },
    { name: '把 Key 填进设置，点「测试连接」',
      text: `打开扩展设置，翻译引擎选 ${esc(ds.label)}，粘贴 Key，点「测试连接」。端点与模型已经替你填好 —— ${ds.endpoint}，模型 ${ds.model} —— 只有当你要指向中转、网关或换一个模型时才需要改它们。` },
    { name: '朗读用设备内置语音',
      text: `${esc(deviceTts.label)}：不需要 Key、不联网、不花钱，这是正确的默认。想换更好的声音，可以填一个自建的语音端点，地址形如 ${localTtsShape(d)}。` },
    { name: '要做「说」这一档，需要一个转写端点',
      text: `说题要听见你，也就需要一个转写接口。中国版不内置云端转写，只有自建这一条路：把地址填成 ${localStt.placeholder} 这个形状即可，仓库里带了一个可直接跑的桥接脚本。好处是录音根本不出你这台机器。` },
    { name: '翻一页确认它真的在工作',
      text: '打开一篇你读不懂的外文页面，打开翻译，确认每段原文下方都出现了译文。某一段失败时它现在会明说，并给一个可以点的重试，而不是一直停在「翻译中」。' },
  ];

  return `<!DOCTYPE html>
<html lang="zh-Hans" data-page="guide">
<head>
<title>配置教程：把自己的翻译引擎接上，一步一步来</title>
<link rel="canonical" href="https://${site.host}/guide.html">
<meta name="description" content="一份能跑通的完整配置：去哪拿 Key、端点和模型填什么、朗读与转写怎么接、请求失败时该看哪里。">
<meta property="og:type" content="article">
<meta property="og:url" content="https://${site.host}/guide.html">
<meta property="og:title" content="配置教程：把自己的翻译引擎接上，一步一步来">
<meta property="og:description" content="端点、模型、Key 一个不含糊，附推荐背后的实测数据。">
<meta property="og:image" content="https://${site.host}/icon.png">
<meta name="twitter:card" content="summary">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/icon.png">
${STYLE}
<script type="application/ld+json">
${howToJsonLd(site, '配置教程：把自己的翻译引擎接上，一步一步来',
  '大肚猴翻译的完整配置流程：Key、端点、模型、朗读与转写。', steps)}
</script>
</head>
<body>
<nav>
  <a class="brand" href="/">大肚猴翻译</a>
  <span class="spacer"></span>
  <a href="/setup.html">启用扩展</a>
  <a href="/support.html">支持</a>
</nav>

<h1>配置教程：把自己的翻译引擎接上，一步一步来</h1>
<p class="lede">一套能从头跑到尾的配置——端点写什么、模型写什么，以及为什么是这个选择（附实测）。</p>

<p>这个版本没有内置的免费通道，翻译从第一步起就要用你自己的 API Key。这不是少给了什么：Key 在你手上，意味着请求由你的设备直接发往你选择的服务商，中间没有我们的服务器，也就没有一个能看到你在读什么的地方。代价是你要自己去开一个账号，这份教程就是把那几步说清楚。</p>

<h2>这份教程配出来的组合</h2>
${engineTable([
  ['翻译', esc(d.ds.label), code(d.ds.model), '便宜，整页翻译够快'],
  ['朗读', esc(deviceTts.label.replace(/\s*[（(].*$/, '')), '—', '免费、离线、不需要 Key'],
  ['转写', '自建端点', '—', '只有做「说」这一档才需要'],
], ['做什么', '引擎', '模型', '为什么'])}

<h2 id="step1">1. 装好，并把扩展启用</h2>
<p>${steps[0].text}</p>

<h2 id="step2">2. 拿一个 API Key</h2>
<p>${steps[1].text}</p>

<h2 id="step3">3. 填进设置，点「测试连接」</h2>
<p>${steps[2].text}</p>
<div class="note"><strong>地址是「你存什么就用什么」，我们不做任何拼接。</strong>不会替你补路径，也不会猜。所以中转、网关、自建服务只要把完整地址（含路径）粘进去就能用；也正因如此，少了路径的地址一定失败：${code(exampleHost(d))} 不是一个端点，${code(exampleAddr(d))} 才是。</div>

<h2 id="step4">4. 朗读</h2>
<p>${steps[3].text}</p>

<h2 id="step5">5. 要做「说」这一档，需要一个转写端点</h2>
<p>${steps[4].text}</p>

<h2 id="step6">6. 翻一页确认</h2>
<p>${steps[5].text}</p>

<h2>把复习卡打开</h2>
<p>不打开也能翻译，所以它不算在那六步里。采集<strong>默认是关的</strong>；打开之后，你**停下来读过**的句子才会变成复习卡 —— 扩展设置 →「采集学习材料」。它只记你停留过的句子，不记你划过去的一切；在你主动登录之前，卡片一直只在这台设备上。</p>
<p>这个开关在扩展里，不在 App 里。两边的存储是分开的，在 App 里画一个开关，写下去的地方扩展根本不读 —— 所以 App 把你送到这一页，而不是假装它能设。</p>

<h2>为什么是这个引擎，以及为什么你不用自己调参</h2>
${m ? `<p>推理模型是这里最大的坑。不管它的话，${esc(d.ds.label)} 的 ${code(d.ds.model)} 会为**每一个段落**思考一遍：${m.date} 实测，一段话用了 ${m.before} 毫秒、烧掉 ${m.thinkBefore} 个思考 token。把思考关掉之后，同一段 ${m.after} 毫秒回来，快 ${m.x} 倍，而译文读起来没有区别。</p>` : ''}
${mg ? `<p>这个参数由扩展按「主机 + 模型」替你发出去，依据是一张**实测**出来的表，不是文档摘抄。必须实测的原因是文档预测不了它：同样的情况在另一个引擎上是 ${mg.before} 毫秒变 ${mg.after} 毫秒（${mg.x} 倍）；而在第三个引擎上，按文档发那个参数会得到 HTTP 200 加一个空正文——看起来就像扩展坏了，其实不是。</p>` : ''}
<p>表里没见过的主机，只会收到协议最小集，别的一个字段都不发。这正是公司内网的网关能一次就通的原因——它不会被一个自己没实现的参数噎住。</p>

<h2>全部引擎与它们的准确地址</h2>
<p>下面这张表和软件里用的是同一份注册表，所以它不会和 App 的实际行为走散。</p>
${engineTable(engineRows, ['引擎', '端点地址', '默认模型', '去哪开 Key'])}
<p>只要说得通这两种请求格式，别的服务同样可以用——地址完全由你自己填：</p>
${engineTable(customRows, ['条目', '地址形状', '', ''])}

<h2>不工作的时候</h2>
<h3>Key 明明是对的却报鉴权失败</h3>
<p>有的服务商按区域发 Key，并且为不同区域跑不同的主机；在一个控制台里开的 Key，拿去打另一个地址是认不出来的。核对一下端点的域名和你开 Key 的那个控制台是不是同一边。</p>
<h3>什么都没发生，也没有报错</h3>
<p>返回 HTTP 200 但正文是空的，几乎总是推理模型把输出预算全花在思考上了。扩展对它认识的模型会规避这一点；如果你手动换过模型，换回去，或者改成一个不思考的模型。</p>
<h3>这台机器能用，另一台不能</h3>
<p>设置存在本机，不会自动跑到别的设备上。在另一台上重新填一次即可。</p>

<a class="cta" href="/setup.html"><strong>还没启用扩展？从这里开始 →</strong><br>
三步，大约一分钟。那一页会自己检测，成功了它会告诉你。</a>

<footer>
  <span>© 2026 大肚猴翻译</span>
  <a href="/">产品</a>
  <a href="/setup.html">启用扩展</a>
  <a href="/privacy.html">隐私政策</a>
  <a href="/support.html">技术支持</a>
  ${BEIAN}
</footer>
</body>
</html>
`;
}

// 示例地址取自注册表的 placeholder —— 教程里不许再造一个「看起来像」的地址。
// 门禁会拦：页面上任何形如端点的 <code> 都必须是该 flavor 注册表里真有的。
// 备案号：**从中国站现有页面里读**，不在这里再抄一份。已备案域名的每一页都必须展示
// ICP 号并链到工信部查询页；生成页漏掉它，就是在一个受监管的站点上放了一张不合规的
// 页面 —— 而它不会报错，只会在检查时被发现。
function beianOf(dir) {
  const idx = path.join(dir, 'index.html');
  if (!fs.existsSync(idx)) return '';
  const m = fs.readFileSync(idx, 'utf8')
    .match(/<a href="https:\/\/beian\.miit\.gov\.cn\/"[\s\S]*?公网安备[^<]*<\/a>/);
  return m ? m[0].split('\n').map((l) => l.trim()).filter(Boolean).join('\n  ') : '';
}

function exampleAddr(d) {
  const c = d.provs.find((p) => !p.endpoint && p.placeholder);
  return c.placeholder;
}
function exampleHost(d) {
  return exampleAddr(d).replace(/(https?:\/\/[^/]+).*/, '$1');
}

function localTtsShape(d) {
  const local = d.ttss.find((t) => t.id === 'local');
  return local && local.placeholder ? code(local.placeholder) : '（见设置页内的示例）';
}

module.exports.main = function main(argv) {
  const check = argv.includes('--check');
  let bad = 0;
  for (const flavor of ['global', 'china']) {
    const site = G.SITES[flavor];
    const out = path.join(site.dir, 'guide.html');
    if (!fs.existsSync(site.dir)) { console.log(`  — 跳过 ${flavor}：${site.dir} 不存在`); continue; }
    const html = module.exports.build(flavor);
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
    if (cur === html) { console.log(`  ${flavor.padEnd(6)} 一致，无需重生成（${site.host}/guide.html）`); continue; }
    if (check) {
      console.log(`  ${flavor.padEnd(6)} ✗ 与注册表不一致 —— 跑 node scripts/gen-setup-guide.js 重新生成`);
      bad++;
      continue;
    }
    fs.writeFileSync(out, html);
    console.log(`  ${flavor.padEnd(6)} 已写入 ${out}（${html.length} 字节）`);
  }
  process.exit(bad ? 1 : 0);
};
