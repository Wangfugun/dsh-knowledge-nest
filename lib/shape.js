/**
 * 把模型吐出来的东西收敛成前端敢直接渲染的结构。
 *
 * 模型是外部数据源：它可能返回代码块、前后缀、超长文本、多余嵌套、甚至
 * 一段"忽略以上指令"的注入尝试。这里只做一件事——**削成有限形状，别的全丢**。
 * 所有字段都有长度上限，层级最多 3（根 → links → children）。
 */

/** 各字段上限。 */
export const LIMITS = Object.freeze({
  here: 240,
  literal: 160,
  kind: 8,
  domain: 10,
  readings: 3,
  readingLabel: 24,
  readingNote: 120,
  evidence: 4,
  quote: 120,
  why: 120,
  links: 5,
  linkLabel: 24,
  linkNote: 100,
  children: 3,
  phrase: 200,
});

/** 允许的 kind。 */
const KINDS = ['术语', '动作', '指代', '评价', '其它'];

/** 允许的置信度。 */
const CONFIDENCE = ['high', 'medium', 'low'];

/**
 * 抹平空白、切到上限。
 * @param {unknown} value - 任意值。
 * @param {number} limit - 上限。
 * @returns {string} 干净字符串（可能为空）。
 */
export function text(value, limit) {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/gu, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, Math.max(1, limit - 1))}…` : flat;
}

/**
 * 取第一个"像 JSON 对象"的片段。
 *
 * 模型常见三种形态：纯 JSON、```json 围栏、JSON 前后带一句话。三种都要吃得下。
 * @param {unknown} raw - 模型返回的文本。
 * @returns {object|null} 解析结果；失败是 null。
 */
export function parseModelJson(raw) {
  const text0 = typeof raw === 'string' ? raw : '';
  if (text0.trim() === '') return null;
  const unfenced = text0
    .replace(/^\uFEFF/u, '')
    .replace(/```(?:json)?/giu, '')
    .trim();
  const candidates = [unfenced];
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(unfenced.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

/**
 * 数组收敛：只留对象元素，逐个映射，切到上限。
 * @param {unknown} value - 原始数组。
 * @param {number} limit - 条数上限。
 * @param {(item:object, index:number)=>object|null} map - 元素映射（返回 null 表示丢弃）。
 * @returns {object[]} 干净数组。
 */
function list(value, limit, map) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (let index = 0; index < value.length && out.length < limit; index += 1) {
    const item = value[index];
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const mapped = map(item, index);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

/**
 * 收敛成前端卡片模型。
 * @param {unknown} raw - 模型 JSON。
 * @returns {object|null} 形状；缺 here 视为无效（返回 null）。
 */
export function shapeExplanation(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const here = text(raw.here ?? raw.meaning ?? raw.explain, LIMITS.here);
  if (here === '') return null;
  const kindRaw = text(raw.kind, LIMITS.kind);
  const kind = KINDS.includes(kindRaw) ? kindRaw : '其它';
  const confidenceRaw = text(raw.confidence, 12).toLowerCase();
  const confidence = CONFIDENCE.includes(confidenceRaw) ? confidenceRaw : 'medium';
  /* 领域：只留一个词，超过 10 字就截断；没有就是空串（前端据此禁用「标出同类」）。 */
  const domain = text(raw.domain, LIMITS.domain);

  return {
    here,
    kind,
    domain,
    literal: text(raw.literal, LIMITS.literal),
    confidence,
    readings: list(raw.readings, LIMITS.readings, (item) => {
      const label = text(item.label, LIMITS.readingLabel);
      const note = text(item.note ?? item.why, LIMITS.readingNote);
      if (label === '' && note === '') return null;
      return { label: label === '' ? '另一种读法' : label, note };
    }),
    evidence: list(raw.evidence, LIMITS.evidence, (item) => {
      const quote = text(item.quote ?? item.text, LIMITS.quote);
      if (quote === '') return null;
      return { quote, why: text(item.why ?? item.note, LIMITS.why) };
    }),
    links: list(raw.links, LIMITS.links, (item) => {
      const label = text(item.label ?? item.name, LIMITS.linkLabel);
      if (label === '') return null;
      return {
        label,
        note: text(item.note, LIMITS.linkNote),
        children: list(item.children, LIMITS.children, (child) => {
          const childLabel = text(child.label ?? child.name, LIMITS.linkLabel);
          if (childLabel === '') return null;
          return { label: childLabel, note: text(child.note, LIMITS.linkNote) };
        }),
      };
    }),
  };
}

/**
 * 只有 here、没有结构的降级卡（模型没给 JSON 时用）。
 * @param {string} raw - 模型原文。
 * @returns {object|null} 形状。
 */
export function fallbackExplanation(raw) {
  const plain = text(raw, 600);
  if (plain === '') return null;
  return {
    here: text(plain, LIMITS.here),
    kind: '其它',
    literal: '',
    confidence: 'low',
    readings: [],
    evidence: [],
    links: [],
  };
}
