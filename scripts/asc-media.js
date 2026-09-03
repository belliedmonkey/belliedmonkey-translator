#!/usr/bin/env node
// scripts/asc-media.js — 把商店截图与预览片推到 App Store Connect 的四条线。
//
// 用法：
//   node scripts/asc-media.js                        # 只打印计划，什么都不动（默认）
//   node scripts/asc-media.js --apply                # 真的替换（**对外动作**，会改线上商店页）
//   node scripts/asc-media.js --apply --only cn-ios  # 只做一条线
//   node scripts/asc-media.js --version 1.6.5        # 版本默认取 package.json，可覆盖
//
// --only 的取值就是 PLAN 里的 id：global-ios / global-mac / global-ios-zh /
// global-mac-zh / cn-ios / cn-mac。
//
// 与 cws-publish / amo-publish 同一套分档：默认什么都不做，替换商店素材是对外动作，
// 不该是副作用。
//
// ASC 的资产上传是三步，缺一步就得到一个「已创建但永远转不完」的空壳：
//   ① 预留   POST /appScreenshots  {fileName,fileSize} → 返回 uploadOperations
//   ② 传字节 按 uploadOperations 逐段 PUT（可能不止一段，必须按 offset/length 切）
//   ③ 提交   PATCH {uploaded:true, sourceFileChecksum:<md5>}
// 校验和不是可选的：漏了它 Apple 侧会一直停在 UPLOAD_COMPLETE 而不进 COMPLETE。
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');
const API = 'https://api.appstoreconnect.apple.com/v1';

function slot(name) {
  if (!fs.existsSync(KEYS)) return null;
  const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS, 'utf8'));
  return m ? m[1] : null;
}
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'ES256', kid: slot('ascKeyId'), typ: 'JWT' });
  const body = b64({ iss: slot('ascIssuerId'), iat: now, exp: now + 900, aud: 'appstoreconnect-v1' });
  const key = fs.readFileSync(slot('ascKeyPath').replace(/^~/, process.env.HOME));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}
async function api(method, url, body) {
  const r = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: Object.assign({ Authorization: 'Bearer ' + jwt() },
      body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  const text = await r.text();
  let d = null;
  try { d = JSON.parse(text); } catch (_) { /* 非 JSON 也要留住原文 */ }
  if (!r.ok) {
    const detail = d && d.errors ? d.errors.map((e) => `${e.title}: ${e.detail}`).join('; ')
      : String(text).slice(0, 400);
    throw new Error(`HTTP ${r.status} ${method} ${url} — ${detail}`);
  }
  return d;
}

// ── 出货清单 ──────────────────────────────────────────────────────────────
// 每条线要替换哪些集合、用哪些文件。文件顺序 = 商店里的显示顺序。
const g = (n) => path.join(ROOT, 'store-assets', n);
const c = (n) => path.join(ROOT, 'screenshots-cn', n);
const five = (p) => [1, 2, 3, 4, 5].map((i) => p(`${i}`));
const four = (p) => [1, 2, 3, 4].map((i) => p(`${i}`));

const PLAN = [
  {
    id: 'global-ios', bundleId: 'com.belliedmonkeytranslator', platform: 'IOS', locale: 'en-US',
    screenshots: {
      APP_IPHONE_65: five((i) => g(`en-iphone-${i}.png`)),
      APP_IPAD_PRO_3GEN_129: five((i) => g(`en-ipad-${i}.png`)),
    },
    previews: { IPHONE_65: '/tmp/ios-preview.mp4' },
  },
  {
    id: 'global-mac', bundleId: 'com.belliedmonkeytranslator', platform: 'MAC_OS', locale: 'en-US',
    screenshots: { APP_DESKTOP: five((i) => g(`en-mac-${i}.png`)) },
    previews: { DESKTOP: '/tmp/mac-preview.mp4' },
  },
  // 国际版的 zh-Hans 本地化原本一张截图都没有 ⇒ 中文用户看到的是 en-US 那套英文图。
  // 这两条只是把已有的 zh-* 出货图配上去，不动 en-US。
  {
    id: 'global-ios-zh', bundleId: 'com.belliedmonkeytranslator', platform: 'IOS', locale: 'zh-Hans',
    screenshots: {
      APP_IPHONE_65: five((i) => g(`zh-iphone-${i}.png`)),
      APP_IPAD_PRO_3GEN_129: five((i) => g(`zh-ipad-${i}.png`)),
    },
    previews: {},
  },
  {
    id: 'global-mac-zh', bundleId: 'com.belliedmonkeytranslator', platform: 'MAC_OS', locale: 'zh-Hans',
    screenshots: { APP_DESKTOP: five((i) => g(`zh-mac-${i}.png`)) },
    previews: {},
  },
  // 其余九份本地化（2026-09-03 补）。它们有文案、有关键词，**却一张截图都没有** ——
  // 而截图是必填项，缺了会让整条线在提审时被 409 挡下，且 Apple 的报错只说
  // 「not in valid state, please check associated errors」，不指出是哪一项、哪个 locale。
  // 那次是逐份数出来的：只有 en-US 与 zh-Hans 各 5 张，另外九份是 0。
  //
  // 用英文那套：这九种语言的用户看不懂中文界面，而英文界面是产品的真实样子。
  // zh-Hant 用中文那套（同为汉字，简体界面对繁体用户可读）。
  {
    id: 'global-ios-ru', bundleId: 'com.belliedmonkeytranslator', platform: 'IOS', locale: 'ru',
    screenshots: {
      APP_IPHONE_65: five((i) => g(`en-iphone-${i}.png`)),
      APP_IPAD_PRO_3GEN_129: five((i) => g(`en-ipad-${i}.png`)),
    },
    previews: {},
  },
  {
    id: 'global-mac-ru', bundleId: 'com.belliedmonkeytranslator', platform: 'MAC_OS', locale: 'ru',
    screenshots: { APP_DESKTOP: five((i) => g(`en-mac-${i}.png`)) },
    previews: {},
  },
  {
    id: 'global-ios-dede', bundleId: 'com.belliedmonkeytranslator', platform: 'IOS', locale: 'de-DE',
    screenshots: {
      APP_IPHONE_65: five((i) => g(`en-iphone-${i}.png`)),
      APP_IPAD_PRO_3GEN_129: five((i) => g(`en-ipad-${i}.png`)),
    },
    previews: {},
  },
  {
    id: 'global-mac-dede', bundleId: 'com.belliedmonkeytranslator', platform: 'MAC_OS', locale: 'de-DE',
    screenshots: { APP_DESKTOP: five((i) => g(`en-mac-${i}.png`)) },
    previews: {},
  },
  {
    id: 'global-ios-ja', bundleId: 'com.belliedmonkeytranslator', platform: 'IOS', locale: 'ja',
    screenshots: {
      APP_IPHONE_65: five((i) => g(`en-iphone-${i}.png`)),
      APP_IPAD_PRO_3GEN_129: five((i) => g(`en-ipad-${i}.png`)),
    },
    previews: {},
  },
  {
    id: 'global-mac-ja', bundleId: 'com.belliedmonkeytranslator', platform: 'MAC_OS', locale: 'ja',
    screenshots: { APP_DESKTOP: five((i) => g(`en-mac-${i}.png`)) },
    previews: {},
  },
  {
    id: 'global-ios-frfr', bundleId: 'com.belliedmonkeytranslator', platform: 'IOS', locale: 'fr-FR',
    screenshots: {
      APP_IPHONE_65: five((i) => g(`en-iphone-${i}.png`)),
      APP_IPAD_PRO_3GEN_129: five((i) => g(`en-ipad-${i}.png`)),
    },
    previews: {},
  },
  {
    id: 'global-mac-frfr', bundleId: 'com.belliedmonkeytranslator', platform: 'MAC_OS', locale: 'fr-FR',
    screenshots: { APP_DESKTOP: five((i) => g(`en-mac-${i}.png`)) },
    previews: {},
  },
  {
    id: 'global-ios-ko', bundleId: 'com.belliedmonkeytranslator', platform: 'IOS', locale: 'ko',
    screenshots: {
      APP_IPHONE_65: five((i) => g(`en-iphone-${i}.png`)),
      APP_IPAD_PRO_3GEN_129: five((i) => g(`en-ipad-${i}.png`)),
    },
    previews: {},
  },
  {
    id: 'global-mac-ko', bundleId: 'com.belliedmonkeytranslator', platform: 'MAC_OS', locale: 'ko',
    screenshots: { APP_DESKTOP: five((i) => g(`en-mac-${i}.png`)) },
    previews: {},
  },
  {
    id: 'global-ios-ptbr', bundleId: 'com.belliedmonkeytranslator', platform: 'IOS', locale: 'pt-BR',
    screenshots: {
      APP_IPHONE_65: five((i) => g(`en-iphone-${i}.png`)),
      APP_IPAD_PRO_3GEN_129: five((i) => g(`en-ipad-${i}.png`)),
    },
    previews: {},
  },
  {
    id: 'global-mac-ptbr', bundleId: 'com.belliedmonkeytranslator', platform: 'MAC_OS', locale: 'pt-BR',
    screenshots: { APP_DESKTOP: five((i) => g(`en-mac-${i}.png`)) },
    previews: {},
  },
  {
    id: 'global-ios-eses', bundleId: 'com.belliedmonkeytranslator', platform: 'IOS', locale: 'es-ES',
    screenshots: {
      APP_IPHONE_65: five((i) => g(`en-iphone-${i}.png`)),
      APP_IPAD_PRO_3GEN_129: five((i) => g(`en-ipad-${i}.png`)),
    },
    previews: {},
  },
  {
    id: 'global-mac-eses', bundleId: 'com.belliedmonkeytranslator', platform: 'MAC_OS', locale: 'es-ES',
    screenshots: { APP_DESKTOP: five((i) => g(`en-mac-${i}.png`)) },
    previews: {},
  },
  {
    id: 'global-ios-arsa', bundleId: 'com.belliedmonkeytranslator', platform: 'IOS', locale: 'ar-SA',
    screenshots: {
      APP_IPHONE_65: five((i) => g(`en-iphone-${i}.png`)),
      APP_IPAD_PRO_3GEN_129: five((i) => g(`en-ipad-${i}.png`)),
    },
    previews: {},
  },
  {
    id: 'global-mac-arsa', bundleId: 'com.belliedmonkeytranslator', platform: 'MAC_OS', locale: 'ar-SA',
    screenshots: { APP_DESKTOP: five((i) => g(`en-mac-${i}.png`)) },
    previews: {},
  },
  {
    id: 'global-ios-zhhant', bundleId: 'com.belliedmonkeytranslator', platform: 'IOS', locale: 'zh-Hant',
    screenshots: {
      APP_IPHONE_65: five((i) => g(`zh-iphone-${i}.png`)),
      APP_IPAD_PRO_3GEN_129: five((i) => g(`zh-ipad-${i}.png`)),
    },
    previews: {},
  },
  {
    id: 'global-mac-zhhant', bundleId: 'com.belliedmonkeytranslator', platform: 'MAC_OS', locale: 'zh-Hant',
    screenshots: { APP_DESKTOP: five((i) => g(`zh-mac-${i}.png`)) },
    previews: {},
  },
  {
    id: 'cn-ios', bundleId: 'com.belliedmonkeytranslator.cn', platform: 'IOS', locale: 'zh-Hans',
    screenshots: {
      APP_IPHONE_65: four((i) => c(`cn-iphone-${i}.png`)),
      APP_IPAD_PRO_3GEN_129: four((i) => c(`cn-ipad-${i}.png`)),
    },
    previews: {},
  },
  {
    id: 'cn-mac', bundleId: 'com.belliedmonkeytranslator.cn', platform: 'MAC_OS', locale: 'zh-Hans',
    screenshots: { APP_DESKTOP: four((i) => c(`cn-mac-${i}.png`)) },
    previews: {},
  },
];

// ── 三步上传 ──────────────────────────────────────────────────────────────
async function uploadAsset(kind, setId, file, extraAttrs) {
  const isPreview = kind === 'preview';
  const type = isPreview ? 'appPreviews' : 'appScreenshots';
  const setType = isPreview ? 'appPreviewSets' : 'appScreenshotSets';
  const buf = fs.readFileSync(file);

  const created = await api('POST', `/${type}`, {
    data: {
      type,
      attributes: Object.assign({ fileName: path.basename(file), fileSize: buf.length }, extraAttrs || {}),
      relationships: { [isPreview ? 'appPreviewSet' : 'appScreenshotSet']: { data: { type: setType, id: setId } } },
    },
  });
  const asset = created.data;
  const ops = asset.attributes.uploadOperations || [];
  if (!ops.length) throw new Error(`${path.basename(file)}: Apple 没有给 uploadOperations`);

  // 可能不止一段。**必须按 offset/length 切**，整文件重复 PUT 会得到一个损坏的资产。
  for (const op of ops) {
    const chunk = buf.subarray(op.offset, op.offset + op.length);
    const headers = {};
    for (const h of op.requestHeaders || []) headers[h.name] = h.value;
    const r = await fetch(op.url, { method: op.method || 'PUT', headers, body: chunk });
    if (!r.ok) throw new Error(`${path.basename(file)}: 传字节失败 HTTP ${r.status}`);
  }

  // 校验和不是可选的：漏了它资产会永远停在 UPLOAD_COMPLETE，商店页看不到。
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  await api('PATCH', `/${type}/${asset.id}`, {
    data: { type, id: asset.id, attributes: { uploaded: true, sourceFileChecksum: md5 } },
  });
  return asset.id;
}

async function findVersionLocalization(bundleId, platform, locale) {
  const apps = await api('GET', '/apps?limit=200');
  const app = apps.data.find((a) => a.attributes.bundleId === bundleId);
  if (!app) throw new Error(`找不到 app ${bundleId}`);
  const vs = await api('GET', `/apps/${app.id}/appStoreVersions?limit=10`
    + '&fields[appStoreVersions]=versionString,appStoreState,platform');
  const v = vs.data.find((x) => x.attributes.versionString === VERSION && x.attributes.platform === platform);
  if (!v) throw new Error(`${bundleId} ${platform} 没有 ${VERSION} 版本记录`);
  // 只有 PREPARE_FOR_SUBMISSION 能动。
  //
  // 2026-08-22 实测：版本进 WAITING_FOR_REVIEW 之后，`POST /appScreenshotSets` 被
  // Apple 以 409「Can't Create Screenshot Set while In Review」拒掉。**好消息是它拒得
  // 很干净** —— 四条线的状态原封不动，排队位置没丢。所以别为了补素材去撤审：
  // 撤审重提会把排队清零（中国版上次排了 40 天），而补图属于下一个版本的事。
  // 可编辑的两种状态：还没提交，或开发者自己撤回过（撤审后 Apple 给的就是
  // DEVELOPER_REJECTED，不是被拒的意思）。
  // 在审中（WAITING_FOR_REVIEW / IN_REVIEW）不行：2026-08-22 实测
  // `POST /appScreenshotSets` 会被 409「Can't Create Screenshot Set while In Review」
  // 拒掉 —— 拒得很干净，状态不受影响，所以那条路是安全的死路，不是隐患。
  const EDITABLE = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED'];
  if (!EDITABLE.includes(v.attributes.appStoreState)) {
    throw new Error(`${bundleId} ${platform} ${VERSION} 状态是 ${v.attributes.appStoreState}`
      + ' —— 不动它（在审期间 Apple 不接受新建截图集）');
  }
  const locs = await api('GET', `/appStoreVersions/${v.id}/appStoreVersionLocalizations?limit=25`
    + '&fields[appStoreVersionLocalizations]=locale');
  const L = locs.data.find((x) => x.attributes.locale === locale);
  if (!L) throw new Error(`${bundleId} ${platform} 没有 ${locale} 本地化`);
  return { appName: app.attributes.name, versionId: v.id, locId: L.id };
}

// 版本号跟着 package.json 走，`--version` 可覆盖。
//
// 这里**曾经是一行硬编码** `const VERSION = '1.6.4'`。那种写法的坏处不是「要记得改」，
// 而是忘了改之后它**不会报错**：脚本会去找上一个版本的本地化，把新素材推到已经上架的
// 那一版上，或者报一句「没有 X 版本记录」而让人以为是 ASC 的问题。
function resolveVersion(argv) {
  const i = argv.indexOf('--version');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}
let VERSION = null;

(async () => {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;
  VERSION = resolveVersion(argv);
  console.log(`版本 ${VERSION}${argv.includes('--version') ? '（--version 指定）' : '（来自 package.json）'}`);

  console.log(apply ? '\x1b[1m模式：真的替换（对外动作）\x1b[0m' : '模式：只打印计划（加 --apply 才动）');

  for (const line of PLAN) {
    if (only && line.id !== only) continue;
    const { appName, locId } = await findVersionLocalization(line.bundleId, line.platform, line.locale);
    console.log(`\n■ ${line.id}  ${appName} [${line.platform}] ${VERSION} ${line.locale}`);

    // ── 截图 ──
    const sets = await api('GET', `/appStoreVersionLocalizations/${locId}/appScreenshotSets?limit=20`
      + '&fields[appScreenshotSets]=screenshotDisplayType');
    for (const [displayType, files] of Object.entries(line.screenshots)) {
      for (const f of files) if (!fs.existsSync(f)) throw new Error(`缺文件 ${f}`);
      let set = sets.data.find((s) => s.attributes.screenshotDisplayType === displayType);
      const existing = set
        ? (await api('GET', `/appScreenshotSets/${set.id}/appScreenshots?limit=20&fields[appScreenshots]=fileName`)).data
        : [];
      console.log(`  ${displayType}: 现有 ${existing.length} 张 → 换成 ${files.length} 张`);
      files.forEach((f) => console.log(`      ${path.basename(f)}`));
      if (!apply) continue;

      if (!set) {
        set = (await api('POST', '/appScreenshotSets', {
          data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: displayType },
            relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: locId } } } },
        })).data;
      }
      for (const old of existing) await api('DELETE', `/appScreenshots/${old.id}`);
      for (const f of files) { await uploadAsset('screenshot', set.id, f); process.stdout.write('.'); }
      console.log(' ✓');
    }

    // ── 预览片 ──
    const psets = await api('GET', `/appStoreVersionLocalizations/${locId}/appPreviewSets?limit=20`
      + '&fields[appPreviewSets]=previewType');
    for (const [previewType, file] of Object.entries(line.previews || {})) {
      if (!fs.existsSync(file)) throw new Error(`缺文件 ${file}`);
      let set = psets.data.find((s) => s.attributes.previewType === previewType);
      const existing = set
        ? (await api('GET', `/appPreviewSets/${set.id}/appPreviews?limit=20&fields[appPreviews]=fileName`)).data
        : [];
      console.log(`  ${previewType}: 现有 ${existing.length} 个 → 换成 ${path.basename(file)}`
        + ` (${(fs.statSync(file).size / 1048576).toFixed(1)} MB)`);
      if (!apply) continue;

      if (!set) {
        set = (await api('POST', '/appPreviewSets', {
          data: { type: 'appPreviewSets', attributes: { previewType },
            relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: locId } } } },
        })).data;
      }
      for (const old of existing) await api('DELETE', `/appPreviews/${old.id}`);
      await uploadAsset('preview', set.id, file, { previewFrameTimeCode: '00:00:08:00' });
      console.log('    ✓');
    }
  }

  if (!apply) console.log('\n（只是计划。确认无误后加 --apply）');
})().catch((e) => { console.error('\n✗ ' + ((e && e.message) || e)); process.exit(1); });
