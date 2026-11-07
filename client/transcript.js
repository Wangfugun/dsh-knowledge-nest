/**
 * 会话快照 → 消息列表 → 喂给模型的上下文。
 *
 * 两条宿主事实（重做时照抄，别再踩）：
 *   1. `eventSource.getSnapshot().entries` 里是 `{ event: {...} }` **包装**，
 *      测试夹具是裸事件；两种都要认，否则视图 0 条；
 *   2. 消息正文在 `content` 数组里，只有 `type === 'text'` 的块算人话；
 *      工具调用、思考块不喂模型（噪声大、token 贵）。
 */
import { cleanMarkdown, clampMiddle, clampText, hashString } from './util.js';

/**
 * 上下文预算档位。**按字算钱**：中文约 1 字 1 token，加上 system（约 300）就是总 prompt。
 * 实测一次"详细"能到 3000+ token，所以默认走 compact。
 *
 *  budget      拼好的上下文总字数上限
 *  perMessage  单条消息截断
 *  before/after  命中那条消息前后各取几条
 */
export const DEPTHS = Object.freeze({
  compact: { budget: 760, perMessage: 180, before: 1, after: 1, label: '精简' },
  standard: { budget: 1800, perMessage: 240, before: 2, after: 3, label: '标准' },
  deep: { budget: 4000, perMessage: 320, before: 4, after: 8, label: '详细' },
});

/** 默认档位。 */
export const DEFAULT_DEPTH = 'compact';

/**
 * 取档位参数（未知档位回落到默认）。
 * @param {unknown} name - 档位名。
 * @returns {{budget:number, perMessage:number, before:number, after:number, label:string}} 参数。
 */
export function depthOf(name) {
  return DEPTHS[typeof name === 'string' ? name : ''] ?? DEPTHS[DEFAULT_DEPTH];
}

/** 没命中短语时取末尾多少条（受 after 档位影响）。 */
const TAIL_MESSAGES = 6;

/**
 * 取消息里的纯文本块。
 * @param {unknown} message - 事件 data 里的 message。
 * @returns {string} 文本。
 */
function textBlocks(message) {
  const content = message !== null && typeof message === 'object' ? message.content : undefined;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    if (block.type !== 'text') continue;
    if (typeof block.text !== 'string' || block.text.trim() === '') continue;
    parts.push(block.text);
  }
  return parts.join('\n\n');
}

/**
 * 事件窗口 → 消息列表。
 * @param {unknown} entries - 快照 entries（包装或裸事件）。
 * @returns {{id:string, role:'you'|'ai', text:string, seq:number}[]} 消息（按 seq 升序、去重）。
 */
export function buildTranscript(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const seen = new Set();
  const ordered = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue;
    const event = entry.event !== null && typeof entry.event === 'object' ? entry.event : entry;
    const seq = Number.isSafeInteger(entry.seq) ? entry.seq : event.seq;
    if (!Number.isSafeInteger(seq) || seen.has(seq)) continue;
    seen.add(seq);
    ordered.push({ seq, event });
  }
  ordered.sort((left, right) => left.seq - right.seq);

  const messages = [];
  for (const { seq, event } of ordered) {
    const data = event.data !== null && typeof event.data === 'object' ? event.data : {};
    if (event.type === 'user/message') {
      const text = cleanMarkdown(textBlocks(data));
      if (text === '') continue;
      messages.push({
        id: typeof data.id === 'string' ? data.id : `user-${seq}`,
        role: 'you',
        text,
        seq,
      });
      continue;
    }
    if (event.type === 'assistant/message') {
      const message = data.message;
      const text = cleanMarkdown(textBlocks(message));
      if (text === '') continue;
      messages.push({
        id: typeof message?.id === 'string' ? message.id : `assistant-${seq}`,
        role: 'ai',
        text,
        seq,
      });
    }
  }
  return messages;
}

/**
 * 找短语第一次出现的消息下标。
 * @param {object[]} messages - 消息列表。
 * @param {string} phrase - 短语。
 * @returns {number} 下标；没命中是 -1。
 */
export function firstMessageIndex(messages, phrase) {
  const needle = typeof phrase === 'string' ? phrase.trim() : '';
  if (needle === '' || !Array.isArray(messages)) return -1;
  for (let index = 0; index < messages.length; index += 1) {
    const text = typeof messages[index]?.text === 'string' ? messages[index].text : '';
    if (text.includes(needle)) return index;
  }
  return -1;
}

/**
 * 统计短语在整个对话里出现几次、落在几条消息里。
 * @param {object[]} messages - 消息列表。
 * @param {string} phrase - 短语。
 * @returns {{total:number, messages:number, firstIndex:number}} 统计。
 */
export function countPhrase(messages, phrase) {
  const needle = typeof phrase === 'string' ? phrase.trim() : '';
  const list = Array.isArray(messages) ? messages : [];
  if (needle === '') return { total: 0, messages: 0, firstIndex: -1 };
  let total = 0;
  let hits = 0;
  let firstIndex = -1;
  for (let index = 0; index < list.length; index += 1) {
    const text = typeof list[index]?.text === 'string' ? list[index].text : '';
    if (text === '') continue;
    let cursor = 0;
    let local = 0;
    for (;;) {
      const found = text.indexOf(needle, cursor);
      if (found < 0) break;
      local += 1;
      cursor = found + needle.length;
    }
    if (local === 0) continue;
    if (firstIndex < 0) firstIndex = index;
    hits += 1;
    total += local;
  }
  return { total, messages: hits, firstIndex };
}

/**
 * 拼上下文：命中短语就取它前后一小段，否则取末尾一段。
 * 每行 `你：…` / `答：…`，逐条截断，最后整体保头保尾。
 *
 * @param {object[]} messages - 消息列表。
 * @param {{phrase?:string, depth?:string, budget?:number}} [options] - 选项。
 *   不传 depth 就用 DEFAULT_DEPTH（compact）；budget 显式给出时覆盖档位。
 * @returns {{context:string, fingerprint:string, firstIndex:number, chars:number, depth:string}} 上下文与统计。
 */
export function buildContext(messages, options = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const phrase = typeof options.phrase === 'string' ? options.phrase.trim() : '';
  const asked = typeof options.depth === 'string' ? options.depth : '';
  const depthName = DEPTHS[asked] !== undefined ? asked : DEFAULT_DEPTH;
  const depth = depthOf(depthName);
  const budget = Number.isFinite(options.budget) ? Math.max(200, options.budget) : depth.budget;
  const found = firstMessageIndex(list, phrase);

  let from = 0;
  let to = list.length;
  if (found >= 0) {
    from = Math.max(0, found - depth.before);
    to = Math.min(list.length, found + depth.after + 1);
  } else if (list.length > TAIL_MESSAGES) {
    from = list.length - TAIL_MESSAGES;
  }

  const lines = [];
  for (let index = from; index < to; index += 1) {
    const message = list[index];
    const label = message.role === 'you' ? '你' : '答';
    const body = clampText(message.text, depth.perMessage);
    if (body === '') continue;
    lines.push(`${label}：${body}`);
  }
  const context = clampMiddle(lines.join('\n'), budget);
  const fingerprint = hashString(`${phrase}\u0000${context}`);
  return { context, fingerprint, firstIndex: found, chars: context.length, depth: depthName };
}
