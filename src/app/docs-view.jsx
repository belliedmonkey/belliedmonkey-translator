// src/app/docs-view.jsx — 文档翻译页的静态骨架（PR6d，AppShell :354-361 的接替）。
//
// 这里只管「壳」：返回按钮、标题（useT 驱动，界面语言变了自动换）、DocView 命令式
// 孤岛的挂载点容器 #app-docs-root（React children 恒空，永不重渲染孤岛子树 —— 命令式
// 孤岛规则）、原生 file input（docs-model 的 pickFile 一次性 change 监听照旧摸它）。
// 进出（#app-docs 的 hidden）归 docs-model 的 enter/leave 直写 —— React 对没变的 vdom
// 不回写 DOM，与 shell/listen 的分权同一套（listen-view.jsx 头注释）。
//
// 编排、读设置、DocView.mount 全在 ./docs-model.js（原 app/docs.js 逐字）。
import PageText from '../lib/i18n.js';
import docsModel from './docs-model.js';

export default function DocsView() {
  const t = PageText.useT();
  return (
    <section id="app-docs" hidden>
      <div className="docs-head">
        <button id="app-docs-back" className="link" type="button" onClick={() => docsModel.leave()}>{t('doc_app_back', '‹ 返回')}</button>
        <h2 id="app-docs-title">{t('doc_title', '文档翻译')}</h2>
      </div>
      <div id="app-docs-root"></div>
      <input type="file" id="app-docs-file" accept=".pdf,.docx,.txt,.md,image/png,image/jpeg,image/webp" hidden />
    </section>
  );
}
