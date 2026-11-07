/**
 * 菜单里那几个动作的纯逻辑：拼文本、算引用、笔记本增删导出。
 *
 * 单独放一个文件的原因：这些都没有 DOM 依赖，可以逐条测；
 * view.js 只负责"拿到结果 → 塞剪贴板 / 存 localStorage / 开窗口"。
 */
import { clampText } from './util.js';

/** 笔记本最多存多少条。 */
export const NOTEBOOK_LIMIT = 200;

/**
 * 把一张解释卡拼成可粘贴的纯文本。
 * @param {{phrase:string, lead:string, literal?:string, evidence?:object[], readings?:object[]}} card - 卡片模型。
 * @returns {string} 文本；没有内容时是空串。
 */
export function formatExplanation(card) {
  const phrase = typeof card?.phrase === 'string' ? card.phrase.trim() : '';
  const lead = typeof card?.lead === 'string' ? card.lead.trim() : '';
  if (phrase === '' || lead === '') return '';
  const lines = [`【${phrase}】`, lead];
  const evidence = Array.isArray(card?.evidence) ? card.evidence : [];
  if (evidence.length > 0) {
    lines.push('依据：');
    for (const item of evidence) {
      if (item === null || typeof item !== 'object') continue;
      const quote = typeof item.quote === 'string' ? item.quote : '';
      const why = typeof item.why === 'string' ? item.why : '';
      if (quote === '') continue;
      lines.push(why === '' ? `“${quote}”` : `“${quote}” —— ${why}`);
    }
  }
  const readings = Array.isArray(card?.readings) ? card.readings : [];
  if (readings.length > 0) {
    const parts = readings
      .filter((item) => item !== null && typeof item === 'object' && typeof item.label === 'string')
      .map((item) => (typeof item.note === 'string' && item.note !== '' ? `${item.label}（${item.note}）` : item.label));
    if (parts.length > 0) lines.push(`也可以读成：${parts.join('；')}`);
  }
  if (typeof card?.literal === 'string' && card.literal !== '') lines.push(`不看上下文时：${card.literal}`);
  return lines.join('\n');
}

/**
 * 拼一段带出处的引用。
 * @param {{phrase:string, sentence?:string, role?:string, index?:number}} input - 词、原句、说话人、第几条。
 * @returns {string} 形如 `> 原句\n> —— 你 · 第 3 条`。
 */
export function formatQuote(input) {
  const phrase = typeof input?.phrase === 'string' ? input.phrase.trim() : '';
  const sentence = typeof input?.sentence === 'string' && input.sentence.trim() !== '' ? input.sentence.trim() : phrase;
  if (sentence === '') return '';
  const role = input?.role === 'you' ? '你' : (input?.role === 'ai' ? '回答' : '');
  const index = Number.isFinite(input?.index) ? Math.floor(input.index) + 1 : 0;
  const source = [role, index > 0 ? `第 ${index} 条` : ''].filter((part) => part !== '').join(' · ');
  return source === '' ? `> ${sentence}` : `> ${sentence}\n> —— ${source}`;
}

/**
 * 加一条笔记（同词同句只留一条，新的覆盖旧的）。
 * @param {object[]} list - 现有列表。
 * @param {{phrase:string, lead?:string, quote?:string, sessionId?:string}} entry - 新条目。
 * @returns {object[]} 新数组。
 */
export function notebookAdd(list, entry) {
  const current = Array.isArray(list) ? list.slice() : [];
  const phrase = clampText(entry?.phrase, 120);
  if (phrase === '') return current;
  const quote = clampText(entry?.quote, 200);
  const lead = clampText(entry?.lead, 260);
  const item = {
    id: `nb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    phrase,
    lead,
    quote,
    sessionId: typeof entry?.sessionId === 'string' ? entry.sessionId : '',
    at: Date.now(),
  };
  const deduped = current.filter((node) => !(node?.phrase === phrase && (node?.quote ?? '') === quote));
  deduped.push(item);
  return deduped.length > NOTEBOOK_LIMIT ? deduped.slice(deduped.length - NOTEBOOK_LIMIT) : deduped;
}

/**
 * 删一条。
 * @param {object[]} list - 现有列表。
 * @param {string} id - 条目 id。
 * @returns {object[]} 新数组。
 */
export function notebookRemove(list, id) {
  const current = Array.isArray(list) ? list : [];
  return current.filter((node) => node?.id !== id);
}

/**
 * 导出成 Markdown。
 * @param {object[]} list - 笔记本。
 * @returns {string} Markdown；空列表时是空串。
 */
export function notebookToMarkdown(list) {
  const items = Array.isArray(list) ? list.filter((node) => node !== null && typeof node === 'object') : [];
  if (items.length === 0) return '';
  const lines = [`## 生词本（${items.length} 条）`, ''];
  for (const item of items) {
    lines.push(`- **${item.phrase}**${item.lead !== undefined && item.lead !== '' ? ` —— ${item.lead}` : ''}`);
    if (typeof item.quote === 'string' && item.quote !== '') lines.push(`  > ${item.quote}`);
  }
  return lines.join('\n');
}

/**
 * 朗读文本（离线 TTS；不支持就返回 false）。
 * @param {string} text - 要念的字。
 * @param {object} [options] - `{lang, rate, pitch}`。
 * @returns {boolean} 是否排上了队。
 */
export function speakText(text, options = {}) {
  const content = typeof text === 'string' ? text.trim() : '';
  if (content === '') return false;
  try {
    const synth = globalThis.speechSynthesis;
    if (synth === null || synth === undefined || typeof synth.speak !== 'function') return false;
    const Utterance = globalThis.SpeechSynthesisUtterance;
    if (typeof Utterance !== 'function') return false;
    synth.cancel();
    const utterance = new Utterance(content.slice(0, 400));
    utterance.lang = typeof options.lang === 'string' && options.lang !== ''
      ? options.lang
      : (/[\u4e00-\u9fa5]/u.test(content) ? 'zh-CN' : 'en-US');
    utterance.rate = Number.isFinite(options.rate) ? options.rate : 1;
    utterance.pitch = Number.isFinite(options.pitch) ? options.pitch : 1;
    synth.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
