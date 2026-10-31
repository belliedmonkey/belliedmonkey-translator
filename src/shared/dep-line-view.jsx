// src/shared/dep-line-view.jsx — 「依赖」行的组件半边（PR7a 自 extension/learn/dep-line.js
// 的 render() 翻转；纯逻辑在 ./dep-line.js）。
//
// DOM 输出与旧 render 逐字同构：div.dep > span.dep-k + 每槽一个 span.dep-item.dep-<state>，
// 文本 = ' · ' + 名 + '：' + 标签（+ ' ✓'）；unset 且给了 onGo 的槽多一个
// button.dep-go[data-slot]（文本带前导空格 ' 去配置 →'，与旧 textContent 拼接一致）。
// settings 为 null ⇒ 输出空 div（保 id/class，与「旧 render 还没被调过的容器」等价）——
// 扩展设置页首帧 ready 之前就是这个状态。
import { items, segments } from './dep-line.js';

export default function DepLineView({ id, settings, slots, quick, live, t, onGo }) {
  if (!settings) return <div className="dep" id={id} />;
  const list = items(settings, { slots, quick, live, t });
  return (
    <div className="dep" id={id}>
      <span className="dep-k">{t('dep_label', '依赖')}</span>
      {segments(list, onGo).map((s) => (
        <span key={s.key} className={'dep-item dep-' + s.state}>
          {s.text}
          {s.go ? (
            <button type="button" className="dep-go" data-slot={s.go} onClick={() => onGo(s.go)}>
              {' ' + t('dep_go', '去配置 →')}
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}
