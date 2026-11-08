/* 词林 独立版（由 tools/build-standalone.mjs 生成，勿手改） */
(function () {
/* ===== client/util.js ===== */
/**
 * 浏览器侧的小工具：清洗 markdown 记号、哈希、截断。
 *
 * 全部是纯函数，不碰 DOM，node 里能直接测。
 */

/**
 * 把 markdown 记号洗成人能读的纯文本（只用于**显示与喂给模型**，不是渲染器）。
 *
 * 代码围栏保留内容、去掉围栏行；标题/引用/列表去掉记号；表格行用 ` · ` 连起来。
 * @param {unknown} text - 原始文本。
 * @returns {string} 干净文本。
 */
function cleanMarkdown(text) {
  if (typeof text !== 'string' || text === '') return '';
  try {
    return text
      .replace(/\r\n?/gu, '\n')
      .replace(/^[ \t]*```[^\n]*$/gmu, '')
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gmu, '')
      .replace(/^[ \t]{0,3}>[ \t]?/gmu, '')
      .replace(/^[ \t]{0,3}[-*+][ \t]+/gmu, '· ')
      .replace(/^[ \t]*\|?[ \t:|-]{3,}\|[ \t:|-]*$/gmu, '')
      .replace(/^[ \t]*\|(.+)\|[ \t]*$/gmu, (line, inner) => inner
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '')
        .join(' · '))
      .replace(/\*\*([^*\n]+)\*\*/gu, '$1')
      .replace(/__([^_\n]+)__/gu, '$1')
      .replace(/~~([^~\n]+)~~/gu, '$1')
      .replace(/`([^`\n]+)`/gu, '$1')
      .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/gu, '$1')
      .replace(/\[([^\]\n]+)\]\([^)\n]*\)/gu, '$1')
      .replace(/[ \t]+$/gmu, '')
      .replace(/\n{3,}/gu, '\n\n')
      .trim();
  } catch {
    return text;
  }
}

/**
 * FNV-1a 32 位哈希，base36。用来做对话指纹（稳定、够短、不需要抗碰撞）。
 * @param {unknown} input - 任意字符串。
 * @returns {string} 短哈希。
 */
function hashString(input) {
  const text = typeof input === 'string' ? input : String(input ?? '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * 压空白 + 截断（保头，带省略号）。
 * @param {unknown} text - 输入。
 * @param {number} limit - 上限。
 * @returns {string} 结果。
 */
function clampText(text, limit) {
  const flat = typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim() : '';
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  if (max === 0 || flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * 保头也保尾的截断（对话上下文用：开头定义术语，结尾才是"现在"）。
 * @param {unknown} text - 输入。
 * @param {number} limit - 上限。
 * @returns {string} 结果。
 */
function clampMiddle(text, limit) {
  const value = typeof text === 'string' ? text : '';
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  if (max === 0 || value.length <= max) return value;
  const head = Math.floor(max * 0.45);
  const tail = max - head - 10;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}


/* ===== client/theme.js ===== */
/**
 * 主题：跟着宿主走，自己兜底。
 *
 * 判定顺序（越靠前越可信）：
 *   1. 宿主写在 `<html>`/`<body>` 上的 `data-theme` / `class` 里的 dark|light；
 *   2. `--dsw-alias-bg-base` 的实际颜色（宿主自己的令牌）算亮度；
 *   3. `<body>` 的背景色算亮度；
 *   4. 系统 `prefers-color-scheme`。
 *
 * 判完把结果写在 `<html data-knest-theme="…">` 上：`::highlight()` 拿不到插件容器的
 * 私有变量，只能挂在这种"全文档可见"的位置，绿色高亮才不会在亮色底上糊掉。
 */

/** 我们写在 <html> 上的属性名（带前缀，避免和宿主自己的 data-theme 打架）。 */
const THEME_ATTR = 'data-knest-theme';

/** 宿主令牌名。 */
const HOST_TOKEN = '--dsw-alias-bg-base';

/**
 * 解析颜色串 → 亮度（0 黑 … 1 白）。认 `rgb()/rgba()/#rgb/#rrggbb`，其它返回 null。
 * @param {unknown} value - 颜色字符串。
 * @returns {number|null} 亮度；解析不了是 null。
 */
function colorLuminance(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (text === '') return null;
  let r = null;
  let g = null;
  let b = null;
  const rgb = text.match(/^rgba?\(([^)]+)\)$/u);
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/u).filter((part) => part !== '');
    if (parts.length >= 3) {
      r = Number.parseFloat(parts[0]);
      g = Number.parseFloat(parts[1]);
      b = Number.parseFloat(parts[2]);
    }
  } else {
    const hex = text.match(/^#([0-9a-f]{3,8})$/u);
    if (hex) {
      let body = hex[1];
      if (body.length === 3 || body.length === 4) {
        body = body.split('').map((ch) => `${ch}${ch}`).join('');
      }
      if (body.length >= 6) {
        r = Number.parseInt(body.slice(0, 2), 16);
        g = Number.parseInt(body.slice(2, 4), 16);
        b = Number.parseInt(body.slice(4, 6), 16);
      }
    }
  }
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  const channel = (n) => {
    const c = Math.min(255, Math.max(0, n)) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * 从元素属性里读"宿主自己声明的主题"。
 * @param {Element|null} element - html 或 body。
 * @returns {'light'|'dark'|null} 主题；没声明是 null。
 */
function declaredTheme(element) {
  if (element === null || element === undefined || typeof element.getAttribute !== 'function') return null;
  const attr = element.getAttribute('data-theme') ?? element.getAttribute('theme') ?? '';
  if (/dark/iu.test(attr)) return 'dark';
  if (/light/iu.test(attr)) return 'light';
  const className = typeof element.className === 'string' ? element.className : '';
  if (/(^|\s)(dark|theme-dark)(\s|$)/iu.test(className)) return 'dark';
  if (/(^|\s)(light|theme-light)(\s|$)/iu.test(className)) return 'light';
  return null;
}

/**
 * 判主题。
 * @param {Document} [doc] - 文档（测试可注入假 doc）。
 * @returns {'light'|'dark'} 主题。
 */
function detectTheme(doc) {
  const document = doc ?? (typeof globalThis.document === 'undefined' ? null : globalThis.document);
  if (document === null) return 'dark';
  try {
    const html = document.documentElement;
    const body = document.body;
    const declared = declaredTheme(html) ?? declaredTheme(body);
    if (declared !== null) return declared;

    const view = document.defaultView;
    if (view !== null && view !== undefined && typeof view.getComputedStyle === 'function') {
      const hostToken = view.getComputedStyle(html).getPropertyValue(HOST_TOKEN);
      const fromToken = colorLuminance(hostToken);
      if (fromToken !== null) return fromToken > 0.5 ? 'light' : 'dark';
      if (body !== null && body !== undefined) {
        const fromBody = colorLuminance(view.getComputedStyle(body).backgroundColor);
        if (fromBody !== null) return fromBody > 0.5 ? 'light' : 'dark';
      }
    }
  } catch {
    /* 计算样式拿不到就走系统偏好 */
  }
  try {
    const media = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia('(prefers-color-scheme: light)') : null;
    if (media !== null && typeof media.matches === 'boolean') return media.matches ? 'light' : 'dark';
  } catch {
    /* 忽略 */
  }
  return 'dark';
}

/**
 * 把主题写到 `<html>`（高亮样式靠它着色）。
 * @param {Document} doc - 文档。
 * @param {'light'|'dark'} theme - 主题。
 * @returns {void}
 */
function stampTheme(doc, theme) {
  try {
    const html = doc?.documentElement;
    if (html === null || html === undefined || typeof html.setAttribute !== 'function') return;
    if (html.getAttribute(THEME_ATTR) !== theme) html.setAttribute(THEME_ATTR, theme);
  } catch {
    /* 忽略 */
  }
}

/**
 * 盯着主题变化：宿主换主题、系统换偏好都会回调。
 * @param {Document} doc - 文档。
 * @param {(theme:'light'|'dark')=>void} onChange - 回调。
 * @returns {Function} 卸载函数。
 */
function watchTheme(doc, onChange) {
  const document = doc ?? (typeof globalThis.document === 'undefined' ? null : globalThis.document);
  if (document === null || typeof onChange !== 'function') return () => {};
  let last = '';
  const check = () => {
    const theme = detectTheme(document);
    if (theme === last) return;
    last = theme;
    stampTheme(document, theme);
    try {
      onChange(theme);
    } catch {
      /* 回调异常不影响观察 */
    }
  };
  check();

  let observer = null;
  try {
    if (typeof document.defaultView?.MutationObserver === 'function') {
      observer = new document.defaultView.MutationObserver(check);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme', 'theme', 'style', THEME_ATTR],
      });
    }
  } catch {
    observer = null;
  }

  let media = null;
  const onMedia = () => check();
  try {
    if (typeof document.defaultView?.matchMedia === 'function') {
      media = document.defaultView.matchMedia('(prefers-color-scheme: dark)');
      if (typeof media.addEventListener === 'function') media.addEventListener('change', onMedia);
    }
  } catch {
    media = null;
  }

  return () => {
    try {
      if (observer !== null) observer.disconnect();
    } catch {
      /* 忽略 */
    }
    try {
      if (media !== null && typeof media.removeEventListener === 'function') media.removeEventListener('change', onMedia);
    } catch {
      /* 忽略 */
    }
  };
}


/* ===== client/phrase.js ===== */
/**
 * 圈词：把"右键拖过的两点"变成一句能拿去问模型的文本。
 *
 * 纯函数（归一化 / 整句 / 反向取文）与 DOM 胶水分开，前者 node 里直接测。
 */

/** 圈出来的文本上限：再长就不是"一个词/一句话"了。 */
const MAX_PHRASE_CHARS = 120;

/** 句子截断长度。 */
const SENTENCE_MAX = 200;

/** 句读符（中文按句读切，拉丁按空白与标点切）。 */
const SENTENCE_STOPS = ['。', '！', '？', '；', '!', '?', ';', '\n'];

/** 首尾要去掉的标点（含各类引号/括号）。 */
const EDGE_PUNCT = /^[，。、；：！？,.;:!?"'“”‘’「」『』()（）[\]【】《》〈〉]+/u;
const EDGE_PUNCT_END = /[，。、；：！？,.;:!?"'“”‘’「」『』()（）[\]【】《》〈〉]+$/u;

/**
 * 归一化圈选文本：压空白、去首尾标点、截断。
 * @param {unknown} text - 原始文本。
 * @returns {string} 归一化结果；空则空串。
 */
function normalizePhrase(text) {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/\s+/gu, ' ').trim()
    .replace(EDGE_PUNCT, '')
    .replace(EDGE_PUNCT_END, '')
    .trim();
  if (flat === '') return '';
  return flat.length > MAX_PHRASE_CHARS ? flat.slice(0, MAX_PHRASE_CHARS) : flat;
}

/**
 * 从某个下标向外扩到整句（没拖动时的兜底）。
 * @param {unknown} text - 文本。
 * @param {number} offset - 下标。
 * @returns {string} 整句（已归一化、截断）。
 */
function expandSentenceAt(text, offset) {
  if (typeof text !== 'string' || text === '') return '';
  const at = Math.min(Math.max(Number.isSafeInteger(offset) ? offset : 0, 0), Math.max(0, text.length - 1));
  let start = 0;
  let end = text.length;
  for (const stop of SENTENCE_STOPS) {
    const left = text.lastIndexOf(stop, at - 1);
    if (left + 1 > start) start = left + 1;
    const right = text.indexOf(stop, at);
    if (right >= 0 && right < end) end = right;
  }
  const sentence = text.slice(start, end).trim();
  if (sentence === '') return '';
  const clipped = sentence.length > SENTENCE_MAX ? `${sentence.slice(0, SENTENCE_MAX)}…` : sentence;
  return normalizePhrase(clipped);
}

/**
 * 在一段文本里找某个短语**所在的那一句**。
 * @param {unknown} text - 整段文本。
 * @param {unknown} phrase - 短语。
 * @returns {string} 句子；找不到就是空串。
 */
function sentenceContaining(text, phrase) {
  const haystack = typeof text === 'string' ? text : '';
  const needle = typeof phrase === 'string' ? phrase.trim() : '';
  if (haystack === '' || needle === '') return '';
  const at = haystack.indexOf(needle);
  if (at < 0) return '';
  return expandSentenceAt(haystack, at);
}

/**
 * 指针坐标 → 文档里的字符位置（Chromium 走 caretRangeFromPoint）。
 * @param {Document} doc - 文档。
 * @param {number} x - clientX。
 * @param {number} y - clientY。
 * @returns {{container:Node, offset:number}|null} 字符位置。
 */
function pointAt(doc, x, y) {
  if (doc === null || doc === undefined) return null;
  try {
    if (typeof doc.caretRangeFromPoint === 'function') {
      const range = doc.caretRangeFromPoint(x, y);
      if (range === null || range === undefined) return null;
      return { container: range.startContainer, offset: range.startOffset };
    }
    if (typeof doc.caretPositionFromPoint === 'function') {
      const position = doc.caretPositionFromPoint(x, y);
      if (position === null || position === undefined) return null;
      return { container: position.offsetNode, offset: position.offset };
    }
  } catch {
    /* 忽略 */
  }
  return null;
}

/**
 * 两点之间取一个 Range（起止反了也能处理）。
 * @param {Document} doc - 文档。
 * @param {{container:Node, offset:number}|null} start - 起点。
 * @param {{container:Node, offset:number}|null} end - 终点；为空时取起点。
 * @returns {{range:Range|null, text:string}} Range 与文本。
 */
function rangeBetween(doc, start, end) {
  if (doc === null || doc === undefined || typeof doc.createRange !== 'function') return { range: null, text: '' };
  if (start === null || start === undefined || start.container === null || start.container === undefined) {
    return { range: null, text: '' };
  }
  const stop = end === null || end === undefined || end.container === null || end.container === undefined ? start : end;
  try {
    const range = doc.createRange();
    range.setStart(start.container, start.offset);
    range.setEnd(stop.container, stop.offset);
    const text = range.toString();
    if (text.trim() !== '') return { range, text: normalizePhrase(text) };
    const reversed = doc.createRange();
    reversed.setStart(stop.container, stop.offset);
    reversed.setEnd(start.container, start.offset);
    return { range: reversed, text: normalizePhrase(reversed.toString()) };
  } catch {
    return { range: null, text: '' };
  }
}

/**
 * 把短语做成去重键（压空白 + 小写：同一个词带不带空格都算一个）。
 * @param {unknown} phrase - 短语。
 * @returns {string} 键。
 */
function phraseKey(phrase) {
  return typeof phrase === 'string' ? phrase.replace(/\s+/gu, ' ').trim().toLowerCase() : '';
}

/**
 * 取选区所在区块的周边原文（给"文档里的词"当上下文）。
 *
 * 为什么需要：右侧打开的那份 MD/PPT，多半不在对话消息里；
 * 只喂对话，模型会说"没有上下文"。这里把选区所在段落/列表项的正文取出来，
 * 以选中的词为中心切前后各 window 个字。
 *
 * @param {Range|null} range - 选区。
 * @param {string} phrase - 选中的词。
 * @param {number} [window] - 前后各取多少字。
 * @returns {string} 周边原文；拿不到返回空串。
 */
function contextAroundRange(range, phrase, window = 400) {
  const needle = typeof phrase === 'string' ? phrase.trim() : '';
  if (range === null || range === undefined || needle === '') return '';
  try {
    let node = range.startContainer ?? null;
    if (node !== null && node.nodeType === 3) node = node.parentNode;
    /* 往上找最近的块级容器：段落、列表项、表格单元格、代码块都算 */
    let block = node;
    for (let depth = 0; depth < 6 && block !== null; depth += 1) {
      const tag = String(block.tagName ?? '').toUpperCase();
      if (['P', 'LI', 'TD', 'TH', 'PRE', 'CODE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'DIV', 'SECTION'].includes(tag)) break;
      block = block.parentNode;
    }
    const raw = String(block?.textContent ?? '').replace(/\s+/gu, ' ').trim();
    if (raw === '') return '';
    const at = raw.indexOf(needle);
    if (at < 0) return raw.slice(0, window * 2);
    const from = Math.max(0, at - window);
    const to = Math.min(raw.length, at + needle.length + window);
    return `${from > 0 ? '…' : ''}${raw.slice(from, to)}${to < raw.length ? '…' : ''}`;
  } catch {
    return '';
  }
}


/* ===== client/card.js ===== */
/**
 * 卡片视图模型：把 host 回来的结构翻成"人一眼能读完"的几段。
 *
 * 顺序就是产品主张：**语境释义 → 依据 → 其它读法 → 相关（三级）→ 通常含义**。
 * 百科式的"先定义再举例"在这里是反的：用户问的是"在这段对话里"。
 */

/** 置信度 → 人话标签 + 语气。 */
const CONFIDENCE = Object.freeze({
  high: { label: '读法明确', tone: 'high' },
  medium: { label: '略有歧义', tone: 'medium' },
  low: { label: '不太确定', tone: 'low' },
});

/** 错误码 → 人话。 */
const ERROR_TEXT = Object.freeze({
  'no-key': '没找到 DeepSeek key。插件设置里能看到它在找哪三处。',
  'disabled': '解释被关掉了（配置文件里 enabled: false）。',
  'unauthorized': 'key 被接口拒了，检查一下这把钥匙。',
  'rate-limited': '接口在限流，过一会儿再圈一次。',
  'timeout': '模型这次没回话（超时）。',
  'network': '连不上本机插件路由——多半是改完插件还没重启 dsh。',
  'bad-json': '接口回来的不是 JSON。',
  'model-unavailable': '配置里的模型名接口不认。',
  'empty': '模型这次什么都没给。',
  'bad-request': '圈出来的文本有问题（空的或太长）。',
  'too-large': '请求太大了。',
});

/**
 * 收敛一条解释。
 * @param {{phrase:string, data:object, count?:number, model?:string, cached?:boolean, ms?:number}} input - host 结果。
 * @returns {object} 卡片模型。
 */
function buildCard(input) {
  const data = input?.data !== null && typeof input?.data === 'object' ? input.data : {};
  const confidence = CONFIDENCE[data.confidence] ?? CONFIDENCE.medium;
  const evidence = Array.isArray(data.evidence) ? data.evidence : [];
  const readings = Array.isArray(data.readings) ? data.readings : [];
  const links = Array.isArray(data.links) ? data.links : [];
  return {
    phrase: clampText(input?.phrase, 120),
    kind: clampText(data.kind, 8) || '',
    /* 领域：空串表示模型看不出来；前端据此决定「标出同类」能不能点 */
    domain: clampText(data.domain, 10),
    lead: clampText(data.here, 260),
    literal: clampText(data.literal, 180),
    confidence,
    evidence: evidence
      .filter((item) => item !== null && typeof item === 'object' && typeof item.quote === 'string')
      .slice(0, 4)
      .map((item) => ({ quote: clampText(item.quote, 140), why: clampText(item.why, 120) })),
    readings: readings
      .filter((item) => item !== null && typeof item === 'object')
      .slice(0, 3)
      .map((item) => ({ label: clampText(item.label, 30), note: clampText(item.note, 130) })),
    tree: links
      .filter((item) => item !== null && typeof item === 'object' && typeof item.label === 'string')
      .slice(0, 5)
      .map((item) => ({
        label: clampText(item.label, 30),
        note: clampText(item.note, 110),
        children: (Array.isArray(item.children) ? item.children : [])
          .filter((child) => child !== null && typeof child === 'object' && typeof child.label === 'string')
          .slice(0, 3)
          .map((child) => ({ label: clampText(child.label, 30), note: clampText(child.note, 110) })),
      })),
    meta: {
      count: Number.isFinite(input?.count) ? input.count : 0,
      model: typeof input?.model === 'string' ? input.model : '',
      cached: input?.cached === true,
      ms: Number.isFinite(input?.ms) ? input.ms : 0,
      /* 用量：让"这次花了多少"直接印在卡片上，而不是只躺在设置页 */
      usage: input?.usage !== null && typeof input?.usage === 'object'
        ? {
          prompt: Number.isFinite(input.usage.prompt) ? input.usage.prompt : 0,
          completion: Number.isFinite(input.usage.completion) ? input.usage.completion : 0,
          total: Number.isFinite(input.usage.total) ? input.usage.total : 0,
        }
        : { prompt: 0, completion: 0, total: 0 },
    },
  };
}

/**
 * 正在算的占位卡。
 * @param {string} phrase - 圈出的文本。
 * @returns {object} 卡片模型。
 */
function buildPendingCard(phrase) {
  return {
    pending: true,
    phrase: clampText(phrase, 120),
    kind: '',
    lead: '',
    literal: '',
    confidence: CONFIDENCE.medium,
    evidence: [],
    readings: [],
    tree: [],
    meta: { count: 0, model: '', cached: false, ms: 0 },
  };
}

/**
 * 失败卡：说清"为什么没解释"，并给出下一步。
 * @param {string} phrase - 圈出的文本。
 * @param {object} error - `{code,message,retryable}`。
 * @returns {object} 卡片模型。
 */
function buildErrorCard(phrase, error) {
  const code = typeof error?.code === 'string' ? error.code : 'unknown';
  const known = ERROR_TEXT[code];
  return {
    error: true,
    code,
    retryable: error?.retryable === true,
    phrase: clampText(phrase, 120),
    kind: '',
    lead: known ?? clampText(error?.message, 200) ?? '这次没拿到解释。',
    literal: '',
    confidence: CONFIDENCE.low,
    evidence: [],
    readings: [],
    tree: [],
    meta: { count: 0, model: '', cached: false, ms: 0 },
  };
}

/**
 * 把上一张卡片压成一段"上级概念"上下文。
 *
 * 从卡片里点开的词（比如「CSS 属性」）常常原文里没出现过，
 * 只喂对话窗口模型就会答「没有上下文」；把父卡片一起给它，才有得解释。
 *
 * @param {{text?:string, model?:object}} node - 画布节点。
 * @returns {string} 上下文片段（没有可用信息时为空串）。
 */
function parentContextOf(node) {
  const text = typeof node?.text === 'string' ? node.text.trim() : '';
  const model = node?.model ?? {};
  const lead = typeof model.lead === 'string' ? model.lead.trim() : '';
  const literal = typeof model.literal === 'string' ? model.literal.trim() : '';
  const quotes = Array.isArray(model.evidence)
    ? model.evidence
      .map((item) => (typeof item?.quote === 'string' ? item.quote.trim() : ''))
      .filter((quote) => quote !== '')
      .slice(0, 2)
    : [];
  if (text === '' && lead === '') return '';
  const lines = [];
  if (text !== '') lines.push(`【上级概念】${text}`);
  if (lead !== '') lines.push(lead);
  if (literal !== '') lines.push(`通常含义：${literal}`);
  if (quotes.length > 0) lines.push(`它在这段对话里的依据：${quotes.map((q) => `「${q}」`).join('、')}`);
  return lines.join('\n');
}


/* ===== client/api.js ===== */
/**
 * 浏览器侧的模型客户端：**只打本插件自己的 host 路由**，从不直连模型。
 *
 * 两层缓存：
 *   1. 内存（同一个会话里同一个词再圈一次 → 0 请求）；
 *   2. 磁盘（host 侧按 `词 + 对话指纹` 存的 30 天缓存）。
 *
 * 错误一律收敛成 `{ok:false, error:{code,message,retryable}}`，不 throw——
 * 浮层要能稳定地显示"为什么没解释"。
 */

/** 默认路由（与 index.js 的 EXPLAIN_PATH 必须一致）。 */
const EXPLAIN_ENDPOINT = '/knowledge-nest/explain';

/** 文件读取路由（与 index.js 的 READ_PATH 必须一致）。 */
const READ_ENDPOINT = '/knowledge-nest/read';

/** 批注落盘路由。 */
const ANNOTATE_ENDPOINT = '/knowledge-nest/annotations';

/** 卡片仓库路由。 */
const CARDS_ENDPOINT = '/knowledge-nest/cards';

/** 内存缓存条数上限。 */
const MEMORY_LIMIT = 120;

/**
 * 造客户端。
 * @param {{fetchImpl?:Function, endpoint?:string, timeoutMs?:number}} [options] - 注入点。
 * @returns {{explain:Function, status:Function, clearCache:Function, peek:Function, forget:Function}} 客户端。
 */
function createExplainApi(options = {}) {
  const endpoint = typeof options.endpoint === 'string' && options.endpoint !== '' ? options.endpoint : EXPLAIN_ENDPOINT;
  const readEndpoint = typeof options.readEndpoint === 'string' && options.readEndpoint !== '' ? options.readEndpoint : READ_ENDPOINT;
  const annotateEndpoint = ANNOTATE_ENDPOINT;
  const cardsEndpoint = CARDS_ENDPOINT;
  const fetchImpl = typeof options.fetchImpl === 'function'
    ? options.fetchImpl
    : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 70_000;

  /** @type {Map<string, object>} */
  const memory = new Map();

  const remember = (key, value) => {
    if (memory.has(key)) memory.delete(key);
    memory.set(key, value);
    while (memory.size > MEMORY_LIMIT) {
      const oldest = memory.keys().next();
      if (oldest.done) break;
      memory.delete(oldest.value);
    }
  };

  /**
   * 发请求。
   * @param {string} method - HTTP 方法。
   * @param {object} [body] - 请求体。
   * @param {string} [url] - 目标地址（默认解释路由）。
   * @returns {Promise<object>} 解析后的 JSON（失败也给对象）。
   */
  const send = async (method, body, url = endpoint) => {
    if (fetchImpl === null) {
      return { ok: false, error: { code: 'no-fetch', message: '这个环境没有 fetch', retryable: false } };
    }
    const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
    const timer = controller === null ? null : setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller === null ? undefined : controller.signal,
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (payload === null || typeof payload !== 'object') {
        return { ok: false, error: { code: 'bad-response', message: `路由返回了非 JSON（${response.status}）`, retryable: true } };
      }
      return payload;
    } catch (error) {
      const message = error !== null && error !== undefined && typeof error.message === 'string'
        ? error.message
        : String(error);
      const aborted = /abort/iu.test(message);
      return {
        ok: false,
        error: {
          code: aborted ? 'timeout' : 'network',
          message: aborted ? '等太久了，模型还没回' : `连不上插件路由：${message}`,
          retryable: true,
        },
      };
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  };

  return {
    /**
     * 解释一个词/句。
     * @param {{phrase:string, sentence?:string, context?:string, fingerprint?:string, sessionId?:string, force?:boolean}} input - 请求。
     * @returns {Promise<object>} `{ok, data, cached, model, ms}` 或 `{ok:false, error}`。
     */
    async explain(input) {
      const phrase = typeof input?.phrase === 'string' ? input.phrase.trim() : '';
      if (phrase === '') return { ok: false, error: { code: 'bad-request', message: '没有圈出文本', retryable: false } };
      const mode = typeof input?.mode === 'string' && input.mode !== '' ? input.mode : 'default';
      const key = `${input?.sessionId ?? ''}|${phrase}|${input?.fingerprint ?? ''}|${mode}`;
      if (input?.force !== true) {
        const hit = memory.get(key);
        if (hit !== undefined) return { ...hit, cached: true };
      }
      const payload = await send('POST', {
        phrase,
        sentence: typeof input?.sentence === 'string' ? input.sentence : '',
        context: typeof input?.context === 'string' ? input.context : '',
        fingerprint: typeof input?.fingerprint === 'string' ? input.fingerprint : '',
        model: typeof input?.model === 'string' ? input.model : '',
        mode,
      });
      if (payload.ok === true && payload.data !== null && typeof payload.data === 'object') {
        const result = { ok: true, data: payload.data, cached: payload.cached === true, model: payload.model, ms: payload.ms };
        remember(key, result);
        return result;
      }
      return {
        ok: false,
        error: payload?.error !== null && typeof payload?.error === 'object'
          ? payload.error
          : { code: 'unknown', message: '插件路由没有给出原因', retryable: true },
      };
    },
    /**
     * 读工作区里的一个文本文件（host 侧已做越权/后缀/大小校验）。
     *
     * 失败时同样返回 `{ok:false, error}`，不 throw——调用方只要看 ok。
     * @param {string} path - 工作区内的路径。
     * @returns {Promise<object>} `{ok:true, text, path, bytes}` 或 `{ok:false, error}`。
     */
    async readFile(path) {
      const target = typeof path === 'string' ? path.trim() : '';
      if (target === '') {
        return { ok: false, error: { code: 'bad-request', message: '没有填路径', retryable: false } };
      }
      const payload = await send('GET', undefined, `${readEndpoint}?path=${encodeURIComponent(target)}`);
      if (payload?.ok === true && typeof payload.text === 'string') {
        return { ok: true, text: payload.text, path: payload.path ?? target, bytes: payload.bytes ?? 0 };
      }
      return {
        ok: false,
        error: payload?.error !== null && typeof payload?.error === 'object'
          ? payload.error
          : { code: 'unknown', message: '插件路由没有给出原因', retryable: true },
      };
    },
    /**
     * 把批注摘要写到工作区（host 侧改写 AGENTS.local.md 的标记块）。
     * @param {{entries:object[], window:string}} input - 批注与区间。
     * @returns {Promise<object>} `{ok, file, written}` 或 `{ok:false, error}`。
     */
    async annotate(input) {
      const entries = Array.isArray(input?.entries) ? input.entries : [];
      return send('POST', { entries, window: input?.window === 'user' ? 'user' : 'assistant' }, annotateEndpoint);
    },
    /**
     * 存一张卡（host 侧按词合并进 cards.jsonl）。
     * @param {object} card - 卡片。
     * @returns {Promise<object>} 结果。
     */
    async saveCard(card) {
      return send('POST', { card }, cardsEndpoint);
    },
    /**
     * 搜索卡片。
     * @param {{q?:string, domain?:string, limit?:number}} input - 条件。
     * @returns {Promise<object>} `{ok, rows, stats}`。
     */
    async searchCards(input) {
      const q = encodeURIComponent(typeof input?.q === 'string' ? input.q : '');
      const domain = encodeURIComponent(typeof input?.domain === 'string' ? input.domain : '');
      const limit = Number.isFinite(input?.limit) ? input.limit : 200;
      return send('GET', undefined, `${cardsEndpoint}?q=${q}&domain=${domain}&limit=${limit}`);
    },
    /**
     * 读状态。
     * @returns {Promise<object>} `{ok, status}`。
     */
    async status() {
      return send('GET');
    },
    /**
     * 清 host 缓存。
     * @returns {Promise<object>} `{ok, cleared}`。
     */
    async clearCache() {
      memory.clear();
      return send('DELETE');
    },
    /**
     * 内存里有没有（不请求）。
     * @param {{phrase:string, fingerprint?:string, sessionId?:string}} input - 键。
     * @returns {object|null} 结果。
     */
    peek(input) {
      const mode = typeof input?.mode === 'string' && input.mode !== '' ? input.mode : 'default';
      const key = `${input?.sessionId ?? ''}|${input?.phrase ?? ''}|${input?.fingerprint ?? ''}|${mode}`;
      return memory.get(key) ?? null;
    },
    /**
     * 丢掉某个词的内存结果（用户点"重新解释"）。
     * @param {{phrase:string, fingerprint?:string, sessionId?:string}} input - 键。
     * @returns {void}
     */
    forget(input) {
      const mode = typeof input?.mode === 'string' && input.mode !== '' ? input.mode : 'default';
      const key = `${input?.sessionId ?? ''}|${input?.phrase ?? ''}|${input?.fingerprint ?? ''}|${mode}`;
      memory.delete(key);
    },
  };
}


/* ===== client/painter.js ===== */
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
const HIGHLIGHT_NAME = 'knest-echo';

/** 同领域标记用的高亮名（橙色，和绿高亮互不干扰）。 */
const DOMAIN_HIGHLIGHT = 'knest-domain';

/** 浮层根节点 id（找文本时要跳过它，否则会把卡片里的字也当成正文）。 */
const OVERLAY_ID = 'knest-echo-layer';

/** 不算正文的标签。 */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);

/**
 * 造一个画笔。
 * @param {Document} doc - 文档。
 * @returns {{supported:boolean, paint:Function, clear:Function, resolve:Function, current:Function}} 画笔。
 */
function createPainter(doc) {
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


/* ===== client/selector.js ===== */
/**
 * 右键按住圈词（**全文档**，不只在插件视图里）。
 *
 * 为什么不用浏览器原生选区：
 *   1) 左键选字会跟宿主聊天区自己的选择/复制打架；
 *   2) 我们要的手势是「按住右键拖过一段 → 松手就问」，原生选区没有这个动作。
 *
 * 手势契约：
 *   右键按下（落在正文上）→ 吞掉默认行为 → 拖动时实时回调 Range →
 *   松手（拖动过 = 两点取文；没拖动 = 指针所在整句）→ 回调 onPick；
 *   紧接着那一下 `contextmenu` 也吞掉，别弹系统菜单。
 *
 * 不碰输入框：在 input/textarea/select/contenteditable 上按下直接放行（用户可能想粘贴）。
 */

/** 判定"拖过"的像素阈值。 */
const DRAG_THRESHOLD = 3;

/** 松手后多久内继续吞 contextmenu。 */
const SWALLOW_MS = 500;

/**
 * 挂载圈选手势。
 * @param {Document} doc - 文档。
 * @param {object} [handlers] - 回调。
 * @param {(range:Range|null)=>void} [handlers.onLive] - 拖动中的实时选区。
 * @param {(payload:{phrase:string, sentence:string, range:Range|null, rect:object})=>void} [handlers.onPick] - 松手。
 * @param {()=>void} [handlers.onCancel] - 取消（Esc / 失焦）。
 * @returns {{dispose:Function, cancel:Function, active:Function}} 句柄。
 */
function attachSelector(doc, handlers = {}) {
  if (doc === null || doc === undefined || typeof doc.addEventListener !== 'function') {
    return { dispose() {}, cancel() {}, active: () => false };
  }
  const view = doc.defaultView ?? null;
  const isEnabled = typeof handlers.isEnabled === 'function' ? handlers.isEnabled : () => true;
  let armed = false;
  let startButton = 2;
  let moved = false;
  let startPoint = null;
  let startX = 0;
  let startY = 0;
  let swallowUntil = 0;
  let warned = false;

  /**
   * 回调抛错只报一次：既不刷屏，也不至于让 bug 彻底静音。
   * @param {unknown} error - 异常。
   * @returns {void}
   */
  const warnOnce = (error) => {
    if (warned) return;
    warned = true;
    try {
      console.warn('[knest] 圈词回调抛错：', error);
    } catch {
      /* 忽略 */
    }
  };

  const isEditable = (target) => {
    if (target === null || target === undefined || typeof target.closest !== 'function') return false;
    const tag = String(target.nodeName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') return true;
    try {
      if (target.isContentEditable === true) return true;
      return target.closest('[contenteditable="true"]') !== null;
    } catch {
      return false;
    }
  };

  const reset = () => {
    armed = false;
    moved = false;
    startPoint = null;
  };

  const cancel = () => {
    if (!armed) return;
    reset();
    try {
      handlers.onCancel?.();
    } catch {
      /* 回调异常不能把页面带崩 */
    }
  };

  function onDown(event) {
    /* 右键 = 圈词；左键只在批注模式里接管（批注用左键拖选）。 */
    const left = event.button === 0 && options.leftEnabled?.() === true;
    if (event.button !== 2 && !left) return;
    /* 圈词关着的时候完全不接管右键：让 contextmenu 走到菜单那边去。 */
    if (event.button === 2 && isEnabled() !== true) return;
    if (isEditable(event.target)) return;
    const point = pointAt(doc, event.clientX, event.clientY);
    if (point === null || point.container === null || point.container === undefined) return;
    armed = true;
    moved = false;
    startButton = event.button;
    startPoint = point;
    startX = event.clientX;
    startY = event.clientY;
    event.preventDefault();
    event.stopPropagation();
  }

  function onMove(event) {
    if (!armed) return;
    if (!moved && Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY) > DRAG_THRESHOLD) moved = true;
    if (!moved) return;
    event.preventDefault();
    const end = pointAt(doc, event.clientX, event.clientY);
    const { range } = rangeBetween(doc, startPoint, end);
    try {
      /* 带上指针坐标：调用方要用它把「已选 N 字」贴到光标旁边 */
      handlers.onLive?.(range, { x: event.clientX, y: event.clientY });
    } catch {
      /* 忽略 */
    }
  }

  function onUp(event) {
    if (!armed) return;
    const dropPoint = pointAt(doc, event.clientX, event.clientY);
    const wasMoved = moved;
    const origin = startPoint;
    reset();
    swallowUntil = Date.now() + SWALLOW_MS;
    event.preventDefault();
    event.stopPropagation();
    if (wasMoved) {
      const { range, text } = rangeBetween(doc, origin, dropPoint);
      const phrase = normalizePhrase(text);
      if (phrase === '') {
        handlers.onCancel?.();
        return;
      }
      const rect = rectOf(range, event);
      try {
        handlers.onPick?.({ phrase, sentence: phrase, range, rect, button: startButton, dragged: true, docText: contextAroundRange(range, phrase) });
      } catch (error) {
        /* 不要静默：上一版菜单构建抛错被这里吞掉，表现成「右键没反应」。 */
        warnOnce(error);
      }
      return;
    }
    /* 没拖动：取指针所在整句（点在图标/空白上就取消）。 */
    const point = dropPoint ?? origin;
    const data = point !== null && point !== undefined && typeof point.container?.data === 'string'
      ? point.container.data
      : (point?.container?.textContent ?? '');
    const sentence = typeof data === 'string' ? expandSentenceAt(data, point?.offset ?? 0) : '';
    if (sentence === '') {
      handlers.onCancel?.();
      return;
    }
    /* 没拖动时给 `range: null`：让调用方按整句文本重新解析 Range。
       这里若自己造一个 1 字的 Range，就会把一句话高亮成一个字（踩过）。 */
    try {
      handlers.onPick?.({ phrase: sentence, sentence, range: null, rect: rectOf(null, event), button: startButton, dragged: false });
    } catch {
      /* 忽略 */
    }
  }

  /**
   * 取选区的屏幕位置；拿不到就退回鼠标位置。
   * @param {Range|null} range - 选区。
   * @param {MouseEvent} event - 事件。
   * @returns {{left:number, top:number, right:number, bottom:number, width:number, height:number}} 矩形。
   */
  function rectOf(range, event) {
    try {
      const rect = range?.getBoundingClientRect?.();
      if (rect !== null && rect !== undefined && (rect.width > 0 || rect.height > 0)) {
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      }
    } catch {
      /* 忽略 */
    }
    const x = Number.isFinite(event?.clientX) ? event.clientX : 0;
    const y = Number.isFinite(event?.clientY) ? event.clientY : 0;
    return { left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
  }

  function onContextMenu(event) {
    if (armed || Date.now() < swallowUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onKeyDown(event) {
    if (event?.key === 'Escape') cancel();
  }

  function onBlur() {
    cancel();
  }

  doc.addEventListener('mousedown', onDown, true);
  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('mouseup', onUp, true);
  doc.addEventListener('contextmenu', onContextMenu, true);
  doc.addEventListener('keydown', onKeyDown, true);
  if (view !== null && typeof view.addEventListener === 'function') view.addEventListener('blur', onBlur);

  return {
    dispose() {
      doc.removeEventListener('mousedown', onDown, true);
      doc.removeEventListener('mousemove', onMove, true);
      doc.removeEventListener('mouseup', onUp, true);
      doc.removeEventListener('contextmenu', onContextMenu, true);
      doc.removeEventListener('keydown', onKeyDown, true);
      if (view !== null && typeof view.removeEventListener === 'function') view.removeEventListener('blur', onBlur);
      reset();
    },
    cancel,
    active: () => armed,
  };
}


/* ===== client/menu.js ===== */
/**
 * 右键菜单（关掉圈词时用）。
 *
 * 场景：圈词关掉以后，右键拖过一段仍然会选中（并变绿），松手在选区**右上角**弹出
 * 这个小方框。一级只放四个最常用的，其余进「更多…」，免得一屏塞十行。
 *
 * 一级：复制 / 查询 / 换个说法 / 收进圈词本
 * 更多：复制释义 / 举个例子 / 翻译 / 朗读 / 复制引用块 / 定位出处
 *
 * 图标全部手画（SVG，16×16，1.4px 描边），不引入字体、不拼 innerHTML。
 */

/** 菜单根 id。 */
const MENU_ID = 'knest-menu-layer';

/** 命名空间。 */
const MENU_SVG_NS = 'http://www.w3.org/2000/svg';

/** 一级项。 */
const TOP_ITEMS = [
  { action: 'copy', label: '复制', hint: 'Ctrl+C' },
  { action: 'query', label: '查询', hint: '右键拖' },
  { action: 'rephrase', label: '换个说法', hint: 'Ctrl+R' },
  { action: 'mark-domain', label: '标出同领域', hint: 'Ctrl+D' },
  { action: 'annotate', label: '批注这段', hint: '一次性' },
  { action: 'save', label: '收进生词本', hint: 'Ctrl+S' },
];

/** 二级项。 */
const MORE_ITEMS = [
  { action: 'copy-explain', label: '复制释义', hint: '' },
  { action: 'example', label: '举个例子', hint: '' },
  { action: 'translate', label: '翻译', hint: '' },
  { action: 'speak', label: '朗读', hint: '' },
  { action: 'copy-quote', label: '复制引用块', hint: '' },
  { action: 'locate', label: '定位出处', hint: '' },
  { action: 'clear-notes', label: '清空批注', hint: '' },
];

/**
 * 造图标。
 * @param {Document} doc - 文档。
 * @param {string} name - 图标名。
 * @returns {SVGElement} 图标节点。
 */
function menuIcon(doc, name) {
  const svg = doc.createElementNS(MENU_SVG_NS, 'svg');
  const setup = {
    viewBox: '0 0 16 16',
    width: '15',
    height: '15',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.4',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  };
  for (const [key, value] of Object.entries(setup)) svg.setAttribute(key, value);

  const add = (tag, attrs) => {
    const node = doc.createElementNS(MENU_SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    svg.appendChild(node);
    return node;
  };

  if (name === 'copy') {
    add('rect', { x: 5.6, y: 5.6, width: 8, height: 8.4 });
    add('path', { d: 'M10.4 3.4H3.2v9' });
  } else if (name === 'query') {
    add('circle', { cx: 7, cy: 7, r: 3.4 });
    add('circle', { cx: 7, cy: 7, r: 0.9, fill: 'currentColor', stroke: 'none' });
    add('path', { d: 'M10.3 10.3 13.6 13.6' });
  } else if (name === 'rephrase') {
    add('path', { d: 'M2.8 6.2a5.2 5.2 0 0 1 8.9-1.9' });
    add('path', { d: 'M13.2 9.8a5.2 5.2 0 0 1-8.9 1.9' });
    add('path', { d: 'M11.7 1.9v2.6H9.1' });
    add('path', { d: 'M4.3 14.1v-2.6h2.6' });
  } else if (name === 'save') {
    add('path', { d: 'M4.4 2.4h7.2v11.2L8 11.1l-3.6 2.5z' });
  } else if (name === 'copy-explain') {
    add('rect', { x: 3.4, y: 2.4, width: 9.2, height: 11.2 });
    add('path', { d: 'M5.6 5.6h4.8M5.6 8h4.8M5.6 10.4h3.2' });
  } else if (name === 'example') {
    add('path', { d: 'M8 2.2v2.2M8 11.6v2.2M2.2 8h2.2M11.6 8h2.2' });
    add('circle', { cx: 8, cy: 8, r: 2.4 });
  } else if (name === 'translate') {
    add('circle', { cx: 8, cy: 8, r: 5.6 });
    add('path', { d: 'M2.6 8h10.8' });
    add('path', { d: 'M8 2.4c3 3.2 3 8 0 11.2-3-3.2-3-8 0-11.2z' });
  } else if (name === 'speak') {
    add('path', { d: 'M3.2 6.2h2.2l3-2.6v8.8l-3-2.6H3.2z' });
    add('path', { d: 'M10.8 6a2.8 2.8 0 0 1 0 4M12.4 4.2a5.2 5.2 0 0 1 0 7.6' });
  } else if (name === 'copy-quote') {
    add('path', { d: 'M4.2 4.2h2.6v3.4c0 1.6-1 2.6-2.6 2.8' });
    add('path', { d: 'M9.2 4.2h2.6v3.4c0 1.6-1 2.6-2.6 2.8' });
  } else if (name === 'locate') {
    add('circle', { cx: 8, cy: 8, r: 3 });
    add('path', { d: 'M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2' });
  } else if (name === 'mark-domain') {
    /* 三个点连成一片：同类的意思 */
    add('circle', { cx: 4, cy: 5.2, r: 1.5 });
    add('circle', { cx: 11.6, cy: 4.4, r: 1.5 });
    add('circle', { cx: 7.6, cy: 11.4, r: 1.5 });
    add('path', { d: 'M5.4 5.4 10.2 4.7M4.9 6.6l1.9 3.4M10.6 5.7l-2 4.3' });
  } else {
    /* more / back */
    add('path', { d: name === 'back' ? 'M9.4 3.6 5 8l4.4 4.4' : 'M6.6 3.6 11 8l-4.4 4.4' });
  }
  return svg;
}

/**
 * 建元素的小工具（不拼 innerHTML）。
 * @param {Document} doc - 文档。
 * @param {string} tag - 标签。
 * @param {object} [attrs] - 属性。
 * @param {(Node|string)[]} [children] - 子节点。
 * @returns {HTMLElement} 节点。
 */
function menuEl(doc, tag, attrs = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
  }
  return node;
}

/**
 * 由上下文算出每一项的可用状态（纯函数，DOM 那层只负责画）。
 * @param {{editable?:boolean, hasSelection?:boolean, selection?:string, hasExplain?:boolean}} [data] - 上下文。
 * @returns {{top:object[], more:object[]}} 两页菜单项。
 */
function menuItemsFor(data) {
  const hasText = data?.hasSelection === true
    || (typeof data?.selection === 'string' && data.selection.trim() !== '');
  const hasExplain = data?.hasExplain === true;
  const hasDomain = data?.hasDomain === true;
  const mark = (items) => items.map((item) => {
    const disabled = item.action === 'annotate'
      ? false
      : item.action === 'copy-explain'
      ? !hasExplain
      : (item.action === 'mark-domain'
        ? !hasDomain
        : (item.action === 'copy' || item.action === 'save' ? !hasText : !hasText && item.action !== 'query'));
    return { ...item, disabled };
  });
  const label = typeof data?.queryLabel === 'string' && data.queryLabel !== '' ? data.queryLabel : '';
  const top = label === ''
    ? TOP_ITEMS
    : TOP_ITEMS.map((item) => (item.action === 'query' ? { ...item, label } : item));
  return { top: mark(top), more: mark(MORE_ITEMS) };
}

/**
 * 造菜单。
 * @param {{doc?:Document, onAction?:Function}} [options] - 依赖。
 * @returns {{show:Function, hide:Function, isOpen:Function, page:Function, dispose:Function}} 句柄。
 */
function createMenu(options = {}) {
  const doc = options.doc ?? (typeof globalThis.document === 'undefined' ? null : globalThis.document);
  const onAction = options.onAction;

  let root = null;
  let box = null;
  let payload = null;
  let listening = false;
  let page = 'top';
  let anchor = null;

  const hide = () => {
    if (box !== null && box.parentNode !== null) {
      try {
        box.remove();
      } catch {
        /* 忽略 */
      }
    }
    box = null;
    payload = null;
    anchor = null;
    page = 'top';
    if (listening && doc !== null) {
      listening = false;
      doc.removeEventListener('mousedown', onOutside, true);
      doc.removeEventListener('keydown', onKey, true);
      doc.defaultView?.removeEventListener?.('scroll', hide, true);
      doc.defaultView?.removeEventListener?.('resize', hide, true);
    }
  };

  function onOutside(event) {
    if (box === null) return;
    if (event.target !== null && typeof box.contains === 'function' && box.contains(event.target)) return;
    hide();
  }

  function onKey(event) {
    if (event?.key === 'Escape') hide();
  }

  const listen = () => {
    if (doc === null || listening) return;
    listening = true;
    doc.addEventListener('mousedown', onOutside, true);
    doc.addEventListener('keydown', onKey, true);
    doc.defaultView?.addEventListener?.('scroll', hide, true);
    doc.defaultView?.addEventListener?.('resize', hide, true);
  };

  const ensureRoot = () => {
    if (doc === null) return null;
    if (root !== null && root.isConnected !== false) return root;
    const existing = typeof doc.getElementById === 'function' ? doc.getElementById(MENU_ID) : null;
    if (existing !== null && existing !== undefined) {
      root = existing;
      root.textContent = '';
      return root;
    }
    root = menuEl(doc, 'div', { id: MENU_ID });
    (doc.body ?? doc.documentElement).appendChild(root);
    return root;
  };

  const place = () => {
    if (box === null || anchor === null) return;
    const view = doc.defaultView;
    const vw = view?.innerWidth ?? 1280;
    const vh = view?.innerHeight ?? 800;
    const width = box.offsetWidth || 190;
    const height = box.offsetHeight || 160;
    const margin = 8;
    let left = anchor.right + 6;
    if (left + width > vw - margin) left = anchor.left - width - 6;
    if (left < margin) left = margin;
    let top = anchor.top - height - 6;
    if (top < margin) top = anchor.bottom + 6;
    if (top + height > vh - margin) top = Math.max(margin, vh - height - margin);
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
  };

  /**
   * 画一页。
   * @param {'top'|'more'} next - 页码。
   * @returns {void}
   */
  const paint = (next) => {
    if (box === null) return;
    page = next;
    const groups = menuItemsFor(payload);
    const items = next === 'more' ? groups.more : groups.top;
    box.textContent = '';
    box.dataset.page = next;

    if (next === 'more') {
      const back = menuEl(doc, 'button', { class: 'knest-mi knest-mi-lead', type: 'button', 'data-nav': 'back' }, [
        menuIcon(doc, 'back'),
        menuEl(doc, 'span', { class: 'knest-mi-label', text: '返回' }),
      ]);
      back.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        paint('top');
      });
      box.appendChild(back);
      box.appendChild(menuEl(doc, 'div', { class: 'knest-mdiv' }));
    }

    for (const item of items) {
      const button = menuEl(doc, 'button', {
        class: 'knest-mi',
        type: 'button',
        role: 'menuitem',
        'data-action': item.action,
        disabled: item.disabled === true,
        title: item.disabled === true
          ? (item.action === 'copy-explain' ? '先查询一次，才有释义可复制' : '先选中一段文字')
          : item.label,
      }, [
        menuIcon(doc, item.action),
        menuEl(doc, 'span', { class: 'knest-mi-label', text: item.label }),
        menuEl(doc, 'span', { class: 'knest-mi-hint', text: item.hint }),
      ]);
      box.appendChild(button);
    }

    if (next === 'top') {
      box.appendChild(menuEl(doc, 'div', { class: 'knest-mdiv' }));
      const more = menuEl(doc, 'button', { class: 'knest-mi knest-mi-more', type: 'button', 'data-nav': 'more' }, [
        menuIcon(doc, 'more'),
        menuEl(doc, 'span', { class: 'knest-mi-label', text: '更多' }),
      ]);
      more.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        paint('more');
        place();
      });
      box.appendChild(more);
    }
    place();
  };

  return {
    /**
     * 在选区右上角弹出。
     * @param {{left:number, top:number, right:number, bottom:number}} rect - 选区矩形（视口坐标）。
     * @param {{phrase:string, selection:string, hasSelection:boolean, hasExplain?:boolean}} data - 上下文。
     * @returns {void}
     */
    show(rect, data) {
      const host = ensureRoot();
      if (host === null) return;
      hide();
      anchor = rect ?? { left: 8, top: 8, right: 8, bottom: 8 };
      payload = data ?? { phrase: '', selection: '', hasSelection: false, hasExplain: false };

      box = menuEl(doc, 'div', { class: 'knest-menu', role: 'menu', 'aria-label': '选区操作' });
      box.addEventListener('mousedown', (event) => event.preventDefault());
      box.addEventListener('click', (event) => {
        const target = event.target;
        const button = target !== null && typeof target.closest === 'function' ? target.closest('.knest-mi') : null;
        if (button === null || button.disabled === true) return;
        if (button.getAttribute('data-nav') !== null) return;
        const action = button.getAttribute('data-action');
        const snapshot = payload;
        hide();
        try {
          onAction?.(action, snapshot);
        } catch (error) {
          try {
            console.warn('[knest] 菜单动作抛错：', error);
          } catch {
            /* 忽略 */
          }
        }
      });

      host.appendChild(box);
      paint('top');
      listen();
    },
    hide,
    /**
     * 开着没有。
     * @returns {boolean} 是否开着。
     */
    isOpen() {
      return box !== null;
    },
    /**
     * 当前页（调试用）。
     * @returns {string} top / more。
     */
    page() {
      return page;
    },
    /**
     * 卸载。
     * @returns {void}
     */
    dispose() {
      hide();
      if (root !== null && root.parentNode !== null) {
        try {
          root.remove();
        } catch {
          /* 忽略 */
        }
      }
      root = null;
    },
  };
}


/* ===== client/annotate.js ===== */
/**
 * 批注：把一段话标红划掉，并在它**正上方**挂一个跟随文字的气泡写「改为：」。
 *
 * 两种进入方式：
 *   1. 选中后右键菜单「批注」——一次性，标完就结束；
 *   2. 右侧按钮 / 快捷键进入**批注模式**——此时右键拖选直接标红，**不弹菜单**。
 *
 * 语义两种：`rewrite`（改写，写替代文字）/ `strike`（划掉，不写替代）。
 * 发下一条消息后，之前的批注自动标 `submitted`（淡出），但仍留在 AGENTS.local.md 供模型读取。
 */

/** 本地存储键。 */
const NOTES_KEY = 'dsh.knowledge-nest.notes';

/** 红高亮名。 */
const NOTE_HIGHLIGHT = 'knest-note';

/** 浮层 id。 */
const NOTE_LAYER_ID = 'knest-annotations';

/** 上限。 */
const MAX_NOTES = 60;

/**
 * 造批注器。
 * @param {{doc?:Document, win?:object, onchange?:Function}} [options] - 依赖。
 * @returns {object} 句柄。
 */
function createAnnotator(options = {}) {
  const doc = options.doc ?? (typeof globalThis.document === 'undefined' ? null : globalThis.document);
  const win = options.win ?? (typeof globalThis === 'undefined' ? null : globalThis);
  const onchange = options.onchange;

  /** @type {object[]} */
  let notes = readNotes();
  /** @type {Map<string, Range>} */
  const ranges = new Map();
  /** @type {Map<string, HTMLElement>} */
  const bubbles = new Map();
  let mode = false;
  let layer = null;
  let counter = 0;
  let raf = 0;

  const registry = win?.CSS?.highlights ?? null;
  const HighlightCtor = win?.Highlight ?? null;
  const supported = registry !== null && typeof HighlightCtor === 'function';

  function readNotes() {
    try {
      const raw = win?.localStorage?.getItem(NOTES_KEY);
      if (typeof raw !== 'string' || raw === '') return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item) => item !== null && typeof item === 'object') : [];
    } catch {
      return [];
    }
  }

  const persist = () => {
    try {
      win?.localStorage?.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch {
      /* 忽略 */
    }
    try {
      onchange?.(notes.slice());
    } catch {
      /* 忽略 */
    }
  };

  const ensureLayer = () => {
    if (doc === null) return null;
    if (layer !== null && layer.isConnected !== false) return layer;
    layer = doc.getElementById?.(NOTE_LAYER_ID) ?? null;
    if (layer === null) {
      layer = doc.createElement('div');
      layer.id = NOTE_LAYER_ID;
      layer.className = 'knest-notes-layer';
      (doc.body ?? doc.documentElement).appendChild(layer);
    }
    return layer;
  };

  const repaint = () => {
    if (!supported) return;
    try {
      const list = [...ranges.values()].filter((range) => range !== null);
      if (list.length === 0) registry.delete(NOTE_HIGHLIGHT);
      else registry.set(NOTE_HIGHLIGHT, new HighlightCtor(...list));
    } catch {
      /* 忽略 */
    }
  };

  /**
   * 把气泡挪到红字正上方（跟随滚动）。
   * @returns {void}
   */
  const reposition = () => {
    for (const note of notes) {
      const box = bubbles.get(note.id);
      const range = ranges.get(note.id);
      if (box === undefined || range === undefined) continue;
      let rect = null;
      try {
        rect = range.getBoundingClientRect();
      } catch {
        rect = null;
      }
      if (rect === null || (rect.width === 0 && rect.height === 0)) continue;
      const height = box.offsetHeight || 40;
      const above = rect.top - height - 6;
      box.style.left = `${Math.round(Math.max(8, rect.left))}px`;
      /* 上面放不下就翻到文字下方，别被窗口顶切掉 */
      box.style.top = `${Math.round(above >= 8 ? above : rect.bottom + 6)}px`;
      box.setAttribute('data-side', above >= 8 ? 'above' : 'below');
    }
  };

  /** 下一帧重排（滚动时别每像素都算）。 */
  const scheduleReposition = () => {
    if (raf !== 0) return;
    const rafFn = win?.requestAnimationFrame ?? ((fn) => setTimeout(fn, 16));
    raf = rafFn(() => {
      raf = 0;
      reposition();
    });
  };

  /**
   * 造气泡。
   * @param {object} note - 批注。
   * @returns {HTMLElement} 气泡。
   */
  const buildBubble = (note) => {
    const box = doc.createElement('div');
    box.className = 'knest-note-bubble';
    box.setAttribute('data-note-id', note.id);
    box.setAttribute('data-kind', note.kind === 'strike' ? 'strike' : 'rewrite');
    box.setAttribute('data-collapsed', note.collapsed === false ? 'false' : 'true');
    box.setAttribute('data-submitted', note.submitted === true ? 'true' : 'false');

    const head = doc.createElement('div');
    head.className = 'knest-note-head';

    const kindBtn = doc.createElement('button');
    kindBtn.className = 'knest-note-kind';
    kindBtn.type = 'button';
    kindBtn.textContent = note.kind === 'strike' ? '划掉' : '改写';
    kindBtn.title = '切换：改写 / 划掉';
    kindBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      note.kind = note.kind === 'strike' ? 'rewrite' : 'strike';
      box.setAttribute('data-kind', note.kind);
      kindBtn.textContent = note.kind === 'strike' ? '划掉' : '改写';
      persist();
    });

    const kill = doc.createElement('button');
    kill.className = 'knest-note-del';
    kill.type = 'button';
    kill.textContent = '×';
    kill.title = '删掉这条批注';
    kill.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      remove(note.id);
    });

    head.appendChild(kindBtn);
    head.appendChild(kill);

    const field = doc.createElement('textarea');
    field.className = 'knest-note-input';
    field.rows = 1;
    field.placeholder = '改为：';
    field.value = typeof note.note === 'string' ? note.note : '';
    field.addEventListener('input', () => {
      note.note = field.value;
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight}px`;
      persist();
    });
    field.addEventListener('focus', () => {
      box.setAttribute('data-collapsed', 'false');
      note.collapsed = false;
    });

    box.appendChild(head);
    box.appendChild(field);

    box.addEventListener('click', (event) => {
      if (event.target === field) return;
      const collapsed = box.getAttribute('data-collapsed') === 'true';
      box.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
      note.collapsed = !collapsed;
      if (!collapsed) return;
      scheduleReposition();
    });

    return box;
  };

  /**
   * 加一条。
   * @param {{phrase:string, range?:Range|null, rect?:object|null, kind?:string}} input - 选区。
   * @returns {object|null} 批注。
   */
  const add = (input) => {
    const phrase = typeof input?.phrase === 'string' ? input.phrase.trim() : '';
    if (phrase === '') return null;
    const range = input?.range ?? null;
    const rect = input?.rect ?? (typeof range?.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null);
    /* 同一句话在同一处反复拖：复用已有那条 */
    const twin = notes.find((item) => item.phrase === phrase
      && Number.isFinite(item.x) && rect !== null
      && Math.abs(item.x - rect.left) < 6);
    if (twin !== undefined) return twin;

    counter += 1;
    const note = {
      id: `a-${Date.now().toString(36)}-${counter}`,
      phrase,
      note: '',
      kind: input?.kind === 'strike' ? 'strike' : 'rewrite',
      ts: Date.now(),
      submitted: false,
      collapsed: true,
      x: rect === null ? Number.NaN : rect.left,
      y: rect === null ? Number.NaN : rect.top,
    };
    notes.push(note);
    while (notes.length > MAX_NOTES) notes.shift();
    if (range !== null) ranges.set(note.id, range);
    repaint();

    const host = ensureLayer();
    if (host !== null) {
      const box = buildBubble(note);
      bubbles.set(note.id, box);
      host.appendChild(box);
      scheduleReposition();
      /* 改写语义：一出现就展开并聚焦，光标在那儿等同用户输入；划掉则不需要 */
      if (note.kind !== 'strike') {
        box.setAttribute('data-collapsed', 'false');
        note.collapsed = false;
        const field = typeof box.querySelector === 'function' ? box.querySelector('.knest-note-input') : null;
        try {
          field?.focus?.();
          const end = String(field?.value ?? '').length;
          field?.setSelectionRange?.(end, end);
        } catch {
          /* 忽略 */
        }
      }
    }
    persist();
    return note;
  };

  const update = (id, patch) => {
    const note = notes.find((item) => item.id === id);
    if (note === undefined) return;
    /* 传字符串 = 只改写后内容；传对象 = 改任意字段（note / kind / submitted） */
    if (typeof patch === 'string') note.note = patch;
    else if (patch !== null && typeof patch === 'object') Object.assign(note, patch);
    persist();
  };

  const remove = (id) => {
    notes = notes.filter((item) => item.id !== id);
    ranges.delete(id);
    repaint();
    const box = bubbles.get(id);
    if (box !== undefined && box.parentNode !== null) box.parentNode.removeChild(box);
    bubbles.delete(id);
    persist();
  };

  const clear = () => {
    notes = [];
    ranges.clear();
    repaint();
    for (const box of bubbles.values()) if (box.parentNode !== null) box.parentNode.removeChild(box);
    bubbles.clear();
    persist();
  };

  const since = (mark) => {
    const limit = Number.isFinite(mark) ? mark : 0;
    return notes.filter((note) => Number(note.ts) > limit);
  };

  return {
    /** 清空全部批注（含红高亮与气泡）。 */
    clearAll() {
      clear();
    },
    isOn() {
      return mode;
    },
    setMode(next) {
      mode = next === true;
      doc?.body?.setAttribute?.('data-knest-annotate', mode ? 'true' : 'false');
      return mode;
    },
    add,
    update,
    remove,
    clear,
    since,
    /** 未提交的批注。 */
    pending() {
      return notes.filter((note) => note.submitted !== true);
    },
    /**
     * 发消息后把"已发生"的批注标为已提交（淡出）。
     * @param {number} before - 时间点。
     * @returns {number} 标记条数。
     */
    submitAll(before) {
      const limit = Number.isFinite(before) ? before : Date.now();
      let count = 0;
      for (const note of notes) {
        if (note.submitted === true || Number(note.ts) > limit) continue;
        note.submitted = true;
        count += 1;
        bubbles.get(note.id)?.setAttribute('data-submitted', 'true');
      }
      if (count > 0) persist();
      return count;
    },
    list() {
      return notes.slice();
    },
    supported,
    reposition,
    restore() {
      const host = ensureLayer();
      if (host === null) return 0;
      for (const note of notes) {
        const box = buildBubble(note);
        bubbles.set(note.id, box);
        host.appendChild(box);
      }
      scheduleReposition();
      return notes.length;
    },
    dispose() {
      try {
        registry?.delete?.(NOTE_HIGHLIGHT);
      } catch {
        /* 忽略 */
      }
      if (layer !== null && layer.parentNode !== null) layer.parentNode.removeChild(layer);
      layer = null;
      bubbles.clear();
      doc?.body?.removeAttribute?.('data-knest-annotate');
    },
  };
}


/* ===== client/tree-board.js ===== */
/**
 * 知识树画布：无限画布 + 节点 + SVG 贝塞尔连线。
 *
 * 替代原来的「独立浮动窗口」：不再一卡一窗，而是一张画布，节点散布其上，
 * 父子之间用一条曲线相连；拖动节点时线跟着重算，空白处拖动平移、滚轮缩放。
 *
 * 分层：
 *   - **纯函数**（edgeFor / pathFor / depthOf / descendantsOf / placeChild）：不碰 DOM，node 里直接测；
 *   - **渲染层**（createTreeBoard）：只负责把节点数组画成 DOM + SVG。
 *
 * 约束：最多 3 层（根 = 第 1 层），到第 3 层的节点不再展开新节点。
 */

/** 节点宽度（固定，高度自适应）。 */
const NODE_W = 300;

/** 最多几层（根算第 1 层）。 */
const MAX_LEVELS = 4;

/** 连线的控制点强度（相对位移比例，0~0.6 之间比较好看）。 */
const CURVE = 0.5;

/** 子节点默认落位：水平间距 / 垂直间距。 */
const GAP_X = 56;
const GAP_Y = 96;

/** 缩放范围。 */
const SCALE_MIN = 0.4;
const SCALE_MAX = 2.2;


/** 数字收一位小数，便于测试断言与输出稳定。 */
function round(value) {
  return Math.round(Number(value) * 10) / 10;
}

/**
 * 节点尺寸（没测到就用默认值）。
 * @param {{w?:number,h?:number}} size - 尺寸。
 * @returns {{w:number,h:number}} 收敛后的尺寸。
 */
function sizeOf(size) {
  return {
    w: Number.isFinite(size?.w) && size.w > 0 ? size.w : NODE_W,
    h: Number.isFinite(size?.h) && size.h > 0 ? size.h : 160,
  };
}

/**
 * 算一条连线的两个端点与控制点。
 *
 * 自动避让规则：
 *   · 两个节点**大致上下叠着**（横向位移 ≤ 一个节点宽 × 0.9）→ 竖向连线：
 *     父底边中点 → 子顶边中点（子在父上方则反过来）；
 *   · 横向拉开得更远 → 横向连线：父右（或左）边中点 → 子左边（或右）边中点。
 *
 * @param {{x:number,y:number}} parent - 父节点左上角（世界坐标）。
 * @param {{x:number,y:number}} child - 子节点左上角。
 * @param {{w:number,h:number}} parentSize - 父节点尺寸。
 * @param {{w:number,h:number}} childSize - 子节点尺寸。
 * @returns {{x1:number,y1:number,c1x:number,c1y:number,c2x:number,c2y:number,x2:number,y2:number,orientation:'vertical'|'horizontal'}} 连线几何。
 */
function edgeFor(parent, child, parentSize, childSize) {
  const p = { x: Number(parent?.x) || 0, y: Number(parent?.y) || 0 };
  const c = { x: Number(child?.x) || 0, y: Number(child?.y) || 0 };
  const ps = sizeOf(parentSize);
  const cs = sizeOf(childSize);
  const dx = c.x - p.x;
  const dy = c.y - p.y;

  if (Math.abs(dx) <= Math.max(ps.w, cs.w) * 0.9) {
    /* 竖向：默认父下 → 子上；子整体在父上方则反过来。 */
    const down = (c.y + cs.h / 2) >= (p.y + ps.h / 2);
    const x1 = p.x + ps.w / 2;
    const y1 = down ? p.y + ps.h : p.y;
    const x2 = c.x + cs.w / 2;
    const y2 = down ? c.y : c.y + cs.h;
    const bend = Math.max(40, Math.abs(y2 - y1) * CURVE);
    return {
      x1: round(x1),
      y1: round(y1),
      c1x: round(x1),
      c1y: round(down ? y1 + bend : y1 - bend),
      c2x: round(x2),
      c2y: round(down ? y2 - bend : y2 + bend),
      x2: round(x2),
      y2: round(y2),
      orientation: 'vertical',
    };
  }

  /* 横向：默认父右 → 子左；子整体在父左边则反过来。 */
  const right = (c.x + cs.w / 2) >= (p.x + ps.w / 2);
  const x1 = right ? p.x + ps.w : p.x;
  const y1 = p.y + ps.h / 2;
  const x2 = right ? c.x : c.x + cs.w;
  const y2 = c.y + cs.h / 2;
  const bend = Math.max(40, Math.abs(x2 - x1) * CURVE);
  return {
    x1: round(x1),
    y1: round(y1),
    c1x: round(right ? x1 + bend : x1 - bend),
    c1y: round(y1),
    c2x: round(right ? x2 - bend : x2 + bend),
    c2y: round(y2),
    x2: round(x2),
    y2: round(y2),
    orientation: 'horizontal',
  };
}

/**
 * 连线几何 → SVG `d`。
 * @param {object} edge - `edgeFor()` 的产物。
 * @returns {string} `M x1 y1 C c1x c1y c2x c2y x2 y2`。
 */
function pathFor(edge) {
  return `M ${edge.x1} ${edge.y1} C ${edge.c1x} ${edge.c1y} ${edge.c2x} ${edge.c2y} ${edge.x2} ${edge.y2}`;
}

/**
 * 节点的层级（根 = 0）。
 * @param {object[]} nodes - 节点数组。
 * @param {string} id - 节点 id。
 * @returns {number} 层级；找不到返回 -1。
 */
function depthOf(nodes, id) {
  const map = new Map((Array.isArray(nodes) ? nodes : []).map((node) => [node.id, node]));
  let cursor = map.get(id);
  let depth = 0;
  let guard = 0;
  while (cursor !== undefined && cursor.parentId !== null && cursor.parentId !== undefined) {
    cursor = map.get(cursor.parentId);
    depth += 1;
    guard += 1;
    if (guard > 64) break; /* 环保护 */
  }
  return map.has(id) ? depth : -1;
}

/**
 * 某个节点的全部后代 id（含自己）。
 * @param {object[]} nodes - 节点数组。
 * @param {string} id - 节点 id。
 * @returns {string[]} id 列表。
 */
function descendantsOf(nodes, id) {
  const list = Array.isArray(nodes) ? nodes : [];
  const out = [id];
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of list) {
      if (out.includes(node.id)) continue;
      if (out.includes(node.parentId)) {
        out.push(node.id);
        changed = true;
      }
    }
  }
  return out;
}

/**
 * 给新子节点挑个落点：父节点下方居中排开，兄弟越多越往右摊。
 * @param {object[]} nodes - 现有节点。
 * @param {object} parent - 父节点（需含 x/y）。
 * @param {{w:number,h:number}} parentSize - 父节点尺寸。
 * @param {number} index - 在兄弟里的序号（0 起）。
 * @returns {{x:number,y:number}} 世界坐标。
 */
function placeChild(nodes, parent, parentSize, index) {
  const ps = sizeOf(parentSize);
  const siblings = (Array.isArray(nodes) ? nodes : []).filter((node) => node.parentId === parent.id);
  const total = Math.max(1, siblings.length + 1);
  const step = NODE_W + GAP_X;
  const slot = index - (total - 1) / 2;
  const centerX = (parent.x ?? 0) + ps.w / 2 + slot * step;
  return {
    x: round(centerX - NODE_W / 2),
    y: round((parent.y ?? 0) + ps.h + GAP_Y),
  };
}

/**
 * 造画布。
 * @param {{doc?:Document, onExpand?:Function, onRetry?:Function}} [options] - 依赖。
 *   `onExpand(nodeId, text)` 在点击节点里的可展开词时回调；`onRetry(nodeId, text)` 在点「再试一次」时回调。
 * @returns {object} 画布句柄。
 */
function createTreeBoard(options = {}) {
  const doc = options.doc ?? (typeof globalThis.document === 'undefined' ? null : globalThis.document);
  const onExpand = options.onExpand;
  const onRetry = options.onRetry;
  const onClear = options.onClear;
  const onchange = options.onchange;
  const onCopyNode = options.onCopyNode;
  const onExport = options.onExport;
  const onCardMenu = options.onCardMenu;
  const onSelect = options.onSelect;

  /** 通知外部：画布变了（用于持久化）。 */
  const notify = () => {
    try {
      onchange?.();
    } catch {
      /* 忽略 */
    }
  };

  /** @type {object[]} 节点 [{id, text, x, y, parentId, depth, model, collapsed}]。 */
  const nodes = [];
  /** @type {Map<string, HTMLElement>} */
  const elements = new Map();
  /** @type {Map<string, {w:number,h:number}>} */
  const sizes = new Map();

  let root = null;
  let world = null;
  let edgeLayer = null;
  let nodeLayer = null;
  let hud = null;
  let panX = 0;
  let panY = 0;
  let scale = 1;
  let drag = null;
  /** @type {Set<string>} 多选（Shift+点击） */
  const selected = new Set();
  let stage = null;
  let named = 0;

  const indexOf = (id) => nodes.findIndex((node) => node.id === id);
  const get = (id) => nodes[indexOf(id)] ?? null;

  /**
   * 造元素。
   * @param {string} tag - 标签。
   * @param {object} [attrs] - 属性（class / text / data-*）。
   * @param {(Node|string)[]} [children] - 子节点。
   * @returns {HTMLElement} 节点。
   */
  const el = (tag, attrs = {}, children = []) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = String(value);
      else if (key === 'text') node.textContent = String(value);
      else node.setAttribute(key, String(value));
    }
    for (const child of children) {
      if (child === null || child === undefined) continue;
      node.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
    }
    return node;
  };

  /** 读节点尺寸（DOM 量不到就用默认值）。 */
  const measure = (id) => {
    const cached = sizes.get(id);
    const node = elements.get(id);
    if (node === undefined) return cached ?? { w: NODE_W, h: 160 };
    const w = Number(node.offsetWidth) || cached?.w || NODE_W;
    const h = Number(node.offsetHeight) || cached?.h || 160;
    const size = { w, h };
    sizes.set(id, size);
    return size;
  };

  const applyView = () => {
    if (world === null) return;
    world.style.transform = `translate(${Math.round(panX)}px, ${Math.round(panY)}px) scale(${scale})`;
  };

  const positionNode = (node) => {
    const element = elements.get(node.id);
    if (element === undefined) return;
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
  };

  /** 重画所有连线（节点数组变了 / 被拖动 / 折叠时都要调）。 */
  const syncEdges = () => {
    if (edgeLayer === null) return;
    edgeLayer.textContent = '';
    for (const node of nodes) {
      if (node.parentId === null || node.parentId === undefined) continue;
      const parent = get(node.parentId);
      if (parent === null) continue;
      const edge = edgeFor(parent, node, measure(parent.id), measure(node.id));
      const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathFor(edge));
      path.setAttribute('class', 'knest-edge');
      path.setAttribute('data-from', parent.id);
      path.setAttribute('data-to', node.id);
      path.setAttribute('data-orientation', edge.orientation);
      edgeLayer.appendChild(path);
    }
  };

  /**
   * 渲染一个节点的正文。
   * @param {object} node - 节点记录。
   * @returns {HTMLElement} 正文容器。
   */
  const renderBody = (node) => {
    const model = node.model ?? {};
    const body = el('div', { class: 'knest-tnode-body' });

    if (model.pending === true) {
      body.appendChild(el('div', { class: 'knest-scan' }));
      body.appendChild(el('div', { class: 'knest-skel', 'data-w': '84' }));
      body.appendChild(el('div', { class: 'knest-skel', 'data-w': '62' }));
      return body;
    }

    if (model.error === true) {
      body.appendChild(el('p', { class: 'knest-tnode-lead knest-bad', text: model.lead ?? '这次没拿到解释' }));
      const retry = el('button', { class: 'knest-retry', type: 'button', text: '再试一次' });
      retry.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          onRetry?.(node.id, node.text);
        } catch {
          /* 忽略 */
        }
      });
      body.appendChild(retry);
      return body;
    }

    body.appendChild(el('p', { class: 'knest-tnode-lead', text: model.lead ?? '' }));

    const evidence = Array.isArray(model.evidence) ? model.evidence.slice(0, 2) : [];
    if (evidence.length > 0) {
      const list = el('ul', { class: 'knest-tnode-evidence' });
      for (const item of evidence) {
        if (typeof item?.quote !== 'string' || item.quote === '') continue;
        list.appendChild(el('li', {}, [el('span', { class: 'knest-quote', text: item.quote })]));
      }
      if (list.children.length > 0) body.appendChild(list);
    }

    /* 可展开词：card.tree 的 label。到第 3 层就只显示、不再可点。 */
    const links = Array.isArray(model.tree) ? model.tree.slice(0, 4) : [];
    if (links.length > 0) {
      const expandable = node.depth < MAX_LEVELS - 1;
      const wrap = el('div', { class: 'knest-tnode-links' });
      for (const link of links) {
        if (typeof link?.label !== 'string' || link.label === '') continue;
        const chip = el('button', {
          class: 'knest-chip',
          type: 'button',
          'data-term': link.label,
          disabled: expandable !== true,
          title: expandable === true ? `展开「${link.label}」（Alt+点击＝原地换个解释）` : '最多 4 层，这里不再展开',
          text: link.label,
        });
        if (expandable === true) {
          chip.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            try {
              onExpand?.(node.id, link.label, { replace: event.altKey === true });
            } catch {
              /* 忽略 */
            }
          });
        }
        wrap.appendChild(chip);
      }
      if (wrap.children.length > 0) body.appendChild(wrap);
    }

    const meta = model.meta ?? {};
    const bits = [];
    if (meta.count > 0) bits.push(`${meta.count} 次`);
    if (meta.model) bits.push(meta.model);
    if (meta.usage?.total > 0) bits.push(`${meta.usage.total} token`);
    if (bits.length > 0) body.appendChild(el('div', { class: 'knest-tnode-foot', text: bits.join(' · ') }));

    return body;
  };

  /** 造一个节点 DOM（不含挂载）。 */
  const buildNode = (node) => {
    const title = el('span', { class: 'knest-tnode-title', text: node.text });
    const kind = el('span', { class: 'knest-tnode-kind', text: node.model?.kind ?? '' });
    const min = el('button', { class: 'knest-tnode-btn', type: 'button', 'data-act': 'min', title: '最小化', text: '—' });
    const close = el('button', { class: 'knest-tnode-btn', type: 'button', 'data-act': 'close', title: '关闭', text: '×' });
    const up = el('button', {
      class: 'knest-tnode-btn',
      type: 'button',
      'data-act': 'up',
      title: '回到上级',
      text: '↑',
    });
    if (node.parentId === null || node.parentId === undefined) up.setAttribute('hidden', 'true');
    up.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const parent = get(node.parentId);
      if (parent !== null) {
        centerOn(parent);
        elements.get(parent.id)?.setAttribute('data-flash', 'true');
        setTimeout(() => elements.get(parent.id)?.removeAttribute('data-flash'), 900);
      }
    });

    title.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        onCopyNode?.(node);
      } catch {
        /* 忽略 */
      }
    });

    const bar = el('header', { class: 'knest-tnode-bar' }, [up, title, kind, min, close]);
    const body = renderBody(node);

    const section = el('section', {
      class: 'knest-tnode',
      'data-id': node.id,
      'data-depth': String(node.depth),
      'data-collapsed': node.collapsed === true ? 'true' : 'false',
      /* 领域：模型给什么就写什么；空串表示"没判定"，前端据此不参与标橙 */
      'data-domain': node.model?.domain ?? '',
    }, [bar, body]);

    section.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        onCardMenu?.(node, event);
      } catch {
        /* 忽略 */
      }
    });

    section.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      /* Shift+点击：切换选中，不启动拖动 */
      if (event.shiftKey === true) {
        event.preventDefault();
        event.stopPropagation();
        if (selected.has(node.id)) selected.delete(node.id);
        else selected.add(node.id);
        section.setAttribute('data-selected', selected.has(node.id) ? 'true' : 'false');
        try {
          onSelect?.(selected.size);
        } catch {
          /* 忽略 */
        }
        return;
      }
      const target = event.target;
      const interactive = target !== null && typeof target.closest === 'function'
        && target.closest('button, textarea, input, a, .knest-chip') !== null;
      if (interactive) return;
      /* 标题栏永远可拖；正文只在没有活动选区时才拖，避免抢走选字 */
      const onBar = typeof target.closest === 'function' && target.closest('.knest-tnode-bar') !== null;
      if (!onBar) {
        try {
          const picked = doc?.getSelection?.();
          if (picked !== null && picked !== undefined && picked.isCollapsed === false) return;
        } catch {
          /* 忽略 */
        }
      }
      startNodeDrag(event, node.id);
    });

    min.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleCollapse(node.id);
    });
    close.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      remove(node.id);
    });

    return section;
  };

  /** 重画单个节点的正文（结果回来时）。 */
  const refreshNode = (node) => {
    const element = elements.get(node.id);
    if (element === undefined) return;
    const body = element.querySelector('.knest-tnode-body');
    if (body !== null && body !== undefined && body.parentNode !== null) {
      const next = renderBody(node);
      body.parentNode.replaceChild(next, body);
    }
    const kind = element.querySelector('.knest-tnode-kind');
    if (kind !== null && kind !== undefined) kind.textContent = node.model?.kind ?? '';
    element.setAttribute('data-domain', node.model?.domain ?? '');
  };

  const ensureShell = () => {
    if (doc === null) return false;
    if (root !== null && root.isConnected !== false) return true;
    const existing = typeof doc.getElementById === 'function' ? doc.getElementById('knest-board') : null;
    if (existing !== null && existing !== undefined) {
      root = existing;
      world = existing.querySelector('.knest-board-world');
      edgeLayer = existing.querySelector('.knest-board-edges');
      nodeLayer = existing.querySelector('.knest-board-nodes');
      hud = existing.querySelector('.knest-board-hud');
      return world !== null;
    }

    edgeLayer = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    edgeLayer.setAttribute('class', 'knest-board-edges');
    edgeLayer.setAttribute('width', '1');
    edgeLayer.setAttribute('height', '1');
    nodeLayer = el('div', { class: 'knest-board-nodes' });
    world = el('div', { class: 'knest-board-world' }, [edgeLayer, nodeLayer]);

    /* HUD 收成右上角一颗小胶囊：只有两个图标按钮，说明文字进 tooltip。 */
    const hint = '拖标题栏移动卡片 · Alt+拖拽平移 · Ctrl+滚轮缩放 · Esc 收起';
    const reset = el('button', { class: 'knest-hud-btn', type: 'button', title: `回到根节点\n${hint}`, text: '⟲' });
    reset.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const first = nodes[0];
      if (first !== undefined) centerOn(first);
    });
    const clear = el('button', { class: 'knest-hud-btn', type: 'button', title: `全部关闭（Esc）\n${hint}`, text: '✕' });
    clear.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearAll();
    });

    const exportBtn = el('button', { class: 'knest-hud-btn', type: 'button', title: '导出这棵树为 Markdown', text: '⤓' });
    exportBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        onExport?.();
      } catch {
        /* 忽略 */
      }
    });

    hud = el('div', { class: 'knest-board-hud' }, [exportBtn, reset, clear]);

    /* HUD 可拖动：宿主底部常有自己的工具条，固定位置迟早被挡。
       拖过之后位置记在 localStorage，下次还在这儿。 */
    const hudKey = 'knest.hud.pos';
    const restoreHud = () => {
      try {
        const raw = doc?.defaultView?.localStorage?.getItem(hudKey);
        if (typeof raw !== 'string' || raw === '') return;
        const pos = JSON.parse(raw);
        if (Number.isFinite(pos?.left) && Number.isFinite(pos?.top)) {
          hud.style.left = `${Math.round(pos.left)}px`;
          hud.style.top = `${Math.round(pos.top)}px`;
          hud.style.right = 'auto';
          hud.style.bottom = 'auto';
        }
      } catch {
        /* 忽略 */
      }
    };
    restoreHud();

    let hudDrag = null;
    const onHudMove = (event) => {
      if (hudDrag === null) return;
      event.preventDefault();
      event.stopPropagation();
      const dx = event.clientX - hudDrag.startX;
      const dy = event.clientY - hudDrag.startY;
      const box = stage?.getBoundingClientRect?.() ?? { width: 1280, height: 800 };
      const width = hud.offsetWidth || 90;
      const height = hud.offsetHeight || 28;
      const left = Math.min(Math.max(4, hudDrag.originLeft + dx), (Number(box.width) || 1280) - width - 4);
      const top = Math.min(Math.max(4, hudDrag.originTop + dy), (Number(box.height) || 800) - height - 4);
      hud.style.left = `${Math.round(left)}px`;
      hud.style.top = `${Math.round(top)}px`;
      hud.style.right = 'auto';
      hud.style.bottom = 'auto';
    };
    const onHudUp = (event) => {
      if (hudDrag === null) return;
      hudDrag = null;
      hud.setAttribute('data-dragging', 'false');
      doc?.removeEventListener?.('pointermove', onHudMove, true);
      doc?.removeEventListener?.('pointerup', onHudUp, true);
      try {
        const box = hud.getBoundingClientRect();
        const stageBox = stage?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
        doc?.defaultView?.localStorage?.setItem(hudKey, JSON.stringify({
          left: box.left - stageBox.left,
          top: box.top - stageBox.top,
        }));
      } catch {
        /* 忽略 */
      }
      event.preventDefault();
      event.stopPropagation();
    };
    hud.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      /* 点在按钮上就别拖，留给按钮自己处理 */
      if (event.target?.closest?.('.knest-hud-btn') !== null) return;
      const box = hud.getBoundingClientRect();
      const stageBox = stage?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      hudDrag = {
        startX: event.clientX,
        startY: event.clientY,
        originLeft: box.left - stageBox.left,
        originTop: box.top - stageBox.top,
      };
      hud.setAttribute('data-dragging', 'true');
      doc?.addEventListener?.('pointermove', onHudMove, true);
      doc?.addEventListener?.('pointerup', onHudUp, true);
    });

    stage = el('div', { class: 'knest-board-main' }, [world, hud]);
    /* 挂载时必须先藏起来：没有这个初始属性，隐藏规则匹配不上，HUD 会一直露在左下角。 */
    root = el('div', { class: 'knest-board', id: 'knest-board', 'data-open': 'false' }, [stage]);
    doc.addEventListener('pointerdown', onBoardPointerDown, true);
    doc.addEventListener('wheel', onWheel, { passive: false, capture: true });
    doc.addEventListener('keydown', onBoardKey, true);
    (doc.body ?? doc.documentElement).appendChild(root);
    applyView();
    return true;
  };

  /** 让某个节点落在（右栏）视口中央。 */
  const centerOn = (node) => {
    const view = doc?.defaultView;
    const box = (stage ?? root)?.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
    const vw = Number(box.width) || view?.innerWidth || 1280;
    const vh = Number(box.height) || view?.innerHeight || 800;
    const size = measure(node.id);
    panX = vw / 2 - (node.x + size.w / 2) * scale;
    panY = vh / 2 - (node.y + size.h / 2) * scale;
    /* 别把卡片顶到窗口外面：标题栏至少留 44px 在可视区（44 = 宿主标题栏高度量级） */
    const topLimit = 80;
    if (node.y * scale + panY < topLimit) panY = topLimit - node.y * scale;
    applyView();
  };


  /** 待执行的那一帧；null 表示当前帧没人排队。 */
  let dragFrame = null;

  function startNodeDrag(event, id) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const node = get(id);
    if (node === null) return;
    const group = selected.has(id) && selected.size > 1 ? [...selected] : [id];
    const stageTop = (stage ?? root)?.getBoundingClientRect?.()?.top ?? 0;
    drag = {
      kind: 'node',
      id,
      group,
      origins: group.map((item) => ({ id: item, x: get(item)?.x ?? 0, y: get(item)?.y ?? 0 })),
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      originX: node.x,
      originY: node.y,
      minScreenY: stageTop + 80,
    };
    root?.setAttribute('data-dragging', 'true');
    doc?.addEventListener?.('pointermove', onPointerMove, true);
    doc?.addEventListener?.('pointerup', onPointerUp, true);
  }

  /**
   * 平移。
   *
   * 画布现在是**透明层**（不吃鼠标事件），所以空白处直接拖行不通——
   * 改成 Alt+左键 或 中键 拖动，任何时候都能平移，且不影响下面的对话。
   * @param {PointerEvent} event - 指针事件。
   * @returns {void}
   */
  function onBoardPointerDown(event) {
    if (root === null || root.getAttribute('data-open') === 'false') return;
    const alt = event.altKey === true;
    const middle = event.button === 1;
    if (!alt && !middle) return;
    drag = { kind: 'pan', startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, originX: panX, originY: panY, minScreenY: null };
    root.setAttribute('data-dragging', 'true');
    doc?.addEventListener?.('pointermove', onPointerMove, true);
    doc?.addEventListener?.('pointerup', onPointerUp, true);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (drag === null) return;
    /* 只记住最新位置，真正的计算丢到下一帧做。
       原来的写法是每个 pointermove 都全量算一遍，高刷鼠标一秒能触发一百多次，
       再叠上 syncEdges 被调用两次，就成了肉眼可见的一顿一顿。 */
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (dragFrame !== null) return;
    dragFrame = (doc?.defaultView?.requestAnimationFrame ?? ((fn) => setTimeout(fn, 16)))(() => {
      dragFrame = null;
      applyDragFrame();
    });
  }

  /**
   * 按最新指针位置重排卡片。一帧只跑一次。
   * @returns {void}
   */
  function applyDragFrame() {
    if (drag === null) return;
    const dx = drag.lastX - drag.startX;
    const dy = drag.lastY - drag.startY;

    if (drag.kind === 'pan') {
      panX = drag.originX + dx;
      panY = drag.originY + dy;
      applyView();
      return;
    }

    const node = get(drag.id);
    if (node === null) return;

    const stepX = dx / scale;
    const stepY = dy / scale;
    /* 顶部禁区的世界坐标下界，拖动开始时就算好，不必每帧重新量 DOM */
    const minWorldY = drag.minScreenY === null ? null : (drag.minScreenY - panY) / scale;

    for (const origin of drag.origins ?? [{ id: drag.id, x: drag.originX, y: drag.originY }]) {
      const target = get(origin.id);
      if (target === null) continue;
      /* 不再磁吸：以前按 12px 取整，拖起来是跳格的。现在跟手就是一像素一像素走。 */
      let nextX = origin.x + stepX;
      let nextY = origin.y + stepY;
      if (minWorldY !== null && nextY < minWorldY) nextY = minWorldY;
      target.x = nextX;
      target.y = nextY;
      positionNode(target);
    }
    /* 全组位置都定了再连一次线；原来是边改边连、还连了两遍 */
    syncEdges();
  }

  function onPointerUp() {
    if (drag === null) return;
    if (dragFrame !== null) {
      (doc?.defaultView?.cancelAnimationFrame ?? clearTimeout)(dragFrame);
      dragFrame = null;
      applyDragFrame();
    }
    const draggedId = drag.kind === 'node' ? drag.id : null;
    drag = null;
    if (draggedId !== null) {
      const node = get(draggedId);
      const element = elements.get(draggedId);
      const stageBox = (stage ?? root)?.getBoundingClientRect?.() ?? null;
      const box = element?.getBoundingClientRect?.() ?? null;
      if (node !== null && stageBox !== null && box !== null && box.top < (stageBox.top ?? 0)) {
        node.y += Math.ceil(((stageBox.top ?? 0) - box.top + 40) / scale);
        positionNode(node);
        syncEdges();
        notify();
      }
    }
    root?.removeAttribute('data-dragging');
    doc?.removeEventListener?.('pointermove', onPointerMove, true);
    doc?.removeEventListener?.('pointerup', onPointerUp, true);
  }

  /**
   * 缩放到指定倍率。
   * @param {number} next - 目标倍率（会被夹到 SCALE_MIN..SCALE_MAX）。
   * @param {{x?:number,y?:number}|null} [anchor] - 视口坐标锚点，缺省用视口中心。
   * @returns {void}
   */
  const zoomTo = (next, anchor = null) => {
    if (root === null) return;
    const clamped = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Number(next) || 1));
    if (Math.abs(clamped - scale) < 0.001) return;
    const host = stage ?? root;
    const rect = typeof host.getBoundingClientRect === 'function' ? host.getBoundingClientRect() : { left: 0, top: 0 };
    const view = doc?.defaultView;
    const px = (anchor?.x ?? (view?.innerWidth ?? 1280) / 2) - (rect.left ?? 0);
    const py = (anchor?.y ?? (view?.innerHeight ?? 800) / 2) - (rect.top ?? 0);
    panX = px - ((px - panX) / scale) * clamped;
    panY = py - ((py - panY) / scale) * clamped;
    scale = clamped;
    applyView();
  };

  /**
   * 相对缩放。
   * @param {number} factor - 倍率因子。
   * @returns {void}
   */
  const zoomBy = (factor) => zoomTo(scale * (Number(factor) || 1));

  function onWheel(event) {
    if (root === null) return;
    const target = event.target;
    /* 画布透明层：默认让滚轮去滚页面；只有按住 Ctrl/⌘ 才缩放卡片 */
    if (event.ctrlKey !== true && event.metaKey !== true) return;
    const inside = target === root || (typeof root.contains === 'function' && root.contains(target));
    if (!inside) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = typeof root.getBoundingClientRect === 'function'
      ? root.getBoundingClientRect()
      : { left: 0, top: 0 };
    const px = (event.clientX ?? 0) - (rect.left ?? 0);
    const py = (event.clientY ?? 0) - (rect.top ?? 0);
    const next = Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale * Math.exp(-(event.deltaY ?? 0) * 0.0012)));
    /* 让光标下的世界坐标保持不动 */
    panX = px - ((px - panX) / scale) * next;
    panY = py - ((py - panY) / scale) * next;
    scale = next;
    applyView();
  }

  /**
   * 画布开着时的快捷键（输入框里放行）。
   * @param {KeyboardEvent} event - 键盘事件。
   * @returns {void}
   */
  function onBoardKey(event) {
    if (root === null || root.getAttribute('data-open') === 'false') return;
    const tag = String(event.target?.tagName ?? '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable === true) return;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.2); return; }
    if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomBy(1 / 1.2); return; }
    if (event.key === '0') { event.preventDefault(); zoomTo(1); }
  }

  const toggleCollapse = (id) => {
    const node = get(id);
    if (node === null) return;
    node.collapsed = node.collapsed !== true;
    elements.get(id)?.setAttribute('data-collapsed', node.collapsed === true ? 'true' : 'false');
    syncEdges();
    notify();
  };

  /**
   * 加节点（内部用）。
   * @param {{id:string, text:string, x:number, y:number, parentId:string|null, model?:object}} input - 参数。
   * @returns {object|null} 节点记录。
   */
  const addNode = (input) => {
    if (!ensureShell()) return null;
    if (indexOf(input.id) >= 0) return get(input.id);
    /* 同一句话只出现一次：已经有同文本的节点就复用它（否则画布上会出现一模一样的两个框）。 */
    const twin = input.allowTwin === true ? undefined : nodes.find((node) => node.text === String(input.text ?? ''));
    if (twin !== undefined) return twin;
    const parentId = input.parentId ?? null;
    const parent = parentId === null ? null : get(parentId);
    if (parentId !== null && parent === null) return null;
    const depth = parent === null ? 0 : depthOf(nodes, parent.id) + 1;
    if (depth > MAX_LEVELS - 1) return null;

    const node = {
      id: input.id,
      text: String(input.text ?? ''),
      x: Number(input.x) || 0,
      y: Number(input.y) || 0,
      parentId,
      depth,
      model: input.model ?? { pending: true },
      collapsed: false,
    };
    nodes.push(node);
    const section = buildNode(node);
    elements.set(node.id, section);
    nodeLayer.appendChild(section);
    positionNode(node);
    measure(node.id);
    syncEdges();
    notify();
    return node;
  };

  const remove = (id) => {
    const targets = descendantsOf(nodes, id);
    for (const target of targets) {
      const element = elements.get(target);
      if (element !== undefined && element.parentNode !== null) element.parentNode.removeChild(element);
      elements.delete(target);
      sizes.delete(target);
    }
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      if (targets.includes(nodes[i].id)) nodes.splice(i, 1);
    }
    syncEdges();
    notify();
    if (nodes.length === 0) hide();
    return targets.length;
  };

  const clearAll = () => {
    for (const element of elements.values()) {
      if (element.parentNode !== null) element.parentNode.removeChild(element);
    }
    elements.clear();
    sizes.clear();
    nodes.length = 0;
    syncEdges();
    hide();
    try {
      onClear?.();
    } catch {
      /* 忽略 */
    }
  };

  const show = () => {
    root?.setAttribute('data-open', 'true');
  };
  const hide = () => {
    root?.setAttribute('data-open', 'false');
  };

  return {
    /** 节点数组（只读视图，测试与调试用）。 */
    nodes,
    /**
     * 挂载外壳（幂等）。
     * @returns {void}
     */
    mount() {
      ensureShell();
    },
    /**
     * 开根节点（画布中心）。
     * @param {{id:string, text:string, model?:object}} input - 参数。
     * @returns {object|null} 节点。
     */
    openRoot(input) {
      const existing = get(input.id);
      if (existing !== null) {
        existing.text = input.text;
        existing.model = input.model ?? existing.model;
        refreshNode(existing);
        show();
            return existing;
      }
      const node = addNode({ id: input.id, text: input.text, x: 0, y: 0, parentId: null, model: input.model });
      if (node !== null) {
        show();
        centerOn(node);
          }
      return node;
    },
    /**
     * 在某节点下挂子节点（自动挑位置）。
     * @param {string} parentId - 父节点 id。
     * @param {{id:string, text:string, model?:object}} input - 子节点。
     * @returns {object|null} 节点；超出层数返回 null。
     */
    addChild(parentId, input) {
      const parent = get(parentId);
      if (parent === null) return null;
      if (parent.depth >= MAX_LEVELS - 1) return null;
      if (get(input.id) !== null) return get(input.id);
      const index = nodes.filter((node) => node.parentId === parentId).length;
      const spot = placeChild(nodes, parent, measure(parentId), index);
      const node = addNode({ id: input.id, text: input.text, x: spot.x, y: spot.y, parentId, model: input.model });
      if (node !== null) show();
      return node;
    },
    /**
     * 换内容（pending → 结果）。
     * @param {string} id - 节点 id。
     * @param {object} model - 卡片模型。
     * @returns {void}
     */
    update(id, model) {
      const node = get(id);
      if (node === null) return;
      node.model = model;
      refreshNode(node);
      syncEdges();
      },
    /**
     * 移动节点（拖拽内部用，测试也直接用）。
     * @param {string} id - 节点 id。
     * @param {number} x - 世界坐标 x。
     * @param {number} y - 世界坐标 y。
     * @returns {void}
     */
    move(id, x, y) {
      const node = get(id);
      if (node === null) return;
      node.x = Math.round(Number(x) || 0);
      node.y = Math.round(Number(y) || 0);
      positionNode(node);
      syncEdges();
    },
    /**
     * 读某条连线的 `d`（测试用：父 → 子）。
     * @param {string} parentId - 父 id。
     * @param {string} childId - 子 id。
     * @returns {string} path 的 d 属性；没有返回空串。
     */
    edgePath(parentId, childId) {
      if (edgeLayer === null) return '';
      for (const child of edgeLayer.children ?? []) {
        if (child.getAttribute?.('data-from') === parentId && child.getAttribute?.('data-to') === childId) {
          return child.getAttribute('d') ?? '';
        }
      }
      return '';
    },
    /**
     * 按文本找节点。
     * @param {string} text - 节点标题。
     * @returns {object|null} 节点。
     */
    findByText(text) {
      const wanted = String(text ?? '');
      return nodes.find((node) => node.text === wanted) ?? null;
    },
    /**
     * 当前画布快照（供持久化）。
     * @returns {{nodes:object[], view:{panX:number, panY:number, scale:number}}} 快照。
     */
    snapshot() {
      return {
        nodes: nodes.map((node) => ({
          id: node.id,
          text: node.text,
          x: node.x,
          y: node.y,
          parentId: node.parentId,
          collapsed: node.collapsed === true,
          model: node.model,
        })),
        view: { panX, panY, scale },
      };
    },
    /**
     * 从快照恢复（先清空）。
     * @param {object} snap - 快照。
     * @returns {number} 恢复的节点数。
     */
    restore(snap) {
      const list = Array.isArray(snap?.nodes) ? snap.nodes : [];
      clearAll();
      for (const item of list) {
        if (item === null || typeof item !== 'object' || typeof item.id !== 'string') continue;
        const created = addNode({
          id: item.id,
          text: item.text,
          x: Number(item.x) || 0,
          y: Number(item.y) || 0,
          parentId: item.parentId ?? null,
          model: item.model ?? {},
          allowTwin: true,
        });
        if (created !== null && item.collapsed === true) toggleCollapse(created.id);
      }
      const view = snap?.view;
      if (view !== null && typeof view === 'object') {
        if (Number.isFinite(view.panX)) panX = view.panX;
        if (Number.isFinite(view.panY)) panY = view.panY;
        if (Number.isFinite(view.scale)) scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, view.scale));
        applyView();
      }
      if (nodes.length > 0) show();
      return nodes.length;
    },
    /** 相对缩放（供 HUD 与快捷键调用）。 */
    zoomBy,
    /** 绝对缩放。 */
    zoomTo,
    /**
     * 当前视口参数（测试与调试用）。
     * @returns {{scale:number, panX:number, panY:number}} 视口。
     */
    view() {
      return { scale, panX, panY };
    },
    /** 当前选中的节点 id。 */
    selectedIds() {
      return [...selected];
    },
    /** 清空选中。 */
    clearSelection() {
      for (const id of selected) elements.get(id)?.setAttribute('data-selected', 'false');
      selected.clear();
    },
    /** 删掉选中的所有节点（各自连带后代）。 */
    removeSelected() {
      const ids = [...selected];
      selected.clear();
      for (const id of ids) remove(id);
      return ids.length;
    },
    /** 折叠/展开。 */
    toggleCollapse,
    /** 删节点（连带后代）。 */
    remove,
    /** 清空画布。 */
    clear: clearAll,
    /**
     * 当前有几个节点。
     * @returns {number} 数量。
     */
    count() {
      return nodes.length;
    },
    /** 重算连线（尺寸变化后手动调）。 */
    sync: syncEdges,
    /** 显示/隐藏。 */
    show,
    hide,
    /**
     * 卸载。
     * @returns {void}
     */
    dispose() {
      onPointerUp();
      clearAll();
      if (root !== null && root.parentNode !== null) {
        try {
          root.parentNode.removeChild(root);
        } catch {
          /* 忽略 */
        }
      }
      doc?.removeEventListener?.('pointerdown', onBoardPointerDown, true);
      doc?.removeEventListener?.('wheel', onWheel, true);
      doc?.removeEventListener?.('keydown', onBoardKey, true);
      root = null;
      world = null;
      stage = null;
      edgeLayer = null;
      nodeLayer = null;
      hud = null;
    },
  };
}


/* ===== client/styles.js ===== */
/**
 * 样式：一次注入，原地替换。
 *
 * 方向：**深海声呐 / 等深线**。插件做的是「在一段对话里给一个词定位」，
 * 声呐的语法正好是它：一条时间轴、一次回波、一个被钉住的点。
 *
 * 两条硬约束（都是线上踩出来的）：
 *  1) 底色/字色**不依赖宿主变量**：白底白字曾经让气泡整块看不见；
 *  2) 高亮色必须挂在 `<html data-knest-theme>` 上——`::highlight()` 拿的是
 *     被高亮文字的变量，插件容器里的私有变量够不着。
 *
 * 刻意避开的默认：圆角卡片 + 统一柔阴影、近黑底 + 酸性绿、全大写小标签、
 * 以「·」拼接的元信息串、装饰性的逐段淡入。
 */

/** 样式版本号：写进 style 标签，方便一眼确认浏览器里跑的是哪一版。 */
const KNEST_STYLE_REV = 'r2';

/** 样式正文。 */
const KNEST_CSS = [
  /* ── 令牌：挂在 html 上，供 ::highlight 与浮层共用 ───────────────── */
  'html[data-knest-theme="dark"]{--kn-bg:var(--dsw-alias-bg-base,#070E18);--kn-panel:var(--dsw-alias-bg-layer-1,#0B1624);--kn-rule:var(--dsw-alias-border-l2,#182636);--kn-ink:var(--dsw-alias-label-primary,#E6EEF8);--kn-mute:var(--dsw-alias-label-tertiary,#7C8DA3);--kn-signal:#6A84FF;--kn-echo:#46E0A4;--kn-echo-soft:rgba(70,224,164,.17);--kn-warn:#FFB877;--kn-domain:#E8A33D;--kn-domain-soft:rgba(232,163,61,.18);--kn-shadow:0 22px 60px rgba(0,0,0,.62),0 2px 0 rgba(255,255,255,.04) inset}',
  'html[data-knest-theme="light"]{--kn-bg:var(--dsw-alias-bg-base,#EFF3F6);--kn-panel:var(--dsw-alias-bg-layer-1,#FFFFFF);--kn-rule:var(--dsw-alias-border-l2,#C9D5DE);--kn-ink:var(--dsw-alias-label-primary,#0B1721);--kn-mute:var(--dsw-alias-label-tertiary,#56687A);--kn-signal:#2038B8;--kn-echo:#04724A;--kn-echo-soft:rgba(4,114,74,.14);--kn-warn:#96480A;--kn-domain:#B26A00;--kn-domain-soft:rgba(178,106,0,.14);--kn-shadow:0 1px 0 rgba(11,23,33,.05),0 12px 30px rgba(11,23,33,.14)}',

  /* ── 绿色高亮：宿主正文与插件正文同一套 ─────────────────────────── */
  '::highlight(knest-echo){background-color:var(--kn-echo-soft);color:var(--kn-echo);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}',
  '.knest-mark{background:var(--kn-echo-soft);color:var(--kn-echo);text-decoration:underline;text-underline-offset:3px}',
  /* 同领域标记：橙色，和绿高亮用两个不同的高亮名，互不覆盖 */
  '::highlight(knest-domain){background-color:var(--kn-domain-soft);color:var(--kn-domain);text-decoration:underline;text-decoration-color:var(--kn-domain);text-underline-offset:3px}',

  /* ── 地图舞台 ─────────────────────────────────────────────────── */
  '.knest-stage{position:relative;min-height:100%;box-sizing:border-box;padding:0 0 44px;background:var(--kn-bg);color:var(--kn-ink);font-size:13px;line-height:1.6;overflow:hidden;isolation:isolate}',
  '.knest-stage::before{content:"";position:absolute;inset:-60px;z-index:0;pointer-events:none}',
  /* 暗色：等深线（同心环）+ 顶部微微发蓝，60 秒漂一格，慢到不像动画；只在右上角显形 */
  'html[data-knest-theme="dark"] .knest-stage::before{background-image:repeating-radial-gradient(circle at 84% -8%,rgba(106,132,255,.14) 0 1px,transparent 1px 32px),linear-gradient(180deg,rgba(106,132,255,.07),transparent 46%);-webkit-mask-image:radial-gradient(120% 82% at 86% 0%,#000 0%,rgba(0,0,0,.35) 46%,transparent 66%);mask-image:radial-gradient(120% 82% at 86% 0%,#000 0%,rgba(0,0,0,.35) 46%,transparent 66%);animation:knest-depth 60s ease-in-out infinite alternate}',
  /* 亮色：24px 细网格 + 两道很淡的水面光斑，横向漂 */
  'html[data-knest-theme="light"] .knest-stage::before{background-image:linear-gradient(90deg,rgba(11,23,33,.05) 0 1px,transparent 1px 24px),linear-gradient(0deg,rgba(11,23,33,.05) 0 1px,transparent 1px 24px),linear-gradient(104deg,transparent 42%,rgba(4,114,74,.05) 46%,transparent 50%,rgba(32,56,184,.045) 62%,transparent 66%);background-size:24px 24px,24px 24px,auto,auto;animation:knest-caustic 74s linear infinite alternate}',
  '.knest-stage > *{position:relative;z-index:1}',

  /* ── 顶部（吸顶细栏，不是卡片） ─────────────────────────────────── */
  '.knest-rail{position:sticky;top:0;z-index:3;display:flex;align-items:baseline;gap:10px;padding:15px 20px 12px;background:linear-gradient(var(--kn-bg) 74%,transparent)}',
  '.knest-rail h2{margin:0;font-size:13px;font-weight:600;letter-spacing:.03em}',
  '.knest-fig{font-size:12px;color:var(--kn-mute);font-variant-numeric:tabular-nums}',
  '.knest-lead-in{margin:2px 20px 10px;font-size:12px;line-height:1.7;color:var(--kn-mute);max-width:52ch}',
  '.knest-key{border:0;background:none;color:var(--kn-signal);font:inherit;font-size:12px;padding:0;cursor:pointer;text-underline-offset:3px;text-decoration:underline;text-decoration-thickness:1px}',
  '.knest-key:hover{text-decoration-thickness:2px}',

  /* ── 图 ──────────────────────────────────────────────────────── */
  '.knest-map{position:relative;margin:0 20px;max-width:640px}',
  '.knest-svg{position:absolute;inset:0;overflow:visible;pointer-events:none}',
  '.knest-role-mark{position:absolute;left:0;transform:translateY(-50%);font-size:9px;line-height:1;color:var(--kn-mute);opacity:.5;pointer-events:none}',
  '.knest-role-mark[data-role="you"]{color:var(--kn-signal);opacity:.7}',
  '.knest-svg line{stroke:var(--kn-rule);stroke-width:1;shape-rendering:crispEdges}',
  '.knest-svg line[data-kind="spine"]{stroke:var(--kn-rule)}',
  '.knest-svg line[data-kind="tick-you"]{stroke:var(--kn-signal);opacity:.55}',
  '.knest-svg line[data-kind="tick-ai"]{stroke:var(--kn-mute);opacity:.3}',
  '.knest-svg line[data-kind="stem"]{stroke:var(--kn-rule);stroke-dasharray:2 3}',
  '.knest-svg line[data-kind="branch"]{stroke:var(--kn-rule)}',
  '.knest-svg line[data-kind="same"]{stroke:var(--kn-signal);opacity:.42}',

  '.knest-point{position:absolute;display:inline-flex;align-items:center;gap:7px;max-width:min(60vw,320px);padding:3px 6px 3px 0;margin:0;border:0;background:none;color:var(--kn-ink);font:inherit;font-size:12.5px;line-height:1.3;text-align:left;cursor:pointer;transform:translateY(-50%);border-radius:2px}',
  '.knest-point:focus-visible{outline:1px solid var(--kn-signal);outline-offset:2px}',
  '.knest-ring-dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;border:1px solid var(--kn-echo);background:transparent;transition:background .16s ease,box-shadow .16s ease}',
  '.knest-point[data-explained="true"] .knest-ring-dot{background:var(--kn-echo)}',
  '.knest-point[data-pending="true"] .knest-ring-dot{animation:knest-pulse 1.4s ease-in-out infinite}',
  '.knest-point:hover .knest-ring-dot,.knest-point[data-active="true"] .knest-ring-dot{box-shadow:0 0 0 3px var(--kn-echo-soft)}',
  '.knest-point .knest-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.knest-point .knest-times{font-size:11px;color:var(--kn-mute);font-variant-numeric:tabular-nums}',
  '.knest-point[data-active="true"] .knest-label{color:var(--kn-echo)}',

  /* ── 空态 ────────────────────────────────────────────────────── */
  '.knest-blank{margin:26px 20px;max-width:46ch;color:var(--kn-mute);font-size:12.5px;line-height:1.85}',
  '.knest-blank b{color:var(--kn-ink);font-weight:600}',
  '.knest-steps{margin:12px 0 0;padding:0;list-style:none;counter-reset:knest-step}',
  '.knest-steps li{counter-increment:knest-step;position:relative;padding-left:24px;margin-bottom:6px}',
  '.knest-steps li::before{content:counter(knest-step) ".";position:absolute;left:0;top:0;color:var(--kn-echo);font-variant-numeric:tabular-nums;font-weight:600}',

  /* ── 浮层根：不挡点击 ─────────────────────────────────────────── */
  '#knest-echo-layer{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:inherit}',

  /* 声呐环：只在"刚圈住"的一瞬出现 */
  '.knest-sonar{position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:1px solid var(--kn-echo);opacity:.7;animation:knest-sonar 620ms cubic-bezier(.16,.72,.24,1) forwards}',
  '.knest-sonar:nth-of-type(2){animation-delay:110ms}',

  '.knest-head{display:flex;align-items:flex-start;gap:8px;padding:14px 15px 9px}',
  '.knest-phrase{margin:0;font-family:"Songti SC","Noto Serif SC","Source Han Serif SC",Georgia,serif;font-size:19px;line-height:1.36;font-weight:500;letter-spacing:.01em;overflow-wrap:anywhere}',
  '.knest-kind{flex:0 0 auto;margin-left:auto;font-size:10.5px;line-height:16px;color:var(--kn-mute);border:1px solid var(--kn-rule);padding:0 5px}',
  '.knest-x{flex:0 0 auto;width:20px;height:20px;border:0;background:none;color:var(--kn-mute);font-size:15px;line-height:1;cursor:pointer;padding:0}',
  '.knest-x:hover{color:var(--kn-echo)}',
  '.knest-body{padding:12px 15px 13px}',
  '.knest-here{margin:0 0 11px;font-size:15px;line-height:1.74;letter-spacing:.004em;overflow-wrap:anywhere}',
  '.knest-hr{height:1px;background:var(--kn-rule);margin:11px -15px}',
  '.knest-h{margin:0 0 6px;font-size:11px;font-weight:600;color:var(--kn-mute);letter-spacing:.06em}',
  '.knest-list{margin:0;padding:0;list-style:none}',
  '.knest-list li{margin:0 0 8px;overflow-wrap:anywhere}',
  '.knest-list li:last-child{margin-bottom:0}',
  '.knest-quote{display:block;color:var(--kn-ink);opacity:.94}',
  '.knest-quote::before{content:"\\201C";color:var(--kn-echo)}',
  '.knest-quote::after{content:"\\201D";color:var(--kn-echo)}',
  '.knest-why{display:block;color:var(--kn-mute);font-size:12px;margin-top:1px}',
  '.knest-alt{color:var(--kn-ink)}',
  '.knest-alt-note{color:var(--kn-mute);font-size:12px}',
  '.knest-tree>li{margin-bottom:7px}',
  '.knest-node{display:flex;gap:6px;color:var(--kn-ink)}',
  '.knest-node::before{content:"";flex:0 0 auto;width:5px;height:5px;margin-top:7px;border:1px solid var(--kn-signal);transform:rotate(45deg)}',
  '.knest-kids{margin:4px 0 0 2px;padding:0 0 0 12px;list-style:none;border-left:1px solid var(--kn-rule)}',
  '.knest-kids li{position:relative;padding-left:9px;margin-bottom:4px;color:var(--kn-mute);font-size:12px}',
  '.knest-kids li::before{content:"";position:absolute;left:-12px;top:8px;width:9px;height:1px;background:var(--kn-rule)}',
  '.knest-foot{display:flex;align-items:center;gap:8px;padding:8px 15px 10px;border-top:1px solid var(--kn-rule);font-size:11px;color:var(--kn-mute);font-variant-numeric:tabular-nums}',
  '.knest-foot .knest-gap{flex:1}',
  '.knest-conf{display:inline-flex;gap:2px;align-items:center}',
  '.knest-conf i{width:3px;height:8px;background:var(--kn-rule)}',
  '.knest-conf i[data-on="true"]{background:var(--kn-echo)}',
  '.knest-conf[data-tone="low"] i[data-on="true"]{background:var(--kn-warn)}',
  '.knest-retry{border:1px solid var(--kn-rule);background:none;color:var(--kn-ink);font:inherit;font-size:11.5px;padding:2px 8px;cursor:pointer}',
  '.knest-retry:hover{border-color:var(--kn-echo);color:var(--kn-echo)}',

  /* 计算中：一条扫过的线，比转圈诚实 */
  '.knest-scan{position:relative;height:2px;background:var(--kn-rule);overflow:hidden;margin:2px 0 10px}',
  '.knest-scan::after{content:"";position:absolute;inset:0;background:var(--kn-echo);transform:translateX(-100%);animation:knest-sweep 1.15s cubic-bezier(.5,0,.5,1) infinite}',
  '.knest-skel{height:9px;background:var(--kn-rule);opacity:.55;margin-bottom:7px}',
  '.knest-skel[data-w="84"]{width:84%}',
  '.knest-skel[data-w="62"]{width:62%}',

  /* ── 「启用圈词」竖牌（贴右侧边缘） ───────────────────────────── */
  '#knest-switch[data-hidden="true"]{display:none}',
  '#knest-switch{position:fixed;right:44px;top:22%;z-index:2147482999;pointer-events:auto}',
  '.knest-toast{position:fixed;right:56px;top:calc(38% - 8px);max-width:min(340px,60vw);padding:7px 11px;background:var(--kn-panel);border:1px solid var(--kn-rule);box-shadow:var(--kn-shadow);color:var(--kn-ink);font-size:12px;line-height:1.55;overflow-wrap:anywhere;pointer-events:none;z-index:2147483007;opacity:0;transform:translateX(6px);transition:opacity .16s ease,transform .16s ease}',
  '.knest-toast[data-show="true"]{opacity:1;transform:none}',
  /* 拖动时的字数提示：贴在指针旁，告诉用户已经选中多少字 */
  '.knest-drag-hint{position:fixed;z-index:2147483006;padding:4px 9px;border-radius:999px;border:1px solid var(--kn-echo);background:var(--kn-panel);color:var(--kn-echo);font-size:11px;line-height:1.5;font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.28);opacity:0;transform:translateY(-3px);transition:opacity .12s ease,transform .12s ease}',
  '.knest-drag-hint[data-show="true"]{opacity:1;transform:none}',
  /* 设置面板：注入到宿主页面里的配置浮层 */
  '.knest-gear{position:fixed;right:18px;bottom:18px;z-index:2147483005;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid var(--kn-rule);background:var(--kn-panel);color:var(--kn-mute);font-size:15px;line-height:1;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.28);transition:color .15s ease,border-color .15s ease,transform .15s ease}',
  '.knest-gear:hover{color:var(--kn-ink);border-color:var(--kn-echo);transform:rotate(35deg)}',
  /* 右侧竖条入口：贴在窗口右边缘，比角落小圆点显眼得多 */
  '.knest-edge-tab{position:fixed;right:2px;top:34%;z-index:2147483005;display:flex;align-items:center;justify-content:center;padding:18px 8px;border:1px solid var(--kn-echo);border-right:0;border-radius:11px 0 0 11px;background:color-mix(in srgb,var(--kn-echo) 14%,var(--kn-panel));color:var(--kn-echo);cursor:pointer;font:inherit;box-shadow:-2px 0 16px rgba(0,0,0,.28);transition:padding .18s ease,background .18s ease}',
  '.knest-edge-tab:hover{padding-right:14px;background:color-mix(in srgb,var(--kn-echo) 24%,var(--kn-panel))}',
  '.knest-edge-tab[data-open="true"]{color:var(--kn-echo);border-color:var(--kn-echo)}',
  '.knest-edge-tab span{display:block;writing-mode:vertical-rl;text-orientation:mixed;letter-spacing:.26em;font-size:11.5px;line-height:1;white-space:nowrap}',
  '.knest-edge-tab[data-alert="1"]::after{content:"";position:absolute;top:8px;right:7px;width:7px;height:7px;border-radius:50%;background:#ff6b6b;box-shadow:0 0 0 3px rgba(255,107,107,.22);animation:knest-pulse 1.8s ease-in-out infinite}',
  '@keyframes knest-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
  '.knest-settings{position:fixed;right:18px;bottom:62px;width:352px;max-height:calc(100vh - 110px);overflow:auto;z-index:2147483004;background:var(--kn-panel);border:1px solid var(--kn-rule);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.42);color:var(--kn-ink);font-size:12.5px;line-height:1.6;padding:14px 16px 16px;display:none}',
  '.knest-settings[data-open="true"]{display:block}',
  '.knest-set-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}',
  '.knest-set-head b{font-size:13px;font-weight:600}',
  '.knest-set-x{background:transparent;border:0;color:var(--kn-mute);font-size:17px;line-height:1;cursor:pointer;padding:2px 4px}',
  '.knest-set-x:hover{color:var(--kn-ink)}',
  '.knest-set-status{background:rgba(127,127,127,.08);border:1px solid var(--kn-rule);border-radius:8px;padding:8px 10px;margin-bottom:12px;font-size:11.5px}',
  '.knest-set-status b{color:var(--kn-echo);font-weight:500}',
  '.knest-set-path{color:var(--kn-mute);font-size:10.5px;overflow-wrap:anywhere;margin-top:4px}',
  '.knest-set-presets{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:12px}',
  '.knest-set-presets button{text-align:left;background:transparent;border:1px solid var(--kn-rule);border-radius:8px;padding:7px 9px;cursor:pointer;color:var(--kn-ink);font:inherit;transition:border-color .15s ease}',
  '.knest-set-presets button:hover{border-color:var(--kn-echo)}',
  '.knest-set-presets button[data-on="1"]{border-color:var(--kn-echo);background:var(--kn-echo-soft)}',
  '.knest-set-presets b{display:block;font-size:12px;font-weight:600;margin-bottom:1px}',
  '.knest-set-presets span{display:block;color:var(--kn-mute);font-size:10.5px;line-height:1.45}',
  '.knest-set-fields label{display:block;margin-bottom:9px;color:var(--kn-mute);font-size:11px}',
  '.knest-set-fields input{width:100%;margin-top:3px;background:rgba(0,0,0,.22);border:1px solid var(--kn-rule);border-radius:7px;color:var(--kn-ink);padding:6px 8px;font:inherit;font-size:12px;outline:none}',
  '.knest-set-fields input:focus{border-color:var(--kn-echo)}',
  '.knest-set-key-row[data-optional="1"]{opacity:.6}',
  '.knest-set-actions{display:flex;gap:8px;margin-top:4px}',
  '.knest-set-actions button{flex:1;border-radius:8px;padding:7px 10px;font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--kn-rule);background:transparent;color:var(--kn-ink)}',
  '.knest-set-actions button.knest-set-save{background:var(--kn-echo);border-color:var(--kn-echo);color:#08130d;font-weight:600}',
  '.knest-set-actions button:disabled{opacity:.5;cursor:default}',
  '.knest-set-msg{margin-top:10px;font-size:11.5px;white-space:pre-wrap;word-break:break-all;display:none}',
  '.knest-set-msg[data-kind="ok"]{display:block;color:var(--kn-echo)}',
  '.knest-set-msg[data-kind="bad"]{display:block;color:#ff6b6b}',
  '.knest-switch-btn{display:flex;flex-direction:column;align-items:center;gap:9px;padding:13px 4px;background:var(--kn-panel);color:var(--kn-mute);border:1px solid var(--kn-rule);border-radius:0;cursor:pointer;font:inherit;transition:transform .16s ease,color .16s ease,border-color .16s ease}',
  '.knest-switch-btn:hover{transform:translateX(-3px);color:var(--kn-ink);border-color:var(--kn-signal)}',
  '.knest-switch-btn:focus-visible{outline:1px solid var(--kn-signal);outline-offset:-3px}',
  '.knest-switch-text{writing-mode:vertical-rl;text-orientation:mixed;letter-spacing:.22em;font-size:10.5px;line-height:1}',
  '.knest-switch-dot{width:7px;height:7px;border-radius:50%;border:1px solid var(--kn-mute);background:transparent;transition:background .16s ease,box-shadow .16s ease}',
  '#knest-switch[data-on="true"] .knest-switch-text{color:var(--kn-ink)}',
  '#knest-switch[data-on="true"] .knest-switch-dot{background:var(--kn-echo);border-color:var(--kn-echo);box-shadow:0 0 0 3px var(--kn-echo-soft)}',
  '#knest-switch[data-on="false"] .knest-switch-btn{border-style:dashed;opacity:.72}',

  /* ── 右键菜单（关掉圈词时用） ─────────────────────────────────── */
  '#knest-menu-layer{position:fixed;inset:0;z-index:2147483001;pointer-events:none}',
  '.knest-menu{position:absolute;pointer-events:auto;min-width:176px;padding:5px;background:var(--kn-panel);color:var(--kn-ink);border:1px solid var(--kn-rule);box-shadow:var(--kn-shadow);font-size:12.5px;line-height:1.5}',
  '.knest-mi{display:flex;align-items:center;gap:9px;width:100%;padding:6px 8px;border:0;background:none;color:var(--kn-ink);font:inherit;text-align:left;cursor:pointer}',
  '.knest-mi:hover:not(:disabled){background:var(--kn-echo-soft)}',
  '.knest-mi:disabled{opacity:.36;cursor:default}',
  '.knest-mi svg{flex:0 0 auto}',
  '.knest-mi-label{flex:1}',
  '.knest-mi-hint{font-size:10.5px;color:var(--kn-mute);font-variant-numeric:tabular-nums}',
  '.knest-mi[data-action="query"] .knest-mi-label{color:var(--kn-echo)}',
  '.knest-mdiv{height:1px;background:var(--kn-rule);margin:4px 6px}',
  '.knest-mi-lead{color:var(--kn-mute)}',
  '.knest-mi-more{color:var(--kn-signal)}',
  '.knest-menu[data-page] .knest-mi{animation:knest-menu-in .12s ease-out both}',

  /* ── 批注模式：红字 + 删除线 + 常驻气泡 ─────────────────────── */
  '::highlight(knest-note){color:#e0564a;text-decoration:line-through;text-decoration-thickness:1.5px;text-decoration-color:#e0564a}',
  '.knest-notes-layer{position:fixed;inset:0;z-index:2147483005;pointer-events:none}',
  'body[data-knest-annotate="true"]::after{content:"批注模式：拖过一段字就标红 · Esc 退出";position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:2147483010;padding:4px 12px;border-radius:999px;background:#e0564a;color:#fff;font:12px/1.6 inherit;pointer-events:none;box-shadow:0 2px 10px rgba(224,86,74,.35)}',
  '.knest-note-toggle{position:fixed;right:44px;top:calc(22% + 84px);z-index:2147482999;width:28px;padding:9px 0;border:1px solid var(--kn-rule);border-radius:8px;background:var(--kn-panel);color:var(--kn-mute);font:11px/1 inherit;letter-spacing:.16em;writing-mode:vertical-rl;letter-spacing:.18em;line-height:1;cursor:pointer}',
  '.knest-note-wipe{position:fixed;right:44px;top:calc(22% + 140px);z-index:2147482999;width:28px;padding:7px 0;border:1px solid var(--kn-rule);border-radius:8px;background:var(--kn-panel);color:var(--kn-mute);font:10px/1 inherit;writing-mode:vertical-rl;cursor:pointer;opacity:.8}',
  '.knest-note-wipe:hover{color:#e0564a;border-color:#e0564a;opacity:1}',
  '.knest-note-toggle[data-on="true"]{border-color:#e0564a;color:#e0564a}',
  '.knest-note-bubble[data-collapsed="true"]{max-width:220px}',
  '.knest-note-bubble[data-collapsed="true"] .knest-note-input{display:none}',
  '.knest-note-bubble[data-kind="strike"] .knest-note-input{opacity:.4;caret-color:transparent}',
  '.knest-note-bubble[data-submitted="true"]{opacity:.45;border-color:var(--kn-rule)}',
  '.knest-note-head{display:flex;align-items:center;gap:4px;flex:0 0 auto}',
  '.knest-note-kind{border:1px solid currentColor;background:none;color:#e0564a;font:10px/1.4 inherit;padding:0 4px;cursor:pointer;border-radius:3px}',
  '.knest-notes-clear{position:absolute;left:14px;top:14px;pointer-events:auto;padding:3px 9px;border:1px solid #e0564a;border-radius:999px;background:var(--kn-panel);color:#e0564a;font:11px/1.5 inherit;cursor:pointer;opacity:.7}',
  '.knest-notes-clear:hover{opacity:1}',
  '.knest-note-bubble{position:absolute;pointer-events:auto;display:flex;align-items:flex-start;gap:4px;padding:5px 6px;border:1px solid #e0564a;border-radius:6px;background:var(--kn-panel);box-shadow:var(--kn-shadow);max-width:320px}',
  '.knest-note-input{flex:1;min-width:120px;min-height:18px;border:0;background:none;color:var(--kn-ink);font:12px/1.5 inherit;resize:none;outline:none;overflow:hidden;caret-color:var(--kn-ink);cursor:text}',
  '.knest-note-del{flex:0 0 auto;width:18px;height:18px;border:0;background:none;color:var(--kn-mute);cursor:pointer;padding:0;font-size:13px;line-height:1}',
  '.knest-note-del:hover{color:#e0564a}',
  'body[data-knest-annotate="true"] .knest-switch-btn{border-color:#e0564a;color:#e0564a}',
  '.knest-pending{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:2147483646;padding:4px 12px;border-radius:999px;border:1px solid #e0564a;background:var(--kn-panel);color:#e0564a;font:11.5px/1.6 inherit;cursor:pointer}',
  '.knest-guide{position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:2147483647;max-width:min(640px,80vw);padding:10px 16px;border-radius:999px;border:1px solid var(--kn-rule);background:var(--kn-panel);color:var(--kn-ink);font:12.5px/1.7 inherit;box-shadow:0 8px 24px rgba(0,0,0,.3)}',
  /* ── 知识库面板（Ctrl+K 呼出） ─────────────────────────────── */
  '.knest-lib{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:flex-start;justify-content:center;padding-top:14vh;background:color-mix(in srgb,#000 42%,transparent)}',
  '.knest-lib-box{width:min(560px,86vw);max-height:64vh;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--kn-rule);border-radius:12px;background:var(--kn-panel);box-shadow:0 18px 50px rgba(0,0,0,.4)}',
  '.knest-lib-input{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid var(--kn-rule);background:none;color:var(--kn-ink);font:14px/1.6 inherit;padding:12px 14px;outline:none}',
  '.knest-lib-list{overflow:auto;padding:6px}',
  '.knest-lib-meta{padding:4px 8px 8px;font-size:11px;color:var(--kn-mute)}',
  '.knest-lib-row{display:grid;grid-template-columns:minmax(0,auto) minmax(0,1fr) auto;gap:8px;align-items:baseline;width:100%;text-align:left;border:0;border-radius:8px;background:none;color:var(--kn-ink);font:inherit;font-size:12.5px;padding:7px 9px;cursor:pointer}',
  '.knest-lib-row[data-active="true"],.knest-lib-row:hover{background:var(--kn-echo-soft)}',
  '.knest-lib-phrase{font-family:\"Songti SC\",\"Noto Serif SC\",Georgia,serif;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px}',
  '.knest-lib-lead{color:var(--kn-mute);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.knest-lib-tag{font-size:10px;color:var(--kn-echo);border:1px solid var(--kn-rule);border-radius:999px;padding:0 6px}',
  /* ── 圈词本 ──────────────────────────────────────────────── */
  '.knest-notes{margin:22px 20px 8px;max-width:640px;border-top:1px solid var(--kn-rule);padding-top:10px}',
  '.knest-notes-head{display:flex;align-items:baseline;gap:8px;margin-bottom:8px}',
  '.knest-notes-head h3{margin:0;font-size:12px;font-weight:600;letter-spacing:.04em}',
  '.knest-note-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px}',
  '.knest-note-list li{display:flex;align-items:flex-start;gap:6px;max-width:560px}',
  '.knest-note-open{flex:1;display:flex;flex-direction:column;gap:2px;padding:6px 8px;border:0;border-left:1px solid transparent;background:none;color:var(--kn-ink);font:inherit;text-align:left;cursor:pointer}',
  '.knest-note-open:hover{border-left-color:var(--kn-echo);background:var(--kn-echo-soft)}',
  '.knest-note-phrase{font-size:12.5px;color:var(--kn-echo)}',
  '.knest-note-lead{font-size:11.5px;color:var(--kn-mute);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
  '.knest-note-del{flex:0 0 auto;width:20px;height:20px;border:0;background:none;color:var(--kn-mute);cursor:pointer;font-size:14px;line-height:1}',
  '.knest-note-del:hover{color:#b4443c}',

  /* ── 设置面板 ────────────────────────────────────────────────── */
  '.knest-form{display:flex;flex-direction:column;gap:10px;font-size:13px;color:var(--kn-ink);max-width:60ch}',
  '.knest-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
  '.knest-row label{color:var(--kn-mute);font-size:12px}',
  '.knest-row input[type="text"],.knest-row select{background:var(--kn-panel);color:var(--kn-ink);border:1px solid var(--kn-rule);border-radius:0;padding:3px 6px;font:inherit;font-size:12.5px}',
  '.knest-note{color:var(--kn-mute);font-size:11.5px;line-height:1.65}',
  '.knest-ok{color:var(--kn-echo)}',
  '.knest-bad{color:var(--kn-warn)}',
  '.knest-input{flex:1;min-width:0;height:26px;padding:0 7px;border:1px solid var(--kn-rule);background:var(--kn-panel);color:var(--kn-ink);font:inherit;font-size:12px}',
  '.knest-input:focus{outline:none;border-color:var(--kn-echo)}',
  '.knest-rule{border:0;border-top:1px solid var(--kn-rule);margin:10px 0 8px}',
  '.knest-file-preview{margin:6px 0 0;padding:8px 10px;max-height:160px;overflow:auto;border:1px solid var(--kn-rule);background:var(--kn-echo-soft);color:var(--kn-ink);font:11.5px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}',
  '.knest-btn{border:1px solid var(--kn-rule);background:none;color:var(--kn-ink);font:inherit;font-size:12px;padding:3px 10px;cursor:pointer;border-radius:0}',
  '.knest-btn:hover{border-color:var(--kn-echo);color:var(--kn-echo)}',
  '.knest-btn:disabled{opacity:.45;cursor:default}',

  /* ── 知识树画布（取代原来的独立浮窗） ─────────────────────────── */
  '#knest-board{position:fixed;inset:0;z-index:2147483647;display:flex;overflow:visible;pointer-events:none;background:transparent}',
  '#knest-board[data-open="false"]{display:none}',
  '#knest-board[data-dragging="true"]{cursor:grabbing}',
  '.knest-board-main{position:relative;flex:1;min-width:0;min-height:0;overflow:visible;pointer-events:none}',
  '.knest-board-world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform;pointer-events:none}',
  '.knest-board-edges{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}',
  '.knest-edge{fill:none;stroke:color-mix(in srgb,var(--kn-ink) 46%,transparent);stroke-width:1.6}',
  '.knest-edge[data-orientation="horizontal"]{stroke:var(--kn-signal);opacity:.9;stroke-width:1.8}',
  '.knest-board-nodes{position:absolute;left:0;top:0;width:0;height:0}',
  '.knest-tnode{pointer-events:auto;position:absolute;width:300px;border-radius:var(--dsw-radius-lg,8px);border-radius:var(--dsw-radius-lg,8px);background:var(--kn-panel);color:var(--kn-ink);border:1px solid var(--kn-rule);box-shadow:var(--kn-shadow);font-size:12.5px;line-height:1.6}',
  '.knest-tnode[data-selected="true"]{border-color:var(--kn-signal);box-shadow:0 0 0 1px var(--kn-signal),var(--kn-shadow)}',
  '.knest-tnode[data-depth="0"]{border-color:color-mix(in srgb,var(--kn-echo) 45%,var(--kn-rule))}',
  '.knest-tnode[data-collapsed="true"] .knest-tnode-body{display:none}',
  '.knest-tnode-bar{display:flex;align-items:center;gap:6px;height:32px;padding:0 4px 0 10px;border-bottom:1px solid var(--kn-rule);cursor:grab;user-select:none}',
  '.knest-tnode-bar:active{cursor:grabbing}',
  '.knest-tnode-title{flex:1;font-family:"Songti SC","Noto Serif SC",Georgia,serif;font-size:13px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.knest-tnode-kind{flex:0 0 auto;font-size:10px;line-height:15px;color:var(--kn-mute);border:1px solid var(--kn-rule);padding:0 4px}',
  '.knest-tnode-btn{flex:0 0 auto;width:20px;height:20px;border:0;background:none;color:var(--kn-mute);font:inherit;line-height:1;cursor:pointer;padding:0}',
  '.knest-tnode-btn:hover{color:var(--kn-ink)}',
  '.knest-tnode-btn[data-act="close"]:hover{color:#b4443c}',
  '.knest-tnode-body{padding:10px 12px 11px}',
  '.knest-tnode-lead{margin:0 0 8px;font-size:12.5px;line-height:1.7;overflow-wrap:anywhere}',
  '.knest-tnode-evidence{margin:0 0 8px;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--kn-mute)}',
  '.knest-tnode-links{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px}',
  '.knest-chip{border:1px solid var(--kn-rule);background:none;color:var(--kn-echo);font:inherit;font-size:11.5px;line-height:1.5;padding:2px 7px;cursor:pointer}',
  '.knest-chip:hover:not(:disabled){background:var(--kn-echo-soft);border-color:var(--kn-echo)}',
  '.knest-chip:disabled{color:var(--kn-mute);opacity:.55;cursor:default}',
  '.knest-tnode-foot{margin-top:8px;font-size:10.5px;color:var(--kn-mute);font-variant-numeric:tabular-nums}',
  '.knest-board-hud{position:absolute;right:16px;bottom:16px;top:auto;left:auto;display:flex;align-items:center;gap:2px;padding:3px;pointer-events:auto;background:color-mix(in srgb,var(--kn-panel) 92%,transparent);border:1px solid var(--kn-rule);box-shadow:var(--kn-shadow);opacity:.72;transition:opacity .14s ease;cursor:grab;user-select:none;touch-action:none}',
  '.knest-board-hud:hover{opacity:1}',
  '.knest-board-hud[data-dragging="true"]{cursor:grabbing;opacity:1}',
  '.knest-board-hud .knest-hud-btn{cursor:pointer}',
  '.knest-hud-btn{width:24px;height:24px;border:0;background:none;color:var(--kn-mute);font:14px/1 ui-sans-serif,system-ui;cursor:pointer;padding:0;border-radius:4px}',
  '.knest-hud-btn:hover{color:var(--kn-ink);background:var(--kn-echo-soft)}',

  /* ── 动效 ────────────────────────────────────────────────────── */
  /* 暗色：从下方「浮上来」——深海里的东西是被推上来的 */
  '@keyframes knest-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
  /* 亮色：像纸被压平——先虚一点再定住，不做位移动画 */
  '@keyframes knest-print{from{opacity:0;filter:blur(1.5px)}to{opacity:1;filter:none}}',
  '@keyframes knest-sonar{from{transform:scale(.35);opacity:.75}to{transform:scale(2.6);opacity:0}}',
  '@keyframes knest-sweep{from{transform:translateX(-100%)}to{transform:translateX(100%)}}',
  '@keyframes knest-pulse{0%,100%{background:transparent}50%{background:var(--kn-echo)}}',
  '@keyframes knest-depth{from{transform:translateY(0)}to{transform:translateY(-26px)}}',
  '@keyframes knest-caustic{from{background-position:0 0,0 0,0 0,0 0}to{background-position:0 0,0 0,180px 0,-140px 0}}',
  '@keyframes knest-menu-in{from{opacity:0;transform:translateX(-3px)}to{opacity:1;transform:none}}',

  '@media (prefers-reduced-motion: reduce){.knest-stage::before{animation:none!important}.knest-sonar{display:none}.knest-scan::after{animation:none;transform:none;opacity:.5}.knest-point[data-pending="true"] .knest-ring-dot{animation:none;background:var(--kn-echo-soft)}}',
].join('\n');

/**
 * 注入/刷新样式表。
 *
 * ⚠ 踩过的坑：早先"发现已有 style[data-knest-style] 就 return"，于是插件半热更新后
 * 旧 CSS 一直留着。现在改成**原地替换 textContent**，保证样式与当前构建永远同版本。
 * @param {Document} [doc] - 文档（测试可注入）。
 * @returns {void}
 */
function ensureStyles(doc) {
  try {
    const document = doc ?? (typeof globalThis.document === 'undefined' ? null : globalThis.document);
    if (document === null || typeof document.createElement !== 'function') return;
    const existing = typeof document.querySelector === 'function'
      ? document.querySelector('style[data-knest-style]')
      : null;
    if (existing !== null && existing !== undefined) {
      if (existing.textContent !== KNEST_CSS) existing.textContent = KNEST_CSS;
      existing.setAttribute('data-knest-style', KNEST_STYLE_REV);
      return;
    }
    const style = document.createElement('style');
    style.setAttribute('data-knest-style', KNEST_STYLE_REV);
    style.textContent = KNEST_CSS;
    const head = document.head ?? document.body;
    if (head !== null && head !== undefined && typeof head.appendChild === 'function') head.appendChild(style);
  } catch {
    /* 样式注入失败不影响功能 */
  }
}


/* ===== client/settings.js ===== */
/**
 * 设置面板：直接建在宿主页面里（Cherry Studio 注入版用）。
 *
 * 它不自己保存配置，而是把表单 POST 给本机运行的配置服务（MCP server 起的那个），
 * 由服务写进 config.json —— 这样界面和实际读取配置的地方永远是同一份。
 *
 * 为什么能用：配置服务只监听 127.0.0.1，并且允许来自 file:// 页面（Origin: null）的请求，
 * 注入进来的界面正好是这种来源；外部网页的 Origin 是域名，会被拒。
 */

/** 面板的 class 前缀。 */
const PREFIX = 'knest-set';

/**
 * 造一个设置面板。
 *
 * @param {{doc?:Document, win?:object, port?:number, onSaved?:Function, onToast?:Function}} [options] - 配置。
 * @returns {{open:Function, close:Function, toggle:Function, isOpen:Function, refresh:Function, dispose:Function, el:HTMLElement}} 句柄。
 */
function createSettings(options = {}) {
  const win = options.win ?? globalThis;
  const doc = options.doc ?? win.document;
  const port = Number(options.port ?? 7332);
  const base = `http://127.0.0.1:${port}`;
  const toast = typeof options.onToast === 'function' ? options.onToast : () => {};

  let presets = [];
  let picked = 'deepseek';
  let state = null;

  const root = doc.createElement('div');
  root.className = 'knest-settings';
  root.setAttribute('data-open', 'false');
  root.innerHTML = `
    <div class="knest-set-head">
      <b>词林 · 设置</b>
      <button class="knest-set-x" type="button" title="关闭">×</button>
    </div>
    <div class="knest-set-status">正在读取…</div>
    <div class="knest-set-presets"></div>
    <div class="knest-set-fields">
      <label>接口地址<input class="knest-set-url" spellcheck="false" placeholder="https://api.deepseek.com"></label>
      <label>模型名<input class="knest-set-model" spellcheck="false" placeholder="deepseek-flash"></label>
      <label class="knest-set-key-row">钥匙<input class="knest-set-key" type="password" spellcheck="false" placeholder="sk-..."></label>
    </div>
    <div class="knest-set-actions">
      <button class="knest-set-save" type="button">保存并测试</button>
      <button class="knest-set-test" type="button">只测试</button>
    </div>
    <div class="knest-set-msg" data-kind=""></div>
  `;
  (doc.body ?? doc.documentElement).appendChild(root);

  const $ = (selector) => root.querySelector(selector);
  const statusEl = $('.knest-set-status');
  const presetsEl = $('.knest-set-presets');
  const msgEl = $('.knest-set-msg');

  /**
   * 写一条结果提示。
   * @param {string} kind - ok / bad / ''。
   * @param {string} text - 文案。
   * @returns {void}
   */
  const say = (kind, text) => {
    msgEl.dataset.kind = kind;
    msgEl.textContent = text;
  };

  /**
   * 画状态区。
   * @param {object} next - 服务返回的状态。
   * @returns {void}
   */
  const paintStatus = (next) => {
    if (next === null || next === undefined) return;
    state = next;
    const eff = next.effective ?? {};
    statusEl.innerHTML = ''
      + `<div>当前生效 <b>${escapeHtml(eff.baseUrl || '（未配置）')}</b></div>`
      + `<div>模型 <b>${escapeHtml(eff.model || '（无）')}</b>　钥匙 ${escapeHtml(eff.keyMasked || '（无）')}</div>`
      + `<div class="knest-set-path">配置目录 ${escapeHtml(next.home ?? '')}</div>`;
  };

  /**
   * 画预设按钮。
   * @returns {void}
   */
  const paintPresets = () => {
    presetsEl.innerHTML = presets.map((item) => (
      `<button type="button" data-id="${escapeHtml(item.id)}" data-on="${item.id === picked ? '1' : '0'}">`
      + `<b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.hint)}</span></button>`
    )).join('');
    for (const button of presetsEl.querySelectorAll('button')) {
      button.addEventListener('click', () => pick(button.dataset.id));
    }
  };

  /**
   * 选一个预设，顺带把默认值填进表单。
   * @param {string} id - 预设 id。
   * @returns {void}
   */
  const pick = (id) => {
    picked = id;
    const preset = presets.find((item) => item.id === id);
    if (preset === undefined) return;
    paintPresets();
    $('.knest-set-url').value = preset.baseUrl || '';
    $('.knest-set-model').value = preset.model || (state?.saved?.model ?? '');
    const keyRow = $('.knest-set-key-row');
    keyRow.dataset.optional = preset.needsKey === false ? '1' : '0';
    const savedKey = state?.saved?.apiKeyMasked ?? '';
    if (preset.needsKey === false) {
      $('.knest-set-key').placeholder = '不用填';
    } else if (savedKey !== '') {
      /* 已经存过：告诉用户留空就沿用，别让他以为丢了 */
      $('.knest-set-key').placeholder = `已保存 ${savedKey}，留空则沿用`;
    } else {
      $('.knest-set-key').placeholder = 'sk-...';
    }
    say('', '');
  };

  /**
   * 读表单。
   * @returns {object} 载荷。
   */
  const form = () => ({
    preset: picked,
    baseUrl: $('.knest-set-url').value,
    model: $('.knest-set-model').value,
    apiKey: $('.knest-set-key').value,
  });

  /**
   * 调服务。
   * @param {string} path - /state /save /test。
   * @param {object} [body] - POST 载荷。
   * @returns {Promise<object>} 结果。
   */
  const call = async (path, body) => {
    const res = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json();
  };

  /**
   * 重新读状态。
   * @returns {Promise<void>}
   */
  async function refresh() {
    try {
      const next = await call('/state');
      presets = Array.isArray(next.presets) ? next.presets : [];
      paintStatus(next);
      paintPresets();
      const savedUrl = next?.saved?.baseUrl ?? '';
      if (savedUrl !== '') {
        const guess = presets.find((item) => item.baseUrl && savedUrl.startsWith(item.baseUrl.replace(/\/v1$/u, '')));
        pick(guess?.id ?? 'custom');
        $('.knest-set-url').value = savedUrl;
        $('.knest-set-model').value = next?.saved?.model ?? '';
      } else {
        pick('deepseek');
      }
      say('', '');
    } catch (error) {
      statusEl.innerHTML = '<div>读不到配置服务</div>';
      say('bad', `配置服务没响应（${base}）。请确认 MCP server 正在运行。`);
    }
  }

  /* 事件 */
  $('.knest-set-x').addEventListener('click', () => close());

  $('.knest-set-save').addEventListener('click', async () => {
    const button = $('.knest-set-save');
    button.disabled = true;
    say('', '正在保存…');
    try {
      const saved = await call('/save', form());
      if (saved.ok !== true) {
        say('bad', saved.message ?? '保存失败');
        return;
      }
      paintStatus(saved.state);
      say('ok', `${saved.message}，正在测试…`);
      const tested = await call('/test', form());
      say(tested.ok === true ? 'ok' : 'bad',
        `${tested.ok === true ? '保存成功，测试通过：' : '已保存，但测试没过：'}${tested.message}`
        + (tested.detail ? `\n${tested.detail}` : ''));
      if (tested.ok === true) {
        toast('词林：配置已生效');
        if (typeof options.onSaved === 'function') options.onSaved(saved.state);
      }
    } catch (error) {
      say('bad', `请求失败：${String(error?.message ?? error).slice(0, 120)}`);
    } finally {
      button.disabled = false;
    }
  });

  $('.knest-set-test').addEventListener('click', async () => {
    const button = $('.knest-set-test');
    button.disabled = true;
    say('', '正在测试…');
    try {
      const tested = await call('/test', form());
      say(tested.ok === true ? 'ok' : 'bad',
        tested.message + (tested.detail ? `\n${tested.detail}` : ''));
    } catch (error) {
      say('bad', `请求失败：${String(error?.message ?? error).slice(0, 120)}`);
    } finally {
      button.disabled = false;
    }
  });

  root.addEventListener('mousedown', (event) => event.stopPropagation());
  root.addEventListener('contextmenu', (event) => event.stopPropagation());

  /**
   * 打开面板。
   * @returns {void}
   */
  function open() {
    root.setAttribute('data-open', 'true');
    refresh();
  }

  /**
   * 关闭面板。
   * @returns {void}
   */
  function close() {
    root.setAttribute('data-open', 'false');
  }

  /**
   * 开关。
   * @returns {void}
   */
  function toggle() {
    if (root.getAttribute('data-open') === 'true') close();
    else open();
  }

  /**
   * 是否打开。
   * @returns {boolean} 状态。
   */
  const isOpen = () => root.getAttribute('data-open') === 'true';

  /**
   * 卸载。
   * @returns {void}
   */
  function dispose() {
    root.remove();
  }

  return { open, close, toggle, isOpen, refresh, dispose, el: root };
}

/**
 * HTML 转义，避免配置里的尖括号破坏结构。
 * @param {unknown} value - 原值。
 * @returns {string} 安全字符串。
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}


/* ===== client/standalone.js ===== */
/**
 * 独立外壳：不依赖 React、不依赖 DSH 插槽，把一个「圈词」界面挂到任何网页或 Electron 窗口里。
 *
 * 这是给 Cherry Studio、WorkBuddy 这类宿主用的：它们的渲染进程就是一个 Chromium 页面，
 * 我们用 CDP 把这份代码注入进去，它就在页面里跑起来，和 DSH 里用的是同一套模块。
 *
 * 与 DSH 版的差别只有两处：
 *   1. 没有 `ctx.slots`，界面自己挂到 body；
 *   2. 解释请求打到外部端点（默认 http://127.0.0.1:7331），而不是插件的宿主路由。
 */


/** 注入到页面上的全局名。 */
const GLOBAL_KEY = '__knestStandalone';

/**
 * 挂载。
 * @param {{endpoint?:string, appName?:string, doc?:Document, win?:object}} [options] - 配置。
 * @returns {{dispose:Function, board:object}} 句柄。
 */
function mountKnest(options = {}) {
  const win = options.win ?? globalThis;
  const doc = options.doc ?? win.document;
  const endpoint = typeof options.endpoint === 'string' && options.endpoint !== ''
    ? options.endpoint.replace(/\/+$/u, '')
    : 'http://127.0.0.1:7331';

  const api = createExplainApi({ endpoint: `${endpoint}/explain` });

  /* 样式只注入一次 */
  if (doc.getElementById('knest-style') === null) {
    const style = doc.createElement('style');
    style.id = 'knest-style';
    style.textContent = KNEST_CSS;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  /* 跟着宿主的明暗走：读页面背景亮度，别硬写 dark */
  stampTheme(doc, detectTheme(doc));
  const stopTheme = typeof watchTheme === 'function'
    ? watchTheme(doc, (next) => stampTheme(doc, next))
    : () => {};

  const painter = createPainter(doc);
  let flashToast = null;

  /* 拖动时的字数提示。
     右键拖动时浏览器不产生原生选区，光靠高亮很难判断拖了多长，
     所以在指针旁边挂一个小气泡，实时报「已选 N 字」。 */
  let dragHint = null;
  const hideDragHint = () => {
    try {
      dragHint?.setAttribute('data-show', 'false');
    } catch {
      /* 忽略 */
    }
  };

  /**
   * 更新拖动提示。
   * @param {Range|null} range - 当前选区。
   * @param {number} [x] - 指针横坐标。
   * @param {number} [y] - 指针纵坐标。
   * @returns {void}
   */
  const showDragHint = (range, x, y) => {
    try {
      const count = range === null || range === undefined ? 0 : [...String(range.toString()).replace(/\s+/gu, '')].length;
      if (count === 0) {
        hideDragHint();
        return;
      }
      if (dragHint === null || dragHint.parentNode === null) {
        dragHint = doc.createElement('div');
        dragHint.className = 'knest-drag-hint';
        dragHint.setAttribute('data-show', 'false');
        (doc.body ?? doc.documentElement).appendChild(dragHint);
      }
      dragHint.textContent = `已选 ${count} 字`;
      dragHint.setAttribute('data-show', 'true');

      const px = typeof x === 'number' ? x : win.innerWidth / 2;
      const py = typeof y === 'number' ? y : win.innerHeight / 2;
      const gap = 16;
      const boxW = 100;
      const boxH = 30;
      const left = px + gap + boxW > win.innerWidth ? px - gap - boxW : px + gap;
      const top = py + gap + boxH > win.innerHeight ? py - gap - boxH : py + gap;
      dragHint.style.left = `${Math.max(4, Math.round(left))}px`;
      dragHint.style.top = `${Math.max(4, Math.round(top))}px`;
    } catch {
      /* 忽略 */
    }
  };

  /**
   * 轻提示（独立版没有侧边竖牌，用一条浮出来的小条）。
   * @param {string} message - 文案。
   * @returns {void}
   */
  const flash = (message) => {
    try {
      if (flashToast === null || flashToast.parentNode === null) {
        flashToast = doc.createElement('div');
        flashToast.className = 'knest-toast';
        flashToast.setAttribute('data-show', 'false');
        (doc.body ?? doc.documentElement).appendChild(flashToast);
      }
      flashToast.textContent = String(message ?? '');
      flashToast.setAttribute('data-show', 'true');
      win.setTimeout(() => flashToast?.setAttribute('data-show', 'false'), 2200);
    } catch {
      /* 忽略 */
    }
  };

  /**
   * 把画布上的树导成 Markdown：下载一份 .md，同时复制到剪贴板。
   *
   * 独立版没有宿主的文件系统权限，所以走浏览器下载这一条；
   * 复制是顺手给的，方便直接粘进笔记。
   *
   * @returns {void}
   */
  const exportTree = () => {
    try {
      const snap = board.snapshot();
      const list = Array.isArray(snap?.nodes) ? snap.nodes : [];
      if (list.length === 0) {
        flash('画布上还没有卡片');
        return;
      }
      const kids = (id) => list.filter((node) => (node.parentId ?? null) === id);
      const lines = ['# 词林 · 知识树', '', `导出时间：${new Date().toLocaleString()}`, ''];
      const walk = (node, depth) => {
        const pad = '  '.repeat(depth);
        const lead = typeof node.model?.lead === 'string' ? node.model.lead : '';
        lines.push(`${pad}- **${node.text}**${lead === '' ? '' : ` — ${lead}`}`);
        for (const child of kids(node.id)) walk(child, depth + 1);
      };
      for (const root of list.filter((node) => (node.parentId ?? null) === null)) walk(root, 0);
      const text = lines.join('\n');

      let downloaded = false;
      try {
        const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = doc.createElement('a');
        link.href = url;
        link.download = `词林-知识树-${new Date().toISOString().slice(0, 10)}.md`;
        link.style.display = 'none';
        (doc.body ?? doc.documentElement).appendChild(link);
        link.click();
        link.remove();
        win.setTimeout(() => URL.revokeObjectURL(url), 1500);
        downloaded = true;
      } catch {
        downloaded = false;
      }

      let copied = false;
      try {
        win.navigator?.clipboard?.writeText?.(text);
        copied = true;
      } catch {
        copied = false;
      }

      if (downloaded && copied) flash(`已导出 ${list.length} 张卡片：下载了一份 .md，也复制到了剪贴板`);
      else if (downloaded) flash(`已导出 ${list.length} 张卡片：下载了一份 .md`);
      else if (copied) flash(`已导出 ${list.length} 张卡片：内容已复制到剪贴板`);
      else flash('导出失败：浏览器拦了下载和剪贴板');
    } catch (error) {
      flash(`导出出错：${String(error?.message ?? error).slice(0, 60)}`);
    }
  };

  const board = createTreeBoard({
    doc,
    onRetry: (nodeId, phrase) => runExplain({ phrase, nodeId, force: true }),
    onExpand: (nodeId, term, opts) => {
      if (opts?.replace === true) {
        runExplain({ phrase: term, replaceId: nodeId });
        return;
      }
      runExplain({ phrase: term, parentId: nodeId, nodeId: `${nodeId}::${hashString(term)}` });
    },
    onExport: () => exportTree(),
  });
  board.mount();

  const annotator = createAnnotator({ doc, win });
  annotator.restore();

  /* 设置面板：直接建在宿主页面里，读写的是同一个 config.json */
  const setupPort = Number(options.setupPort ?? 7332);
  const settings = createSettings({
    doc,
    win,
    port: setupPort,
    onToast: (message) => flash(message),
  });
  const gear = doc.createElement('button');
  gear.type = 'button';
  gear.className = 'knest-edge-tab';
  gear.title = '词林：点这里选模型、填钥匙';
  gear.innerHTML = '<span>词林</span>';
  gear.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    settings.toggle();
  });
  gear.addEventListener('contextmenu', (event) => event.stopPropagation());
  (doc.body ?? doc.documentElement).appendChild(gear);

  /* 还没配模型时亮个红点，告诉用户这里要点 */
  const markUnconfigured = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${setupPort}/state`);
      const state = await res.json();
      const configured = typeof state?.saved?.baseUrl === 'string' && state.saved.baseUrl.trim() !== '';
      gear.setAttribute('data-alert', configured ? '0' : '1');
    } catch {
      gear.setAttribute('data-alert', '1');
    }
  };
  markUnconfigured();
  /* 面板关掉时重新看一眼，配好了就把红点熄掉 */
  const tabObserver = new MutationObserver(() => {
    const open = settings.isOpen();
    gear.setAttribute('data-open', open ? 'true' : 'false');
    if (!open) markUnconfigured();
  });
  try {
    tabObserver.observe(settings.el, { attributes: true, attributeFilter: ['data-open'] });
  } catch {
    /* 忽略 */
  }

  const menu = createMenu({ doc, onAction: (action, data) => onMenuAction(action, data) });

  /**
   * 跑一次解释。
   * @param {{phrase:string, parentId?:string, nodeId?:string, replaceId?:string, force?:boolean, mode?:string, docText?:string}} input - 参数。
   * @returns {Promise<void>}
   */
  async function runExplain(input) {
    const phrase = typeof input?.phrase === 'string' ? input.phrase.trim() : '';
    if (phrase === '') return;
    const mode = typeof input?.mode === 'string' && input.mode !== '' ? input.mode : 'default';
    const nodeId = input?.nodeId ?? `n-${hashString(phrase)}`;
    const replaceId = typeof input?.replaceId === 'string' ? input.replaceId : '';

    let targetId = replaceId !== '' ? replaceId : nodeId;
    if (replaceId !== '') {
      board.update(replaceId, buildPendingCard(phrase));
    } else if (typeof input?.parentId === 'string' && input.parentId !== '') {
      const child = board.addChild(input.parentId, { id: nodeId, text: phrase, model: buildPendingCard(phrase) });
      if (child === null) {
        flash('最多 4 层，这里不再展开');
        return;
      }
      targetId = child.id;
    } else {
      const opened = board.openRoot({ id: nodeId, text: phrase, model: buildPendingCard(phrase) });
      if (opened !== null) targetId = opened.id;
    }

    const result = await api.explain({
      phrase,
      context: typeof input?.docText === 'string' ? input.docText : '',
      mode,
      force: input?.force === true,
    });

    if (result.ok === true) {
      const card = buildCard({ phrase, data: result.data });
      board.update(targetId, card);
      return;
    }
    board.update(targetId, buildErrorCard(phrase, result.error));
  }

  /**
   * 菜单动作。
   * @param {string} action - 动作名。
   * @param {object} data - 上下文。
   * @returns {void}
   */
  function onMenuAction(action, data) {
    const phrase = typeof data?.phrase === 'string' ? data.phrase : '';
    if (action === 'copy') {
      try {
        win.navigator?.clipboard?.writeText(data?.selection ?? phrase);
      } catch {
        /* 忽略 */
      }
      flash('已复制');
      return;
    }
    if (action === 'query') {
      runExplain({ phrase, docText: data?.docText });
      return;
    }
    if (action === 'rephrase' || action === 'example' || action === 'translate') {
      runExplain({ phrase, mode: action, docText: data?.docText });
      return;
    }
    if (action === 'annotate') {
      const noted = annotator.add({ phrase, range: data?.range ?? null, rect: data?.rect ?? null });
      flash(noted === null ? '先选中一段文字' : '已标红，在上方气泡里写改为');
      return;
    }
    if (action === 'clear-notes') {
      annotator.clearAll();
      flash('批注已清空');
      return;
    }
    flash('独立版还没做这个动作');
  }

  const disposeSelector = attachSelector(doc, {
    leftEnabled: () => annotator.isOn(),
    isEnabled: () => true,
    /* 拖动过程中实时上色 + 报字数：右键拖动没有原生选区，不这么做用户看不见自己选到哪 */
    onLive: (range, at) => {
      if (range === null || range === undefined) {
        hideDragHint();
        return;
      }
      painter.paint(range);
      showDragHint(range, at?.x, at?.y);
    },
    onCancel: () => {
      hideDragHint();
      painter.clear();
    },
    onPick: (payload) => {
      const { phrase, range, rect } = payload;
      const clean = typeof phrase === 'string' ? phrase.trim() : '';
      hideDragHint();
      if (clean === '') return;
      if (annotator.isOn()) {
        if (payload?.dragged !== true || range === null) {
          flash('拖过一段要改的文字');
          return;
        }
        annotator.add({ phrase: clean, range, rect });
        flash('已标红，在上方气泡里写改为');
        return;
      }
      painter.paint(range ?? painter.resolve(clean));
      menu.show(rect, {
        phrase: clean,
        selection: clean,
        rect,
        range,
        docText: contextAroundRange(range, clean),
        hasSelection: true,
        hasExplain: false,
        hasDomain: false,
        queryLabel: '解释这段文本',
      });
    },
  });

  win[GLOBAL_KEY] = { board, annotator, settings, dispose };

  /**
   * 卸载。
   * @returns {void}
   */
  function dispose() {
    try {
      disposeSelector?.();
    } catch {
      /* 忽略 */
    }
    board.dispose();
    annotator.dispose();
    try {
      settings.dispose();
      gear.remove();
    } catch {
      /* 忽略 */
    }
    try {
      stopTheme?.();
    } catch {
      /* 忽略 */
    }
    doc.getElementById('knest-style')?.remove?.();
    delete win[GLOBAL_KEY];
  }

  flash(`词林已挂到 ${options.appName ?? '当前窗口'}　右侧「词林」竖条可设置模型`);
  return { board, annotator, dispose };
}


  window.__knestMount = function (options) {
    return mountKnest(Object.assign({ appName: 'Cherry Studio' }, options || {}));
  };
})();
