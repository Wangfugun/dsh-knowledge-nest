/**
 * 卡片仓库：`$DSH_HOME/knowledge-nest/cards.jsonl`（一行一张卡）。
 *
 * 为什么要落盘：localStorage 只有几 MB，且换机就丢；卡片是"用户攒下来的东西"，
 * 必须存在能带走的地方。JSONL 的好处是追加写便宜、坏一行不影响其它行。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 文件名。 */
export const CARDS_FILE = 'cards.jsonl';

/** 上限：读的时候最多回这么多条。 */
const MAX_READ = 5000;

/**
 * 卡片 → 索引行（只留检索要用的字段）。
 * @param {object} card - 完整卡片。
 * @returns {object|null} 行。
 */
export function toRow(card) {
  if (card === null || typeof card !== 'object') return null;
  const phrase = typeof card.phrase === 'string' ? card.phrase.trim() : '';
  if (phrase === '') return null;
  return {
    phrase,
    lead: typeof card.lead === 'string' ? card.lead : '',
    literal: typeof card.literal === 'string' ? card.literal : '',
    domain: typeof card.domain === 'string' ? card.domain : '',
    kind: typeof card.kind === 'string' ? card.kind : '',
    quotes: Array.isArray(card.evidence)
      ? card.evidence.map((item) => (typeof item?.quote === 'string' ? item.quote : '')).filter(Boolean).slice(0, 3)
      : [],
    at: Number.isFinite(card.at) ? card.at : Date.now(),
    count: Number.isFinite(card.count) ? card.count : 0,
  };
}

/**
 * 读全库（坏行跳过）。
 * @param {string} file - 文件路径。
 * @returns {object[]} 行数组。
 */
export function readRows(file) {
  if (!existsSync(file)) return [];
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const row = JSON.parse(trimmed);
      if (row !== null && typeof row === 'object' && typeof row.phrase === 'string') out.push(row);
    } catch {
      /* 坏行跳过 */
    }
    if (out.length >= MAX_READ) break;
  }
  return out;
}

/**
 * 按词合并：同词覆盖，保留最早时间、累加次数。
 * @param {object[]} rows - 旧行。
 * @param {object[]} incoming - 新行。
 * @returns {object[]} 合并结果。
 */
export function mergeRows(rows, incoming) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) map.set(row.phrase, row);
  for (const row of Array.isArray(incoming) ? incoming : []) {
    const prev = map.get(row.phrase);
    map.set(row.phrase, prev === undefined
      ? row
      : { ...prev, ...row, at: Math.min(prev.at ?? row.at, row.at ?? Date.now()), count: Math.max(prev.count ?? 0, row.count ?? 0) });
  }
  return [...map.values()];
}

/**
 * 搜索。四个字段：词 / 释义 / 原文引用 / 领域。
 * @param {object[]} rows - 行。
 * @param {string} query - 关键词。
 * @param {{domain?:string, limit?:number}} [filters] - 过滤。
 * @returns {object[]} 命中。
 */
export function searchRows(rows, query, filters = {}) {
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
  const domain = typeof filters?.domain === 'string' ? filters.domain : '';
  const limit = Number.isFinite(filters?.limit) ? Math.max(1, Math.min(500, filters.limit)) : 200;
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      if (domain !== '' && row.domain !== domain) return false;
      if (needle === '') return true;
      const hay = [row.phrase, row.lead, row.literal, row.domain, ...(row.quotes ?? [])]
        .filter((item) => typeof item === 'string')
        .join('\n')
        .toLowerCase();
      return hay.includes(needle);
    })
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, limit);
}

/**
 * 仓库句柄。
 * @param {{dir:string}} options - `$DSH_HOME/knowledge-nest`。
 * @returns {{upsert:Function, search:Function, all:Function, stats:Function, file:string}} 句柄。
 */
export function createCardStore(options) {
  const dir = typeof options?.dir === 'string' && options.dir !== '' ? options.dir : '.';
  const file = join(dir, CARDS_FILE);

  const ensureDir = () => {
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch {
      /* 已存在 */
    }
  };

  return {
    file,
    /**
     * 写入（合并同词）。
     * @param {object[]} cards - 卡片。
     * @returns {{ok:boolean, written:number, total:number}} 结果。
     */
    upsert(cards) {
      const incoming = (Array.isArray(cards) ? cards : []).map(toRow).filter(Boolean);
      if (incoming.length === 0) return { ok: true, written: 0, total: readRows(file).length };
      ensureDir();
      const merged = mergeRows(readRows(file), incoming);
      /* 全量重写更安全：避免同词出现多行 */
      const tmp = `${file}.tmp`;
      try {
        writeFileSync(tmp, merged.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
        renameSync(tmp, file);
      } catch {
        try {
          appendFileSync(file, incoming.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
        } catch {
          return { ok: false, written: 0, total: 0 };
        }
      }
      return { ok: true, written: incoming.length, total: merged.length };
    },
    search(query, filters) {
      return searchRows(readRows(file), query, filters);
    },
    all() {
      return readRows(file);
    },
    stats() {
      const rows = readRows(file);
      return { total: rows.length, file };
    },
  };
}
