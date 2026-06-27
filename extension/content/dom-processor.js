// dom-processor.js — DOM paragraph detection (大肚猴翻译 style)

var DOMProcessor = (() => {
  const SKIP_TAGS = new Set([
    'script', 'style', 'noscript', 'svg', 'path', 'meta', 'link',
    'br', 'hr', 'iframe', 'canvas', 'map', 'area', 'pre',
    'input', 'select', 'textarea', 'img', 'video', 'audio',
    'picture', 'source', 'button', 'code', 'kbd', 'samp', 'var',
    'math', 'template', 'slot'
  ]);

  const SKIP_ROLES = new Set(['button', 'menu', 'menuitem', 'menubar', 'tab', 'tablist', 'toolbar', 'navigation']);

  const SKIP_CLASS_PATTERNS = /\b(nav|menu|btn|button|toolbar|header|footer|sidebar|breadcrumb|pagination|ad|advertisement|banner|cookie|social|share|comment-form|captcha)\b/i;

  const BLOCK_TAGS = new Set([
    'p', 'div', 'article', 'section', 'blockquote', 'li', 'td', 'th',
    'dd', 'dt', 'figcaption', 'summary', 'aside', 'main',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'address', 'legend', 'caption'
  ]);

  const TRANSLATION_CLASS = 'mt-translation';
  const PROCESSED_ATTR = 'data-mt-processed';
  const TRANSLATABLE_ATTR = 'data-mt-translatable';

  function shouldSkipElement(el) {
    if (!(el instanceof Element)) return true;
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return true;
    if (el.isContentEditable) return true;
    const role = el.getAttribute('role');
    if (role && SKIP_ROLES.has(role)) return true;
    const cls = el.className;
    if (typeof cls === 'string' && SKIP_CLASS_PATTERNS.test(cls)) return true;
    // Skip invisible elements
    const style = el.style;
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return true;
    return false;
  }

  function isBlockElement(el) {
    if (!(el instanceof Element)) return false;
    return BLOCK_TAGS.has(el.tagName.toLowerCase());
  }

  function hasBlockChild(el) {
    for (const child of el.children) {
      if (isBlockElement(child) && !SKIP_TAGS.has(child.tagName.toLowerCase())) return true;
    }
    return false;
  }

  function getTextContent(el) {
    // Get direct text, skip translated nodes
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node instanceof Element && !node.classList.contains(TRANSLATION_CLASS)) {
        if (!SKIP_TAGS.has(node.tagName.toLowerCase())) {
          text += node.textContent;
        }
      }
    }
    return text.trim();
  }

  function isInsideSkipZone(el) {
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      if (shouldSkipElement(parent)) return true;
      const tag = parent.tagName.toLowerCase();
      if (['nav', 'header', 'footer', 'aside'].includes(tag)) return true;
      parent = parent.parentElement;
    }
    return false;
  }

  // ─── Collect all translatable leaf blocks ─────────────────────────────

  function collectParagraphs(root = document.body) {
    const nodes = [];
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(el) {
          const tag = el.tagName.toLowerCase();
          if (SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
          if (el.hasAttribute(PROCESSED_ATTR)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let el;
    while ((el = walker.nextNode())) {
      if (!isBlockElement(el)) continue;
      if (hasBlockChild(el)) continue;
      if (isInsideSkipZone(el)) continue;

      const text = getTextContent(el);
      if (text.length < 10) continue;
      // Skip if content is mostly non-translatable (URLs, numbers, code)
      if (/^[\d\s\W]+$/.test(text)) continue;

      el.setAttribute(TRANSLATABLE_ATTR, '1');
      nodes.push(el);
    }
    return nodes;
  }

  function markProcessed(el, translatedText) {
    el.setAttribute(PROCESSED_ATTR, '1');

    const div = document.createElement('div');
    div.className = TRANSLATION_CLASS;
    div.textContent = translatedText;
    el.appendChild(div);
  }

  function removeTranslations(root = document.body) {
    root.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach(el => el.remove());
    root.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach(el => {
      el.removeAttribute(PROCESSED_ATTR);
    });
  }

  function isAlreadyTranslated(el) {
    return el.hasAttribute(PROCESSED_ATTR);
  }

  return {
    collectParagraphs,
    markProcessed,
    removeTranslations,
    isAlreadyTranslated,
    getTextContent,
    TRANSLATION_CLASS,
    PROCESSED_ATTR,
    TRANSLATABLE_ATTR
  };
})();
