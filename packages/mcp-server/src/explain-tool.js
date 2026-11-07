/**
 * 工具本体：把 explainer 的产物包装成 `knowledge_nest_explain` 的入参与出参。
 *
 * 这一层**不依赖 MCP SDK**（只在 server.js 里接 SDK），所以可以脱离传输层单测。
 *
 * 契约（与文档一致）：
 *   入参  { text, context?, mode?: 'explain'|'rephrase'|'example'|'translate' }
 *   出参  { ok: true, card } | { ok: false, code, message }
 *
 * 失败一律**在返回值里表达**（不走协议错误）：调用方拿到 code 就能自己决定怎么提示。
 */
import { buildCard } from '../../../client/card.js';
import { asNestError } from '../../../lib/errors.js';

/** 工具名（客户端按这个名字调）。 */
export const TOOL_NAME = 'knowledge_nest_explain';

/** 对外 mode → 内部 mode（内部把"释义"叫 default）。 */
export const MODE_MAP = Object.freeze({
  explain: 'default',
  rephrase: 'rephrase',
  example: 'example',
  translate: 'translate',
});

/** 对外的 mode 取值（schema 用）。 */
export const MODE_VALUES = Object.freeze(Object.keys(MODE_MAP));

/** 圈出文本的上限（与库里 PHRASE_LIMIT 一致）。 */
export const MAX_TEXT_CHARS = 200;

/** 上下文上限：再长就不是"这段对话"了，而且按字计费。 */
export const MAX_CONTEXT_CHARS = 8000;

/**
 * 文本裁剪：压空白 + 截断。
 * @param {unknown} value - 任意值。
 * @param {number} limit - 上限。
 * @returns {string} 结果。
 */
function clip(value, limit) {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/gu, ' ').trim();
  return flat.length > limit ? flat.slice(0, limit) : flat;
}

/**
 * 数一下这个词在上下文里出现几次（卡片脚注用）。
 * @param {string} text - 词。
 * @param {string} context - 上下文。
 * @returns {number} 次数。
 */
export function countOccurrences(text, context) {
  const needle = typeof text === 'string' ? text : '';
  const haystack = typeof context === 'string' ? context : '';
  if (needle === '' || haystack === '') return 0;
  let total = 0;
  let cursor = 0;
  for (;;) {
    const at = haystack.indexOf(needle, cursor);
    if (at < 0) break;
    total += 1;
    cursor = at + needle.length;
  }
  return total;
}

/**
 * 造失败返回值。
 * @param {string} code - 机器可读错误码。
 * @param {string} message - 人话。
 * @returns {{ok:false, code:string, message:string}} 结果。
 */
export function fail(code, message) {
  return { ok: false, code, message };
}

/**
 * 跑一次工具调用。
 * @param {{explain:Function}} explainer - `createExplainer()` 的产物。
 * @param {{text?:unknown, context?:unknown, mode?:unknown}} input - 工具入参。
 * @param {{precheck?:()=>object|null}} [options] - `precheck` 返回非空即短路（用于 baseUrl/model 校验）。
 * @returns {Promise<{ok:true, card:object}|{ok:false, code:string, message:string}>} 结果。
 */
export async function runExplainTool(explainer, input, options = {}) {
  const text = clip(input?.text, MAX_TEXT_CHARS);
  if (text === '') return fail('bad-request', 'text 不能为空');

  const rawMode = input?.mode === undefined || input?.mode === null ? 'explain' : String(input.mode);
  if (!Object.prototype.hasOwnProperty.call(MODE_MAP, rawMode)) {
    return fail('bad-mode', `mode 只能是 ${MODE_VALUES.join(' / ')}`);
  }

  const context = clip(input?.context, MAX_CONTEXT_CHARS);

  if (typeof options.precheck === 'function') {
    const blocked = options.precheck();
    if (blocked !== null && blocked !== undefined) return blocked;
  }

  try {
    const result = await explainer.explain({
      phrase: text,
      context,
      mode: MODE_MAP[rawMode],
    });
    const card = buildCard({
      phrase: text,
      data: result.data,
      count: countOccurrences(text, context),
      model: result.model,
      cached: result.cached,
      ms: result.ms,
      usage: result.usage,
    });
    return { ok: true, card: { ...card, mode: rawMode } };
  } catch (error) {
    const nest = asNestError(error);
    return fail(nest.code, nest.message);
  }
}
