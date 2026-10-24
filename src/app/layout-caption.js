// src/app/layout-caption.js — BEL-29 CaptionChrome 只读派生（SPEC-DUO-CAPTION-DESK §3.2–3.3）。
// 原生 iOS 注入 captionChrome + sceneGeometry；本模块禁止 UIScreen / idiom / orientation。

/** deskWide 阈值（pt），与 architecture/SPEC §3.3 钉死一致。 */
export const CAPTION_DESK_WIDE_MIN_PT = 520;

/** COPY-LOCK · Duo-09b 分屏引导 CTA（deskWide）整句。 */
export const COPY_DESK_WIDE_CTA = '在分屏另一半打开视频或浏览器播放；这边看字幕。也可离开 App，字幕浮在画中画。';

export function readLayoutContext(win) {
  const w = win || (typeof globalThis !== 'undefined' ? globalThis : {});
  const ctx = w.__mtLayoutContext;
  return ctx && typeof ctx === 'object' ? ctx : null;
}

/** 原生注入的 chrome；无注入时按 presentationMode 保守回落 compact。 */
export function nativeCaptionChrome(ctx) {
  if (!ctx) return 'compactPipPath';
  const raw = ctx.captionChrome;
  if (raw === 'captionDesk' || raw === 'compactPipPath') return raw;
  if (ctx.presentationMode === 'dualRegular') return 'captionDesk';
  return 'compactPipPath';
}

/**
 * 实时字幕壳：Mac / 非 subtitle 恒 compactPipPath；iOS subtitle 跟原生注入。
 * @param {{ subtitle: boolean, macLike: boolean, ctx?: object|null }} o
 */
export function captionChromeForSubtitle(o) {
  if (!o || !o.subtitle || o.macLike) return 'compactPipPath';
  return nativeCaptionChrome(o.ctx || null);
}

/** captionDesk 子态；非 desk 时返回 ''。 */
export function captionDeskBand(ctx, chrome) {
  if (chrome !== 'captionDesk') return '';
  const g = ctx && ctx.sceneGeometry;
  const w = g && typeof g.width === 'number' ? g.width : 0;
  return w >= CAPTION_DESK_WIDE_MIN_PT ? 'deskWide' : 'deskNarrow';
}
