/**
 * 圈词：把"右键拖过的两点"变成一句能拿去问模型的文本。
 *
 * 纯函数（归一化 / 整句 / 反向取文）与 DOM 胶水分开，前者 node 里直接测。
 */

/** 圈出来的文本上限：再长就不是"一个词/一句话"了。 */
export const MAX_PHRASE_CHARS = 120;

/** 句子截断长度。 */
export const SENTENCE_MAX = 200;

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
export function normalizePhrase(text) {
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
export function expandSentenceAt(text, offset) {
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
export function sentenceContaining(text, phrase) {
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
export function pointAt(doc, x, y) {
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
export function rangeBetween(doc, start, end) {
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
export function phraseKey(phrase) {
  return typeof phrase === 'string' ? phrase.replace(/\s+/gu, ' ').trim().toLowerCase() : '';
}
