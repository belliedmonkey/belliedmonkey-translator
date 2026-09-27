// test/shared-graph.test.js — §9.4 metafile 对账门的单测（PR7a 起）。
//
// build.js 每次出货都跑 checkSharedParity（真清单）；这里验三件它自己不验的事：
// ① 真清单下集合非空且含关键共享件 —— 门在对着两个空集空转是最危险的静默红不红；
// ② 人为分叉必须红（门禁先证伪再信：造一个 App 少挂/扩展多挂的假清单喂进去，
//    断言抛错且错误信息指名差集文件）；③ 假入口放在 .local/（gitignored），
//    跑完即删，不污染构建面。
const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const { checkSharedParity } = require('../build/run-esbuild.js');
const { ENTRIES } = require('../build/ui-entries.config.js');
const { APP_ENTRY } = require('../build/app-bundle.js');

describe('§9.4 对账门', () => {
  test('真清单：两宿主 src/shared 集合一致、非空、且含 dialog ABI 链', () => {
    const r = checkSharedParity({ appEntry: APP_ENTRY, entries: ENTRIES });
    ok(r.app.length >= 3, '共享集合只有 ' + r.app.length + ' 个 —— 门在近似空转: ' + r.app.join(', '));
    // dialog-host 不在 App 入口图里 ⇒ window.LearnDialog 裸全局 ABI 断（main.jsx 副作用 import）。
    // PR7b 后 App 入口图必须含全部四组共享件：纯逻辑四文件、两个入口壳（main.jsx
    // 副作用 import 挂回纯逻辑 ABI）、三个渲染视图（settings-view import 进图）。
    for (const must of ['src/shared/dialog.jsx', 'src/shared/dialog-host.jsx', 'src/shared/dep-line.js',
      'src/shared/engine-fields.js', 'src/shared/engine-fields-host.js', 'src/shared/quick-setup.js',
      'src/shared/quick-setup-view.jsx', 'src/shared/grant.js', 'src/shared/grant-host.jsx',
      'src/shared/grant-view.jsx', 'src/shared/sources-view.js', 'src/shared/sources-view-view.jsx']) {
      ok(r.app.includes(must), 'App 侧缺 ' + must + ': ' + r.app.join(', '));
    }
  });

  test('人为分叉（扩展多挂一个 App 没有的共享件）必须红，且报出差集', () => {
    const dir = path.join(__dirname, '..', '.local', 'parity-fake');
    const appFx = path.join(dir, 'fake-app.jsx');
    const extFx = path.join(dir, 'fake-ext.jsx');
    fs.mkdirSync(dir, { recursive: true });
    try {
      // 假 App 只挂 dep-line 一族；假扩展挂 dialog-host —— 集合必不等。
      fs.writeFileSync(appFx, "import '../../src/shared/dep-line-view.jsx';\n");
      fs.writeFileSync(extFx, "import '../../src/shared/dialog-host.jsx';\n");
      let threw = null;
      try {
        checkSharedParity({
          appEntry: '.local/parity-fake/fake-app.jsx',
          entries: [{ entry: '.local/parity-fake/fake-ext.jsx' }],
        });
      } catch (e) { threw = e; }
      ok(threw, '分叉清单竟然通过了 —— 门失效');
      ok(threw.message.includes('dialog-host.jsx'), '错误没指名差集文件: ' + threw.message);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
