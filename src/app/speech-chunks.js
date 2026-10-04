// src/app/speech-chunks.js — 把「要念的文本」切成句·纯逻辑（2026-10-03，播客模式段落朗读）。
//
// 放在 src/app/ 而不是 src/shared/：**播客模式是 app-only**，而 src/shared 有对账门
// 要求两宿主都挂（build/run-esbuild.js 的 §9.4 对账门）。纯逻辑、可单测 —— 与 firstrun.js 同类。
//
// ─── 为什么有它 ────────────────────────────────────────────────────────────
// 播客模式原来把**整张卡**一次喂给合成器（`LearnTTS.speak(item.text, item.lang)`），而合成器
// 没有任何句间停顿的依据 —— 段落就被读成一条平线（用户反馈「基本没有断句」）。
// 切成句、逐句念、句间留一点呼吸，与「解析跟读」那条路（driving-model 的 notesLines 循环）同形。
//
// ─── 为什么是**一个**模块 ──────────────────────────────────────────────────
// 播放（execSpeak）与预热（warmCard）**必须枚举同一批文本** —— driving-model 里原本就写着
// 这条警告：「否则预热的是另一段话，缓存永远打不中，用户还多付一次钱」。
// 所以切分只在这里定义一次，两处都调它；将来改规则也只改这里。
//
// ─── 切句本体 ──────────────────────────────────────────────────────────────
// 复用 learn 层现成的 `LearnModel.splitSentences`（Intl.Segmenter + 引注修补；卡片 / 对齐 /
// 文档用的是同一套 —— 不另造第二套规则）。拿不到它（非宿主环境、或老壳）时回落一个标点正则，
// 与 `learn/doc-core.js` 的回落同形。
//
// ⚠️ 这一层**只动音频**：它不返回「第几句」这种屏上要用的东西，也不改任何高亮。
// 「读到哪句高亮哪句」是另一种改动（屏上行为），要另走设计稿。

/** 回落切分：句末标点（含 CJK）之后断开。与 learn/doc-core.js 同形。 */
const FALLBACK_SPLIT = /(?<=[.!?。！？…‽؟।])\s*/;

/**
 * 把一段文本切成要逐句合成的小块。
 * @param {string} text 要念的文本
 * @param {string} [lang] 语言提示（交给 Intl.Segmenter；不认识就传空）
 * @returns {string[]} 非空块；**空输入返回空数组**；切不动就原样一条（与从前的行为逐字相同）
 */
export function speechChunks(text, lang) {
  const s = String(text == null ? '' : text);
  if (!s.trim()) return [];
  try {
    const M = (typeof LearnModel !== 'undefined' && LearnModel) || null;
    if (M && typeof M.splitSentences === 'function') {
      const parts = M.splitSentences(s, lang)
        .map((x) => String(x).trim())
        .filter(Boolean);
      if (parts.length) return parts;
    }
  } catch (_) { /* 回落 */ }
  const parts = s.split(FALLBACK_SPLIT).map((x) => String(x).trim()).filter(Boolean);
  return parts.length ? parts : [s.trim()];
}

/**
 * 句间停顿（毫秒）。合成器自己会收尾，这里只留一点呼吸 —— 不引入任何屏上行为。
 * 数字是听感值，不是设备读数：切句之后句子之间需要一点间隔才像「在读段落」。
 */
export const SPEECH_GAP_MS = 220;

export default { speechChunks, SPEECH_GAP_MS };
