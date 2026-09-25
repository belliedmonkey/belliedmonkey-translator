# AMO 复现说明（Firefox 附源码 zip 配套）

自 React 迁移（`docs/domain-design.md` §10）起，Firefox 的 xpi 里含 esbuild 打出的
UI bundle（IIFE，**不 minify**）。按 AMO 政策，机器生成代码要附可复现的源码 zip ——
`scripts/amo-publish.js --source-zip` 会在建版本后用 `git archive` 打出这份 zip 并
回读确认。审核员（或任何人）按下面步骤逐字节复现产物：

## 环境

- Node.js ≥ 22（见 `.github/workflows/test.yml` 的 build job；`package.json` engines ≥ 20）
- npm（随 Node）
- 无其他系统依赖；不需要网络之外的任何服务

## 步骤

```bash
unzip source-<version>.zip -d src && cd src
npm ci                 # 只装构建期 devDependencies（esbuild/react/react-dom），
                       # 版本由 zip 内的 package-lock.json 逐包 sha512 钉死
node build.js firefox  # → dist-firefox/ 与 belliedmonkeytranslator-firefox.xpi
```

产物即提交的 xpi。UI bundle 的入口→产物映射的唯一登记处是
`build/ui-entries.config.js`；esbuild 参数在 `build/run-esbuild.js`
（IIFE / `target: safari16.4` / production define / 不 minify）。

## 核对

```bash
unzip -l belliedmonkeytranslator-firefox.zip   # 或直接 diff 两个解开的目录
```

bundle 不做 minify，产物可直接阅读；除 `build/ui-entries.config.js` 列出的 bundle
外，zip 里其余文件与源码树是逐字节的拷贝关系（`build.js` 只做代码生成、flavor
文本替换与校验门禁，见其文件头）。
