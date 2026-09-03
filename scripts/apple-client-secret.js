#!/usr/bin/env node
// scripts/apple-client-secret.js —— 生成 Supabase「Secret Key (for OAuth)」那一栏要的
// Apple client secret（一个 ES256 的 JWT），并把签发日期记下来。
//
//   node scripts/apple-client-secret.js              # 用 .local/keys.md 里的四个槽位
//   node scripts/apple-client-secret.js --print      # 只打印，不写回 keys.md
//
// **为什么不用网页生成器**：这件事六个月要做一次，而到期时的表现是
// 「扩展里的 Apple 登录悄悄失败，而 App 一切正常」—— 原生那条路不用 secret，
// 所以只坏一半。半年后没人会记得这里有个定时炸弹，所以把签发日期也记下来，
// 让门禁在剩不到 30 天时说话（test/build-scripts.test.js）。
//
// 签名用 Node 自带的 crypto，和 scripts/asc.js 签 App Store Connect 的 JWT 是同一套
// 原语（ES256 + ieee-p1363）—— 不引依赖，也不抄第二份签名实现。

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const KEYS = path.join(ROOT, '.local', 'keys.md');
const PRINT_ONLY = process.argv.includes('--print');

function slot(name) {
  if (!fs.existsSync(KEYS)) return null;
  const m = new RegExp('^' + name + '[^\\S\\n]*=[^\\S\\n]*(\\S+)', 'm').exec(fs.readFileSync(KEYS, 'utf8'));
  return m ? m[1] : null;
}

const NEED = {
  appleTeamId: 'Team ID（10 位，developer.apple.com/account 首页右上角）',
  appleKeyId: 'Key ID（10 位，Keys 列表里那一条）',
  appleKeyPath: '.p8 私钥文件路径（下载机会只有一次）',
  appleServicesId: 'Services ID（Supabase Client IDs 里的第一个）',
};
const missing = Object.keys(NEED).filter((k) => !slot(k));
if (missing.length) {
  console.error('✗ .local/keys.md 缺这几个槽位：');
  for (const k of missing) console.error(`    ${k} = …   # ${NEED[k]}`);
  process.exit(1);
}

const keyPath = slot('appleKeyPath').replace(/^~/, process.env.HOME);
if (!fs.existsSync(keyPath)) {
  console.error(`✗ 私钥文件不在：${keyPath}`);
  process.exit(1);
}

// Apple 允许的上限是 6 个月（15777000 秒）。**故意取满** —— 取短只会让这件事更频繁
// 地被忘掉，而忘掉的代价是一半的登录静默失效。
const SIX_MONTHS = 15777000;
const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'ES256', kid: slot('appleKeyId') });
const body = b64({
  iss: slot('appleTeamId'),
  iat: now,
  exp: now + SIX_MONTHS,
  aud: 'https://appleid.apple.com',
  sub: slot('appleServicesId'),
});
const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`),
  { key: fs.readFileSync(keyPath), dsaEncoding: 'ieee-p1363' }).toString('base64url');
const jwt = `${head}.${body}.${sig}`;

const expires = new Date((now + SIX_MONTHS) * 1000).toISOString().slice(0, 10);
console.log('\n把下面这一整行粘进 Supabase → Auth → Providers → Apple → Secret Key (for OAuth)：\n');
console.log(jwt);
console.log(`\n有效期到 ${expires}（Apple 上限 6 个月）。`);

if (!PRINT_ONLY) {
  // 只记**到期日**，不记 secret 本身 —— 它随时可以重新生成，而多存一份就多一个泄露面。
  let txt = fs.readFileSync(KEYS, 'utf8');
  const line = `appleSecretExpires = ${expires}`;
  txt = /^appleSecretExpires\s*=.*$/m.test(txt)
    ? txt.replace(/^appleSecretExpires\s*=.*$/m, line)
    : txt.replace(/\n*$/, '\n') + line + '\n';
  fs.writeFileSync(KEYS, txt);
  console.log(`已把到期日记进 .local/keys.md（${line}）—— 门禁会在剩 30 天时开始提醒。`);
}
