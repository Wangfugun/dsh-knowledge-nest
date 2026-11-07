/**
 * 卡片视图模型：把 host 回来的结构翻成"人一眼能读完"的几段。
 *
 * 顺序就是产品主张：**语境释义 → 依据 → 其它读法 → 相关（三级）→ 通常含义**。
 * 百科式的"先定义再举例"在这里是反的：用户问的是"在这段对话里"。
 */
import { clampText } from './util.js';

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
export function buildCard(input) {
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
export function buildPendingCard(phrase) {
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
export function buildErrorCard(phrase, error) {
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
export function parentContextOf(node) {
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
