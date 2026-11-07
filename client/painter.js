/**
 * 绿色高亮：**不改宿主 DOM**。
 *
 * 宿主聊天区是 React 流式重渲染的，往里塞 `<span>` 会在下一帧被冲掉，
 * 还会让宿主的选择/复制行为变怪。所以走 CSS Custom Highlight API：
 *
 *   CSS.highlights.set('knest-echo', new Highlight(range))
 *   ::highlight(knest-echo){ color: var(--kn-echo); background: … }
 *
 * 高亮的颜色变量挂在 `<html data-knest-theme>` 上（见 theme.js）——
 * `::highlight()` 继承的是**被高亮文字所在元素**的变量，插件容器里的私有变量够不着。
 *
 * 宿主重渲染后原 Range 会失效（`isConnected === false`），这时用 `resolve(phrase)`
 * 在 DOM 里按文本重新找一遍。
 */

/** 高亮注册名。 */
export const HIGHLIGHT_NAME = 'knest-echo';

/** 同领域标记用的高亮名（橙色，和绿高亮互不干扰）。 */
export const DOMAIN_HIGHLIGHT = 'knest-domain';

/** 浮层根节点 id（找文本时要跳过它，否则会把卡片里的字也当成正文）。 */
export const OVERLAY_ID = 'knest-echo-layer';

/** 不算正文的标签。 */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);

/**
 * 造一个画笔。
 * @param {Document} doc - 文档。
 * @returns {{supported:boolean, paint:Function, clear:Function, resolve:Function, current:Function}} 画笔。
 */
export function createPainter(doc) {
  const view = doc?.defaultView ?? null;
  const registry = view?.CSS?.highlights ?? null;
  const HighlightCtor = view?.Highlight;
  const supported = Boolean(registry && typeof HighlightCtor === 'function');
  /** @type {Range|null} */
  let active = null;
  /** @type {HTMLElement[]} */
  let wrapped = [];

  const unwrapAll = () => {
    for (const mark of wrapped) {
      try {
        const parent = mark.parentNode;
        if (parent === null) continue;
        while (mark.firstChild !== null) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
      } catch {
        /* 忽略 */
      }
    }
    wrapped = [];
  };

  /**
   * 降级方案：只在"选区落在同一个文本节点"时包一层 `<mark>`。
   * 跨节点不处理——宁可不上色，也不要把宿主的 DOM 拆坏。
   * @param {Range} range - 选区。
   * @returns {void}
   */
  const paintFallback = (range) => {
    unwrapAll();
    try {
      const node = range.startContainer;
      if (node !== range.endContainer || node.nodeType !== 3) return;
      const parent = node.parentNode;
      if (parent === null || typeof parent.insertBefore !== 'function') return;
      const start = range.startOffset;
      const end = range.endOffset;
      if (end <= start) return;
      const text = node.data;
      const after = node.splitText(start);
      after.splitText(end - start);
      const mark = doc.createElement('mark');
      mark.className = 'knest-mark';
      parent.insertBefore(mark, after);
      mark.appendChild(after);
      wrapped.push(mark);
    } catch {
      /* 忽略 */
    }
  };

  return {
    supported,
    /**
     * 上色。
     * @param {Range|null} range - 选区。
     * @returns {void}
     */
    paint(range) {
      if (range === null || range === undefined) {
        this.clear();
        return;
      }
      active = range;
      if (!supported) {
        paintFallback(range);
        return;
      }
      try {
        registry.set(HIGHLIGHT_NAME, new HighlightCtor(range));
      } catch {
        /* Range 已失效：等下一次 resolve */
      }
    },
    /**
     * 清掉高亮。
     * @returns {void}
     */
    clear() {
      active = null;
      if (supported && registry !== null) {
        try {
          registry.delete(HIGHLIGHT_NAME);
        } catch {
          /* 忽略 */
        }
      }
      unwrapAll();
    },
    /**
     * 在 DOM 里按文本重新解析出 Range（跨元素也能连起来）。
     * @param {string} phrase - 要找的文本。
     * @returns {Range|null} 选区。
     */
    resolve(phrase) {
      const needle = typeof phrase === 'string' ? phrase.trim() : '';
      const body = doc?.body;
      if (needle === '' || body === null || body === undefined) return null;
      /** @type {{node:Text, start:number}[]} */
      const nodes = [];
      let total = 0;
      try {
        const walker = doc.createTreeWalker(body, 4, null);
        let node = walker.nextNode();
        while (node !== null) {
          const parent = node.parentNode;
          const tag = parent === null ? '' : String(parent.nodeName || '').toUpperCase();
          let skip = SKIP_TAGS.has(tag);
          if (!skip) {
            let cursor = parent;
            while (cursor !== null && cursor !== body) {
              if (cursor.id === OVERLAY_ID) {
                skip = true;
                break;
              }
              cursor = cursor.parentNode;
            }
          }
          if (!skip && typeof node.data === 'string' && node.data !== '') {
            nodes.push({ node, start: total });
            total += node.data.length;
          }
          node = walker.nextNode();
        }
      } catch {
        return null;
      }
      if (nodes.length === 0) return null;
      const full = nodes.map((item) => item.node.data).join('');
      const at = full.indexOf(needle);
      if (at < 0) return null;

      const locate = (offset) => {
        for (const item of nodes) {
          const end = item.start + item.node.data.length;
          if (offset <= end) return { container: item.node, offset: Math.max(0, offset - item.start) };
        }
        const last = nodes[nodes.length - 1];
        return { container: last.node, offset: last.node.data.length };
      };
      try {
        const range = doc.createRange();
        const start = locate(at);
        const end = locate(at + needle.length);
        range.setStart(start.container, start.offset);
        range.setEnd(end.container, end.offset);
        return range;
      } catch {
        return null;
      }
    },
    /**
     * 同领域标记：把若干词在正文里染成橙色（第二个高亮名，和绿高亮互不干扰）。
     *
     * 拿不到 CSS Highlight API 时返回 0——调用方据此回退到「只把画布节点标橙」。
     * @param {string[]} phrases - 要标记的词。
     * @returns {number} 真正标上的词数。
     */
    markDomain(phrases) {
      if (!supported || registry === null) return 0;
      const list = Array.isArray(phrases) ? phrases.filter((item) => typeof item === 'string' && item.trim() !== '') : [];
      if (list.length === 0) {
        this.clearDomain();
        return 0;
      }
      const ranges = [];
      for (const phrase of list) {
        const range = this.resolve(phrase);
        if (range !== null) ranges.push(range);
      }
      try {
        if (ranges.length === 0) {
          registry.delete(DOMAIN_HIGHLIGHT);
          return 0;
        }
        registry.set(DOMAIN_HIGHLIGHT, new HighlightCtor(...ranges));
        return ranges.length;
      } catch {
        return 0;
      }
    },
    /** 清掉同领域标记。 */
    clearDomain() {
      if (!supported || registry === null) return;
      try {
        registry.delete(DOMAIN_HIGHLIGHT);
      } catch {
        /* 忽略 */
      }
    },
    /**
     * 当前 Range（可能已失效）。
     * @returns {Range|null} 选区。
     */
    current() {
      return active;
    },
  };
}
