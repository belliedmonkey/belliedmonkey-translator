#!/usr/bin/env node
// scripts/check-app-freshness.js — 装 App 之前先问一句：这个 `.app` 里装的资源，是**现在**这份吗？
//
// 起因（2026-10-01，#536）。App 侧那轮「白屏」排查得出了两个假结论：
//   1. 「Debug 干净构建白屏 / Release 正常」；
//   2. 「首屏是引导欢迎屏、文案还是旧的」。
// 两条都来自**同一个原因**：`simctl install` 装进去的是一份**更早构建**的 `.app`。
// 当时那条验证命令长这样：
//
//     node build.js >/dev/null 2>&1 && npm run app:sync >/dev/null 2>&1 \
//       && rm -rf /tmp/dd && xcodebuild … ; xcrun simctl install … "$APP"
//
// `npm run app:sync` 这次 **exit 1**（`dist-app-china/` 比源码旧），于是 `&&` 链在
// **构建之前**就断了：既没清 DerivedData 也没构建。但后面的 `simctl install` 是分号隔开的，
// 照样跑 —— 装的还是上一轮的产物。输出被重定向掉了，所以断链无声。
//
// 判据（本脚本）：`.app` 里**每一份**由 `dist-app/` 灌进去的资源，都要与 `dist-app/` 里那份
// 逐字节相同。App 资源是三步灌进去的（`node build.js` → `npm run app:sync` → `xcodebuild`），
// 用「装了就算验过」代替这条判据，就是拿旧包下结论。
//
// 用法：
//   node scripts/check-app-freshness.js "/path/to/… .app" [global|china]
//   npm run verify:app-fresh -- "/path/to/… .app"
// 退出码：0 = 新鲜；1 = 有陈旧/缺失（会列出两边的大小与 md5 前 8 位）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const appPath = process.argv[2];
const flavor = (process.argv[3] || 'global').toLowerCase();

if (!appPath) {
  console.error('用法: node scripts/check-app-freshness.js "<… .app 的绝对路径>" [global|china]');
  process.exit(2);
}
if (!fs.existsSync(appPath)) {
  console.error(`找不到这个 .app：${appPath}`);
  process.exit(2);
}

const SRC = path.join(ROOT, flavor === 'china' ? 'dist-app-china' : 'dist-app');
if (!fs.existsSync(SRC)) {
  console.error(`没有 ${path.relative(ROOT, SRC)}/ —— 先跑 node build.js${flavor === 'china' ? ' --flavor china' : ''}`);
  process.exit(2);
}

const digest = (p) => {
  const buf = fs.readFileSync(p);
  return { size: buf.length, md5: crypto.createHash('md5').update(buf).digest('hex') };
};

// 灌进 App 的资源 = dist-app/ 的顶层文件（app:sync 的 FILES 就是这几个）。
const wanted = fs.readdirSync(SRC, { withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => e.name);

// 在 .app 里按名字找（Main.html 会被 Xcode 放进 Base.lproj/，扩展那两个在 appex 里 —— 都算）。
const found = new Map();
const walk = (dir, depth) => {
  if (depth > 8) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, depth + 1); continue; }
    if (e.isFile() && wanted.includes(e.name)) {
      if (!found.has(e.name)) found.set(e.name, []);
      found.get(e.name).push(p);
    }
  }
};
walk(appPath, 0);

const rows = [];
let bad = 0;
for (const name of wanted) {
  const src = digest(path.join(SRC, name));
  const places = found.get(name) || [];
  if (!places.length) {
    bad += 1;
    rows.push({ name, state: 'MISSING', detail: `包里找不到（dist-app: ${src.size} B ${src.md5.slice(0, 8)}）` });
    continue;
  }
  for (const p of places) {
    const got = digest(p);
    const ok = got.md5 === src.md5;
    if (!ok) bad += 1;
    rows.push({
      name,
      state: ok ? 'OK' : 'STALE',
      detail: `${path.relative(appPath, p)}  ${got.size} B ${got.md5.slice(0, 8)}  vs dist-app ${src.size} B ${src.md5.slice(0, 8)}`,
    });
  }
}

const w = Math.max(...rows.map((r) => r.name.length), 4);
console.log(`资源新鲜度（${path.basename(appPath)} ↔ ${path.relative(ROOT, SRC)}/）`);
for (const r of rows) {
  const mark = r.state === 'OK' ? '✓' : '✗';
  console.log(`  ${mark} ${r.name.padEnd(w)}  ${r.state.padEnd(7)}  ${r.detail}`);
}

if (bad) {
  console.error('');
  console.error(`✗ ${bad} 处不新鲜 —— **不要**装机、更不要用它下结论。`);
  console.error('  重来一遍（三步缺一不可，且**不要**把输出重定向掉）：');
  console.error(`    node build.js${flavor === 'china' ? ' --flavor china' : ''} && npm run app:sync && rm -rf <DerivedData> && xcodebuild …`);
  console.error('  注：`npm run app:sync` 的非零退出码是**真的**要处理（例如 dist-app-china 比源码旧），');
  console.error('      它常出现在链中间，吞掉输出就等于让 simctl 装上一份旧包（#536）。');
  process.exit(1);
}
console.log('✓ 资源新鲜：包里这份就是 dist-app/ 里这份，可以装机。');
